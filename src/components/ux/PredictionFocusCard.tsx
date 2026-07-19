import type { PredictionRow } from "../../types";
import { isFixtureInPlay } from "../../utils/appUtils";

type Props = {
  row: PredictionRow;
  watched?: boolean;
  onToggleWatch?: () => void;
  onOpen: () => void;
};

function deriveOdd(row: PredictionRow): string {
  const explicit = Number(row.recommended?.odd);
  if (Number.isFinite(explicit) && explicit > 1) return explicit.toFixed(2);
  const pick = (row.recommended?.pick || "").trim().toLowerCase();
  if (pick === "1" && Number.isFinite(Number(row.odds?.home))) return Number(row.odds?.home).toFixed(2);
  if (pick === "x" && Number.isFinite(Number(row.odds?.draw))) return Number(row.odds?.draw).toFixed(2);
  if (pick === "2" && Number.isFinite(Number(row.odds?.away))) return Number(row.odds?.away).toFixed(2);
  return "—";
}

/** Clean consumer prediction card — heart of the Enterprise V2 dashboard. */
export default function PredictionFocusCard({ row, watched, onToggleWatch, onOpen }: Props) {
  const conf = Number(row.recommended?.confidence);
  const confLabel = Number.isFinite(conf) ? `${Math.round(conf)}%` : row.recommended?.confidenceCategory || "—";
  const ev = Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue);
  const hasValue = row.valueBet?.detected || (Number.isFinite(ev) && ev > 0);
  const live = isFixtureInPlay(row.status);
  const kickoff = new Date(row.kickoff);
  const time = Number.isFinite(kickoff.getTime())
    ? kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  if (row.insufficientData) {
    return (
      <article className="rounded-[var(--fp-radius)] border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-5 shadow-[var(--fp-shadow-sm)]">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fp-warning)]">Limited data</p>
        <p className="mt-2 font-display text-lg font-semibold text-[var(--fp-text)]">
          {row.teams.home} vs {row.teams.away}
        </p>
        <p className="mt-1 text-sm text-[var(--fp-text-muted)]">Open for details — prediction unavailable.</p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-4 min-h-[var(--fp-touch)] text-sm font-semibold text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
        >
          Open →
        </button>
      </article>
    );
  }

  return (
    <article className="group flex flex-col rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-5 shadow-[var(--fp-shadow-sm)] transition-[box-shadow,transform] duration-[var(--fp-ease)] hover:-translate-y-0.5 hover:shadow-[var(--fp-shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {row.logos?.league ? (
              <img src={row.logos.league} alt="" className="h-5 w-5 object-contain" />
            ) : null}
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
              {row.league}
            </p>
            {live && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--fp-danger)]/10 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--fp-danger)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-danger)] motion-reduce:animate-none" />
                Live
              </span>
            )}
            {hasValue && (
              <span className="rounded-full bg-[var(--fp-warning)]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--fp-warning)]">
                Value
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-sm tabular-nums text-[var(--fp-text-faint)]">{time}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {onToggleWatch && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatch();
              }}
              className={`flex h-11 w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                watched
                  ? "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]"
                  : "border-[var(--fp-border)] text-[var(--fp-text-muted)]"
              }`}
              title={watched ? "Remove from favorites" : "Add to favorites"}
              aria-label={watched ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={watched}
            >
              ★
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            title="Open match analysis"
            className="flex h-11 w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] text-[var(--fp-text-muted)] transition-colors hover:border-[var(--fp-accent)] hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
            aria-label="Expand match details"
          >
            ↗
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="mt-4 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
      >
        <div className="flex min-w-0 flex-col items-center gap-2">
          <img src={row.logos?.home} alt="" className="h-12 w-12 object-contain sm:h-14 sm:w-14" />
          <span className="line-clamp-2 text-center text-sm font-semibold text-[var(--fp-text)]">{row.teams.home}</span>
        </div>
        <span className="font-mono text-xs text-[var(--fp-text-faint)]">vs</span>
        <div className="flex min-w-0 flex-col items-center gap-2">
          <img src={row.logos?.away} alt="" className="h-12 w-12 object-contain sm:h-14 sm:w-14" />
          <span className="line-clamp-2 text-center text-sm font-semibold text-[var(--fp-text)]">{row.teams.away}</span>
        </div>
      </button>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-[var(--fp-radius-sm)] bg-[var(--fp-bg-muted)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-faint)]">Prediction</p>
          <p className="mt-0.5 font-display text-lg font-bold text-[var(--fp-accent)]">{row.recommended?.pick || "—"}</p>
        </div>
        <div className="rounded-[var(--fp-radius-sm)] bg-[var(--fp-bg-muted)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-faint)]">Confidence</p>
          <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-[var(--fp-text)]">{confLabel}</p>
        </div>
        <div className="rounded-[var(--fp-radius-sm)] bg-[var(--fp-bg-muted)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-faint)]">Odds</p>
          <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-[var(--fp-text)]">{deriveOdd(row)}</p>
        </div>
        <div className="rounded-[var(--fp-radius-sm)] bg-[var(--fp-bg-muted)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-faint)]">Value</p>
          <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-[var(--fp-text)]">
            {Number.isFinite(ev) && ev !== 0 ? `${ev > 0 ? "+" : ""}${ev.toFixed(1)}%` : hasValue ? "Yes" : "—"}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="mt-4 w-full min-h-[var(--fp-touch)] rounded-[var(--fp-radius-sm)] bg-[var(--fp-accent)] text-sm font-semibold text-white transition-colors hover:bg-[var(--fp-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
      >
        Open analysis
      </button>
    </article>
  );
}
