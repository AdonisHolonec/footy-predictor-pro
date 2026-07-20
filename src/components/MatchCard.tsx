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
import { MatchScore, PredictionRow } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";
import {
  buildSpecialBetLegs,
  outcomeTextClass,
  specialBetCombinedOdd as specialBetCombinedOddValue,
  specialBetCombinedOutcome
} from "../utils/specialBet";

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
};

function isFinalStatus(status?: string) {
  return ["FT", "AET", "PEN"].includes(status || "");
}

function evaluateTopPick(pick: string, score?: MatchScore): boolean | null {
  if (!pick || !score) return null;
  if (score.home === null || score.away === null) return null;
  const home = score.home;
  const away = score.away;
  const total = home + away;
  const normalized = pick.trim().toLowerCase();

  if (normalized === "1") return home > away;
  if (normalized === "2") return away > home;
  if (normalized === "x") return home === away;
  if (normalized === "gg") return home > 0 && away > 0;
  if (normalized === "ngg") return home === 0 || away === 0;

  const overMatch = normalized.match(/peste\s*(\d+(?:[.,]\d+)?)/);
  if (overMatch) return total > Number(overMatch[1].replace(",", "."));

  const underMatch = normalized.match(/sub\s*(\d+(?:[.,]\d+)?)/);
  if (underMatch) return total < Number(underMatch[1].replace(",", "."));

  return null;
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

function deriveBestOverUnderPick(totalLines?: Record<string, number>): { pick: string; probability: number } | null {
  if (!totalLines) return null;
  let best: { pick: string; probability: number } | null = null;
  for (const [key, raw] of Object.entries(totalLines)) {
    const line = parseLineThreshold(key);
    const pOver = Number(raw);
    if (line == null || !Number.isFinite(pOver)) continue;
    const over = { pick: `Over ${line.toFixed(1)}`, probability: pOver };
    const under = { pick: `Under ${line.toFixed(1)}`, probability: 100 - pOver };
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
      className: "border-red-400/35 bg-red-500/10 text-red-200"
    };
  }
  if (hasFinalScore) {
    if (finalPickResult === true) {
      return { label: t("card.chipWin"), className: "border-signal-sage/35 bg-signal-sage/10 text-signal-mint" };
    }
    if (finalPickResult === false) {
      return { label: t("card.chipLose"), className: "border-signal-rose/30 bg-signal-rose/10 text-signal-rose" };
    }
    return { label: t("card.chipFinal"), className: "border-white/10 bg-signal-void/50 text-signal-silver" };
  }
  if (row.valueBet?.detected) {
    return { label: t("card.chipValue"), className: "border-signal-amber/35 bg-signal-amber/10 text-signal-amberSoft" };
  }
  if (confPct >= 70) {
    return { label: t("card.chipLowRisk"), className: "border-signal-sage/25 bg-signal-sage/8 text-signal-sage" };
  }
  return { label: t("card.chipOpen"), className: "border-white/8 bg-signal-void/40 text-signal-inkMuted" };
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
      className: "border-signal-mint/45 bg-signal-mintSoft text-signal-mint"
    };
  }
  if (meta.calibrationApplied) {
    return {
      label: "CAL",
      title: `Isotonic calibration aplicată${meta.calibrationSampleSize ? ` · n=${meta.calibrationSampleSize}` : ""}`,
      className: "border-signal-petrol/45 bg-signal-petrol/10 text-signal-petrol"
    };
  }
  return {
    label: "DC",
    title: "Poisson + Dixon-Coles (fără calibrare pe istoric încă)",
    className: "border-white/10 bg-signal-void/45 text-signal-silver"
  };
}

