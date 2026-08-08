/**
 * Feature Importance Engine — per-prediction contribution attribution.
 *
 * Does NOT alter λ, Poisson probs, or pick selection.
 * Combines: module activations × priors → contributions summing to 100%.
 * Stored for UI charts and future ML (featureImportance + DB table).
 */

import {
  FEATURE_IMPORTANCE_KEYS,
  FEATURE_IMPORTANCE_LABELS,
  getFeatureImportancePriors
} from "./featureImportanceWeights.js";

const SCHEMA_VERSION = "fi-v1";

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Activation from multiplicative factor centered at 1.0. */
function activationFromFactor(factor) {
  const f = num(factor);
  if (f == null || f <= 0) return 0;
  return Math.abs(Math.log(f));
}

/** Activation from 0–100 confidence-style score (50 = neutral). */
function activationFromScore100(score, available) {
  const s = num(score);
  if (s == null) return available === false ? 0.05 : 0.15;
  if (available === false) return 0.08;
  return 0.12 + Math.abs(s - 50) / 50;
}

function moduleDetail(modularScores, key) {
  const m = modularScores?.[key];
  if (!m) return null;
  return m.detail || m.details || null;
}

function moduleScore(modularScores, key) {
  const m = modularScores?.[key];
  return m ? num(m.score) : null;
}

/**
 * Compute per-feature activation (non-negative) from real match context.
 */
function computeActivations(ctx = {}) {
  const sm = ctx.strengthMeta || {};
  const leagueAvg = num(sm.leagueAvg) || num(ctx.leagueParams?.leagueAvg) || 1.35;
  const modular = ctx.modularScores || {};
  const conf = ctx.confidenceEngine || {};
  const confScores = conf.scores || {};
  const confAvail = conf.available || {};

  const atkH = num(sm.atkH);
  const atkA = num(sm.atkA);
  const defH = num(sm.defH);
  const defA = num(sm.defA);

  const attackAct =
    atkH != null && atkA != null
      ? (activationFromFactor(atkH / leagueAvg) + activationFromFactor(atkA / leagueAvg)) / 2
      : activationFromFactor(moduleScore(modular, "attack")) ||
        activationFromScore100(confScores.attack, confAvail.attack);

  const defenseAct =
    defH != null && defA != null
      ? (activationFromFactor(defH / leagueAvg) + activationFromFactor(defA / leagueAvg)) / 2
      : activationFromFactor(moduleScore(modular, "defense")) ||
        activationFromScore100(confScores.defense, confAvail.defense);

  const formDetail = moduleDetail(modular, "form");
  const formHome = num(formDetail?.home) ?? num(ctx.hFormMulti) ?? 1;
  const formAway = num(formDetail?.away) ?? num(ctx.aFormMulti) ?? 1;
  const formAct =
    activationFromFactor(formHome) * 0.5 +
    activationFromFactor(formAway) * 0.5 +
    activationFromScore100(confScores.form, confAvail.form) * 0.25;

  const standingsAct = Math.max(
    activationFromFactor(num(moduleDetail(modular, "standings")?.home) || 1),
    activationFromFactor(num(moduleDetail(modular, "standings")?.away) || 1),
    activationFromScore100(confScores.standings, confAvail.standings) * 0.5
  );

  const h2hAvail = confAvail.h2h !== false && (moduleDetail(modular, "h2h")?.available !== false || confAvail.h2h);
  const h2hAct = Math.max(
    activationFromFactor(moduleScore(modular, "h2h") || 1) * (h2hAvail ? 1 : 0.2),
    activationFromScore100(confScores.h2h, confAvail.h2h)
  );

  const refereeAct = Math.max(
    activationFromFactor(moduleScore(modular, "referee") || 1),
    activationFromScore100(confScores.referee, confAvail.referee)
  );

  // Odds: edge between model pick conf and market, or oddsConsensus confidence score
  let oddsAct = activationFromScore100(confScores.oddsConsensus, confAvail.oddsConsensus);
  const pickProb = num(ctx.pickProb ?? ctx.confidence);
  const shin = ctx.shin || ctx.marketProbs;
  if (pickProb != null && shin && num(shin.p1) != null) {
    const pick = String(ctx.pick || "").toUpperCase();
    const mkt =
      pick === "1" ? shin.p1 * 100 : pick === "2" ? shin.p2 * 100 : pick === "X" ? shin.pX * 100 : null;
    if (mkt != null) oddsAct = Math.max(oddsAct, Math.abs(pickProb - mkt) / 40);
  }
  if (ctx.hasOdds || num(ctx.odds?.home) != null) {
    oddsAct = Math.max(oddsAct, 0.2);
  }

  const restAct = Math.max(
    activationFromFactor(moduleScore(modular, "restDays") || 1),
    activationFromScore100(confScores.restDays, confAvail.restDays)
  );

  const weatherMod = modular.weather;
  const weatherAvail = weatherMod?.detail?.available === true || weatherMod?.details?.available === true;
  const weatherAct = weatherAvail
    ? Math.max(activationFromFactor(moduleScore(modular, "weather") || 1), 0.25)
    : 0.06;

  const injuriesAct = Math.max(
    activationFromFactor(moduleScore(modular, "injuries") || 1),
    activationFromScore100(confScores.injuries, confAvail.injuries)
  );

  return {
    attack: attackAct,
    defense: defenseAct,
    form: formAct,
    standings: standingsAct,
    h2h: h2hAct,
    referee: refereeAct,
    odds: oddsAct,
    restDays: restAct,
    weather: weatherAct,
    injuries: injuriesAct
  };
}

