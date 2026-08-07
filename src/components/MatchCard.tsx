import { useState } from "react";
import { useLocale } from "../context/LocaleContext";
import type { TranslateFn } from "../i18n/types";
import { translateConfidenceCategory } from "../i18n/labels";
import {
  ConfidenceAura,
  deriveDataQuality,
  deriveSignalEdge,
  SignalScanStrip
} from "./SignalLab";
import ValueCard from "./ValueCard";
import ExplanationCard from "./ExplanationCard";
import FeatureImportanceChart from "./FeatureImportanceChart";
import PredictionLaboratoryPanel from "./PredictionLaboratory";
import { PredictionRow } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";
import { resolveCardMarketOutcome } from "../utils/cardMarketOutcome";
import {
  listSpecialBetCandidates,
  pickSpecialBetLegs,
  outcomeTextClass,
  specialBetCombinedOdd as specialBetCombinedOddValue,
  specialBetCombinedOutcome,
  specialBetLiveAdjustmentBadge
} from "../utils/specialBet";
import { matchingMarketOdd, shotsDisplayOdd } from "../utils/marketPicks";
import { formatRecommendedPick } from "../utils/formatRecommendation";
import MarketFamilyIcon from "./icons/MarketFamilyIcon";

type MatchCardProps = {
  row: PredictionRow;
  logoColors: Record<string, string>;
  onClick: () => void;
  hashColor: (seed: string) => string;
  animationDelayMs?: number;
  canShowSpecialBet?: boolean;
  /** V3: declutter card — deep panels live in Match Detail tabs */
  compact?: boolean;
  watched?: boolean;
  onToggleWatch?: () => void;
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  onShare?: (message: string) => void;
  /** Effective access tier (free / premium / ultra) — drives lock vs missing-data UI. */
  accessTier?: string;
};

function isFinalStatus(status?: string) {
  return ["FT", "AET", "PEN"].includes(status || "");
}

/** "67'" or, during stoppage time, "45+2'" — never estimated, only from upstream minute/extra. */
function formatLiveMinute(minute?: number | null, extra?: number | null): string | null {
  if (minute == null || !Number.isFinite(Number(minute))) return null;
  const m = Number(minute);
  return extra != null && Number.isFinite(Number(extra)) && Number(extra) > 0 ? `${m}+${Number(extra)}'` : `${m}'`;
}

function deriveRecommendedOdd(row: PredictionRow): number | null {
  const explicit = Number(row.recommended?.odd);
  if (Number.isFinite(explicit) && explicit > 1) return explicit;
  const pick = (row.recommended?.pick || "").trim().toLowerCase();
  if (!pick) return null;
  if (pick === "1") return Number.isFinite(Number(row.odds?.home)) ? Number(row.odds?.home) : null;
  if (pick === "x") return Number.isFinite(Number(row.odds?.draw)) ? Number(row.odds?.draw) : null;
  if (pick === "2") return Number.isFinite(Number(row.odds?.away)) ? Number(row.odds?.away) : null;
  if (pick === "gg") return Number.isFinite(Number(row.marketOdds?.btts?.odd)) ? Number(row.marketOdds?.btts?.odd) : null;
  if (pick === "ngg") {
    const yesOdd = Number(row.marketOdds?.btts?.odd);
    if (Number.isFinite(yesOdd) && yesOdd > 1) {
      const noOdd = (yesOdd / (yesOdd - 1)) || null;
      return Number.isFinite(Number(noOdd)) ? Number(noOdd) : null;
    }
    return null;
  }
  const ou = pick.match(/^(peste|sub)\s*(1[.,]5|2[.,]5|3[.,]5)$/);
  if (ou) {
    const line = ou[2].replace(",", ".");
    const quote =
      line === "1.5" ? row.marketOdds?.goals15 : line === "2.5" ? row.marketOdds?.goals25 : row.marketOdds?.goals35;
    if (!quote) return null;
    const overOdd = Number(quote.odd);
    if (!Number.isFinite(overOdd) || overOdd <= 1) return null;
    if (ou[1] === "peste") return overOdd;
    const underOdd = (overOdd / (overOdd - 1)) || null;
    return Number.isFinite(Number(underOdd)) ? Number(underOdd) : null;
  }
  return null;
}

function parseLineThreshold(key: string): number | null {
  const m = key.match(/^o(\d+)_(\d+)$/);
  if (!m) return null;
  return Number(`${m[1]}.${m[2]}`);
}

