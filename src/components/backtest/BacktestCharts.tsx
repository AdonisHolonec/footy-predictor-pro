import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { BacktestAnalyticsResponse } from "../../types";

type Series = NonNullable<BacktestAnalyticsResponse["series"]>;

const tooltipStyle = {
  background: "rgba(12, 18, 28, 0.95)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  fontSize: 11,
  color: "#d7e0ea"
};

export function EquityChart({ data }: { data: Series["equity"] }) {
  const points = (data || []).filter((_, i) => i % Math.max(1, Math.floor((data.length || 1) / 80)) === 0 || i === data.length - 1);
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3d9b8f" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#3d9b8f" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#7a8a9a", fontSize: 10 }} minTickGap={28} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="equity" stroke="#5ec4b6" fill="url(#eqFill)" strokeWidth={2} name="Equity (u)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyPnlChart({ data }: { data: Series["daily"] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#7a8a9a", fontSize: 10 }} minTickGap={28} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="pnl" name="Daily PnL" radius={[4, 4, 0, 0]}>
            {(data || []).map((d, i) => (
              <Cell key={`${d.date}-${i}`} fill={(d.pnl || 0) >= 0 ? "#5ec4b6" : "#e07a7a"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function KellyGrowthChart({ data }: { data: NonNullable<Series["kelly"]> }) {
  const rows = data || [];
  const points = rows.filter(
    (_, i) => i % Math.max(1, Math.floor((rows.length || 1) / 80)) === 0 || i === rows.length - 1
  );
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="kellyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b7ec8" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#8b7ec8" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#7a8a9a", fontSize: 10 }} minTickGap={28} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="bankroll" stroke="#8b7ec8" fill="url(#kellyFill)" strokeWidth={2} name="Bankroll ×" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DrawdownChart({ data }: { data: Series["equity"] }) {
  const rows = (data || []).map((d) => ({ date: d.date, drawdown: -Math.abs(Number(d.drawdown) || 0) }));
  const points = rows.filter(
    (_, i) => i % Math.max(1, Math.floor((rows.length || 1) / 80)) === 0 || i === rows.length - 1
  );
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e07a7a" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#e07a7a" stopOpacity={0.4} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#7a8a9a", fontSize: 10 }} minTickGap={28} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={42} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="drawdown" stroke="#e07a7a" fill="url(#ddFill)" strokeWidth={2} name="Drawdown (u)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReturnsHistogramChart({ data }: { data: NonNullable<Series["returnsHistogram"]> }) {
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="bucket" tick={{ fill: "#8a9aaa", fontSize: 10 }} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={36} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="count" name="Bets" radius={[4, 4, 0, 0]}>
            {(data || []).map((d, i) => (
              <Cell key={`${d.bucket}-${i}`} fill={d.bucket.startsWith("-") || d.bucket.startsWith("≤") ? "#e07a7a" : "#5ec4b6"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BreakdownBarChart({
  data,
  valueKey = "roi",
  name = "ROI %"
}: {
  data: Array<{ key: string; roi?: number; hitRate?: number; settled?: number; pnl?: number }>;
  valueKey?: "roi" | "hitRate" | "pnl";
  name?: string;
}) {
  const rows = (data || []).slice(0, 8);
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
          <XAxis type="number" tick={{ fill: "#7a8a9a", fontSize: 10 }} />
          <YAxis type="category" dataKey="key" width={88} tick={{ fill: "#9aabba", fontSize: 10 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey={valueKey} name={name} fill="#6a9bb8" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
