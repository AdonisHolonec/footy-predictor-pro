/**
 * Prediction Contributions Engine — signed per-module attribution.
 *
 * For a single prediction, decomposes the model's lean toward the recommended
 * 1X2 outcome into signed percentage-point contributions from every module that
 * is actually in the pipeline: Poisson (attack/defense goal model), Home
 * Advantage, Form, Elo, Odds, Injuries, Referee, Weather, Rest Days, H2H,
 * Motivation, Lineups, Standings, Recent Form — plus the Calibration shift.
 * Confidence (the independent Confidence Engine overall) is returned separately.
 *
 * Grounding (no invented numbers):
 *   - Base modules use strengthMeta factors as log-supremacy terms:
 *       poisson       = wA·[ln(atkH/lg) − ln(atkA/lg)] + wD·[ln(defA/lg) − ln(defH/lg)]
 *       homeAdvantage = wHA·[ln(homeAdv) − ln(awayAdv)]
 *       form          = wF·[ln(formHome) − ln(formAway)]
 *   - Optional modules use the exact combine.js marginal:
 *       key           = modularBlend · w_key · [(f_home − 1) − (f_away − 1)]
 *   - Elo uses the Elo log-odds: ln(10)·eloSpread/400 · eloWeight
 *   - Each log-supremacy term is oriented to the recommended outcome and mapped
 *     to a probability-point effect via the logistic derivative p·(1−p).
 *   - Calibration = (calibrated − raw) probability of the oriented outcome (pp).
 *
 * This module NEVER changes λ, probabilities, or pick selection. Read-only.
 */

const SCHEMA_VERSION = "contrib-v1";

const LABELS = {
  poisson: "Poisson",
  elo: "Elo",
  form: "Form",
  homeAdvantage: "Home Advantage",
  odds: "Odds",
  injuries: "Injuries",
  referee: "Referee",
  weather: "Weather",
  restDays: "Rest Days",
  h2h: "H2H",
  motivation: "Motivation",
  lineup: "Lineups",
  standings: "Standings",
  recentMatches: "Recent Form",
  awayStrength: "Away Strength",
  calibration: "Calibration"
};

/** Optional modules attributed via the combine.js marginal (blend · weight · Δfactor). */
const OPTIONAL_KEYS = [
  "odds",
  "injuries",
  "referee",
  "weather",
  "restDays",
  "h2h",
  "motivation",
  "lineup",
  "standings",
  "recentMatches",
  "awayStrength"
];

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeLn(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.log(r);
}

function moduleFactors(modularScores, key) {
  const m = modularScores?.[key];
  const d = m?.detail || m?.details || null;
  if (!d) return null;
  const home = num(d.home);
  const away = num(d.away);
  if (home == null || away == null) return null;
  return { home, away, available: d.available !== false };
}

