/**
 * The Postgres-independent run journal for history sync.
 *
 * WHY THIS EXISTS. On 2026-09-15 the 18:00 cron slot fired, scanned, upserted and
 * settled for 52 seconds, and then PostgREST answered 521 to the terminal
 * `history_sync_status` write. That upsert throws before the `history_sync_log`
 * insert is attempted and the whole thing is swallowed, so a run that had genuinely
 * moved rows left NO trace in relational history — indistinguishable from a cron
 * that never fired.
 *
 * The guarantee under test is therefore an ORDERING one: the KV terminal event is
 * written BEFORE anything touches Postgres. That cannot be proven by asserting on
 * source text, so these tests drive `handleHistorySync` with a fake Supabase client
 * and record the true interleaving of journal writes and database operations.
 *
 * Nothing here contacts KV, Postgres or API-Football.
 */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

// ── recording harness ──────────────────────────────────────────────────────

/** Every journal write and database operation, in the order they happened. */
let timeline = [];
const journalEvents = () => timeline.filter((e) => e.type === "journal").map((e) => e.payload);
const indexOfDbTable = (table) => timeline.findIndex((e) => e.type === "db" && e.table === table);

/** Set by individual tests to make a table's operation succeed or throw. */
let tableHandlers = {};
/** Set by individual tests to make the KV write itself fail. */
let journalWriteFails = false;

function fakeSupabase() {
  return {
    from(table) {
      const builder = new Proxy(
        {},
        {
          get(_target, prop) {
            if (typeof prop === "symbol") return undefined;
            if (prop === "then") {
              return (resolve, reject) => {
                timeline.push({ type: "db", table });
                return Promise.resolve()
                  .then(() => (tableHandlers[table] ? tableHandlers[table]() : { data: [], error: null }))
                  .then(resolve, reject);
              };
            }
            return () => builder;
          }
        }
      );
      return builder;
    }
  };
}

const realTelemetry = await import("../server-utils/observability/syncTelemetry.js");

mock.module("../server-utils/cronRequestAuth.js", {
  namedExports: { isAuthorizedCronOrInternalRequest: () => true }
});

mock.module("../server-utils/supabaseAdmin.js", {
  namedExports: {
    assertSupabaseConfigured: () => ({ ok: true }),
    getSupabaseAdmin: () => fakeSupabase()
  }
});

// `default` cannot be re-exported as a named export by the module mocker, so the
// real namespace is copied without it.
const realTelemetryNamed = Object.fromEntries(
  Object.entries(realTelemetry).filter(([name]) => name !== "default")
);

mock.module("../server-utils/observability/syncTelemetry.js", {
  namedExports: {
    ...realTelemetryNamed,
    recordSyncRun: async (_kind, payload) => {
      timeline.push({ type: "journal", payload });
      if (journalWriteFails) throw new Error("kv unreachable");
      return { ok: true };
    }
  }
});

const { handleHistorySync } = await import("../api/history.js");
const { createHistoryTiming } = await import("../server-utils/observability/historyTiming.js");

function makeReqRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  const req = {
    method: "GET",
    // `resolveHistorySyncSource` reads the UA to separate cron from an admin call.
    headers: { "user-agent": "vercel-cron/1.0" },
    query: { sync: "1", days: "45" }
  };
  return { req, res };
}

async function runSync() {
  timeline = [];
  const { req, res } = makeReqRes();
  // Production always passes a timing accumulator (the route builds one). It is
  // what carries failedStage/errorKind/errorCode into the terminal event, so a
  // null here would silently make every failure look unclassifiable.
  await handleHistorySync(req, res, createHistoryTiming(req.query, req.method));
  return res;
}

test.beforeEach(() => {
  timeline = [];
  tableHandlers = {};
  journalWriteFails = false;
});

// ── A. run id ──────────────────────────────────────────────────────────────

test("[J1] one runId is generated per invocation and shared by both events", async () => {
  const res = await runSync();
  assert.equal(res.statusCode, 200);

  const events = journalEvents();
  assert.equal(events.length, 2, "expected exactly a STARTED and one terminal event");
  const [started, terminal] = events;

  assert.equal(started.status, "STARTED");
  assert.equal(terminal.status, "COMPLETED");
  assert.ok(started.runId, "STARTED must carry a runId");
  assert.equal(
    terminal.runId,
    started.runId,
    "the terminal event must reuse the STARTED runId, otherwise the two cannot be paired"
  );
  assert.match(
    started.runId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "runId must be an opaque UUID, not a platform identifier we do not control"
  );
});

test("[J2] two invocations never share a runId", async () => {
  await runSync();
  const first = journalEvents()[0].runId;
  await runSync();
  const second = journalEvents()[0].runId;
  assert.notEqual(first, second);
});

// ── B. STARTED ─────────────────────────────────────────────────────────────

test("[J3] STARTED is written before any database work", async () => {
  await runSync();
  const startedAt = timeline.findIndex((e) => e.type === "journal" && e.payload.status === "STARTED");
  const firstDb = timeline.findIndex((e) => e.type === "db");
  assert.ok(startedAt >= 0, "a STARTED event must exist");
  assert.ok(firstDb >= 0, "the run must have touched the database");
  assert.ok(startedAt < firstDb, "STARTED must precede scan 1, or a dead run leaves no evidence");
});

