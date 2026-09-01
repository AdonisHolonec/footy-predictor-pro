import test from "node:test";
import assert from "node:assert/strict";

import { handleHistoryRead } from "../api/history.js";

/**
 * The ADMIN-GLOBAL and ANONYMOUS branches of the `view=list` cutover.
 *
 * predictionListRouting.test.js drives the `mine=1` branch only. The reader that
 * actually served the 60,406,830-byte production response was neither of the
 * ones it covers: `historyService.loadHistory` omits `mine` for an admin, so the
 * request fell through to the global branch and `readPredictionsHistory`, whose
 * select is a bare `*`. That branch had no routing test at all, which is why the
 * full-document read survived every projection suite in the repository.
 *
 * These tests pin the two things the cutover depends on:
 *   1. an admin asking for `view=list` reaches the COLUMN-ONLY global reader
 *   2. the SERVER default is unchanged - no view still reaches the full reader,
 *      because the by-fixture detail route and prediction hydration still need it
 *
 * and the one thing it deliberately does NOT change: the anonymous branch, which
 * serves aggregate stats regardless of `view`.
 */

function fakeRes() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
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

/**
 * Drives the real handler down the NON-`mine` path and reports which reader ran.
 *
 * `isAdmin` decides whether assertAdmin succeeds, which is what separates the
 * global-admin branch from the anonymous one.
 */
async function routeGlobal(query, { isAdmin = true } = {}) {
  const called = [];
  const reader = (name) => async () => {
    called.push(name);
    return { items: [{ id: 1, tag: name }], stats: { wins: 1, losses: 0, settled: 1, winRate: 100 } };
  };
  const res = fakeRes();
  await handleHistoryRead({ method: "GET", query }, res, {
    assertSupabaseConfigured: () => ({ ok: true }),
    readBearer: () => "token",
    assertAdmin: async () =>
      isAdmin ? { ok: true, user: { id: "admin-1" } } : { ok: false, status: 403, error: "Nu esti admin." },
    checkAnonymousRateLimit: async () => ({ ok: true }),
    readPredictionsHistoryList: reader("global-list"),
    readPredictionsHistory: reader("global-full"),
    readPredictionsHistoryAggregateStats: async () => {
      called.push("aggregate");
      return { stats: { wins: 0, losses: 0, settled: 0, winRate: 0 } };
    }
  });
  return { called, res };
}

const GLOBAL = { days: "7", limit: "2000" };

test("an admin asking for view=list reaches the column-only global reader", async () => {
  const { called, res } = await routeGlobal({ ...GLOBAL, view: "list" });
  assert.deepEqual(called, ["global-list"]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.scope, "global_admin");
  assert.equal(res.payload.items[0].tag, "global-list");
});

test("the server default is unchanged - an admin with no view still reaches FULL", async () => {
  const { called } = await routeGlobal(GLOBAL);
  assert.deepEqual(called, ["global-full"]);
});

test("only the exact token `list` opts the global branch in", async () => {
  for (const view of ["", "List", "lists", "prediction-list", "special"]) {
    const { called } = await routeGlobal({ ...GLOBAL, view });
    assert.deepEqual(called, ["global-full"], `view="${view}" narrowed the global read`);
  }
});

test("view=list does not change the anonymous branch, which serves aggregates only", async () => {
  const withView = await routeGlobal({ ...GLOBAL, view: "list" }, { isAdmin: false });
  const withoutView = await routeGlobal(GLOBAL, { isAdmin: false });
  assert.deepEqual(withView.called, ["aggregate"]);
  assert.deepEqual(withoutView.called, ["aggregate"]);
  // Documented consequence: the cutover cannot fix the anonymous db_timeout,
  // because that reader never selected raw_payload in the first place.
  assert.deepEqual(withView.res.payload.items, []);
  assert.equal(withView.res.payload.scope, "aggregate_public");
});

test("the global response envelope is identical with and without the list view", async () => {
  const keys = async (view) => {
    const { res } = await routeGlobal(view ? { ...GLOBAL, view } : GLOBAL);
    return Object.keys(res.payload).sort();
  };
  assert.deepEqual(await keys("list"), await keys(null));
});
