/**
 * MarketPickCard — moved verbatim from MatchModal.tsx (Sprint 7). Behavior unchanged.
 */

import { useLocale } from "../../context/LocaleContext";
import type { MarketTierInfo } from "../../types";
import { tierBadgeLabel, tierToneClass } from "./helpers";

export default function MarketPickCard({
  label,
  info,
  outcome = null
}: {
  label: string;
  info: MarketTierInfo | undefined;
  /** After FT: true = win (green), false = loss (red). */
  outcome?: boolean | null;
}) {
  const { t: tr } = useLocale();
  const settledTone =
    outcome === true
      ? "border-[var(--fp-success)]/50 bg-[var(--fp-success)]/10"
      : outcome === false
        ? "border-[var(--fp-danger)]/50 bg-[var(--fp-danger)]/10"
        : null;
  const valueTone =
    outcome === true
      ? "text-[var(--fp-success)]"
      : outcome === false
        ? "text-[var(--fp-danger)]"
        : "";
  const tone = settledTone || tierToneClass(info?.tier);
  const badge = outcome == null ? tierBadgeLabel(info?.tier, tr) : "";
  const isToss = outcome == null && info?.tier === "toss";
  return (
    <div className={`relative rounded-xl border p-3 text-center ${tone}`}>
      {outcome != null ? (
        <span
          className={`absolute -right-1.5 -top-2 z-10 rounded-md px-2 py-0.5 font-mono text-[9px] font-extrabold uppercase tracking-wider shadow-sm sm:text-[10px] ${
            outcome
              ? "bg-[var(--fp-success)] text-white"
              : "bg-[var(--fp-danger)] text-white"
          }`}
        >
          {outcome ? tr("card.chipWin") : tr("card.chipLose")}
        </span>
      ) : null}
      <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
        <span>{label}</span>
        {badge ? (
          <span
            className={`rounded-sm px-1 py-[1px] text-[9px] font-bold tracking-wider ${
              isToss ? "bg-[var(--fp-warning)]/20 text-[var(--fp-warning)]" : ""
            }`}
            title={
              info?.tier === "toss"
                ? "Probabilităţile sunt practic 50/50 — modelul nu are direcţie clară"
                : undefined
            }
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline justify-center gap-1.5">
        <span className={`font-mono text-sm font-semibold ${valueTone}`}>{info?.pick ?? "—"}</span>
        {info?.prob != null && Number.isFinite(info.prob) ? (
          <span className={`font-mono text-[10px] tabular-nums ${valueTone || "opacity-80"}`}>
            {isToss ? "≈ " : ""}
            {info.prob.toFixed(0)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

