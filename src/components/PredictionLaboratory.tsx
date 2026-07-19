import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
import { useLocale } from "../context/LocaleContext";
import type { PredictionRow } from "../types";
import { buildPredictionLaboratory, type PredictionLaboratory } from "../utils/predictionLaboratory";

const tip = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 10,
  fontSize: 12,
  color: "#f8fafc"
};

type Props = {
  match: PredictionRow;
  /** Compact strip for MatchCard */
  compact?: boolean;
};

function scoreTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-[var(--fp-text-muted)]";
  if (v >= 70) return "text-[var(--fp-success)]";
  if (v >= 55) return "text-[var(--fp-accent)]";
  if (v >= 40) return "text-[var(--fp-warning)]";
  return "text-[var(--fp-danger)]";
}

function edgeTone(edge: number | null): string {
  if (edge == null || !Number.isFinite(edge)) return "text-[var(--fp-text-muted)]";
  if (edge > 0.05) return "text-[var(--fp-success)]";
  if (edge < -0.05) return "text-[var(--fp-danger)]";
  return "text-[var(--fp-text-muted)]";
}

function LabRadar({ data }: { data: PredictionLaboratory["radar"] }) {
  return (
    <div className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="72%">
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: "#334155", fontSize: 10 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#475569", fontSize: 9 }} />
          <Radar
            name="Prediction Analysis"
            dataKey="value"
            stroke="#2563eb"
            fill="#2563eb"
            fillOpacity={0.28}
            strokeWidth={1.5}
          />
          <Tooltip contentStyle={tip} formatter={(v: number) => [`${Number(v).toFixed(1)}`, "Score"]} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EvolutionChart({ data }: { data: PredictionLaboratory["evolution"] }) {
  if (!data.length) return null;
  return (
    <div className="h-48 w-full sm:h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="stage" tick={{ fill: "#475569", fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 10 }} width={32} unit="%" />
          <Tooltip contentStyle={tip} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#334155" }} />
          <Line type="monotone" dataKey="p1" name="Home %" stroke="#14b8a6" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="pX" name="Draw %" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="p2" name="Away %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ComparisonTable({ lab }: { lab: PredictionLaboratory }) {
  const cmp = lab.comparison;
  if (!cmp) return null;
  return (
    <div className="overflow-x-auto rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]">
      <table className="w-full min-w-[320px] border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-b border-[var(--fp-border)] text-[9px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
            <th className="px-3 py-2.5">Metric</th>
            <th className="px-3 py-2.5 text-right">{cmp.homeName}</th>
            <th className="px-3 py-2.5 text-right">{cmp.awayName}</th>
            <th className="px-3 py-2.5 text-right">Edge</th>
          </tr>
        </thead>
        <tbody>
          {cmp.rows.map((r) => (
            <tr key={r.metric} className="border-b border-[var(--fp-border)] last:border-0">
              <td className="px-3 py-2 font-medium text-[var(--fp-text-muted)]">{r.metric}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--fp-text)]">{r.homeDisplay}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--fp-text)]">{r.awayDisplay}</td>
              <td className={`px-3 py-2 text-right font-bold tabular-nums ${edgeTone(r.edge)}`}>
                {r.edge == null ? "—" : `${r.edge > 0 ? "+" : ""}${r.edge}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cmp.drawOdd != null && (
        <div className="border-t border-[var(--fp-border)] px-3 py-2 text-[10px] font-medium text-[var(--fp-text-muted)]">
          Draw odd · {Number(cmp.drawOdd).toFixed(2)}
          {lab.bookmaker?.differencePp != null && (
            <span className="ml-3">
              Book Δ ·{" "}
              <span className={`font-bold ${edgeTone(lab.bookmaker.differencePp)}`}>
                {lab.bookmaker.differencePp >= 0 ? "+" : ""}
                {lab.bookmaker.differencePp.toFixed(1)} pp
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MetricsStrip({ lab }: { lab: PredictionLaboratory }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {lab.metrics.map((m) => (
        <div
          key={m.key}
          className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2.5 py-2"
          title={m.label}
        >
          <div className="truncate text-[8px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">{m.label}</div>
          <div className={`mt-0.5 text-sm font-bold tabular-nums ${scoreTone(m.value)}`}>
            {m.display ?? (m.value != null ? m.value.toFixed(0) : "—")}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PredictionLaboratoryPanel({ match, compact = false }: Props) {
  const { t } = useLocale();
  const lab = useMemo(() => buildPredictionLaboratory(match), [match]);

  if (!lab.available) {
    if (compact) return null;
    return (
      <section className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)]">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">{t("panels.predictionAnalysis")}</h3>
        <p className="mt-1.5 text-sm font-medium text-[var(--fp-text-muted)]">{t("match.insufficientTitle")}</p>
      </section>
    );
  }

  if (compact) {
    const top = lab.radar.slice(0, 6);
    return (
      <div className="mt-1.5 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2.5 py-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[8px] font-bold uppercase tracking-[0.16em] text-[var(--fp-accent)]">{t("panels.predictionAnalysis")}</span>
          {lab.bookmaker?.differencePp != null && (
            <span className={`text-[9px] font-bold tabular-nums ${edgeTone(lab.bookmaker.differencePp)}`}>
              Δ {lab.bookmaker.differencePp >= 0 ? "+" : ""}
              {lab.bookmaker.differencePp.toFixed(1)}pp
            </span>
          )}
        </div>
        <div className="flex h-14 items-end gap-0.5">
          {top.map((p) => (
            <div key={p.key} className="flex min-w-0 flex-1 flex-col items-center gap-0.5" title={`${p.metric}: ${p.value}`}>
              <div
                className="w-full rounded-sm bg-[var(--fp-accent)]/70"
                style={{ height: `${Math.max(8, (p.value / 100) * 40)}px` }}
              />
              <span className="truncate text-[7px] font-semibold text-[var(--fp-text-muted)]">{p.metric.slice(0, 3)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)]">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">{t("panels.predictionAnalysis")}</h3>
          <p className="mt-0.5 text-xs font-medium text-[var(--fp-text-muted)]">
            Poisson · xG · standings · attack · defense · odds · confidence · EV · book Δ · evolution
          </p>
        </div>
        <div className="text-[10px] font-semibold tabular-nums text-[var(--fp-text-muted)]">
          auto · {new Date(lab.updatedAt).toLocaleTimeString()}
          {lab.pick ? ` · pick ${lab.pick}` : ""}
        </div>
      </div>

      <MetricsStrip lab={lab} />

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2.5">
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">{t("panels.radar")}</div>
          <LabRadar data={lab.radar} />
        </div>
        <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2.5">
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">{t("panels.comparison")}</div>
          <ComparisonTable lab={lab} />
        </div>
      </div>

      {lab.evolution.length > 0 && (
        <div className="mt-3 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-2.5">
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">
            {t("panels.evolution")}
          </div>
          <EvolutionChart data={lab.evolution} />
        </div>
      )}
    </section>
  );
}
