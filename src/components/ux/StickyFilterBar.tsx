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

const chipBase =
  "min-h-[var(--fp-touch)] rounded-[var(--fp-radius-sm)] border px-3 text-xs font-semibold transition-colors duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]";

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
        <label className="sr-only" htmlFor="fp-filter-date">
          Date
        </label>
        <input
          id="fp-filter-date"
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="min-h-[var(--fp-touch)] rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 text-sm text-[var(--fp-text)]"
        />
        {extraDates}
        <label className="sr-only" htmlFor="fp-filter-search">
          Search teams or competitions
        </label>
        <input
          id="fp-filter-search"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Team, competition, pick…"
          className="min-h-[var(--fp-touch)] min-w-[10rem] flex-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 text-sm text-[var(--fp-text)] placeholder:text-[var(--fp-text-faint)] sm:max-w-xs"
        />
        {onOpenLeagues && (
          <button type="button" onClick={onOpenLeagues} className={`${chipBase} border-[var(--fp-border)] text-[var(--fp-text-muted)]`}>
            ★ Leagues
          </button>
        )}
        <label className="flex min-h-[var(--fp-touch)] items-center gap-1.5 font-mono text-[10px] text-[var(--fp-text-muted)]">
          Confidence ≥
          <input
            type="number"
            min={0}
            max={100}
            value={minConfidence}
            onChange={(e) => onMinConfidence(Number(e.target.value) || 0)}
            className="w-14 rounded border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-1 py-1 text-[var(--fp-text)]"
            aria-label="Minimum confidence"
          />
        </label>
        <label className="flex min-h-[var(--fp-touch)] items-center gap-1.5 font-mono text-[10px] text-[var(--fp-text-muted)]">
          EV ≥
          <input
            type="number"
            min={0}
            max={50}
            value={minEv}
            onChange={(e) => onMinEv(Number(e.target.value) || 0)}
            className="w-14 rounded border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-1 py-1 text-[var(--fp-text)]"
            aria-label="Minimum expected value"
          />
        </label>
        <button
          type="button"
          onClick={() => onValueOnly(!valueOnly)}
          className={`${chipBase} uppercase ${
            valueOnly
              ? "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]"
              : "border-[var(--fp-border)] text-[var(--fp-text-muted)]"
          }`}
          aria-pressed={valueOnly}
        >
          Best Value only
        </button>
        <button
          type="button"
          onClick={() => onSettledOnly(!settledOnly)}
          className={`${chipBase} uppercase ${
            settledOnly
              ? "border-[var(--fp-success)]/40 bg-[var(--fp-success)]/10 text-[var(--fp-success)]"
              : "border-[var(--fp-border)] text-[var(--fp-text-muted)]"
          }`}
          aria-pressed={settledOnly}
        >
          Settled
        </button>
      </div>
    </div>
  );
}
