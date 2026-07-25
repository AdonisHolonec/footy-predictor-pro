/**
 * Professional Value Betting Engine — market candidate builders.
 * Families: 1X2 · Double Chance · BTTS · Over/Under · Corners · Cards · Correct Score
 */

export const VALUE_MARKET_FAMILIES = Object.freeze([
  "1X2",
  "Double Chance",
  "BTTS",
  "Over/Under",
  "Corners",
  "Cards",
  "Correct Score"
]);

/**
 * Map a selection label → market family.
 */
export function classifyMarketFamily(type) {
  const t = String(type || "")
    .trim()
    .toLowerCase();
  if (!t) return "Other";
  if (t === "1" || t === "x" || t === "2") return "1X2";
  if (t === "1x" || t === "12" || t === "x2" || t.startsWith("dc ") || t.includes("double chance")) {
    return "Double Chance";
  }
  if (t === "gg" || t === "ngg" || t.includes("btts")) return "BTTS";
  if (t.includes("corner")) return "Corners";
  if (t.includes("card")) return "Cards";
  if (t.includes("correct score") || /^\d+-\d+$/.test(t)) return "Correct Score";
  if (t.includes("peste") || t.includes("sub") || t.includes("over") || t.includes("under")) {
    return "Over/Under";
  }
  return "Other";
}

function isGoodOdd(o) {
  const n = Number(o);
  return Number.isFinite(n) && n > 1;
}

function pushCandidate(list, { type, family, probability, odds, confidencePct, line = null }) {
  if (!isGoodOdd(odds)) return;
  const p = Number(probability);
  if (!Number.isFinite(p) || p <= 0) return;
  list.push({
    type,
    family: family || classifyMarketFamily(type),
    probability: p,
    odds: Number(odds),
    confidencePct: Number.isFinite(Number(confidencePct)) ? Number(confidencePct) : p > 1 ? p : p * 100,
    line
  });
}

function pct01(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return n > 1.5 ? n / 100 : n;
}

/**
 * Correct Score probabilities always arrive as percentage-points (0-100 scale —
 * Stage08Decision.js computes cell.prob * 100 from the score PMF) and are
 * frequently under 1.5 (most individual scorelines carry well under 1.5% real
 * probability — there are dozens of possible scorelines splitting ~100%).
 * pct01()'s ">1.5 = percentage, else = already a fraction" heuristic works for
 * markets whose probabilities are usually above that threshold (1X2, BTTS,
 * O/U, ...) but misclassifies small Correct Score percentages as already-a-
 * fraction, inflating them ~100x (Sprint 8.1 finding). Correct Score's scale
 * is unambiguous by construction here, so it's converted directly instead of
 * being routed through the generic (and, for this market, unreliable) pct01().
 * pct01() itself is untouched — every other market keeps its exact behavior.
 */
