import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCorrectScoreOddsWithFallback } from "../../../server-utils/pipeline/decision/resolveCorrectScoreOdds.js";

function batchOddsReqWith(betName, value, odd) {
  return {
    ok: true,
    fromBatch: true,
    data: {
      response: [
        {
          bookmakers: [
            { name: "BetA", bets: [{ name: betName, values: [{ value, odd }] }] }
          ]
        }
      ]
    }
  };
}

function fixtureOddsReqWith(betName, value, odd) {
  return {
    ok: true,
    data: {
      response: [
        {
          bookmakers: [
            { name: "10Bet", bets: [{ name: betName, values: [{ value, odd }] }] }
          ]
        }
      ]
    }
  };
}

test("PASS: batch already has Correct Score -> no extra fetch performed", async () => {
  const oddsReq = batchOddsReqWith("Correct Score", "1-0", "7.00");
  let calls = 0;
  const fetchFixtureOdds = async () => {
    calls += 1;
    return fixtureOddsReqWith("Exact Score", "1:0", "6.25");
  };
  const out = await resolveCorrectScoreOddsWithFallback(oddsReq, 123, { fetchFixtureOdds });
  assert.ok(out);
  assert.equal(out.scores["1-0"], 7.0);
  assert.equal(calls, 0, "must not call the fallback fetch when batch already has Correct Score");
});

test("PASS: batch missing Correct Score (fromBatch=true) -> fixture fetch executed exactly once", async () => {
  const oddsReq = batchOddsReqWith("Match Winner", "Home", "2.10"); // no Correct Score/Exact Score bet in batch
  let calls = 0;
  const fetchFixtureOdds = async (fixtureId, batchMap, ttlSeconds) => {
    calls += 1;
    assert.equal(fixtureId, 999);
    assert.equal(batchMap, null, "must force the per-fixture endpoint, not reuse the batch map");
    assert.equal(ttlSeconds, 86400);
    return fixtureOddsReqWith("Exact Score", "2:1", "8.50");
  };
  const out = await resolveCorrectScoreOddsWithFallback(oddsReq, 999, { fetchFixtureOdds });
  assert.ok(out);
  assert.equal(calls, 1);
});

test("PASS: fixture fetch returns Correct Score -> candidates generated (scores populated)", async () => {
  const oddsReq = batchOddsReqWith("Match Winner", "Home", "2.10");
  const fetchFixtureOdds = async () => fixtureOddsReqWith("Exact Score", "3:1", "13.00");
  const out = await resolveCorrectScoreOddsWithFallback(oddsReq, 1, { fetchFixtureOdds });
  assert.ok(out);
  assert.equal(out.scores["3-1"], 13.0);
  assert.equal(out.bookmakersUsed, 1);
});

test("PASS: fixture fetch also missing Correct Score -> old behavior preserved (null, no crash)", async () => {
  const oddsReq = batchOddsReqWith("Match Winner", "Home", "2.10");
  let calls = 0;
  const fetchFixtureOdds = async () => {
    calls += 1;
    return fixtureOddsReqWith("Match Winner", "Home", "2.10"); // still no Correct Score/Exact Score
  };
  const out = await resolveCorrectScoreOddsWithFallback(oddsReq, 1, { fetchFixtureOdds });
  assert.equal(out, null);
  assert.equal(calls, 1, "fallback is attempted exactly once, no retries");
});

test("PASS: fixture fetch fails outright (ok:false) -> resolves to null without throwing", async () => {
  const oddsReq = batchOddsReqWith("Match Winner", "Home", "2.10");
  const fetchFixtureOdds = async () => ({ ok: false });
  const out = await resolveCorrectScoreOddsWithFallback(oddsReq, 1, { fetchFixtureOdds });
  assert.equal(out, null);
});

test("PASS: oddsReq did not come from batch (fromBatch=false) -> no fallback attempted, other markets unaffected", async () => {
  const oddsReq = { ok: true, fromBatch: false, data: { response: [{ bookmakers: [] }] } };
  let calls = 0;
  const fetchFixtureOdds = async () => {
    calls += 1;
    return fixtureOddsReqWith("Exact Score", "1:0", "6.25");
  };
  const out = await resolveCorrectScoreOddsWithFallback(oddsReq, 1, { fetchFixtureOdds });
  assert.equal(out, null);
  assert.equal(calls, 0, "must never fetch again when the original request already used the per-fixture endpoint");
});

test("PASS: null/undefined oddsReq does not throw", async () => {
  let calls = 0;
  const fetchFixtureOdds = async () => {
    calls += 1;
    return fixtureOddsReqWith("Exact Score", "1:0", "6.25");
  };
  assert.equal(await resolveCorrectScoreOddsWithFallback(null, 1, { fetchFixtureOdds }), null);
  assert.equal(await resolveCorrectScoreOddsWithFallback(undefined, 1, { fetchFixtureOdds }), null);
  assert.equal(calls, 0);
});

test("PASS: no injected fetchFixtureOdds -> defaults to the real getOddsForFixture without throwing on import", async () => {
  // Sanity check that the default parameter wiring itself doesn't crash — does not
  // perform a real network call because fromBatch is false here.
  const oddsReq = { ok: true, fromBatch: false, data: { response: [{ bookmakers: [] }] } };
  const out = await resolveCorrectScoreOddsWithFallback(oddsReq, 1);
  assert.equal(out, null);
});
