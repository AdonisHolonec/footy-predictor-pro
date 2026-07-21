import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { brier1x2, logLoss1x2 } from "./probabilityMetrics.js";

/**
 * Multinomial logistic regression stacker.
 * Features per fixture: log(p1_poisson/pX_poisson), log(p2_poisson/pX_poisson),
 * log(p1_market/pX_market), log(p2_market/pX_market), elo_spread / 400, data_quality, home_adv_league.
 *
 * 3 output logits (one per class 1/X/2); softmax → calibrated probabilities.
 *
 * Weights JSON shape (in DB `ml_stacker_weights.weights_json`):
 *   {
 *     feature_names: ["poisson_log_ratio_1X", "poisson_log_ratio_2X", ...],
 *     intercept: [i1, iX, i2],
 *     coef: [[w1_1, w1_X, w1_2], [w2_1, w2_X, w2_2], ...],   // rows = features, cols = classes
 *   }
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached = { fetchedAt: 0, byKey: new Map(), version: null };

const EPS = 1e-6;
function safeLog(x) {
  return Math.log(Math.max(EPS, x));
}
function clamp01(x) {
  if (!Number.isFinite(x)) return EPS;
  return Math.max(EPS, Math.min(1 - EPS, x));
}

/**
 * Extrage vectorul de features dintr-un obiect de context al predicţiei.
 * Toate inputurile sunt probabilităţi (0..1) SAU scalari normalizaţi (0..1).
 */
export function extractStackerFeatures({
  poissonProbs,
  marketProbs,
  eloSpread = 0,
  dataQuality = 0.6,
  homeAdv = 1.06,
  rho = -0.1
} = {}) {
  const pp = poissonProbs || {};
  const mp = marketProbs;

  const p1p = clamp01(pp.p1);
  const pXp = clamp01(pp.pX);
  const p2p = clamp01(pp.p2);

  // Log-ratio faţă de pX (referinţa) — invariant la scară, elimină colinearitatea.
  const poissonLogRatio1X = safeLog(p1p) - safeLog(pXp);
  const poissonLogRatio2X = safeLog(p2p) - safeLog(pXp);

  const marketPresent = mp && Number.isFinite(mp.p1) && Number.isFinite(mp.pX) && Number.isFinite(mp.p2);
  const marketLogRatio1X = marketPresent ? safeLog(clamp01(mp.p1)) - safeLog(clamp01(mp.pX)) : 0;
  const marketLogRatio2X = marketPresent ? safeLog(clamp01(mp.p2)) - safeLog(clamp01(mp.pX)) : 0;
  const marketAvailable = marketPresent ? 1 : 0;

  return {
    values: [
      poissonLogRatio1X,
      poissonLogRatio2X,
      marketLogRatio1X,
      marketLogRatio2X,
      marketAvailable,
      (Number(eloSpread) || 0) / 400,
      Math.max(0, Math.min(1, Number(dataQuality) || 0)) - 0.6,
      Math.log(Math.max(0.8, Number(homeAdv) || 1)),
      Number(rho) || 0
    ],
    featureNames: [
      "poisson_log_ratio_1X",
      "poisson_log_ratio_2X",
      "market_log_ratio_1X",
      "market_log_ratio_2X",
      "market_available",
      "elo_spread_norm",
      "data_quality_centered",
      "log_home_adv",
      "rho"
    ]
  };
}

function softmax3(l1, lX, l2) {
  const m = Math.max(l1, lX, l2);
  const e1 = Math.exp(l1 - m);
  const eX = Math.exp(lX - m);
  const e2 = Math.exp(l2 - m);
  const s = e1 + eX + e2;
  return { p1: e1 / s, pX: eX / s, p2: e2 / s };
}

/**
 * Apply stacker weights to feature vector. Returns probabilities (sum=1).
 */
export function applyStacker(features, weights) {
  if (!features || !Array.isArray(features.values) || features.values.length === 0) return null;
  if (!weights || !weights.coef || !weights.intercept) return null;
  const v = features.values;
  if (!Array.isArray(weights.coef) || weights.coef.length === 0) return null;
  if (v.length !== weights.coef.length) return null;

  let l1 = Number(weights.intercept[0]) || 0;
  let lX = Number(weights.intercept[1]) || 0;
  let l2 = Number(weights.intercept[2]) || 0;

  for (let i = 0; i < v.length; i++) {
    const row = weights.coef[i];
    if (!row) continue;
    l1 += v[i] * (Number(row[0]) || 0);
    lX += v[i] * (Number(row[1]) || 0);
    l2 += v[i] * (Number(row[2]) || 0);
  }

  return softmax3(l1, lX, l2);
}

/**
 * Single-flight cache pentru greutăţile active per (leagueId, modelVersion).
 * Cheia `-1` (sau null) = fallback global.
 */
export async function loadStackerWeights(modelVersion) {
  const now = Date.now();
  if (cached.version === modelVersion && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.byKey;
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    cached = { fetchedAt: now, byKey: new Map(), version: modelVersion };
    return cached.byKey;
  }
  try {
    const { data, error } = await supabase
      .from("ml_stacker_weights")
      .select("league_id, weights_json, sample_size, metrics_json")
      .eq("model_version", modelVersion)
      .eq("active", true);
    const map = new Map();
    if (!error) {
      for (const row of data || []) {
        const key = row.league_id == null ? "GLOBAL" : String(row.league_id);
        map.set(key, {
          weights: row.weights_json || null,
          sampleSize: row.sample_size || 0,
          metrics: row.metrics_json || null
        });
      }
    }
    cached = { fetchedAt: now, byKey: map, version: modelVersion };
    return map;
  } catch {
    cached = { fetchedAt: now, byKey: new Map(), version: modelVersion };
    return cached.byKey;
  }
}

