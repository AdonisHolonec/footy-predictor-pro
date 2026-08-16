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
import { useLocale } from "../context/LocaleContext";
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
  framed?: boolean;
};

function HistChart({
  data,
  xKey,
  barColor = "#2563eb",
  heightClass = "h-44",
  frequencyLabel
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  barColor?: string;
  heightClass?: string;
  frequencyLabel: string;
}) {
  if (!data.length) return null;
  return (
    <div className={`w-full ${heightClass}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: "#475569", fontSize: 11 }} interval={0} />
          <YAxis tick={{ fill: "#475569", fontSize: 11 }} width={36} unit="%" />
          <Tooltip contentStyle={tip} formatter={(v: number) => [`${Number(v).toFixed(1)}%`, frequencyLabel]} />
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
    <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2.5 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{label}</p>
      <p className="mt-0.5 font-display text-base font-bold tabular-nums text-[var(--fp-text)]">{value}</p>
    </div>
  );
}

export default function MonteCarloPanel({
  match,
  homeColor = "#2563eb",
  awayColor = "#f59e0b",
  framed = true
}: Props) {
  const { t } = useLocale();
  const mc = match.monteCarlo as MonteCarloResult | undefined;
  if (!mc || !mc.probabilityDistribution) return null;

  const pd = mc.probabilityDistribution;
  const xg = mc.expectedGoalsDistribution;
  const ci = mc.range;
  const freq = t("panels.frequency");
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
  const ciPct = (ci.level * 100).toFixed(0);

  const body = (
    <>
      {framed ? (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">{t("panels.monteCarlo")}</h3>
            <p className="mt-0.5 text-xs text-[var(--fp-text-muted)]">{t("panels.mcMethod")}</p>
          </div>
          <p className="text-xs font-semibold tabular-nums text-[var(--fp-text-muted)]">
            λ {mc.lambdas?.home?.toFixed(2)} / {mc.lambdas?.away?.toFixed(2)}
          </p>
        </div>
      ) : (
        <p className="mb-2 text-right text-xs font-semibold tabular-nums text-[var(--fp-text-muted)]">
          λ {mc.lambdas?.home?.toFixed(2)} / {mc.lambdas?.away?.toFixed(2)}
        </p>
      )}

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
        <StatChip label="P(1)" value={`${pd.p1.toFixed(1)}%`} />
        <StatChip label="P(X)" value={`${pd.pX.toFixed(1)}%`} />
        <StatChip label="P(2)" value={`${pd.p2.toFixed(1)}%`} />
        <StatChip label={t("panels.btts")} value={`${pd.pGG.toFixed(1)}%`} />
        <StatChip label={t("panels.over25")} value={`${pd.pO25.toFixed(1)}%`} />
        <StatChip
          label={t("panels.mostLikely")}
          value={`${mc.summary?.mostLikelyScore || mc.mostLikelyScores[0]?.score || "—"} · ${(
            mc.summary?.mostLikelyScorePct ??
            mc.mostLikelyScores[0]?.pct ??
            0
          ).toFixed(1)}%`}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatChip
          label={t("panels.xgHomeMean")}
          value={`${xg.home.mean.toFixed(2)} · CI ${ci.homeGoals.low}–${ci.homeGoals.high}`}
        />
        <StatChip
          label={t("panels.xgAwayMean")}
          value={`${xg.away.mean.toFixed(2)} · CI ${ci.awayGoals.low}–${ci.awayGoals.high}`}
        />
        <StatChip
          label={t("panels.totalGoalsCi", { pct: ciPct })}
          value={`${xg.total.mean.toFixed(2)} · ${ci.totalGoals.low}–${ci.totalGoals.high}`}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--fp-text)]">{t("panels.goalDistTotal")}</p>
          <HistChart data={totalHist} xKey="goals" barColor="#14b8a6" frequencyLabel={freq} />
        </div>
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--fp-text)]">{t("panels.scoreDistTop")}</p>
          <HistChart data={scoreHist} xKey="label" barColor="#2563eb" heightClass="h-48" frequencyLabel={freq} />
        </div>
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--fp-text)]">{t("panels.xgHomeHist")}</p>
          <HistChart data={homeHist} xKey="goals" barColor={homeColor} frequencyLabel={freq} />
        </div>
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--fp-text)]">{t("panels.xgAwayHist")}</p>
          <HistChart data={awayHist} xKey="goals" barColor={awayColor} frequencyLabel={freq} />
        </div>
      </div>

      {mc.mostLikelyScores?.length ? (
        <div className="mt-5 overflow-x-auto rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]">
          <table className="w-full min-w-[360px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--fp-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
                <th className="px-3 py-2">{t("panels.mostLikelyScores")}</th>
                <th className="px-3 py-2 text-right">{t("panels.pct")}</th>
              </tr>
            </thead>
            <tbody>
              {mc.mostLikelyScores.slice(0, 10).map((s) => (
                <tr key={s.score} className="border-b border-[var(--fp-border)] last:border-0">
                  <td className="px-3 py-1.5 font-semibold text-[var(--fp-text)]">{s.score}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[var(--fp-accent)]">
                    {s.pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );

  if (!framed) return <div>{body}</div>;

  return (
    <section className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-fp-sm">
      {body}
    </section>
  );
}
