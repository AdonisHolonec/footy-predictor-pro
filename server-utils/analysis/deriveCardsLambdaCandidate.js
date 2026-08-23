/**
 * Cards λ — the validated two-sided model, PROMOTED TO PRODUCTION in C1.
 *
 * `deriveCardsLambda` in pipeline/predictHelpers.js delegates here (baseline resolution +
 * shape adaptation only); Stage05 and Stage08 consume that. This module is therefore a
 * production dependency, not a laboratory: a change here changes live Cards pricing.
 *
 * What it changes versus the production formula:
 *
 *   production : λ = leagueParams.cards × refereeFactor × cornersFactor, one-sided
 *                    (lambdaAway forced to 0), no team cards signal at all
 *   candidate  : λ = empirical league/season baseline, split into two sides and
 *                    opponent-adjusted from each team's own observed card rate
 *
 * The opponent adjustment is NOT reimplemented here. It delegates to
 * `deriveMarketLambdas(marketKey: "cards")`, the same Dixon-Coles multiplicative form
 * Corners and Shots already use, including its sample gate and its post-#65 sanity gate.
 * Reusing it means the candidate inherits behaviour that is already tested rather than
 * acquiring a parallel implementation that could drift.
 *
 * REFEREE IS NOT AN INPUT. Increment D measured the referee effect at 0.21-0.46 cards of
 * true spread against 2.14 cards of match noise, with half-to-half correlation r = 0.096
 * and a walk-forward result worse than the league baseline in all three leagues tested.
 * A `refereeStats` argument is accepted and deliberately ignored, so the independence is
 * something a test can assert rather than a promise in a comment.
 *
 * UNIT: cardsTotal (raw yellow + red) end to end.
 */

import { deriveMarketLambdas, MIN_MARKET_SAMPLES } from "../teamMarketRolling.js";

const round3 = (v) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(3)));

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Plausibility band for a full-match card total, in cards.
 *
 * These are REJECTION bounds, not a clamp: a λ outside them is reported as a failure via
 * `outOfBounds`, not quietly squeezed back into range. Hiding a broken formula behind a
 * clamp is how a wrong λ reaches production looking healthy. The band is deliberately wide
 * — the observed 1109-fixture range was 1 to 14 with a mean of 4.295, so a λ below 1 or
 * above 12 indicates a defect in the inputs, not an unusual match.
 */
export const CARDS_LAMBDA_MIN = 1.0;
export const CARDS_LAMBDA_MAX = 12.0;

/**
 * C1b — strength of the team-side signal, 0..1.
 *
 * λ_side = baseline_side × (λ_team_side / baseline_side) ^ α
 *
 * α = 1 is the full Dixon-Coles team term (C1). α = 0 is the league/season baseline split
 * by home/away advantage and nothing else. The C1 walk-forward backtest (1109 fixtures,
 * PL / La Liga / Serie A 2025) measured the full team term at Brier 0.2096 / ECE 0.040
 * against 0.1996 / 0.007 for the baseline alone, and a damped term (α 0.15–0.25) within
 * 0.0005 Brier of the baseline — noise, on one season. The conservative production value
 * is therefore 0: the rolling infrastructure stays wired and measured, and the team term
 * is switched back on only when more than one season shows it earns its place.
 */
export const CARDS_TEAM_SIGNAL_ALPHA = 0;

/**
 * @param {object} input
 * @param {{mean: number|null, sampleSize: number, sufficient: boolean}} input.baseline
 * @param {object|null} [input.rollingHome] team_market_rolling-shaped row (cards_* fields)
 * @param {object|null} [input.rollingAway]
 * @param {number} [input.homeAdv]
 * @param {number} [input.awayAdv]
 * @param {number} [input.teamSignalAlpha] 0..1 damping of the team term; default CARDS_TEAM_SIGNAL_ALPHA.
 * @param {object|null} [input.refereeStats] ACCEPTED AND IGNORED — see module note.
 * @returns {{lambda, components, confidence, sampleQuality, source, outOfBounds, reason}}
 */
