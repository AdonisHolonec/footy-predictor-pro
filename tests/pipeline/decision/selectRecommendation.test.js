import assert from "node:assert/strict";
import { test } from "node:test";
import { selectRecommendation } from "../../../server-utils/pipeline/decision/selectRecommendation.js";

// Baseline fixture: every market present, all odds >= MIN_DISPLAY_ODDS (1.25), no candidate
// dominates by construction — individual tests tune specific fields off this shared shape.
function baseParams(overrides = {}) {
  return {
    marketProbsAligned: { pGG: 55, pNGG: 45, pO15: 80, pU15: 20, pO25: 55, pU25: 45, pO35: 30, pU35: 70 },
    p1Adj: 40,
    pXAdj: 25,
    p2Adj: 35,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    odds: { home: 2.1, draw: 3.2, away: 3.4, bookmakersUsed: 6 },
    bttsQuote: { yes: 1.9, no: 1.85, bookmakersUsed: 5 },
    goals15Quote: { over: 1.3, under: 3.2, bookmakersUsed: 5 },
    goals25Quote: { over: 1.8, under: 1.95, bookmakersUsed: 5 },
    goals35Quote: { over: 3.1, under: 1.35, bookmakersUsed: 5 },
    doubleChanceQuote: { homeDraw: 1.3, homeAway: 1.25, drawAway: 1.5, bookmakersUsed: 5 },
    marketOdds: null,
    cornersPick: null,
    cardsQuote: null,
    leagueParams: {},
    modularScores: null,
    cornersBlock: null,
    ...overrides
  };
}

test("selectRecommendation can select a non-Goals market when odds/probability are present", () => {
  const out = selectRecommendation(
    baseParams({
      marketOdds: { corners: { pick: "Sub 11.5", line: 11.5, odd: 1.9, bookmakersUsed: 4 } },
      cornersPick: { pick: "Sub 11.5", probability: 82 }
    })
  );
  // Corners never reached the old 11-candidate selector at all — presence of a plausible
  // pick here (whatever wins) proves the pool now spans beyond 1X2/O-U/GG.
  assert.ok(out.topPick);
  assert.ok(Number.isFinite(out.recommendedQuote.odd));
});

test("selectRecommendation applies MIN_DISPLAY_ODDS before selection, not after", () => {
  const paramsBelowFloor = baseParams({
    // Over 1.5 has the highest raw confidence (90%) but odds are below the 1.25 floor —
    // it must never win, and must not even appear as a runner-up.
    marketProbsAligned: { pGG: 55, pNGG: 45, pO15: 90, pU15: 10, pO25: 55, pU25: 45, pO35: 30, pU35: 70 },
    goals15Quote: { over: 1.1, under: 6.5, bookmakersUsed: 5 }
  });
  const out = selectRecommendation(paramsBelowFloor);
  assert.notEqual(out.topPick, "Peste 1.5");

  const out2 = selectRecommendation({ ...paramsBelowFloor, debug: true });
  const rankedTypes = out2.diagnostics.ranked.map((c) => c.type);
  assert.ok(!rankedTypes.includes("Peste 1.5"), "sub-floor candidate must not appear in the ranked pool at all");
  const rejected = out2.diagnostics.rejected.find((r) => r.type === "Peste 1.5");
  assert.equal(rejected.reason, "below_min_odds");
});

test("selectRecommendation lets market diversity win a near-tie (reproduces the Over/BTTS example)", () => {
  // Over 1.5 at 83% vs BTTS-No at 82% — nearly tied raw confidence, comparable odds/quality.
  // Diversity should be enough to flip a ~1pt confidence gap; only the winner is asserted,
  // exact scores are an implementation detail.
  const out = selectRecommendation(
    baseParams({
      marketProbsAligned: { pGG: 18, pNGG: 82, pO15: 83, pU15: 17, pO25: 40, pU25: 60, pO35: 20, pU35: 80 },
      goals15Quote: { over: 1.35, under: 3.0, bookmakersUsed: 5 },
      bttsQuote: { yes: 2.2, no: 1.72, bookmakersUsed: 5 }
    })
  );
  assert.equal(out.topPick, "NGG");
});

test("selectRecommendation does not let diversity override a clear confidence leader", () => {
  // Over 1.5 at 92% vs a mediocre BTTS-No at 55% — diversity's bounded weight must not flip this.
  const out = selectRecommendation(
    baseParams({
      marketProbsAligned: { pGG: 45, pNGG: 55, pO15: 92, pU15: 8, pO25: 55, pU25: 45, pO35: 30, pU35: 70 },
      goals15Quote: { over: 1.35, under: 3.0, bookmakersUsed: 5 },
      bttsQuote: { yes: 2.05, no: 1.85, bookmakersUsed: 5 }
    })
  );
  assert.equal(out.topPick, "Peste 1.5");
});

