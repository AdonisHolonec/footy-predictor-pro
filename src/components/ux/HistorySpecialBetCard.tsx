import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import {
  listSpecialBetCandidates,
  pickSpecialBetLegs,
  outcomeTextClass,
  specialBetCombinedOdd as specialBetCombinedOddValue,
  specialBetCombinedOutcome
} from "../../utils/specialBet";
import { formatBookOdd, recommendedOdd, resolveFirstHalfGoalsActual } from "../../utils/marketPicks";
import { isFinalMatchStatus } from "../../utils/cardMarketOutcome";
import { fetchWithAuth } from "../../utils/apiAuth";
import { formatRecommendedPick } from "../../utils/formatRecommendation";
import MarketFamilyIcon from "../icons/MarketFamilyIcon";

type Props = {
  row: HistoryEntry;
  onOpenDetails?: (row: HistoryEntry) => void;
  /** Special Bet is Ultra-only; fails closed (locked) when omitted. */
  canShowSpecialBet?: boolean;
  onUpgradeRequired?: (feature: string, requiredTier: "ultra") => void;
};

/**
 * History selection card: team logos + top pick / odd / confidence,
 * plus multi-leg Special Bet when book odds exist for ≥2 legs.
 * Hydrates HT / market totals for finished matches so legs can settle.
 */
