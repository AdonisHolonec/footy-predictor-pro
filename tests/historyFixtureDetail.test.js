import test from "node:test";
import assert from "node:assert/strict";

import { handleHistoryDetail, shouldServeFixtureDetail } from "../api/history.js";

/**
 * One history row, fetched by primary key.
 *
 * The list response carries raw_payload for EVERY row — ~261 KB each, measured —
 * purely so the match modal can render without a fetch, and that is where
 * /api/history spends its statement timeout. This handler is the detail source
 * that will let the list stop doing so.
 *
 * Dependencies are injected, so everything below runs against fakes: no
 * Postgres, no KV, no network — the same shape supportApi.test.js uses. What is
 * asserted is what the database cannot enforce on its own: that the lookup is a
 * single keyed read, that it never writes and never syncs, that a missing row is
 * a 404 rather than an empty 200, and that an anonymous caller gets nothing.
 */

function fakeRes() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    }
  };
}

const ROW = {
  fixture_id: 4242,
  league_name: "Liga I",
  validation: "win",
  raw_payload: { probs: { home: 0.5 }, momentum: [1, 2, 3] }
};

/**
 * Records every query the handler issues, so a test can prove it filtered on the
 * primary key and never reached for a mutating verb.
 */
function fakeSupabase(row = ROW) {
  const calls = { from: [], select: [], eq: [], mutations: [], terminators: [] };
  const builder = {
    select(cols) {
      calls.select.push(cols);
      return builder;
    },
    eq(col, val) {
      calls.eq.push([col, val]);
      return builder;
    },
    async maybeSingle() {
      calls.terminators.push("maybeSingle");
      const match = calls.eq.every(([col, val]) => col === "fixture_id" && Number(val) === row.fixture_id);
      return { data: calls.eq.length > 0 && match ? row : null, error: null };
    },
    upsert(...args) {
      calls.mutations.push(["upsert", args]);
      return builder;
    },
    update(...args) {
      calls.mutations.push(["update", args]);
      return builder;
    },
    insert(...args) {
      calls.mutations.push(["insert", args]);
      return builder;
    },
    delete(...args) {
      calls.mutations.push(["delete", args]);
      return builder;
    }
  };
  return {
    client: {
      from(table) {
        calls.from.push(table);
        return builder;
      }
    },
    calls
  };
}

const deps = (supabase, requester = { ok: true, user: { id: "u1" } }) => ({
  getRequester: async () => requester,
  getSupabaseAdmin: () => supabase,
  mapDbRowToHistoryEntry: (row) => ({
    id: row.fixture_id,
    league: row.league_name,
    validation: row.validation,
    ...row.raw_payload
  })
});

test("returns exactly the requested fixture, mapped the way the list maps it", async () => {
  const sb = fakeSupabase();
  const res = fakeRes();
  await handleHistoryDetail({ query: {} }, res, 4242, deps(sb.client));

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.scope, "fixture_detail");
  assert.equal(res.payload.item.id, 4242);
  assert.equal(res.payload.item.validation, "win");
  // The analytical payload survives untouched: this is transport, not a transform.
  assert.deepEqual(res.payload.item.probs, { home: 0.5 });
  assert.deepEqual(res.payload.item.momentum, [1, 2, 3]);
});

test("performs a single keyed lookup, not a windowed scan", async () => {
  const sb = fakeSupabase();
  await handleHistoryDetail({ query: {} }, fakeRes(), 4242, deps(sb.client));

  assert.deepEqual(sb.calls.from, ["predictions_history"], "queried a table other than predictions_history");
  // Exactly one filter, on the primary key. No kickoff_at cutoff, no range, no
  // limit — the unbounded scan is what times out on the list path.
  assert.deepEqual(sb.calls.eq, [["fixture_id", 4242]]);
  assert.deepEqual(sb.calls.terminators, ["maybeSingle"], "did not resolve to a single row");
});

test("never mutates and never syncs", async () => {
  const sb = fakeSupabase();
  const res = fakeRes();
  // A sync would have to burn provider calls; fetch is unavailable here, so any
  // attempt to reach the network fails the test loudly rather than silently.
  await handleHistoryDetail({ query: { sync: "1" } }, res, 4242, deps(sb.client));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(sb.calls.mutations, [], "the detail read issued a write");
  // sync=1 alongside fixtureId must not smuggle a sync through the detail path.
  assert.equal(res.payload.scope, "fixture_detail");
});

test("an unknown fixture is a 404, not an empty success", async () => {
  const sb = fakeSupabase();
  const res = fakeRes();
  await handleHistoryDetail({ query: {} }, res, 999999, deps(sb.client));

  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.item, undefined);
});

test("rejects a malformed fixtureId before touching auth or the database", async () => {
  for (const bad of ["abc", "-1", "0", "1.5", "", "1;drop table", "NaN", "1e999"]) {
    const sb = fakeSupabase();
    const res = fakeRes();
    let authCalled = false;
    await handleHistoryDetail({ query: {} }, res, bad, {
      ...deps(sb.client),
      getRequester: async () => {
        authCalled = true;
        return { ok: true, user: { id: "u1" } };
      }
    });
    assert.equal(res.statusCode, 400, `"${bad}" was accepted`);
    assert.equal(authCalled, false, `"${bad}" reached authorization`);
    assert.deepEqual(sb.calls.from, [], `"${bad}" reached the database`);
  }
});

test("requires a session — a history row is never public", async () => {
  const sb = fakeSupabase();
  const res = fakeRes();
  await handleHistoryDetail({ query: {} }, res, 4242, deps(sb.client, { ok: false, status: 401, error: "Neautorizat." }));

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);
  assert.deepEqual(sb.calls.from, [], "an unauthenticated caller reached the database");
});

test("surfaces a database error as a 500 instead of a fabricated empty row", async () => {
  const res = fakeRes();
  const failing = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error: { message: "canceling statement due to statement timeout" } };
        }
      };
    }
  };
  await handleHistoryDetail({ query: {} }, res, 4242, deps(failing));

  assert.equal(res.statusCode, 500);
  assert.match(String(res.payload.error), /statement timeout/);
});

/**
 * The routing rule the split depends on. The detail path is purely additive:
 * every request that does not name a fixture must reach the list query exactly
 * as it did before, so these cases are the guard against silently diverting
 * list traffic onto a single-row lookup.
 */
test("routes only requests that actually name a fixture", () => {
  assert.equal(shouldServeFixtureDetail({ fixtureId: "4242" }), true);
  assert.equal(shouldServeFixtureDetail({ fixtureId: 4242 }), true);
  // Invalid, but still a detail request — it must 400, not silently list.
  assert.equal(shouldServeFixtureDetail({ fixtureId: "abc" }), true);
});

test("leaves every existing list request on the list path", () => {
  // The shapes the app and the cron actually send today.
  assert.equal(shouldServeFixtureDetail({}), false);
  assert.equal(shouldServeFixtureDetail({ days: "30", limit: "500" }), false);
  assert.equal(shouldServeFixtureDetail({ mine: "1" }), false);
  assert.equal(shouldServeFixtureDetail({ sync: "1" }), false);
  // Blank or whitespace-only is not a fixture request; it must not become a 400
  // for a caller that simply passed an empty field.
  assert.equal(shouldServeFixtureDetail({ fixtureId: "" }), false);
  assert.equal(shouldServeFixtureDetail({ fixtureId: "   " }), false);
  assert.equal(shouldServeFixtureDetail({ fixtureId: undefined }), false);
  assert.equal(shouldServeFixtureDetail({ fixtureId: null }), false);
  assert.equal(shouldServeFixtureDetail(undefined), false);
});
