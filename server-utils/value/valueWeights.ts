/** Typed mirror of `valueWeights.js` — kept in sync manually (not imported at runtime). */

export type ValueScoreWeights = {
  ev: number;
  edge: number;
  kelly: number;
  confidence: number;
};

export type ValueWeights = {
  positiveEvPct: number;
  neutralEvPct: number;
  minOdds: number;
  minProbability: number;
  minEdge: number;
  kellyFraction: number;
  kellyFractionSoft: number;
  highConfidencePct: number;
  kellyCapPct: number;
  scoreWeights: ValueScoreWeights;
};

export const DEFAULT_VALUE_WEIGHTS: Readonly<ValueWeights> = Object.freeze({
  positiveEvPct: 1.25,
  neutralEvPct: 0,
  minOdds: 1.3,
  minProbability: 0.2,
  minEdge: 1.1,
  kellyFraction: 0.25,
  kellyFractionSoft: 0.15,
  highConfidencePct: 65,
  kellyCapPct: 3,
  scoreWeights: Object.freeze({
    ev: 0.45,
    edge: 0.25,
    kelly: 0.2,
    confidence: 0.1
  })
});

export function getValueWeights(overrides: Partial<ValueWeights> = {}): ValueWeights {
  const base = { ...DEFAULT_VALUE_WEIGHTS, ...(overrides || {}) };
  const sw = { ...DEFAULT_VALUE_WEIGHTS.scoreWeights, ...(overrides?.scoreWeights || {}) };
  return { ...base, scoreWeights: sw };
}

export function normalizeScoreWeights(weights?: Partial<ValueScoreWeights>): ValueScoreWeights {
  const w = { ...DEFAULT_VALUE_WEIGHTS.scoreWeights, ...(weights || {}) };
  const sum = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  return {
    ev: (Number(w.ev) || 0) / sum,
    edge: (Number(w.edge) || 0) / sum,
    kelly: (Number(w.kelly) || 0) / sum,
    confidence: (Number(w.confidence) || 0) / sum
  };
}
