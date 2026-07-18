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
import type { PredictionRow } from "../types";
import { buildPredictionLaboratory, type PredictionLaboratory } from "../utils/predictionLaboratory";

const tip = {
  background: "rgba(10, 16, 24, 0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  fontSize: 11,
  color: "#d5dee8"
};

type Props = {
  match: PredictionRow;
  /** Compact strip for MatchCard */
  compact?: boolean;
};

function scoreTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-signal-inkMuted";
  if (v >= 70) return "text-signal-sage";
  if (v >= 55) return "text-signal-petrol";
  if (v >= 40) return "text-signal-amberSoft";
  return "text-signal-rose";
}

function edgeTone(edge: number | null): string {
  if (edge == null || !Number.isFinite(edge)) return "text-signal-inkMuted";
  if (edge > 0.05) return "text-signal-sage";
  if (edge < -0.05) return "text-signal-rose";
  return "text-signal-inkMuted";
}

function LabRadar({ data }: { data: PredictionLaboratory["radar"] }) {
  return (
    <div className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="72%">
          <PolarGrid stroke="rgba(255,255,255,0.12)" />
          <PolarAngleAxis dataKey="metric" tick={{ fill: "#9aabba", fontSize: 10 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#7a8a9a", fontSize: 9 }} />
          <Radar
            name="Laboratory"
            dataKey="value"
            stroke="#5ec4b6"
            fill="#5ec4b6"
            fillOpacity={0.32}
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
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="stage" tick={{ fill: "#8a9aaa", fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fill: "#7a8a9a", fontSize: 10 }} width={32} unit="%" />
          <Tooltip contentStyle={tip} />
          <Legend wrapperStyle={{ fontSize: 10, color: "#9aabba" }} />
          <Line type="monotone" dataKey="p1" name="Home %" stroke="#5ec4b6" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="pX" name="Draw %" stroke="#6a9bb8" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="p2" name="Away %" stroke="#e0b46a" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ComparisonTable({ lab }: { lab: PredictionLaboratory }) {
  const cmp = lab.comparison;
  if (!cmp) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-white/5 bg-signal-void/35">
      <table className="w-full min-w-[320px] border-collapse text-left font-mono text-[11px]">
        <thead>
          <tr className="border-b border-white/8 text-[9px] uppercase tracking-wider text-signal-inkMuted">
            <th className="px-3 py-2.5 font-medium">Metric</th>
            <th className="px-3 py-2.5 font-medium text-right">{cmp.homeName}</th>
            <th className="px-3 py-2.5 font-medium text-right">{cmp.awayName}</th>
            <th className="px-3 py-2.5 font-medium text-right">Edge</th>
          </tr>
        </thead>
        <tbody>
          {cmp.rows.map((r) => (
            <tr key={r.metric} className="border-b border-white/[0.04] last:border-0">
              <td className="px-3 py-2 text-signal-silver">{r.metric}</td>
              <td className="px-3 py-2 text-right tabular-nums text-signal-ink">{r.homeDisplay}</td>
              <td className="px-3 py-2 text-right tabular-nums text-signal-ink">{r.awayDisplay}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${edgeTone(r.edge)}`}>
                {r.edge == null ? "—" : `${r.edge > 0 ? "+" : ""}${r.edge}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cmp.drawOdd != null && (
        <div className="border-t border-white/5 px-3 py-2 font-mono text-[10px] text-signal-inkMuted">
          Draw odd · {Number(cmp.drawOdd).toFixed(2)}
          {lab.bookmaker?.differencePp != null && (
            <span className="ml-3">
              Book Δ ·{" "}
              <span className={edgeTone(lab.bookmaker.differencePp)}>
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
          className="rounded-lg border border-white/5 bg-signal-mist/25 px-2.5 py-2"
          title={m.label}
        >
          <div className="truncate font-mono text-[8px] uppercase tracking-wider text-signal-inkMuted">
            {m.label}
          </div>
          <div className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${scoreTone(m.value)}`}>
            {m.display ?? (m.value != null ? m.value.toFixed(0) : "—")}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PredictionLaboratoryPanel({ match, compact = false }: Props) {
  // Recompute whenever any match field changes (predict refresh / live score sync).
  const lab = useMemo(() => buildPredictionLaboratory(match), [match]);

  if (!lab.available) {
    if (compact) return null;
    return (
      <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">
          Prediction Laboratory
        </h3>
        <p className="mt-2 text-[11px] text-signal-inkMuted">Insufficient data for laboratory diagnostics.</p>
      </section>
    );
  }

  if (compact) {
    const top = lab.radar.slice(0, 6);
    return (
      <div className="mt-1.5 rounded-xl border border-white/5 bg-signal-void/40 px-2.5 py-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-signal-petrol/80">
            Laboratory
          </span>
          {lab.bookmaker?.differencePp != null && (
            <span className={`font-mono text-[9px] tabular-nums ${edgeTone(lab.bookmaker.differencePp)}`}>
              Δ {lab.bookmaker.differencePp >= 0 ? "+" : ""}
              {lab.bookmaker.differencePp.toFixed(1)}pp
            </span>
          )}
        </div>
        <div className="flex h-14 items-end gap-0.5">
          {top.map((p) => (
            <div key={p.key} className="flex min-w-0 flex-1 flex-col items-center gap-0.5" title={`${p.metric}: ${p.value}`}>
              <div
                className="w-full rounded-sm bg-signal-petrol/55"
                style={{ height: `${Math.max(8, (p.value / 100) * 40)}px` }}
              />
              <span className="truncate font-mono text-[7px] text-signal-inkMuted">{p.metric.slice(0, 3)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">
            Prediction Laboratory
          </h3>
          <p className="mt-1 text-[11px] text-signal-inkMuted">
            Poisson · xG · standings · attack · defense · odds · confidence · EV · book Δ · evolution
          </p>
        </div>
        <div className="font-mono text-[9px] tabular-nums text-signal-inkMuted">
          auto · {new Date(lab.updatedAt).toLocaleTimeString()}
          {lab.pick ? ` · pick ${lab.pick}` : ""}
        </div>
      </div>

      <MetricsStrip lab={lab} />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-signal-mist/15 p-3 sm:p-4">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">
            Radar profile
          </div>
          <LabRadar data={lab.radar} />
        </div>
        <div className="rounded-xl border border-white/5 bg-signal-mist/15 p-3 sm:p-4">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">
            Comparison table
          </div>
          <ComparisonTable lab={lab} />
        </div>
      </div>

      {lab.evolution.length > 0 && (
        <div className="mt-5 rounded-xl border border-white/5 bg-signal-mist/15 p-3 sm:p-4">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">
            Prediction evolution · 1X2 %
          </div>
          <EvolutionChart data={lab.evolution} />
        </div>
      )}
    </section>
  );
}
