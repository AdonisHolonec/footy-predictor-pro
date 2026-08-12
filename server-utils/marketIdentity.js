/**
 * Market Identity Contract — the structural identity of a bookmaker market.
 *
 * The Aug 2026 corners audit found "Over 3.5 Corners" recommended in production
 * where the odd (1.73, one book) belonged to 1xBet's "Home Corners Over/Under"
 * while the probability (94.9%) was computed on the full-match λ. The root cause
 * was identity loss: discovery matched any market containing the word "corners"
 * and then collapsed the board to a bare Set<number> of lines, so nothing
 * downstream could tell a home-corners line from a full-match one.
 *
 * This module makes identity explicit and generic:
 *
 *   { betType, period, scope }
 *
 *   betType — the bet's structure: "total" (Over/Under), "1x2", "total_3way",
 *             "handicap", "race_to", "odd_even", "range", "multi",
 *             "double_chance", "correct_score", or "unknown"
 *   period  — "full_match" | "first_half" | "second_half" | "unknown"
 *   scope   — "match" | "home" | "away" | "unknown"
 *
 * Classification is positive (patterns that identify) plus explicit exclusions
 * (patterns that disqualify) — never `name.includes("corners")`. Values that
 * cannot be determined stay "unknown"; an unknown identity may exist internally
 * but can never become tradable, so a new market the feed introduces is either
 * classified correctly or safely absent. Better an absent market than a wrong
 * one — and no hardcoded list of "the markets we happen to know today".
 *
 * Pure and dependency-free: safe to import from anywhere (marketOdds, pipeline,
 * settlement) without creating cycles.
 */

/** Normalize an API market name for matching (camelCase split, separators → space). */
export function normalizeMarketName(name) {
  return String(name || "")
    // API-Football uses camel compounds like "Total ShotOnGoal"
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Looser normalization for classification: punctuation becomes spaces too. */
function classifierText(name) {
  return String(name || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a bookmaker market NAME into its structural identity.
 *
 * @param {string} apiName raw market name from the odds feed
 * @returns {{ betType: string, period: string, scope: string }}
 */
export function classifyOuMarketName(apiName) {
  const n = classifierText(apiName);
  if (!n) return { betType: "unknown", period: "unknown", scope: "unknown" };

  // --- betType: explicit non-total structures first, then Over/Under totals ---
  let betType = "total";
  if (/\b1x2\b/.test(n)) betType = "1x2";
  else if (/\b3 way\b/.test(n)) betType = "total_3way";
  else if (/handicap/.test(n)) betType = "handicap";
  else if (/race to/.test(n)) betType = "race_to";
  else if (/\bodd\b.*\beven\b|\beven\b.*\bodd\b/.test(n)) betType = "odd_even";
  else if (/range|between/.test(n)) betType = "range";
  else if (/multicorner/.test(n)) betType = "multi";
  else if (/double chance/.test(n)) betType = "double_chance";
  else if (/correct score|exact score/.test(n)) betType = "correct_score";

  // --- period ---
  let period = "full_match";
  if (/\b(1st half|first half|half time|halftime|ht)\b|\b1h\b/.test(n)) period = "first_half";
  else if (/\b(2nd half|second half)\b|\b2h\b/.test(n)) period = "second_half";
  else if (/\b\d+\s*m\b|\bmin(ute)?s?\b|extra time|overtime|penalt/.test(n)) {
    // Time-interval / ET / penalty markets: a real period, but not one the model
    // or settlement understands — refuse to guess.
    period = "unknown";
  }

  // --- scope ---
  const hasHome = /\bhome\b/.test(n);
  const hasAway = /\baway\b/.test(n);
  let scope = "match";
  if (hasHome && hasAway) scope = "unknown";
  else if (hasHome) scope = "home";
  else if (hasAway) scope = "away";
  else if (/\bteam\b/.test(n)) scope = "unknown"; // "team" without saying which

  return { betType, period, scope };
}

/**
 * The identity a discovery `kind` expects its markets to have.
 * Every Over/Under flow states what it is looking for; anything else scores 0.
 */
export function expectedIdentityForKind(kind) {
  switch (String(kind || "generic")) {
    case "shots_on_target_home":
      return { betType: "total", period: "full_match", scope: "home" };
    case "shots_on_target_away":
      return { betType: "total", period: "full_match", scope: "away" };
    case "first_half_goals":
      return { betType: "total", period: "first_half", scope: "match" };
    default:
      // corners / cards / shots_total / shots_on_target / goals / generic
      return { betType: "total", period: "full_match", scope: "match" };
  }
}

/**
 * Strict identity match. "unknown" on either side never matches anything —
 * an unclassifiable market is not a permitted market.
 */
export function identityMatches(actual, expected) {
  if (!actual || !expected) return false;
  for (const key of ["betType", "period", "scope"]) {
    const a = actual[key];
    const e = expected[key];
    if (!a || !e || a === "unknown" || e === "unknown" || a !== e) return false;
  }
  return true;
}

/** True when a selection/candidate carries a known (non-unknown) period and scope. */
export function hasKnownIdentity(sel) {
  const period = sel?.period;
  const scope = sel?.scope;
  return (
    typeof period === "string" &&
    period !== "unknown" &&
    typeof scope === "string" &&
    scope !== "unknown"
  );
}

/**
 * Lossless line label. `toFixed(1)` turned the real bookmaker line 10.25 into
 * "10.3" — a line no book quotes. Numbers render exactly as they are:
 *   10 → "10" · 10.25 → "10.25" · 10.5 → "10.5" · 10.75 → "10.75"
 */
export function formatLineLabel(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return String(line ?? "");
  return String(n);
}

export default {
  normalizeMarketName,
  classifyOuMarketName,
  expectedIdentityForKind,
  identityMatches,
  hasKnownIdentity,
  formatLineLabel
};