function deriveBestOverUnderPick(
  totalLines?: Record<string, number>
): { pick: string; probability: number; side: "over" | "under"; line: number } | null {
  if (!totalLines) return null;
  let best: { pick: string; probability: number; side: "over" | "under"; line: number } | null = null;
  for (const [key, raw] of Object.entries(totalLines)) {
    const line = parseLineThreshold(key);
    const pOver = Number(raw);
    if (line == null || !Number.isFinite(pOver)) continue;
    const over = { pick: `Over ${line.toFixed(1)}`, probability: pOver, side: "over" as const, line };
    const under = {
      pick: `Under ${line.toFixed(1)}`,
      probability: 100 - pOver,
      side: "under" as const,
      line
    };
    const current = over.probability >= under.probability ? over : under;
    if (!best || current.probability > best.probability) best = current;
  }
  return best;
}

function statusChip(
  row: PredictionRow,
  confPct: number,
  hasFinalScore: boolean,
  finalPickResult: boolean | null,
  isLive: boolean,
  t: TranslateFn
): { label: string; className: string } {
  if (isLive) {
    return {
      label: t("card.live").toUpperCase(),
      className: "border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 text-[var(--fp-danger)]"
    };
  }
  if (hasFinalScore) {
    if (finalPickResult === true) {
      return { label: t("card.chipWin"), className: "border-[var(--fp-success)]/35 bg-[var(--fp-success)]/10 text-[var(--fp-success)]" };
    }
    if (finalPickResult === false) {
      return { label: t("card.chipLose"), className: "border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 text-[var(--fp-danger)]" };
    }
    return { label: t("card.chipFinal"), className: "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]" };
  }
  if (row.valueBet?.detected) {
    return { label: t("card.chipValue"), className: "border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]" };
  }
  if (confPct >= 70) {
    return { label: t("card.chipLowRisk"), className: "border-[var(--fp-success)]/25 bg-[var(--fp-success)]/8 text-[var(--fp-success)]" };
  }
  return { label: t("card.chipOpen"), className: "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]" };
}

/**
 * Mic badge ce arată nivelul modelului aplicat:
 * - "ML": a fost folosit stacker-ul (multinomial LR)
 * - "CAL": probabilităţi post-calibrare isotonică
 * - "DC" (fallback): doar Poisson + Dixon-Coles (fără învățare pe istoric)
 */
function modelTierBadge(row: PredictionRow): { label: string; title: string; className: string } | null {
  const meta = row.modelMeta;
  if (!meta) return null;
  if (meta.stackerApplied) {
    return {
      label: "ML",
      title: `Stacker ML activ${meta.stackerSampleSize ? ` · n=${meta.stackerSampleSize}` : ""}`,
      className: "border-[var(--fp-success)]/45 bg-[var(--fp-success)]/10 text-[var(--fp-success)]"
    };
  }
  if (meta.calibrationApplied) {
    return {
      label: "CAL",
      title: `Isotonic calibration aplicată${meta.calibrationSampleSize ? ` · n=${meta.calibrationSampleSize}` : ""}`,
      className: "border-[var(--fp-accent)]/45 bg-[var(--fp-accent)]/10 text-[var(--fp-accent)]"
    };
  }
  return {
    label: "DC",
    title: "Poisson + Dixon-Coles (fără calibrare pe istoric încă)",
    className: "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"
  };
}

