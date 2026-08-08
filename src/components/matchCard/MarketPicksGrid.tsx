import { useLocale } from "../../context/LocaleContext";
import type { PredictionRow } from "../../types";
import { matchingMarketOdd, shotsDisplayOdd } from "../../utils/marketPicks";
import { deriveBestOverUnderPick } from "./derivations";

type MarketPicksGridProps = {
  row: PredictionRow;
  /** Effective access tier (free / premium / ultra) — drives lock vs missing-data UI. */
  accessTier: string;
};

export function MarketPicksGrid({ row, accessTier }: MarketPicksGridProps) {
  const { t } = useLocale();
  const cornersPick = row.probs?.corners ? deriveBestOverUnderPick(row.probs.corners.total) : null;
  const shotsPick = row.probs?.shotsOnTarget ? deriveBestOverUnderPick(row.probs.shotsOnTarget.total) : null;
  const shotsTotalPick = row.probs?.shotsTotal ? deriveBestOverUnderPick(row.probs.shotsTotal.total) : null;
  const cardsPick = row.probs?.cards ? deriveBestOverUnderPick(row.probs.cards.total) : null;
  const firstHalfPick =
    row.probs?.firstHalf && Number.isFinite(row.probs.firstHalf.pO15)
      ? row.probs.firstHalf.pO15 >= 50
        ? { pick: "Over 1.5 FH", probability: row.probs.firstHalf.pO15 }
        : { pick: "Under 1.5 FH", probability: 100 - row.probs.firstHalf.pO15 }
      : null;
  // Mirrors server-utils/accessTier.js maskPredictionForTier(): corners unlock on
  // Premium/Ultra; shots, cards and first-half unlock on Ultra only.
  const effectiveAccessTier = String(accessTier || "free").toLowerCase();
  const canSeeCorners = effectiveAccessTier === "premium" || effectiveAccessTier === "ultra";
  const canSeeShots = effectiveAccessTier === "ultra";
  const canSeeCards = effectiveAccessTier === "ultra";
  const canSeeFirstHalf = effectiveAccessTier === "ultra";
  const cornersLocked = !canSeeCorners && !row.probs?.corners;
  const shotsLocked = !canSeeShots && !row.probs?.shotsOnTarget;
  const shotsTotalLocked = !canSeeShots && !row.probs?.shotsTotal;
  const cardsLocked = !canSeeCards && !row.probs?.cards;
  const firstHalfLocked = !canSeeFirstHalf && !row.probs?.firstHalf;
  const marketPulseWinnerLabel = (() => {
    const candidates = [
      { label: t("match.featCorners"), probability: Number(cornersPick?.probability || 0) },
      { label: t("match.featShots"), probability: Number(shotsPick?.probability || 0) },
      { label: t("match.featCards"), probability: Number(cardsPick?.probability || 0) },
      { label: t("match.featHt"), probability: Number(firstHalfPick?.probability || 0) }
    ];
    const winner = candidates.reduce((best, item) => (item.probability > best.probability ? item : best), candidates[0]);
    return winner.probability >= 85 ? winner.label : null;
  })();

  const hasContent =
    cornersPick || shotsPick || shotsTotalPick || cardsPick || firstHalfPick ||
    cornersLocked || shotsLocked || shotsTotalLocked || cardsLocked || firstHalfLocked;
  if (!hasContent) return null;

  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
      {[
        {
          label: t("match.featCorners"),
          data: cornersPick,
          locked: cornersLocked,
          odd: row.marketOdds?.corners?.odd,
          source: row.marketOdds?.corners?.bookmaker,
          accentClass: "border-[var(--fp-accent)]/35 bg-[var(--fp-accent-muted)]"
        },
        {
          label: t("match.shotsSub"),
          data: shotsPick,
          locked: shotsLocked,
          odd:
            shotsPick != null
              ? shotsDisplayOdd(row, shotsPick.side, shotsPick.line)
              : row.marketOdds?.shotsOnTarget?.odd,
          source: row.marketOdds?.shotsOnTarget?.bookmaker || row.marketOdds?.shotsTotal?.bookmaker,
          accentClass: "border-violet-500/35 bg-violet-500/10"
        },
        {
          label: t("match.shotsTotalTitle"),
          data: shotsTotalPick,
          locked: shotsTotalLocked,
          odd:
            shotsTotalPick != null
              ? matchingMarketOdd(row.marketOdds?.shotsTotal, shotsTotalPick.side, shotsTotalPick.line, 4)
              : row.marketOdds?.shotsTotal?.odd,
          source: row.marketOdds?.shotsTotal?.bookmaker,
          accentClass: "border-fuchsia-500/35 bg-fuchsia-500/10"
        },
        {
          label: t("match.featCards"),
          data: cardsPick,
          locked: cardsLocked,
          odd: row.marketOdds?.cards?.odd,
          source: row.marketOdds?.cards?.bookmaker,
          accentClass: "border-amber-500/35 bg-amber-500/10"
        },
        {
          label: t("match.featHt"),
          data: firstHalfPick,
          locked: firstHalfLocked,
          odd: row.marketOdds?.firstHalfGoals?.odd,
          source: row.marketOdds?.firstHalfGoals?.bookmaker,
          accentClass: "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10"
        }
      ].map((item) => {
        const isHot = item.label === marketPulseWinnerLabel;
        return (
        <div
          key={item.label}
          className={`rounded-md border px-1.5 py-1 text-center ${item.accentClass} ${isHot ? "ring-1 ring-[var(--fp-accent)]/40" : ""}`}
        >
          <div className="font-mono text-[8px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">{item.label}</div>
          {item.locked ? (
            <div
              className="mt-0.5 flex items-center justify-center gap-0.5 font-mono text-[9px] font-bold text-[var(--fp-text-muted)]"
              title={t("card.unlockHigher")}
            >
              🔒 {t("card.unlock")}
            </div>
          ) : (
            <>
              <div className="mt-0.5 font-mono text-[9px] font-bold text-[var(--fp-text)]">{item.data?.pick ?? "—"}</div>
              <div className="font-mono text-[8px] font-semibold tabular-nums text-[var(--fp-text)]">
                {item.data ? `${Math.round(item.data.probability)}%` : "—"}
              </div>
              <div className="font-mono text-[8px] font-semibold tabular-nums text-[var(--fp-text-muted)]">
                {Number.isFinite(Number(item.odd)) && Number(item.odd) > 1
                  ? t("card.oddLabel", { odd: Number(item.odd).toFixed(2) })
                  : "-"}
              </div>
              <div className="font-mono text-[8px] text-[var(--fp-text-faint)]">{item.source || t("card.sourceNa")}</div>
            </>
          )}
        </div>
      )})}
    </div>
  );
}
