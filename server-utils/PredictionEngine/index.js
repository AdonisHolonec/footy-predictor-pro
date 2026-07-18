/**
 * PredictionEngine orchestrator.
 * Runs independent modules via calculate(), then combines results.
 * No per-module math lives here.
 */

import { AttackStrength } from "./AttackStrength.js";
import { DefenseStrength } from "./DefenseStrength.js";
import { FormEngine } from "./FormEngine.js";
import { HomeAdvantage } from "./HomeAdvantage.js";
import { AwayStrength } from "./AwayStrength.js";
import { RecentMatches } from "./RecentMatches.js";
import { StandingsEngine } from "./StandingsEngine.js";
import { H2HEngine } from "./H2HEngine.js";
import { RefereeEngine } from "./RefereeEngine.js";
import { InjuriesEngine } from "./InjuriesEngine.js";
import { LineupEngine } from "./LineupEngine.js";
import { OddsEngine } from "./OddsEngine.js";
import { RestDaysEngine } from "./RestDaysEngine.js";
import { MotivationEngine } from "./MotivationEngine.js";
import { WeatherEngine } from "./WeatherEngine.js";
import { PoissonEngine } from "./PoissonEngine.js";
import { ExpectedGoals } from "./ExpectedGoals.js";
import { ConfidenceEngine } from "./ConfidenceEngine.js";
import { RecommendationEngine } from "./RecommendationEngine.js";
import { getPredictionWeights } from "./weights.js";
import { combineLambdas } from "./combine.js";
import { toModuleScore } from "./helpers.js";

/** @typedef {import('./types.ts').PredictionContext} PredictionContext */
/** @typedef {import('./types.ts').PredictionEngineResult} PredictionEngineResult */

export const MODULES = Object.freeze({
  AttackStrength,
  DefenseStrength,
  FormEngine,
  HomeAdvantage,
  AwayStrength,
  RecentMatches,
  StandingsEngine,
  H2HEngine,
  RefereeEngine,
  InjuriesEngine,
  LineupEngine,
  OddsEngine,
  RestDaysEngine,
  MotivationEngine,
  WeatherEngine,
  PoissonEngine,
  ExpectedGoals,
  ConfidenceEngine,
  RecommendationEngine
});

/**
 * Combine all module calculate() outputs into λ + Poisson probs.
 * Public contract identical to legacy PredictionEngine.build().
 * @param {PredictionContext} ctx
 * @returns {PredictionEngineResult | null}
 */
export function build(ctx) {
  try {
    if (!ctx?.hStats || !ctx?.aStats) return null;

    const weights = getPredictionWeights();

    // --- Factor modules (independent) ---
    const attack = AttackStrength.calculate(ctx);
    const defense = DefenseStrength.calculate(ctx);
    const form = FormEngine.calculate(ctx);
    const homeAdvantage = HomeAdvantage.calculate(ctx);
    const awayStrength = AwayStrength.calculate(ctx);
    const standings = StandingsEngine.calculate(ctx);
    const h2h = H2HEngine.calculate(ctx);
    const referee = RefereeEngine.calculate(ctx);
    const restDays = RestDaysEngine.calculate(ctx);
    const recentMatches = RecentMatches.calculate(ctx);
    const injuries = InjuriesEngine.calculate(ctx);
    const lineup = LineupEngine.calculate(ctx);
    const odds = OddsEngine.calculate(ctx);
    const motivation = MotivationEngine.calculate(ctx);
    const weather = WeatherEngine.calculate(ctx);

    const core = {
      attack,
      defense,
      form,
      homeAdvantage,
      awayStrength,
      standings,
      h2h,
      referee,
      restDays,
      recentMatches,
      injuries,
      lineup,
      odds,
      motivation,
      weather
    };

    // --- Combine only (no module math) ---
    const { lambdaHome, lambdaAway, strengthMeta } = combineLambdas(ctx, core, weights);
    if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway)) return null;

    const lambdaCtx = { ...ctx, lambdaHome, lambdaAway };
    const poisson = PoissonEngine.calculate(lambdaCtx);
    const expectedGoals = ExpectedGoals.calculate(lambdaCtx);

    const poissonProbs = poisson.details?.probs || null;
    const moduleResultsForConf = { ...core, poisson, expectedGoals };
    const confidence = ConfidenceEngine.calculate({
      ...lambdaCtx,
      _moduleResults: moduleResultsForConf
    });
    const recommendation = RecommendationEngine.calculate({
      ...lambdaCtx,
      probs: poissonProbs,
      _poissonProbs: poissonProbs
    });

    const moduleScores = {
      attack: toModuleScore(attack),
      defense: toModuleScore(defense),
      form: toModuleScore(form),
      homeAdvantage: toModuleScore(homeAdvantage),
      awayStrength: toModuleScore(awayStrength),
      standings: toModuleScore(standings),
      h2h: toModuleScore(h2h),
      referee: toModuleScore(referee),
      restDays: toModuleScore(restDays),
      recentMatches: toModuleScore(recentMatches),
      injuries: toModuleScore(injuries),
      lineup: toModuleScore(lineup),
      odds: toModuleScore(odds),
      motivation: toModuleScore(motivation),
      weather: toModuleScore(weather),
      poisson: toModuleScore(poisson),
      expectedGoals: toModuleScore(expectedGoals),
      confidence: toModuleScore(confidence),
      recommendation: toModuleScore(recommendation)
    };

    return {
      lambdaHome,
      lambdaAway,
      moduleScores,
      method: "modular-engine",
      probs: poissonProbs || undefined,
      bestScore: poisson.details?.bestScore,
      bestScoreProb: poisson.details?.bestScoreProb,
      strengthMeta,
      poissonMeta: poisson.details?.modelMeta
    };
  } catch {
    return null;
  }
}

export function summarizeModuleScores(moduleScores = {}) {
  const out = {};
  for (const [key, mod] of Object.entries(moduleScores)) {
    out[key] = {
      score: mod.score,
      confidence: mod.confidence,
      detail: mod.detail || mod.details,
      details: mod.details || mod.detail
    };
  }
  return out;
}

export const PredictionEngine = {
  build,
  summarizeModuleScores,
  MODULES
};

export { getPredictionWeights, DEFAULT_PREDICTION_WEIGHTS } from "./weights.js";
export default PredictionEngine;