export default function MatchCard({
  row,
  logoColors,
  onClick,
  hashColor,
  animationDelayMs = 0,
  canShowSpecialBet = false,
  accessTier = "free",
  compact = true,
  watched = false,
  onToggleWatch,
  bookmarked = false,
  onToggleBookmark,
  onShare
}: MatchCardProps) {
  const { t } = useLocale();
  const [specialLegCount, setSpecialLegCount] = useState<2 | 3>(2);
  const homeColor = logoColors[row.logos?.home || ""] || hashColor(row.teams.home);
  const awayColor = logoColors[row.logos?.away || ""] || hashColor(row.teams.away);
  const pct = (n: number | null | undefined) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0);
  const isLive = isFixtureInPlay(row.status);
  const hasExactConfidence = row.recommended?.confidence != null && Number.isFinite(Number(row.recommended?.confidence));
  const confPct = hasExactConfidence ? pct(row.recommended?.confidence) : 0;
  const confidenceCategory = row.recommended?.confidenceCategory || null;
  const isPremiumLike = !hasExactConfidence && Boolean(confidenceCategory);
  const isFreeLike = !hasExactConfidence && !confidenceCategory;
  const edgeScore = deriveSignalEdge(row);
  const dq = deriveDataQuality(row);
  const hasFinalScore =
    isFinalStatus(row.status) &&
    row.score?.home !== null &&
    row.score?.away !== null &&
    row.score?.home !== undefined &&
    row.score?.away !== undefined;
  // Recommended settlement is server-resolved only (see resolveCardMarketOutcome) — the
  // pick's market family is not knowable here, so we render the persisted verdict or nothing.
  const recommendedOutcome = resolveCardMarketOutcome("recommended", row);
  const finalPickResult =
    recommendedOutcome === "win" ? true : recommendedOutcome === "loss" ? false : null;
  const hasNumericScore =
    row.score != null && typeof row.score.home === "number" && typeof row.score.away === "number";
  const koMs = new Date(row.kickoff).getTime();
  const pastKickoffPollWindow = Number.isFinite(koMs) && Date.now() >= koMs - 15 * 60 * 1000;
  /** Scor parțial: live sau după start până la FT (inclusiv când `status` încă e NS). */
  const showRunningScore =
    hasNumericScore &&
    !hasFinalScore &&
    (isLive || (pastKickoffPollWindow && !isFinalStatus(row.status)));
  const liveMinuteLabel = isLive ? formatLiveMinute(row.score?.minute, row.score?.extra) : null;
  const kickoffDate = new Date(row.kickoff);
  const chip = statusChip(row, confPct, hasFinalScore, finalPickResult, isLive, t);
  const tier = modelTierBadge(row);
  const recommendedOdd = deriveRecommendedOdd(row);
  const recommendedLabel = formatRecommendedPick(row.recommended?.pick, row.recommended?.family, t);
  const isPickHot = hasExactConfidence && confPct >= 85;
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

  if (row.insufficientData) {
    return (
      <div
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        style={{ animationDelay: `${animationDelayMs}ms` }}
        className="relative flex h-full animate-stagger-in cursor-pointer flex-col rounded-[var(--fp-radius)] border border-[var(--fp-warning)]/30 bg-[var(--fp-warning)]/5 shadow-[var(--fp-shadow-sm)] p-3.5 sm:p-4 touch-manipulation select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]/50 motion-reduce:animate-none"
      >
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--fp-warning)]">Insufficient signal</div>
        <div className="font-display mt-1 text-base font-semibold text-[var(--fp-text)]">
          {row.teams?.home} vs {row.teams?.away}
        </div>
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-[var(--fp-text-muted)]">{row.insufficientReason || "Modelul nu a putut estima λ-uri."}</p>
        <p className="mt-3 font-mono text-[9px] text-[var(--fp-accent)]/80">Detalii în fișă analitică →</p>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ animationDelay: `${animationDelayMs}ms` }}
      className="group relative flex h-full animate-stagger-in cursor-pointer flex-col overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-sm)] p-3.5 sm:p-4 touch-manipulation select-none transition-[transform,box-shadow,border-color] duration-200 ease-out hover-fine:-translate-y-0.5 hover-fine:border-[var(--fp-accent)]/25 hover-fine:shadow-[var(--fp-shadow)] active:translate-y-0 motion-reduce:animate-none motion-reduce:hover-fine:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]/50"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--fp-accent)]/25 to-transparent opacity-80" />

      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {onToggleWatch && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatch();
              }}
              className={`flex h-11 min-w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                watched
                  ? "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/15 text-[var(--fp-warning)]"
                  : "border-[var(--fp-border)] text-[var(--fp-text-muted)]"
              }`}
              aria-label={watched ? t("card.removeFavorite") : t("card.addFavorite")}
              aria-pressed={watched}
              title={t("card.favorite")}
            >
              ★
            </button>
          )}
          {onToggleBookmark && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleBookmark();
              }}
              className={`flex h-11 min-w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                bookmarked
                  ? "border-[var(--fp-accent)]/40 bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                  : "border-[var(--fp-border)] text-[var(--fp-text-muted)]"
              }`}
              aria-label={bookmarked ? t("card.removeBookmark") : t("card.addBookmark")}
              aria-pressed={bookmarked}
              title={t("card.bookmark")}
            >
              🔖
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const text = `${row.teams.home} ${t("common.vs")} ${row.teams.away} · ${t("card.topPick")} ${recommendedLabel.label} · ${Math.round(Number(row.recommended?.confidence) || 0)}%`;
              if (navigator.share) {
                void navigator.share({ title: "Footy Predictor", text }).catch(() => undefined);
              } else if (navigator.clipboard?.writeText) {
                void navigator.clipboard.writeText(text).then(() => onShare?.(t("card.linkCopied")));
              } else {
                onShare?.(text);
              }
            }}
            className="flex h-11 min-w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] text-[11px] text-[var(--fp-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
            aria-label={t("card.sharePrediction")}
            title={t("card.share")}
          >
            ↗
          </button>
          <span className="inline-flex items-center gap-1 truncate max-w-[9rem] rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)] sm:max-w-[12rem]">
            {row.logos?.league ? <img src={row.logos.league} className="h-3.5 w-3.5 shrink-0 object-contain" alt="" /> : null}
            {row.league}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${chip.className}`}
          >
            {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-danger)] motion-reduce:animate-none" />}
            {chip.label}
          </span>
          {tier ? (
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-wide ${tier.className}`}
              title={tier.title}
            >
              {tier.label}
            </span>
          ) : null}
          {row.confidenceEngine ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-[var(--fp-accent)]/30 bg-[var(--fp-accent)]/8 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-wide text-[var(--fp-accent)]"
              title={t("card.confidenceCtxTip")}
            >
              {row.confidenceEngine.category
                ? `${translateConfidenceCategory(t, row.confidenceEngine.category)} ${Math.round(row.confidenceEngine.confidence ?? row.confidenceEngine.overall)}%`
                : `CTX ${Math.round(row.confidenceEngine.overall)}%`}
            </span>
          ) : null}
        </div>
        <div className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--fp-text-muted)]">
          {kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}
          <span className="mx-1 text-[var(--fp-text-faint)]">·</span>
          {new Date(row.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      <div className="relative mt-4 sm:hidden">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2.5 py-2 max-[380px]:gap-1.5 max-[380px]:px-2 max-[380px]:py-1.5">
          <div className="min-w-0 text-center">
            <div
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 bg-[var(--fp-bg-card)] p-1 max-[380px]:h-8 max-[380px]:w-8"
              style={{ borderColor: homeColor }}
            >
              <img src={row.logos?.home} className="h-full w-full object-contain opacity-90" alt="" />
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] font-semibold leading-tight text-[var(--fp-text)] max-[380px]:text-[10px]">{row.teams.home}</div>
          </div>
          <div className="font-mono text-[10px] text-[var(--fp-text-faint)] max-[380px]:text-[9px]">vs</div>
          <div className="min-w-0 text-center">
            <div
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 bg-[var(--fp-bg-card)] p-1 max-[380px]:h-8 max-[380px]:w-8"
              style={{ borderColor: awayColor }}
            >
              <img src={row.logos?.away} className="h-full w-full object-contain opacity-90" alt="" />
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] font-semibold leading-tight text-[var(--fp-text)] max-[380px]:text-[10px]">{row.teams.away}</div>
          </div>
        </div>
      </div>

      <div className="relative mt-4 hidden grid-cols-[1fr_auto] items-center gap-3 sm:grid">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-[var(--fp-bg-card)] p-1"
              style={{ borderColor: homeColor }}
            >
              <img src={row.logos?.home} className="h-full w-full object-contain opacity-90" alt="" />
            </div>
            <div className="min-w-0">
              <div className="line-clamp-2 text-[12px] font-semibold leading-tight text-[var(--fp-text)] sm:text-[13px]">{row.teams.home}</div>
              <div
                className="mt-2 h-0.5 max-w-[8rem] rounded-full opacity-80"
                style={{ background: `linear-gradient(90deg, ${homeColor}, transparent)` }}
              />
            </div>
          </div>
          <div className="my-2 font-mono text-[10px] text-[var(--fp-text-faint)]">vs</div>
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-[var(--fp-bg-card)] p-1"
              style={{ borderColor: awayColor }}
            >
              <img src={row.logos?.away} className="h-full w-full object-contain opacity-90" alt="" />
            </div>
            <div className="min-w-0">
              <div className="line-clamp-2 text-[12px] font-semibold leading-tight text-[var(--fp-text)] sm:text-[13px]">{row.teams.away}</div>
              <div
                className="mt-2 h-0.5 max-w-[8rem] rounded-full opacity-80"
                style={{ background: `linear-gradient(90deg, ${awayColor}, transparent)` }}
              />
            </div>
          </div>
        </div>
        <div className="self-start">
          {hasExactConfidence ? (
            <ConfidenceAura value={confPct} size="compact" className="self-start" />
          ) : (
            <div className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 text-center">
              <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-[var(--fp-text-muted)]">Încredere</div>
              <div className="mt-1 font-mono text-[11px] font-semibold text-[var(--fp-accent)]">
                {confidenceCategory ? confidenceCategory : "Blocat"}
              </div>
            </div>
          )}
        </div>
      </div>

      {(row.teamContext?.home?.rank != null ||
        row.teamContext?.home?.form ||
        row.teamContext?.away?.rank != null ||
        row.teamContext?.away?.form) && (
        <div className="mt-3 hidden items-stretch justify-between gap-2 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2.5 py-2 sm:flex">
          <div className="min-w-0 flex-1 font-mono text-[9px] leading-snug text-[var(--fp-text-muted)]">
            <span className="block text-[8px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">Gazde</span>
            <span className="text-[var(--fp-accent)]">#{row.teamContext?.home?.rank ?? "—"}</span>
            {row.teamContext?.home?.points != null ? <span className="text-[var(--fp-text-muted)]"> · {row.teamContext.home.points}pt</span> : null}
            {row.teamContext?.home?.form ? (
              <span className="mt-0.5 block truncate tracking-tight text-[var(--fp-text)]" title={row.teamContext.home.form}>
                {row.teamContext.home.form}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 text-right font-mono text-[9px] leading-snug text-[var(--fp-text-muted)]">
            <span className="block text-[8px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">Oaspeți</span>
            <span className="text-[var(--fp-accent)]">#{row.teamContext?.away?.rank ?? "—"}</span>
            {row.teamContext?.away?.points != null ? <span className="text-[var(--fp-text-muted)]"> · {row.teamContext.away.points}pt</span> : null}
            {row.teamContext?.away?.form ? (
              <span className="mt-0.5 block truncate tracking-tight text-[var(--fp-text)]" title={row.teamContext.away.form}>
                {row.teamContext.away.form}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <div className="relative mt-4 flex flex-col gap-2 border-t border-[var(--fp-border)] pt-3 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <div className="flex items-start justify-between gap-2 sm:block min-w-0 flex-1">
          <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.15em] text-[var(--fp-accent)]/75">
            <span>Selecție</span>
            {hasExactConfidence && confPct > 0 && confPct < 55 ? (
              <span
                className="rounded-sm bg-[var(--fp-warning)]/15 px-1 py-[1px] text-[7.5px] font-bold tracking-wider text-[var(--fp-warning)]"
                title={t("card.lowConfTip")}
              >
                Nesigur
              </span>
            ) : null}
            {isPickHot ? (
              <span
                className="rounded-sm bg-[var(--fp-success)]/15 px-1 py-[1px] text-[7.5px] font-bold tracking-wider text-[var(--fp-success)]"
                title={t("card.strongSignalTip")}
              >
                HOT
              </span>
            ) : null}
          </div>
          <div className={`flex items-center gap-1.5 line-clamp-2 break-words font-display text-xl font-bold tracking-tight text-[var(--fp-text)] max-[380px]:text-lg sm:text-2xl ${isPickHot ? "drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]" : ""}`}>
            <MarketFamilyIcon familyKey={recommendedLabel.familyKey} className="shrink-0 text-[var(--fp-accent)]/70" />
            {recommendedLabel.label}
          </div>
          <div className={`mt-0.5 font-mono text-[10px] font-semibold tabular-nums ${isPickHot ? "text-[var(--fp-success)]" : "text-[var(--fp-accent)]"}`}>
            {Number.isFinite(Number(recommendedOdd)) && Number(recommendedOdd) > 1
              ? `odd ${Number(recommendedOdd).toFixed(2)}`
              : "-"}
          </div>
          </div>
        <div className="sm:hidden self-center">
          {hasExactConfidence ? (
            <ConfidenceAura value={confPct} size="compact" className="self-end" />
          ) : (
            <div className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 text-center">
              <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-[var(--fp-text-muted)]">Încredere</div>
              <div className="mt-1 font-mono text-[11px] font-semibold text-[var(--fp-accent)]">
                {confidenceCategory ? confidenceCategory : "Blocat"}
              </div>
            </div>
          )}
        </div>
        </div>
        {(hasFinalScore || showRunningScore) && (
          <div className="self-end text-right font-mono text-xs tabular-nums">
            {showRunningScore ? (
              <span className={isLive ? "text-[var(--fp-danger)]" : "text-[var(--fp-warning)]/90"}>
                <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide">{isLive ? "Live" : "Scor"}</span>
                <span className="font-display text-lg font-bold tabular-nums text-[var(--fp-text)]">
                  {row.score?.home}-{row.score?.away}
                </span>
                {liveMinuteLabel && (
                  <span className="block text-[10px] font-semibold tabular-nums text-[var(--fp-danger)]/80">
                    {liveMinuteLabel}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[var(--fp-text-muted)]">
                FT {row.score?.home}-{row.score?.away}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Compact V3: probability bars + value chip */}
      {compact && row.probs && (
        <div className="mt-3 space-y-1.5">
          {[
            { label: "1", val: row.probs.p1, color: homeColor },
            { label: "X", val: row.probs.pX, color: "#3ecfbf" },
            { label: "2", val: row.probs.p2, color: awayColor }
          ].map((b) => (
            <div key={b.label} className="flex items-center gap-2">
              <span className="w-3 font-mono text-[9px] text-[var(--fp-text-muted)]">{b.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--fp-bg-muted)]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, b.val || 0))}%`, backgroundColor: b.color }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[9px] tabular-nums text-[var(--fp-text-muted)]">
                {Math.round(b.val || 0)}%
              </span>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {row.valueBet?.detected && (
              <span className="rounded-md border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 px-1.5 py-0.5 font-mono text-[8px] uppercase text-[var(--fp-warning)]">
                +EV
              </span>
            )}
            {hasExactConfidence && confPct > 0 && (
              <span className="rounded-md border border-[var(--fp-border)] px-1.5 py-0.5 font-mono text-[8px] text-[var(--fp-text-muted)]">
                {t("card.riskLabel", {
                  level:
                    confPct >= 70 ? t("card.riskLow") : confPct >= 55 ? t("card.riskMed") : t("card.riskHigh")
                })}
              </span>
            )}
          </div>
        </div>
      )}

      {!compact && hasExactConfidence ? (
        <SignalScanStrip edge={edgeScore} dataQuality={dq} valueDetected={Boolean(row.valueBet?.detected)} className="mt-1" />
      ) : null}

      {!compact && row.valueEngine ? (
        <div className="mt-1.5">
          <ValueCard engine={row.valueEngine} compact />
        </div>
      ) : null}

      {!compact && !row.insufficientData ? <PredictionLaboratoryPanel match={row} compact /> : null}

      {!compact && row.explanation && (row.explanation.reasons?.length || row.explanation.reasoning?.length) ? (
        <ExplanationCard explanation={row.explanation} compact />
      ) : null}

      {!compact && (row.featureImportance?.items?.length || row.featureImportance?.contributions) ? (
        <FeatureImportanceChart importance={row.featureImportance} compact />
      ) : null}

      {(isPremiumLike || isFreeLike) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(isFreeLike
            ? [t("match.featCorners"), t("match.featShots"), t("match.featHt"), t("match.featEdge")]
            : [t("match.featShots"), t("match.featHt"), t("match.featEdge")]
          ).map((label) => (
            <span
              key={label}
              className="inline-flex items-center rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-[var(--fp-text-muted)]"
              title={t("card.unlockHigher")}
            >
              🔒 {label}
            </span>
          ))}
        </div>
      )}

      {!compact &&
        (cornersPick || shotsPick || shotsTotalPick || cardsPick || firstHalfPick ||
          cornersLocked || shotsLocked || shotsTotalLocked || cardsLocked || firstHalfLocked) && (
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
                  <div className="font-mono text-[7px] text-[var(--fp-text-faint)]">{item.source || t("card.sourceNa")}</div>
                </>
              )}
            </div>
          )})}
        </div>
      )}

      {!compact && !canShowSpecialBet && (
        <div className="mt-2.5 min-w-0 rounded-lg border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 px-2.5 py-2 shadow-[var(--fp-shadow-sm)]">
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
      )}

      {!compact && canShowSpecialBet && hasExactConfidence && specialBetLegs.length >= 2 && (
        <div className="mt-2.5 min-w-0 rounded-lg border border-[var(--fp-success)]/45 bg-[var(--fp-success)]/10 px-2.5 py-2 shadow-[var(--fp-shadow-sm)]">
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
                        setSpecialLegCount(n as 2 | 3);
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
      )}

      <p className="relative mt-3 font-mono text-[9px] text-[var(--fp-text-muted)]/90">
        {compact ? t("card.detailsArrow") : t("card.openDetails")}
      </p>
    </div>
  );
}
