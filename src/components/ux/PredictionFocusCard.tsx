import type { CardMarketValidations, PredictionRow } from "../../types";
import { isFixtureInPlay } from "../../utils/appUtils";
import { useLocale } from "../../context/LocaleContext";
import { useKickoffWeather, weatherCodeKey } from "../../hooks/useKickoffWeather";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import {
  outcomeTextClass,
  resolveCardMarketOutcome,
  type CardMarketId,
  type MarketOutcome
} from "../../utils/cardMarketOutcome";
import {
  deriveCardGoalsPick,
  deriveAlignedOuPick,
  formatBookOdd,
  goalsOddForLine,
  matchingMarketOdd,
  recommendedOdd,
  shotsDisplayOdd
} from "../../utils/marketPicks";

type Props = {
  row: PredictionRow;
  /** Effective access tier (free / premium / ultra) — drives lock vs missing-data UI. */
  accessTier?: UpgradeTier | "free" | string;
  /** History settlement for this fixture (global counter source of truth). */
  marketValidations?: CardMarketValidations | null;
  watched?: boolean;
  onToggleWatch?: () => void;
  onOpen: () => void;
  onUpgradeRequired?: (feature: string, requiredTier: UpgradeTier) => void;
};

type MarketRow = {
  id: CardMarketId;
  marketLabel: string;
  locked: boolean;
  lockTier: UpgradeTier;
  lockFeature: string;
  pick: string;
  confidence: string;
  odd: string;
  outcome: MarketOutcome;
  accent?: boolean;
};

function fmtOdd(n: number | null | undefined, empty = "—"): string {
  return formatBookOdd(n, empty);
}

function sidePickLabel(
  t: (k: string, p?: Record<string, string | number>) => string,
  side: "over" | "under",
  line: number
): string {
  return side === "over" ? t("match.overLine", { line: line.toFixed(1) }) : t("match.underLine", { line: line.toFixed(1) });
}

function RankChip({ text, label }: { text: string; label: string }) {
  return (
    <span
      className="inline-flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-md bg-[var(--fp-bg-muted)] px-1 text-[10px] font-bold tabular-nums leading-none text-[var(--fp-text-muted)]"
      title={label}
    >
      {text}
    </span>
  );
}

