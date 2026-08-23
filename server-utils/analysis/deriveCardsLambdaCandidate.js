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
 * @param {object} input
 * @param {{mean: number|null, sampleSize: number, sufficient: boolean}} input.baseline
 * @param {object|null} [input.rollingHome] team_market_rolling-shaped row (cards_* fields)
 * @param {object|null} [input.rollingAway]
 * @param {number} [input.homeAdv]
 * @param {number} [input.awayAdv]
 * @param {object|null} [input.refereeStats] ACCEPTED AND IGNORED — see module note.
 * @returns {{lambda, components, confidence, sampleQuality, source, outOfBounds, reason}}
 */
export function deriveCardsLambdaCandidate({
  baseline,
  rollingHome = null,
  rollingAway = null,
  homeAdv = 1.06,
  awayAdv = 0.96,
  refereeStats: _refereeStats = null
} = {}) {
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

  const lambdaHome = num(split?.lambdaHome);
  const lambdaAway = num(split?.lambdaAway);
  if (lambdaHome == null || lambdaAway == null) return fail("lambda_not_finite");

  const lambda = round3(lambdaHome + lambdaAway);
  const outOfBounds = lambda < CARDS_LAMBDA_MIN || lambda > CARDS_LAMBDA_MAX;

  const homeSample = num(split?.sampleHome) ?? 0;
  const awaySample = num(split?.sampleAway) ?? 0;
  const bothObserved = homeSample >= MIN_MARKET_SAMPLES && awaySample >= MIN_MARKET_SAMPLES;
  const eitherObserved = homeSample >= MIN_MARKET_SAMPLES || awaySample >= MIN_MARKET_SAMPLES;

  // Confidence describes how much of the estimate rests on observation rather than on the
  // league prior. It is a data-quality report, not a probability.
  let confidence = 0.35; // baseline alone — neither team has a usable card sample
  if (bothObserved && !split?.usedFallback) confidence = 0.8;
  else if (eitherObserved) confidence = 0.55;
  if (outOfBounds) confidence = 0;

  return {
    lambda,
    components: {
      baseline: round3(baseMean),
      lambdaHome: round3(lambdaHome),
      lambdaAway: round3(lambdaAway),
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

export default { deriveCardsLambdaCandidate, CARDS_LAMBDA_MIN, CARDS_LAMBDA_MAX };