function envNum(key, fallback) {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {object} ctx
 * @param {string} ctx.pick recommended pick ("1"|"X"|"2" or a market label)
 * @param {number} ctx.confidence recommended pick probability (0–100)
 * @param {number} ctx.overallConfidence Confidence Engine overall (0–100)
 * @param {object} ctx.strengthMeta
 * @param {object|null} ctx.modularScores summarized module scores
 * @param {object} ctx.weights resolved prediction weights
 * @param {object|null} ctx.eloInfo { eloSpread }
 * @param {{p1:number,pX:number,p2:number}} ctx.probsRaw raw Poisson 1X2 (0–100)
 * @param {{p1:number,pX:number,p2:number}} ctx.probsFinal calibrated 1X2 (0–100)
 */
export function buildPredictionContributions(ctx = {}) {
  const sm = ctx.strengthMeta || {};
  const weights = ctx.weights || {};
  const modular = ctx.modularScores || null;
  const raw = ctx.probsRaw || {};
  const fin = ctx.probsFinal || {};
  const leagueAvg = num(sm.leagueAvg) || num(ctx.leagueParams?.leagueAvg) || 1.35;

  // Resolve the 1X2 outcome we attribute toward.
  const pickUpper = String(ctx.pick || "").trim().toUpperCase();
  let outcome = pickUpper === "1" || pickUpper === "X" || pickUpper === "2" ? pickUpper : null;
  if (!outcome) {
    const p1 = num(fin.p1) ?? 0;
    const pX = num(fin.pX) ?? 0;
    const p2 = num(fin.p2) ?? 0;
    outcome = p1 >= pX && p1 >= p2 ? "1" : p2 >= pX ? "2" : "X";
  }

  // --- Home-supremacy log terms (positive → favors home) ---
  const wA = num(weights.attack, 1) ?? 1;
  const wD = num(weights.defense, 1) ?? 1;
  const wF = num(weights.form, 1) ?? 1;
  const wHA = num(weights.homeAdvantage, 1) ?? 1;
  const blend = num(weights.modularBlend, 0) ?? 0;
  const eloWeight = envNum("PREDICT_CONTRIB_ELO_WEIGHT", 1.0);

  const atkH = num(sm.atkH);
  const atkA = num(sm.atkA);
  const defH = num(sm.defH);
  const defA = num(sm.defA);
  const homeAdv = num(sm.homeAdv);
  const awayAdv = num(sm.awayAdv);

  const homeTerms = {};

  if (atkH != null && atkA != null && defH != null && defA != null) {
    homeTerms.poisson =
      wA * (safeLn(atkH / leagueAvg) - safeLn(atkA / leagueAvg)) +
      wD * (safeLn(defA / leagueAvg) - safeLn(defH / leagueAvg));
  } else {
    homeTerms.poisson = 0;
  }

  homeTerms.homeAdvantage =
    homeAdv != null && awayAdv != null ? wHA * (safeLn(homeAdv) - safeLn(awayAdv)) : 0;

  const formF = moduleFactors(modular, "form");
  homeTerms.form = formF ? wF * (safeLn(formF.home) - safeLn(formF.away)) : 0;

  for (const key of OPTIONAL_KEYS) {
    const f = moduleFactors(modular, key);
    const w = num(weights[key], 0) ?? 0;
    homeTerms[key] = f ? blend * w * ((f.home - 1) - (f.away - 1)) : 0;
  }

  const eloSpread = num(ctx.eloInfo?.eloSpread);
  homeTerms.elo = eloSpread != null ? eloWeight * (Math.log(10) * (eloSpread / 400)) : 0;

  // --- Orient to the recommended outcome ---
  const totalHome = Object.values(homeTerms).reduce((a, b) => a + b, 0);
  const orient = (term) => {
    if (outcome === "1") return term;
    if (outcome === "2") return -term;
    // Draw: modules that increase imbalance reduce draw likelihood.
    const dir = totalHome === 0 ? 0 : Math.sign(totalHome);
    return -dir * term;
  };

  // --- Map log-supremacy to probability points via logistic derivative ---
  const outcomeKey = outcome === "1" ? "p1" : outcome === "2" ? "p2" : "pX";
  const pFinal = (num(fin[outcomeKey]) ?? num(ctx.confidence) ?? 50) / 100;
  const deriv = Math.max(0.02, pFinal * (1 - pFinal)); // floor keeps tiny picks visible

  const items = [];
  const contributions = {};

  const pushItem = (key, pp) => {
    const value = Number((pp).toFixed(2));
    contributions[key] = value;
    items.push({
      key,
      label: LABELS[key] || key,
      contribution: value,
      direction: value > 0 ? "positive" : value < 0 ? "negative" : "neutral"
    });
  };

  for (const [key, term] of Object.entries(homeTerms)) {
    const pp = orient(term) * deriv * 100;
    pushItem(key, pp);
  }

  // Calibration: measured shift on the oriented outcome (already probability points).
  const rawOut = num(raw[outcomeKey]);
  const finOut = num(fin[outcomeKey]);
  const calibrationPp = rawOut != null && finOut != null ? finOut - rawOut : 0;
  pushItem("calibration", calibrationPp);

  // Rank by absolute impact.
  items.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const maxAbs = items.reduce((m, i) => Math.max(m, Math.abs(i.contribution)), 0) || 1;
  for (const it of items) {
    it.share = Number(((Math.abs(it.contribution) / maxAbs) * 100).toFixed(1));
  }

  const net = Number(items.reduce((a, i) => a + i.contribution, 0).toFixed(2));
  const overall = num(ctx.overallConfidence) ?? num(ctx.confidence) ?? null;

  return {
    schemaVersion: SCHEMA_VERSION,
    method: "signed_logit_pp_attribution",
    pick: ctx.pick ?? null,
    outcome,
    confidence: overall != null ? Number(overall.toFixed(1)) : null,
    pickProbability: num(ctx.confidence) != null ? Number(num(ctx.confidence).toFixed(1)) : null,
    net,
    contributions,
    items,
    topDrivers: items.slice(0, 5).map((i) => `${i.key}:${i.contribution}`)
  };
}

export const PredictionContributionsEngine = {
  build: buildPredictionContributions,
  SCHEMA_VERSION,
  LABELS
};

export default PredictionContributionsEngine;
