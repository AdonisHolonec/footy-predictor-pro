import assert from "node:assert/strict";
import { test } from "node:test";
import { selectTopPickAndQuote } from "../../../server-utils/pipeline/decision/selectTopPickAndQuote.js";

// Side markets pinned at their MARKET_BASELINES value (zero lift, low score) so the
// 1X2/GG candidate under test is unambiguously the highest-scoring pick.
const flatMarkets = { pO15: 75, pO25: 53, pU35: 70, pGG: 52 };

test("selectTopPickAndQuote resolves a side-market pick (Peste 2.5) from the matching quote", () => {
  const out = selectTopPickAndQuote({
    marketProbsAligned: { pO15: 90, pO25: 85, pU35: 60, pGG: 55 },
    p1Adj: 20,
    pXAdj: 20,
    p2Adj: 20,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    odds: null,
    bttsQuote: null,
    goals15Quote: { over: 1.3, under: 3.2, bookmakersUsed: 4 },
    goals25Quote: { over: 1.85, under: 1.95, bookmakersUsed: 4 },
    goals35Quote: { over: 3.1, under: 1.35, bookmakersUsed: 4 }
  });
  assert.equal(out.topPick, "Peste 2.5");
  assert.equal(out.recommendedQuote.odd, 1.85);
  assert.equal(out.recommendedQuote.source, "median(4)");
});

test("selectTopPickAndQuote resolves a 1X2 pick from odds.home/draw/away", () => {
  const out = selectTopPickAndQuote({
    marketProbsAligned: flatMarkets,
    p1Adj: 70,
    pXAdj: 15,
    p2Adj: 15,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    odds: { home: 2.1, draw: 3.2, away: 3.6, bookmakersUsed: 6 },
    bttsQuote: null,
    goals15Quote: null,
    goals25Quote: null,
    goals35Quote: null
  });
  assert.equal(out.topPick, "1");
  assert.equal(out.recommendedQuote.odd, 2.1);
  assert.equal(out.recommendedQuote.source, "median(6)");
  assert.equal(out.maxConf, out.topSelection.prob);
});

test("selectTopPickAndQuote resolves a GG/NGG pick from bttsQuote.yes/no", () => {
  const out = selectTopPickAndQuote({
    marketProbsAligned: { pO15: 75, pO25: 53, pU35: 70, pGG: 80 },
    p1Adj: 20,
    pXAdj: 20,
    p2Adj: 20,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    odds: null,
    bttsQuote: { yes: 1.75, no: 2.05, bookmakersUsed: 3 },
    goals15Quote: null,
    goals25Quote: null,
    goals35Quote: null
  });
  assert.equal(out.topPick, "GG");
  assert.equal(out.recommendedQuote.odd, 1.75);
  assert.equal(out.recommendedQuote.source, "median(3)");
});

test("selectTopPickAndQuote returns a null quote when no matching odds are available", () => {
  const out = selectTopPickAndQuote({
    marketProbsAligned: flatMarkets,
    p1Adj: 10,
    pXAdj: 60,
    p2Adj: 30,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    odds: null,
    bttsQuote: null,
    goals15Quote: null,
    goals25Quote: null,
    goals35Quote: null
  });
  assert.equal(out.topPick, "X");
  assert.deepEqual(out.recommendedQuote, { odd: null, source: null, bookmakersUsed: 0 });
});

test("selectTopPickAndQuote clamps maxConf by leagueMultiplier and qualityPenalty", () => {
  const out = selectTopPickAndQuote({
    marketProbsAligned: flatMarkets,
    p1Adj: 70,
    pXAdj: 15,
    p2Adj: 15,
    leagueMultiplier: 0.9,
    qualityPenalty: 0.8,
    odds: null,
    bttsQuote: null,
    goals15Quote: null,
    goals25Quote: null,
    goals35Quote: null
  });
  assert.ok(Math.abs(out.maxConf - out.topSelection.prob * 0.9 * 0.8) < 1e-9);
});
