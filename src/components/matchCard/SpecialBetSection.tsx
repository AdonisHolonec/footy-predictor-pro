import { useLocale } from "../../context/LocaleContext";
import type { PredictionRow } from "../../types";
import {
  listSpecialBetCandidates,
  pickSpecialBetLegs,
  outcomeTextClass,
  specialBetCombinedOdd as specialBetCombinedOddValue,
  specialBetCombinedOutcome,
  specialBetLiveAdjustmentBadge
} from "../../utils/specialBet";

type SpecialBetSectionProps = {
  row: PredictionRow;
  canShowSpecialBet: boolean;
  hasExactConfidence: boolean;
  specialLegCount: 2 | 3;
  onLegCountChange: (n: 2 | 3) => void;
};

export function SpecialBetSection({
  row,
  canShowSpecialBet,
  hasExactConfidence,
  specialLegCount,
  onLegCountChange
}: SpecialBetSectionProps) {
  const { t } = useLocale();

  if (!canShowSpecialBet) {
    return (
      <div className="mt-2.5 min-w-0 rounded-lg border border-fp-warning/35 bg-fp-warning/10 px-2.5 py-2 shadow-fp-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--fp-warning)] sm:text-xs">
            {t("card.specialBet")}
          </div>
          <span className="text-sm" aria-hidden>
            🔒
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--fp-text-muted)] sm:text-xs">{t("card.specialBetLocked")}</p>
      </div>
    );
  }

  const specialBetLabels = {
    main: t("match.featMain"),
    goals: t("card.marketGoals"),
    corners: t("match.featCorners"),
    shots: t("match.featShots"),
    ht: t("match.featHt"),
    gg: t("match.marketGgNgg"),
    cards: t("match.cards")
  };
  const specialBetPool = listSpecialBetCandidates(row, specialBetLabels, row.cardMarketValidations);
  const specialBetLegs = pickSpecialBetLegs(specialBetPool, specialLegCount);
  const specialBetCombinedOdd = specialBetCombinedOddValue(specialBetLegs);
  const specialCombinedOutcome = specialBetCombinedOutcome(specialBetLegs);
  const specialCombinedTone = outcomeTextClass(specialCombinedOutcome);
  const specialBetCandidatesLen = specialBetPool.length;

  if (!hasExactConfidence || specialBetLegs.length < 2) return null;

  return (
    <div className="mt-2.5 min-w-0 rounded-lg border border-fp-success/45 bg-fp-success/10 px-2.5 py-2 shadow-fp-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--fp-success)] sm:text-xs">
          {t("card.specialBet")}
        </div>
        {specialBetCandidatesLen >= 3 ? (
          <div
            className="inline-flex rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-0.5"
            role="group"
            aria-label={t("card.specialBet")}
          >
            {[2, 3].map((n) => {
              const active = specialLegCount === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  onClick={(e) => {
                    e.stopPropagation();
                    onLegCountChange(n as 2 | 3);
                  }}
                  className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors sm:text-[11px] ${
                    active
                      ? "bg-[var(--fp-success)] text-white shadow-sm ring-1 ring-[var(--fp-success)]"
                      : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
                  }`}
                >
                  {t("card.legs", { n })}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="mt-1.5 space-y-1">
        {specialBetLegs.map((leg) => {
          const tone = outcomeTextClass(leg.outcome);
          const liveBadge = leg.id === "recommended" ? specialBetLiveAdjustmentBadge(leg.liveAdjustment) : null;
          return (
            <div
              key={`${leg.label}-${leg.pick}`}
              className={`flex items-center justify-between gap-2 text-[11px] sm:text-xs ${tone}`}
            >
              <span className="min-w-0 flex-1 truncate font-semibold">
                {leg.label}: {leg.pick}
              </span>
              <span className="shrink-0 tabular-nums font-bold">
                {Math.round(leg.probability)}% · {Number(leg.odd).toFixed(2)}
                {liveBadge && (
                  <span
                    className={`ml-1 ${liveBadge.tone === "success" ? "text-[var(--fp-success)]" : "text-[var(--fp-danger)]"}`}
                    title={t(
                      liveBadge.tone === "success" ? "panels.liveAdjustedAligned" : "panels.liveAdjustedContradicted",
                      { delta: liveBadge.delta }
                    )}
                  >
                    {liveBadge.delta}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`text-sm font-extrabold tabular-nums tracking-tight sm:text-base ${specialCombinedTone}`}>
          {t("card.combinedOdd", {
            odd: Number.isFinite(Number(specialBetCombinedOdd))
              ? Number(specialBetCombinedOdd).toFixed(2)
              : t("card.na")
          })}
        </span>
        {specialCombinedOutcome === "win" || specialCombinedOutcome === "loss" ? (
          <span
            className={`rounded-md px-2 py-0.5 font-mono text-[9px] font-extrabold uppercase tracking-wider shadow-sm sm:text-[10px] ${
              specialCombinedOutcome === "win"
                ? "bg-[var(--fp-success)] text-white"
                : "bg-[var(--fp-danger)] text-white"
            }`}
          >
            {specialCombinedOutcome === "win" ? t("card.chipWin") : t("card.chipLose")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
