import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { MonteCarloResult, PredictionRow } from "../types";

const tip = {
  background: "rgba(10, 16, 24, 0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  fontSize: 11,
  color: "#d5dee8"
};

type Props = {
  match: PredictionRow;
  homeColor?: string;
  awayColor?: string;
};

function HistChart({
  data,
  xKey,
  barColor = "#5ec4b6",
  heightClass = "h-44"
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  barColor?: string;
  heightClass?: string;
}) {
  if (!data.length) return null;
  return (
    <div className={`w-full ${heightClass}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: "#8a9aaa", fontSize: 10 }} interval={0} />
          <YAxis tick={{ fill: "#7a8a9a", fontSize: 10 }} width={32} unit="%" />
          <Tooltip
            contentStyle={tip}
            formatter={(v: number) => [`${Number(v).toFixed(1)}%`, "Frequency"]}
          />
          <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={barColor} fillOpacity={0.75 + (i % 3) * 0.05} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-signal-mist/25 px-2.5 py-2">
      <div className="font-mono text-[8px] uppercase tracking-wider text-signal-inkMuted">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-signal-ink">{value}</div>
    </div>
  );
}

export default function MonteCarloPanel({ match, homeColor = "#5ec4b6", awayColor = "#e0b46a" }: Props) {
  const mc = match.monteCarlo as MonteCarloResult | undefined;
  if (!mc || !mc.simulations) return null;

  const pd = mc.probabilityDistribution;
  const xg = mc.expectedGoalsDistribution;
  const ci = mc.confidenceInterval;
  const totalHist = (mc.histogram?.totalGoals || mc.goalDistribution || []).map((b) => ({
    goals: String(b.goals ?? 0),
    pct: b.pct
  }));
  const homeHist = (mc.histogram?.homeGoals || xg.home.histogram || []).map((b) => ({
    goals: String(b.goals ?? 0),
    pct: b.pct
  }));
  const awayHist = (mc.histogram?.awayGoals || xg.away.histogram || []).map((b) => ({
    goals: String(b.goals ?? 0),
    pct: b.pct
  }));
  const scoreHist = (mc.histogram?.scores || mc.mostLikelyScores || []).slice(0, 10).map((b) => ({
    label: b.label || (b as { score?: string }).score || "—",
    pct: b.pct
  }));

  return (
    <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">
            Monte Carlo Simulation
          </h3>
          <p className="mt-1 text-[11px] text-signal-inkMuted">
            {mc.simulations.toLocaleString()} sims
            {mc.adaptive?.enabled && mc.adaptive.score != null
              ? ` · adaptive (u=${mc.adaptive.score.toFixed(2)})`
              : ""}{" "}
            · bivariate Poisson + Dixon–Coles
          </p>
        </div>
        <div className="font-mono text-[9px] tabular-nums text-signal-inkMuted">
          λ {mc.lambdas?.home?.toFixed(2)} / {mc.lambdas?.away?.toFixed(2)}
          {mc.seed != null ? ` · seed ${mc.seed}` : ""}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <StatChip label="P(1)" value={`${pd.p1.toFixed(1)}%`} />
        <StatChip label="P(X)" value={`${pd.pX.toFixed(1)}%`} />
        <StatChip label="P(2)" value={`${pd.p2.toFixed(1)}%`} />
        <StatChip label="BTTS" value={`${pd.pGG.toFixed(1)}%`} />
        <StatChip label="Over 2.5" value={`${pd.pO25.toFixed(1)}%`} />
        <StatChip
          label="Most likely"
          value={`${mc.summary?.mostLikelyScore || mc.mostLikelyScores[0]?.score || "—"} · ${(
            mc.summary?.mostLikelyScorePct ??
            mc.mostLikelyScores[0]?.pct ??
            0
          ).toFixed(1)}%`}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatChip
          label="xG home (mean)"
          value={`${xg.home.mean.toFixed(2)} · CI ${ci.homeGoals.low}–${ci.homeGoals.high}`}
        />
        <StatChip
          label="xG away (mean)"
          value={`${xg.away.mean.toFixed(2)} · CI ${ci.awayGoals.low}–${ci.awayGoals.high}`}
        />
        <StatChip
          label={`Total goals · ${(ci.level * 100).toFixed(0)}% CI`}
          value={`${xg.total.mean.toFixed(2)} · ${ci.totalGoals.low}–${ci.totalGoals.high}`}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-signal-mist/15 p-3 sm:p-4">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">
            Goal distribution · total
          </div>
          <HistChart data={totalHist} xKey="goals" barColor="#5ec4b6" />
        </div>
        <div className="rounded-xl border border-white/5 bg-signal-mist/15 p-3 sm:p-4">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">
            Score distribution · top 10
          </div>
          <HistChart data={scoreHist} xKey="label" barColor="#6a9bb8" heightClass="h-48" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-signal-mist/15 p-3 sm:p-4">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">
            Expected goals · home
          </div>
          <HistChart data={homeHist} xKey="goals" barColor={homeColor} />
        </div>
        <div className="rounded-xl border border-white/5 bg-signal-mist/15 p-3 sm:p-4">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">
            Expected goals · away
          </div>
          <HistChart data={awayHist} xKey="goals" barColor={awayColor} />
        </div>
      </div>

      {mc.mostLikelyScores?.length ? (
        <div className="mt-5 overflow-x-auto rounded-xl border border-white/5 bg-signal-void/35">
          <table className="w-full min-w-[360px] border-collapse text-left font-mono text-[11px]">
            <thead>
              <tr className="border-b border-white/8 text-[9px] uppercase tracking-wider text-signal-inkMuted">
                <th className="px-3 py-2 font-medium">Most likely scores</th>
                <th className="px-3 py-2 text-right font-medium">Count</th>
                <th className="px-3 py-2 text-right font-medium">Pct</th>
              </tr>
            </thead>
            <tbody>
              {mc.mostLikelyScores.slice(0, 10).map((s) => (
                <tr key={s.score} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-3 py-1.5 text-signal-ink">{s.score}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-signal-silver">{s.count}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-signal-petrol">
                    {s.pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ci.markets && (
            <div className="border-t border-white/5 px-3 py-2 font-mono text-[9px] text-signal-inkMuted">
              {(ci.level * 100).toFixed(0)}% CI markets · 1 {ci.markets.p1?.low}–{ci.markets.p1?.high}% · X{" "}
              {ci.markets.pX?.low}–{ci.markets.pX?.high}% · 2 {ci.markets.p2?.low}–{ci.markets.p2?.high}% · O2.5{" "}
              {ci.markets.pO25?.low}–{ci.markets.pO25?.high}%
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
