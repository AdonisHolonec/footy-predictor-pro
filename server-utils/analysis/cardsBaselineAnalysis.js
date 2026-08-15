/**
 * Cards league/season baseline — empirical, leakage-free.
 *
 * ANALYSIS ONLY. Not imported by the prediction pipeline. Increment D showed the
 * configured baselines in leagueProfiles.cards are off by up to 0.80 cards per match and,
 * for Serie A, wrong in the opposite direction (configured 4.8, observed 4.005). That
 * error is roughly four times the entire measured referee effect, which is why the
 * baseline — not the referee — is where the accuracy lives.
 *
 * UNIT: cardsTotal (raw yellow + red), the unit Increment D confirmed leagueProfiles.cards
 * is already expressed in (global observed 4.295 vs configured default 4.2).
 *
 * Two invariants this module exists to enforce:
 *   1. SEASON ISOLATION — a baseline is per (league, season). Seasons are never pooled:
 *      competitions change refereeing directives between them, and the 2025 spread across
 *      three leagues alone is 0.78 cards.
 *   2. NO TEMPORAL LEAKAGE — when a `before` cutoff is supplied, only fixtures that had
 *      already finished are used. A baseline that includes the fixture it is predicting,
 *      or anything after it, measures nothing.
 */

const round3 = (v) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(3)));

/** null/undefined/"" are ABSENT, not zero — `Number(null) === 0` is finite. */
function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Minimum fixtures before a league/season baseline is treated as usable.
 *
 * Chosen from observed convergence, not picked round: the standard error of the mean is
 * sd/sqrt(n), and with a match-level sd of ~2.14 cards, n = 40 puts the baseline within
 * ~0.34 cards (1 SE) of its season value — below the 0.49-0.80 error the static config
 * carries today, which is the bar this has to beat to be worth using. Below roughly n = 20
 * the sampling error exceeds the config's own error, so switching would lose accuracy
 * rather than gain it. See the Increment E convergence sweep for the measured curve.
 */
export const MIN_CARDS_BASELINE_SAMPLE = 40;

/**
 * Fixtures belonging to exactly one (league, season), optionally restricted to those that
 * kicked off strictly before a cutoff.
 *
 * The cutoff is exclusive on purpose: a fixture must never contribute to the baseline used
 * to predict it.
 */
export function selectBaselineFixtures(fixtures, { leagueId, season, before } = {}) {
  const cutoff = before == null ? null : new Date(before).getTime();
  return (Array.isArray(fixtures) ? fixtures : []).filter((f) => {
    if (leagueId != null && Number(f?.leagueId) !== Number(leagueId)) return false;
    if (season != null && Number(f?.season) !== Number(season)) return false;
    if (num(f?.cardsTotal) == null) return false; // UNKNOWN never enters a baseline
    if (cutoff == null) return true;
    const t = new Date(f?.date || 0).getTime();
    return Number.isFinite(t) && t < cutoff;
  });
}

/**
 * Empirical cards baseline for one league and season.
 *
 * @param {Array<{leagueId, season, date, cardsTotal}>} fixtures
 * @param {{leagueId?: number, season?: number, before?: string|number|Date, minSample?: number}} [opts]
 */
export function getCardsLeagueBaseline(fixtures, opts = {}) {
  const minSample = num(opts.minSample) ?? MIN_CARDS_BASELINE_SAMPLE;
  const selected = selectBaselineFixtures(fixtures, opts);
  const values = selected.map((f) => num(f.cardsTotal)).filter((v) => v != null);
  const n = values.length;

  const base = {
    leagueId: opts.leagueId ?? null,
    season: opts.season ?? null,
    before: opts.before ?? null,
    sampleSize: n,
    sufficient: n >= minSample,
    minSampleRequired: minSample,
    unit: "cardsTotal",
    source: "observed_fixtures"
  };

  if (!n) {
    return { ...base, mean: null, median: null, stdDev: null, min: null, max: null };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const mid = n / 2;
  const median = n % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  const stdDev = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / n);

  return {
    ...base,
    mean: round3(mean),
    median: round3(median),
    stdDev: round3(stdDev),
    min: sorted[0],
    max: sorted[n - 1]
  };
}

/**
 * Per-side card observations for one fixture, in the shape aggregateRollingForTeam
 * consumes. Deliberately re-expressed as yellow/red rather than a total so the existing
 * rolling aggregation — including its UNKNOWN handling — is reused, not reimplemented.
 */
export function sidesForTeam(fixture, teamId) {
  if (!fixture) return null;
  const isHome = Number(fixture.homeTeamId) === Number(teamId);
  const isAway = Number(fixture.awayTeamId) === Number(teamId);
  if (!isHome && !isAway) return null;
  const own = isHome ? fixture.homeSide : fixture.awaySide;
  const opp = isHome ? fixture.awaySide : fixture.homeSide;
  if (!own || !opp) return null;
  return {
    fixtureId: fixture.fixtureId,
    date: fixture.date,
    isHome,
    teamStats: { yellowCards: own.yellow ?? null, redCards: own.red ?? null },
    opponentStats: { yellowCards: opp.yellow ?? null, redCards: opp.red ?? null }
  };
}

/**
 * A team's matches that finished strictly before a cutoff, oldest first, capped to a window.
 *
 * This is the leakage guard for team rolling. The production rebuild script takes
 * `matches.slice(-windowSize)` of a whole season, which is correct for a nightly snapshot
 * but includes matches in the future of any given fixture — unusable for backtesting.
 */
export function priorMatchesForTeam(fixtures, teamId, { before, window = 15 } = {}) {
  const cutoff = before == null ? Infinity : new Date(before).getTime();
  return (Array.isArray(fixtures) ? fixtures : [])
    .filter((f) => {
      const t = new Date(f?.date || 0).getTime();
      return Number.isFinite(t) && t < cutoff;
    })
    .map((f) => sidesForTeam(f, teamId))
    .filter(Boolean)
    .sort((a, b) => {
      const d = new Date(a.date).getTime() - new Date(b.date).getTime();
      return d !== 0 ? d : Number(a.fixtureId) - Number(b.fixtureId);
    })
    .slice(-window);
}

export default {
  MIN_CARDS_BASELINE_SAMPLE,
  selectBaselineFixtures,
  getCardsLeagueBaseline,
  sidesForTeam,
  priorMatchesForTeam
};
