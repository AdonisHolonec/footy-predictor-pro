/**
 * Auto Calibration Engine.
 *
 * 1. Read settled prediction history
 * 2. Compare predicted probability vs actual results
 * 3. Fit feature-weight overlays (confidence / FI / prediction)
 * 4. Keep calibration run history + generate report
 *
 * HARD RULE: never overwrite manually configured weights (env locks).
 * Overlays are stored separately and skipped for locked keys at merge time.
 */

import { actual1x2FromScore } from "../probabilityMetrics.js";
import { MODEL_VERSION } from "../modelConstants.js";
import { DEFAULT_CONFIDENCE_WEIGHTS, normalizeConfidenceWeights } from "../confidence/confidenceWeights.js";
import {
  DEFAULT_FEATURE_IMPORTANCE_PRIORS,
  FEATURE_IMPORTANCE_KEYS
} from "../importance/featureImportanceWeights.js";
import { DEFAULT_PREDICTION_WEIGHTS } from "../PredictionEngine/weights.js";
import { locksForKind } from "./manualLocks.js";
import { applyWeightDeltas, mergeWithAutoOverlay } from "./mergeWeights.js";
import {
  saveOverlay,
  saveCalibrationRun,
  listCalibrationRuns,
  getLatestCalibrationReport,
  loadActiveOverlays,
  invalidateAutoCalibrationCache
} from "./overlayStore.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const DEFAULT_WINDOW_DAYS = 180;
const DEFAULT_MIN_SAMPLES = 80;
const DEFAULT_MAX_DELTA = 0.15; // ±15% relative
const DEFAULT_LR = 0.35;

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function round5(n) {
  return Math.round(Number(n) * 100000) / 100000;
}

/** Prefer raw Poisson, then model, then top-level probs. */
export function extractPredictedTriple(payload) {
  const tryTriple = (t, scaleHint) => {
    if (!t) return null;
    let p1 = Number(t.p1);
    let pX = Number(t.pX);
    let p2 = Number(t.p2);
    if (![p1, pX, p2].every(Number.isFinite)) return null;
    if (scaleHint === "pct" || p1 + pX + p2 > 1.5) {
      p1 /= 100;
      pX /= 100;
      p2 /= 100;
    }
    const s = p1 + pX + p2;
    if (!(s > 0)) return null;
    return { p1: p1 / s, pX: pX / s, p2: p2 / s };
  };

  const ev = payload?.evaluation || {};
  return (
    tryTriple(ev.rawPoissonProbs1x2Pct, "pct") ||
    tryTriple(ev.modelProbs1x2Pct, "pct") ||
    tryTriple(payload?.probs, "auto")
  );
}

export function extractSamplesFromHistory(rows = []) {
  const samples = [];
  for (const row of rows) {
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const triple = extractPredictedTriple(payload);
    if (!triple) continue;

    const pick = String(row.recommended_pick || payload?.recommended?.pick || "").trim();
    const confRaw = Number(row.recommended_confidence ?? payload?.recommended?.confidence);
    const conf = Number.isFinite(confRaw) ? (confRaw > 1.5 ? confRaw / 100 : confRaw) : Math.max(triple.p1, triple.pX, triple.p2);

    let pickProb = conf;
    const pl = pick.toLowerCase();
    if (pl === "1") pickProb = triple.p1;
    else if (pl === "x") pickProb = triple.pX;
    else if (pl === "2") pickProb = triple.p2;

    const won =
      row.validation === "win" ||
      (pl === "1" && actual === "1") ||
      (pl === "x" && actual === "X") ||
      (pl === "2" && actual === "2") ||
      false;

    const fi =
      payload?.featureImportance?.contributions ||
      payload?.featureImportance?.items?.reduce((acc, it) => {
        if (it?.key) acc[it.key] = (Number(it.contribution) || 0) / 100;
        return acc;
      }, {}) ||
      null;

    samples.push({
      leagueId: Number(row.league_id) || null,
      actual,
      triple,
      pick,
      pickProb: clamp(pickProb, 0, 1),
      won: Boolean(won),
      validation: row.validation || null,
      featureContributions: fi,
      y1: actual === "1" ? 1 : 0,
      yX: actual === "X" ? 1 : 0,
      y2: actual === "2" ? 1 : 0
    });
  }
  return samples;
}

