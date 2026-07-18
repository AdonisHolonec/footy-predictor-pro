/**
 * Independent Confidence Engine.
 *
 * NEVER reads/writes λ, Poisson probs, pick selection, or recommended.confidence.
 * Scores contextual reliability 0–100 per dimension + weighted overall.
 */

import {
  getConfidenceWeights,
  normalizeConfidenceWeights,
  confidenceCategory,
  CONFIDENCE_DIMENSION_KEYS
} from "./confidenceWeights.js";

const EPS = 1e-6;

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function round0(n) {
  return Math.round(clamp(n, 0, 100));
}

function ratioToScore(ratio, span = 0.5) {
  if (!Number.isFinite(ratio)) return 50;
  return clamp(50 + ((ratio - 1) / span) * 50, 0, 100);
}

function hashUnit(str) {
  const s = String(str || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
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

function dim(score, available, note, extras = {}) {
  return { score, available, note, ...extras };
}

function scoreAttack(ctx) {
  const leagueAvg = leagueAvgFrom(ctx);
  const leagueAvgHome = Number(ctx?.leagueParams?.leagueAvgHome) || leagueAvg;
  const leagueAvgAway = Number(ctx?.leagueParams?.leagueAvgAway) || leagueAvg;
  const gfHome = Number(ctx?.hStats?.gfHome);
  const gfAway = Number(ctx?.aStats?.gfAway);
  const available = Number.isFinite(gfHome) && Number.isFinite(gfAway) && gfHome > 0 && gfAway > 0;
  if (!available) {
    return dim(50, false, "Attack 50 — no team goals-for data (neutral; lowers certainty for attacking picks)");
  }
  const score = (ratioToScore(gfHome / Math.max(EPS, leagueAvgHome)) + ratioToScore(gfAway / Math.max(EPS, leagueAvgAway))) / 2;
  return dim(score, true, `Attack ${round0(score)} — ${tierWord(score)} GF vs league (home ${gfHome.toFixed(2)} / away ${gfAway.toFixed(2)})`);
}

function scoreDefense(ctx) {
  const leagueAvg = leagueAvgFrom(ctx);
  const leagueAvgHome = Number(ctx?.leagueParams?.leagueAvgHome) || leagueAvg;
  const leagueAvgAway = Number(ctx?.leagueParams?.leagueAvgAway) || leagueAvg;
  const gaHome = Number(ctx?.hStats?.gaHome);
  const gaAway = Number(ctx?.aStats?.gaAway);
  const available = Number.isFinite(gaHome) && Number.isFinite(gaAway) && gaHome > 0 && gaAway > 0;
  if (!available) {
    return dim(50, false, "Defense 50 — no goals-against data (neutral; defensive edges less trusted)");
  }
  const homeRatio = Math.max(EPS, leagueAvgHome) / Math.max(EPS, gaHome);
  const awayRatio = Math.max(EPS, leagueAvgAway) / Math.max(EPS, gaAway);
  const score = (ratioToScore(homeRatio) + ratioToScore(awayRatio)) / 2;
  return dim(score, true, `Defense ${round0(score)} — ${tierWord(score)} GA vs league (fewer conceded → higher)`);
}

function scoreForm(ctx) {
  const hasHome = typeof ctx?.hFormMulti === "number" || Boolean(ctx?.formHome);
  const hasAway = typeof ctx?.aFormMulti === "number" || Boolean(ctx?.formAway);
  const available = hasHome || hasAway;
  const homeMulti = Number.isFinite(Number(ctx?.hFormMulti)) ? Number(ctx.hFormMulti) : 1.0;
  const awayMulti = Number.isFinite(Number(ctx?.aFormMulti)) ? Number(ctx.aFormMulti) : 1.0;
  const mapMulti = (m) => clamp(((clamp(m, 0.88, 1.12) - 0.88) / (1.12 - 0.88)) * 100, 0, 100);
  const score = (mapMulti(homeMulti) + mapMulti(awayMulti)) / 2;
  if (!available) return dim(50, false, "Form 50 — no recent W/D/L form string (neutral)");
  return dim(score, true, `Form ${round0(score)} — ${tierWord(score)} momentum from recent results`);
}

function scoreRecentMatches(ctx) {
  const homeM = Array.isArray(ctx?.homeRecentMatches) ? ctx.homeRecentMatches : [];
  const awayM = Array.isArray(ctx?.awayRecentMatches) ? ctx.awayRecentMatches : [];
  // Fallback: sample size from team stats when recent match lists are absent
  const homePlayed = Number(ctx?.homePlayed ?? ctx?.hStats?.playedHome ?? ctx?.hStats?.played) || 0;
  const awayPlayed = Number(ctx?.awayPlayed ?? ctx?.aStats?.playedAway ?? ctx?.aStats?.played) || 0;

  if (homeM.length === 0 && awayM.length === 0) {
    if (homePlayed <= 0 && awayPlayed <= 0) {
      return dim(50, false, "Recent Matches 50 — no recent fixtures / sample size (neutral)");
    }
    const sampleScore = clamp(((homePlayed + awayPlayed) / 2 / 20) * 100, 0, 100);
    const dq = Number(ctx?.dataQuality);
    const dqScore = Number.isFinite(dq) ? clamp(dq * 100, 0, 100) : 50;
    const score = (sampleScore + dqScore) / 2;
    return dim(
      score,
      true,
      `Recent Matches ${round0(score)} — sample richness proxy (H:${homePlayed} / A:${awayPlayed} played; no match list)`
    );
  }

  const intensity = (matches) => {
    if (!matches.length) return 50;
    const slice = matches.slice(0, 5);
    let gf = 0;
    let ga = 0;
    for (const m of slice) {
      gf += Number(m.goalsFor) || 0;
      ga += Number(m.goalsAgainst) || 0;
    }
    const n = slice.length;
    const gd = (gf - ga) / n;
    return clamp(50 + gd * 12, 15, 95);
  };

  const score = (intensity(homeM) + intensity(awayM)) / 2;
  return dim(
    score,
    true,
    `Recent Matches ${round0(score)} — ${tierWord(score)} last-${Math.max(homeM.length, awayM.length)} intensity (GF/GA trend)`
  );
}

function standingsSideScore(row) {
  const played = Math.max(1, Number(row?.all?.played ?? row?.played) || 1);
  const points = Number(row?.all?.points ?? row?.points);
  if (!Number.isFinite(points)) return null;
  return clamp((points / played / 3) * 100, 0, 100);
}

function scoreStandings(ctx) {
  const homeScore = ctx?.homeStandingsRow ? standingsSideScore(ctx.homeStandingsRow) : null;
  const awayScore = ctx?.awayStandingsRow ? standingsSideScore(ctx.awayStandingsRow) : null;
  if (homeScore == null || awayScore == null) {
    return dim(50, false, "Standings 50 — league table rows missing (neutral)");
  }
  const score = (homeScore + awayScore) / 2;
  return dim(score, true, `Standings ${round0(score)} — ${tierWord(score)} points-per-game for both sides`);
}

function scoreReferee(ctx) {
  const stats = ctx?.refereeStats;
  const name = ctx?.refereeName;
  if (stats && Number.isFinite(Number(stats.avgGoals))) {
    const leagueTotalAvg = leagueAvgFrom(ctx) * 2;
    const ratio = Number(stats.avgGoals) / Math.max(EPS, leagueTotalAvg);
    const score = clamp(50 + (ratio - 1) * 60, 25, 75);
    return dim(score, true, `Referee ${round0(score)} — ${tierWord(score)} tendency from recorded avg goals`);
  }
  if (name) {
    const score = clamp(55 + Math.round((hashUnit(name) - 0.5) * 6), 0, 100);
    return dim(score, false, `Referee ${round0(score)} — name known (${name}) but no tendency stats`);
  }
  return dim(50, false, "Referee 50 — no referee assigned (neutral)");
}

function scoreInjuries(ctx) {
  const list = Array.isArray(ctx?.injuries) ? ctx.injuries : null;
  let home = Number(ctx?.injuriesHome);
  let away = Number(ctx?.injuriesAway);
  if (list && list.length > 0) {
    const homeId = String(ctx?.homeTeamId ?? "");
    const awayId = String(ctx?.awayTeamId ?? "");
    home = 0;
    away = 0;
    for (const inj of list) {
      const tid = String(inj?.teamId ?? "");
      if (tid === homeId) home += 1;
      else if (tid === awayId) away += 1;
    }
  }
  const available = Number.isFinite(home) && Number.isFinite(away);
  if (!available) return dim(50, false, "Injuries 50 — no injury report (neutral; squad risk unknown)");
  const total = Math.max(0, home) + Math.max(0, away);
  const score = clamp(100 - (total / 10) * 100, 5, 100);
  return dim(score, true, `Injuries ${round0(score)} — ${tierWord(score)} availability (${total} absences)`);
}

function scoreLineups(ctx) {
  const homeL = ctx?.homeLineup;
  const awayL = ctx?.awayLineup;
  const confirmed =
    ctx?.lineupsConfirmed === true ||
    homeL?.confirmed === true ||
    awayL?.confirmed === true;
  if (!homeL && !awayL && ctx?.lineupsConfirmed == null) {
    return dim(50, false, "Lineups 50 — lineups not published yet (neutral)");
  }
  let score = confirmed ? 72 : 48;
  const missing =
    (Number(homeL?.missingKeyPlayers) || 0) + (Number(awayL?.missingKeyPlayers) || 0);
  score = clamp(score - missing * 6, 20, 95);
  return dim(
    score,
    Boolean(homeL || awayL || confirmed),
    `Lineups ${round0(score)} — ${confirmed ? "confirmed XI signal" : "provisional/unknown"} (${missing} key absences flagged)`
  );
}

function restDaySideScore(days) {
  if (!Number.isFinite(days)) return null;
  if (days < 0) return 40;
  if (days < 3) return clamp(20 + days * 10, 20, 50);
  if (days <= 8) return clamp(60 + (1 - Math.abs(days - 7) / 3) * 35, 60, 96);
  if (days <= 14) return clamp(96 - ((days - 8) / 6) * 40, 55, 96);
  return clamp(55 - (days - 14) * 2, 25, 55);
}

function scoreRestDays(ctx) {
  const derive = (fixtureDate, lastDate) => {
    if (!fixtureDate || !lastDate) return null;
    const f = new Date(fixtureDate).getTime();
    const l = new Date(lastDate).getTime();
    if (!Number.isFinite(f) || !Number.isFinite(l)) return null;
    return (f - l) / 86400000;
  };
  const homeDays = Number.isFinite(Number(ctx?.restDaysHome))
    ? Number(ctx.restDaysHome)
    : derive(ctx?.fixtureDate, ctx?.homeLastMatchDate);
  const awayDays = Number.isFinite(Number(ctx?.restDaysAway))
    ? Number(ctx.restDaysAway)
    : derive(ctx?.fixtureDate, ctx?.awayLastMatchDate);
  const homeScore = restDaySideScore(homeDays);
  const awayScore = restDaySideScore(awayDays);
  if (homeScore == null || awayScore == null) {
    return dim(50, false, "Rest Days 50 — no prior-match dates (neutral; fatigue unknown)");
  }
  const score = (homeScore + awayScore) / 2;
  return dim(
    score,
    true,
    `Rest Days ${round0(score)} — ${tierWord(score)} recovery (home ${Number(homeDays).toFixed(0)}d / away ${Number(awayDays).toFixed(0)}d)`
  );
}

function scoreHomeAdvantage(ctx) {
  const homeAdv = Number(ctx?.leagueParams?.homeAdv);
  const awayAdv = Number(ctx?.leagueParams?.awayAdv);
  if (!Number.isFinite(homeAdv)) {
    return dim(50, false, "Home Advantage 50 — league homeAdv not calibrated (neutral)");
  }
  // Reliability of home edge signal: mild/typical HA (~1.05–1.12) scores higher than extreme/default-only.
  const typical = clamp(100 - Math.abs(homeAdv - 1.08) * 280, 35, 92);
  const awayPart = Number.isFinite(awayAdv) ? clamp(100 - Math.abs(awayAdv - 0.96) * 200, 35, 92) : 50;
  const score = (typical + awayPart) / 2;
  return dim(
    score,
    true,
    `Home Advantage ${round0(score)} — league params homeAdv=${homeAdv.toFixed(3)}${Number.isFinite(awayAdv) ? ` / awayAdv=${awayAdv.toFixed(3)}` : ""}`
  );
}

function scoreOddsConsensus(ctx) {
  const hasOdds = Boolean(ctx?.hasOdds) || Number.isFinite(Number(ctx?.bookmakersUsed));
  if (!hasOdds) return dim(50, false, "Odds Consensus 50 — no market odds (neutral; price agreement unknown)");
  const bookmakersUsed = Number(ctx?.bookmakersUsed) || 0;
  const bookScore = clamp((bookmakersUsed / 12) * 100, 0, 100);
  const shinZ = Number(ctx?.shinZ);
  const zScore = Number.isFinite(shinZ) ? clamp(100 - (shinZ / 0.08) * 100, 0, 100) : 60;
  const score = (bookScore + zScore) / 2;
  return dim(
    score,
    true,
    `Odds Consensus ${round0(score)} — ${tierWord(score)} market agreement (${bookmakersUsed} books${Number.isFinite(shinZ) ? `, z=${shinZ.toFixed(3)}` : ""})`
  );
}

function scoreH2H(ctx) {
  const fixtures = Array.isArray(ctx?.h2hFixtures) ? ctx.h2hFixtures : [];
  if (fixtures.length === 0) return dim(50, false, "H2H 50 — no prior meetings (neutral)");
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
  if (count === 0) return dim(50, false, "H2H 50 — prior meetings unscored (neutral)");
  const leagueAvg = leagueAvgFrom(ctx);
  const combinedRatio = (homeGoals / count + awayGoals / count) / (2 * Math.max(EPS, leagueAvg));
  const score = ratioToScore(combinedRatio);
  return dim(score, true, `H2H ${round0(score)} — ${tierWord(score)} goal output across ${count} meeting${count === 1 ? "" : "s"}`);
}

const DIMENSION_SCORERS = {
  attack: scoreAttack,
  defense: scoreDefense,
  form: scoreForm,
  recentMatches: scoreRecentMatches,
  standings: scoreStandings,
  referee: scoreReferee,
  injuries: scoreInjuries,
  lineups: scoreLineups,
  restDays: scoreRestDays,
  homeAdvantage: scoreHomeAdvantage,
  oddsConsensus: scoreOddsConsensus,
  h2h: scoreH2H
};

const DIMENSION_LABELS = {
  attack: "Attack",
  defense: "Defense",
  form: "Form",
  recentMatches: "Recent Matches",
  standings: "Standings",
  referee: "Referee",
  injuries: "Injuries",
  lineups: "Lineups",
  restDays: "Rest Days",
  homeAdvantage: "Home Advantage",
  oddsConsensus: "Odds Consensus",
  h2h: "H2H"
};

function topDrivers(scores, available, weights, limit = 3) {
  return CONFIDENCE_DIMENSION_KEYS
    .map((k) => ({
      key: k,
      label: DIMENSION_LABELS[k],
      score: scores[k],
      available: available[k],
      weight: weights[k]
    }))
    .filter((d) => d.available)
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, limit);
}

function weakDrivers(scores, available, limit = 3) {
  const weak = CONFIDENCE_DIMENSION_KEYS
    .map((k) => ({ key: k, label: DIMENSION_LABELS[k], score: scores[k], available: available[k] }))
    .filter((d) => !d.available || d.score < 45)
    .sort((a, b) => Number(a.available) - Number(b.available) || a.score - b.score)
    .slice(0, limit);
  return weak;
}

/**
 * Attach recommendation-specific WHY text.
 * Does not change scores / overall — explanation only.
 */
export function attachRecommendationExplanation(engine, meta = {}) {
  if (!engine || typeof engine !== "object") return engine;
  const pick = meta.pick != null ? String(meta.pick) : null;
  const pickProb = Number(meta.pickProb);
  const category = engine.category || confidenceCategory(engine.overall);
  const drivers = topDrivers(engine.scores || {}, engine.available || {}, engine.weights || {});
  const weak = weakDrivers(engine.scores || {}, engine.available || {});

  const why = [];
  if (pick) {
    why.push(
      `Recommendation "${pick}"${Number.isFinite(pickProb) ? ` (${pickProb.toFixed(1)}% model probability)` : ""} received ${category} context confidence (${engine.confidence ?? engine.overall}%).`
    );
    why.push(
      "This category measures reliability of supporting context — it is independent from the model's pick probability."
    );
  } else {
    why.push(`Context confidence is ${category} (${engine.confidence ?? engine.overall}%).`);
  }

  if (drivers.length) {
    why.push(
      `Strongest context drivers: ${drivers.map((d) => `${d.label} ${d.score}`).join(", ")}.`
    );
  }
  if (weak.length) {
    why.push(
      `Weak / missing context: ${weak
        .map((d) => (d.available ? `${d.label} ${d.score}` : `${d.label} n/a`))
        .join(", ")} — treat the pick with more caution when these matter.`
    );
  }

  const coverage =
    CONFIDENCE_DIMENSION_KEYS.filter((k) => engine.available?.[k]).length / CONFIDENCE_DIMENSION_KEYS.length;
  why.push(`Data coverage: ${Math.round(coverage * 100)}% of confidence dimensions had usable inputs.`);

  return {
    ...engine,
    recommendationWhy: why,
    why: why.join(" "),
    explanation: [...(engine.explanation || []), ...why]
  };
}

/**
 * Build independent confidence block.
 * @returns {{ confidence, overall, category, scores, available, weights, explanation, why }}
 */
export function buildConfidenceEngine(ctx = {}) {
  const rawWeights = getConfidenceWeights();
  const weights = normalizeConfidenceWeights(rawWeights);

  const scores = {};
  const available = {};
  const explanation = [];
  let overall = 0;

  for (const key of CONFIDENCE_DIMENSION_KEYS) {
    let result;
    try {
      result = DIMENSION_SCORERS[key](ctx);
    } catch {
      result = dim(50, false, `${DIMENSION_LABELS[key] || key} 50 — scoring error (neutral)`);
    }
    const score = round0(result.score);
    scores[key] = score;
    available[key] = Boolean(result.available);
    explanation.push(result.note);
    overall += score * (Number(weights[key]) || 0);
  }

  const confidence = round0(overall);
  const category = confidenceCategory(confidence);

  const base = {
    confidence,
    overall: confidence,
    category,
    scores,
    available,
    weights,
    explanation,
    why: `Overall context confidence is ${category} (${confidence}%).`
  };

  if (ctx.recommendedPick || ctx.pick) {
    return attachRecommendationExplanation(base, {
      pick: ctx.recommendedPick || ctx.pick,
      pickProb: ctx.pickProb ?? ctx.recommendedPickProb
    });
  }

  return base;
}

export const ConfidenceEngine = {
  build: buildConfidenceEngine,
  attachRecommendationExplanation,
  category: confidenceCategory,
  DIMENSION_KEYS: CONFIDENCE_DIMENSION_KEYS
};
