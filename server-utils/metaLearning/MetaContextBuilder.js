/**
 * Projects a predictions_history row into the meta_fixture_context shape: the derived
 * context buckets every downstream segmentation keys off (league tier, season phase,
 * odds band, favouritism, market move).
 *
 * PURE + READ-ONLY. No I/O, no upstream API calls, no dependency on PredictorV3 /
 * server-utils/PredictionEngine / pipeline / confidence / value. Every value is derived
 * from columns predictions_history already stores, which is why the whole table can be
 * rebuilt from scratch at any time and why `context_version` can evolve the bucket
 * definitions without destroying history.
 */

import {
  CONTEXT_VERSION,
  ODDS_BANDS,
  CONFIDENCE_BUCKETS,
  CONFIDENCE_DELTA_BUCKETS,
  FAVOURITISM,
  SEASON_PHASE,
  MARKET_MOVE,
  getLeagueTier
} from "./metaLearningConfig.js";

const MS_PER_DAY = 86400000;

function toNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Bucket lookup over half-open [low, high) ranges. */
function bucketFor(buckets, value) {
  if (value == null || !Number.isFinite(value)) return null;
  for (const b of buckets) {
    if (value >= b.low && value < b.high) return b.key;
  }
  return null;
}

export function resolveOddsBand(odd) {
  const n = toNumber(odd);
  if (n == null || n <= 1) return null;
  return bucketFor(ODDS_BANDS, n);
}

export function resolveConfidenceBucket(confidence) {
  return bucketFor(CONFIDENCE_BUCKETS, toNumber(confidence));
}

export function resolveConfidenceDeltaBucket(delta) {
  return bucketFor(CONFIDENCE_DELTA_BUCKETS, toNumber(delta));
}

/**
 * De-vigged 1X2 implied probabilities by proportional normalisation of 1/odds.
 *
 * Deliberately NOT shinImpliedProbs() from advancedMath.js: the only consumer here is a
 * four-way favouritism bucket, where Shin's extra precision cannot change the label, and
 * importing it would widen this layer's dependency surface beyond what the design
 * documents and the import-boundary test enforces.
 */
export function impliedProbs1x2(oddsHome, oddsDraw, oddsAway) {
  const h = toNumber(oddsHome);
  const d = toNumber(oddsDraw);
  const a = toNumber(oddsAway);
  if (h == null || d == null || a == null) return null;
  if (h <= 1 || d <= 1 || a <= 1) return null;

  const raw = { home: 1 / h, draw: 1 / d, away: 1 / a };
  const sum = raw.home + raw.draw + raw.away;
  if (!(sum > 0)) return null;
  return { home: raw.home / sum, draw: raw.draw / sum, away: raw.away / sum };
}

/**
 * @returns {{ favouriteSide: 'home'|'away'|'none'|null, favouriteImpliedProb: number|null,
 *   favouritismClass: string|null }}
 */
export function resolveFavouritism(oddsHome, oddsDraw, oddsAway) {
  const probs = impliedProbs1x2(oddsHome, oddsDraw, oddsAway);
  if (!probs) return { favouriteSide: null, favouriteImpliedProb: null, favouritismClass: null };

  const spread = Math.abs(probs.home - probs.away);
  const favouriteSide = probs.home > probs.away ? "home" : probs.away > probs.home ? "away" : "none";
  const favouriteImpliedProb = Math.max(probs.home, probs.away);

  let favouritismClass;
  if (favouriteImpliedProb >= FAVOURITISM.clearFavouriteMinProb) {
    favouritismClass = "clear_favourite";
  } else if (favouriteImpliedProb >= FAVOURITISM.moderateFavouriteMinProb) {
    favouritismClass = "moderate_favourite";
  } else if (spread < FAVOURITISM.balancedMaxHomeAwaySpread) {
    favouritismClass = "balanced";
  } else {
    favouritismClass = "outsider_led";
  }

  return {
    favouriteSide,
    favouriteImpliedProb: Number(favouriteImpliedProb.toFixed(6)),
    favouritismClass
  };
}

/**
 * Season start for a league, honouring its own calendar. BacktestAnalytics.seasonStartIso()
 * hardcodes August, which is correct for European leagues and wrong for calendar-year
 * competitions (MLS, Brazil) — bucketing those against an August boundary would put
 * mid-season fixtures in "late" and make the dimension meaningless for exactly the
 * leagues where an external provider is most likely to have an edge.
 */
export function seasonStartFor(kickoffAt, leagueId) {
  const ts = kickoffAt ? new Date(kickoffAt) : null;
  if (!ts || Number.isNaN(ts.getTime())) return null;

  const { seasonStartMonth } = getLeagueTier(leagueId);
  const year = ts.getUTCFullYear();
  const month = ts.getUTCMonth() + 1; // 1-based, to match config
  const startYear = month >= seasonStartMonth ? year : year - 1;
  return new Date(Date.UTC(startYear, seasonStartMonth - 1, 1, 0, 0, 0));
}

/**
 * @returns {{ seasonPhase: 'early'|'mid'|'late'|null, daysSinceSeasonStart: number|null }}
 */
export function resolveSeasonPhase(kickoffAt, leagueId) {
  const start = seasonStartFor(kickoffAt, leagueId);
  if (!start) return { seasonPhase: null, daysSinceSeasonStart: null };

  const ts = new Date(kickoffAt);
  const days = Math.floor((ts.getTime() - start.getTime()) / MS_PER_DAY);
  if (!Number.isFinite(days) || days < 0) return { seasonPhase: null, daysSinceSeasonStart: null };

  const seasonPhase =
    days <= SEASON_PHASE.earlyMaxDays ? "early" : days <= SEASON_PHASE.midMaxDays ? "mid" : "late";
  return { seasonPhase, daysSinceSeasonStart: days };
}

