/**
 * Multi-market Recommendation Selector — probability-first.
 *
 * Product rule (Aug 2026, final): Recommended is the selection with the highest
 * chance of winning among candidates that are eligible AND genuinely tradable.
 *
 *     tradable AND odds >= MIN_DISPLAY_ODDS AND calibratedProbability >= 50%
 *                              |
 *                              v
 *                argmax(calibratedProbability)
 *
 * Nothing commercial participates in that ranking. The previous implementation
 * scored candidates with a composite (0.72 confidence + 0.20 EV + 0.05
 * bookmaker-count + 0.03 market diversity) minus hard-coded penalties on Over 1.5 /
 * Under 3.5, plus an "odds_only" fallback tier that dropped the probability floor
 * entirely. An audit caught that machinery ranking a 38% selection above a 49% one
 * and a 55% selection above a 71% one — the EV term saturated at +20% EV and was
 * worth 20 of 100 points, roughly 27.8 percentage points of probability. All of it
 * is deleted rather than retuned: no weighting of a commercial factor is safe when
 * the rule is "highest probability wins".
 *
 * EV / value optimisation still exists — it lives exclusively in the Value Engine
 * (Best Value), which is free to prefer a lower-probability selection when the price
 * justifies it. Alternatives are simply the next candidates in probability order.
 *
 * If the product later wants market variety or fewer "safe" goals lines on screen,
 * that belongs in the presentation layer. It must never reorder Recommended.
 *
 * Candidates come from the same builder the Value Engine uses (buildValueCandidates),
 * which now only emits selections priced at the bookmaker's own line — see
 * repriceCandidateLine.js. A selection whose line the model cannot price is absent
 * from this pool entirely and can never be Recommended, Alternative or Best Value.
 */

import { buildValueCandidates } from "../../value/valueMarkets.js";
import { clampPct } from "../predictHelpers.js";
import { MIN_DISPLAY_ODDS } from "../../predictionDisplayGate.js";
import { getRecommendationWeights } from "./recommendationWeights.js";

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Bookmaker count for families whose candidates don't carry it themselves. */
function bookmakersForCandidate(candidate, ctx) {
  const own = Number(candidate.bookmakersUsed);
  if (Number.isFinite(own) && own > 0) return own;
  switch (candidate.family) {
    case "1X2":
      return ctx.odds?.bookmakersUsed ?? 0;
    case "Double Chance":
      return ctx.doubleChanceQuote?.bookmakersUsed ?? 0;
    case "BTTS":
      return ctx.bttsQuote?.bookmakersUsed ?? 0;
    case "Over/Under":
      if (candidate.line === 1.5) return ctx.goals15Quote?.bookmakersUsed ?? 0;
      if (candidate.line === 2.5) return ctx.goals25Quote?.bookmakersUsed ?? 0;
      if (candidate.line === 3.5) return ctx.goals35Quote?.bookmakersUsed ?? 0;
      return 0;
    default:
      return 0;
  }
}

/**
 * Deterministic total order: probability DESC, then family ASC, then type ASC.
 * Family/type are tie-breaks for reproducibility only — they never separate
 * candidates whose probabilities differ. Never relies on insertion order.
 */
