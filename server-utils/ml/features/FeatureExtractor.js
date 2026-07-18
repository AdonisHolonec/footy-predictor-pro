/**
 * Feature extraction layer — builds dense feature vectors for future trainers.
 * Does NOT train or apply ML models. Safe to call offline from history rows.
 */

import { FEATURE_SCHEMA_VERSION, availableFeatureNames } from "../featureCatalog.js";
import { extractStackerFeatures } from "../../mlStacker.js";
import { shinImpliedProbs } from "../../advancedMath.js";
import { actual1x2FromScore } from "../../probabilityMetrics.js";

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function binary(v) {
  return v ? 1 : 0;
}

function kickoffParts(iso) {
  if (!iso) return { hour: 0, dow: 0 };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { hour: 0, dow: 0 };
  return { hour: d.getUTCHours(), dow: d.getUTCDay() };
}

function pctToFrac(p1, pX, p2) {
  const a = num(p1);
  const b = num(pX);
  const c = num(p2);
  const s = a + b + c;
  if (s <= 0) return null;
  // Accept either 0–1 or 0–100 scales
  if (s > 1.5) return { p1: a / s, pX: b / s, p2: c / s };
  return { p1: a / s, pX: b / s, p2: c / s };
}

/**
 * Normalize a predictions_history row or live predict payload into a common shape.
 * @param {object} row
 */
export function coerceHistoryRow(row = {}) {
  const raw = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : row;
  const evaluation = raw.evaluation || {};
  const modelMeta = raw.modelMeta || evaluation.modelMeta || {};
  const odds = raw.odds || {
    home: row.odds_home,
    draw: row.odds_draw,
    away: row.odds_away
  };
  const probs = raw.probs || {};
  const modelPct = evaluation.rawPoissonProbs1x2Pct || evaluation.modelProbs1x2Pct || {};
  const lambdas = raw.lambdas || evaluation.lambdas || {};
  const scoreHome = row.score_home ?? raw.score?.home ?? null;
  const scoreAway = row.score_away ?? raw.score?.away ?? null;
  const labelFromScore = actual1x2FromScore(scoreHome, scoreAway);
  const total =
    scoreHome != null && scoreAway != null && Number.isFinite(Number(scoreHome)) && Number.isFinite(Number(scoreAway))
      ? Number(scoreHome) + Number(scoreAway)
      : null;

  return {
    fixtureId: row.fixture_id ?? raw.fixtureId ?? raw.id,
    leagueId: row.league_id ?? raw.leagueId,
    kickoffAt: row.kickoff_at ?? raw.kickoffAt ?? raw.kickoff,
    modelVersion: row.model_version ?? raw.modelVersion ?? "unknown",
    evaluation,
    modelMeta,
    odds,
    probs: {
      p1: probs.p1 ?? modelPct.p1,
      pX: probs.pX ?? modelPct.pX,
      p2: probs.p2 ?? modelPct.p2,
      pO25: probs.pO25,
      pGG: probs.pGG
    },
    poissonPct: modelPct,
    lambdas,
    recommended: raw.recommended || {},
    valueBet: raw.valueBet || raw.valueEngine || {},
    confidenceEngine: raw.confidenceEngine || {},
    label1x2: labelFromScore || row.label_1x2 || null,
    labelGg:
      scoreHome != null && scoreAway != null
        ? Number(scoreHome) > 0 && Number(scoreAway) > 0
        : row.label_gg ?? null,
    labelOver25: total != null ? total > 2.5 : row.label_over25 ?? null,
    sourceRow: row
  };
}

function resolvePoissonAndMarket(c) {
  let poissonProbs =
    pctToFrac(c.poissonPct.p1, c.poissonPct.pX, c.poissonPct.p2) ||
    pctToFrac(c.probs.p1, c.probs.pX, c.probs.p2);

  let marketProbs = null;
  const oh = num(c.odds.home ?? c.odds.h, NaN);
  const od = num(c.odds.draw ?? c.odds.d, NaN);
  const oa = num(c.odds.away ?? c.odds.a, NaN);
  if (Number.isFinite(oh) && Number.isFinite(od) && Number.isFinite(oa)) {
    const shin = shinImpliedProbs(oh, od, oa);
    if (shin) marketProbs = { p1: shin.p1, pX: shin.pX, p2: shin.p2 };
  }

  const lp = c.modelMeta.leagueParams || c.evaluation.leagueParams || {};
  return {
    poissonProbs,
    marketProbs,
    eloSpread: num(c.modelMeta.eloSpread ?? c.modelMeta.elo?.spread),
    dataQuality: num(c.modelMeta.dataQuality, 0.6),
    homeAdv: num(lp.homeAdv, 1.06),
    rho: num(lp.rho, -0.1)
  };
}

