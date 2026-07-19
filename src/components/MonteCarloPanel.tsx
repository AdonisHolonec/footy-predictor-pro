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
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 10,
  fontSize: 12,
  color: "#f8fafc"
};

type Props = {
  match: PredictionRow;
  homeColor?: string;
  awayColor?: string;
};

function HistChart({
  data,
  xKey,
  barColor = "#2563eb",
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
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: "#475569", fontSize: 11 }} interval={0} />
          <YAxis tick={{ fill: "#475569", fontSize: 11 }} width={36} unit="%" />
          <Tooltip contentStyle={tip} formatter={(v: number) => [`${Number(v).toFixed(1)}%`, "Frequency"]} />
          <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={barColor} fillOpacity={0.85 + (i % 3) * 0.04} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-3 py-2.5 shadow-[var(--fp-shadow-sm)]">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{label}</p>
      <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-[var(--fp-text)]">{value}</p>
    </div>
  );
}

export default function MonteCarloPanel({ match, homeColor = "#2563eb", awayColor = "#f59e0b" }: Props) {
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
    <section className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-[var(--fp-shadow-sm)] sm:p-5 lg:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--fp-accent)]">Monte Carlo Simulation</h3>
          <p className="mt-1 text-sm text-[var(--fp-text-muted)]">
            {mc.simulations.toLocaleString()} sims
            {mc.adaptive?.enabled && mc.adaptive.score != null
              ? ` · adaptive (u=${mc.adaptive.score.toFixed(2)})`
              : ""}{" "}
            · bivariate Poisson + Dixon–Coles
          </p>
        </div>
        <p className="text-xs font-semibold tabular-nums text-[var(--fp-text-muted)]">
          λ {mc.lambdas?.home?.toFixed(2)} / {mc.lambdas?.away?.toFixed(2)}
          {mc.seed != null ? ` · seed ${mc.seed}` : ""}
        </p>
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
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--fp-text)]">Goal distribution · total</p>
          <HistChart data={totalHist} xKey="goals" barColor="#14b8a6" />
        </div>
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--fp-text)]">Score distribution · top 10</p>
          <HistChart data={scoreHist} xKey="label" barColor="#2563eb" heightClass="h-48" />
        </div>
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--fp-text)]">Expected goals · home</p>
          <HistChart data={homeHist} xKey="goals" barColor={homeColor} />
        </div>
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--fp-text)]">Expected goals · away</p>
          <HistChart data={awayHist} xKey="goals" barColor={awayColor} />
        </div>
      </div>

      {mc.mostLikelyScores?.length ? (
        <div className="mt-5 overflow-x-auto rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]">
          <table className="w-full min-w-[360px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--fp-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
                <th className="px-3 py-2">Most likely scores</th>
                <th className="px-3 py-2 text-right">Count</th>
                <th className="px-3 py-2 text-right">Pct</th>
              </tr>
            </thead>
            <tbody>
              {mc.mostLikelyScores.slice(0, 10).map((s) => (
                <tr key={s.score} className="border-b border-[var(--fp-border)] last:border-0">
                  <td className="px-3 py-1.5 font-semibold text-[var(--fp-text)]">{s.score}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--fp-text-muted)]">{s.count}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[var(--fp-accent)]">
                    {s.pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ci.markets && (
            <div className="border-t border-[var(--fp-border)] px-3 py-2 text-xs text-[var(--fp-text-muted)]">
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
