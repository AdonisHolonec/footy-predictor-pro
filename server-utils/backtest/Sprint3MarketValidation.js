/**
 * Sprint 3 — Market Validation & Feature Performance Analysis.
 *
 * Report-only: never writes predictions, never touches prediction/decision-layer
 * code, never changes API output. Reuses server-utils/probabilityMetrics.js,
 * server-utils/calibration/CalibrationSelector.js and server-utils/cardMarketSettlement.js
 * for all scoring math, and reuses Sprint1FeatureReport.js's Clean Sheet evaluator
 * directly rather than re-implementing it.
 *
 * Data sources (all already persisted to predictions_history.raw_payload —
 * Stage10Persistence runs before Stage11Masking, so raw_payload is always the
 * full unmasked row regardless of the requesting user's tier):
 *   - Cards:        raw_payload.probs.cards.total (predicted) vs
 *                    raw_payload.marketResults.cardsTotal (actual — does not exist
 *                    anywhere in the codebase today, see evaluateCardsMarket).
 *   - Clean Sheet:  raw_payload.evaluation.calibratedSideMarketsPct.pGG (baseline,
 *                    pre-blend) vs raw_payload.probs.pGG (served, post-blend).
 *   - Motivation:   raw_payload.modelMeta.debug.motivation — only present on rows
 *                    saved while PREDICT_DEBUG_METADATA=1 was set server-side.
 *   - Correct Score: raw_payload.valueEngine.markets, filtered to
 *                    family === "Correct Score" — the FULL candidate list persists
 *                    for every row (not just the one that won as bestMarket), since
 *                    ValueEngine.js's buildValueEngine() returns markets: evaluated
 *                    (every candidate), and predictionRow.valueEngine carries that
 *                    whole object into raw_payload unmasked.
 */

import { actual1x2FromScore, brierBinary, logLossBinary, bucketConfidence } from "../probabilityMetrics.js";
import { expectedCalibrationErrorBinary } from "../calibration/CalibrationSelector.js";
import { evaluateOuLine } from "../cardMarketSettlement.js";
import { evaluateCleanSheetContribution, extractCleanSheetPair, MIN_SAMPLE } from "./Sprint1FeatureReport.js";

export { MIN_SAMPLE };

const MOTIVATION_KEYWORDS = ["champion", "europa", "conference", "promotion", "playoff", "relegation"];
const CARDS_LINE_KEY_RE = /^o(\d+)_(\d+)$/;
const VERDICT_TO_RECOMMENDATION = {
  improved: "keep",
  neutral: "tune",
  degraded: "disable",
  insufficient_sample: "insufficient_sample"
};

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

function parseCardsLineKey(key) {
  const m = CARDS_LINE_KEY_RE.exec(String(key || ""));
  if (!m) return null;
  return Number(`${m[1]}.${m[2]}`);
}

/** Grouped calibration readout: bucketConfidence(p*100) -> {n, avgConfidencePct, accuracyPct}. */
function buildCalibrationBuckets(pairs) {
  const groups = new Map();
  for (const { p, y } of pairs) {
    const key = bucketConfidence(p * 100);
    if (!groups.has(key)) groups.set(key, { bucket: key, n: 0, sumP: 0, sumY: 0 });
    const g = groups.get(key);
    g.n += 1;
    g.sumP += p;
    g.sumY += y;
  }
  return Array.from(groups.values())
    .map((g) => ({
      bucket: g.bucket,
      n: g.n,
      avgConfidencePct: Number(((g.sumP / g.n) * 100).toFixed(2)),
      accuracyPct: Number(((g.sumY / g.n) * 100).toFixed(2))
    }))
    .sort((a, b) => b.n - a.n);
}

function recommendationFor(verdict) {
  return VERDICT_TO_RECOMMENDATION[verdict] || "insufficient_sample";
}

