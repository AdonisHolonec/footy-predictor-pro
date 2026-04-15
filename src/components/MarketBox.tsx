// src/components/MarketBox.tsx
import { OddsMarket, fmtOdd, fmtPct } from "@/lib/oddsMath";

export default function MarketBox({ market }: { market?: OddsMarket }) {
  if (!market || !market.values?.length) {
    return (
      <div className="rounded-xl border p-4 text-sm text-gray-500">
        N/A
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">{market.name}</div>
        {market.note && <div className="text-xs text-gray-500">{market.note}</div>}
      </div>

      <div className="space-y-1 text-sm">
        {market.values.map((v, i) => (
          <div key={`${market.name}-${v.value}-${i}`} className="flex items-center justify-between rounded-md bg-gray-50 px-2 py-1">
            <span className="text-gray-700">{v.value}</span>
            <span className="font-medium">
              {fmtOdd(v.odd)}{" "}
              <span className="text-gray-500">({fmtPct(v.probPct)})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
