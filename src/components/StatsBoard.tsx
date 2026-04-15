import React from "react";

export type AdviceRow = {
  fixtureId: number;
  dateISO: string;        // fixture date (ISO)
  home: string;
  away: string;
  advice?: string;
  outcome: "win" | "lose" | "pending";
  decidedAt?: number;     // when outcome known
};

export type PeriodMode = "all" | "7d" | "30d" | "custom";

type Props = {
  period: PeriodMode;
  from?: string;
  to?: string;
  onPeriodChange: (p: PeriodMode) => void;
  onRangeChange: (from?: string, to?: string) => void;
  rows: AdviceRow[];
};

function within(ts: number, mode: PeriodMode, from?: string, to?: string) {
  if (mode === "all") return true;
  const now = Date.now();
  if (mode === "7d")  return ts >= now - 7 * 86400000;
  if (mode === "30d") return ts >= now - 30 * 86400000;
  if (mode === "custom") {
    const f = from ? Date.parse(from) : -Infinity;
    const t = to ? Date.parse(to) + 86399999 : Infinity; // includ ziua To
    return ts >= f && ts <= t;
  }
  return true;
}

export default function StatsBoard({
  period, from, to, onPeriodChange, onRangeChange, rows,
}: Props) {
  const filtered = rows.filter((r) => within(Date.parse(r.dateISO || ""), period, from, to));
  const wins   = filtered.filter((r) => r.outcome === "win").length;
  const loses  = filtered.filter((r) => r.outcome === "lose").length;
  const pend   = filtered.filter((r) => r.outcome === "pending").length;
  const total  = wins + loses;
  const rate   = total ? Math.round((wins / total) * 100) : 0;

  return (
    <div className="mb-4 flex justify-end">
      <div className="card w-full md:w-[380px]">
        <div className="flex items-center justify-between p-3 border-b border-slate-200">
          <div className="font-semibold">Advice Stats</div>
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={(e) => onPeriodChange(e.target.value as any)}
              className="text-sm border rounded-lg px-2 py-1"
            >
              <option value="all">Overall</option>
              <option value="7d">Ultimele 7 zile</option>
              <option value="30d">Ultimele 30 zile</option>
              <option value="custom">Interval</option>
            </select>
          </div>
        </div>

        {period === "custom" && (
          <div className="px-3 pt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              <span>De la</span>
              <input
                type="date"
                className="border rounded-lg px-2 py-1"
                value={from || ""}
                onChange={(e) => onRangeChange(e.target.value || undefined, to)}
              />
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              <span>Până la</span>
              <input
                type="date"
                className="border rounded-lg px-2 py-1"
                value={to || ""}
                onChange={(e) => onRangeChange(from, e.target.value || undefined)}
              />
            </label>
          </div>
        )}

        <div className="p-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-500">WIN</div>
            <div className="text-2xl font-bold text-green-600">{wins}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-500">LOSE</div>
            <div className="text-2xl font-bold text-rose-600">{loses}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-500">PENDING</div>
            <div className="text-2xl font-bold text-slate-700">{pend}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-slate-500">SUCCES RATE</div>
            <div className="text-2xl font-bold">{rate}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}
