import type { PredictionRow } from "../../types";

type Props = {
  matches: PredictionRow[];
  onOpenMatch: (m: PredictionRow) => void;
  continueMatch?: PredictionRow | null;
  winRate?: number;
  pendingCount?: number;
};

function confOf(m: PredictionRow) {
  const c = Number(m.recommended?.confidence);
  return Number.isFinite(c) ? c : 0;
}

function evOf(m: PredictionRow) {
  const e = Number(m.valueBet?.ev ?? m.valueEngine?.expectedValue);
  return Number.isFinite(e) ? e : 0;
}

export default function TodayOverview({
  matches,
  onOpenMatch,
  continueMatch,
  winRate = 0,
  pendingCount = 0
}: Props) {
  const recommended = [...matches]
    .filter((m) => !m.insufficientData)
    .sort((a, b) => confOf(b) - confOf(a))
    .slice(0, 8);
  const valueBets = [...matches]
    .filter((m) => m.valueBet?.detected || evOf(m) > 0)
    .sort((a, b) => evOf(b) - evOf(a))
    .slice(0, 8);
  const avgConf =
    recommended.length > 0
      ? recommended.reduce((s, m) => s + confOf(m), 0) / recommended.length
      : 0;

  return (
    <section className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent)]">Today</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
          Overview
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Matches", value: String(matches.length) },
          { label: "Avg confidence", value: avgConf ? `${Math.round(avgConf)}%` : "—" },
          { label: "Value bets", value: String(valueBets.length) },
          { label: "Hit rate", value: winRate ? `${winRate.toFixed(0)}%` : "—" }
        ].map((k) => (
          <div
            key={k.label}
            className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3"
          >
            <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{k.label}</div>
            <div className="mt-1 font-display text-xl font-semibold tabular-nums text-[var(--text)]">{k.value}</div>
          </div>
        ))}
      </div>

      {continueMatch && (
        <button
          type="button"
          onClick={() => onOpenMatch(continueMatch)}
          className="flex w-full items-center justify-between rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-4 py-3 text-left"
        >
          <div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--accent)]">
              Continue where you left off
            </div>
            <div className="mt-0.5 font-semibold text-[var(--text)]">
              {continueMatch.teams.home} vs {continueMatch.teams.away}
            </div>
          </div>
          <span className="text-sm text-[var(--accent)]">Open →</span>
        </button>
      )}

      {pendingCount > 0 && (
        <p className="font-mono text-[10px] text-[var(--text-muted)]">{pendingCount} pending results</p>
      )}

      <Rail title="Recommended picks" items={recommended} onOpen={onOpenMatch} mode="conf" />
      <Rail title="Highest EV / value" items={valueBets} onOpen={onOpenMatch} mode="ev" />
    </section>
  );
}

function Rail({
  title,
  items,
  onOpen,
  mode
}: {
  title: string;
  items: PredictionRow[];
  onOpen: (m: PredictionRow) => void;
  mode: "conf" | "ev";
}) {
  if (!items.length) return null;
  return (
    <div>
      <h2 className="mb-2 font-display text-sm font-semibold text-[var(--text)]">{title}</h2>
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
        {items.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onOpen(m)}
            className="snap-start w-[220px] shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-left hover:border-[var(--accent)]/40"
          >
            <div className="truncate font-mono text-[9px] uppercase text-[var(--text-muted)]">{m.league}</div>
            <div className="mt-1 truncate text-sm font-semibold text-[var(--text)]">
              {m.teams.home} vs {m.teams.away}
            </div>
            <div className="mt-2 font-display text-base font-bold text-[var(--accent)]">{m.recommended?.pick || "—"}</div>
            <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
              {mode === "conf"
                ? confOf(m)
                  ? `${Math.round(confOf(m))}% conf`
                  : m.recommended?.confidenceCategory || "Locked"
                : evOf(m)
                  ? `EV +${evOf(m).toFixed(1)}%`
                  : "Value"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
