/**
 * Sprint 1.5 — Validation & Backtesting reporting layer.
 *
 * Report-only: never writes predictions, never touches prediction/decision-layer
 * code, never changes API output. All scoring math is reused verbatim from
 * server-utils/probabilityMetrics.js and server-utils/calibration/CalibrationSelector.js —
 * no new probability math is introduced here.
 *
 * Of Sprint 1's four features, only Clean Sheet / Failed-to-Score (the BTTS empirical
 * blend) has a genuine baseline-vs-enhanced dual-track already persisted in
 * predictions_history: alignMarketProbsAndCalibrate.js snapshots calibratedSideMarketsPct.pGG
 * strictly BEFORE applying blendBttsWithEmpirical(), so every row saved since that feature
 * shipped carries both the pre-blend baseline and the served (post-blend) value. Motivation,
 * Correct Score and Cards have no equivalent stored baseline (see evaluateUnmeasurableFeature
 * call sites in buildSprint1ValidationReport for the verified, per-feature reason).
 */

import { actualBttsFromScore, brierBinary, logLossBinary } from "../probabilityMetrics.js";
import { expectedCalibrationErrorBinary } from "../calibration/CalibrationSelector.js";

export const MIN_SAMPLE = 30;
const BRIER_DELTA_NOISE_FLOOR = 0.0005;

function pct01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 1.5 ? n / 100 : n;
}

function isSettled(row) {
  return (
    row?.score_home != null &&
    row?.score_away != null &&
    Number.isFinite(Number(row.score_home)) &&
    Number.isFinite(Number(row.score_away))
  );
}

const PGG_EPSILON = 1e-9;

/**
 * Whether the Clean Sheet / Failed-to-Score blend actually fired on this row, as opposed
 * to baseline/enhanced merely being present. This distinction matters because
 * raw_payload.evaluation.calibratedSideMarketsPct.pGG existed long before the blend
 * feature shipped (side-market calibration is older) — so a row can have BOTH values
 * present while baseline === enhanced purely because the row predates the blend, not
 * because the blend ran and produced no change (Sprint 4 finding: 43/47 "available"
 * rows on real data were pre-deploy, only 4 genuinely exercised the blend).
 *
 * Uses modelMeta.debug.cleanSheet (Sprint 2, PREDICT_DEBUG_METADATA=1) as the
 * authoritative source when present. Falls back to a value-diff heuristic — the only
 * signal available on rows saved without debug metadata, which today is effectively
 * every historical row.
 */
export function classifyCleanSheetApplication(payload, baseline, enhanced) {
  const debug = payload?.modelMeta?.debug?.cleanSheet;
  const differs = Math.abs(enhanced - baseline) > PGG_EPSILON;
  if (debug && typeof debug === "object") {
    const empiricalAvailable = debug.empiricalBttsRate != null && Number.isFinite(Number(debug.empiricalBttsRate));
    const blendApplied = Boolean(debug.blendApplied);
    return {
      featureApplied: empiricalAvailable && blendApplied && differs,
      source: "debug_metadata"
    };
  }
  return {
    featureApplied: differs,
    source: "inferred_from_value_diff"
  };
}

/**
 * Baseline (pre Clean-Sheet-blend) vs enhanced (served) BTTS probability for one settled row.
 * Baseline = raw_payload.evaluation.calibratedSideMarketsPct.pGG
 * Enhanced = raw_payload.probs.pGG
 * Returns null when either value or the actual score is unavailable — this is "feature
 * available" (data present), NOT "feature applied" (see featureApplied on the result,
 * classified by classifyCleanSheetApplication above).
 */
export function extractCleanSheetPair(row) {
  if (!isSettled(row)) return null;
  const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const baseline = pct01(payload.evaluation?.calibratedSideMarketsPct?.pGG);
  const enhanced = pct01(payload.probs?.pGG);
  if (baseline == null || enhanced == null) return null;
  const actual = actualBttsFromScore(row.score_home, row.score_away);
  if (actual == null) return null;
  const application = classifyCleanSheetApplication(payload, baseline, enhanced);
  return {
    baseline,
    enhanced,
    actual,
    leagueId: Number(row.league_id) || 0,
    leagueName: String(row.league_name || ""),
    featureApplied: application.featureApplied,
    applicationSource: application.source
  };
}

function scoreTrack(pairs, pick) {
  let n = 0;
  let sumBrier = 0;
  let sumLog = 0;
  let hits = 0;
  const ecePairs = [];
  for (const pr of pairs) {
    const p = pick(pr);
    if (p == null) continue;
    const b = brierBinary(p, pr.actual);
    const l = logLossBinary(p, pr.actual);
    if (b == null || l == null) continue;
    sumBrier += b;
    sumLog += l;
    if ((p >= 0.5 ? 1 : 0) === pr.actual) hits += 1;
    ecePairs.push({ p, y: pr.actual });
    n += 1;
  }
  if (!n) return { n: 0, brier: null, logLoss: null, accuracyPct: null, ece: null };
  return {
    n,
    brier: Number((sumBrier / n).toFixed(5)),
    logLoss: Number((sumLog / n).toFixed(5)),
    accuracyPct: Number(((hits / n) * 100).toFixed(2)),
    ece: Number(expectedCalibrationErrorBinary(ecePairs).toFixed(5))
  };
}

function verdictFor(baseline, enhanced, minSample) {
  if (!baseline.n || !enhanced.n || baseline.n < minSample) return "insufficient_sample";
  const brierDelta = enhanced.brier - baseline.brier; // negative = improved (lower Brier is better)
  if (brierDelta < -BRIER_DELTA_NOISE_FLOOR) return "improved";
  if (brierDelta > BRIER_DELTA_NOISE_FLOOR) return "degraded";
  return "neutral";
}

