/**
 * Multi-market Recommendation Selector — replaces the old selectTopPickAndQuote.js.
 *
 * Root cause of the old "always Over 1.5 / Under 3.5" behavior: the previous selector
 * (predictHelpers.js selectTopPick) only ever considered 11 hardcoded candidates
 * (1X2 + O/U 1.5/2.5/3.5 + GG/NGG), scored purely by probability-vs-hardcoded-baseline
 * lift, with no odds/EV involved and no minimum-odds gate before selection. Corners,
 * Cards and Double Chance were computed elsewhere in the same stage but never reached
 * the picker.
 *
 * This module fixes that by reusing the *same* cross-market candidate builder the
 * Value Engine already uses (buildValueCandidates — 1X2 / Double Chance / BTTS /
 * Over-Under / Corners / Cards), applying the MIN_DISPLAY_ODDS floor BEFORE any
 * candidate is scored or compared, and ranking the full pool with one composite,
 * deterministic score: confidence + expected value + price quality + market
 * diversity, minus a soft penalty for statistically over-represented safe goals
 * lines (Over 1.5 / Under 3.5 — see safeOuScorePenalty in recommendationWeights.js).
 * Diversity is a weighted term inside that same score (not a separate
 * tie-break pass), so a different market can outrank a slightly higher raw-confidence
 * Over/Under pick once combined scores are close — never when one candidate is
 * clearly stronger, since the diversity weight is small relative to confidence/EV.
 *
 * Correct Score and markets with no odds/probability pipeline yet (Draw No Bet,
 * Asian/European Handicap, Team Goals) are Phase 2 — buildValueCandidates already
 * omits Correct Score candidates when correctScoreOdds/Probs aren't passed in, and
 * the others don't exist anywhere in this codebase's odds-fetch/probability layer,
 * so adding them would mean new prediction calculations, out of scope here.
 */

import { poissonOverLine } from "../../math.js";
import { buildValueCandidates } from "../../value/valueMarkets.js";
import { calculateExpectedValue } from "../../value/ValueEngine.js";
import { deriveCardsLambda, clampPct } from "../predictHelpers.js";
import { MIN_DISPLAY_ODDS } from "../../predictionDisplayGate.js";
import { getRecommendationWeights } from "./recommendationWeights.js";

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Same Poisson-over-line cards probability the Value Engine derives in applyValueEngine.js,
 * computed here too (not imported from there) so applyValueEngine.js stays untouched — both
 * call sites reuse the same exported deriveCardsLambda/poissonOverLine helpers, no math
 * duplicated, just called from two places.
 */
function deriveCardsMarketProbs({ cardsQuote, leagueParams, modularScores, cornersBlock }) {
  if (!cardsQuote) return { line: null, over: null, under: null };
  const line = Number(cardsQuote.line ?? process.env.VALUE_CARDS_LINE ?? 3.5);
  const lambda = deriveCardsLambda({ leagueParams, modularScores, cornersBlock });
  const over = Number.isFinite(line) && lambda > 0 ? clampPct(poissonOverLine(line, lambda) * 100) : null;
  const under = over != null ? clampPct(100 - over) : null;
  return { line, over, under };
}

/** Resolve the bookmaker-quote object a candidate came from, for the median(N) source label. */
function sourceForCandidate(candidate, ctx) {
  switch (candidate.family) {
    case "1X2":
      return ctx.odds;
    case "Double Chance":
      return ctx.doubleChanceQuote;
    case "BTTS":
      return ctx.bttsQuote;
    case "Corners":
      return ctx.marketOdds?.corners || null;
    case "Cards":
      return ctx.cardsQuote;
    case "Over/Under":
      if (candidate.line === 1.5) return ctx.goals15Quote;
      if (candidate.line === 2.5) return ctx.goals25Quote;
      if (candidate.line === 3.5) return ctx.goals35Quote;
      return null;
    default:
      return null;
  }
}

/**
 * Soft score penalty for Over 1.5 / Under 3.5 — the lines that dominated recommendations
 * when ranking was raw-confidence-heavy. Does not alter candidate.confidencePct / odds.
 */
