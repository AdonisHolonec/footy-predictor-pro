/**
 * Single source of thresholds, bucket edges and weights for the Meta Learning &
 * Benchmark Intelligence layer. No magic numbers anywhere else under metaLearning/.
 *
 * Read-only layer: nothing here is imported by PredictorV3 /
 * server-utils/PredictionEngine / pipeline / confidence / value. See
 * docs/META_LEARNING_BENCHMARK_INTELLIGENCE.md and the import-boundary test in
 * tests/metaLearning/importBoundary.test.js.
 *
 * Every threshold is env-overridable so the statistical gates can be tuned without a
 * deploy, but the DEFAULTS are the designed ones and are deliberately conservative:
 * at the sample sizes this layer will see for months, loose gates would manufacture
 * confident nonsense out of noise.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Bump when bucket definitions change, so historical rows stay interpretable. */
export const CONTEXT_VERSION = process.env.META_CONTEXT_VERSION || "ctx-v1";

function envNum(name, fallback, lo, hi) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(lo, Math.min(raw, hi));
}

// -----------------------------------------------------------------------------
// Bucket edges. Half-open [low, high): a value equal to `high` belongs to the next
// bucket, so no observation can land in two buckets or none.
// -----------------------------------------------------------------------------

/** Odds bands, per the design doc. Applied to the PRICED odd of the selection. */
export const ODDS_BANDS = Object.freeze([
  { key: "<1.25", low: 0, high: 1.25 },
  { key: "1.25-1.50", low: 1.25, high: 1.5 },
  { key: "1.50-1.80", low: 1.5, high: 1.8 },
  { key: "1.80-2.20", low: 1.8, high: 2.2 },
  { key: "2.20+", low: 2.2, high: Number.POSITIVE_INFINITY }
]);

/** Confidence buckets (percent). */
export const CONFIDENCE_BUCKETS = Object.freeze([
  { key: "<50", low: Number.NEGATIVE_INFINITY, high: 50 },
  { key: "50-55", low: 50, high: 55 },
  { key: "55-60", low: 55, high: 60 },
  { key: "60-65", low: 60, high: 65 },
  { key: "65-70", low: 65, high: 70 },
  { key: "70+", low: 70, high: Number.POSITIVE_INFINITY }
]);

/**
 * Confidence-delta buckets (ours minus provider's, in percentage points). The
 * diagnostic that answers "when we are much more confident than the provider, are we
 * actually right more often?" — a flat or falling hit rate across these buckets is
 * overconfidence with no information content.
 */
export const CONFIDENCE_DELTA_BUCKETS = Object.freeze([
  { key: "<=-20", low: Number.NEGATIVE_INFINITY, high: -20 },
  { key: "-20..-10", low: -20, high: -10 },
  { key: "-10..+10", low: -10, high: 10 },
  { key: "+10..+20", low: 10, high: 20 },
  { key: ">=+20", low: 20, high: Number.POSITIVE_INFINITY }
]);

/** Favouritism classification on the de-vigged implied probability of the favourite. */
export const FAVOURITISM = Object.freeze({
  clearFavouriteMinProb: envNum("META_CLEAR_FAVOURITE_MIN_PROB", 0.6, 0.5, 0.95),
  moderateFavouriteMinProb: envNum("META_MODERATE_FAVOURITE_MIN_PROB", 0.45, 0.3, 0.6),
  balancedMaxHomeAwaySpread: envNum("META_BALANCED_MAX_SPREAD", 0.08, 0.01, 0.3)
});

/** Season phase, in days since that league's own season start. */
export const SEASON_PHASE = Object.freeze({
  earlyMaxDays: envNum("META_SEASON_EARLY_MAX_DAYS", 60, 14, 150),
  midMaxDays: envNum("META_SEASON_MID_MAX_DAYS", 210, 60, 330)
});

/**
 * Market-move classification on the selected side, 1X2 only (closing odds are captured
 * for 1X2 columns only — migration 030). A shortening price ("toward") means the market
 * moved our way after we published.
 */
