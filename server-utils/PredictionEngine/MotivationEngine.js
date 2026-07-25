import { clamp, result, neutral } from "./helpers.js";

/**
 * Free-text fragments API-Football puts in standings[].description for a team
 * still in play for something (title, Europe, promotion, survival). Matched
 * case-insensitively as substrings — "Champion" also catches "Champions League".
 */
const COMPETITION_KEYWORDS = ["champion", "europa", "conference", "promotion", "playoff", "relegation"];

/** Small, flat, additive nudge — deliberately far below the existing rank-gap swings. */
const COMPETITION_BOOST = 0.015;

/**
 * +1 boost when the team's table description names a live competition stake
 * (title race, European spot, promotion/playoff, relegation fight), else 0.
 * Uniform across keywords on purpose — differentiating magnitude per keyword
 * would need real outcome data to justify, which we don't have.
 */
function competitionModifier(description) {
  const d = String(description || "").toLowerCase();
  if (!d) return 0;
  return COMPETITION_KEYWORDS.some((kw) => d.includes(kw)) ? COMPETITION_BOOST : 0;
}

/**
 * Debug-only helper: which keyword (if any) competitionModifier() matched.
 * Pure, side-effect-free, never called from calculate() — does not affect the
 * lambda-facing motivation multiplier in any way. Exists solely so debug
 * metadata (Sprint 2 observability) can report *why* a competition bonus did
 * or didn't apply, without duplicating or touching the scoring logic above.
 */
export function matchedCompetitionKeyword(description) {
  const d = String(description || "").toLowerCase();
  if (!d) return null;
  return COMPETITION_KEYWORDS.find((kw) => d.includes(kw)) || null;
}

/**
 * Season-progress proxy for the competition modifier above. There is no
 * total-games-per-season figure anywhere in ctx (leagues vary ~30-38+ rounds,
 * and no field carries it) — only games-played-so-far
 * (standingsRow.all.played). Rather than assume a season length, this uses
 * played-count as an ordinal signal: few games played → stakes described in
 * the table aren't really live yet (dampen); many played → they are (amplify).
 * Returns null (→ neutral ×1 scale) when neither side has a usable count,
 * i.e. gracefully skips instead of guessing.
 */
const SEASON_EARLY_PLAYED_MAX = 10;
const SEASON_LATE_PLAYED_MIN = 25;
function seasonProgressScale(homePlayed, awayPlayed) {
  const played = [homePlayed, awayPlayed].filter((n) => Number.isFinite(n) && n >= 0);
  if (played.length === 0) return null;
  const avgPlayed = played.reduce((a, b) => a + b, 0) / played.length;
  if (avgPlayed <= SEASON_EARLY_PLAYED_MAX) return 0.6;
  if (avgPlayed >= SEASON_LATE_PLAYED_MIN) return 1.4;
  return 1;
}

/**
 * Motivation / table pressure proxies.
 * Uses optional homeMotivation/awayMotivation (0..1) or standings rank gap,
 * then layers a small additive competition-stake nudge (from
 * standings.description) scaled by how far into the season we are.
 * Rank path is directional: underdog slight boost, favourite slight damp when gap is large.
 */
export function calculate(ctx) {
  const homeDescription = ctx.homeStandingsRow?.description;
  const awayDescription = ctx.awayStandingsRow?.description;
  const homePlayed = Number(ctx.homeStandingsRow?.all?.played);
  const awayPlayed = Number(ctx.awayStandingsRow?.all?.played);
  const seasonScale = seasonProgressScale(homePlayed, awayPlayed) ?? 1;
  const homeCompetitionBonus = competitionModifier(homeDescription) * seasonScale;
  const awayCompetitionBonus = competitionModifier(awayDescription) * seasonScale;

  if (ctx.homeMotivation != null || ctx.awayMotivation != null) {
    const hm = clamp(Number(ctx.homeMotivation) || 0.5, 0, 1);
    const am = clamp(Number(ctx.awayMotivation) || 0.5, 0, 1);
    const home = clamp(0.96 + hm * 0.08 + homeCompetitionBonus, 0.92, 1.08);
    const away = clamp(0.96 + am * 0.08 + awayCompetitionBonus, 0.92, 1.08);
    return result((home + away) / 2, 0.4, {
      home,
      away,
      source: "explicit",
      available: true
    });
  }

  const rh = Number(ctx.homeStandingsRow?.rank);
  const ra = Number(ctx.awayStandingsRow?.rank);
  if (!Number.isFinite(rh) || !Number.isFinite(ra)) {
    return neutral({ reason: "motivation_not_provided", extensionPoint: true });
  }

  const gap = Math.abs(rh - ra);
  // Closer ranks → mutual pressure; large gap → underdog lift / favourite damp.
  let home = 1;
  let away = 1;
  if (gap <= 3) {
    home = 1.02;
    away = 1.02;
  } else if (gap >= 8) {
    const homeUnderdog = rh > ra;
    home = homeUnderdog ? 1.025 : 0.985;
    away = homeUnderdog ? 0.985 : 1.025;
  }
  home = clamp(home + homeCompetitionBonus, 0.92, 1.08);
  away = clamp(away + awayCompetitionBonus, 0.92, 1.08);

  return result((home + away) / 2, 0.3, {
    home,
    away,
    rankHome: rh,
    rankAway: ra,
    gap,
    source: "standings_rank",
    available: true
  });
}

export const MotivationEngine = { calculate, name: "motivation" };