/**
 * @returns {{
 *   schemaVersion: string,
 *   contributions: Record<string, number>,
 *   items: Array<{ key: string, label: string, contribution: number, activation: number, prior: number }>,
 *   total: number,
 *   topFeatures: string[]
 * }}
 */
export function buildFeatureImportance(ctx = {}) {
  const priors = getFeatureImportancePriors();
  const activations = computeActivations(ctx);

  const raw = {};
  let sum = 0;
  for (const key of FEATURE_IMPORTANCE_KEYS) {
    const prior = Math.max(0, num(priors[key], 0) || 0);
    const act = Math.max(0, num(activations[key], 0) || 0);
    // Floor so every listed feature keeps a visible share when priors > 0
    const v = prior * (0.08 + act);
    raw[key] = v;
    sum += v;
  }

  const contributions = {};
  const items = [];
  if (sum <= 0) {
    const even = 100 / FEATURE_IMPORTANCE_KEYS.length;
    for (const key of FEATURE_IMPORTANCE_KEYS) {
      contributions[key] = Number(even.toFixed(1));
      items.push({
        key,
        label: FEATURE_IMPORTANCE_LABELS[key],
        contribution: contributions[key],
        activation: 0,
        prior: priors[key]
      });
    }
  } else {
    for (const key of FEATURE_IMPORTANCE_KEYS) {
      const pct = (raw[key] / sum) * 100;
      contributions[key] = Number(pct.toFixed(1));
      items.push({
        key,
        label: FEATURE_IMPORTANCE_LABELS[key],
        contribution: contributions[key],
        activation: Number((activations[key] || 0).toFixed(4)),
        prior: Number((priors[key] || 0).toFixed(4))
      });
    }
  }

  // Fix rounding drift to exact 100.0 on the largest bar
  const roundedSum = FEATURE_IMPORTANCE_KEYS.reduce((a, k) => a + contributions[k], 0);
  const drift = Number((100 - roundedSum).toFixed(1));
  if (Math.abs(drift) >= 0.1) {
    const top = items.slice().sort((a, b) => b.contribution - a.contribution)[0];
    if (top) {
      contributions[top.key] = Number((contributions[top.key] + drift).toFixed(1));
      top.contribution = contributions[top.key];
    }
  }

  items.sort((a, b) => b.contribution - a.contribution);
  const topFeatures = items.slice(0, 5).map((i) => `${i.key}:${i.contribution}`);

  return {
    schemaVersion: SCHEMA_VERSION,
    contributions,
    items,
    total: 100,
    topFeatures,
    method: "prior_x_activation_normalized"
  };
}

/**
 * Flatten contributions for ML feature maps: fi_attack, fi_defense, …
 */
export function featureImportanceToMlVector(fi) {
  const out = {};
  const c = fi?.contributions || {};
  for (const key of FEATURE_IMPORTANCE_KEYS) {
    out[`fi_${key}`] = num(c[key], 0) || 0;
  }
  return out;
}

export const FeatureImportanceEngine = {
  build: buildFeatureImportance,
  toMlVector: featureImportanceToMlVector,
  KEYS: FEATURE_IMPORTANCE_KEYS,
  LABELS: FEATURE_IMPORTANCE_LABELS,
  SCHEMA_VERSION
};
