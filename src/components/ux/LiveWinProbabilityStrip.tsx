import { useMemo } from "react";
import { useLocale } from "../../context/LocaleContext";
import type { PredictionRow } from "../../types";
import { deriveLiveWinProbability } from "../../utils/liveWinProbability";

/** Shifts smaller than this (pp) read as noise, not a story — show the stable line instead. */
const SHIFT_NOISE_FLOOR_PP = 3;

type Props = {
  match: PredictionRow;
  className?: string;
  /** Card-density variant: tighter paddings/typography for PredictionFocusCard; default is the modal panel. */
  compact?: boolean;
};

type OutcomeCell = {
  key: "p1" | "pX" | "p2";
  label: string;
  livePct: number;
  deltaPp: number | null;
  barClass: string;
  textClass: string;
};

function formatDelta(deltaPp: number): string {
  const rounded = Math.round(deltaPp);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/**
 * Live Win Probability strip — "what changed since kickoff", not more numbers.
 * Recomputes 1X2 chances from the live score/minute via deriveLiveWinProbability
 * (display-only; the engine's probs/recommended stay untouched) and leads with
 * the biggest mover versus the pre-match probabilities.
 */
export default function LiveWinProbabilityStrip({ match, className = "", compact = false }: Props) {
  const { t } = useLocale();
  const live = useMemo(
    () => deriveLiveWinProbability(match),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on the live inputs the derivation reads
    [match.status, match.score?.home, match.score?.away, match.score?.minute, match.lambdas]
  );
  if (!live) return null;

  const kickoff = match.probs;
  const cells: OutcomeCell[] = [
    {
      key: "p1",
      label: match.teams.home,
      livePct: live.p1,
      deltaPp: Number.isFinite(kickoff?.p1) ? live.p1 - kickoff.p1 : null,
      barClass: "bg-[var(--fp-accent)]",
      textClass: "text-[var(--fp-accent)]"
    },
    {
      key: "pX",
      label: t("match.liveWinDraw"),
      livePct: live.pX,
      deltaPp: Number.isFinite(kickoff?.pX) ? live.pX - kickoff.pX : null,
      barClass: "bg-[var(--fp-text-muted)]/50",
      textClass: "text-[var(--fp-text-muted)]"
    },
    {
      key: "p2",
      label: match.teams.away,
      livePct: live.p2,
      deltaPp: Number.isFinite(kickoff?.p2) ? live.p2 - kickoff.p2 : null,
      barClass: "bg-[var(--fp-danger)]",
      textClass: "text-[var(--fp-danger)]"
    }
  ];

  const biggestMover = cells
    .filter((c): c is OutcomeCell & { deltaPp: number } => c.deltaPp != null)
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))[0];
  const shiftLine =
    biggestMover && Math.abs(biggestMover.deltaPp) >= SHIFT_NOISE_FLOOR_PP
      ? t("match.liveWinShift", { label: biggestMover.label, delta: formatDelta(biggestMover.deltaPp) })
      : t("match.liveWinStable");

  return (
    <div
      className={
        compact
          ? `rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]/50 px-2.5 py-2 ${className}`
          : `rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]/50 p-3.5 shadow-[var(--fp-shadow-sm)] sm:p-4 ${className}`
      }
    >
      <div className={`flex items-center justify-between gap-2 ${compact ? "mb-1.5" : "mb-2.5"}`}>
        <p
          className={`font-bold uppercase tracking-wide text-[var(--fp-text-muted)] ${
            compact ? "text-[8px]" : "text-[10px] sm:text-[11px]"
          }`}
        >
          {t("match.liveWinTitle")}
        </p>
        <p
          className={`truncate font-semibold text-[var(--fp-text-muted)] ${
            compact ? "text-[9px]" : "text-[10px] sm:text-[11px]"
          }`}
        >
          {shiftLine}
        </p>
      </div>

      <div
        className={`flex w-full overflow-hidden rounded-full bg-[var(--fp-border)] ${compact ? "h-1.5" : "h-2"}`}
        role="img"
        aria-label={cells.map((c) => `${c.label} ${Math.round(c.livePct)}%`).join(" · ")}
      >
        {cells.map((c) => (
          <div
            key={c.key}
            className={`h-full ${c.barClass} transition-[width] duration-500`}
            style={{ width: `${c.livePct}%` }}
          />
        ))}
      </div>

      <div className={`grid grid-cols-3 gap-2 ${compact ? "mt-1.5 text-[9px]" : "mt-2 text-[10px] sm:text-[11px]"}`}>
        {cells.map((c, idx) => (
          <div
            key={c.key}
            className={`flex min-w-0 items-baseline gap-1.5 ${
              idx === 0 ? "justify-start" : idx === 1 ? "justify-center" : "justify-end"
            }`}
          >
            <span className="truncate font-semibold text-[var(--fp-text-muted)]">{c.label}</span>
            <span className={`font-mono font-bold tabular-nums ${c.textClass}`}>{Math.round(c.livePct)}%</span>
            {c.deltaPp != null && Math.abs(c.deltaPp) >= 1 && (
              <span
                className={`font-mono tabular-nums ${
                  c.deltaPp > 0 ? "text-[var(--fp-success)]" : "text-[var(--fp-danger)]"
                }`}
              >
                {formatDelta(c.deltaPp)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