export function pickStackerWeightsForLeague(allWeights, leagueId) {
  if (!allWeights || !(allWeights instanceof Map)) return null;
  const key = leagueId != null ? String(leagueId) : null;
  if (key && allWeights.has(key)) return allWeights.get(key);
  if (allWeights.has("GLOBAL")) return allWeights.get("GLOBAL");
  return null;
}

export function invalidateStackerCache() {
  cached = { fetchedAt: 0, byKey: new Map(), version: null };
}

/**
 * Shared trainer + in-sample scorer for the softmax stacker.
 * Single source of truth for api/cron/daily-ml.js and scripts/fitStacker.js
 * (previously two near-identical copies) — also what
 * server-utils/validation/StackerWalkForward.js fits per fold, so a fold's
 * evaluation always reflects the exact algorithm that trains production weights.
 */

function initWeights(nFeatures) {
  return {
    intercept: [0, 0, 0],
    coef: Array.from({ length: nFeatures }, () => [0, 0, 0])
  };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Batch SGD for softmax regression with L2 on coef. `samples`: [{ x: number[], y: [0/1,0/1,0/1] }]. */
export function trainSoftmax(samples, nFeatures, opts = {}) {
  const epochs = Math.max(1, Number(opts.epochs) || 120);
  const lr = Number(opts.lr) || 0.08;
  const l2 = Number(opts.l2) || 1e-3;
  const batch = Math.max(1, Number(opts.batch) || 64);

  const w = initWeights(nFeatures);
  const n = samples.length;
  if (n === 0) return w;

  for (let epoch = 0; epoch < epochs; epoch++) {
    shuffleInPlace(samples);
    for (let start = 0; start < n; start += batch) {
      const end = Math.min(n, start + batch);
      const bs = end - start;
      const gradI = [0, 0, 0];
      const gradC = Array.from({ length: nFeatures }, () => [0, 0, 0]);

      for (let k = start; k < end; k++) {
        const s = samples[k];
        const x = s.x;
        const y = s.y;
        let l1 = w.intercept[0];
        let lX = w.intercept[1];
        let l2v = w.intercept[2];
        for (let i = 0; i < nFeatures; i++) {
          l1 += x[i] * w.coef[i][0];
          lX += x[i] * w.coef[i][1];
          l2v += x[i] * w.coef[i][2];
        }
        const p = softmax3(l1, lX, l2v);
        const d0 = p.p1 - y[0];
        const d1 = p.pX - y[1];
        const d2 = p.p2 - y[2];
        gradI[0] += d0;
        gradI[1] += d1;
        gradI[2] += d2;
        for (let i = 0; i < nFeatures; i++) {
          gradC[i][0] += d0 * x[i];
          gradC[i][1] += d1 * x[i];
          gradC[i][2] += d2 * x[i];
        }
      }

      const scale = lr / bs;
      w.intercept[0] -= scale * gradI[0];
      w.intercept[1] -= scale * gradI[1];
      w.intercept[2] -= scale * gradI[2];
      for (let i = 0; i < nFeatures; i++) {
        w.coef[i][0] -= scale * (gradC[i][0] + l2 * w.coef[i][0]);
        w.coef[i][1] -= scale * (gradC[i][1] + l2 * w.coef[i][1]);
        w.coef[i][2] -= scale * (gradC[i][2] + l2 * w.coef[i][2]);
      }
    }
  }
  return w;
}

export function argmax3(p) {
  if (p.p1 >= p.pX && p.p1 >= p.p2) return "1";
  if (p.pX >= p.p2) return "X";
  return "2";
}

/**
 * Score `weights` against `samples` (each needs .x, .actual, .poissonProbs).
 * Callers decide whether `samples` was used to fit `weights` (in-sample) or
 * held out (e.g. a walk-forward test fold) — this function itself is agnostic.
 */
export function computeStackerMetrics(samples, weights) {
  let brierPoi = 0;
  let brierStk = 0;
  let llPoi = 0;
  let llStk = 0;
  let correctPoi = 0;
  let correctStk = 0;
  for (const s of samples) {
    const p = applyStacker({ values: s.x }, weights);
    brierPoi += brier1x2(s.poissonProbs.p1, s.poissonProbs.pX, s.poissonProbs.p2, s.actual);
    llPoi += logLoss1x2(s.poissonProbs.p1, s.poissonProbs.pX, s.poissonProbs.p2, s.actual);
    if (argmax3(s.poissonProbs) === s.actual) correctPoi += 1;
    if (p) {
      brierStk += brier1x2(p.p1, p.pX, p.p2, s.actual);
      llStk += logLoss1x2(p.p1, p.pX, p.p2, s.actual);
      if (argmax3(p) === s.actual) correctStk += 1;
    }
  }
  const n = samples.length || 1;
  return {
    n,
    brierPoi: Number((brierPoi / n).toFixed(5)),
    brierStk: Number((brierStk / n).toFixed(5)),
    logLossPoi: Number((llPoi / n).toFixed(5)),
    logLossStk: Number((llStk / n).toFixed(5)),
    accuracyPoi: Number(((correctPoi / n) * 100).toFixed(2)),
    accuracyStk: Number(((correctStk / n) * 100).toFixed(2))
  };
}

export { safeLog, softmax3 };