export function deriveCardsLambdaCandidate({
  baseline,
  rollingHome = null,
  rollingAway = null,
  homeAdv = 1.06,
  awayAdv = 0.96,
  teamSignalAlpha = CARDS_TEAM_SIGNAL_ALPHA,
  refereeStats: _refereeStats = null
} = {}) {
  const alpha = Math.max(0, Math.min(1, num(teamSignalAlpha) ?? CARDS_TEAM_SIGNAL_ALPHA));
  const baseMean = num(baseline?.mean);

  const fail = (reason) => ({
    lambda: null,
    components: { baseline: baseMean, lambdaHome: null, lambdaAway: null },
    confidence: 0,
    sampleQuality: {
      baselineSample: num(baseline?.sampleSize) ?? 0,
      baselineSufficient: Boolean(baseline?.sufficient),
      homeSample: 0,
      awaySample: 0,
      minMarketSamples: MIN_MARKET_SAMPLES,
      usedFallback: true,
      fallbackReason: reason
    },
    source: "candidate_v1",
    outOfBounds: false,
    reason
  });

  if (baseMean == null) return fail("no_baseline");
  if (baseMean <= 0) return fail("non_positive_baseline");
  // A baseline below its own sample threshold is not an estimate yet. Better to report
  // that than to emit a λ whose foundation is a handful of matches.
  if (baseline?.sufficient === false) return fail("baseline_sample_insufficient");

  const split = deriveMarketLambdas({
    rollingHome,
    rollingAway,
    baseAvgTotal: baseMean,
    marketKey: "cards",
    homeAdv,
    awayAdv
  });

  const teamHome = num(split?.lambdaHome);
  const teamAway = num(split?.lambdaAway);
  if (teamHome == null || teamAway == null) return fail("lambda_not_finite");

  // Baseline split — the same halves deriveMarketLambdas uses for its own fallback, so
  // α = 0 and the insufficient-data path are literally the same number.
  const baseSide = Math.max(0.5, baseMean / 2);
  const baseHome = baseSide * Math.pow(homeAdv, 0.5);
  const baseAway = baseSide * Math.pow(awayAdv, 0.5);
  // Damped team term: baseline × (team / baseline)^α. α = 0 → baseline, α = 1 → full C1.
  const lambdaHome = alpha === 0 ? baseHome : baseHome * Math.pow(teamHome / baseHome, alpha);
  const lambdaAway = alpha === 0 ? baseAway : baseAway * Math.pow(teamAway / baseAway, alpha);

  const lambda = round3(lambdaHome + lambdaAway);
  const outOfBounds = lambda < CARDS_LAMBDA_MIN || lambda > CARDS_LAMBDA_MAX;

  const homeSample = num(split?.sampleHome) ?? 0;
  const awaySample = num(split?.sampleAway) ?? 0;
  const bothObserved = homeSample >= MIN_MARKET_SAMPLES && awaySample >= MIN_MARKET_SAMPLES;
  const eitherObserved = homeSample >= MIN_MARKET_SAMPLES || awaySample >= MIN_MARKET_SAMPLES;

  // Confidence describes how much of the estimate rests on observation rather than on the
  // league prior. It is a data-quality report, not a probability.
  // With the team term damped, only the α-share of the estimate rests on team observation.
  let observed = 0.35; // baseline alone — neither team has a usable card sample
  if (bothObserved && !split?.usedFallback) observed = 0.8;
  else if (eitherObserved) observed = 0.55;
  let confidence = round3(0.35 + alpha * (observed - 0.35));
  if (outOfBounds) confidence = 0;

  return {
    lambda,
    components: {
      baseline: round3(baseMean),
      lambdaHome: round3(lambdaHome),
      lambdaAway: round3(lambdaAway),
      teamLambdaHome: round3(teamHome),
      teamLambdaAway: round3(teamAway),
      teamSignalAlpha: alpha,
      homeAdv,
      awayAdv
    },
    confidence,
    sampleQuality: {
      baselineSample: num(baseline?.sampleSize) ?? 0,
      baselineSufficient: Boolean(baseline?.sufficient),
      homeSample,
      awaySample,
      minMarketSamples: MIN_MARKET_SAMPLES,
      usedFallback: Boolean(split?.usedFallback),
      fallbackReason: split?.fallbackReason ?? null
    },
    source: "candidate_v1",
    outOfBounds,
    reason: outOfBounds ? "lambda_out_of_plausible_range" : null
  };
}

export default { deriveCardsLambdaCandidate, CARDS_LAMBDA_MIN, CARDS_LAMBDA_MAX, CARDS_TEAM_SIGNAL_ALPHA };
