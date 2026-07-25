/**
 * Sprint 4.5 — Validation Accuracy Fixes & Production Observability.
 *
 * Report-only: never writes predictions, never touches prediction/decision-layer
 * code, never changes API output, never flips any feature flag. Reuses
 * Sprint3MarketValidation.js's evaluators directly — no scoring math is
 * re-implemented here. Adds two things Sprint 4's manual investigation proved were
 * missing from the tooling: (1) a deploy-timestamp split so "before this feature
 * existed" rows can be reported separately from genuine before/after evidence, and
 * (2) a single "Feature Validation Status" summary in the exact per-feature shape
 * requested for this sprint.
 */

import {
  evaluateCardsMarket,
  evaluateCleanSheetMarket,
  evaluateMotivationMarket,
  evaluateCorrectScoreMarket,
  MIN_SAMPLE
} from "./Sprint3MarketValidation.js";

export { MIN_SAMPLE };

/**
 * Best-known Sprint 1 feature deployment timestamp: commit e40b9b00's author date
 * (2026-07-24T16:00:50+03:00 -> UTC below). This is a report-only annotation, not
 * derived from any schema column — no migration was added (Task 2: "Nu modifica
 * schema"). Update this constant if a more precise deploy timestamp becomes
 * available (e.g. a Vercel deployment log timestamp).
 */
export const SPRINT1_DEPLOY_AT = "2026-07-24T13:00:50.000Z";

function isSettled(row) {
  return (
    row?.score_home != null &&
    row?.score_away != null &&
    Number.isFinite(Number(row.score_home)) &&
    Number.isFinite(Number(row.score_away))
  );
}

/**
 * Splits settled rows into before/after a deploy timestamp using saved_at (when the
 * prediction was actually generated) — not kickoff_at, which is about the match, not
 * which code ran. Rows without a usable saved_at are conservatively bucketed
 * "before" (can't prove they ran the new code).
 */
export function splitByDeployTimestamp(rows, deployedAtIso = SPRINT1_DEPLOY_AT) {
  const deployedAtMs = new Date(deployedAtIso).getTime();
  const before = [];
  const after = [];
  for (const row of rows || []) {
    const savedAtMs = new Date(row?.saved_at || NaN).getTime();
    if (Number.isFinite(savedAtMs) && savedAtMs >= deployedAtMs) after.push(row);
    else before.push(row);
  }
  return { before, after, deployedAtIso, beforeCount: before.length, afterCount: after.length };
}

/**
 * Full Sprint 4.5 "Feature Validation Status" — one structured entry per Sprint 1
 * feature, matching the fields the printer below renders.
 */
