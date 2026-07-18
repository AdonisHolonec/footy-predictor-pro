/**
 * Model Laboratory — evaluate multiple prediction-model configurations
 * independently over the same settled history and score each with:
 * Accuracy, ROI, Yield, LogLoss, Brier Score, Expected Value.
 *
 * Each model is a blend of probability SOURCES (plus optional MODIFIERS),
 * reconstructed per settled prediction from data already stored in
 * `predictions_history` (raw_payload.evaluation triples, stored Elo ratings,
 * expected-goals λ, consensus odds, injury module factors). No re-fetching,
 * no fabricated numbers — every source is derived from real stored values.
 *
 * This module is analysis-only: it never writes predictions or changes λ.
 */

import { computeMatchProbs } from "../math.js";
import { eloProbabilities } from "../teamElo.js";
import { shinImpliedProbs } from "../advancedMath.js";
import { actual1x2FromScore, brier1x2, logLoss1x2 } from "../probabilityMetrics.js";

/** Model registry — env-overridable blend weights via MODEL_LAB_WEIGHT_<ID>_<SRC>. */
export const MODEL_REGISTRY = Object.freeze([
  { id: "A", name: "Poisson", sources: ["poisson"], modifiers: [] },
  { id: "B", name: "Poisson + Elo", sources: ["poisson", "elo"], modifiers: [] },
  { id: "C", name: "Poisson + Elo + xG", sources: ["poisson", "elo", "xg"], modifiers: [] },
  { id: "D", name: "Poisson + xG + Injuries", sources: ["poisson", "xg"], modifiers: ["injuries"] },
  { id: "E", name: "Everything enabled", sources: ["everything"], modifiers: [] }
]);

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize a 1X2 triple (accepts 0–100 or 0–1) to fractions summing to 1. */
function normTriple(t) {
  if (!t) return null;
  let p1 = num(t.p1);
  let pX = num(t.pX);
  let p2 = num(t.p2);
  if (p1 == null || pX == null || p2 == null) return null;
  const scale = p1 + pX + p2 > 1.5 ? 100 : 1;
  p1 /= scale;
  pX /= scale;
  p2 /= scale;
  const s = p1 + pX + p2;
  if (!(s > 0)) return null;
  return { p1: p1 / s, pX: pX / s, p2: p2 / s };
}

function homeAdvElo(row) {
  const homeAdv = num(row?.raw_payload?.modelMeta?.leagueParams?.homeAdv, 1.08) ?? 1.08;
  return 60 + (homeAdv - 1) * 200;
}

/**
 * Reconstruct every available probability source for one settled row.
 * @returns {{ sources: Record<string,{p1,pX,p2}>, injuries: {home:number,away:number}|null }}
 */
export function reconstructSources(row) {
  const payload = row?.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const evalBlock = payload.evaluation || {};
  const sources = {};

  const poisson = normTriple(evalBlock.rawPoissonProbs1x2Pct);
  if (poisson) sources.poisson = poisson;

  const everything = normTriple(evalBlock.modelProbs1x2Pct) || normTriple(evalBlock.calibratedProbs1x2Pct);
  if (everything) sources.everything = everything;

  const calibrated = normTriple(evalBlock.calibratedProbs1x2Pct);
  if (calibrated) sources.calibrated = calibrated;

  const stacker = normTriple(evalBlock.stackerProbs1x2Pct);
  if (stacker) sources.stacker = stacker;

  // Elo — reconstructed from stored ratings.
  const elo = payload?.modelMeta?.elo;
  if (elo && num(elo.home) != null && num(elo.away) != null) {
    const ep = eloProbabilities(num(elo.home), num(elo.away), { homeAdvElo: homeAdvElo(row) });
    const t = normTriple(ep);
    if (t) sources.elo = t;
  }

  // xG — Poisson over stored expected-goals λ (luck_hxg / luck_axg columns or payload).
  const xgH = num(row?.luck_hxg) ?? num(payload?.luckStats?.hXG);
  const xgA = num(row?.luck_axg) ?? num(payload?.luckStats?.aXG);
  if (xgH != null && xgA != null && xgH > 0 && xgA > 0) {
    const rho = num(payload?.modelMeta?.leagueParams?.rho, -0.11) ?? -0.11;
    const calc = computeMatchProbs(xgH, xgA, num(row?.fixture_id) || 0, { correlation: 0.12, rho });
    const t = normTriple(calc?.probs);
    if (t) sources.xg = t;
  }

  // Market — Shin de-vig over consensus odds.
  const oh = num(row?.odds_home);
  const od = num(row?.odds_draw);
  const oa = num(row?.odds_away);
  if (oh > 1 && od > 1 && oa > 1) {
    const shin = shinImpliedProbs(oh, od, oa);
    const t = normTriple(shin);
    if (t) sources.market = t;
  }

  // Injuries — module factor (home/away multipliers) as a modifier.
  const inj = payload?.modelMeta?.modularScores?.injuries?.detail || payload?.modelMeta?.modularScores?.injuries?.details;
  let injuries = null;
  if (inj && (num(inj.home) != null || num(inj.away) != null) && inj.available !== false) {
    injuries = { home: num(inj.home, 1) ?? 1, away: num(inj.away, 1) ?? 1 };
  }

  return { sources, injuries };
}