export default function HistorySpecialBetCard({ row, onOpenDetails, canShowSpecialBet = false, onUpgradeRequired }: Props) {
  const { t } = useLocale();
  const [legCount, setLegCount] = useState<2 | 3>(2);
  const [hydratedResults, setHydratedResults] = useState<HistoryEntry["marketResults"] | null>(null);
  const [hydrateAttempted, setHydrateAttempted] = useState(false);

  const enrichedRow = useMemo((): HistoryEntry => {
    if (!hydratedResults) return row;
    return {
      ...row,
      marketResults: {
        ...(row.marketResults || {}),
        ...hydratedResults
      }
    };
  }, [row, hydratedResults]);

  useEffect(() => {
    setHydratedResults(null);
    setHydrateAttempted(false);
  }, [row.id]);

  useEffect(() => {
    if (hydrateAttempted) return;
    if (!isFinalMatchStatus(row.status)) return;
    const hasHtPick = Boolean(row.probs?.firstHalf);
    const htKnown = resolveFirstHalfGoalsActual(row) != null;
    const needsHt = hasHtPick && !htKnown;
    const needsCorners =
      Boolean(row.probs?.corners) &&
      (row.marketResults?.cornersTotal == null || !Number.isFinite(Number(row.marketResults.cornersTotal)));
    const needsShots =
      Boolean(row.probs?.shotsOnTarget) &&
      (row.marketResults?.shotsOnTargetTotal == null ||
        !Number.isFinite(Number(row.marketResults.shotsOnTargetTotal)));
    if (!needsHt && !needsCorners && !needsShots) return;

    const id = Number(row.id);
    if (!Number.isFinite(id)) return;
    let cancelled = false;
    setHydrateAttempted(true);
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/fixtures?view=xg&fixtureId=${id}`);
        const json = (await res.json()) as { marketResults?: HistoryEntry["marketResults"] };
        if (cancelled || !json?.marketResults) return;
        setHydratedResults(json.marketResults);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row, hydrateAttempted]);

  const conf = Number(row.recommended?.confidence);
  const hasExactConfidence = Number.isFinite(conf);
  const confLabel = hasExactConfidence
    ? `${Math.round(conf)}%`
    : row.recommended?.confidenceCategory
      ? String(row.recommended.confidenceCategory)
      : "—";
  const odd = recommendedOdd(row);
  const oddLabel = formatBookOdd(odd, t("card.noBookOdd"));
  const recommendedLabel = formatRecommendedPick(row.recommended?.pick, row.recommended?.family, t);

  const pool = listSpecialBetCandidates(
    enrichedRow,
    {
      main: t("match.featMain"),
      goals: t("card.marketGoals"),
      corners: t("match.featCorners"),
      shots: t("match.featShots"),
      ht: t("match.featHt"),
      gg: t("match.marketGgNgg"),
      cards: t("match.cards")
    },
    enrichedRow.cardMarketValidations,
    enrichedRow.marketResults
  );
  const legs = pickSpecialBetLegs(pool, legCount);
  const showLegs = legs.length >= 2;
  const combined = specialBetCombinedOddValue(legs);
  const combinedOutcome = specialBetCombinedOutcome(legs);
  const combinedTone = outcomeTextClass(combinedOutcome);
  const htActual = resolveFirstHalfGoalsActual(enrichedRow);

  const homeLogo = row.logos?.home;
  const awayLogo = row.logos?.away;

  if (!canShowSpecialBet) {
    return (
      <article className="rounded-[var(--fp-radius)] border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 p-3 shadow-[var(--fp-shadow-sm)] sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--fp-warning)] sm:text-xs">
            {t("card.specialBet")}
          </p>
          <span className="text-base" aria-hidden>
            🔒
          </span>
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-[var(--fp-text)]">
          {row.teams?.home || "?"} {t("common.vs")} {row.teams?.away || "?"}
        </p>
        <p className="mt-1.5 text-xs text-[var(--fp-text-muted)]">{t("card.specialBetLocked")}</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUpgradeRequired?.(t("card.specialBet"), "ultra");
          }}
          className="mt-3 inline-flex items-center gap-1 rounded border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 px-2 py-1 text-[10px] font-bold text-[var(--fp-text)] hover:bg-[var(--fp-warning)]/20"
        >
          🔒 {t("card.unlock")}
        </button>
      </article>
    );
  }

  return (
    <article className="rounded-[var(--fp-radius)] border border-[var(--fp-success)]/45 bg-[var(--fp-success)]/10 p-3 shadow-[var(--fp-shadow-sm)] sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--fp-success)] sm:text-xs">
          {t("card.specialBet")}
        </p>
        {showLegs && pool.length >= 3 ? (
          <div
            className="inline-flex rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-0.5"
            role="group"
            aria-label={t("card.specialBet")}
          >
            {[2, 3].map((n) => {
              const active = legCount === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setLegCount(n as 2 | 3)}
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

      <div className="mt-3 flex items-center justify-center gap-3 sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
          {homeLogo ? (
            <img src={homeLogo} alt="" className="h-10 w-10 object-contain sm:h-12 sm:w-12" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--fp-bg-muted)] text-xs font-bold text-[var(--fp-text-muted)] sm:h-12 sm:w-12">
              {(row.teams?.home || "?").slice(0, 2).toUpperCase()}
            </div>
          )}
          <p className="max-w-full truncate text-center text-xs font-semibold text-[var(--fp-text)] sm:text-sm">
            {row.teams?.home || "?"}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] font-bold uppercase text-[var(--fp-text-muted)]">
          {t("common.vs")}
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
          {awayLogo ? (
            <img src={awayLogo} alt="" className="h-10 w-10 object-contain sm:h-12 sm:w-12" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--fp-bg-muted)] text-xs font-bold text-[var(--fp-text-muted)] sm:h-12 sm:w-12">
              {(row.teams?.away || "?").slice(0, 2).toUpperCase()}
            </div>
          )}
          <p className="max-w-full truncate text-center text-xs font-semibold text-[var(--fp-text)] sm:text-sm">
            {row.teams?.away || "?"}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-card)]/80 px-3 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
          {t("card.topPick")}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <p className="flex items-center gap-1.5 font-display text-lg font-semibold text-[var(--fp-text)]">
            <MarketFamilyIcon familyKey={recommendedLabel.familyKey} className="shrink-0" />
            {recommendedLabel.label}
          </p>
          <div className="text-right">
            <p className="font-mono text-sm font-bold tabular-nums text-[var(--fp-text)]">
              {t("card.oddLabel", { odd: oddLabel })}
            </p>
            <p className="font-mono text-xs tabular-nums text-[var(--fp-text-muted)]">
              {t("history.confidence", { value: confLabel })}
            </p>
          </div>
        </div>
        {row.score?.home != null && row.score?.away != null ? (
          <p className="mt-1 font-mono text-[11px] text-[var(--fp-text-muted)]">
            {t("history.score", { home: row.score.home, away: row.score.away })}
            {htActual != null ? ` · ${t("match.htGoalsLabel", { n: htActual })}` : ""}
          </p>
        ) : null}
      </div>

      {showLegs ? (
        <>
          <div className="mt-2.5 space-y-1">
            {legs.map((leg) => {
              const tone = outcomeTextClass(leg.outcome);
              return (
                <div
                  key={`${leg.id}-${leg.pick}`}
                  className={`flex items-center justify-between gap-2 text-[11px] sm:text-xs ${tone}`}
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {leg.label}: {leg.pick}
                  </span>
                  <span className="shrink-0 tabular-nums font-bold">
                    {Math.round(leg.probability)}% · {Number(leg.odd).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`text-sm font-extrabold tabular-nums tracking-tight sm:text-base ${combinedTone}`}>
              {t("card.combinedOdd", {
                odd: Number.isFinite(Number(combined)) ? Number(combined).toFixed(2) : t("card.na")
              })}
            </span>
            {combinedOutcome === "win" || combinedOutcome === "loss" ? (
              <span
                className={`rounded-md px-2 py-0.5 font-mono text-[9px] font-extrabold uppercase tracking-wider shadow-sm sm:text-[10px] ${
                  combinedOutcome === "win"
                    ? "bg-[var(--fp-success)] text-white"
                    : "bg-[var(--fp-danger)] text-white"
                }`}
              >
                {combinedOutcome === "win" ? t("card.chipWin") : t("card.chipLose")}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-2 text-[11px] text-[var(--fp-text-muted)]">{t("history.specialBetNoLegs")}</p>
      )}

      {onOpenDetails ? (
        <button
          type="button"
          onClick={() => onOpenDetails(enrichedRow)}
          className="mt-3 w-full rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 text-xs font-semibold text-[var(--fp-text)] transition-colors hover:border-[var(--fp-accent)]/40"
        >
          {t("history.openFullAnalysis")}
        </button>
      ) : null}
    </article>
  );
}