/** Reliability diagram buckets for predicted max / pick probability. */
export function computeReliabilityBuckets(samples, binWidth = 0.1) {
  const buckets = [];
  for (let lo = 0; lo < 1; lo += binWidth) {
    const hi = Math.min(1, lo + binWidth);
    const inBin = samples.filter((s) => s.pickProb >= lo && (hi >= 1 ? s.pickProb <= hi : s.pickProb < hi));
    if (!inBin.length) {
      buckets.push({
        lo: round4(lo),
        hi: round4(hi),
        n: 0,
        avgPredicted: null,
        hitRate: null,
        gap: null
      });
      continue;
    }
    const avgPredicted = inBin.reduce((a, s) => a + s.pickProb, 0) / inBin.length;
    const hitRate = inBin.filter((s) => s.won).length / inBin.length;
    buckets.push({
      lo: round4(lo),
      hi: round4(hi),
      n: inBin.length,
      avgPredicted: round4(avgPredicted),
      hitRate: round4(hitRate),
      gap: round4(avgPredicted - hitRate)
    });
  }
  return buckets;
}

export function computeEce(buckets) {
  const total = buckets.reduce((a, b) => a + (b.n || 0), 0);
  if (!total) return null;
  let ece = 0;
  for (const b of buckets) {
    if (!b.n || b.avgPredicted == null || b.hitRate == null) continue;
    ece += (b.n / total) * Math.abs(b.avgPredicted - b.hitRate);
  }
  return round5(ece);
}

export function computeBrier1x2(samples) {
  if (!samples.length) return null;
  let s = 0;
  for (const row of samples) {
    s += (row.triple.p1 - row.y1) ** 2 + (row.triple.pX - row.yX) ** 2 + (row.triple.p2 - row.y2) ** 2;
  }
  return round5(s / samples.length);
}

/**
 * Fit relative deltas for feature priors from residual × contribution.
 * Positive residual (overconfident) with high contribution → shrink that feature.
 */
export function fitFeatureWeightDeltas(samples, baseKeys, options = {}) {
  const lr = clamp(Number(options.learningRate) ?? DEFAULT_LR, 0.05, 1);
  const maxDelta = clamp(Number(options.maxDelta) ?? DEFAULT_MAX_DELTA, 0.02, 0.4);
  const locked = new Set(options.lockedKeys || []);
  const keys = baseKeys.filter((k) => !locked.has(k));

  const acc = Object.create(null);
  for (const k of keys) acc[k] = { num: 0, den: 0 };

  let used = 0;
  for (const s of samples) {
    const residual = s.pickProb - (s.won ? 1 : 0); // >0 overconfident
    const contribs = s.featureContributions;
    if (!contribs || typeof contribs !== "object") continue;
    used += 1;
    for (const k of keys) {
      const c = Number(contribs[k]);
      if (!Number.isFinite(c) || c <= 0) continue;
      // Shrink features that drove overconfident misses; boost underconfident hits
      acc[k].num += c * residual;
      acc[k].den += c;
    }
  }

  const deltas = {};
  for (const k of baseKeys) {
    if (locked.has(k)) {
      deltas[k] = 0;
      continue;
    }
    if (!acc[k] || acc[k].den <= 0) {
      deltas[k] = 0;
      continue;
    }
    const raw = -lr * (acc[k].num / acc[k].den); // negate residual influence
    deltas[k] = round4(clamp(raw, -maxDelta, maxDelta));
  }

  return { deltas, samplesWithFeatures: used, lockedKeys: [...locked] };
}

/**
 * Global overconfidence → mild shrinkage of oddsConsensus / odds / modularBlend.
 */
export function fitGlobalConfidenceDeltas(samples, options = {}) {
  const maxDelta = clamp(Number(options.maxDelta) ?? DEFAULT_MAX_DELTA, 0.02, 0.4);
  const locked = new Set(options.lockedKeys || []);
  if (!samples.length) {
    return { deltas: {}, overconfidence: null, lockedKeys: [...locked] };
  }
  const avgPred = samples.reduce((a, s) => a + s.pickProb, 0) / samples.length;
  const hitRate = samples.filter((s) => s.won).length / samples.length;
  const overconfidence = round4(avgPred - hitRate);

  const scale = clamp(-overconfidence * 0.8, -maxDelta, maxDelta);
  const keys = options.keys || ["oddsConsensus", "odds", "form"];
  const deltas = {};
  for (const k of keys) {
    deltas[k] = locked.has(k) ? 0 : round4(scale);
  }
  return { deltas, overconfidence, hitRate: round4(hitRate), avgPredicted: round4(avgPred), lockedKeys: [...locked] };
}

export { applyWeightDeltas, mergeWithAutoOverlay };

