/** Typed mirror of `ValueEngine.js` — kept in sync manually (not imported at runtime). */

import { getValueWeights, normalizeScoreWeights, type ValueWeights } from "./valueWeights.js";

export type EvSignal = "positive" | "neutral" | "negative";

export type ValueEngineResult = {
  type: string;
  probability: number;
  odds: number;
  expectedValue: number;
  kellyPct: number;
  valueScore: number;
  positiveEV: boolean;
  negativeEV: boolean;
  signal: EvSignal;
  recommendable: boolean;
  edge: number;
  fairOdds: number;
  impliedProb: number;
  explanation: string[];
};

export type ValueCandidate = {
  probability: number;
  odds: number;
  type?: string;
  confidencePct?: number;
};

export type ValueEnginePayload = ValueEngineResult & {
  detected: boolean;
  markets: ValueEngineResult[];
  rejectedNegativeCount: number;
  rule: "never_recommend_negative_ev";
};

function clamp(n: number, lo: number, hi: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function round2(n: number): number {
  return Number(clamp(n, -1e6, 1e6).toFixed(2));
}

function round0(n: number): number {
  return Math.round(clamp(n, 0, 100));
}

export function normalizeProbability(probability: number): number {
  const p = Number(probability);
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (p > 1) return clamp(p / 100, 0, 1);
  return clamp(p, 0, 1);
}

export function calculateExpectedValue(probability: number, odds: number): number {
  const p = normalizeProbability(probability);
  const o = Number(odds);
  if (!Number.isFinite(o) || o <= 1 || p <= 0) return 0;
  return round2((p * o - 1) * 100);
}

export function calculateKellyPct(
  probability: number,
  odds: number,
  options: { confidencePct?: number; weights?: Partial<ValueWeights> } = {}
): number {
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

export function calculateValueScore(
  input: { expectedValue: number; edge: number; kellyPct: number; confidencePct?: number },
  weightsInput?: Partial<ValueWeights>
): number {
  const weights = normalizeScoreWeights(getValueWeights(weightsInput).scoreWeights);
  const evNorm = clamp(((Number(input.expectedValue) || 0) + 5) / 25, 0, 1);
  const edgeNorm = clamp(((Number(input.edge) || 0) - 1) / 0.4, 0, 1);
  const kellyNorm = clamp((Number(input.kellyPct) || 0) / 3, 0, 1);
  const confNorm = clamp((Number(input.confidencePct) || 50) / 100, 0, 1);

  let score =
    (evNorm * weights.ev + edgeNorm * weights.edge + kellyNorm * weights.kelly + confNorm * weights.confidence) *
    100;

  if ((Number(input.expectedValue) || 0) < 0) {
    score = Math.min(score, 28);
  } else if ((Number(input.expectedValue) || 0) === 0) {
    score = Math.min(Math.max(score, 35), 55);
  }

  return round0(score);
}

export function classifyEvSignal(expectedValue: number, weightsInput?: Partial<ValueWeights>): EvSignal {
  const weights = getValueWeights(weightsInput);
  const ev = Number(expectedValue) || 0;
  if (ev < weights.neutralEvPct) return "negative";
  if (ev >= weights.positiveEvPct) return "positive";
  return "neutral";
}

function buildExplanation(args: {
  expectedValue: number;
  kellyPct: number;
  valueScore: number;
  signal: EvSignal;
  recommendable: boolean;
  edge: number;
  fairOdds: number;
  odds: number;
  probability: number;
}): string[] {
  const lines: string[] = [];
  const evLabel = args.expectedValue >= 0 ? `+${args.expectedValue}%` : `${args.expectedValue}%`;
  lines.push(
    `EV ${evLabel} · edge ${args.edge.toFixed(2)}× · fair odds ${args.fairOdds || "—"} vs book ${Number.isFinite(args.odds) ? args.odds : "—"}`
  );
  lines.push(`Kelly ${args.kellyPct}% · Value Score ${args.valueScore}/100 · signal ${args.signal}`);
  if (args.recommendable) {
    lines.push("Recommendable: Positive EV above threshold — eligible value bet.");
  } else if (args.expectedValue < 0) {
    lines.push("Not recommendable: Negative EV — never bet this selection.");
  } else if (args.expectedValue === 0) {
    lines.push("Not recommendable: Zero EV — no edge vs the book.");
  } else {
    lines.push("Not recommendable: EV positive but below value threshold / stake guards.");
  }
  if (args.probability > 0 && Number.isFinite(args.odds) && args.odds > 0) {
    const edgePct = round2((args.probability - 1 / args.odds) * 100);
    lines.push(
      `Model vs implied: ${round2(args.probability * 100)}% vs ${round2((1 / args.odds) * 100)}% (Δ ${edgePct >= 0 ? "+" : ""}${edgePct}pp)`
    );
  }
  return lines;
}

export function evaluateValue(
  probability: number,
  odds: number,
  options: { confidencePct?: number; type?: string; weights?: Partial<ValueWeights> } = {}
): ValueEngineResult {
  const weights = getValueWeights(options.weights);
  const p = normalizeProbability(probability);
  const o = Number(odds);
  const validOdds = Number.isFinite(o) && o >= weights.minOdds;
  const validProb = p >= weights.minProbability;

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
    { expectedValue, edge, kellyPct, confidencePct: options.confidencePct },
    weights
  );

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
    probability: round2(p),
    odds: Number.isFinite(o) ? round2(o) : 0,
    expectedValue,
    kellyPct,
    valueScore,
    positiveEV,
    negativeEV,
    signal,
    recommendable,
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
      probability: p
    })
  };
}

export function selectBestValue(
  candidates: ValueCandidate[],
  options: { weights?: Partial<ValueWeights> } = {}
): { best: ValueEngineResult | null; evaluated: ValueEngineResult[]; rejectedNegative: ValueEngineResult[] } {
  const list = Array.isArray(candidates) ? candidates : [];
  const evaluated = list.map((c) =>
    evaluateValue(c.probability, c.odds, {
      type: c.type,
      confidencePct: c.confidencePct,
      weights: options.weights
    })
  );

  const rejectedNegative = evaluated.filter((v) => v.negativeEV || v.expectedValue <= 0);
  const eligible = evaluated
    .filter((v) => v.recommendable)
    .sort((a, b) => b.valueScore - a.valueScore || b.expectedValue - a.expectedValue);

  return {
    best: eligible[0] || null,
    evaluated,
    rejectedNegative
  };
}

export function buildValueEngine(
  candidates: ValueCandidate[],
  options: { weights?: Partial<ValueWeights>; type?: string } = {}
): ValueEnginePayload {
  const { best, evaluated, rejectedNegative } = selectBestValue(candidates, options);
  const display =
    best ||
    [...evaluated].sort((a, b) => b.valueScore - a.valueScore || b.expectedValue - a.expectedValue)[0] ||
    evaluateValue(0, 0, { type: options.type || "" });

  return {
    ...display,
    detected: Boolean(best),
    markets: evaluated,
    rejectedNegativeCount: rejectedNegative.length,
    rule: "never_recommend_negative_ev"
  };
}