export const MARKET_MOVE = Object.freeze({
  thresholdPct: envNum("META_MARKET_MOVE_THRESHOLD_PCT", 2, 0.5, 20)
});

// -----------------------------------------------------------------------------
// Statistical gates. These are the anti-p-hacking machinery, not tuning knobs.
// -----------------------------------------------------------------------------
export const STATS = Object.freeze({
  /**
   * discordant_n = only_a_correct + only_b_correct is the REAL sample size of a
   * head-to-head claim; both-correct and both-wrong pairs carry no information about
   * which provider is better. Below `minDiscordantLeaning` no p-value is computed at
   * all and the verdict is hard-set to insufficient_data.
   */
  minDiscordantDominant: envNum("META_MIN_DISCORDANT_DOMINANT", 25, 10, 500),
  minDiscordantLeaning: envNum("META_MIN_DISCORDANT_LEANING", 12, 5, 200),
  /** McNemar switches from chi-square-with-continuity-correction to exact binomial below this. */
  mcnemarExactBelowN: envNum("META_MCNEMAR_EXACT_BELOW_N", 25, 10, 100),
  /** Benjamini-Hochberg adjusted q. Verdicts key off q, never off raw p. */
  qDominant: envNum("META_Q_DOMINANT", 0.05, 0.001, 0.2),
  qInconclusiveAtOrAbove: envNum("META_Q_INCONCLUSIVE", 0.2, 0.05, 0.5),
  /** Minimum shrunk hit-rate edge, in percentage points, for a *_dominant verdict. */
  minEffectPp: envNum("META_MIN_EFFECT_PP", 4, 0.5, 30),
  /** Empirical-Bayes Beta-Binomial shrinkage strength floor. */
  shrinkageKFloor: envNum("META_SHRINKAGE_K_FLOOR", 10, 1, 500),
  /** Below this price coverage a segment may report hit rate but NOT ROI. */
  pricedCoverageFloorPct: envNum("META_PRICED_COVERAGE_FLOOR_PCT", 60, 0, 100)
});

/** Segment discovery (Sprint 3). Stricter than reporting: searching for a split is far
 * more prone to fitting noise than reporting a pre-registered slice. */
export const DISCOVERY = Object.freeze({
  minDiscordantPerChild: envNum("META_DISCOVERY_MIN_PER_CHILD", 25, 10, 500),
  maxDepth: envNum("META_DISCOVERY_MAX_DEPTH", 2, 1, 3),
  minGain: envNum("META_DISCOVERY_MIN_GAIN", 0.01, 0.0001, 1)
});

/** Calibration method ladder by sample size (Sprint 4). Below plattMinSamples we report
 * raw bins only — a recalibration fitted on 30 samples is a random-number generator. */
export const CALIBRATION = Object.freeze({
  isotonicMinSamples: envNum("META_CALIBRATION_ISOTONIC_MIN", 200, 50, 5000),
  plattMinSamples: envNum("META_CALIBRATION_PLATT_MIN", 50, 20, 1000),
  bins: Object.freeze([
    { low: 0, high: 50 },
    { low: 50, high: 55 },
    { low: 55, high: 60 },
    { low: 60, high: 65 },
    { low: 65, high: 70 },
    { low: 70, high: 101 }
  ])
});

/** Dominance-score weights (Sprint 3). Ranking device only — never decides a verdict
 * on its own; the gates in STATS do. Recorded into evidence_json so a stored verdict
 * stays interpretable after a weight change. */
export const DOMINANCE_WEIGHTS = Object.freeze({
  hitRate: envNum("META_W_HIT", 0.4, 0, 1),
  roi: envNum("META_W_ROI", 0.25, 0, 1),
  calibration: envNum("META_W_CAL", 0.15, 0, 1),
  probability: envNum("META_W_PROB", 0.1, 0, 1),
  stability: envNum("META_W_STAB", 0.1, 0, 1)
});

/** ETL scope. The tables are small (thousands of rows), so a full idempotent rebuild
 * over this window is cheap and leaves no incremental state to rot. */
