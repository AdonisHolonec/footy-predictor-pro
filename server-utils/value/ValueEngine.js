import { getValueWeights, normalizeScoreWeights } from "./valueWeights.js";
import {
  VALUE_MARKET_FAMILIES,
  classifyMarketFamily,
  buildValueCandidates
} from "./valueMarkets.js";

/**
 * Professional Value Betting Engine.
 *
 * Input:  Prediction Probability + Bookmaker Odds
 * Output: Expected Value · Kelly Stake · Value Score · Positive EV · Negative EV
 *
 * HARD RULE: never recommend bets with negative (or zero) EV.
 * Highlights the best recommendable market across:
 * 1X2 · Double Chance · BTTS · Over/Under · Corners · Cards
 */

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function round2(n) {
  return Number(clamp(n, -1e6, 1e6).toFixed(2));
}

function round0(n) {
  return Math.round(clamp(n, 0, 100));
}

/** Accept probability as 0–1 or 0–100; return 0–1. */
export function normalizeProbability(probability) {
  const p = Number(probability);
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (p > 1) return clamp(p / 100, 0, 1);
  return clamp(p, 0, 1);
}

export function calculateExpectedValue(probability, odds) {
  const p = normalizeProbability(probability);
  const o = Number(odds);
  if (!Number.isFinite(o) || o <= 1 || p <= 0) return 0;
  return round2((p * o - 1) * 100);
}

/**
 * Fractional Kelly stake as % of bankroll.
 * Full Kelly: f* = (b·p − q) / b where b = odds−1, q = 1−p.
 */
export function calculateKellyPct(probability, odds, options = {}) {
  const weights = getValueWeights(options.weights);
  const p = normalizeProbability(probability);
  const o = Number(odds);
  if (!Number.isFinite(o) || o <= 1 || p <= 0) return 0;

  const b = o - 1;
  const q = 1 - p;
  const kellyFull = (b * p - q) / b;
  if (!Number.isFinite(kellyFull) || kellyFull <= 0) return 0;

  const conf = Number(options.confidencePct);
  const high = !Number.isFinite(conf) || conf >= weights.highConfidencePct;
  const fraction = high ? weights.kellyFraction : weights.kellyFractionSoft;
  const pct = kellyFull * fraction * 100;
  return round2(Math.min(pct, weights.kellyCapPct));
}

/**
 * Composite 0–100 Value Score from EV, edge, Kelly, and optional confidence.
 * Negative EV collapses the score toward the bottom so red cards stay visually distinct.
 */
export function calculateValueScore({ expectedValue, edge, kellyPct, confidencePct }, weightsInput) {
  const weights = normalizeScoreWeights(getValueWeights(weightsInput).scoreWeights);
  const evNorm = clamp(((Number(expectedValue) || 0) + 5) / 25, 0, 1);
  const edgeNorm = clamp(((Number(edge) || 0) - 1) / 0.4, 0, 1);
  const kellyNorm = clamp((Number(kellyPct) || 0) / 3, 0, 1);
  const confNorm = clamp((Number(confidencePct) || 50) / 100, 0, 1);

  let score =
    (evNorm * weights.ev + edgeNorm * weights.edge + kellyNorm * weights.kelly + confNorm * weights.confidence) *
    100;

  if ((Number(expectedValue) || 0) < 0) {
    score = Math.min(score, 28);
  } else if ((Number(expectedValue) || 0) === 0) {
    score = Math.min(Math.max(score, 35), 55);
  }

  return round0(score);
}

export function classifyEvSignal(expectedValue, weightsInput) {
  const weights = getValueWeights(weightsInput);
  const ev = Number(expectedValue) || 0;
  if (ev < weights.neutralEvPct) return "negative";
  if (ev >= weights.positiveEvPct) return "positive";
  return "neutral";
}

function buildExplanation({
  expectedValue,
  kellyPct,
  valueScore,
  signal,
  recommendable,
  edge,
  fairOdds,
  odds,
  probability,
  family,
  type
}) {
  const lines = [];
  const evLabel = expectedValue >= 0 ? `+${expectedValue}%` : `${expectedValue}%`;
  const marketLabel = [family, type].filter(Boolean).join(" · ");
  if (marketLabel) lines.push(`Market ${marketLabel}`);
  lines.push(
    `EV ${evLabel} · edge ${edge.toFixed(2)}× · fair odds ${fairOdds || "—"} vs book ${Number.isFinite(odds) ? odds : "—"}`
  );
  lines.push(`Kelly ${kellyPct}% · Value Score ${valueScore}/100 · signal ${signal}`);
  if (recommendable) {
    lines.push("Recommendable: Positive EV above threshold — eligible value bet.");
  } else if (expectedValue < 0) {
    lines.push("Not recommendable: Negative EV — never bet this selection.");
  } else if (expectedValue === 0) {
    lines.push("Not recommendable: Zero EV — no edge vs the book.");
  } else {
    lines.push("Not recommendable: EV positive but below value threshold / stake guards.");
  }
  if (probability > 0 && Number.isFinite(odds) && odds > 0) {
    const edgePct = round2((probability - 1 / odds) * 100);
    lines.push(
      `Model vs implied: ${round2(probability * 100)}% vs ${round2((1 / odds) * 100)}% (Δ ${edgePct >= 0 ? "+" : ""}${edgePct}pp)`
    );
  }
  return lines;
}

/**
 * Core evaluation: predicted probability + bookmaker odds → full Value Engine result.
 */
