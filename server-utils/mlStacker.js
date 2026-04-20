import { getSupabaseAdmin } from "./supabaseAdmin.js";

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

export { safeLog, softmax3 };