test("[J4] STARTED carries startedAt and the existing source vocabulary", async () => {
  await runSync();
  const [started] = journalEvents();
  assert.equal(started.source, "vercel_cron", "source must come from resolveHistorySyncSource");
  assert.ok(started.startedAt, "startedAt must be explicit, not derived from durationMs later");
  assert.equal(
    new Date(started.startedAt).toISOString(),
    started.startedAt,
    "startedAt must be a round-trippable ISO timestamp"
  );
});

test("[J5] a KV outage cannot abort or fail the sync", async () => {
  journalWriteFails = true;
  const res = await runSync();
  assert.equal(res.statusCode, 200, "observability must never become a failure mode for the sync");
  assert.equal(res.body.ok, true);
});

// ── C. COMPLETED ───────────────────────────────────────────────────────────

test("[J6] COMPLETED carries the work counters and a measured duration", async () => {
  await runSync();
  const events = journalEvents();
  const terminal = events[1];

  for (const field of ["scanned", "updated", "estimatedCalls", "upsertBatches", "durationMs"]) {
    assert.equal(typeof terminal[field], "number", `${field} must be recorded as a number`);
    assert.ok(terminal[field] >= 0, `${field} must not be negative`);
  }
  assert.equal(terminal.source, "vercel_cron");
  assert.equal(terminal.startedAt, events[0].startedAt, "both events describe one run");
});

// ── D/E. terminal failure classification ───────────────────────────────────

/** Drive scan 1 into a failure and return the terminal journal event. */
async function failingSync(error) {
  tableHandlers = {
    predictions_history: () => {
      throw error;
    }
  };
  const res = await runSync();
  const events = journalEvents();
  return { res, terminal: events[events.length - 1], events };
}

test("[J7] a transport failure with no code becomes DB_UNAVAILABLE", async () => {
  // postgrest-js cannot parse a Cloudflare 521 HTML body as JSON, so it falls back
  // to `{ message: body }` with NO code. That absence is the only surviving signal.
  const { terminal, res } = await failingSync({ message: "<html>error code: 521</html>" });

  assert.equal(res.statusCode, 500);
  assert.equal(terminal.status, "DB_UNAVAILABLE");
  assert.equal(terminal.failureStage, "scan1Ms", "the failing stage must be a fixed historyTiming label");
  assert.equal(terminal.failureOperation, "scan_pending");
});

test("[J8] a statement timeout becomes DB_UNAVAILABLE", async () => {
  const { terminal } = await failingSync({
    code: "57014",
    message: "canceling statement due to statement timeout"
  });
  assert.equal(terminal.status, "DB_UNAVAILABLE");
  assert.equal(terminal.errorCode, "57014");
  assert.equal(terminal.errorKind, "db_timeout");
});

test("[J9] a structured Postgres rejection is FAILED, not DB_UNAVAILABLE", async () => {
  // PostgREST answered with a SQLSTATE, so the database was alive and said no.
  const { terminal } = await failingSync({
    code: "23505",
    message: "duplicate key value violates unique constraint"
  });
  assert.equal(terminal.status, "FAILED");
  assert.equal(terminal.errorCode, "23505");
});

test("[J10] the failure event never persists the error message", async () => {
  const secret = "postgresql://user:hunter2@db.internal:5432/postgres";
  const { terminal } = await failingSync({ message: `connection failed ${secret}` });

  const serialised = JSON.stringify(terminal);
  assert.equal(serialised.includes("hunter2"), false, "a credential must never reach the journal");
  assert.equal(serialised.includes(secret), false);
  assert.equal(serialised.includes("connection failed"), false, "error.message must not be stored at all");
});

test("[J11] the terminal event is written BEFORE Postgres terminal logging", async () => {
  // The whole point. On 2026-09-15 the order was reversed and the run vanished.
  const { terminal } = await failingSync({ message: "<html>error code: 521</html>" });
  assert.equal(terminal.status, "DB_UNAVAILABLE");

  const journalIdx = timeline.findIndex((e) => e.type === "journal" && e.payload.status === "DB_UNAVAILABLE");
  const statusIdx = indexOfDbTable("history_sync_status");

  assert.ok(journalIdx >= 0, "a terminal journal event must exist");
  assert.ok(statusIdx >= 0, "the handler must still attempt its Postgres logging");
  assert.ok(
    journalIdx < statusIdx,
    "the KV terminal event must precede history_sync_status, or a DB outage erases the run again"
  );
});

test("[J12] evidence survives even when Postgres terminal logging also fails", async () => {
  const down = () => {
    throw { message: "<html>error code: 521</html>" };
  };
  tableHandlers = {
    predictions_history: down,
    history_sync_status: down,
    history_sync_log: down
  };
  timeline = [];
  const { req, res } = makeReqRes();
  await handleHistorySync(req, res, createHistoryTiming(req.query, req.method));

  const events = journalEvents();
  const terminal = events[events.length - 1];
  assert.equal(events[0].status, "STARTED");
  assert.equal(terminal.status, "DB_UNAVAILABLE", "the run must still be observable with Postgres fully down");
  assert.equal(terminal.runId, events[0].runId);
  assert.equal(res.statusCode, 500);
});