export function evaluateValue(probability, odds, options = {}) {
  const weights = getValueWeights(options.weights);
  const p = normalizeProbability(probability);
  const o = Number(odds);
  const validOdds = Number.isFinite(o) && o >= weights.minOdds;
  const validProb = p >= weights.minProbability;
  const family = options.family || classifyMarketFamily(options.type);
  const line = options.line != null && Number.isFinite(Number(options.line)) ? Number(options.line) : null;

  const expectedValue = validOdds && p > 0 ? calculateExpectedValue(p, o) : 0;
  const edge = validOdds && p > 0 ? round2(p * o) : 0;
  const kellyPct =
    validOdds && p > 0
      ? calculateKellyPct(p, o, { confidencePct: options.confidencePct, weights })
      : 0;
  const impliedProb = validOdds && o > 0 ? round2(1 / o) : 0;
  const fairOdds = p > 0 ? round2(1 / p) : 0;

  const positiveEV = expectedValue > 0;
  const negativeEV = expectedValue < 0;
  const signal = classifyEvSignal(expectedValue, weights);

  const valueScore = calculateValueScore(
    {
      expectedValue,
      edge,
      kellyPct,
      confidencePct: options.confidencePct
    },
    weights
  );

  // HARD RULE: never recommend negative (or zero) EV.
  const meetsThresholds =
    validOdds &&
    validProb &&
    positiveEV &&
    expectedValue >= weights.positiveEvPct &&
    edge >= weights.minEdge &&
    kellyPct > 0;

  const recommendable = meetsThresholds && !negativeEV && expectedValue > 0;

  return {
    type: options.type || "",
    family,
    line,
    probability: round2(p),
    odds: Number.isFinite(o) ? round2(o) : 0,
    expectedValue,
    kellyPct,
    valueScore,
    positiveEV,
    negativeEV,
    signal,
    recommendable,
    bestMarket: false,
    edge,
    fairOdds,
    impliedProb,
    explanation: buildExplanation({
      expectedValue,
      kellyPct,
      valueScore,
      signal,
      recommendable,
      edge,
      fairOdds,
      odds: o,
      probability: p,
      family,
      type: options.type || ""
    })
  };
}

/**
 * Evaluate candidates and pick the best recommendable value bet.
 * Negative EV is hard-filtered — can never win selection.
 */
export function selectBestValue(candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const evaluated = list.map((c) =>
    evaluateValue(c.probability, c.odds, {
      type: c.type,
      family: c.family,
      line: c.line,
      confidencePct: c.confidencePct,
      weights: options.weights
    })
  );

  const rejectedNegative = evaluated.filter((v) => v.negativeEV || v.expectedValue <= 0);
  const positiveMarkets = evaluated
    .filter((v) => v.positiveEV && v.expectedValue > 0)
    .sort((a, b) => b.valueScore - a.valueScore || b.expectedValue - a.expectedValue);
  const eligible = evaluated
    .filter((v) => v.recommendable)
    .sort((a, b) => b.valueScore - a.valueScore || b.expectedValue - a.expectedValue);

  const best = eligible[0] || null;
  const marked = evaluated.map((v) => ({
    ...v,
    bestMarket: Boolean(best && v.type === best.type && v.family === best.family && v.odds === best.odds)
  }));

  return {
    best: best
      ? {
          ...best,
          bestMarket: true
        }
      : null,
    evaluated: marked,
    rejectedNegative,
    positiveMarkets: positiveMarkets.map((v) => ({
      ...v,
      bestMarket: Boolean(best && v.type === best.type && v.family === best.family && v.odds === best.odds)
    })),
    negativeMarkets: rejectedNegative.filter((v) => v.negativeEV)
  };
}

/**
 * Build the `valueEngine` payload attached to a prediction row.
 * Highlights best recommendable market; never surfaces negative EV as recommended.
 */
export function buildValueEngine(candidates, options = {}) {
  const { best, evaluated, rejectedNegative, positiveMarkets, negativeMarkets } = selectBestValue(
    candidates,
    options
  );
  const display =
    best ||
    [...evaluated].sort((a, b) => b.valueScore - a.valueScore || b.expectedValue - a.expectedValue)[0] ||
    evaluateValue(0, 0, { type: options.type || "" });

  const familiesPresent = Array.from(
    new Set(evaluated.map((m) => m.family).filter((f) => f && f !== "Other"))
  );

  return {
    ...display,
    detected: Boolean(best),
    bestMarket: best
      ? {
          type: best.type,
          family: best.family,
          expectedValue: best.expectedValue,
          kellyPct: best.kellyPct,
          valueScore: best.valueScore,
          odds: best.odds,
          probability: best.probability,
          signal: best.signal,
          recommendable: true,
          positiveEV: true,
          negativeEV: false,
          line: best.line
        }
      : null,
    highlighted: Boolean(best),
    markets: evaluated,
    positiveMarkets,
    negativeMarkets,
    rejectedNegativeCount: rejectedNegative.length,
    positiveEvCount: positiveMarkets.length,
    negativeEvCount: negativeMarkets.length,
    familiesSupported: VALUE_MARKET_FAMILIES.slice(),
    familiesPresent,
    rule: "never_recommend_negative_ev"
  };
}

/**
 * Convenience: build candidates from match quotes, then run the engine.
 */
export function buildProfessionalValueEngine(marketInput, options = {}) {
  const candidates = buildValueCandidates(marketInput);
  return buildValueEngine(candidates, options);
}

export {
  VALUE_MARKET_FAMILIES,
  classifyMarketFamily,
  buildValueCandidates
};

export default {
  normalizeProbability,
  calculateExpectedValue,
  calculateKellyPct,
  calculateValueScore,
  classifyEvSignal,
  evaluateValue,
  selectBestValue,
  buildValueEngine,
  buildProfessionalValueEngine,
  VALUE_MARKET_FAMILIES,
  classifyMarketFamily,
  buildValueCandidates
};