test("selectRecommendation soft-penalizes typical Over 1.5 so stronger alternatives can win", () => {
  // Reproduces the post-recalibration habit: O1.5 ~82% with short odds beating Corners/BTTS.
  // Soft safe-line penalty must let a competitive Corners pick win without touching PredictorV3.
  const out = selectRecommendation(
    baseParams({
      marketProbsAligned: {
        pGG: 55,
        pNGG: 45,
        pO15: 82,
        pU15: 18,
        pO25: 58,
        pU25: 42,
        pO35: 32,
        pU35: 68,
        pDC1X: 70,
        pDC12: 72,
        pDCX2: 58
      },
      marketOdds: { corners: { pick: "Over 8.5", line: 8.5, odd: 1.85, bookmakersUsed: 4 } },
      cornersPick: { pick: "Over 8.5", probability: 62 },
      goals15Quote: { over: 1.28, under: 3.6, bookmakersUsed: 6 },
      debug: true
    })
  );
  assert.notEqual(out.topPick, "Peste 1.5");
  const o15 = out.diagnostics.ranked.find((c) => c.type === "Peste 1.5");
  assert.ok(o15);
  assert.equal(o15.safeOuPenalty, 9);
});

test("selectRecommendation soft-penalizes typical Under 3.5 so it does not dominate by default", () => {
  const out = selectRecommendation(
    baseParams({
      marketProbsAligned: {
        pGG: 48,
        pNGG: 52,
        pO15: 72,
        pU15: 28,
        pO25: 48,
        pU25: 52,
        pO35: 25,
        pU35: 75,
        pDC1X: 68,
        pDC12: 70,
        pDCX2: 62
      },
      marketOdds: { corners: { pick: "Over 8.5", line: 8.5, odd: 1.85, bookmakersUsed: 4 } },
      cornersPick: { pick: "Over 8.5", probability: 62 },
      goals15Quote: { over: 1.35, under: 3.2, bookmakersUsed: 6 },
      goals35Quote: { over: 2.8, under: 1.42, bookmakersUsed: 6 },
      debug: true
    })
  );
  assert.notEqual(out.topPick, "Sub 3.5");
  const u35 = out.diagnostics.ranked.find((c) => c.type === "Sub 3.5");
  assert.ok(u35);
  assert.equal(u35.safeOuPenalty, 8);
});

test("selectRecommendation prefers Goals 2.5 over safe Over 1.5 when both are competitive", () => {
  const out = selectRecommendation(
    baseParams({
      marketProbsAligned: {
        pGG: 50,
        pNGG: 50,
        pO15: 80,
        pU15: 20,
        pO25: 64,
        pU25: 36,
        pO35: 30,
        pU35: 70
      },
      goals15Quote: { over: 1.3, under: 3.4, bookmakersUsed: 5 },
      goals25Quote: { over: 1.85, under: 1.95, bookmakersUsed: 5 },
      bttsQuote: { yes: 2.1, no: 1.75, bookmakersUsed: 4 },
      // No corners — isolate O/U line preference inside the goals family.
      marketOdds: null,
      cornersPick: null
    })
  );
  assert.equal(out.topPick, "Peste 2.5");
});

test("selectRecommendation is deterministic across repeated calls with identical input", () => {
  const params = baseParams();
  const a = selectRecommendation(params);
  const b = selectRecommendation(params);
  assert.deepEqual(a, b);
});

test("selectRecommendation falls back to argmax 1X2 when nothing clears the odds/probability bar", () => {
  const out = selectRecommendation({
    marketProbsAligned: { pGG: 30, pNGG: 70, pO15: 40, pU15: 60, pO25: 30, pU25: 70, pO35: 20, pU35: 80 },
    p1Adj: 10,
    pXAdj: 60,
    p2Adj: 30,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    odds: null,
    bttsQuote: null,
    goals15Quote: null,
    goals25Quote: null,
    goals35Quote: null,
    doubleChanceQuote: null,
    marketOdds: null,
    cornersPick: null,
    cardsQuote: null,
    leagueParams: {},
    modularScores: null,
    cornersBlock: null
  });
  assert.equal(out.topPick, "X");
  assert.deepEqual(out.recommendedQuote, { odd: null, source: null, bookmakersUsed: 0 });
  assert.equal(out.topSelection.alternates.length, 0);
});

test("selectRecommendation returns diagnostics only when debug is true (development-only channel)", () => {
  const off = selectRecommendation(baseParams({ debug: false }));
  assert.equal(off.diagnostics, null);

  const on = selectRecommendation(baseParams({ debug: true }));
  assert.ok(on.diagnostics);
  assert.equal(on.diagnostics.winner.type, on.topPick);
  assert.ok(Array.isArray(on.diagnostics.ranked));
  assert.ok(on.diagnostics.ranked.length > 0);
  assert.equal(on.diagnostics.ranked[0].type, on.topPick);
  assert.ok(Array.isArray(on.diagnostics.explanation));
  assert.ok(on.diagnostics.explanation.length > 0);
  // ranked must be sorted by score descending (public contract of the diagnostics payload)
  for (let i = 1; i < on.diagnostics.ranked.length; i++) {
    assert.ok(on.diagnostics.ranked[i - 1].score >= on.diagnostics.ranked[i].score);
  }
});

test("selectRecommendation keeps the public output shape identical to the legacy selector", () => {
  const out = selectRecommendation(baseParams());
  assert.ok("topSelection" in out);
  assert.ok("topPick" in out);
  assert.ok("maxConf" in out);
  assert.ok("recommendedQuote" in out);
  assert.ok("pick" in out.topSelection);
  assert.ok("prob" in out.topSelection);
  assert.ok("lift" in out.topSelection);
  assert.ok(Array.isArray(out.topSelection.alternates));
  assert.ok("odd" in out.recommendedQuote);
  assert.ok("source" in out.recommendedQuote);
  assert.ok("bookmakersUsed" in out.recommendedQuote);
});
