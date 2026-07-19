import type { PredictionRow } from "../../types";
import { isFixtureInPlay } from "../../utils/appUtils";
import { useLocale } from "../../context/LocaleContext";
import { useKickoffWeather, weatherCodeKey } from "../../hooks/useKickoffWeather";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import {
  deriveBestGoalsPick,
  deriveBestOverUnderPick,
  goalsOddForLine,
  recommendedOdd
} from "../../utils/marketPicks";

type Props = {
  row: PredictionRow;
  watched?: boolean;
  onToggleWatch?: () => void;
  onOpen: () => void;
  onUpgradeRequired?: (feature: string, requiredTier: UpgradeTier) => void;
};

type MarketRow = {
  id: string;
  marketLabel: string;
  locked: boolean;
  lockTier: UpgradeTier;
  lockFeature: string;
  pick: string;
  confidence: string;
  odd: string;
  value: string;
  accent?: boolean;
};

function fmtOdd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 1) return "—";
  return n.toFixed(2);
}

function sidePickLabel(
  t: (k: string, p?: Record<string, string | number>) => string,
  side: "over" | "under",
  line: number
): string {
  return side === "over" ? t("match.overLine", { line: line.toFixed(1) }) : t("match.underLine", { line: line.toFixed(1) });
}

/** Consumer prediction card — markets table + rank / referee / weather. */
export default function PredictionFocusCard({
  row,
  watched,
  onToggleWatch,
  onOpen,
  onUpgradeRequired
}: Props) {
  const { t } = useLocale();
  const { weather } = useKickoffWeather(row.venue, row.kickoff);

  const conf = Number(row.recommended?.confidence);
  const hasExactConfidence = Number.isFinite(conf);
  const confidenceCategory = row.recommended?.confidenceCategory || null;
  const isPremiumLike = !hasExactConfidence && Boolean(confidenceCategory);
  const isFreeLike = !hasExactConfidence && !confidenceCategory;

  const ev = Number(row.valueBet?.ev ?? row.valueEngine?.expectedValue);
  const hasValue = row.valueBet?.detected || (Number.isFinite(ev) && ev > 0);
  const live = isFixtureInPlay(row.status);
  const kickoff = new Date(row.kickoff);
  const time = Number.isFinite(kickoff.getTime())
    ? kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  const homeRank = row.teamContext?.home?.rank;
  const awayRank = row.teamContext?.away?.rank;

  const goals = deriveBestGoalsPick(row);
  const corners = row.probs?.corners ? deriveBestOverUnderPick(row.probs.corners.total) : null;
  const shots = row.probs?.shotsOnTarget ? deriveBestOverUnderPick(row.probs.shotsOnTarget.total) : null;

  const cornersLocked = !row.probs?.corners;
  const shotsLocked = !row.probs?.shotsOnTarget;

  const confLabel = hasExactConfidence
    ? `${Math.round(conf)}%`
    : confidenceCategory
      ? String(confidenceCategory)
      : "—";

  const valueLabel =
    Number.isFinite(ev) && ev !== 0
      ? `${ev > 0 ? "+" : ""}${ev.toFixed(1)}%`
      : hasValue
        ? t("common.yes")
        : "—";

  const marketRows: MarketRow[] = [
    {
      id: "recommended",
      marketLabel: t("card.marketRecommended"),
      locked: false,
      lockTier: "premium",
      lockFeature: t("match.featMain"),
      pick: row.recommended?.pick || "—",
      confidence: confLabel,
      odd: fmtOdd(recommendedOdd(row)),
      value: isFreeLike ? "—" : valueLabel,
      accent: true
    },
    {
      id: "goals",
      marketLabel: t("card.marketGoals"),
      locked: false,
      lockTier: "premium",
      lockFeature: t("card.marketGoals"),
      pick: goals ? sidePickLabel(t, goals.side, goals.line) : row.predictions?.over25 || "—",
      confidence: goals ? `${Math.round(goals.probability)}%` : "—",
      odd: goals ? fmtOdd(goalsOddForLine(row, goals.line, goals.side)) : "—",
      value: "—"
    },
    {
      id: "corners",
      marketLabel: t("card.marketCorners"),
      locked: cornersLocked,
      lockTier: "premium",
      lockFeature: t("match.featCorners"),
      pick: corners ? sidePickLabel(t, corners.side, corners.line) : "—",
      confidence: corners ? `${Math.round(corners.probability)}%` : "—",
      odd: fmtOdd(Number(row.marketOdds?.corners?.odd)),
      value: "—"
    },
    {
      id: "shots",
      marketLabel: t("card.marketShots"),
      locked: shotsLocked,
      lockTier: "ultra",
      lockFeature: t("match.featShots"),
      pick: shots ? sidePickLabel(t, shots.side, shots.line) : "—",
      confidence: shots ? `${Math.round(shots.probability)}%` : "—",
      odd: fmtOdd(Number(row.marketOdds?.shotsOnTarget?.odd)),
      value: "—"
    }
  ];

  const weatherText = weather
    ? `${weather.tempC}°C · ${t(weatherCodeKey(weather.code))}`
    : t("card.weatherUnavailable");

  if (row.insufficientData) {
    return (
      <article
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="cursor-pointer rounded-[var(--fp-radius)] border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)]"
      >
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-warning)]">{t("card.limitedData")}</p>
        <p className="mt-1 font-display text-base font-semibold text-[var(--fp-text)]">
          {row.teams.home} {t("common.vs")} {row.teams.away}
        </p>
        <p className="mt-1 text-xs text-[var(--fp-text-muted)]">{t("card.openForDetails")}</p>
      </article>
    );
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)] transition-[box-shadow,transform] duration-[var(--fp-ease)] hover:-translate-y-0.5 hover:shadow-[var(--fp-shadow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {row.logos?.league ? <img src={row.logos.league} alt="" className="h-4 w-4 object-contain" /> : null}
            <p className="truncate text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
              {row.league}
            </p>
            {live && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--fp-danger)]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--fp-danger)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-danger)] motion-reduce:animate-none" />
                {t("card.live")}
              </span>
            )}
            {hasValue && !isFreeLike && (
              <span className="rounded-full bg-[var(--fp-warning)]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--fp-warning)]">
                {t("card.value")}
              </span>
            )}
            <span className="font-mono text-[11px] tabular-nums text-[var(--fp-text-faint)]">{time}</span>
          </div>
          <p className="mt-1 truncate text-[10px] font-medium text-[var(--fp-text-muted)]">
            <span title={t("card.referee")}>{row.referee?.trim() || t("card.refereeUnavailable")}</span>
            <span className="mx-1.5 text-[var(--fp-text-faint)]">·</span>
            <span title={t("card.weather")}>{weatherText}</span>
          </p>
        </div>
        {onToggleWatch && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatch();
            }}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--fp-radius-sm)] border text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
              watched
                ? "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]"
                : "border-[var(--fp-border)] text-[var(--fp-text-muted)]"
            }`}
            title={watched ? t("card.removeFavorite") : t("card.addFavorite")}
            aria-label={watched ? t("card.removeFavorite") : t("card.addFavorite")}
            aria-pressed={watched}
          >
            ★
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 flex-col items-center gap-1">
          <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-faint)]">
            {homeRank != null && Number.isFinite(Number(homeRank))
              ? t("card.position", { n: Number(homeRank) })
              : t("card.positionNa")}
          </p>
          <img src={row.logos?.home} alt="" className="h-10 w-10 object-contain sm:h-11 sm:w-11" />
          <span className="line-clamp-2 text-center text-xs font-semibold text-[var(--fp-text)] sm:text-sm">
            {row.teams.home}
          </span>
        </div>
        <span className="text-[10px] font-bold uppercase text-[var(--fp-text-faint)]">{t("common.vs")}</span>
        <div className="flex min-w-0 flex-col items-center gap-1">
          <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-faint)]">
            {awayRank != null && Number.isFinite(Number(awayRank))
              ? t("card.position", { n: Number(awayRank) })
              : t("card.positionNa")}
          </p>
          <img src={row.logos?.away} alt="" className="h-10 w-10 object-contain sm:h-11 sm:w-11" />
          <span className="line-clamp-2 text-center text-xs font-semibold text-[var(--fp-text)] sm:text-sm">
            {row.teams.away}
          </span>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto border-t border-[var(--fp-border)] pt-2">
        <table className="w-full min-w-[280px] border-collapse text-left">
          <thead>
            <tr className="text-[8px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
              <th className="pb-1.5 pr-1 font-bold">{t("card.colMarket")}</th>
              <th className="pb-1.5 pr-1 font-bold">{t("card.colPrediction")}</th>
              <th className="pb-1.5 pr-1 text-right font-bold">{t("card.colConfidence")}</th>
              <th className="pb-1.5 pr-1 text-right font-bold">{t("card.colOdds")}</th>
              <th className="pb-1.5 text-right font-bold">{t("card.colValue")}</th>
            </tr>
          </thead>
          <tbody>
            {marketRows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--fp-border)]/70 text-[11px]">
                <td className="py-1.5 pr-1 text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
                  {r.marketLabel}
                </td>
                <td className="py-1.5 pr-1">
                  {r.locked ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--fp-text)] hover:bg-[var(--fp-warning)]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                      title={t("match.upgradeTo", { label: r.lockFeature, tier: r.lockTier })}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpgradeRequired?.(r.lockFeature, r.lockTier);
                      }}
                    >
                      🔒 {t("card.unlock")}
                    </button>
                  ) : (
                    <span
                      className={`font-display text-sm font-bold tabular-nums ${
                        r.accent ? "text-[var(--fp-accent)]" : "text-[var(--fp-text)]"
                      }`}
                    >
                      {r.pick}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-1 text-right font-semibold tabular-nums text-[var(--fp-text)]">
                  {r.locked ? "—" : r.confidence}
                </td>
                <td className="py-1.5 pr-1 text-right font-semibold tabular-nums text-[var(--fp-text)]">
                  {r.locked ? "—" : r.odd}
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums text-[var(--fp-text)]">
                  {r.locked ? "—" : r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(isPremiumLike || isFreeLike) && (
        <p className="mt-2 text-[9px] font-medium text-[var(--fp-text-faint)]">{t("card.tierHint")}</p>
      )}
    </article>
  );
}
