/**
 * Tier 3 — universal, future-only cards-statistics capture.
 *
 * ── WHY THIS TIER EXISTS ─────────────────────────────────────────────────────
 * `/fixtures/statistics` is requested only for a row that already carries a
 * pending Cards/Shots/Corners market (needsMarketTotalsForSettlement). Every
 * other finished fixture never receives card statistics, so `cards_total` is
 * null for it — and the rows that DO have it are exactly the ones the model
 * happened to recommend a statistic market on. Measured: 100% coverage behind a
 * Cards pick, 85.5% behind a Shots pick, 26.5% otherwise. A cards dataset
 * conditioned on our own recommendation cannot answer questions about cards.
 *
 * This tier captures the residual so that FUTURE rows are unbiased. It buys one
 * thing only: a target that does not depend on what V3 chose to recommend.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────────
 * NOT a backfill. No path here reaches a historical fixture: the activation
 * boundary is a floor on `kickoff_at`, and with the boundary unset every fixture
 * is refused. An unset boundary means DISABLED, never "all rows" — the inverted
 * reading would turn this file into the 45-day historical sweep the design
 * explicitly ruled out.
 *
 * NOT a way to jump the queue. Tier 3 is RESIDUAL: a row that Tier 1
 * (recommended-pending) or Tier 2 (market touch-ups) can claim is refused here,
 * so the tiers can never contend for the same fixture. Combined with the
 * caller's existing recommended-first sort and a counter of its own, Tier 3
 * cannot consume capacity that belongs to a pending recommendation.
 *
 * ── THE RETRY BOUND IS THE WINDOW ────────────────────────────────────────────
 * A fixture whose statistics come back empty stays eligible, so without a bound
 * the settlement scan would re-request it once per run for the whole 45-day
 * window — 5 runs/day x 45 days = 225 attempts. Durable per-fixture attempt
 * counts would need a migration, which this work does not get. So the bound is
 * structural instead: `lookbackDays` (default 3) caps the tail at ~15 attempts.
 * That trades precision for a schema-free guarantee, and the guarantee is the
 * part that matters.
 */

/** Defaults and clamps — the design's approved numbers, in one place. */
export const UNIVERSAL_STATS_DEFAULTS = Object.freeze({
  cap: 25,
  capMin: 0,
  capMax: 60,
  lookbackDays: 3,
  lookbackMin: 1,
  lookbackMax: 7
});

/** Statuses that mean "the match is over and its statistics are final". */
const FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);

const DAY_MS = 24 * 60 * 60 * 1000;

function clampInt(raw, fallback, min, max) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Parse the activation boundary.
 *
 * Returns null for unset AND for anything unparseable. Both mean the same thing
 * — the tier stays off — because the only alternative to "off" would be guessing
 * a boundary, and a wrong guess here reaches historical fixtures.
 */
function parseActivationBoundary(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Tier 3 configuration from the environment.
 *
 * `enabled` requires BOTH a positive budget and a usable boundary: a cap with no
 * boundary has nothing safe to act on, and a boundary with cap 0 has no budget
 * to act with. Either alone leaves the tier inert, which is the shipped state.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {{cap:number, lookbackDays:number, activeFromMs:number|null, enabled:boolean}}
 */
export function readUniversalStatsConfig(env = process.env) {
  const cap = clampInt(
    env.HISTORY_SYNC_UNIVERSAL_STATS_MAX,
    UNIVERSAL_STATS_DEFAULTS.cap,
    UNIVERSAL_STATS_DEFAULTS.capMin,
    UNIVERSAL_STATS_DEFAULTS.capMax
  );
  const lookbackDays = clampInt(
    env.HISTORY_SYNC_UNIVERSAL_LOOKBACK_DAYS,
    UNIVERSAL_STATS_DEFAULTS.lookbackDays,
    UNIVERSAL_STATS_DEFAULTS.lookbackMin,
    UNIVERSAL_STATS_DEFAULTS.lookbackMax
  );
  const activeFromMs = parseActivationBoundary(env.HISTORY_SYNC_UNIVERSAL_STATS_FROM);

  return { cap, lookbackDays, activeFromMs, enabled: cap > 0 && activeFromMs !== null };
}

/**
 * Is this finished fixture the residual Tier 3 should capture?
 *
 * Every rule is a refusal; a fixture qualifies only by surviving all of them.
 * The two higher-tier flags are passed IN rather than recomputed so this stays
 * pure and so the tier can never disagree with the caller about who owns a row.
 *
 * @param {{matchStatus?:string, cardsTotal?:unknown, kickoffAt?:unknown,
 *          isRecommendedGap?:boolean, needsHigherTierStats?:boolean}} row
 * @param {{cap:number, lookbackDays:number, activeFromMs:number|null, enabled:boolean}} config
 * @param {number} nowMs
 */
export function isUniversalStatsEligible(row, config, nowMs) {
  if (!config || !config.enabled) return false;
  if (!row) return false;

  // Higher tiers own their rows outright — checked first so the residual rule is
  // impossible to misread as a tie-break.
  if (row.isRecommendedGap === true) return false;
  if (row.needsHigherTierStats === true) return false;

  if (!FINAL_STATUSES.has(String(row.matchStatus || "").toUpperCase())) return false;

  // Already captured. null/undefined mean missing; 0 is a real card-less match
  // and must NOT re-qualify, which `!= null` gets right and a truthiness check
  // would not.
  if (row.cardsTotal != null) return false;

  const kickoffMs = Date.parse(String(row.kickoffAt ?? ""));
  if (!Number.isFinite(kickoffMs)) return false;

  // Future-only: at or after the activation boundary. Inclusive, so a fixture
  // exactly on the boundary is captured rather than lost to a rounding decision.
  if (kickoffMs < config.activeFromMs) return false;

  // The retry bound. Older unresolved fixtures fall out of scope permanently
  // rather than being re-requested for the rest of the 45-day scan window.
  if (kickoffMs < nowMs - config.lookbackDays * DAY_MS) return false;

  return true;
}

export default { UNIVERSAL_STATS_DEFAULTS, readUniversalStatsConfig, isUniversalStatsEligible };
