// src/lib/oddsMath.ts
export type OddsValue = {
  value: string;
  odd: number;
  impProb?: number;
  normProb?: number;
  probPct?: number;
};

export type OddsMarket = {
  name: string;
  values: OddsValue[];
  note?: string;
};

export function impliedProbability(odd: number) {
  if (!odd || odd <= 0) return 0;
  return 1 / odd;
}

export function addProbsToMarket(m: OddsMarket): OddsMarket {
  const values = (m.values || []).filter(v => typeof v.odd === "number" && v.odd > 1);
  const withImp = values.map(v => ({ ...v, impProb: impliedProbability(v.odd) }));
  const sumImp = withImp.reduce((acc, v) => acc + (v.impProb || 0), 0);
  const withNorm = withImp.map(v => ({
    ...v,
    normProb: sumImp > 0 ? (v.impProb || 0) / sumImp : 0,
    probPct: sumImp > 0 ? ((v.impProb || 0) / sumImp) * 100 : 0,
  }));
  return { ...m, values: withNorm };
}

export function sortByProbDesc(values: OddsValue[]) {
  return [...values].sort((a, b) => (b.normProb ?? 0) - (a.normProb ?? 0));
}

export function fmtOdd(n?: number) {
  if (!n || !isFinite(n)) return "N/A";
  return n.toFixed(2);
}
export function fmtPct(n?: number) {
  if (!n || !isFinite(n)) return "—";
  return `${n.toFixed(0)}%`;
}
