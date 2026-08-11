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
  "Shots",
  "Shots on Target",
  "Correct Score"
]);

/**
 * Which families the app can actually grade after the match.
 *
 * A selection we can recommend but can never settle is not supportable: it stays pending
 * forever, so the user never learns whether it won and accuracy measurement is silently
 * corrupted. Settleability is therefore an *eligibility* condition alongside tradability
 * — never a ranking term.
 *
 * This mirrors what resolveRecommendedValidation (server-utils/cardMarketSettlement.js)
 * can actually do; tests/cardMarketSettlement.test.js asserts the two stay in sync, so a
 * family flipped here without real grading support fails the suite.
 *
 *   1X2 / Double Chance / BTTS / Over-Under  -> graded from the final score
 *   Corners                                  -> marketTotals.cornersTotal
 *   Shots                                    -> marketTotals.shotsTotal
 *   Shots on Target                          -> marketTotals.shotsOnTargetTotal
 *   Cards                                    -> NO total exists in the statistics payload
 *   Correct Score                            -> evaluateTopPick has no scoreline branch
 *
 * Flip a `false` to `true` in the same change that lands its settlement support, and the
 * family rejoins the pool with no ranking change of any kind.
 */
export const SETTLEABLE_VALUE_FAMILIES = Object.freeze({
  "1X2": true,
  "Double Chance": true,
  BTTS: true,
  "Over/Under": true,
  Corners: true,
  Shots: true,
  "Shots on Target": true,
  Cards: false,
  "Correct Score": false
});

/** True when a post-match result can be determined for this family. */
export function isSettleableFamily(family) {
  return SETTLEABLE_VALUE_FAMILIES[family] === true;
}

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
  // Order matters: "shots on target" must not fall through to the broader shots check.
  if (t.includes("on target") || t.includes("sot")) return "Shots on Target";
  if (t.includes("shot")) return "Shots";
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

/**
 * Line metadata every candidate carries. For markets without a line (1X2 / Double
 * Chance / BTTS) the line fields stay null and `lineExact` is true by construction —
 * there is no line for the bookmaker and the model to disagree about.
 *
 * INVARIANT: `tradable === true` implies `probabilityLine === bookLine`, i.e. the
 * probability and the odd describe the same event. Enforced here, the only place
 * candidates are constructed, and asserted in tests.
 */
function pushCandidate(
  list,
  {
    type,
    family,
    probability,
    odds,
    confidencePct,
    line = null,
    requestedLine = null,
    bookLine = null,
    lineExact = true,
    probabilityLine = null,
    bookmakersUsed = 0,
    repriced = false
  }
) {
  if (!isGoodOdd(odds)) return;
  const p = Number(probability);
  if (!Number.isFinite(p) || p <= 0) return;
  // A lined candidate may only exist when its probability was priced at the very line
  // the odd belongs to. Anything else would be an odds transfer between lines.
  if (bookLine != null && Number(probabilityLine) !== Number(bookLine)) return;
  const resolvedFamily = family || classifyMarketFamily(type);
  list.push({
    type,
    family: resolvedFamily,
    // Eligibility, not ranking: a family the app cannot grade after the match is filtered
    // out before any comparison happens, in both Recommended and Best Value.
    settleable: isSettleableFamily(resolvedFamily),
    probability: p,
    odds: Number(odds),
    confidencePct: Number.isFinite(Number(confidencePct)) ? Number(confidencePct) : p > 1 ? p : p * 100,
    line,
    requestedLine,
    bookLine,
    lineExact: Boolean(lineExact),
    probabilityLine,
    bookmakersUsed: Number(bookmakersUsed) || 0,
    tradable: true,
    repriced
  });
}

/**
 * Candidates for a lined market (Corners / Cards) from already-repriced selections.
 * Each selection is a repriceCandidateLine() result: priced at the bookmaker's own
 * line, so non-tradable ones are simply absent from the pool and can never reach
 * Recommended, Alternative or Best Value.
 */
function pushLineSelections(list, selections, family, labelPrefix = "") {
  for (const sel of Array.isArray(selections) ? selections : []) {
    if (!sel?.tradable) continue;
    const side = sel.side === "under" ? "Under" : "Over";
    pushCandidate(list, {
      type: `${labelPrefix}${side} ${Number(sel.bookLine).toFixed(1)}`,
      family,
      probability: pct01(sel.probabilityPct),
      odds: sel.odd,
      confidencePct: Number(sel.probabilityPct),
      line: sel.bookLine,
      requestedLine: sel.requestedLine,
      bookLine: sel.bookLine,
      lineExact: sel.lineExact,
      probabilityLine: sel.probabilityLine,
      bookmakersUsed: sel.bookmakersUsed,
      repriced: sel.repriced
    });
  }
}

function pct01(p) {
  // null/undefined/"" must stay null, not become 0: Number(null) === 0 is finite, and a
  // missing probability that reads as 0 turns the `1 - p` complements below into a phantom
  // 100% candidate — which, under probability-first ranking, would win every time.
  if (p == null || p === "") return null;
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
 * @param {Array<object>|null} input.cornersSelections - repriceCandidateLine() results
 * @param {Array<object>|null} input.cardsSelections - repriceCandidateLine() results
 * @param {Array<object>|null} input.shotsTotalSelections - repriceCandidateLine() results
 * @param {Array<object>|null} input.shotsOnTargetSelections - repriceCandidateLine() results
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

  // Goals lines are quoted exact-only (maxLineDelta 0 in resolveSideMarketQuotes), so
  // the book line and the model line are the same by construction.
  const addOu = (line, overOdd, underOdd, pOver, pUnder) => {
    const po = pct01(pOver);
    const pu = pct01(pUnder) ?? (po != null ? 1 - po : null);
    const lineMeta = { line, requestedLine: line, bookLine: line, probabilityLine: line, lineExact: true };
    pushCandidate(list, {
      type: `Peste ${line}`,
      family: "Over/Under",
      probability: po,
      odds: overOdd,
      confidencePct: po != null ? po * 100 : null,
      ...lineMeta
    });
    pushCandidate(list, {
      type: `Sub ${line}`,
      family: "Over/Under",
      probability: pu,
      odds: underOdd,
      confidencePct: pu != null ? pu * 100 : null,
      ...lineMeta
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

  // Corners and Cards arrive as selections already priced at the bookmaker's own
  // lines (resolveSideMarketQuotes -> repriceCandidateLine). Every line the book
  // actually offers competes on its own probability, so e.g. Under 4.5 and Under 5.5
  // cards are separate candidates ranked on their real chances — not one model-chosen
  // line wearing another line's price.
  pushLineSelections(list, input.cornersSelections, "Corners");
  pushLineSelections(list, input.cardsSelections, "Cards", "Cards ");
  // Shots markets are distinct families: a total-shots price may never settle or price a
  // shots-on-target selection, and the labels keep them apart for grading downstream.
  pushLineSelections(list, input.shotsTotalSelections, "Shots", "Shots ");
  pushLineSelections(list, input.shotsOnTargetSelections, "Shots on Target", "SOT ");

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
