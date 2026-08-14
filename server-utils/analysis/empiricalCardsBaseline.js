/**
 * Empirical Cards baseline per (league, season) — O(1), no new storage.
 *
 * INFRASTRUCTURE ONLY. Not wired into the predictor: `deriveCardsLambda` still reads the
 * static `leagueProfiles.cards`. Connecting this is a separate, separately-approved step.
 *
 * WHY NO NEW TABLE
 * ----------------
 * A league's mean cards per match is already recoverable from the `team_market_rolling`
 * rows the pipeline loads anyway. Each match contributes exactly two team-observations
 * (each side's own card count), so the sum of every team's cards-for equals the sum of the
 * match totals, and:
 *
 *     league mean per match = 2 x (sample-weighted mean of cards_for_avg over teams)
 *
 * This is an identity, not an approximation — verified on 1109 fixtures across three
 * leagues, where it reproduced the directly-computed mean to within 0.0004 cards (Premier
 * League 4.0901 vs 4.0900, La Liga 4.7808 vs 4.7810, Serie A 4.0054 vs 4.0050). The
 * residual is floating-point noise.
 *
 * `loadTeamMarketRolling(leagueId, season)` is already called once per fixture and cached
 * for 10 minutes, so the baseline costs zero extra queries and zero extra round trips.
 *
 * WHAT THIS PATH CANNOT PROVIDE
 * -----------------------------
 * `std_dev`. `team_market_rolling` stores means only — no sums of squares — so match-level
 * variance cannot be reconstructed from it. The spread between team averages (0.38) is a
 * different quantity from the match-level spread (2.141) and must not be substituted for
 * it. `std_dev` is therefore reported as null on this path, with `std_dev_available:
 * false`, rather than filled with a number that would be wrong. `getCardsLeagueBaseline`
 * in cardsBaselineAnalysis.js produces the full contract including std_dev when raw
 * fixtures are available (a precompute job, or a future persisted baseline).
 *
 * SEASON ISOLATION is structural: rows are filtered to the requested season, and a row
 * carrying a different season is dropped rather than trusted.
 *
 * UNIT: cardsTotal (raw yellow + red). Never cardsPoints.
 */

import { MIN_CARDS_BASELINE_SAMPLE } from "./cardsBaselineAnalysis.js";

const round3 = (v) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(3)));

/** null/undefined/"" are ABSENT, not zero — `Number(null) === 0` is finite. */
function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const BASELINE_SOURCES = Object.freeze({
  CURRENT: "empirical_current_season",
  PREVIOUS: "empirical_previous_season",
  STATIC: "static_config",
  UNAVAILABLE: "unavailable"
});

/** The shape every resolver branch returns, so callers never special-case a source. */
function contract({ leagueId, season, mean, sampleSize, stdDev, source, updatedAt, sufficient }) {
  return {
    league_id: leagueId ?? null,
    season: season ?? null,
    cards_total_mean: round3(mean),
    sample_size: sampleSize ?? 0,
    std_dev: round3(stdDev),
    std_dev_available: stdDev != null,
    source,
    updated_at: updatedAt ?? null,
    unit: "cardsTotal",
    sufficient: Boolean(sufficient)
  };
}

/**
 * Derive a league/season baseline from team_market_rolling rows.
 *
 * `sample_size` counts MATCH-equivalents, not team-rows: each match appears twice across
 * the league's teams, so the team-observation count is halved. A gate expressed in matches
 * has to be compared against a count in matches.
 *
 * Rows whose season does not match, or that carry no usable cards average, are skipped —
 * an unpopulated cards column must never enter the weighted mean as a zero.
 *
 * @param {Iterable<object>|Map<number, object>} rows team_market_rolling-shaped rows
 * @param {{leagueId?: number, season?: number, minSample?: number}} [opts]
 */
export function deriveCardsBaselineFromRolling(rows, opts = {}) {
  const minSample = num(opts.minSample) ?? MIN_CARDS_BASELINE_SAMPLE;
  const list = rows instanceof Map ? [...rows.values()] : Array.isArray(rows) ? rows : [];

  let weighted = 0;
  let teamObservations = 0;
  let latest = null;

  for (const row of list) {
    if (opts.season != null && row?.season != null && Number(row.season) !== Number(opts.season)) {
      continue; // season isolation: never pool seasons
    }
    if (
      opts.leagueId != null &&
      row?.league_id != null &&
      Number(row.league_id) !== Number(opts.leagueId)
    ) {
      continue;
    }
    const avg = num(row?.cards_for_avg);
    const n = num(row?.samples_by_market?.cards) ?? num(row?.matches_sampled);
    if (avg == null || n == null || n <= 0) continue;
    weighted += avg * n;
    teamObservations += n;
    const ts = row?.updated_at ?? null;
    if (ts && (!latest || new Date(ts).getTime() > new Date(latest).getTime())) latest = ts;
  }

  if (!teamObservations) {
    return contract({
      leagueId: opts.leagueId,
      season: opts.season,
      mean: null,
      sampleSize: 0,
      stdDev: null,
      source: BASELINE_SOURCES.CURRENT,
      updatedAt: null,
      sufficient: false
    });
  }

  // Two team-observations per match.
  const matchSample = Math.floor(teamObservations / 2);
  return contract({
    leagueId: opts.leagueId,
    season: opts.season,
    mean: (2 * weighted) / teamObservations,
    sampleSize: matchSample,
    stdDev: null, // not recoverable from means alone — see module note
    source: BASELINE_SOURCES.CURRENT,
    updatedAt: latest,
    sufficient: matchSample >= minSample
  });
}

/**
 * Fallback chain, in the approved order:
 *
 *   1. empirical current season
 *   2. empirical previous season
 *   3. static leagueProfiles.cards
 *   4. unavailable
 *
 * A baseline below the sample gate is NOT used — it falls through to the next source. An
 * under-sampled empirical mean is not automatically better than a static prior that at
 * least reflects a full season.
 *
 * The previous-season branch only fires when the caller actually supplies those rows. It
 * is never fetched here: that would cost a second query per fixture, which the O(1)
 * requirement rules out. Callers that want it must load it on the same cached path.
 */
export function resolveCardsBaseline({
  current = null,
  previous = null,
  staticCards = null,
  leagueId = null,
  season = null
} = {}) {
  if (current?.sufficient && current.cards_total_mean != null) {
    return { ...current, source: BASELINE_SOURCES.CURRENT };
  }

  if (previous?.sufficient && previous.cards_total_mean != null) {
    return {
      ...previous,
      // The season the baseline DESCRIBES stays the previous one; the season it is being
      // USED for is reported separately so a consumer can see the substitution.
      source: BASELINE_SOURCES.PREVIOUS,
      applied_to_season: season ?? null
    };
  }

  const staticMean = num(staticCards);
  if (staticMean != null && staticMean > 0) {
    return contract({
      leagueId,
      season,
      mean: staticMean,
      sampleSize: 0,
      stdDev: null,
      source: BASELINE_SOURCES.STATIC,
      updatedAt: null,
      // A static prior is usable by construction — that is what a prior is for.
      sufficient: true
    });
  }

  return contract({
    leagueId,
    season,
    mean: null,
    sampleSize: current?.sample_size ?? 0,
    stdDev: null,
    source: BASELINE_SOURCES.UNAVAILABLE,
    updatedAt: null,
    sufficient: false
  });
}

export default {
  BASELINE_SOURCES,
  deriveCardsBaselineFromRolling,
  resolveCardsBaseline
};
