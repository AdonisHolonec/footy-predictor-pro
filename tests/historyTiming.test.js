import test from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_TIMING_EVENT,
  classifyHistoryError,
  classifyHistoryMode,
  createHistoryTiming,
  emitHistoryTiming,
  markStage,
  recordError,
  recordFinalBytes,
  recordRows,
  summarizeHistoryTiming,
  timeStage
} from "../server-utils/observability/historyTiming.js";
import { SLOW_REQUEST_MS } from "../server-utils/observability/requestMonitor.js";
import { handleHistoryRead } from "../api/history.js";

/**
 * Timing attribution for /api/history.
 *
 * A production hydration took 23,176 ms against a ~2,200 ms norm and could not
 * be decomposed: requestMonitor instruments only `predict` and `fixtures`, so
 * the route that reads the largest documents in the system had no server-side
 * timing at all.
 *
 * What matters here is that a slow request is separable (database vs payload),
 * that a fast one costs nothing and says nothing, and that no prediction row or
 * credential can reach a log line.
 */

/* -- mode classification --------------------------------------------------- */

test("each handler branch is labelled with the branch that actually ran", () => {
  // Resolution order must mirror handlerImpl, including the precedences.
  assert.equal(classifyHistoryMode({ view: "special-bets" }), "special-bets");
  assert.equal(classifyHistoryMode({ sync: "1" }), "sync");
  assert.equal(classifyHistoryMode({ closing: "true" }), "closing");
  assert.equal(classifyHistoryMode({ performance: "1" }), "performance");
  assert.equal(classifyHistoryMode({ fixtureId: "123" }), "detail");
  assert.equal(classifyHistoryMode({ mine: "1", view: "prediction-list" }), "prediction-list");
  assert.equal(classifyHistoryMode({ mine: "1", view: "list" }), "list");
  assert.equal(classifyHistoryMode({ mine: "1" }), "mine");
  assert.equal(classifyHistoryMode({}), "anonymous");
});

test("sync outranks a view, exactly as the handler does", () => {
  assert.equal(classifyHistoryMode({ sync: "1", view: "prediction-list" }), "sync");
  assert.equal(classifyHistoryMode({ performance: "1", fixtureId: "9" }), "performance");
});

test("a blank fixtureId is not a detail request", () => {
  assert.equal(classifyHistoryMode({ fixtureId: "   ", mine: "1" }), "mine");
  assert.equal(classifyHistoryMode({ fixtureId: "", mine: "1" }), "mine");
});

/* -- the threshold gate ---------------------------------------------------- */

test("a fast request emits nothing at all", () => {
  const t = createHistoryTiming({ mine: "1", view: "prediction-list" });
  markStage(t, "dbReadMs", 900);
  assert.equal(emitHistoryTiming(t, { status: 200, durationMs: SLOW_REQUEST_MS - 1 }), null);
});

test("a slow request emits exactly one record, with the total", () => {
  const t = createHistoryTiming({ mine: "1", view: "prediction-list", days: "3", limit: "300" });
  markStage(t, "authMs", 120);
  markStage(t, "dbReadMs", 21_000);
  markStage(t, "responseMs", 800);
  recordRows(t, 45);
  recordFinalBytes(t, 630_217);

  const emitted = emitHistoryTiming(t, { status: 200, durationMs: 23_176 });
  assert.ok(emitted);
  assert.equal(emitted.durationMs, 23_176);
  assert.equal(emitted.status, 200);
  assert.equal(emitted.mode, "prediction-list");
  assert.equal(emitted.rows, 45);
  assert.equal(emitted.finalBytes, 630_217);
  assert.equal(emitted.dbReadMs, 21_000);
});

test("a failed request is reported even when it was fast", () => {
  // A 500 that returns quickly is exactly the post-deploy burst signature.
  const t = createHistoryTiming({ mine: "1" });
  const emitted = emitHistoryTiming(t, { status: 500, durationMs: 40 });
  assert.ok(emitted);
  assert.equal(emitted.status, 500);
});

test("a fast success stays silent even with stages recorded", () => {
  const t = createHistoryTiming({ mine: "1" });
  markStage(t, "authMs", 10);
  markStage(t, "dbReadMs", 30);
  assert.equal(emitHistoryTiming(t, { status: 200, durationMs: 50 }), null);
  assert.equal(emitHistoryTiming(t, { status: 304, durationMs: 5 }), null);
});

/* -- what the record contains ---------------------------------------------- */

