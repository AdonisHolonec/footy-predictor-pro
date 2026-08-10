import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCanonicalPrediction } from "../server-utils/predictionsHistory.js";

/**
 * Regression guard for the Admin/Mobile Special Bet divergence (2026-08-09).
 *
 * The same fixture rendered two different accumulators — Admin "Shots Under 10.5"
 * at 2.87, Mobile "Shots Over 6.5" at 1.53 — because each surface held a different
 * run of the pipeline. The Special Bet builder is deterministic; its INPUT was not.
 *
 * `isPreKickoff` already freezes the persisted row at kickoff, so a canonical
 * prediction exists. These tests pin the rule that makes every surface read it:
 * the frozen prediction is the base, the live row contributes only the result.
 */

/** The prediction of record, written before kickoff: no score, no result. */
function canonicalPayload() {
  return {
    id: 42,
    status: "NS",
    kickoff: "2026-08-09T18:00:00.000Z",
    recommended: { pick: "12", family: "DoubleChance", confidence: 72 },
    probs: { pO15: 80, shotsOnTarget: { total: { o10_5: 17 } } },
    marketOdds: { shotsOnTarget: { line: 10.5, pick: "Under 10.5", over: 1.4, under: 2.87 } },
    confidenceEngine: { base: 70, liveAdjustment: null },
    historyMeta: { generatedAt: "2026-08-09T12:00:00.000Z", schemaVersion: 2 }
  };
}

/** The same fixture re-predicted after kickoff — never persisted, odds have moved. */
function freshPayload() {
  return {
    id: 42,
    status: "FT",
    kickoff: "2026-08-09T18:00:00.000Z",
    score: { home: 0, away: 1 },
    marketResults: { cornersTotal: 9, shotsOnTargetTotal: 7 },
    recommended: { pick: "12", family: "DoubleChance", confidence: 71 },
    probs: { pO15: 79, shotsOnTarget: { total: { o10_5: 16 } } },
    marketOdds: { shotsOnTarget: { line: 6.5, pick: "Over 6.5", over: 1.53, under: 2.3 } },
    confidenceEngine: { base: 69, liveAdjustment: { delta: -3, reason: "contradicted" } },
    cardMarketValidations: { recommended: "loss", goals: "loss", corners: null, shots: null }
  };
}

test("the frozen prediction wins over a later re-computation", () => {
  const merged = mergeCanonicalPrediction(freshPayload(), canonicalPayload());

  // The exact divergence that was reported: the shots quote decides which line
  // deriveAlignedOuPick snaps to, so it must come from the prediction of record.
  assert.equal(merged.marketOdds.shotsOnTarget.line, 10.5);
  assert.equal(merged.marketOdds.shotsOnTarget.pick, "Under 10.5");
  assert.equal(merged.recommended.confidence, 72);
  assert.equal(merged.probs.pO15, 80);
  assert.equal(merged.historyMeta.generatedAt, "2026-08-09T12:00:00.000Z");
});

test("the live result still comes from the fresh row", () => {
  const merged = mergeCanonicalPrediction(freshPayload(), canonicalPayload());

  // The canonical row was frozen before kickoff and knows nothing about the match.
  assert.equal(merged.status, "FT");
  assert.deepEqual(merged.score, { home: 0, away: 1 });
  assert.equal(merged.marketResults.shotsOnTargetTotal, 7);
  assert.equal(merged.marketResults.cornersTotal, 9);
  assert.equal(merged.cardMarketValidations.recommended, "loss");
});

test("the live momentum nudge survives, the engine around it does not", () => {
  const merged = mergeCanonicalPrediction(freshPayload(), canonicalPayload());

  assert.equal(merged.confidenceEngine.base, 70);
  assert.deepEqual(merged.confidenceEngine.liveAdjustment, { delta: -3, reason: "contradicted" });
});

test("two surfaces holding different runs converge on the same payload", () => {
  // Admin's run and Mobile's run differ; merged against one canonical row they
  // must become indistinguishable apart from the result fields they agree on.
  const adminRun = freshPayload();
  const mobileRun = {
    ...freshPayload(),
    recommended: { pick: "12", family: "DoubleChance", confidence: 68 },
    marketOdds: { shotsOnTarget: { line: 8.5, pick: "Over 8.5", over: 1.9, under: 1.9 } },
    probs: { pO15: 75, shotsOnTarget: { total: { o10_5: 30 } } }
  };

  const a = mergeCanonicalPrediction(adminRun, canonicalPayload());
  const b = mergeCanonicalPrediction(mobileRun, canonicalPayload());

  assert.deepEqual(a.marketOdds, b.marketOdds);
  assert.deepEqual(a.probs, b.probs);
  assert.deepEqual(a.recommended, b.recommended);
});

test("a missing canonical row leaves the fresh prediction untouched", () => {
  const fresh = freshPayload();
  assert.deepEqual(mergeCanonicalPrediction(fresh, null), fresh);
  assert.deepEqual(mergeCanonicalPrediction(fresh, undefined), fresh);
});

test("a live field the fresh row does not carry falls back to the canonical one", () => {
  const fresh = { ...freshPayload() };
  delete fresh.marketResults;
  const canonical = { ...canonicalPayload(), marketResults: { cornersTotal: 3 } };

  assert.deepEqual(mergeCanonicalPrediction(fresh, canonical).marketResults, { cornersTotal: 3 });
});