/** Consumer prediction card — markets tinted by win/loss/pending (no Result column). */
export default function PredictionFocusCard({
  row,
  accessTier = "free",
  marketValidations = null,
  watched,
  onToggleWatch,
  onOpen,
  onUpgradeRequired
}: Props) {
  const { t } = useLocale();
  const { weather, loading: weatherLoading } = useKickoffWeather(row.venue, row.kickoff);

  const tier = String(accessTier || "free").toLowerCase();
  const canSeeCorners = tier === "premium" || tier === "ultra";
  const canSeeShots = tier === "ultra";

  const conf = Number(row.recommended?.confidence);
  const hasExactConfidence = Number.isFinite(conf);
  const confidenceCategory = row.recommended?.confidenceCategory || null;
  const isPremiumLike = !hasExactConfidence && Boolean(confidenceCategory);
  const isFreeLike = !hasExactConfidence && !confidenceCategory;

  const live = isFixtureInPlay(row.status);
  const kickoff = new Date(row.kickoff);
  const time = Number.isFinite(kickoff.getTime())
    ? kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  const homeRank = row.teamContext?.home?.rank;
  const awayRank = row.teamContext?.away?.rank;

  const goals = deriveCardGoalsPick(row);
  const corners = row.probs?.corners
    ? deriveAlignedOuPick(row.probs.corners.total, row.marketOdds?.corners)
    : null;
  const shots = row.probs?.shotsOnTarget
    ? deriveAlignedOuPick(row.probs.shotsOnTarget.total, row.marketOdds?.shotsOnTarget)
    : null;

  const cornersLocked = !canSeeCorners && !row.probs?.corners;
  const shotsLocked = !canSeeShots && !row.probs?.shotsOnTarget;

  const confLabel = hasExactConfidence
    ? `${Math.round(conf)}%`
    : confidenceCategory
      ? String(confidenceCategory)
      : "—";

  const stored = marketValidations ?? row.cardMarketValidations ?? null;
  const noBook = t("card.noBookOdd");
  const cornersOdd = corners
    ? matchingMarketOdd(row.marketOdds?.corners, corners.side, corners.line)
    : null;
  const shotsOdd = shots ? shotsDisplayOdd(row, shots.side, shots.line) : null;

  const marketRows: MarketRow[] = [
    {
      id: "recommended",
      marketLabel: t("card.marketRecommended"),
      locked: false,
      lockTier: "premium",
      lockFeature: t("match.featMain"),
      pick: row.recommended?.pick || "—",
      confidence: confLabel,
      odd: fmtOdd(recommendedOdd(row), noBook),
      outcome: resolveCardMarketOutcome("recommended", row, stored),
      accent: true
    },
    {
      id: "goals",
      marketLabel: t("card.marketGoals"),
      locked: false,
      lockTier: "premium",
      lockFeature: t("card.marketGoals"),
      pick: goals ? sidePickLabel(t, goals.side, goals.line) : "—",
      confidence: goals ? `${Math.round(goals.probability)}%` : "—",
      odd: goals ? fmtOdd(goalsOddForLine(row, goals.line, goals.side), noBook) : "—",
      outcome: resolveCardMarketOutcome("goals", row, stored)
    },
    {
      id: "corners",
      marketLabel: t("card.marketCorners"),
      locked: cornersLocked,
      lockTier: "premium",
      lockFeature: t("match.featCorners"),
      pick: corners ? sidePickLabel(t, corners.side, corners.line) : "—",
      confidence: corners ? `${Math.round(corners.probability)}%` : "—",
      odd: fmtOdd(cornersOdd, noBook),
      outcome: cornersLocked ? null : resolveCardMarketOutcome("corners", row, stored)
    },
    {
      id: "shots",
      marketLabel: t("card.marketShots"),
      locked: shotsLocked,
      lockTier: "ultra",
      lockFeature: t("match.featShots"),
      pick: shots ? sidePickLabel(t, shots.side, shots.line) : "—",
      confidence: shots ? `${Math.round(shots.probability)}%` : "—",
      odd: fmtOdd(shotsOdd, noBook),
      outcome: shotsLocked ? null : resolveCardMarketOutcome("shots", row, stored)
    }
  ];

  const weatherText = weather
    ? `${weather.tempC}°C · ${t(weatherCodeKey(weather.code))}`
    : weatherLoading
      ? t("card.weatherLoading")
      : t("card.weatherUnavailable");

  const marketGrid =
    "grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_2.5rem_2.35rem] items-center gap-x-1";

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
        className="cursor-pointer rounded-[var(--fp-radius)] border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-2.5 shadow-[var(--fp-shadow-sm)]"
      >
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-warning)]">{t("card.limitedData")}</p>
        <p className="mt-1 font-display text-sm font-semibold text-[var(--fp-text)]">
          {row.teams.home} {t("common.vs")} {row.teams.away}
        </p>
        <p className="mt-0.5 text-xs text-[var(--fp-text-muted)]">{t("card.openForDetails")}</p>
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
      className="group cursor-pointer rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-2.5 shadow-[var(--fp-shadow-sm)] transition-[box-shadow,transform] duration-[var(--fp-ease)] hover:-translate-y-0.5 hover:shadow-[var(--fp-shadow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {row.logos?.league ? (
            <img src={row.logos.league} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
          ) : null}
          <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
            {row.league}
          </p>
          {live && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--fp-danger)]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--fp-danger)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-danger)] motion-reduce:animate-none" />
              {t("card.live")}
            </span>
          )}
        </div>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--fp-text-faint)]">{time}</span>
        {onToggleWatch && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatch();
            }}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--fp-radius-sm)] border text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
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

      <p className="mt-1 truncate text-[10px] leading-tight text-[var(--fp-text-muted)]">
        <span title={t("card.referee")}>{row.referee?.trim() || t("card.refereeUnavailable")}</span>
        <span className="mx-1 text-[var(--fp-text-faint)]">·</span>
        <span title={t("card.weather")}>{weatherText}</span>
      </p>

      <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-start gap-1">
        <div className="flex min-w-0 flex-col items-center gap-1">
          <div className="flex items-center justify-center gap-1">
            <RankChip
              text={
                homeRank != null && Number.isFinite(Number(homeRank))
                  ? t("card.positionShort", { n: Number(homeRank) })
                  : t("card.positionNaShort")
              }
              label={t("card.positionLabel")}
            />
            <img src={row.logos?.home} alt="" className="h-9 w-9 object-contain sm:h-10 sm:w-10" />
          </div>
          <span className="line-clamp-2 w-full px-0.5 text-center text-[11px] font-semibold leading-tight text-[var(--fp-text)] sm:text-xs">
            {row.teams.home}
          </span>
        </div>

        <span className="mt-2.5 text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-faint)]">
          {t("common.vs")}
        </span>

        <div className="flex min-w-0 flex-col items-center gap-1">
          <div className="flex items-center justify-center gap-1">
            <img src={row.logos?.away} alt="" className="h-9 w-9 object-contain sm:h-10 sm:w-10" />
            <RankChip
              text={
                awayRank != null && Number.isFinite(Number(awayRank))
                  ? t("card.positionShort", { n: Number(awayRank) })
                  : t("card.positionNaShort")
              }
              label={t("card.positionLabel")}
            />
          </div>
          <span className="line-clamp-2 w-full px-0.5 text-center text-[11px] font-semibold leading-tight text-[var(--fp-text)] sm:text-xs">
            {row.teams.away}
          </span>
        </div>
      </div>

      <div className="mt-2.5 border-t border-[var(--fp-border)] pt-1.5">
        <div
          className={`${marketGrid} pb-1 text-[8px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]`}
        >
          <span className="truncate">{t("card.colMarket")}</span>
          <span className="truncate">{t("card.colPrediction")}</span>
          <span className="text-right">{t("card.colConfidence")}</span>
          <span className="text-right">{t("card.colOdds")}</span>
        </div>
        <div className="divide-y divide-[var(--fp-border)]/70">
          {marketRows.map((r) => {
            const tone = r.locked ? "text-[var(--fp-text-muted)]" : outcomeTextClass(r.outcome);
            return (
            <div key={r.id} className={`${marketGrid} py-1.5 text-[11px] ${tone}`}>
              <span className="truncate text-[9px] font-bold uppercase tracking-wide opacity-90">
                {r.marketLabel}
              </span>
              <div className="min-w-0">
                {r.locked ? (
                  <button
                    type="button"
                    className="inline-flex max-w-full items-center gap-0.5 truncate rounded border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 px-1 py-0.5 text-[9px] font-bold text-[var(--fp-text)] hover:bg-[var(--fp-warning)]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
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
                    className={`block truncate font-display text-[12px] font-bold leading-tight tabular-nums ${
                      r.accent && r.outcome == null ? "text-[var(--fp-accent)]" : ""
                    }`}
                  >
                    {r.pick}
                  </span>
                )}
              </div>
              <span className="text-right font-semibold tabular-nums">
                {r.locked ? "—" : r.confidence}
              </span>
              <span className="text-right font-semibold tabular-nums">
                {r.locked ? "—" : r.odd}
              </span>
            </div>
            );
          })}
        </div>
      </div>

      {((tier === "free" && isFreeLike) || (tier === "premium" && (isPremiumLike || isFreeLike))) && (
        <p className="mt-1.5 text-[9px] font-medium text-[var(--fp-text-faint)]">{t("card.tierHint")}</p>
      )}
    </article>
  );
}