export default function MatchCard({
  row,
  logoColors,
  onClick,
  hashColor,
  animationDelayMs = 0,
  canShowSpecialBet = false,
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
  const finalPickResult = hasFinalScore ? evaluateTopPick(row.recommended.pick, row.score) : null;
  const hasNumericScore =
    row.score != null && typeof row.score.home === "number" && typeof row.score.away === "number";
  const koMs = new Date(row.kickoff).getTime();
  const pastKickoffPollWindow = Number.isFinite(koMs) && Date.now() >= koMs - 15 * 60 * 1000;
  /** Scor parțial: live sau după start până la FT (inclusiv când `status` încă e NS). */
  const showRunningScore =
    hasNumericScore &&
    !hasFinalScore &&
    (isLive || (pastKickoffPollWindow && !isFinalStatus(row.status)));
  const kickoffDate = new Date(row.kickoff);
  const chip = statusChip(row, confPct, hasFinalScore, finalPickResult, isLive, t);
  const tier = modelTierBadge(row);
  const recommendedOdd = deriveRecommendedOdd(row);
  const isPickHot = hasExactConfidence && confPct >= 85;
  const cornersPick = row.probs?.corners ? deriveBestOverUnderPick(row.probs.corners.total) : null;
  const shotsPick = row.probs?.shotsOnTarget ? deriveBestOverUnderPick(row.probs.shotsOnTarget.total) : null;
  const firstHalfPick =
    row.probs?.firstHalf && Number.isFinite(row.probs.firstHalf.pO15)
      ? row.probs.firstHalf.pO15 >= 50
        ? { pick: "Over 1.5 FH", probability: row.probs.firstHalf.pO15 }
        : { pick: "Under 1.5 FH", probability: 100 - row.probs.firstHalf.pO15 }
      : null;
  const marketPulseWinnerLabel = (() => {
    const candidates = [
      { label: t("match.featCorners"), probability: Number(cornersPick?.probability || 0) },
      { label: t("match.featShots"), probability: Number(shotsPick?.probability || 0) },
      { label: t("match.featHt"), probability: Number(firstHalfPick?.probability || 0) }
    ];
    const winner = candidates.reduce((best, item) => (item.probability > best.probability ? item : best), candidates[0]);
    return winner.probability >= 85 ? winner.label : null;
  })();
  const specialBetPool = buildSpecialBetLegs(
    row,
    {
      main: t("match.featMain"),
      corners: t("match.featCorners"),
      shots: t("match.featShots"),
      ht: t("match.featHt")
    },
    3,
    row.cardMarketValidations
  );
  const specialBetLegs = specialBetPool.slice(0, specialLegCount);
  const specialBetCombinedOdd = specialBetCombinedOddValue(specialBetLegs);
  const specialCombinedTone = outcomeTextClass(specialBetCombinedOutcome(specialBetLegs));
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
        className="lab-card relative flex h-full animate-stagger-in cursor-pointer flex-col border-signal-amber/30 bg-signal-fog/70 p-3.5 sm:p-4 touch-manipulation select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/50 motion-reduce:animate-none"
      >
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-amber">Insufficient signal</div>
        <div className="font-display mt-1 text-base font-semibold text-signal-ink">
          {row.teams?.home} vs {row.teams?.away}
        </div>
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-signal-inkMuted">{row.insufficientReason || "Modelul nu a putut estima λ-uri."}</p>
        <p className="mt-3 font-mono text-[9px] text-signal-petrol/80">Detalii în fișă analitică →</p>
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
      className="lab-card group relative flex h-full animate-stagger-in cursor-pointer flex-col overflow-hidden p-3.5 sm:p-4 touch-manipulation select-none hover:-translate-y-0.5 hover:border-signal-petrol/25 active:translate-y-0 motion-reduce:animate-none motion-reduce:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/50"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-petrol/25 to-transparent opacity-80" />

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
              const text = `${row.teams.home} ${t("common.vs")} ${row.teams.away} · ${t("card.topPick")} ${row.recommended?.pick || "—"} · ${Math.round(Number(row.recommended?.confidence) || 0)}%`;
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
          <span className="lab-chip truncate max-w-[9rem] sm:max-w-[12rem]">
            {row.league}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${chip.className}`}
          >
            {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 motion-reduce:animate-none" />}
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
              className="inline-flex items-center gap-1 rounded-md border border-signal-petrol/30 bg-signal-petrol/8 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-wide text-signal-petrol"
              title={t("card.confidenceCtxTip")}
            >
              {row.confidenceEngine.category
                ? `${translateConfidenceCategory(t, row.confidenceEngine.category)} ${Math.round(row.confidenceEngine.confidence ?? row.confidenceEngine.overall)}%`
                : `CTX ${Math.round(row.confidenceEngine.overall)}%`}
            </span>
          ) : null}
        </div>
        <div className="shrink-0 font-mono text-[10px] tabular-nums text-signal-inkMuted">
          {kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}
          <span className="mx-1 text-signal-stone/80">·</span>
          {new Date(row.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      <div className="relative mt-4 sm:hidden">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-white/[0.07] bg-signal-void/30 px-2.5 py-2 max-[380px]:gap-1.5 max-[380px]:px-2 max-[380px]:py-1.5">
          <div className="min-w-0 text-center">
            <img src={row.logos?.home} className="mx-auto h-10 w-10 object-contain opacity-90 max-[380px]:h-8 max-[380px]:w-8" alt="" />
            <div className="mt-1 line-clamp-2 text-[11px] font-semibold leading-tight text-signal-ink max-[380px]:text-[10px]">{row.teams.home}</div>
          </div>
          <div className="font-mono text-[10px] text-signal-stone/90 max-[380px]:text-[9px]">vs</div>
          <div className="min-w-0 text-center">
            <img src={row.logos?.away} className="mx-auto h-10 w-10 object-contain opacity-90 max-[380px]:h-8 max-[380px]:w-8" alt="" />
            <div className="mt-1 line-clamp-2 text-[11px] font-semibold leading-tight text-signal-ink max-[380px]:text-[10px]">{row.teams.away}</div>
          </div>
        </div>
      </div>

      <div className="relative mt-4 hidden grid-cols-[1fr_auto] items-center gap-3 sm:grid">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <img src={row.logos?.home} className="h-9 w-9 shrink-0 object-contain opacity-90" alt="" />
            <div className="min-w-0">
              <div className="line-clamp-2 text-[12px] font-semibold leading-tight text-signal-ink sm:text-[13px]">{row.teams.home}</div>
              <div
                className="mt-2 h-0.5 max-w-[8rem] rounded-full opacity-80"
                style={{ background: `linear-gradient(90deg, ${homeColor}, transparent)` }}
              />
            </div>
          </div>
          <div className="my-2 font-mono text-[10px] text-signal-stone/90">vs</div>
          <div className="flex items-center gap-3">
            <img src={row.logos?.away} className="h-9 w-9 shrink-0 object-contain opacity-90" alt="" />
            <div className="min-w-0">
              <div className="line-clamp-2 text-[12px] font-semibold leading-tight text-signal-ink sm:text-[13px]">{row.teams.away}</div>
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
            <div className="rounded-xl border border-white/10 bg-signal-void/50 px-3 py-2 text-center">
              <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-signal-inkMuted">Încredere</div>
              <div className="mt-1 font-mono text-[11px] font-semibold text-signal-petrol">
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
        <div className="mt-3 hidden items-stretch justify-between gap-2 rounded-xl border border-white/[0.07] bg-signal-void/35 px-2.5 py-2 sm:flex">
          <div className="min-w-0 flex-1 font-mono text-[9px] leading-snug text-signal-silver">
            <span className="block text-[8px] font-semibold uppercase tracking-wide text-signal-inkMuted">Gazde</span>
            <span className="text-signal-petrol">#{row.teamContext?.home?.rank ?? "—"}</span>
            {row.teamContext?.home?.points != null ? <span className="text-signal-inkMuted"> · {row.teamContext.home.points}pt</span> : null}
            {row.teamContext?.home?.form ? (
              <span className="mt-0.5 block truncate tracking-tight text-signal-ink" title={row.teamContext.home.form}>
                {row.teamContext.home.form}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 text-right font-mono text-[9px] leading-snug text-signal-silver">
            <span className="block text-[8px] font-semibold uppercase tracking-wide text-signal-inkMuted">Oaspeți</span>
            <span className="text-signal-petrol">#{row.teamContext?.away?.rank ?? "—"}</span>
            {row.teamContext?.away?.points != null ? <span className="text-signal-inkMuted"> · {row.teamContext.away.points}pt</span> : null}
            {row.teamContext?.away?.form ? (
              <span className="mt-0.5 block truncate tracking-tight text-signal-ink" title={row.teamContext.away.form}>
                {row.teamContext.away.form}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <div className="relative mt-4 flex flex-col gap-2 border-t border-white/[0.06] pt-3 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <div className="flex items-start justify-between gap-2 sm:block min-w-0 flex-1">
          <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.15em] text-signal-petrol/75">
            <span>Selecție</span>
            {hasExactConfidence && confPct > 0 && confPct < 55 ? (
              <span
                className="rounded-sm bg-signal-amber/15 px-1 py-[1px] text-[7.5px] font-bold tracking-wider text-signal-amber"
                title={t("card.lowConfTip")}
              >
                Nesigur
              </span>
            ) : null}
            {isPickHot ? (
              <span
                className="rounded-sm bg-[var(--fp-success)]/15 px-1 py-[1px] text-[7.5px] font-bold tracking-wider text-[var(--fp-success)] animate-pulse motion-reduce:animate-none"
                title={t("card.strongSignalTip")}
              >
                HOT
              </span>
            ) : null}
          </div>
          <div className={`line-clamp-2 break-words font-display text-xl font-bold tracking-tight text-signal-ink max-[380px]:text-lg sm:text-2xl ${isPickHot ? "drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]" : ""}`}>
            {row.recommended.pick}
          </div>
          <div className={`mt-0.5 font-mono text-[10px] font-semibold tabular-nums ${isPickHot ? "text-[var(--fp-success)] animate-pulse motion-reduce:animate-none" : "text-[var(--fp-accent)]"}`}>
            odd {Number.isFinite(Number(recommendedOdd)) ? Number(recommendedOdd).toFixed(2) : "N/A"}
          </div>
          </div>
        <div className="sm:hidden self-center">
          {hasExactConfidence ? (
            <ConfidenceAura value={confPct} size="compact" className="self-end" />
          ) : (
            <div className="rounded-xl border border-white/10 bg-signal-void/50 px-3 py-2 text-center">
              <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-signal-inkMuted">Încredere</div>
              <div className="mt-1 font-mono text-[11px] font-semibold text-signal-petrol">
                {confidenceCategory ? confidenceCategory : "Blocat"}
              </div>
            </div>
          )}
        </div>
        </div>
        {(hasFinalScore || showRunningScore) && (
          <div className="self-end text-right font-mono text-xs tabular-nums">
            {showRunningScore ? (
              <span className={isLive ? "text-red-200" : "text-signal-amber/90"}>
                <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide">{isLive ? "Live" : "Scor"}</span>
                <span className="font-display text-lg font-bold tabular-nums text-signal-ink">
                  {row.score?.home}-{row.score?.away}
                </span>
              </span>
            ) : (
              <span className="text-signal-silver">
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
              <span className="w-3 font-mono text-[9px] text-signal-inkMuted">{b.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-signal-void/60">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, b.val || 0))}%`, backgroundColor: b.color }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[9px] tabular-nums text-signal-silver">
                {Math.round(b.val || 0)}%
              </span>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {row.valueBet?.detected && (
              <span className="rounded-md border border-signal-amber/35 bg-signal-amber/10 px-1.5 py-0.5 font-mono text-[8px] uppercase text-signal-amberSoft">
                +EV
              </span>
            )}
            {hasExactConfidence && confPct > 0 && (
              <span className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[8px] text-signal-inkMuted">
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
              className="inline-flex items-center rounded-md border border-white/10 bg-signal-void/45 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-signal-inkMuted"
              title={t("card.unlockHigher")}
            >
              🔒 {label}
            </span>
          ))}
        </div>
      )}

      {!compact && hasExactConfidence && (cornersPick || shotsPick || firstHalfPick) && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {[
            {
              label: t("match.featCorners"),
              data: cornersPick,
              odd: row.marketOdds?.corners?.odd,
              source: row.marketOdds?.corners?.bookmaker,
              accentClass: "border-[var(--fp-accent)]/35 bg-[var(--fp-accent-muted)]"
            },
            {
              label: t("match.featShots"),
              data: shotsPick,
              odd: row.marketOdds?.shotsOnTarget?.odd,
              source: row.marketOdds?.shotsOnTarget?.bookmaker,
              accentClass: "border-violet-500/35 bg-violet-500/10"
            },
            {
              label: t("match.featHt"),
              data: firstHalfPick,
              odd: row.marketOdds?.firstHalfGoals?.odd,
              source: row.marketOdds?.firstHalfGoals?.bookmaker,
              accentClass: "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10"
            }
          ].map((item) => {
            const isHot = item.label === marketPulseWinnerLabel;
            return (
            <div
              key={item.label}
              className={`rounded-md border px-1.5 py-1 text-center ${item.accentClass} ${isHot ? "ring-1 ring-[var(--fp-accent)]/40 animate-pulse motion-reduce:animate-none" : ""}`}
            >
              <div className="font-mono text-[8px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">{item.label}</div>
              <div className="mt-0.5 font-mono text-[9px] font-bold text-[var(--fp-text)]">{item.data?.pick ?? "—"}</div>
              <div className="font-mono text-[8px] font-semibold tabular-nums text-[var(--fp-text)]">
                {item.data ? `${Math.round(item.data.probability)}%` : "—"}
              </div>
              <div className="font-mono text-[8px] font-semibold tabular-nums text-[var(--fp-text-muted)]">
                {t("card.oddLabel", {
                  odd: Number.isFinite(Number(item.odd)) ? Number(item.odd).toFixed(2) : t("card.na")
                })}
              </div>
              <div className="font-mono text-[7px] text-[var(--fp-text-faint)]">{item.source || t("card.sourceNa")}</div>
            </div>
          )})}
        </div>
      )}

      {!compact && canShowSpecialBet && hasExactConfidence && specialBetLegs.length >= 2 && (
        <div className="mt-2 min-w-0 rounded-lg border border-[var(--fp-success)]/40 bg-[var(--fp-success)]/10 px-2 py-1.5 shadow-[var(--fp-shadow-sm)]">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="font-mono text-[7.5px] font-bold uppercase tracking-[0.12em] text-[var(--fp-success)] sm:text-[8px] sm:tracking-[0.14em]">
              {t("card.specialBet")}
            </div>
            {specialBetCandidatesLen >= 3 ? (
              <div className="inline-flex rounded-md border border-[var(--fp-success)]/35 bg-[var(--fp-bg-card)] p-[1px]">
                {[2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSpecialLegCount(n as 2 | 3);
                    }}
                    className={`px-1.5 py-0.5 font-mono text-[7px] font-semibold uppercase sm:text-[8px] ${
                      specialLegCount === n
                        ? "rounded bg-[var(--fp-success)]/20 text-[var(--fp-text)]"
                        : "text-[var(--fp-text-muted)]"
                    }`}
                  >
                    {t("card.legs", { n })}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-0.5 space-y-0.5">
            {specialBetLegs.map((leg) => {
              const tone = outcomeTextClass(leg.outcome);
              return (
                <div
                  key={`${leg.label}-${leg.pick}`}
                  className={`flex items-center justify-between gap-1.5 font-mono text-[7.5px] sm:text-[8px] ${tone}`}
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
          <div className={`mt-1 font-mono text-[8px] font-semibold tabular-nums ${specialCombinedTone}`}>
            {t("card.combinedOdd", {
              odd: Number.isFinite(Number(specialBetCombinedOdd))
                ? Number(specialBetCombinedOdd).toFixed(2)
                : t("card.na")
            })}
          </div>
        </div>
      )}

      <p className="relative mt-3 font-mono text-[9px] text-signal-inkMuted/90">
        {compact ? t("card.detailsArrow") : t("card.openDetails")}
      </p>
    </div>
  );
}