// ── the classifier, directly ───────────────────────────────────────────────

const { classifyTerminalStatus, reconcileRunJournal, RUN_STATUS, RUN_JOURNAL_UNKNOWN_AFTER_MS } = realTelemetry;

test("[J13] classifyTerminalStatus only calls a database stage unavailable", () => {
  assert.equal(classifyTerminalStatus({ failedStage: "upsert3Ms" }), RUN_STATUS.DB_UNAVAILABLE);
  assert.equal(classifyTerminalStatus({ failedStage: "scan1Ms", errorCode: "23505" }), RUN_STATUS.FAILED);
  assert.equal(classifyTerminalStatus({ errorKind: "db_timeout" }), RUN_STATUS.DB_UNAVAILABLE);

  // Provider and in-process stages are never a database verdict.
  assert.equal(classifyTerminalStatus({ failedStage: "providerFixtureMs" }), RUN_STATUS.FAILED);
  assert.equal(classifyTerminalStatus({ failedStage: "statsMs" }), RUN_STATUS.FAILED);
  assert.equal(classifyTerminalStatus({ failedStage: "cpuPrepareMs" }), RUN_STATUS.FAILED);
  // Mixed provider/database stages are deliberately excluded.
  assert.equal(classifyTerminalStatus({ failedStage: "closingOddsMs" }), RUN_STATUS.FAILED);
  assert.equal(classifyTerminalStatus({}), RUN_STATUS.FAILED);
});

// ── reconciliation ─────────────────────────────────────────────────────────

test("[J14] reconciliation names each side's blind spot", () => {
  const now = Date.parse("2026-09-15T22:00:00.000Z");
  const out = reconcileRunJournal({
    runs: [
      // a healthy run: both events, and Postgres agrees
      { at: "2026-09-15T15:56:19.098Z", runId: "a", status: "STARTED", startedAt: "2026-09-15T15:55:26.000Z" },
      { at: "2026-09-15T15:56:21.000Z", runId: "a", status: "COMPLETED", startedAt: "2026-09-15T15:55:26.000Z" },
      // the 18:00 run: KV has it, Postgres lost it
      { at: "2026-09-15T18:44:58.258Z", runId: "b", status: "STARTED", startedAt: "2026-09-15T18:44:06.811Z" },
      {
        at: "2026-09-15T18:44:58.300Z",
        runId: "b",
        status: "DB_UNAVAILABLE",
        startedAt: "2026-09-15T18:44:06.811Z"
      },
      // a run that started and never came back
      { at: "2026-09-15T19:30:00.000Z", runId: "c", status: "STARTED", startedAt: "2026-09-15T19:30:00.000Z" }
    ],
    // Postgres saw the 15:56 run, and a 12:43 run KV never recorded
    postgresRunsAt: ["2026-09-15T15:56:21.414Z", "2026-09-15T12:43:25.559Z"],
    nowMs: now
  });

  const verdict = (runId) => out.find((r) => r.runId === runId)?.verdict;
  assert.equal(verdict("a"), "HEALTHY");
  assert.equal(verdict("b"), "KV_ONLY", "the run Postgres lost must be recoverable from KV alone");
  assert.equal(verdict("c"), "STARTED_ONLY", "a STARTED past the bound is a disappeared run");
  assert.equal(out.filter((r) => r.verdict === "PG_ONLY").length, 1, "the run KV missed must still be named");
});

test("[J15] a run still inside the bound is RUNNING, never reported as lost", () => {
  const startedAt = "2026-09-15T21:00:00.000Z";
  const runs = [{ at: startedAt, runId: "x", status: "STARTED", startedAt }];

  const inside = reconcileRunJournal({
    runs,
    postgresRunsAt: [],
    nowMs: Date.parse(startedAt) + RUN_JOURNAL_UNKNOWN_AFTER_MS - 1000
  });
  assert.equal(inside[0].verdict, "RUNNING");

  const after = reconcileRunJournal({
    runs,
    postgresRunsAt: [],
    nowMs: Date.parse(startedAt) + RUN_JOURNAL_UNKNOWN_AFTER_MS + 1000
  });
  assert.equal(after[0].verdict, "STARTED_ONLY");
});

test("[J16] pre-journal records without runId or status still reconcile", () => {
  // Exactly the shape this stream carried before STARTED/terminal events existed.
  const legacy = {
    at: "2026-09-14T21:23:01.200Z",
    finishedScanned: 940,
    universalEnabled: true,
    durationMs: 46286
  };
  const out = reconcileRunJournal({
    runs: [legacy],
    postgresRunsAt: ["2026-09-14T21:23:04.270Z"],
    nowMs: Date.parse("2026-09-15T00:00:00.000Z")
  });

  assert.equal(out.length, 1, "a legacy entry must not also count as an unmatched Postgres row");
  assert.equal(out[0].verdict, "HEALTHY", "old records are terminal events and must still pair");
});