/**
 * Extract the current stacker feature vector (9 dims).
 * @param {object} row - history or predict-shaped object
 * @returns {{ names: string[], values: number[], vector: Record<string, number>, schemaVersion: string }}
 */
export function extractStackerVector(row) {
  const c = coerceHistoryRow(row);
  const ctx = resolvePoissonAndMarket(c);
  const feat = extractStackerFeatures({
    poissonProbs: ctx.poissonProbs || { p1: 1 / 3, pX: 1 / 3, p2: 1 / 3 },
    marketProbs: ctx.marketProbs,
    eloSpread: ctx.eloSpread,
    dataQuality: ctx.dataQuality,
    homeAdv: ctx.homeAdv,
    rho: ctx.rho
  });
  const names = feat.featureNames;
  const values = feat.values;
  const vector = {};
  for (let i = 0; i < names.length; i++) vector[names[i]] = num(values[i]);
  return { names, values, vector, schemaVersion: FEATURE_SCHEMA_VERSION };
}

/**
 * Extract the full fs-v1 feature map (available features only).
 * Missing features are omitted (never imputed as "real" values).
 * @param {object} row
 */
export function extractFeatureMap(row) {
  const c = coerceHistoryRow(row);
  const stacker = extractStackerVector(row).vector;
  const { hour, dow } = kickoffParts(c.kickoffAt);
  const value = c.valueBet || {};
  const conf = c.confidenceEngine || {};

  const map = {
    ...stacker,
    p1: num(c.probs.p1) > 1.5 ? num(c.probs.p1) / 100 : num(c.probs.p1),
    pX: num(c.probs.pX) > 1.5 ? num(c.probs.pX) / 100 : num(c.probs.pX),
    p2: num(c.probs.p2) > 1.5 ? num(c.probs.p2) / 100 : num(c.probs.p2),
    pO25: num(c.probs.pO25) > 1.5 ? num(c.probs.pO25) / 100 : num(c.probs.pO25),
    pGG: num(c.probs.pGG) > 1.5 ? num(c.probs.pGG) / 100 : num(c.probs.pGG),
    lambda_home: num(c.lambdas.home ?? c.lambdas.lambdaHome),
    lambda_away: num(c.lambdas.away ?? c.lambdas.lambdaAway),
    odds_home: num(c.odds.home ?? c.odds.h),
    odds_draw: num(c.odds.draw ?? c.odds.d),
    odds_away: num(c.odds.away ?? c.odds.a),
    recommended_confidence: num(c.recommended.confidence),
    value_ev: num(value.ev ?? value.expectedValue),
    value_kelly: num(value.kelly ?? value.kellyFraction),
    value_detected: binary(value.detected ?? value.hasValue),
    confidence_engine_overall: num(conf.overall ?? conf.score),
    league_id: num(c.leagueId),
    kickoff_hour_utc: hour,
    kickoff_dow: dow,
    calibration_applied: binary(c.modelMeta.calibrationApplied),
    stacker_applied: binary(c.modelMeta.stackerApplied)
  };

  const names = availableFeatureNames().filter((n) => n in map);
  const values = names.map((n) => num(map[n]));
  const vector = {};
  for (const n of names) vector[n] = num(map[n]);

  return {
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    names,
    values,
    vector,
    labels: {
      label_1x2: c.label1x2 || null,
      label_gg: typeof c.labelGg === "boolean" ? c.labelGg : null,
      label_over25: typeof c.labelOver25 === "boolean" ? c.labelOver25 : null
    },
    meta: {
      fixtureId: c.fixtureId,
      leagueId: c.leagueId,
      kickoffAt: c.kickoffAt,
      modelVersion: c.modelVersion
    }
  };
}

/**
 * Batch extract from an array of history rows.
 * @param {object[]} rows
 */
export function extractFeatureBatch(rows = []) {
  return rows.map((r) => extractFeatureMap(r));
}
