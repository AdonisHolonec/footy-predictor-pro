import type { ReactNode } from "react";

type Props = {
  date: string;
  onDateChange: (date: string) => void;
  search: string;
  onSearchChange: (q: string) => void;
  minConfidence: number;
  onMinConfidence: (n: number) => void;
  minEv: number;
  onMinEv: (n: number) => void;
  valueOnly: boolean;
  onValueOnly: (v: boolean) => void;
  settledOnly: boolean;
  onSettledOnly: (v: boolean) => void;
  onOpenLeagues?: () => void;
  extraDates?: ReactNode;
};

export default function StickyFilterBar({
  date,
  onDateChange,
  search,
  onSearchChange,
  minConfidence,
  onMinConfidence,
  minEv,
  onMinEv,
  valueOnly,
  onValueOnly,
  settledOnly,
  onSettledOnly,
  onOpenLeagues,
  extraDates
}: Props) {
  return (
    <div className="sticky top-14 z-30 -mx-4 border-b border-[var(--fp-border)] bg-[var(--fp-bg)]/90 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-0 lg:px-0">
      <div className="flex max-w-[1280px] flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text)]"
        />
        {extraDates}
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search teams / leagues…"
          className="min-w-[10rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] sm:max-w-xs"
        />
        {onOpenLeagues && (
          <button
            type="button"
            onClick={onOpenLeagues}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]"
          >
            ★ Leagues
          </button>
        )}
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-muted)]">
          Conf ≥
          <input
            type="number"
            min={0}
            max={100}
            value={minConfidence}
            onChange={(e) => onMinConfidence(Number(e.target.value) || 0)}
            className="w-14 rounded border border-[var(--border)] bg-[var(--bg-muted)] px-1 py-1 text-[var(--text)]"
          />
        </label>
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-muted)]">
          EV ≥
          <input
            type="number"
            min={0}
            max={50}
            value={minEv}
            onChange={(e) => onMinEv(Number(e.target.value) || 0)}
            className="w-14 rounded border border-[var(--border)] bg-[var(--bg-muted)] px-1 py-1 text-[var(--text)]"
          />
        </label>
        <button
          type="button"
          onClick={() => onValueOnly(!valueOnly)}
          className={`rounded-lg border px-3 py-2 text-[10px] font-semibold uppercase ${
            valueOnly
              ? "border-[var(--accent-2)]/40 bg-[var(--accent-2)]/10 text-[var(--accent-2)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          Value only
        </button>
        <button
          type="button"
          onClick={() => onSettledOnly(!settledOnly)}
          className={`rounded-lg border px-3 py-2 text-[10px] font-semibold uppercase ${
            settledOnly
              ? "border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          Settled
        </button>
      </div>
    </div>
  );
}