export const ETL = Object.freeze({
  windowDays: envNum("META_ETL_WINDOW_DAYS", 365, 7, 1460),
  rowLimit: envNum("META_ETL_ROW_LIMIT", 20000, 500, 100000),
  upsertChunkSize: envNum("META_ETL_CHUNK_SIZE", 500, 50, 2000)
});

/** Provider registry keys. Kept here so no module hardcodes a provider string. */
export const PROVIDER_KEYS = Object.freeze({
  predictorV3: "predictor_v3",
  apiFootball: "api_football"
});

/**
 * Market families known to this layer. `ou` is goals-only; `ou_other` is any other O/U
 * total (corners/cards/shots lines), which API-Football's under_over does NOT cover —
 * conflating the two would line a corners pick up against a goals prediction.
 */
export const MARKET_FAMILIES = Object.freeze([
  "1x2",
  "dc",
  "btts",
  "ou",
  "ou_other",
  "corners",
  "cards",
  "shots",
  "correct_score"
]);

/** Families for which at least one external provider can produce a comparable pick.
 * Everything else is structurally uncomparable and is reported as such rather than
 * silently counted as a miss. */
export const EXTERNALLY_COMPARABLE_FAMILIES = Object.freeze(["1x2", "dc", "btts", "ou"]);

// -----------------------------------------------------------------------------
// League tiers (additive config; leagueProfiles.config.json is never touched).
// -----------------------------------------------------------------------------
const DEFAULT_TIER_CONFIG = { tier: 3, seasonStartMonth: 8 };

let tierConfigCache = null;

function loadTierConfig() {
  if (tierConfigCache) return tierConfigCache;

  const inline = String(process.env.META_LEAGUE_TIERS_JSON || "").trim();
  if (inline) {
    try {
      tierConfigCache = JSON.parse(inline);
      return tierConfigCache;
    } catch {
      // Fall through to the file: a malformed override must never take the layer down.
    }
  }

  const path = String(process.env.META_LEAGUE_TIERS_PATH || "").trim() || join(__dirname, "leagueTiers.config.json");
  try {
    tierConfigCache = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    tierConfigCache = { version: "lt-fallback", tiers: {}, leagues: {}, default: DEFAULT_TIER_CONFIG };
  }
  return tierConfigCache;
}

/** Test seam — also lets a long-running process pick up a changed override. */
export function invalidateLeagueTierCache() {
  tierConfigCache = null;
}

/**
 * @param {number|string|null|undefined} leagueId
 * @returns {{ tier: number, seasonStartMonth: number, quality: string, name: string|null }}
 */
export function getLeagueTier(leagueId) {
  const cfg = loadTierConfig();
  const fallback = cfg.default || DEFAULT_TIER_CONFIG;
  const key = leagueId == null ? "" : String(leagueId);
  const entry = (cfg.leagues && cfg.leagues[key]) || null;

  const tier = Number(entry?.tier ?? fallback.tier ?? 3);
  const seasonStartMonth = Number(entry?.seasonStartMonth ?? fallback.seasonStartMonth ?? 8);

  return {
    tier: Number.isFinite(tier) ? tier : 3,
    seasonStartMonth: Number.isFinite(seasonStartMonth) && seasonStartMonth >= 1 && seasonStartMonth <= 12
      ? seasonStartMonth
      : 8,
    quality: (cfg.tiers && cfg.tiers[String(tier)]) || "Rest",
    name: entry?.name ?? null
  };
}

export default {
  CONTEXT_VERSION,
  ODDS_BANDS,
  CONFIDENCE_BUCKETS,
  CONFIDENCE_DELTA_BUCKETS,
  FAVOURITISM,
  SEASON_PHASE,
  MARKET_MOVE,
  STATS,
  DISCOVERY,
  CALIBRATION,
  DOMINANCE_WEIGHTS,
  ETL,
  PROVIDER_KEYS,
  MARKET_FAMILIES,
  EXTERNALLY_COMPARABLE_FAMILIES,
  getLeagueTier,
  invalidateLeagueTierCache
};