test("the split separates a slow database from a large payload", () => {
  const dbBound = summarizeHistoryTiming(
    (() => {
      const t = createHistoryTiming({ mine: "1" });
      markStage(t, "dbReadMs", 20_000);
      markStage(t, "responseMs", 100);
      return t;
    })(),
    { status: 200, durationMs: 20_400 }
  );
  assert.ok(dbBound.dbReadMs > dbBound.responseMs * 10);

  const payloadBound = summarizeHistoryTiming(
    (() => {
      const t = createHistoryTiming({ mine: "1" });
      markStage(t, "dbReadMs", 900);
      markStage(t, "responseMs", 9_000);
      return t;
    })(),
    { status: 200, durationMs: 10_000 }
  );
  assert.ok(payloadBound.responseMs > payloadBound.dbReadMs * 5);
});

test("unmeasured time is reported rather than hidden", () => {
  const t = createHistoryTiming({ mine: "1" });
  markStage(t, "dbReadMs", 1_000);
  const out = summarizeHistoryTiming(t, { status: 200, durationMs: 23_000 });
  assert.equal(out.unattributedMs, 22_000);
});

test("absent measurements are omitted, never reported as zero", () => {
  const t = createHistoryTiming({});
  const out = summarizeHistoryTiming(t, { status: 200, durationMs: 9_000 });
  assert.equal("dbReadMs" in out, false);
  assert.equal("rows" in out, false);
  assert.equal("finalBytes" in out, false);
});

test("an absent duration is not recorded as an instant stage", () => {
  const t = createHistoryTiming({});
  for (const bad of [null, undefined, "", NaN, -5, "abc"]) markStage(t, "dbReadMs", bad);
  assert.equal("dbReadMs" in summarizeHistoryTiming(t, { status: 200, durationMs: 9_000 }), false);
});

test("an unknown stage name is ignored", () => {
  const t = createHistoryTiming({});
  markStage(t, "somethingElse", 500);
  const out = summarizeHistoryTiming(t, { status: 200, durationMs: 9_000 });
  assert.equal("somethingElse" in out, false);
});

/* -- secrets and payloads -------------------------------------------------- */

test("no credential or payload can reach the record, even if the query carries one", () => {
  const t = createHistoryTiming({
    mine: "1",
    view: "prediction-list",
    access_token: "eyJhbGciOiJIUzI1NiJ9.secret.value",
    authorization: "Bearer super-secret",
    password: "hunter2"
  });
  recordRows(t, 45);
  const serialized = JSON.stringify(summarizeHistoryTiming(t, { status: 200, durationMs: 23_000 }));
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("eyJ"), false);
});

test("the record carries only primitives, so a row cannot ride along", () => {
  const t = createHistoryTiming({ mine: "1" });
  recordRows(t, 45);
  recordFinalBytes(t, 630_217);
  markStage(t, "dbReadMs", 1_000);
  const out = summarizeHistoryTiming(t, { status: 200, durationMs: 23_000 });
  for (const value of Object.values(out)) {
    assert.ok(["string", "number", "boolean"].includes(typeof value) || value === null);
  }
});

test("the accumulator itself never retains the raw query", () => {
  /*
    Defence in depth: the emitted record is what reaches a log, but if the
    accumulator holds the raw query then one future spread turns it into a leak.
    Keeping it primitives-only means the leak cannot be one edit away.
  */
  const t = createHistoryTiming({
    mine: "1",
    access_token: "eyJhbGciOiJIUzI1NiJ9.secret.value",
    password: "hunter2"
  });
  markStage(t, "dbReadMs", 10);
  recordRows(t, 45);
  const serialized = JSON.stringify(t);
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(serialized.includes("eyJ"), false);
  assert.equal(serialized.includes("access_token"), false);
});

test("the emitted event name is the documented one", () => {
  assert.equal(HISTORY_TIMING_EVENT, "history.timing");
});

/* -- error classification -------------------------------------------------- */

test("a statement timeout is distinguishable from any other failure", () => {
  assert.equal(classifyHistoryError({ code: "57014" }), "db_timeout");
  assert.equal(classifyHistoryError(new Error("canceling statement due to statement timeout")), "db_timeout");
});

test("failures are classified by the stage that raised them", () => {
  assert.equal(classifyHistoryError(new Error("boom"), "dbReadMs"), "rpc_error");
  assert.equal(classifyHistoryError(new Error("boom"), "authMs"), "auth_error");
  assert.equal(classifyHistoryError(new Error("boom"), "responseMs"), "response_error");
  assert.equal(classifyHistoryError(new Error("boom"), "mappingMs"), "mapping_error");
  assert.equal(classifyHistoryError(new Error("boom")), "unknown_error");
  assert.equal(classifyHistoryError(null), null);
});

test("an error classification never carries the message itself", () => {
  const t = createHistoryTiming({ mine: "1" });
  recordError(t, new Error("connection to db-user:hunter2@dbhost failed"), "dbReadMs");
  const serialized = JSON.stringify(summarizeHistoryTiming(t, { status: 500, durationMs: 100 }));
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(serialized.includes("dbhost"), false);
  assert.ok(serialized.includes("rpc_error"));
});