function compareCandidates(a, b) {
  if (b.confidencePct !== a.confidencePct) return b.confidencePct - a.confidencePct;
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

function buildDiagnosticsExplanation({ winner, ranked, rejected, fallbackTier }) {
  const lines = [];
  if (!winner) {
    lines.push(
      "No candidate was both tradable and eligible — fell back to the strongest 1X2 side by raw probability."
    );
    if (rejected.length) {
      lines.push(
        `${rejected.length} candidate(s) excluded pre-selection: ${rejected.map((r) => `${r.type} (${r.reason})`).join(", ")}.`
      );
    }
    return lines;
  }
  lines.push(
    `Selected "${winner.type}" (${winner.family}) — highest calibrated probability at ` +
      `${round2(winner.confidencePct)}% among eligible tradable candidates, odds ${winner.odds}.`
  );
  if (winner.bookLine != null) {
    lines.push(
      winner.lineExact
        ? `Line ${winner.bookLine} quoted exactly as modelled.`
        : `Model line ${winner.requestedLine} is not offered; repriced at the bookmaker's line ` +
          `${winner.bookLine} (${winner.repriced}) — probability and odds both belong to ${winner.bookLine}.`
    );
  }
  const runnerUp = ranked[1];
  if (runnerUp) {
    lines.push(
      `Runner-up: "${runnerUp.type}" (${runnerUp.family}) at ${round2(runnerUp.confidencePct)}% — ` +
        `gap ${round2(winner.confidencePct - runnerUp.confidencePct)} percentage points.`
    );
  }
  if (fallbackTier === "argmax_1x2") lines.push("Data-poor fixture: no market had usable odds.");
  if (rejected.length) {
    lines.push(
      `${rejected.length} candidate(s) excluded pre-selection: ${rejected.map((r) => `${r.type} (${r.reason})`).join(", ")}.`
    );
  }
  return lines;
}

/**
 * @param {object} params
 * @returns {{ topSelection: object, topPick: string, maxConf: number,
 *   recommendedQuote: { odd: number|null, source: string|null, bookmakersUsed: number,
 *     line: number|null, bookLine: number|null, lineExact: boolean|null,
 *     probabilityLine: number|null, tradable: boolean, repriced: string|false },
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
  cornersSelections,
  cardsSelections,
  shotsTotalSelections,
  shotsOnTargetSelections,
  debug = false,
  weights: weightOverrides
} = {}) {
  const weights = getRecommendationWeights(weightOverrides);

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
    cornersSelections,
    cardsSelections,
    shotsTotalSelections,
    shotsOnTargetSelections
    // correctScoreOdds / correctScoreProbsPct intentionally omitted — Phase 2.
  });

  const ctx = { odds, doubleChanceQuote, bttsQuote, goals15Quote, goals25Quote, goals35Quote };
  const withSource = rawCandidates.map((c) => ({
    ...c,
    bookmakersUsed: bookmakersForCandidate(c, ctx)
  }));

  // Four independent gates, all eligibility — none of them ranks anything. A selection the
  // user cannot place, or that the app could never grade afterwards, is not a candidate at
  // all, whatever its probability.
  const rejectionReason = (c) => {
    if (c.tradable === false) return "not_tradable";
    if (c.settleable === false) return "not_settleable";
    if (!Number.isFinite(c.odds) || c.odds < MIN_DISPLAY_ODDS) return "below_min_odds";
    if (!(c.confidencePct >= weights.minProbabilityPct)) return "below_min_probability";
    return null;
  };

  const eligible = [];
  const rejected = [];
  for (const c of withSource) {
    const reason = rejectionReason(c);
    if (reason) {
      rejected.push({
        type: c.type,
        family: c.family,
        odds: c.odds ?? null,
        confidencePct: round2(c.confidencePct),
        bookLine: c.bookLine ?? null,
        reason
      });
    } else {
      eligible.push(c);
    }
  }

  const ranked = [...eligible].sort(compareCandidates);

  let topSelection;
  let topPick;
  let maxConf;
  let recommendedQuote;
  let fallbackTier = null;
  const winner = ranked[0] || null;

  if (!winner) {
    // Last resort: genuinely data-poor fixture with no tradable, eligible candidate.
    // Deliberately NOT a relaxed-probability tier — a sub-50% selection can never be
    // Recommended through a scored fallback. This is argmax of the model's own 1X2.
    fallbackTier = "argmax_1x2";
    const winnerPick = p1Adj >= pXAdj && p1Adj >= p2Adj ? "1" : p2Adj > p1Adj && p2Adj > pXAdj ? "2" : "X";
    const winnerProb = winnerPick === "1" ? p1Adj : winnerPick === "2" ? p2Adj : pXAdj;
    topSelection = { pick: winnerPick, prob: winnerProb, lift: 0, alternates: [], family: "1X2" };
    topPick = winnerPick;
    maxConf = clampPct(winnerProb * leagueMultiplier * qualityPenalty);
    recommendedQuote = {
      ...resolveFallbackQuote(winnerPick, odds),
      line: null,
      bookLine: null,
      lineExact: null,
      probabilityLine: null,
      tradable: false,
      repriced: false
    };
  } else {
    const alternates = ranked.slice(1, 4).map((c) => ({
      pick: c.type,
      prob: round2(c.confidencePct),
      lift: round1(c.confidencePct - 50),
      family: c.family,
      line: c.bookLine ?? c.line ?? null,
      odd: c.odds
    }));
    topSelection = {
      pick: winner.type,
      prob: winner.confidencePct,
      lift: round1(winner.confidencePct - 50),
      alternates,
      // Authoritative market family from the candidate itself (buildValueCandidates sets
      // it explicitly) — NOT re-derived from the pick string downstream. A Corners
      // candidate's `type` can look identical in shape to a goals Over/Under pick
      // ("Over 7.5"), so any consumer that re-parses the string (grading, analytics)
      // would misclassify it. This field is what settlement keys off instead.
      family: winner.family
    };
    topPick = winner.type;
    maxConf = clampPct(winner.confidencePct * leagueMultiplier * qualityPenalty);
    recommendedQuote = {
      odd: winner.odds,
      source: winner.bookmakersUsed ? `median(${winner.bookmakersUsed})` : null,
      bookmakersUsed: winner.bookmakersUsed || 0,
      line: winner.bookLine ?? winner.line ?? null,
      bookLine: winner.bookLine ?? null,
      lineExact: winner.lineExact ?? null,
      probabilityLine: winner.probabilityLine ?? null,
      tradable: true,
      repriced: winner.repriced ?? false
    };
  }

  let diagnostics = null;
  if (debug) {
    const describe = (c, i) => ({
      rank: i + 1,
      type: c.type,
      family: c.family,
      confidencePct: round2(c.confidencePct),
      odds: c.odds,
      requestedLine: c.requestedLine ?? null,
      bookLine: c.bookLine ?? null,
      lineExact: c.lineExact ?? null,
      probabilityLine: c.probabilityLine ?? null,
      repriced: c.repriced ?? false,
      bookmakersUsed: c.bookmakersUsed || 0
    });
    diagnostics = {
      rule: "argmax_calibrated_probability",
      winner: winner ? describe(winner, 0) : { type: topPick, family: "1X2", fallback: true },
      fallbackTier,
      ranked: ranked.map(describe),
      rejected,
      gates: {
        minProbabilityPct: weights.minProbabilityPct,
        minDisplayOdds: MIN_DISPLAY_ODDS,
        requiresTradable: true,
        requiresSettleable: true
      },
      explanation: buildDiagnosticsExplanation({ winner, ranked, rejected, fallbackTier })
    };
  }

  return { topSelection, topPick, maxConf, recommendedQuote, diagnostics };
}

export default selectRecommendation;
