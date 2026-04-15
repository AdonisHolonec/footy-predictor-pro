// src/components/MarketPair.tsx
import React from "react";

export type PairMarket = {
  title: string;
  aLabel: string; bLabel: string;
  aOdd?: string;  bOdd?: string;
  aProb?: number; bProb?: number; // 0..100
};

const P = (x?: number) => (x == null ? "-" : `${Math.round(x)}%`);

export default function MarketPair({ title, aLabel, bLabel, aOdd, bOdd, aProb, bProb }: PairMarket) {
  const bestA = aProb != null && bProb != null && aProb >= bProb;
  const bestB = aProb != null && bProb != null && bProb >  aProb;

  const Row = ({ label, odd, prob, best }: { label: string; odd?: string; prob?: number; best?: boolean }) => (
    <div className="flex items-center justify-between py-1">
      <div className="text-sm">{label}</div>
      <div className="flex items-center gap-2">
        {best ? <span className="chip chip-best">BEST</span> : null}
        <div className="text-xs text-gray-500">{P(prob)}</div>
        <div className="text-sm font-bold">{odd ?? "N/A"}</div>
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl border p-4 bg-white">
      <div className="text-sm font-semibold text-gray-700 mb-3">{title}</div>
      <Row label={aLabel} odd={aOdd} prob={aProb} best={bestA} />
      <Row label={bLabel} odd={bOdd} prob={bProb} best={bestB} />
    </div>
  );
}