/* -- inertness: the handler behaves identically with and without timing ----- */

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.getHeader = (name) => res.headers[String(name).toLowerCase()] ?? null;
  res.setHeader = (name, value) => {
    res.headers[String(name).toLowerCase()] = value;
    return res;
  };
  return res;
}

const ITEMS = [{ id: 1 }, { id: 2 }, { id: 3 }];

function readDeps(timing) {
  return {
    timing,
    getRequester: async () => ({ ok: true, user: { id: "u1" } }),
    assertSupabaseConfigured: () => ({ ok: true }),
    readPredictionsForHydration: async () => ({ items: ITEMS, stats: { total: 3 } }),
    readPredictionsHistoryListForUser: async () => ({ items: ITEMS, stats: { total: 3 } }),
    readPredictionsHistoryForUser: async () => ({ items: ITEMS, stats: { total: 3 } })
  };
}

test("the response body is identical with and without a timing accumulator", async () => {
  const query = { mine: "1", view: "prediction-list", days: "3", limit: "300" };

  const withRes = fakeRes();
  await handleHistoryRead({ method: "GET", query }, withRes, readDeps(createHistoryTiming(query)));

  const withoutRes = fakeRes();
  await handleHistoryRead({ method: "GET", query }, withoutRes, readDeps(undefined));

  assert.equal(JSON.stringify(withRes.body), JSON.stringify(withoutRes.body));
  assert.equal(withRes.statusCode, withoutRes.statusCode);
  assert.equal(withRes.body.items.length, 3);
});

test("existing branching is unchanged: each view still reaches its own reader", async () => {
  const calls = [];
  const deps = {
    ...readDeps(createHistoryTiming({})),
    readPredictionsForHydration: async () => {
      calls.push("prediction-list");
      return { items: ITEMS, stats: {} };
    },
    readPredictionsHistoryListForUser: async () => {
      calls.push("list");
      return { items: ITEMS, stats: {} };
    },
    readPredictionsHistoryForUser: async () => {
      calls.push("full");
      return { items: ITEMS, stats: {} };
    }
  };

  await handleHistoryRead({ method: "GET", query: { mine: "1", view: "prediction-list" } }, fakeRes(), deps);
  await handleHistoryRead({ method: "GET", query: { mine: "1", view: "list" } }, fakeRes(), deps);
  await handleHistoryRead({ method: "GET", query: { mine: "1" } }, fakeRes(), deps);

  assert.deepEqual(calls, ["prediction-list", "list", "full"]);
});

test("the read path records auth and database spans", async () => {
  const query = { mine: "1", view: "prediction-list" };
  const timing = createHistoryTiming(query);
  await handleHistoryRead({ method: "GET", query }, fakeRes(), readDeps(timing));

  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 9_000 });
  assert.equal(typeof out.authMs, "number");
  assert.equal(typeof out.dbReadMs, "number");
});

test("a failing read is classified without changing the response", async () => {
  const query = { mine: "1", view: "prediction-list" };
  const timing = createHistoryTiming(query);
  const res = fakeRes();
  const deps = {
    ...readDeps(timing),
    readPredictionsForHydration: async () => {
      throw new Error("canceling statement due to statement timeout");
    }
  };

  await handleHistoryRead({ method: "GET", query }, res, deps);
  assert.equal(res.statusCode, 500);
  assert.equal(summarizeHistoryTiming(timing, { status: 500, durationMs: 100 }).errorKind, "db_timeout");
});

test("timeStage returns the wrapped value and still times a throw", async () => {
  const t = createHistoryTiming({});
  assert.equal(await timeStage(t, "dbReadMs", async () => "value"), "value");
  await assert.rejects(() =>
    timeStage(t, "authMs", async () => {
      throw new Error("nope");
    })
  );
  const out = summarizeHistoryTiming(t, { status: 500, durationMs: 9_000 });
  assert.equal(typeof out.authMs, "number");
});

/* -- H2: the anonymous branch --------------------------------------------- */

/**
 * Production evidence that shaped these: every /api/history 500 observed was
 * `mode: anonymous`, 12,434-28,819 ms, 67 bytes, with 100% of the duration
 * unattributed and NO errorKind — while the `mine`/`list` path reconciled
 * exactly (authMs 3,226 + dbReadMs 4,855 = 8,081, unattributed 0).
 *
 * So the wrapper was never bypassed; the anonymous branch simply had no stages
 * and never recorded its errors.
 */

function anonDeps(timing, overrides = {}) {
  return {
    timing,
    assertSupabaseConfigured: () => ({ ok: true }),
    readBearer: () => null,
    checkAnonymousRateLimit: async () => ({ ok: true }),
    readPredictionsHistoryAggregateStats: async () => ({ stats: { total: 0 } }),
    ...overrides
  };
}