export function buildCalibrationReport({
  samples,
  buckets,
  ece,
  brier,
  overlays,
  modelVersion,
  windowDays,
  config
}) {
  const n = samples.length;
  const wins = samples.filter((s) => s.won).length;
  const byOutcome = { "1": 0, X: 0, "2": 0 };
  for (const s of samples) byOutcome[s.actual] = (byOutcome[s.actual] || 0) + 1;

  return {
    version: "auto-calib-v1",
    generatedAt: new Date().toISOString(),
    modelVersion,
    windowDays,
    nRows: n,
    hitRate: n ? round4(wins / n) : null,
    outcomeCounts: byOutcome,
    predictedVsActual: {
      brier1x2: brier,
      ece,
      reliabilityBuckets: buckets,
      avgPickProbability: n
        ? round4(samples.reduce((a, s) => a + s.pickProb, 0) / n)
        : null,
      empiricalHitRate: n ? round4(wins / n) : null
    },
    overlays,
    manualLocks: {
      confidence: locksForKind("confidence"),
      feature_importance: locksForKind("feature_importance"),
      prediction: locksForKind("prediction")
    },
    rule: "never_overwrite_manual_weights",
    config: config || {}
  };
}

async function loadSettledHistory({ days, limit }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "supabase_unavailable", rows: [] };

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from("predictions_history")
    .select(
      "fixture_id, league_id, score_home, score_away, match_status, validation, recommended_pick, recommended_confidence, raw_payload, kickoff_at"
    )
    .gte("kickoff_at", cutoff)
    .in("match_status", ["FT", "AET", "PEN"])
    .order("kickoff_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, error: error.message, rows: [] };
  const rows = (data || []).filter((r) => r.score_home != null && r.score_away != null);
  return { ok: true, rows };
}

/**
 * Fit overlays from samples (pure — no IO).
 */
export function fitAutoCalibrationOverlays(samples, options = {}) {
  const maxDelta = clamp(Number(options.maxDelta) ?? DEFAULT_MAX_DELTA, 0.02, 0.4);
  const learningRate = clamp(Number(options.learningRate) ?? DEFAULT_LR, 0.05, 1);

  const confLocks = locksForKind("confidence");
  const fiLocks = locksForKind("feature_importance");
  const predLocks = locksForKind("prediction");

  const globalConf = fitGlobalConfidenceDeltas(samples, {
    maxDelta,
    lockedKeys: confLocks,
    keys: ["oddsConsensus", "form", "h2h"]
  });

  const fiFit = fitFeatureWeightDeltas(samples, [...FEATURE_IMPORTANCE_KEYS], {
    maxDelta,
    learningRate,
    lockedKeys: fiLocks
  });

  // Prediction modular keys — reuse FI deltas where names overlap; mild global on modularBlend/odds
  const predDeltas = {};
  for (const k of Object.keys(DEFAULT_PREDICTION_WEIGHTS)) {
    if (predLocks.includes(k)) {
      predDeltas[k] = 0;
      continue;
    }
    if (fiFit.deltas[k] != null) predDeltas[k] = fiFit.deltas[k];
    else if (k === "odds" || k === "modularBlend") predDeltas[k] = globalConf.deltas.oddsConsensus || 0;
    else predDeltas[k] = 0;
  }

  const confidenceWeights = applyWeightDeltas(
    DEFAULT_CONFIDENCE_WEIGHTS,
    globalConf.deltas,
    confLocks
  );
  const featureImportanceWeights = applyWeightDeltas(
    DEFAULT_FEATURE_IMPORTANCE_PRIORS,
    fiFit.deltas,
    fiLocks
  );
  const predictionWeights = applyWeightDeltas(DEFAULT_PREDICTION_WEIGHTS, predDeltas, predLocks);

  return {
    confidence: {
      kind: "confidence",
      deltas: globalConf.deltas,
      weights: normalizeConfidenceWeights(confidenceWeights),
      lockedKeys: confLocks,
      metrics: {
        overconfidence: globalConf.overconfidence,
        hitRate: globalConf.hitRate,
        avgPredicted: globalConf.avgPredicted
      }
    },
    feature_importance: {
      kind: "feature_importance",
      deltas: fiFit.deltas,
      weights: featureImportanceWeights,
      lockedKeys: fiLocks,
      metrics: { samplesWithFeatures: fiFit.samplesWithFeatures }
    },
    prediction: {
      kind: "prediction",
      deltas: predDeltas,
      weights: predictionWeights,
      lockedKeys: predLocks,
      metrics: { note: "overlap_with_fi_plus_global_odds" }
    }
  };
}

/**
 * Full pipeline: history → fit → persist overlays → report → run history.
 */