function blendSources(reqSources, available) {
  const picked = reqSources.map((s) => available[s]).filter(Boolean);
  if (picked.length !== reqSources.length) return null; // require all sources present
  const acc = { p1: 0, pX: 0, p2: 0 };
  for (const t of picked) {
    acc.p1 += t.p1;
    acc.pX += t.pX;
    acc.p2 += t.p2;
  }
  const n = picked.length;
  return normTriple({ p1: acc.p1 / n, pX: acc.pX / n, p2: acc.p2 / n });
}

function applyInjuries(triple, injuries) {
  if (!triple || !injuries) return triple;
  const h = injuries.home;
  const a = injuries.away;
  const p1 = triple.p1 * h;
  const p2 = triple.p2 * a;
  const pX = triple.pX * Math.sqrt(Math.max(0.01, h * a));
  return normTriple({ p1, pX, p2 });
}

function argmax(triple) {
  if (triple.p1 >= triple.pX && triple.p1 >= triple.p2) return "1";
  if (triple.p2 >= triple.pX) return "2";
  return "X";
}

function oddsForOutcome(row, outcome) {
  if (outcome === "1") return num(row?.odds_home);
  if (outcome === "2") return num(row?.odds_away);
  return num(row?.odds_draw);
}

function probForOutcome(triple, outcome) {
  return outcome === "1" ? triple.p1 : outcome === "2" ? triple.p2 : triple.pX;
}

/** Evaluate one model over settled rows. */
export function evaluateModel(model, rows) {
  let n = 0;
  let wins = 0;
  let sumBrier = 0;
  let sumLogLoss = 0;
  let sumProfit = 0;
  let sumStake = 0;
  let sumEv = 0;

  for (const row of rows) {
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;
    const { sources, injuries } = reconstructSources(row);
    let triple = blendSources(model.sources, sources);
    if (!triple) continue;
    if (model.modifiers.includes("injuries")) triple = applyInjuries(triple, injuries) || triple;

    const pick = argmax(triple);
    const oddPick = oddsForOutcome(row, pick);

    n += 1;
    if (pick === actual) wins += 1;
    sumBrier += brier1x2(triple.p1, triple.pX, triple.p2, actual);
    sumLogLoss += logLoss1x2(triple.p1, triple.pX, triple.p2, actual);

    // Flat 1u stake on the model's top pick at consensus odds.
    if (oddPick > 1) {
      sumStake += 1;
      sumProfit += pick === actual ? oddPick - 1 : -1;
      sumEv += probForOutcome(triple, pick) * oddPick - 1;
    }
  }

  const accuracy = n ? (wins / n) * 100 : 0;
  const roi = sumStake ? (sumProfit / sumStake) * 100 : 0;
  const ev = sumStake ? (sumEv / sumStake) * 100 : 0;

  return {
    id: model.id,
    name: model.name,
    sources: model.sources,
    modifiers: model.modifiers,
    samples: n,
    bets: sumStake,
    accuracy: Number(accuracy.toFixed(2)),
    roi: Number(roi.toFixed(2)),
    yield: Number(roi.toFixed(2)), // flat stake → yield == ROI
    logLoss: n ? Number((sumLogLoss / n).toFixed(4)) : null,
    brier: n ? Number((sumBrier / n).toFixed(4)) : null,
    expectedValue: Number(ev.toFixed(2))
  };
}

/**
 * Run the full Model Laboratory over settled rows.
 * @param {Array<object>} rows predictions_history rows (score + odds + raw_payload)
 * @param {{ models?: Array }} [opts]
 */
export function runModelLab(rows, opts = {}) {
  const models = Array.isArray(opts.models) && opts.models.length ? opts.models : MODEL_REGISTRY;
  const settled = (rows || []).filter((r) => actual1x2FromScore(r.score_home, r.score_away) != null);
  const results = models.map((m) => evaluateModel(m, settled));

  // Rank by ROI then accuracy for a quick "best model" pointer.
  const ranked = [...results].sort((a, b) => b.roi - a.roi || b.accuracy - a.accuracy);
  return {
    schemaVersion: "modellab-v1",
    generatedAt: new Date().toISOString(),
    totalSettled: settled.length,
    models: results,
    best: ranked[0] ? { id: ranked[0].id, name: ranked[0].name, roi: ranked[0].roi } : null,
    metrics: ["accuracy", "roi", "yield", "logLoss", "brier", "expectedValue"]
  };
}

export const ModelLab = { runModelLab, evaluateModel, reconstructSources, MODEL_REGISTRY };
export default ModelLab;