function resolveSafeOuScorePenalty(candidate, weights) {
  if (candidate.family !== "Over/Under") return 0;
  const line = Number(candidate.line);
  if (!Number.isFinite(line)) return 0;
  const type = String(candidate.type || "").trim().toLowerCase();
  const table = weights.safeOuScorePenalty || {};
  if (/^(peste|over)\b/.test(type) && line === 1.5) return Math.max(0, Number(table.over_1_5) || 0);
  if (/^(sub|under)\b/.test(type) && line === 3.5) return Math.max(0, Number(table.under_3_5) || 0);
  return 0;
}

/**
 * Composite score for one candidate. `components` are the raw 0-100 factor readings
 * (for display); `contributions` are those same factors after weighting, in score
 * points — they sum to `score` (before safe-O/U soft penalty) and are what the
 * diagnostics explanation compares to determine whether diversity actually changed
 * the outcome.
 */
function scoreCandidate(candidate, weights) {
  const confidenceComponent = clamp01(candidate.confidencePct / 100);
  const expectedValuePct = calculateExpectedValue(candidate.probability, candidate.odds);
  // Same evNorm normalization ValueEngine.js's calculateValueScore already uses, reused
  // verbatim so the two engines describe "good EV" the same way.
  const evComponent = clamp01((expectedValuePct + 5) / 25);
  const qualityComponent = clamp01((candidate.bookmakersUsed || 0) / weights.qualityFullBookmakerCount);
  const diversityComponent = weights.familyDiversityBonus[candidate.family] ?? 0;
  const sw = weights.scoreWeights;

  const contributions = {
    confidence: round2(confidenceComponent * sw.confidence * 100),
    expectedValue: round2(evComponent * sw.expectedValue * 100),
    quality: round2(qualityComponent * sw.quality * 100),
    diversity: round2(diversityComponent * sw.diversity * 100)
  };
  const safeOuPenalty = resolveSafeOuScorePenalty(candidate, weights);
  const rawScore = round2(
    contributions.confidence + contributions.expectedValue + contributions.quality + contributions.diversity
  );
  const score = round2(Math.max(0, rawScore - safeOuPenalty));

  return {
    score,
    expectedValuePct,
    safeOuPenalty,
    components: {
      confidence: round2(confidenceComponent * 100),
      expectedValue: round2(evComponent * 100),
      quality: round2(qualityComponent * 100),
      diversity: round2(diversityComponent * 100)
    },
    contributions
  };
}

/** Deterministic total order: score desc, then family/type asc. Never relies on array/insertion order. */
function compareCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.family !== b.family) return a.family < b.family ? -1 : 1;
  return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
}

function resolveFallbackQuote(pick, odds) {
  if (!odds) return { odd: null, source: null, bookmakersUsed: 0 };
  const pickLc = String(pick || "").toLowerCase();
  const odd = pickLc === "1" ? odds.home : pickLc === "2" ? odds.away : odds.draw;
  const hasOdd = Number.isFinite(Number(odd));
  return {
    odd: hasOdd ? Number(odd) : null,
    source: hasOdd ? `median(${odds.bookmakersUsed || 0})` : null,
    bookmakersUsed: hasOdd ? odds.bookmakersUsed || 0 : 0
  };
}

/** True when subtracting each candidate's diversity contribution would have reversed the outcome. */
function diversityFlippedOutcome(winner, runnerUp) {
  const winnerWithout = winner.score - winner.contributions.diversity;
  const runnerUpWithout = runnerUp.score - runnerUp.contributions.diversity;
  return winnerWithout < runnerUpWithout;
}

function buildDiagnosticsExplanation({ winner, scored, rejected, fallbackTier }) {
  const lines = [];
  if (!winner) {
    lines.push("No candidate has valid odds at all — fell back to the strongest 1X2 side by raw probability.");
    if (rejected.length) {
      lines.push(`${rejected.length} candidate(s) excluded pre-selection: ${rejected.map((r) => `${r.type} (${r.reason})`).join(", ")}.`);
    }
    return lines;
  }
  if (fallbackTier === "odds_only") {
    lines.push(
      "No candidate cleared the minimum-probability bar — relaxed to odds-eligible candidates only (MIN_DISPLAY_ODDS still enforced) instead of defaulting to 1X2."
    );
  }
  lines.push(
    `Selected "${winner.type}" (${winner.family}) — score ${winner.score}/100 ` +
      `[confidence ${winner.components.confidence}, EV ${winner.components.expectedValue}, ` +
      `quality ${winner.components.quality}, diversity ${winner.components.diversity}].`
  );
  const runnerUp = scored[1];
  if (runnerUp) {
    const gap = round2(winner.score - runnerUp.score);
    lines.push(`Runner-up: "${runnerUp.type}" (${runnerUp.family}) at ${runnerUp.score}/100 — gap ${gap} points.`);
    if (winner.family !== runnerUp.family && diversityFlippedOutcome(winner, runnerUp)) {
      lines.push(
        `Diversity term inside the composite score changed the outcome: without it, "${runnerUp.type}" would have ranked higher.`
      );
    }
  }
  if (rejected.length) {
    lines.push(`${rejected.length} candidate(s) excluded pre-selection: ${rejected.map((r) => `${r.type} (${r.reason})`).join(", ")}.`);
  }
  return lines;
}

