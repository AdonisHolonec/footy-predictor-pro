import test from "node:test";
import assert from "node:assert/strict";

import { handleHistoryRead } from "../api/history.js";

/**
 * Which reader a `mine=1` query actually reaches.
 *
 * Three projections share one branch, and confusing them is not a cosmetic bug:
 *
 *   view=list             History list, columns only, no raw_payload at all
 *   view=prediction-list  the prediction board (P3-B)
 *   no view               FULL - historyService.loadHistory still reads this for
 *                         the guest and admin observatory surfaces
 *
 * Asserting the predicates alone is not enough. A mutation that deleted the
 * prediction-list branch from the handler while leaving shouldServePredictionList
 * intact SURVIVED the projection and predicate suites - every request silently
 * fell back to FULL and nothing failed. This file exists because of that
 * mutation: it drives the real handler and records which reader ran.
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

/** Runs the handler and reports which of the three readers was called. */
async function route(query, { authorized = true } = {}) {
  const called = [];
  const reader = (name) => async () => {
    called.push(name);
    return { items: [{ id: 1, tag: name }], stats: { wins: 0, losses: 0, settled: 0, winRate: 0 } };
  };
  const res = fakeRes();
  await handleHistoryRead({ method: "GET", query }, res, {
    assertSupabaseConfigured: () => ({ ok: true }),
    getRequester: async () =>
      authorized ? { ok: true, user: { id: "user-1" } } : { ok: false, status: 401, error: "Neautorizat." },
    readPredictionsHistoryListForUser: reader("list"),
    readPredictionsForHydration: reader("prediction-list"),
    readPredictionsHistoryForUser: reader("full")
  });
  return { called, res };
}

const MINE = { days: "3", limit: "300", mine: "1" };

test("view=prediction-list reaches the prediction-board reader", async () => {
  const { called, res } = await route({ ...MINE, view: "prediction-list" });
  assert.deepEqual(called, ["prediction-list"]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.mine, true);
  assert.equal(res.payload.items[0].tag, "prediction-list");
});

test("no view stays FULL - historyService.loadHistory depends on it", async () => {
  const { called } = await route({ days: "30", limit: "2000", mine: "1" });
  assert.deepEqual(called, ["full"]);
});

test("view=list still reaches the History list reader", async () => {
  const { called } = await route({ days: "30", limit: "2000", mine: "1", view: "list" });
  assert.deepEqual(called, ["list"]);
});

test("an unknown view falls back to FULL rather than guessing", async () => {
  for (const view of ["", "special-bets", "Prediction-List", "predictions", "prediction-list-x"]) {
    const { called } = await route({ ...MINE, view });
    assert.deepEqual(called, ["full"], `view="${view}" did not fall back to FULL`);
  }
});

test("each projection is reached exactly once per request", async () => {
  const { called } = await route({ ...MINE, view: "prediction-list" });
  assert.equal(called.length, 1);
});

test("an unauthorized caller reaches no reader at all", async () => {
  const { called, res } = await route({ ...MINE, view: "prediction-list" }, { authorized: false });
  assert.deepEqual(called, []);
  assert.equal(res.statusCode, 401);
});

test("the response envelope is identical across projections", async () => {
  const keysFor = async (view) => {
    const { res } = await route(view ? { ...MINE, view } : MINE);
    return Object.keys(res.payload).sort();
  };
  const full = await keysFor(null);
  assert.deepEqual(await keysFor("prediction-list"), full);
  assert.deepEqual(await keysFor("list"), full);
});
