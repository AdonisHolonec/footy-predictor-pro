import { getConfidenceWeights, normalizeConfidenceWeights } from "./confidenceWeights.js";

/**
 * Independent Confidence Engine.
 *
 * This module NEVER reads or writes λ_home/λ_away, Poisson probabilities, pick selection, or
 * `recommended.confidence`. It only looks at contextual signals already gathered elsewhere
 * (attack/defense averages, form, standings, H2H, rest days, referee, injuries, odds consensus,
 * team statistics sample richness) and turns them into a 0-100 "how much reliable context do we
 * have for this match" score per dimension, plus a weighted overall score.
 *
 * When a dimension has no usable data we do NOT invent fake precision — we return a neutral ~50
 * and mark `available=false` for that dimension so the UI can dim it.
 */

const EPS = 1e-6;

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function round0(n) {
  return Math.round(clamp(n, 0, 100));
}

/** Linear map of a strength ratio (1.0 = league-average) onto a 0-100 score, centered at 50. */
function ratioToScore(ratio, span = 0.5) {
  if (!Number.isFinite(ratio)) return 50;
  return clamp(50 + ((ratio - 1) / span) * 50, 0, 100);
}

/** Small deterministic hash (0..1) so the same referee name always produces the same soft score. */
function hashUnit(str) {
  const s = String(str || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return (h % 1000) / 1000;
}

function tierWord(score) {
  if (score >= 66) return "strong";
  if (score <= 34) return "weak";
  return "average";
}

function leagueAvgFrom(ctx) {
  return Number(ctx?.leagueParams?.leagueAvg ?? ctx?.leagueParams?.leagueAvgGoals) || 1.35;
}

/** Attack: home GF-home + away GF-away vs league average (match attack signal). */
function scoreAttack(ctx) {
  const leagueAvg = leagueAvgFrom(ctx);
  const leagueAvgHome = Number(ctx?.leagueParams?.leagueAvgHome) || leagueAvg;
  const leagueAvgAway = Number(ctx?.leagueParams?.leagueAvgAway) || leagueAvg;
  const gfHome = Number(ctx?.hStats?.gfHome);
  const gfAway = Number(ctx?.aStats?.gfAway);
  const available = Number.isFinite(gfHome) && Number.isFinite(gfAway) && gfHome > 0 && gfAway > 0;

  if (!available) {
    return { score: 50, available: false, note: "Attack 50 — no team goals-for data available (neutral)" };
  }

  const homeRatio = gfHome / Math.max(EPS, leagueAvgHome);
  const awayRatio = gfAway / Math.max(EPS, leagueAvgAway);
  const score = (ratioToScore(homeRatio) + ratioToScore(awayRatio)) / 2;
  const word = tierWord(score);
  return {
    score,
    available: true,
    note: `Attack ${round0(score)} — ${word} combined home/away GF vs league average`
  };
}

/** Defense: lower GA vs league average → higher score (inverted). */
function scoreDefense(ctx) {
  const leagueAvg = leagueAvgFrom(ctx);
  const leagueAvgHome = Number(ctx?.leagueParams?.leagueAvgHome) || leagueAvg;
  const leagueAvgAway = Number(ctx?.leagueParams?.leagueAvgAway) || leagueAvg;
  const gaHome = Number(ctx?.hStats?.gaHome);
  const gaAway = Number(ctx?.aStats?.gaAway);
  const available = Number.isFinite(gaHome) && Number.isFinite(gaAway) && gaHome > 0 && gaAway > 0;

  if (!available) {
    return { score: 50, available: false, note: "Defense 50 — no team goals-against data available (neutral)" };
  }

  // Invert: fewer goals conceded relative to league average → higher ratio → higher score.
  const homeRatio = Math.max(EPS, leagueAvgHome) / Math.max(EPS, gaHome);
  const awayRatio = Math.max(EPS, leagueAvgAway) / Math.max(EPS, gaAway);
  const score = (ratioToScore(homeRatio) + ratioToScore(awayRatio)) / 2;
  const word = tierWord(score);
  return {
    score,
    available: true,
    note: `Defense ${round0(score)} — ${word} combined home/away GA vs league average`
  };
}

/** Form: map the [0.88, 1.12] multiplier range (extractFormMultiplier-like) onto 0-100. */
function scoreForm(ctx) {
  const hasHomeSignal = typeof ctx?.hFormMulti === "number" || Boolean(ctx?.formHome);
  const hasAwaySignal = typeof ctx?.aFormMulti === "number" || Boolean(ctx?.formAway);
  const available = hasHomeSignal || hasAwaySignal;

  const homeMulti = Number.isFinite(Number(ctx?.hFormMulti)) ? Number(ctx.hFormMulti) : 1.0;
  const awayMulti = Number.isFinite(Number(ctx?.aFormMulti)) ? Number(ctx.aFormMulti) : 1.0;

  const mapMulti = (m) => clamp(((clamp(m, 0.88, 1.12) - 0.88) / (1.12 - 0.88)) * 100, 0, 100);
  const score = (mapMulti(homeMulti) + mapMulti(awayMulti)) / 2;

  if (!available) {
    return { score: 50, available: false, note: "Form 50 — no recent W/D/L data available (neutral)" };
  }
  const word = tierWord(score);
  return {
    score,
    available: true,
    note: `Form ${round0(score)} — ${word} recent W/D/L momentum (home+away avg)`
  };
}

function standingsSideScore(row) {
  const played = Math.max(1, Number(row?.all?.played ?? row?.played) || 1);
  const points = Number(row?.all?.points ?? row?.points);
  if (!Number.isFinite(points)) return null;
  const ppg = points / played;
  // 0 pts/game -> 0, 1.5 (avg) -> 50, 3 (max) -> 100.
  return clamp((ppg / 3) * 100, 0, 100);
}

/** Standings: points-per-game for both sides (rank/table position when available). */
function scoreStandings(ctx) {
  const rowH = ctx?.homeStandingsRow;
  const rowA = ctx?.awayStandingsRow;
  const homeScore = rowH ? standingsSideScore(rowH) : null;
  const awayScore = rowA ? standingsSideScore(rowA) : null;
  const available = homeScore != null && awayScore != null;

  if (!available) {
    return { score: 50, available: false, note: "Standings 50 — no league table rows available (neutral)" };
  }
  const score = (homeScore + awayScore) / 2;
  const word = tierWord(score);
  return {
    score,
    available: true,
    note: `Standings ${round0(score)} — ${word} points-per-game across both sides`
  };
}

/** H2H: aggregate goal output across prior meetings vs league average (a reliability signal, not a pick). */
function scoreH2H(ctx) {
  const fixtures = Array.isArray(ctx?.h2hFixtures) ? ctx.h2hFixtures : [];
  if (fixtures.length === 0) {
    return { score: 50, available: false, note: "H2H 50 — no prior meetings on record (neutral)" };
  }

  const homeId = String(ctx?.homeTeamId ?? "");
  let homeGoals = 0;
  let awayGoals = 0;
  let count = 0;
  for (const f of fixtures) {
    const gh = Number(f?.goals?.home);
    const ga = Number(f?.goals?.away);
    if (!Number.isFinite(gh) || !Number.isFinite(ga)) continue;
    const fixtureHomeId = String(f?.teams?.home?.id ?? "");
    if (fixtureHomeId === homeId) {
      homeGoals += gh;
      awayGoals += ga;
    } else {
      homeGoals += ga;
      awayGoals += gh;
    }
    count += 1;
  }

  if (count === 0) {
    return { score: 50, available: false, note: "H2H 50 — prior meetings had no usable score data (neutral)" };
  }

  const leagueAvg = leagueAvgFrom(ctx);
  const avgHome = homeGoals / count;
  const avgAway = awayGoals / count;
  const combinedRatio = (avgHome + avgAway) / (2 * Math.max(EPS, leagueAvg));
  const score = ratioToScore(combinedRatio);
  const word = tierWord(score);
  return {
    score,
    available: true,
    note: `H2H ${round0(score)} — ${word} combined goal output across ${count} prior meeting${count === 1 ? "" : "s"}`
  };
}

function restDaySideScore(days) {
  if (!Number.isFinite(days)) return null;
  if (days < 0) return 40;
  if (days < 3) return clamp(20 + days * 10, 20, 50); // short turnaround → fatigue risk
  if (days <= 8) return clamp(60 + (1 - Math.abs(days - 7) / 3) * 35, 60, 96); // sweet spot ~6-8 days
  if (days <= 14) return clamp(96 - ((days - 8) / 6) * 40, 55, 96);
  return clamp(55 - (days - 14) * 2, 25, 55); // long layoff → rustiness risk
}

/** Rest days: optimal ~6-8 days between matches; too short or too long lowers the score. */
function scoreRestDays(ctx) {
  const explicitHome = Number(ctx?.restDaysHome);
  const explicitAway = Number(ctx?.restDaysAway);

  const derive = (fixtureDate, lastDate) => {
    if (!fixtureDate || !lastDate) return null;
    const f = new Date(fixtureDate).getTime();
    const l = new Date(lastDate).getTime();
    if (!Number.isFinite(f) || !Number.isFinite(l)) return null;
    return (f - l) / 86400000;
  };

  const homeDays = Number.isFinite(explicitHome)
    ? explicitHome
    : derive(ctx?.fixtureDate, ctx?.homeLastMatchDate);
  const awayDays = Number.isFinite(explicitAway)
    ? explicitAway
    : derive(ctx?.fixtureDate, ctx?.awayLastMatchDate);

  const homeScore = restDaySideScore(homeDays);
  const awayScore = restDaySideScore(awayDays);
  const available = homeScore != null && awayScore != null;

  if (!available) {
    return { score: 50, available: false, note: "Rest Days 50 — no prior-match dates available (neutral)" };
  }
  const score = (homeScore + awayScore) / 2;
  const word = tierWord(score);
  return {
    score,
    available: true,
    note: `Rest Days ${round0(score)} — ${word} recovery window (home ${homeDays.toFixed(0)}d / away ${awayDays.toFixed(0)}d)`
  };
}

/** Referee: real stats when we have them; a stable soft score from the name only when we don't. */
function scoreReferee(ctx) {
  const stats = ctx?.refereeStats;
  const name = ctx?.refereeName;

  if (stats && Number.isFinite(Number(stats.avgGoals))) {
    const leagueTotalAvg = leagueAvgFrom(ctx) * 2;
    const ratio = Number(stats.avgGoals) / Math.max(EPS, leagueTotalAvg);
    // Referees are a mild signal — keep the range tighter than attack/defense.
    const score = clamp(50 + (ratio - 1) * 60, 25, 75);
    const word = tierWord(score);
    return {
      score,
      available: true,
      note: `Referee ${round0(score)} — ${word} card/goal tendency from recorded stats`
    };
  }

  if (name) {
    const score = 55 + Math.round((hashUnit(name) - 0.5) * 6); // stable ~52-58
    return {
      score: clamp(score, 0, 100),
      available: false,
      note: `Referee ${round0(score)} — name known (${name}) but no tendency stats on file`
    };
  }

  return { score: 50, available: false, note: "Referee 50 — no referee assigned yet (neutral)" };
}

/** Injuries: fewer reported absences → higher score. Never calls an injuries API on its own. */
function scoreInjuries(ctx) {
  const home = Number(ctx?.injuriesHome);
  const away = Number(ctx?.injuriesAway);
  const available = Number.isFinite(home) && Number.isFinite(away);

  if (!available) {
    return { score: 50, available: false, note: "Injuries 50 — no injury report available (neutral)" };
  }
  const total = Math.max(0, home) + Math.max(0, away);
  const score = clamp(100 - (total / 10) * 100, 5, 100);
  const word = tierWord(score);
  return {
    score,
    available: true,
    note: `Injuries ${round0(score)} — ${word} squad availability (${total} reported absence${total === 1 ? "" : "s"})`
  };
}

/** Odds consensus: more bookmakers + lower Shin z (less implied insider/long-shot bias) → higher score. */
function scoreOddsConsensus(ctx) {
  const hasOdds = Boolean(ctx?.hasOdds) || Number.isFinite(Number(ctx?.bookmakersUsed));
  if (!hasOdds) {
    return { score: 50, available: false, note: "Odds Consensus 50 — no market odds available (neutral)" };
  }
  const bookmakersUsed = Number(ctx?.bookmakersUsed) || 0;
  const bookScore = clamp((bookmakersUsed / 12) * 100, 0, 100);
  const shinZ = Number(ctx?.shinZ);
  const zScore = Number.isFinite(shinZ) ? clamp(100 - (shinZ / 0.08) * 100, 0, 100) : 60;
  const score = (bookScore + zScore) / 2;
  const word = tierWord(score);
  return {
    score,
    available: true,
    note: `Odds Consensus ${round0(score)} — ${word} market agreement (${bookmakersUsed} bookmaker${bookmakersUsed === 1 ? "" : "s"}${Number.isFinite(shinZ) ? `, z=${shinZ.toFixed(3)}` : ""})`
  };
}

/** Team statistics: richer sample size + overall model data quality → higher score. */
function scoreTeamStatistics(ctx) {
  const hasStats = Boolean(ctx?.hStats) && Boolean(ctx?.aStats);
  if (!hasStats) {
    return { score: 50, available: false, note: "Team Statistics 50 — no /teams/statistics payload available (neutral)" };
  }
  const homePlayed = Number(ctx?.homePlayed ?? ctx?.hStats?.playedHome ?? ctx?.hStats?.played) || 0;
  const awayPlayed = Number(ctx?.awayPlayed ?? ctx?.aStats?.playedAway ?? ctx?.aStats?.played) || 0;
  const sampleScore = clamp(((homePlayed + awayPlayed) / 2 / 20) * 100, 0, 100);
  const dq = Number(ctx?.dataQuality);
  const dqScore = Number.isFinite(dq) ? clamp(dq * 100, 0, 100) : 50;
  const score = (sampleScore + dqScore) / 2;
  const word = tierWord(score);
  return {
    score,
    available: true,
    note: `Team Statistics ${round0(score)} — ${word} sample richness (H:${homePlayed} / A:${awayPlayed} played)`
  };
}

const DIMENSION_SCORERS = {
  attack: scoreAttack,
  defense: scoreDefense,
  form: scoreForm,
  standings: scoreStandings,
  h2h: scoreH2H,
  restDays: scoreRestDays,
  referee: scoreReferee,
  injuries: scoreInjuries,
  oddsConsensus: scoreOddsConsensus,
  teamStatistics: scoreTeamStatistics
};

/**
 * Builds the independent Confidence Engine block for a single prediction row.
 *
 * `ctx` is a best-effort bag of already-gathered context (team stats, form, standings, H2H,
 * rest days, referee, injuries, odds consensus, team statistics sample/data-quality). Missing
 * fields simply degrade individual dimensions to a neutral ~50 with `available=false` — this
 * function never fetches data itself and never influences λ/Poisson/pick selection.
 */
export function buildConfidenceEngine(ctx = {}) {
  const rawWeights = getConfidenceWeights();
  const weights = normalizeConfidenceWeights(rawWeights);

  const scores = {};
  const available = {};
  const explanation = [];
  let overall = 0;

  for (const key of Object.keys(DIMENSION_SCORERS)) {
    let result;
    try {
      result = DIMENSION_SCORERS[key](ctx);
    } catch {
      result = { score: 50, available: false, note: `${key} 50 — scoring error (neutral)` };
    }
    const score = round0(result.score);
    scores[key] = score;
    available[key] = Boolean(result.available);
    explanation.push(result.note);
    overall += score * (Number(weights[key]) || 0);
  }

  return {
    overall: round0(overall),
    scores,
    available,
    weights,
    explanation
  };
}

export const ConfidenceEngine = { build: buildConfidenceEngine };