/**
 * @param {object} params
 * @returns {{ topSelection: object, topPick: string, maxConf: number,
 *   recommendedQuote: { odd: number|null, source: string|null, bookmakersUsed: number },
 *   diagnostics: object|null }}
 */
export function selectRecommendation({
  marketProbsAligned,
  p1Adj,
  pXAdj,
  p2Adj,
  leagueMultiplier,
  qualityPenalty,
  odds,
  bttsQuote,
  goals15Quote,
  goals25Quote,
  goals35Quote,
  doubleChanceQuote,
  marketOdds,
  cornersPick,
  cardsQuote,
  leagueParams,
  modularScores,
  cornersBlock,
  debug = false,
  weights: weightOverrides
} = {}) {
  const weights = getRecommendationWeights(weightOverrides);
  const cardsProbs = deriveCardsMarketProbs({ cardsQuote, leagueParams, modularScores, cornersBlock });

  const probs = {
    p1: p1Adj,
    pX: pXAdj,
    p2: p2Adj,
    pGG: marketProbsAligned?.pGG,
    pNGG: marketProbsAligned?.pNGG,
    pO15: marketProbsAligned?.pO15,
    pU15: marketProbsAligned?.pU15,
    pO25: marketProbsAligned?.pO25,
    pU25: marketProbsAligned?.pU25,
    pO35: marketProbsAligned?.pO35,
    pU35: marketProbsAligned?.pU35
  };

  const rawCandidates = buildValueCandidates({
    probs,
    matchWinnerOdds: odds ? { home: odds.home, draw: odds.draw, away: odds.away } : null,
    doubleChanceOdds: doubleChanceQuote,
    bttsOdds: bttsQuote,
    goals15Odds: goals15Quote,
    goals25Odds: goals25Quote,
    goals35Odds: goals35Quote,
    cornersQuote: marketOdds?.corners || null,
    cornersProbPct: cornersPick?.probability ?? null,
    cardsOdds: cardsProbs.line != null ? { over: cardsQuote?.over, under: cardsQuote?.under, line: cardsProbs.line } : null,
    cardsOverProbPct: cardsProbs.over,
    cardsUnderProbPct: cardsProbs.under
    // correctScoreOdds / correctScoreProbsPct intentionally omitted — Phase 2.
  });

  const ctx = { odds, doubleChanceQuote, bttsQuote, goals15Quote, goals25Quote, goals35Quote, marketOdds, cardsQuote };
  const withSource = rawCandidates.map((c) => ({
    ...c,
    bookmakersUsed: sourceForCandidate(c, ctx)?.bookmakersUsed ?? 0
  }));

  const passesOddsGate = (c) => Number.isFinite(c.odds) && c.odds >= MIN_DISPLAY_ODDS;
  const passesGate = (c) => passesOddsGate(c) && c.confidencePct >= weights.minProbabilityPct;

  const eligible = withSource.filter(passesGate);
  const rejected = withSource
    .filter((c) => !passesGate(c))
    .map((c) => ({
      type: c.type,
      family: c.family,
      odds: c.odds,
      confidencePct: round2(c.confidencePct),
      reason: !Number.isFinite(c.odds) || c.odds < MIN_DISPLAY_ODDS ? "below_min_odds" : "below_min_probability"
    }));

  const scoreAndSort = (list) =>
    list
      .map((c) => {
        const { score, components, contributions, expectedValuePct, safeOuPenalty } = scoreCandidate(c, weights);
        return { ...c, score, components, contributions, expectedValuePct, safeOuPenalty };
      })
      .sort(compareCandidates);

  const scored = scoreAndSort(eligible);
  let fallbackTier = null;
  let effectiveScored = scored;

  if (scored.length === 0) {
    // Tier 2: nothing cleared the 50%-probability bar (a genuinely close/uncertain fixture),
    // but MIN_DISPLAY_ODDS is never relaxed — only the probability floor is. Without this,
    // every close fixture silently defaulted to argmax(1X2) regardless of what any other
    // market's odds/EV looked like, which alone accounted for over half of 1X2's apparent
    // dominance in the Aug 2026 offline replay (189/570 fixtures hit blind argmax, vs 157
    // genuine scoring wins for 1X2) — a fallback-driven bias, not a scoring-weight one.
    const oddsOnly = scoreAndSort(withSource.filter((c) => passesOddsGate(c) && !passesGate(c)));
    if (oddsOnly.length > 0) {
      fallbackTier = "odds_only";
      effectiveScored = oddsOnly;
    }
  }

  let topSelection;
  let topPick;
  let maxConf;
  let recommendedQuote;
  const winner = effectiveScored[0] || null;

  if (!winner) {
    // Tier 3 (last resort): no candidate has valid odds at all — genuinely data-poor fixture.
    fallbackTier = "argmax_1x2";
    const winnerPick = p1Adj >= pXAdj && p1Adj >= p2Adj ? "1" : p2Adj > p1Adj && p2Adj > pXAdj ? "2" : "X";
    const winnerProb = winnerPick === "1" ? p1Adj : winnerPick === "2" ? p2Adj : pXAdj;
    topSelection = { pick: winnerPick, prob: winnerProb, lift: 0, alternates: [], family: "1X2" };
    topPick = winnerPick;
    maxConf = clampPct(winnerProb * leagueMultiplier * qualityPenalty);
    recommendedQuote = resolveFallbackQuote(winnerPick, odds);
  } else {
    const alternates = effectiveScored.slice(1, 4).map((c) => ({
      pick: c.type,
      prob: round2(c.confidencePct),
      lift: round1(c.confidencePct - 50),
      family: c.family
    }));
    topSelection = {
      pick: winner.type,
      prob: winner.confidencePct,
      lift: round1(winner.confidencePct - 50),
      alternates,
      // Authoritative market family from the candidate itself (buildValueCandidates sets it
      // explicitly) — NOT re-derived from the pick string downstream. A Corners candidate's
      // `type` can look identical in shape to a goals Over/Under pick ("Over 7.5"), so any
      // consumer that re-parses the string (grading, analytics) would misclassify it. This
      // field is what settlement now keys off instead (see cardMarketSettlement.js).
      family: winner.family
    };
    topPick = winner.type;
    maxConf = clampPct(winner.confidencePct * leagueMultiplier * qualityPenalty);
    recommendedQuote = {
      odd: winner.odds,
      source: winner.bookmakersUsed ? `median(${winner.bookmakersUsed})` : null,
      bookmakersUsed: winner.bookmakersUsed || 0
    };
  }

  let diagnostics = null;
  if (debug) {
    diagnostics = {
      winner: winner
        ? {
            type: winner.type,
            family: winner.family,
            score: winner.score,
            components: winner.components,
            contributions: winner.contributions,
            safeOuPenalty: winner.safeOuPenalty || 0,
            odds: winner.odds,
            confidencePct: round2(winner.confidencePct)
          }
        : { type: topPick, family: "1X2", fallback: true },
      fallbackTier,
      ranked: effectiveScored.map((c, i) => ({
        rank: i + 1,
        type: c.type,
        family: c.family,
        score: c.score,
        components: c.components,
        contributions: c.contributions,
        safeOuPenalty: c.safeOuPenalty || 0,
        odds: c.odds,
        confidencePct: round2(c.confidencePct)
      })),
      rejected,
      weights: {
        scoreWeights: weights.scoreWeights,
        familyDiversityBonus: weights.familyDiversityBonus,
        safeOuScorePenalty: weights.safeOuScorePenalty,
        minProbabilityPct: weights.minProbabilityPct
      },
      explanation: buildDiagnosticsExplanation({ winner, scored: effectiveScored, rejected, fallbackTier })
    };
  }

  return { topSelection, topPick, maxConf, recommendedQuote, diagnostics };
}

export default selectRecommendation;