/**
 * Feature-contribution report for the Clean Sheet / Failed-to-Score BTTS blend
 * (server-utils/math.js:blendBttsWithEmpirical, wired in alignMarketProbsAndCalibrate.js).
 *
 * Scores Brier/LogLoss/ECE/accuracy ONLY over rows where the blend genuinely fired
 * (featureApplied === true) — rows where the data was merely available but the blend
 * never ran (pre-deploy rows, or empirical rates missing) are counted separately
 * (skippedCount) and excluded from the evaluation, so they cannot dilute the verdict.
 */
export function evaluateCleanSheetContribution(rows, opts = {}) {
  const minSample = Number(opts.minSample) || MIN_SAMPLE;
  const totalRowsAnalyzed = (rows || []).length;
  const allPairs = (rows || []).map(extractCleanSheetPair).filter(Boolean);
  const appliedPairs = allPairs.filter((p) => p.featureApplied);
  const skippedCount = allPairs.length - appliedPairs.length;

  const baseline = scoreTrack(appliedPairs, (p) => p.baseline);
  const enhanced = scoreTrack(appliedPairs, (p) => p.enhanced);

  const byLeague = new Map();
  for (const pr of appliedPairs) {
    const key = pr.leagueId || 0;
    if (!byLeague.has(key)) byLeague.set(key, { leagueId: key, leagueName: pr.leagueName, rows: [] });
    byLeague.get(key).rows.push(pr);
  }
  const perLeague = Array.from(byLeague.values()).map((g) => {
    const b = scoreTrack(g.rows, (p) => p.baseline);
    const e = scoreTrack(g.rows, (p) => p.enhanced);
    return {
      leagueId: g.leagueId,
      leagueName: g.leagueName,
      sampleCount: g.rows.length,
      baseline: b,
      enhanced: e,
      verdict: verdictFor(b, e, minSample)
    };
  });

  return {
    market: "BTTS (Clean Sheet / Failed-to-Score blend)",
    totalRowsAnalyzed,
    featureAvailableCount: allPairs.length,
    featureAppliedCount: appliedPairs.length,
    skippedCount,
    sampleCount: appliedPairs.length,
    minSampleThreshold: minSample,
    baseline,
    enhanced,
    delta: {
      brier: baseline.n && enhanced.n ? Number((enhanced.brier - baseline.brier).toFixed(5)) : null,
      logLoss: baseline.n && enhanced.n ? Number((enhanced.logLoss - baseline.logLoss).toFixed(5)) : null,
      accuracyPct:
        baseline.n && enhanced.n ? Number((enhanced.accuracyPct - baseline.accuracyPct).toFixed(2)) : null
    },
    verdict: verdictFor(baseline, enhanced, minSample),
    perLeague
  };
}

/**
 * Sample-count-only report for a Sprint 1 feature with no measurable dual-track this
 * sprint. `reason` must state a verified, code-level cause (never a guess).
 */
export function evaluateUnmeasurableFeature(name, reason, rows, presenceCheck) {
  const present = (rows || []).filter(presenceCheck).length;
  return {
    market: name,
    sampleCount: present,
    verdict: "insufficient_sample",
    reason
  };
}

export function buildSprint1ValidationReport(rows) {
  const settled = (rows || []).filter(isSettled);
  const cleanSheet = evaluateCleanSheetContribution(settled);
  const motivation = evaluateUnmeasurableFeature(
    "Motivation Enhancement",
    "No baseline/enhanced dual-track exists: motivation feeds lambda generation directly " +
      "(combine.js), and only the final blended lambda is ever computed/stored — there is no " +
      "parallel \"without enhancement\" value in predictions_history to compare against. A " +
      "before/after deployment-date split would be confounded by concurrent real-world changes " +
      "(team form, other calibration updates) and is not implemented here as a substitute.",
    settled,
    () => false
  );
  const correctScore = evaluateUnmeasurableFeature(
    "Correct Score Value Engine",
    "correctScoreProbsPct is computed transiently in Stage08Decision.js but never persisted to " +
      "raw_payload — only indirectly visible inside valueEngine.bestMarket on the rare rows where " +
      "Correct Score happens to be the single highest-EV recommendation. A full per-scoreline " +
      "calibration report requires persisting these probabilities, which means editing " +
      "prediction/decision-layer code — out of scope for this reporting-only sprint.",
    settled,
    (r) => String(r?.raw_payload?.valueEngine?.bestMarket?.family || "") === "Correct Score"
  );
  const cards = evaluateUnmeasurableFeature(
    "Cards Market",
    "PREDICT_ENABLE_CARDS defaults OFF, so no persisted row currently has probs.cards computed. " +
      "Even if enabled, there is no settlement source for card totals anywhere in the codebase " +
      "(no cardsTotal field alongside cornersTotal/shotsOnTargetTotal in marketResults) — Cards " +
      "Over/Under picks could not be graded win/loss without new settlement-layer work.",
    settled,
    (r) => r?.raw_payload?.probs?.cards != null
  );

  return {
    schemaVersion: "sprint1-validation-v1",
    generatedAt: new Date().toISOString(),
    totalSettledRows: settled.length,
    markets: [cleanSheet, motivation, correctScore, cards]
  };
}

export default {
  MIN_SAMPLE,
  classifyCleanSheetApplication,
  extractCleanSheetPair,
  evaluateCleanSheetContribution,
  evaluateUnmeasurableFeature,
  buildSprint1ValidationReport
};