test("an anonymous request records its rate-limit and database spans", async () => {
  const query = { days: "30" };
  const timing = createHistoryTiming(query);
  const res = fakeRes();
  await handleHistoryRead({ method: "GET", query }, res, anonDeps(timing));

  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 9_000 });
  assert.equal(res.statusCode, 200);
  assert.equal(typeof out.rateLimitMs, "number");
  assert.equal(typeof out.dbReadMs, "number");
  assert.equal(out.mode, "anonymous");
});

test("a slow anonymous request is attributed rather than left unexplained", () => {
  // The production shape: 100% unattributed. With stages present the remainder
  // must collapse.
  const t = createHistoryTiming({ days: "30" });
  markStage(t, "rateLimitMs", 12_000);
  markStage(t, "dbReadMs", 800);
  markStage(t, "responseMs", 1);
  const out = summarizeHistoryTiming(t, { status: 500, durationMs: 12_801 });
  assert.equal(out.unattributedMs, 0);
  assert.equal(out.rateLimitMs, 12_000);
});

test("a failing anonymous read now carries an error classification", async () => {
  const query = { days: "30" };
  const timing = createHistoryTiming(query);
  const res = fakeRes();
  await handleHistoryRead(
    { method: "GET", query },
    res,
    anonDeps(timing, {
      readPredictionsHistoryAggregateStats: async () => {
        throw new Error("canceling statement due to statement timeout");
      }
    })
  );

  assert.equal(res.statusCode, 500);
  // Production emitted these with no errorKind at all.
  assert.equal(summarizeHistoryTiming(timing, { status: 500, durationMs: 12_434 }).errorKind, "db_timeout");
});

test("a handler-returned 500 is always reported, however fast", () => {
  const t = createHistoryTiming({ days: "30" });
  markStage(t, "rateLimitMs", 5);
  const emitted = emitHistoryTiming(t, { status: 500, durationMs: 60 });
  assert.ok(emitted);
  assert.equal(emitted.status, 500);
  assert.equal(emitted.mode, "anonymous");
});

test("a rate-limited request still reports, and never reaches the database", async () => {
  const query = { days: "30" };
  const timing = createHistoryTiming(query);
  const res = fakeRes();
  let dbCalled = false;
  await handleHistoryRead(
    { method: "GET", query },
    res,
    anonDeps(timing, {
      checkAnonymousRateLimit: async () => ({ ok: false, retryAfterSec: 60 }),
      readPredictionsHistoryAggregateStats: async () => {
        dbCalled = true;
        return { stats: {} };
      }
    })
  );

  assert.equal(res.statusCode, 429);
  assert.equal(dbCalled, false);
  const out = summarizeHistoryTiming(timing, { status: 429, durationMs: 9_000 });
  assert.equal(typeof out.rateLimitMs, "number");
  assert.equal("dbReadMs" in out, false);
});

test("the anonymous response shape is unchanged by instrumentation", async () => {
  const query = { days: "30" };
  const withRes = fakeRes();
  await handleHistoryRead({ method: "GET", query }, withRes, anonDeps(createHistoryTiming(query)));
  const withoutRes = fakeRes();
  await handleHistoryRead({ method: "GET", query }, withoutRes, anonDeps(undefined));

  assert.equal(JSON.stringify(withRes.body), JSON.stringify(withoutRes.body));
  // items is empty BY DESIGN on the public scope — rows 0 is not a failure.
  assert.deepEqual(withRes.body.items, []);
  assert.equal(withRes.body.scope, "aggregate_public");
});

test("the admin global scope records its auth and database spans", async () => {
  // Reached only with a bearer that passes assertAdmin — a branch no test could
  // enter before these deps became injectable.
  const query = { days: "30" };
  const timing = createHistoryTiming(query);
  const res = fakeRes();
  await handleHistoryRead(
    { method: "GET", query },
    res,
    anonDeps(timing, {
      readBearer: () => "token",
      assertAdmin: async () => ({ ok: true }),
      readPredictionsHistory: async () => ({ items: ITEMS, stats: { total: 3 } })
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scope, "global_admin");
  const out = summarizeHistoryTiming(timing, { status: 200, durationMs: 9_000 });
  assert.equal(typeof out.authMs, "number");
  assert.equal(typeof out.dbReadMs, "number");
});

test("an anonymous failure never leaks the underlying message", async () => {
  const query = { days: "30" };
  const timing = createHistoryTiming(query);
  await handleHistoryRead(
    { method: "GET", query },
    fakeRes(),
    anonDeps(timing, {
      readPredictionsHistoryAggregateStats: async () => {
        throw new Error("postgres://user:hunter2@dbhost:5432 refused");
      }
    })
  );
  const serialized = JSON.stringify(summarizeHistoryTiming(timing, { status: 500, durationMs: 12_434 }));
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(serialized.includes("dbhost"), false);
});