/**
 * Cards market: predicted Over/Under probability (per line, from probs.cards.total)
 * vs actual (marketResults.cardsTotal). Correctly reports zero gradable samples when
 * either the flag was never enabled (probs.cards absent) or no settlement source
 * exists (marketResults.cardsTotal absent) — as of this sprint, both are true for
 * every row: PREDICT_ENABLE_CARDS defaults off, and no cardsTotal field exists
 * anywhere in the settlement/fixture-stats pipeline.
 */
export function evaluateCardsMarket(rows, opts = {}) {
  const minSample = Number(opts.minSample) || MIN_SAMPLE;
  let coverage = 0;
  let sampleCount = 0;
  let sumBrier = 0;
  let sumLog = 0;
  let hits = 0;
  const pairs = [];

  for (const row of rows) {
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const cardsTotal = payload.probs?.cards?.total;
    if (!cardsTotal || typeof cardsTotal !== "object") continue;
    coverage += 1;
    const actualTotal = Number(payload.marketResults?.cardsTotal);
    if (!Number.isFinite(actualTotal)) continue;
    for (const [key, pctOver] of Object.entries(cardsTotal)) {
      const line = parseCardsLineKey(key);
      const pOver = pct01(pctOver);
      if (line == null || pOver == null) continue;
      const actualOver = evaluateOuLine("over", line, actualTotal);
      if (actualOver == null) continue;
      const y = actualOver ? 1 : 0;
      const b = brierBinary(pOver, y);
      const l = logLossBinary(pOver, y);
      if (b == null || l == null) continue;
      sumBrier += b;
      sumLog += l;
      if ((pOver >= 0.5 ? 1 : 0) === y) hits += 1;
      pairs.push({ p: pOver, y });
      sampleCount += 1;
    }
  }

  const verdict = sampleCount >= minSample ? "neutral" : "insufficient_sample";
  return {
    market: "Cards Market",
    coverage,
    sampleCount,
    minSampleThreshold: minSample,
    brier: sampleCount ? Number((sumBrier / sampleCount).toFixed(5)) : null,
    logLoss: sampleCount ? Number((sumLog / sampleCount).toFixed(5)) : null,
    accuracyPct: sampleCount ? Number(((hits / sampleCount) * 100).toFixed(2)) : null,
    ece: sampleCount ? Number(expectedCalibrationErrorBinary(pairs).toFixed(5)) : null,
    calibrationBuckets: sampleCount ? buildCalibrationBuckets(pairs) : [],
    improvementPct: null,
    degradedCases: 0,
    verdict,
    reason:
      sampleCount === 0
        ? coverage === 0
          ? "No rows have probs.cards computed (PREDICT_ENABLE_CARDS defaults off)."
          : "probs.cards exists on some rows, but marketResults.cardsTotal (actual outcome) does not exist anywhere in the codebase — Cards Over/Under cannot be graded yet."
        : undefined
  };
}

/**
 * Clean Sheet / Failed-to-Score BTTS blend: thin wrapper over
 * Sprint1FeatureReport.evaluateCleanSheetContribution (not re-implemented here).
 * Surfaces the available/applied/skipped breakdown from Sprint 4.5's fix directly —
 * "coverage" is data availability (baseline+enhanced present), "sampleCount" is the
 * true evaluation sample (featureApplied===true only). Degraded-case counting is
 * restricted to applied pairs for the same reason: a pre-deploy row where
 * baseline===enhanced can never be "degraded", counting it would be meaningless.
 */
