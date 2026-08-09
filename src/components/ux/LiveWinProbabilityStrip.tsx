import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocale } from "../../context/LocaleContext";
import type { PredictionRow } from "../../types";
import {
  appendLiveWinHistory,
  deriveLiveWinProbability,
  type LiveWinHistoryPoint
} from "../../utils/liveWinProbability";

/** Shifts smaller than this (pp) read as noise, not a story — show the stable line instead. */
const SHIFT_NOISE_FLOOR_PP = 3;
/** Sparkline plot box (viewBox units) — strokes stay non-scaling so they render at true px. */
const SPARK_W = 100;
const SPARK_H = 32;

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

  // In-memory sparkline history (modal variant only) — per-mount like the momentum
  // timeline's, reset when the strip is reused for a different fixture.
  const [history, setHistory] = useState<LiveWinHistoryPoint[]>([]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const fixtureRef = useRef<number | null>(null);
  useEffect(() => {
    if (compact || !live) return;
    const point: LiveWinHistoryPoint = { minute: live.minute, p1: live.p1, pX: live.pX, p2: live.p2 };
    setHistory((prev) => {
      const base = fixtureRef.current === Number(match.id) ? prev : [];
      fixtureRef.current = Number(match.id);
      return appendLiveWinHistory(base, point);
    });
    setHoverIdx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one snapshot per observed live minute
  }, [compact, match.id, live?.minute, live?.p1, live?.pX, live?.p2]);

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

  // Sparkline geometry — x is the match clock (0..max(90, last minute)), y is 0–100%.
  const showSpark = !compact && history.length >= 2;
  const maxMinute = showSpark ? Math.max(90, history[history.length - 1].minute) : 90;
  const sparkX = (minute: number) => (minute / maxMinute) * SPARK_W;
  const sparkY = (pct: number) => SPARK_H - (pct / 100) * SPARK_H;
  const sparkPath = (key: "p1" | "pX" | "p2") =>
    history.map((pt) => `${sparkX(pt.minute).toFixed(2)},${sparkY(pt[key]).toFixed(2)}`).join(" ");
  const hoverPoint = hoverIdx != null ? (history[hoverIdx] ?? null) : null;
  const handleSparkPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const minuteAtCursor = ((e.clientX - rect.left) / rect.width) * maxMinute;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    history.forEach((pt, idx) => {
      const dist = Math.abs(pt.minute - minuteAtCursor);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    });
    setHoverIdx(best);
  };

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

      {showSpark && (
        <div className="relative mt-2" onPointerMove={handleSparkPointer} onPointerLeave={() => setHoverIdx(null)}>
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            className="block h-10 w-full"
            role="img"
            aria-label={`${t("match.liveWinTitle")} — ${match.teams.home} · ${t("match.liveWinDraw")} · ${match.teams.away}`}
          >
            <line
              x1="0"
              y1={sparkY(50)}
              x2={SPARK_W}
              y2={sparkY(50)}
              stroke="var(--fp-border)"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={sparkPath("pX")}
              fill="none"
              stroke="var(--fp-text-muted)"
              strokeOpacity="0.5"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={sparkPath("p2")}
              fill="none"
              stroke="var(--fp-danger)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={sparkPath("p1")}
              fill="none"
              stroke="var(--fp-accent)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {hoverPoint && (
              <line
                x1={sparkX(hoverPoint.minute)}
                y1="0"
                x2={sparkX(hoverPoint.minute)}
                y2={SPARK_H}
                stroke="var(--fp-text-muted)"
                strokeOpacity="0.6"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {hoverPoint && (
            <div
              className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2 py-1 font-mono text-[9px] tabular-nums text-[var(--fp-text)] shadow-[var(--fp-shadow-sm)]"
              style={{ left: `${Math.min(88, Math.max(12, (hoverPoint.minute / maxMinute) * 100))}%` }}
            >
              {hoverPoint.minute}&apos;
              <span className="mx-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--fp-accent)] align-middle" aria-hidden />
              {Math.round(hoverPoint.p1)}%
              <span className="mx-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--fp-text-muted)]/50 align-middle" aria-hidden />
              {Math.round(hoverPoint.pX)}%
              <span className="mx-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--fp-danger)] align-middle" aria-hidden />
              {Math.round(hoverPoint.p2)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}