function correctScoreProbabilityFraction(probPct) {
  const n = Number(probPct);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

/**
 * Build value candidates across all supported market families.
 *
 * @param {object} input
 * @param {{ p1?: number, pX?: number, p2?: number, pGG?: number, pNGG?: number, pO15?: number, pU15?: number, pO25?: number, pU25?: number, pO35?: number, pU35?: number, pDC1X?: number, pDC12?: number, pDCX2?: number }} input.probs - % or 0–1
 * @param {{ home?: number, draw?: number, away?: number }|null} input.matchWinnerOdds
 * @param {{ homeDraw?: number, homeAway?: number, drawAway?: number }|null} input.doubleChanceOdds
 * @param {{ yes?: number, no?: number }|null} input.bttsOdds
 * @param {{ over?: number, under?: number }|null} input.goals15Odds
 * @param {{ over?: number, under?: number }|null} input.goals25Odds
 * @param {{ over?: number, under?: number }|null} input.goals35Odds
 * @param {{ pick?: string, line?: number, odd?: number }|null} input.cornersQuote
 * @param {number|null} input.cornersProbPct - model % for the corners pick
 * @param {{ over?: number, under?: number, line?: number }|null} input.cardsOdds
 * @param {number|null} input.cardsOverProbPct
 * @param {number|null} input.cardsUnderProbPct
 * @param {Record<string, number>|null} input.correctScoreOdds - odds keyed by "home-away" scoreline (e.g. "2-1")
 * @param {Record<string, number>|null} input.correctScoreProbsPct - model % keyed the same way, from the already-computed score PMF
 */
export function buildValueCandidates(input = {}) {
  const probs = input.probs || {};
  const list = [];

  const p1 = pct01(probs.p1);
  const pX = pct01(probs.pX);
  const p2 = pct01(probs.p2);
  const mw = input.matchWinnerOdds;
  if (mw) {
    pushCandidate(list, {
      type: "1",
      family: "1X2",
      probability: p1,
      odds: mw.home,
      confidencePct: p1 != null ? p1 * 100 : null
    });
    pushCandidate(list, {
      type: "X",
      family: "1X2",
      probability: pX,
      odds: mw.draw,
      confidencePct: pX != null ? pX * 100 : null
    });
    pushCandidate(list, {
      type: "2",
      family: "1X2",
      probability: p2,
      odds: mw.away,
      confidencePct: p2 != null ? p2 * 100 : null
    });
  }

  const p1x = pct01(probs.pDC1X) ?? (p1 != null && pX != null ? p1 + pX : null);
  const p12 = pct01(probs.pDC12) ?? (p1 != null && p2 != null ? p1 + p2 : null);
  const px2 = pct01(probs.pDCX2) ?? (pX != null && p2 != null ? pX + p2 : null);
  const dc = input.doubleChanceOdds;
  if (dc) {
    pushCandidate(list, {
      type: "1X",
      family: "Double Chance",
      probability: p1x,
      odds: dc.homeDraw,
      confidencePct: p1x != null ? p1x * 100 : null
    });
    pushCandidate(list, {
      type: "12",
      family: "Double Chance",
      probability: p12,
      odds: dc.homeAway,
      confidencePct: p12 != null ? p12 * 100 : null
    });
    pushCandidate(list, {
      type: "X2",
      family: "Double Chance",
      probability: px2,
      odds: dc.drawAway,
      confidencePct: px2 != null ? px2 * 100 : null
    });
  }

  const pGG = pct01(probs.pGG);
  const pNGG = pct01(probs.pNGG) ?? (pGG != null ? 1 - pGG : null);
  const btts = input.bttsOdds;
  if (btts) {
    pushCandidate(list, {
      type: "GG",
      family: "BTTS",
      probability: pGG,
      odds: btts.yes,
      confidencePct: pGG != null ? pGG * 100 : null
    });
    pushCandidate(list, {
      type: "NGG",
      family: "BTTS",
      probability: pNGG,
      odds: btts.no,
      confidencePct: pNGG != null ? pNGG * 100 : null
    });
  }

  const addOu = (line, overOdd, underOdd, pOver, pUnder) => {
    const po = pct01(pOver);
    const pu = pct01(pUnder) ?? (po != null ? 1 - po : null);
    pushCandidate(list, {
      type: `Peste ${line}`,
      family: "Over/Under",
      probability: po,
      odds: overOdd,
      confidencePct: po != null ? po * 100 : null,
      line
    });
    pushCandidate(list, {
      type: `Sub ${line}`,
      family: "Over/Under",
      probability: pu,
      odds: underOdd,
      confidencePct: pu != null ? pu * 100 : null,
      line
    });
  };

  if (input.goals15Odds) {
    addOu(1.5, input.goals15Odds.over, input.goals15Odds.under, probs.pO15, probs.pU15);
  }
  if (input.goals25Odds) {
    addOu(2.5, input.goals25Odds.over, input.goals25Odds.under, probs.pO25, probs.pU25);
  }
  if (input.goals35Odds) {
    const pO35 = probs.pO35 ?? (probs.pU35 != null ? 100 - Number(probs.pU35) : null);
    addOu(3.5, input.goals35Odds.over, input.goals35Odds.under, pO35, probs.pU35);
  }

  const cq = input.cornersQuote;
  if (cq && isGoodOdd(cq.odd) && input.cornersProbPct != null) {
    pushCandidate(list, {
      type: cq.pick || `Corners ${cq.line ?? ""}`.trim(),
      family: "Corners",
      probability: pct01(input.cornersProbPct),
      odds: cq.odd,
      confidencePct: Number(input.cornersProbPct),
      line: cq.line ?? null
    });
  }

  const cards = input.cardsOdds;
  if (cards) {
    const line = cards.line ?? 3.5;
    pushCandidate(list, {
      type: `Cards Over ${line}`,
      family: "Cards",
      probability: pct01(input.cardsOverProbPct),
      odds: cards.over,
      confidencePct: Number(input.cardsOverProbPct),
      line
    });
    pushCandidate(list, {
      type: `Cards Under ${line}`,
      family: "Cards",
      probability: pct01(input.cardsUnderProbPct),
      odds: cards.under,
      confidencePct: Number(input.cardsUnderProbPct),
      line
    });
  }

  // Correct Score — one candidate per scoreline with BOTH a consensus odd and an
  // already-computed model probability (from the score PMF). No recomputation here:
  // the probabilities arrive pre-computed via input.correctScoreProbsPct.
  const csOdds = input.correctScoreOdds;
  const csProbs = input.correctScoreProbsPct;
  if (csOdds && csProbs) {
    for (const [score, odd] of Object.entries(csOdds)) {
      const probPct = csProbs[score];
      if (probPct == null) continue;
      pushCandidate(list, {
        type: `Correct Score ${score}`,
        family: "Correct Score",
        probability: correctScoreProbabilityFraction(probPct),
        odds: odd,
        confidencePct: Number(probPct)
      });
    }
  }

  return list;
}

export default {
  VALUE_MARKET_FAMILIES,
  classifyMarketFamily,
  buildValueCandidates
};