export function evaluateCleanSheetMarket(rows, opts = {}) {
  const minSample = Number(opts.minSample) || MIN_SAMPLE;
  const base = evaluateCleanSheetContribution(rows, { minSample });

  const appliedPairs = (rows || []).map(extractCleanSheetPair).filter((p) => p?.featureApplied);
  let degradedCases = 0;
  for (const pr of appliedPairs) {
    const baseBrier = brierBinary(pr.baseline, pr.actual);
    const enhBrier = brierBinary(pr.enhanced, pr.actual);
    if (baseBrier != null && enhBrier != null && enhBrier > baseBrier) degradedCases += 1;
  }

  const improvementPct =
    base.baseline.n && base.enhanced.n && base.baseline.brier
      ? Number((-(base.delta.brier / base.baseline.brier) * 100).toFixed(2))
      : null;

  return {
    market: base.market,
    totalRowsAnalyzed: base.totalRowsAnalyzed,
    coverage: base.featureAvailableCount,
    featureAvailableCount: base.featureAvailableCount,
    featureAppliedCount: base.featureAppliedCount,
    skippedCount: base.skippedCount,
    sampleCount: base.sampleCount,
    minSampleThreshold: minSample,
    baseline: base.baseline,
    enhanced: base.enhanced,
    delta: base.delta,
    improvementPct,
    degradedCases,
    perLeague: base.perLeague,
    verdict: base.verdict
  };
}

/**
 * Motivation: uses debug metadata only (raw_payload.modelMeta.debug.motivation),
 * persisted only on rows saved while PREDICT_DEBUG_METADATA=1. Splits rows into
 * "active" (real motivation signal, details.available === true) vs "inactive"
 * (neutral fallback — no standings rank for either team), compares 1X2 pick
 * accuracy between the two groups, and groups active rows by matched competition
 * keyword (home and away counted separately when both match).
 */
export function evaluateMotivationMarket(rows, opts = {}) {
  const minSample = Number(opts.minSample) || MIN_SAMPLE;
  const withDebug = [];

  for (const row of rows) {
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const debug = payload.modelMeta?.debug?.motivation;
    if (!debug) continue;
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;
    const probs = payload.probs || {};
    const p1 = Number(probs.p1);
    const pX = Number(probs.pX);
    const p2 = Number(probs.p2);
    if (![p1, pX, p2].every(Number.isFinite)) continue;
    const predicted = p1 >= pX && p1 >= p2 ? "1" : p2 > pX ? "2" : "X";
    withDebug.push({
      active: Boolean(debug.active),
      keywordHome: debug.competitionKeywordHome || null,
      keywordAway: debug.competitionKeywordAway || null,
      correct: predicted === actual
    });
  }

  const active = withDebug.filter((r) => r.active);
  const inactive = withDebug.filter((r) => !r.active);
  const accOf = (arr) => (arr.length ? (arr.filter((r) => r.correct).length / arr.length) * 100 : null);
  const activeAccuracyPct = accOf(active);
  const inactiveAccuracyPct = accOf(inactive);

  const keywordGroups = new Map(MOTIVATION_KEYWORDS.map((kw) => [kw, { keyword: kw, n: 0, correct: 0 }]));
  for (const r of active) {
    for (const kw of [r.keywordHome, r.keywordAway]) {
      if (kw && keywordGroups.has(kw)) {
        const g = keywordGroups.get(kw);
        g.n += 1;
        if (r.correct) g.correct += 1;
      }
    }
  }
  const byKeyword = Array.from(keywordGroups.values()).map((g) => ({
    keyword: g.keyword,
    sampleCount: g.n,
    accuracyPct: g.n ? Number(((g.correct / g.n) * 100).toFixed(2)) : null
  }));

  const comparable = active.length >= minSample && inactive.length >= minSample;
  const improvementPp = comparable ? Number((activeAccuracyPct - inactiveAccuracyPct).toFixed(2)) : null;
  const degradedCases = active.filter((r) => !r.correct).length;

  let verdict = "insufficient_sample";
  if (comparable) {
    if (improvementPp > 1) verdict = "improved";
    else if (improvementPp < -1) verdict = "degraded";
    else verdict = "neutral";
  }

  return {
    market: "Motivation Enhancement",
    coverage: withDebug.length,
    sampleCount: withDebug.length,
    minSampleThreshold: minSample,
    activatedCount: active.length,
    inactiveCount: inactive.length,
    activeAccuracyPct: activeAccuracyPct != null ? Number(activeAccuracyPct.toFixed(2)) : null,
    inactiveAccuracyPct: inactiveAccuracyPct != null ? Number(inactiveAccuracyPct.toFixed(2)) : null,
    improvementPct: improvementPp,
    degradedCases,
    byKeyword,
    verdict,
    reason:
      withDebug.length === 0
        ? "PREDICT_DEBUG_METADATA was disabled during prediction generation."
        : !comparable
          ? `Active (${active.length}) or inactive (${inactive.length}) group below minSample=${minSample} — accuracy comparison not statistically meaningful yet.`
          : undefined,
    action: withDebug.length === 0 ? "Enable flag and collect new predictions." : undefined
  };
}

