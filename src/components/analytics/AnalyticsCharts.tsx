import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { DashboardBundle } from "../../types";

const tip = {
  background: "rgba(10, 16, 24, 0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  fontSize: 11,
  color: "#d5dee8"
};

const PIE_COLORS = ["#5ec4b6", "#6a9bb8", "#e0b46a", "#e07a7a", "#8b7ec8", "#7ab88a"];

export function ProfitLineChart({ data }: { data: DashboardBundle["profitLine"] }) {
  return (
    <div className="h-52 w-full sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#7a8a9a", fontSize: 10 }} minTickGap={24} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={40} />
          <Tooltip contentStyle={tip} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#9aabba" }} />
          <Line type="monotone" dataKey="equity" name="Equity" stroke="#5ec4b6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="hitRate" name="Hit %" stroke="#6a9bb8" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LeagueBarChart({
  data,
  valueKey = "roi"
}: {
  data: Array<{ key: string; roi?: number; hitRate?: number; pnl?: number }>;
  valueKey?: "roi" | "hitRate" | "pnl";
}) {
  const rows = (data || []).slice(0, 8);
  return (
    <div className="h-52 w-full sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="key" tick={{ fill: "#8a9aaa", fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={48} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={tip} />
          <Bar dataKey={valueKey} name={valueKey.toUpperCase()} radius={[4, 4, 0, 0]}>
            {rows.map((r, i) => (
              <Cell key={`${r.key}-${i}`} fill={(Number(r[valueKey]) || 0) >= 0 ? "#5ec4b6" : "#e07a7a"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MarketPieChart({ data }: { data: Array<{ key: string; settled: number }> }) {
  const rows = (data || []).filter((d) => d.settled > 0).map((d) => ({ name: d.key, value: d.settled }));
  return (
    <div className="h-52 w-full sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tip} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#9aabba" }} />
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="72%" paddingAngle={2}>
            {rows.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pie of prediction / pick distribution (counts). */
export function PredictionDistributionPie({
  data
}: {
  data: Array<{ key: string; count: number; pct?: number }>;
}) {
  const rows = (data || []).filter((d) => d.count > 0).map((d) => ({ name: d.key, value: d.count }));
  return (
    <div className="h-52 w-full sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tip} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#9aabba" }} />
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius="40%" outerRadius="70%" paddingAngle={2}>
            {rows.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ConfidenceAreaChart({ data }: { data: DashboardBundle["confidenceDistribution"] }) {
  return (
    <div className="h-52 w-full sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="confFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6a9bb8" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#6a9bb8" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fill: "#7a8a9a", fontSize: 10 }} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={tip} />
          <Area type="monotone" dataKey="count" name="Bets" stroke="#6a9bb8" fill="url(#confFill)" strokeWidth={2} />
          <Line type="monotone" dataKey="hitRate" name="Hit %" stroke="#e0b46a" strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PerformanceRadarChart({ data }: { data: DashboardBundle["radar"] }) {
  return (
    <div className="h-52 w-full sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data || []}>
          <PolarGrid stroke="rgba(255,255,255,0.12)" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: "#9aabba", fontSize: 10 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#7a8a9a", fontSize: 9 }} />
          <Radar name="Profile" dataKey="value" stroke="#5ec4b6" fill="#5ec4b6" fillOpacity={0.35} />
          <Tooltip contentStyle={tip} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function heatColor(hitRate: number | null): string {
  if (hitRate == null) return "rgba(255,255,255,0.04)";
  if (hitRate >= 60) return "rgba(94, 196, 182, 0.75)";
  if (hitRate >= 50) return "rgba(106, 155, 184, 0.55)";
  if (hitRate >= 40) return "rgba(224, 180, 106, 0.5)";
  return "rgba(224, 122, 122, 0.55)";
}

/** CSS grid heatmap — league × market hit rate */
export function LeagueMarketHeatmap({ data }: { data: DashboardBundle["heatmap"] }) {
  const leagues = data?.leagues || [];
  const markets = data?.markets || ["1", "X", "2"];
  const cellMap = new Map((data?.cells || []).map((c) => [`${c.league}|${c.market}`, c]));

  if (!leagues.length) {
    return <div className="flex h-40 items-center justify-center font-mono text-[11px] text-signal-inkMuted">No heatmap data</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div
        className="inline-grid min-w-full gap-1"
        style={{ gridTemplateColumns: `minmax(96px,1.4fr) repeat(${markets.length}, minmax(56px,1fr))` }}
      >
        <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">League \\ Mkt</div>
        {markets.map((m) => (
          <div key={m} className="text-center font-mono text-[10px] font-semibold text-signal-silver">
            {m}
          </div>
        ))}
        {leagues.map((league) => (
          <div key={league} className="contents">
            <div className="truncate py-1 pr-1 font-mono text-[10px] text-signal-inkMuted" title={league}>
              {league}
            </div>
            {markets.map((market) => {
              const cell = cellMap.get(`${league}|${market}`);
              const hr = cell?.hitRate ?? null;
              return (
                <div
                  key={`${league}-${market}`}
                  className="flex min-h-[36px] flex-col items-center justify-center rounded-md border border-white/[0.06] px-1 py-1 font-mono text-[10px] tabular-nums text-white/90"
                  style={{ background: heatColor(hr) }}
                  title={cell ? `${league} · ${market}: ${hr ?? "—"}% (${cell.settled})` : "n/a"}
                >
                  <span className="font-semibold">{hr != null ? `${hr}%` : "—"}</span>
                  <span className="text-[8px] opacity-70">{cell?.settled ? `n=${cell.settled}` : ""}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApiUsageBarChart({
  history
}: {
  history: Array<{ date?: string; count: number; limit: number }>;
}) {
  const rows = (history || []).map((h) => ({
    date: String(h.date || "").slice(5) || "—",
    count: h.count,
    limit: h.limit
  }));
  return (
    <div className="h-44 w-full sm:h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#7a8a9a", fontSize: 10 }} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={36} />
          <Tooltip contentStyle={tip} />
          <Bar dataKey="count" name="Calls" fill="#6a9bb8" radius={[4, 4, 0, 0]} />
          <Bar dataKey="limit" name="Limit" fill="rgba(255,255,255,0.12)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
