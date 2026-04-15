// src/components/MarketTriple.tsx
import React from "react";

export type TripleItem = { label: string; odd?: string; prob?: number };

const P = (x?: number) => (x == null ? "-" : `${Math.round(x)}%`);

export default function MarketTriple({ title, items }: { title: string; items: TripleItem[] }) {
  const idxBest =
    items.every((i) => i.prob == null)
      ? -1
      : items.reduce((m, it, i, arr) => ((it.prob ?? -1) > (arr[m].prob ?? -1) ? i : m), 0);

  return (
    <div className="rounded-2xl border p-4 bg-white">
      <div className="text-sm font-semibold text-gray-700 mb-3">{title}</div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={it.label} className="flex items-center justify-between">
            <div className="text-sm">{it.label}</div>
            <div className="flex items-center gap-2">
              {i === idxBest && idxBest >= 0 ? <span className="chip chip-best">BEST</span> : null}
              <div className="text-xs text-gray-500">{P(it.prob)}</div>
              <div className="text-sm font-bold">{it.odd ?? "N/A"}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