export function buildSprint4ValidationStatus(rows, opts = {}) {
  const minSample = Number(opts.minSample) || MIN_SAMPLE;
  const settled = (rows || []).filter(isSettled);
  const deploySplit = splitByDeployTimestamp(settled, opts.deployedAtIso);

  const cleanSheet = evaluateCleanSheetMarket(settled, { minSample });
  const correctScore = evaluateCorrectScoreMarket(settled, { minSample });
  const motivation = evaluateMotivationMarket(settled, { minSample });
  const cards = evaluateCardsMarket(settled, { minSample });

  return {
    schemaVersion: "sprint4-validation-status-v1",
    generatedAt: new Date().toISOString(),
    totalRowsAnalyzed: settled.length,
    deployment: {
      deployedAtIso: deploySplit.deployedAtIso,
      beforeFeatureDeployCount: deploySplit.beforeCount,
      afterFeatureDeployCount: deploySplit.afterCount,
      note:
        "Best-known Sprint 1 deploy timestamp (commit e40b9b00 author date). Bucketed by " +
        "row.saved_at, not kickoff_at. Report-only — no schema change, no migration."
    },
    features: {
      cleanSheet: {
        feature: "Clean Sheet / BTTS",
        // No feature flag exists for this blend (alignMarketProbsAndCalibrate.js applies it
        // unconditionally whenever clean-sheet/failed-to-score rates are available) — always
        // "ACTIVE" in the running code, independent of how much real evidence exists yet.
        runtime: "ACTIVE",
        historicalSample: cleanSheet.featureAvailableCount,
        appliedSample: cleanSheet.featureAppliedCount,
        skipped: cleanSheet.skippedCount,
        brierBefore: cleanSheet.baseline.brier,
        brierAfter: cleanSheet.enhanced.brier,
        improvementPct: cleanSheet.improvementPct,
        degradedCases: cleanSheet.degradedCases,
        verdict: cleanSheet.verdict
      },
      correctScore: {
        feature: "Correct Score Value Engine",
        engine: correctScore.engineStatus.active ? "ACTIVE" : "NOT DETECTED",
        odds: correctScore.engineStatus.oddsAvailableCount > 0 ? "AVAILABLE" : "MISSING",
        sample: correctScore.sampleCount,
        top1AccuracyPct: correctScore.top1AccuracyPct,
        top3AccuracyPct: correctScore.top3AccuracyPct,
        roiPct: correctScore.roiSimulation?.roiPct ?? null,
        diagnosis: correctScore.engineStatus.diagnosis,
        availableMarketKeys: correctScore.engineStatus.availableMarketKeys,
        missingMarketKeys: correctScore.engineStatus.missingMarketKeys,
        verdict: correctScore.verdict
      },
      motivation: {
        feature: "Motivation Enhancement",
        metadata: motivation.sampleCount > 0 ? "AVAILABLE" : "MISSING",
        sample: motivation.sampleCount,
        activatedCount: motivation.activatedCount,
        inactiveCount: motivation.inactiveCount,
        activeAccuracyPct: motivation.activeAccuracyPct,
        inactiveAccuracyPct: motivation.inactiveAccuracyPct,
        improvementPct: motivation.improvementPct,
        byKeyword: motivation.byKeyword,
        reason: motivation.reason,
        action: motivation.action,
        verdict: motivation.verdict
      },
      cards: {
        feature: "Cards Market",
        runtime: "BLOCKED",
        blockedReason: cards.reason,
        verdict: cards.verdict
      }
    }
  };
}

function line(label, value) {
  return `${label}:\n${value}\n`;
}

/** Renders buildSprint4ValidationStatus()'s output in the exact requested text layout. */
export function printSprint4ValidationStatus(status) {
  const out = [];
  out.push("=== Deployment Timing ===\n");
  out.push(line("Total rows analyzed", status.totalRowsAnalyzed));
  out.push(line("Deploy timestamp used (Sprint 1, commit e40b9b00)", status.deployment.deployedAtIso));
  out.push(line("before_feature_deploy", status.deployment.beforeFeatureDeployCount));
  out.push(line("after_feature_deploy", status.deployment.afterFeatureDeployCount));

  out.push("\n=== Feature Validation Status ===\n");

  const cs = status.features.cleanSheet;
  out.push(line("Feature", cs.feature));
  out.push(line("Runtime", cs.runtime));
  out.push(line("Historical sample", cs.historicalSample));
  out.push(line("Applied sample", cs.appliedSample));
  out.push(line("Verdict", cs.verdict));

  const co = status.features.correctScore;
  out.push(line("Feature", co.feature));
  out.push(line("Engine", co.engine));
  out.push(line("Odds", co.odds));
  out.push(line("Verdict", co.verdict));

  const mo = status.features.motivation;
  out.push(line("Feature", mo.feature));
  out.push(line("Metadata", mo.metadata));

  const ca = status.features.cards;
  out.push(line("Feature", ca.feature));
  out.push(line("Blocked reason", ca.blockedReason || "n/a"));

  return out.join("\n");
}

export default {
  MIN_SAMPLE,
  SPRINT1_DEPLOY_AT,
  splitByDeployTimestamp,
  buildSprint4ValidationStatus,
  printSprint4ValidationStatus
};