export async function runAutoCalibration(options = {}) {
  const startedAt = new Date().toISOString();
  const modelVersion = String(options.modelVersion || process.env.CALIBRATION_MODEL_VERSION || MODEL_VERSION);
  const windowDays = Math.max(30, Math.min(Number(options.windowDays) || Number(process.env.AUTO_CALIB_WINDOW_DAYS) || DEFAULT_WINDOW_DAYS, 720));
  const minSamples = Math.max(20, Number(options.minSamples) || Number(process.env.AUTO_CALIB_MIN_SAMPLES) || DEFAULT_MIN_SAMPLES);
  const limit = Math.max(500, Math.min(Number(options.limit) || Number(process.env.AUTO_CALIB_ROW_LIMIT) || 20000, 50000));
  const maxDelta = clamp(Number(options.maxDelta) ?? Number(process.env.AUTO_CALIB_MAX_DELTA) ?? DEFAULT_MAX_DELTA, 0.02, 0.4);
  const learningRate = clamp(Number(options.learningRate) ?? Number(process.env.AUTO_CALIB_LR) ?? DEFAULT_LR, 0.05, 1);
  const persist = options.persist !== false;
  const mode = options.mode || "auto";

  const config = { windowDays, minSamples, limit, maxDelta, learningRate, modelVersion, persist };

  let rows = options.rows;
  if (!rows) {
    const loaded = await loadSettledHistory({ days: windowDays, limit });
    if (!loaded.ok) {
      const failed = {
        ok: false,
        error: loaded.error,
        startedAt,
        finishedAt: new Date().toISOString(),
        modelVersion,
        config
      };
      if (persist) await saveCalibrationRun({ ...failed, report: {}, summary: { error: loaded.error } });
      return failed;
    }
    rows = loaded.rows;
  }

  const samples = extractSamplesFromHistory(rows);
  if (samples.length < minSamples) {
    const report = buildCalibrationReport({
      samples,
      buckets: computeReliabilityBuckets(samples),
      ece: null,
      brier: computeBrier1x2(samples),
      overlays: {},
      modelVersion,
      windowDays,
      config
    });
    const result = {
      ok: false,
      skipped: true,
      reason: `insufficient_samples:${samples.length}<${minSamples}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      modelVersion,
      config,
      report,
      summary: { nSamples: samples.length, minSamples }
    };
    if (persist) await saveCalibrationRun({ ...result, ok: false, error: result.reason });
    return result;
  }

  const buckets = computeReliabilityBuckets(samples);
  const ece = computeEce(buckets);
  const brier = computeBrier1x2(samples);
  const fitted = fitAutoCalibrationOverlays(samples, { maxDelta, learningRate });

  const saved = {};
  if (persist) {
    for (const kind of ["confidence", "feature_importance", "prediction"]) {
      const block = fitted[kind];
      const res = await saveOverlay({
        modelVersion,
        kind,
        weights: block.weights,
        deltas: block.deltas,
        lockedKeys: block.lockedKeys,
        metrics: { ...block.metrics, ece, brier, nSamples: samples.length },
        sampleSize: samples.length
      });
      saved[kind] = { store: res.store, lockedKeys: block.lockedKeys, deltas: block.deltas };
    }
    invalidateAutoCalibrationCache();
  }

  const report = buildCalibrationReport({
    samples,
    buckets,
    ece,
    brier,
    overlays: {
      confidence: fitted.confidence,
      feature_importance: fitted.feature_importance,
      prediction: fitted.prediction,
      persisted: saved
    },
    modelVersion,
    windowDays,
    config
  });

  const summary = {
    nSamples: samples.length,
    ece,
    brier1x2: brier,
    hitRate: report.hitRate,
    overconfidence: fitted.confidence.metrics.overconfidence,
    lockedKeyCount:
      fitted.confidence.lockedKeys.length +
      fitted.feature_importance.lockedKeys.length +
      fitted.prediction.lockedKeys.length,
    overlaysSaved: Object.keys(saved)
  };

  const result = {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    modelVersion,
    config,
    report,
    summary,
    fitted
  };

  if (persist) {
    await saveCalibrationRun({
      modelVersion,
      mode,
      startedAt,
      finishedAt: result.finishedAt,
      ok: true,
      config,
      summary,
      report
    });
  }

  return result;
}

export {
  listCalibrationRuns,
  getLatestCalibrationReport,
  loadActiveOverlays,
  invalidateAutoCalibrationCache
};

export default {
  extractPredictedTriple,
  extractSamplesFromHistory,
  computeReliabilityBuckets,
  computeEce,
  computeBrier1x2,
  fitFeatureWeightDeltas,
  fitGlobalConfidenceDeltas,
  applyWeightDeltas,
  mergeWithAutoOverlay,
  buildCalibrationReport,
  fitAutoCalibrationOverlays,
  runAutoCalibration
};