/**
 * Correct Score: reads raw_payload.valueEngine.markets (every candidate, not just
 * the winner). Four distinct metrics:
 *  - avgAssignedProbabilityPct: mean model probability assigned to the scoreline
 *    that actually happened (calibration-style; 0 when the actual score had no
 *    quoted candidate that row).
 *  - top1AccuracyPct: % of rows where the single highest-probability candidate
 *    equals the actual score.
 *  - top3AccuracyPct: % of rows where the actual score is among the 3
 *    highest-probability candidates.
 *  - recommendedHitRatePct + roiSimulation: restricted to rows where a Correct
 *    Score candidate was actually the system's recommendation (bestMarket===true)
 *    — flat 1-unit stake at the quoted odds, mirrors ModelLab.js's flat-stake
 *    convention. This is the real "if you followed every recommendation" test,
 *    distinct from top1 (probability-only, ignores price/EV).
 */
export function evaluateCorrectScoreMarket(rows, opts = {}) {
  const minSample = Number(opts.minSample) || MIN_SAMPLE;
  const scoreOf = (m) => String(m?.type || "").replace(/^Correct Score\s*/i, "").trim();

  let sampleCount = 0;
  let sumAssignedProb = 0;
  let top1Hits = 0;
  let top3Hits = 0;
  let recommendedCount = 0;
  let recommendedHits = 0;
  let stakeSum = 0;
  let pnlSum = 0;
  let lossCount = 0;

  // Diagnostic-only (Sprint 4.5 Task 4): does the engine even attempt Correct Score
  // for these rows, and if so, are bookmaker odds actually available? Uses only
  // already-persisted fields (familiesSupported/familiesPresent/marketOdds keys) —
  // no live API call, no market-generation logic touched.
  let engineActiveCount = 0;
  let oddsAvailableCount = 0;
  let oddsMissingCount = 0;
  const seenMarketOddsKeys = new Set();

  for (const row of rows) {
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const ve = payload.valueEngine;
    if (Array.isArray(ve?.familiesSupported) && ve.familiesSupported.includes("Correct Score")) {
      engineActiveCount += 1;
      if (Array.isArray(ve?.familiesPresent) && ve.familiesPresent.includes("Correct Score")) {
        oddsAvailableCount += 1;
      } else {
        oddsMissingCount += 1;
      }
    }
    for (const key of Object.keys(payload.marketOdds || {})) seenMarketOddsKeys.add(key);

    const markets = Array.isArray(ve?.markets) ? ve.markets : [];
    const candidates = markets.filter((m) => m?.family === "Correct Score" && Number.isFinite(Number(m.probability)));
    if (!candidates.length) continue;
    const h = Number(row.score_home);
    const a = Number(row.score_away);
    if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
    const actualLabel = `${h}-${a}`;
    sampleCount += 1;

    const sorted = [...candidates].sort((x, y) => Number(y.probability) - Number(x.probability));
    const assigned = candidates.find((m) => scoreOf(m) === actualLabel);
    if (assigned) sumAssignedProb += Number(assigned.probability);
    if (sorted[0] && scoreOf(sorted[0]) === actualLabel) top1Hits += 1;
    if (sorted.slice(0, 3).some((m) => scoreOf(m) === actualLabel)) top3Hits += 1;

    const recommended = candidates.find((m) => m.bestMarket === true);
    if (recommended) {
      recommendedCount += 1;
      const won = scoreOf(recommended) === actualLabel;
      if (won) recommendedHits += 1;
      if (Number(recommended.odds) > 1) {
        stakeSum += 1;
        pnlSum += won ? Number(recommended.odds) - 1 : -1;
        if (!won) lossCount += 1;
      }
    }
  }

  const roiPct = stakeSum ? Number(((pnlSum / stakeSum) * 100).toFixed(2)) : null;
  const verdict =
    sampleCount >= minSample
      ? roiPct != null && roiPct > 2
        ? "improved"
        : roiPct != null && roiPct < -5
          ? "degraded"
          : "neutral"
      : "insufficient_sample";

  const engineActive = engineActiveCount > 0;
  const oddsMissingEntirely = engineActive && oddsAvailableCount === 0;
  const engineStatus = {
    active: engineActive,
    rowsWithEngineActive: engineActiveCount,
    oddsAvailableCount,
    oddsMissingCount,
    availableMarketKeys: Array.from(seenMarketOddsKeys).sort(),
    missingMarketKeys: seenMarketOddsKeys.has("correctScore") ? [] : ["correctScore"],
    diagnosis: !engineActive
      ? "Correct Score engine not detected on any analyzed row (no valueEngine.familiesSupported data)."
      : oddsMissingEntirely
        ? "Correct Score engine active. Missing dependency: Bookmaker odds unavailable. No algorithm issue detected."
        : "Correct Score engine active and bookmaker odds available on at least some rows."
  };

  return {
    market: "Correct Score Value Engine",
    coverage: sampleCount,
    sampleCount,
    minSampleThreshold: minSample,
    engineStatus,
    avgAssignedProbabilityPct: sampleCount ? Number(((sumAssignedProb / sampleCount) * 100).toFixed(2)) : null,
    top1AccuracyPct: sampleCount ? Number(((top1Hits / sampleCount) * 100).toFixed(2)) : null,
    top3AccuracyPct: sampleCount ? Number(((top3Hits / sampleCount) * 100).toFixed(2)) : null,
    recommendedCount,
    recommendedHitRatePct: recommendedCount ? Number(((recommendedHits / recommendedCount) * 100).toFixed(2)) : null,
    roiSimulation: { stakedBets: stakeSum, roiPct, lossCount },
    improvementPct: roiPct,
    degradedCases: lossCount,
    verdict,
    reason: sampleCount === 0 ? "No rows carry valueEngine.markets entries with family \"Correct Score\"." : undefined
  };
}

/**
 * Full Sprint 3 report across all four Sprint 1 features.
 */
export function buildSprint3MarketValidationReport(rows) {
  const settled = (rows || []).filter(isSettled);

  const features = [
    evaluateCardsMarket(settled),
    evaluateCleanSheetMarket(settled),
    evaluateMotivationMarket(settled),
    evaluateCorrectScoreMarket(settled)
  ].map((f) => ({
    ...f,
    coveragePct: settled.length ? Number(((f.coverage / settled.length) * 100).toFixed(2)) : 0,
    recommendation: recommendationFor(f.verdict)
  }));

  return {
    schemaVersion: "sprint3-market-validation-v1",
    generatedAt: new Date().toISOString(),
    totalSamples: settled.length,
    features
  };
}

export default {
  MIN_SAMPLE,
  evaluateCardsMarket,
  evaluateCleanSheetMarket,
  evaluateMotivationMarket,
  evaluateCorrectScoreMarket,
  buildSprint3MarketValidationReport
};