/** Our published pick reduced to a 1X2 side, or null when it is not a 1X2 pick. */
export function pickToSide(pick) {
  const p = String(pick || "").trim().toLowerCase();
  if (p === "1") return "home";
  if (p === "2") return "away";
  if (p === "x") return "draw";
  return null;
}

/**
 * Market move on the side we actually selected. 1X2 only — closing odds are captured for
 * the 1X2 columns only (migration 030), so any other market is honestly reported as
 * 'unknown' rather than assumed flat.
 *
 * A shortening price (negative pct) is 'toward': the market moved our way after we
 * published. Returns 'unknown' when no closing price was captured.
 */
export function resolveMarketMove(row, side) {
  const openingBySide = { home: row?.odds_home, draw: row?.odds_draw, away: row?.odds_away };
  const closingBySide = {
    home: row?.closing_odds_home,
    draw: row?.closing_odds_draw,
    away: row?.closing_odds_away
  };

  if (!side) return { marketMovePct: null, marketMoveClass: "unknown" };
  const opening = toNumber(openingBySide[side]);
  const closing = toNumber(closingBySide[side]);
  if (opening == null || closing == null || opening <= 1 || closing <= 1) {
    return { marketMovePct: null, marketMoveClass: "unknown" };
  }

  const pct = ((closing - opening) / opening) * 100;
  const t = MARKET_MOVE.thresholdPct;
  const marketMoveClass = pct <= -t ? "toward" : pct >= t ? "against" : "flat";
  return { marketMovePct: Number(pct.toFixed(4)), marketMoveClass };
}

const FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);

/**
 * Build one meta_fixture_context row.
 *
 * @param {object} row  a predictions_history row (snake_case columns)
 * @param {{ modelVersion: string, homeTeamId?: number|null, awayTeamId?: number|null }} opts
 *   Team ids are not stored on predictions_history; the projector recovers them from
 *   prediction_benchmarks.api_raw when available and passes them through here, so the
 *   sweep's /fixtures lookup is never repeated for analytics.
 * @returns {object|null} null when the row has no usable fixture id
 */
export function buildFixtureContext(row, opts = {}) {
  if (!row) return null;
  const fixtureId = toNumber(row.fixture_id);
  if (fixtureId == null || fixtureId <= 0) return null;

  const leagueId = toNumber(row.league_id);
  const tier = getLeagueTier(leagueId);
  const favouritism = resolveFavouritism(row.odds_home, row.odds_draw, row.odds_away);
  const season = resolveSeasonPhase(row.kickoff_at, leagueId);
  const side = pickToSide(row.recommended_pick);
  const move = resolveMarketMove(row, side);

  // Only meaningful for 1X2 picks; null (not false) elsewhere, so "we backed the
  // outsider" is never confused with "this wasn't a 1X2 bet".
  const pickIsFavourite =
    side && favouritism.favouriteSide && favouritism.favouriteSide !== "none"
      ? side === favouritism.favouriteSide
      : null;

  const oddForBand = toNumber(row.raw_payload?.recommended?.odd);

  return {
    fixture_id: fixtureId,
    model_version: String(opts.modelVersion || row.model_version || ""),
    context_version: CONTEXT_VERSION,

    league_id: leagueId,
    league_name: row.league_name || tier.name || null,
    league_tier: tier.tier,
    league_quality: tier.quality,

    home_team_id: toNumber(opts.homeTeamId),
    away_team_id: toNumber(opts.awayTeamId),

    kickoff_at: row.kickoff_at || null,
    season_phase: season.seasonPhase,
    days_since_season_start: season.daysSinceSeasonStart,

    odds_home: toNumber(row.odds_home),
    odds_draw: toNumber(row.odds_draw),
    odds_away: toNumber(row.odds_away),
    closing_odds_home: toNumber(row.closing_odds_home),
    closing_odds_draw: toNumber(row.closing_odds_draw),
    closing_odds_away: toNumber(row.closing_odds_away),

    favourite_side: favouritism.favouriteSide,
    favourite_implied_prob: favouritism.favouriteImpliedProb,
    favouritism_class: favouritism.favouritismClass,
    pick_is_favourite: pickIsFavourite,
    odds_band: resolveOddsBand(oddForBand),

    market_move_pct: move.marketMovePct,
    market_move_class: move.marketMoveClass,

    match_status: row.match_status || null,
    score_home: toNumber(row.score_home),
    score_away: toNumber(row.score_away),
    settled: FINAL_STATUSES.has(String(row.match_status || "").toUpperCase()),

    computed_at: new Date().toISOString()
  };
}

/** @param {object[]} rows predictions_history rows @returns {object[]} */
export function buildFixtureContexts(rows, opts = {}) {
  const out = [];
  for (const row of rows || []) {
    const ctx = buildFixtureContext(row, {
      ...opts,
      homeTeamId: opts.teamIdsByFixture?.get?.(Number(row.fixture_id))?.homeTeamId ?? null,
      awayTeamId: opts.teamIdsByFixture?.get?.(Number(row.fixture_id))?.awayTeamId ?? null
    });
    if (ctx) out.push(ctx);
  }
  return out;
}

export default {
  buildFixtureContext,
  buildFixtureContexts,
  resolveOddsBand,
  resolveConfidenceBucket,
  resolveConfidenceDeltaBucket,
  resolveFavouritism,
  resolveSeasonPhase,
  resolveMarketMove,
  impliedProbs1x2,
  pickToSide,
  seasonStartFor
};
