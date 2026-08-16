import { useState } from "react";
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
import { formatRecommendedPick } from "../../utils/formatRecommendation";
import MarketFamilyIcon from "../icons/MarketFamilyIcon";
import LiveWinProbabilityStrip from "./LiveWinProbabilityStrip";

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
  /** Opens the prediction report dialog for this row. Absent = no report button. */
  onReport?: () => void;
};

type MarketRow = {
  id: CardMarketId | "shotsTotal";
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

/** Mirrors the risk-level thresholds already used on MatchCard's confidence badge (70/55). */
function deriveRiskLevel(
  t: (k: string, p?: Record<string, string | number>) => string,
  confPct: number | null
): { label: string; className: string } | null {
  if (confPct == null) return null;
  if (confPct >= 70) {
    return {
      label: t("card.riskLabel", { level: t("card.riskLow") }),
      className: "border-fp-success/35 bg-fp-success/10 text-[var(--fp-success)]"
    };
  }
  if (confPct >= 55) {
    return {
      label: t("card.riskLabel", { level: t("card.riskMed") }),
      className: "border-fp-warning/35 bg-fp-warning/10 text-[var(--fp-warning)]"
    };
  }
  return {
    label: t("card.riskLabel", { level: t("card.riskHigh") }),
    className: "border-fp-danger/30 bg-fp-danger/10 text-[var(--fp-danger)]"
  };
}

/** Win rate 0..1 from a W/D/L form string (W=1, D=0.5, L=0) — null when no usable characters. */
function formStreakRate(form: string | null | undefined): number | null {
  if (!form) return null;
  const chars = form.toUpperCase().replace(/[^WDL]/g, "");
  if (!chars.length) return null;
  let sum = 0;
  for (const c of chars) sum += c === "W" ? 1 : c === "D" ? 0.5 : 0;
  return sum / chars.length;
}

/**
 * Rule-based "Why AI likes this" — every bullet is a direct read of already-loaded
 * PredictionRow fields (xG lambdas, standings form, defensive record, live momentum).
 * No AI/LLM call, no extra requests. A signal only produces a bullet when its own gap
 * clears a meaningful threshold; capped at 3, ordered by how decisive the signal is.
 */
function buildWhyAiLikes(t: (k: string, p?: Record<string, string | number>) => string, row: PredictionRow): string[] {
  const observations: string[] = [];
  const homeTeam = row.teams.home;
  const awayTeam = row.teams.away;

  const lamHome = row.lambdas?.home;
  const lamAway = row.lambdas?.away;
  if (lamHome != null && lamAway != null && Number.isFinite(lamHome) && Number.isFinite(lamAway)) {
    if (Math.abs(lamHome - lamAway) >= 0.5) {
      const team = lamHome > lamAway ? homeTeam : awayTeam;
      observations.push(t("card.whyXgEdge", { team, home: lamHome.toFixed(2), away: lamAway.toFixed(2) }));
    }
  }

  const homeForm = row.teamContext?.home?.form;
  const awayForm = row.teamContext?.away?.form;
  const homeFormRate = formStreakRate(homeForm);
  const awayFormRate = formStreakRate(awayForm);
  if (homeFormRate != null && awayFormRate != null && Math.abs(homeFormRate - awayFormRate) >= 0.3) {
    const team = homeFormRate > awayFormRate ? homeTeam : awayTeam;
    const form = homeFormRate > awayFormRate ? homeForm : awayForm;
    observations.push(t("card.whyForm", { team, form: form || "" }));
  }

  const hc = row.teamContext?.home;
  const ac = row.teamContext?.away;
  const homeConcededRate = hc?.goalsAgainst != null && hc?.played ? Number(hc.goalsAgainst) / Number(hc.played) : null;
  const awayConcededRate = ac?.goalsAgainst != null && ac?.played ? Number(ac.goalsAgainst) / Number(ac.played) : null;
  if (
    homeConcededRate != null &&
    awayConcededRate != null &&
    Number.isFinite(homeConcededRate) &&
    Number.isFinite(awayConcededRate) &&
    Math.abs(homeConcededRate - awayConcededRate) >= 0.5
  ) {
    const team = homeConcededRate < awayConcededRate ? homeTeam : awayTeam;
    observations.push(t("card.whyDefense", { team }));
  }

  if (row.momentum && row.momentum.dominantTeam !== "balanced" && row.momentum.confidence >= 50) {
    const team = row.momentum.dominantTeam === "home" ? homeTeam : awayTeam;
    observations.push(t("card.whyMomentum", { team }));
  }

  return observations.slice(0, 3);
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
  onUpgradeRequired,
  onReport
}: Props) {
  const { t } = useLocale();
  const { weather, loading: weatherLoading } = useKickoffWeather(row.venue, row.kickoff);
  const [showDetails, setShowDetails] = useState(false);

  const tier = String(accessTier || "free").toLowerCase();
  const canSeeCorners = tier === "premium" || tier === "ultra";
  const canSeeShots = tier === "ultra";

  const conf = Number(row.recommended?.confidence);
  const hasExactConfidence = Number.isFinite(conf);
  const confidenceCategory = row.recommended?.confidenceCategory || null;
  const isPremiumLike = !hasExactConfidence && Boolean(confidenceCategory);
  const isFreeLike = !hasExactConfidence && !confidenceCategory;

  const live = isFixtureInPlay(row.status);
  const finished = ["FT", "AET", "PEN"].includes(String(row.status || "").toUpperCase());
  const hasScore = (live || finished) && Number.isFinite(Number(row.score?.home)) && Number.isFinite(Number(row.score?.away));
  const ev = Number(row.valueBet?.ev);
  const hasValue = Boolean(row.valueBet?.detected) && Number.isFinite(ev) && ev > 0;
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
  const shotsTotal = row.probs?.shotsTotal
    ? deriveAlignedOuPick(row.probs.shotsTotal.total, row.marketOdds?.shotsTotal)
    : null;

  const cornersLocked = !canSeeCorners && !row.probs?.corners;
  const shotsLocked = !canSeeShots && !row.probs?.shotsOnTarget;
  const shotsTotalLocked = !canSeeShots && !row.probs?.shotsTotal;

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
  // Exact line only — a total-shots price from a line four shots away is another bet.
  const shotsTotalOdd = shotsTotal
    ? matchingMarketOdd(row.marketOdds?.shotsTotal, shotsTotal.side, shotsTotal.line)
    : null;
  const recOdd = recommendedOdd(row);
  const recommendedLabel = formatRecommendedPick(row.recommended?.pick, row.recommended?.family, t, row.recommended);

  // Value Edge: EV = (AI probability × odd) − 1, using the AI's own confidence for the
  // recommended pick — only ever shown when both are real numbers and EV is positive.
  const evPct =
    hasExactConfidence && recOdd != null && recOdd > 1 ? (conf / 100) * recOdd * 100 - 100 : null;
  const riskInfo = deriveRiskLevel(t, hasExactConfidence ? Math.round(conf) : null);
  const whyBullets = buildWhyAiLikes(t, row);

  const marketRows: MarketRow[] = [
    {
      id: "recommended",
      marketLabel: t("card.marketRecommended"),
      locked: false,
      lockTier: "premium",
      lockFeature: t("match.featMain"),
      pick: recommendedLabel.label,
      confidence: confLabel,
      odd: fmtOdd(recOdd, noBook),
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
      marketLabel: t("match.shotsSub"),
      locked: shotsLocked,
      lockTier: "ultra",
      lockFeature: t("match.featShots"),
      pick: shots ? sidePickLabel(t, shots.side, shots.line) : "—",
      confidence: shots ? `${Math.round(shots.probability)}%` : "—",
      odd: fmtOdd(shotsOdd, noBook),
      outcome: shotsLocked ? null : resolveCardMarketOutcome("shots", row, stored)
    },
    {
      id: "shotsTotal",
      marketLabel: t("match.shotsTotalTitle"),
      locked: shotsTotalLocked,
      lockTier: "ultra",
      lockFeature: t("match.shotsTotalTitle"),
      pick: shotsTotal ? sidePickLabel(t, shotsTotal.side, shotsTotal.line) : "—",
      confidence: shotsTotal ? `${Math.round(shotsTotal.probability)}%` : "—",
      odd: fmtOdd(shotsTotalOdd, noBook),
      outcome: null
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
        className="cursor-pointer rounded-[var(--fp-radius)] border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-2.5 shadow-fp-sm"
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
      className="group cursor-pointer rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-2.5 shadow-fp-sm transition-[box-shadow,transform] duration-[var(--fp-ease)] hover:-translate-y-0.5 hover:shadow-fp focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
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
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-fp-danger/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--fp-danger)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-live)] motion-reduce:animate-none" />
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
                ? "border-fp-warning/40 bg-fp-warning/10 text-[var(--fp-warning)]"
                : "border-[var(--fp-border)] text-[var(--fp-text-muted)]"
            }`}
            title={watched ? t("card.removeFavorite") : t("card.addFavorite")}
            aria-label={watched ? t("card.removeFavorite") : t("card.addFavorite")}
            aria-pressed={watched}
          >
            ★
          </button>
        )}
        {/* Reporting is rare and corrective: it sits last, unfilled, and only
            colours on hover so it never competes with the pick itself. */}
        {onReport && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReport();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] text-sm text-[var(--fp-text-muted)] hover-fine:border-fp-danger/40 hover-fine:text-[var(--fp-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
            title={t("predictionReport.cardAction")}
            aria-label={t("predictionReport.cardAction")}
          >
            ⚑
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

        <div className="mt-2.5 flex flex-col items-center gap-0.5">
          <span
            className={`font-mono tabular-nums ${
              hasScore
                ? `text-sm font-bold ${live ? "text-[var(--fp-live)]" : "text-[var(--fp-text)]"}`
                : "text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-faint)]"
            }`}
          >
            {hasScore ? `${row.score?.home} – ${row.score?.away}` : t("common.vs")}
          </span>
          {live && Number.isFinite(Number(row.score?.minute)) && (
            <span className="text-[10px] font-semibold tabular-nums text-[var(--fp-text-muted)]">
              {row.score?.minute}'
            </span>
          )}
        </div>

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

      {live && <LiveWinProbabilityStrip match={row} compact className="mt-2" />}

      {live && row.momentum && (
        <div className="mt-2 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-fp-bg-muted/50 px-2.5 py-2">
          <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
            {t("card.momentum")}
          </p>
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="w-8 shrink-0 truncate text-[9px] font-semibold text-[var(--fp-text-muted)]">
                {t("card.momentumHome")}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--fp-border)]">
                <div
                  className="h-full w-full origin-left rounded-full bg-[var(--fp-accent)] transition-transform duration-500"
                  style={{ transform: `scaleX(${row.momentum.homeMomentum / 100})` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-[9px] font-semibold tabular-nums text-[var(--fp-text)]">
                {row.momentum.homeMomentum}%
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-8 shrink-0 truncate text-[9px] font-semibold text-[var(--fp-text-muted)]">
                {t("card.momentumAway")}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--fp-border)]">
                <div
                  className="h-full w-full origin-left rounded-full bg-[var(--fp-danger)] transition-transform duration-500"
                  style={{ transform: `scaleX(${row.momentum.awayMomentum / 100})` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-[9px] font-semibold tabular-nums text-[var(--fp-text)]">
                {row.momentum.awayMomentum}%
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-2.5 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-fp-bg-muted/40 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{t("card.mainPick")}</p>
            {/* Visual label is compact (FT/FH/ET); aria keeps the verbose period name. */}
            <p
              aria-label={recommendedLabel.ariaLabel}
              title={recommendedLabel.ariaLabel}
              className="flex items-center gap-1 truncate font-display text-[15px] font-bold leading-tight text-[var(--fp-accent)]"
            >
              <MarketFamilyIcon familyKey={recommendedLabel.familyKey} className="shrink-0" />
              {recommendedLabel.label}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{t("card.colConfidence")}</p>
            <p className="font-mono text-sm font-bold tabular-nums text-[var(--fp-text)]">{confLabel}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[8px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{t("card.colOdds")}</p>
            <p className="font-mono text-sm font-bold text-[var(--fp-text)]">{fmtOdd(recOdd, noBook)}</p>
          </div>
        </div>
        {(riskInfo || (evPct != null && evPct > 0)) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {riskInfo && (
              <span className={`rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${riskInfo.className}`}>
                {riskInfo.label}
              </span>
            )}
            {evPct != null && evPct > 0 && (
              <span className="rounded border border-fp-warning/40 bg-fp-warning/15 px-1.5 py-0.5 text-[8px] font-bold text-[var(--fp-warning)]">
                ⚡ +{Math.round(evPct)}% {t("card.valueEdge")}
              </span>
            )}
          </div>
        )}
        {whyBullets.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {whyBullets.map((b, i) => (
              <li key={i} className="flex gap-1 text-[9px] leading-snug text-[var(--fp-text-muted)]">
                <span aria-hidden>•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShowDetails((v) => !v);
        }}
        aria-expanded={showDetails}
        className="mt-2 flex w-full items-center justify-between rounded-[var(--fp-radius-sm)] px-0.5 py-1 text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)] hover-fine:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
      >
        <span>{showDetails ? t("card.hideDetails") : t("card.showDetails")}</span>
        <span aria-hidden className={`transition-transform duration-200 ${showDetails ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>

      {showDetails && (
      <div className="mt-1.5 border-t border-[var(--fp-border)] pt-1.5">
        <div
          className={`${marketGrid} pb-1 text-[8px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]`}
        >
          <span className="truncate">{t("card.colMarket")}</span>
          <span className="truncate">{t("card.colPrediction")}</span>
          <span className="text-right">{t("card.colConfidence")}</span>
          <span className="text-right">{t("card.colOdds")}</span>
        </div>
        <div className="divide-y divide-[var(--fp-border)]">
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
                    className="inline-flex max-w-full items-center gap-0.5 truncate rounded border border-fp-warning/35 bg-fp-warning/10 px-1 py-0.5 text-[9px] font-bold text-[var(--fp-text)] hover:bg-fp-warning/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                    title={t("match.upgradeTo", { label: r.lockFeature, tier: r.lockTier })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpgradeRequired?.(r.lockFeature, r.lockTier);
                    }}
                  >
                    🔒 {t("card.unlock")}
                  </button>
                ) : (
                  <span className="flex min-w-0 items-center gap-1">
                    <span
                      className={`block truncate font-display text-[12px] font-bold leading-tight tabular-nums ${
                        r.accent && r.outcome == null ? "text-[var(--fp-accent)]" : ""
                      }`}
                    >
                      {r.pick}
                    </span>
                    {r.id === "recommended" && hasValue && (
                      <span
                        className="shrink-0 rounded bg-fp-warning/15 px-1 py-0.5 text-[8px] font-bold tabular-nums text-[var(--fp-warning)]"
                        title={t("match.valueDetected")}
                      >
                        +{ev.toFixed(1)}% EV
                      </span>
                    )}
                  </span>
                )}
              </div>
              <span className="text-right font-semibold tabular-nums" aria-hidden={r.locked}>
                {r.locked ? "🔒" : r.confidence}
              </span>
              <span className="text-right font-semibold tabular-nums" aria-hidden={r.locked}>
                {r.locked ? "🔒" : r.odd}
              </span>
            </div>
            );
          })}
        </div>
      </div>
      )}

      {((tier === "free" && isFreeLike) || (tier === "premium" && (isPremiumLike || isFreeLike))) && (
        <p className="mt-1.5 text-[9px] font-medium text-[var(--fp-text-faint)]">{t("card.tierHint")}</p>
      )}
    </article>
  );
}
