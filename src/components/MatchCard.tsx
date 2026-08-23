import { lazy, Suspense, useState } from "react";
import { useLocale } from "../context/LocaleContext";
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
import { PredictionRow } from "../types";
import { hasRunningScore, isFixtureInPlay } from "../utils/appUtils";
import { resolveCardMarketOutcome } from "../utils/cardMarketOutcome";
import { formatRecommendedPick } from "../utils/formatRecommendation";
import MarketFamilyIcon from "./icons/MarketFamilyIcon";
import {
  deriveRecommendedOdd,
  formatLiveMinute,
  isFinalStatus,
  modelTierBadge,
  statusChip
} from "./matchCard/derivations";
import { MarketPicksGrid } from "./matchCard/MarketPicksGrid";
import { SpecialBetSection } from "./matchCard/SpecialBetSection";

// Singura muchie statică dinspre card către recharts (~370 kB chunk). Lazy aici
// înseamnă că dashboard-ul nu mai preîncarcă chunk-ul de chart-uri la deschidere;
// el se descarcă abia când un card ne-compact cu date suficiente chiar randează
// laboratorul.
const PredictionLaboratoryPanel = lazy(() => import("./PredictionLaboratory"));

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
  /** Opens the prediction report dialog for this row. Absent = no report button. */
  onReport?: () => void;
  /** Effective access tier (free / premium / ultra) — drives lock vs missing-data UI. */
  accessTier?: string;
};

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
  onShare,
  onReport
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
  // Shared running-score predicate: terminal / abandoned statuses and fixtures
  // past the poll grace never read as a running score (live-state audit).
  const showRunningScore = hasRunningScore(row);
  const liveMinuteLabel = isLive ? formatLiveMinute(row.score?.minute, row.score?.extra) : null;
  const kickoffDate = new Date(row.kickoff);
  const chip = statusChip(row, confPct, hasFinalScore, finalPickResult, isLive, t);
  const tier = modelTierBadge(row);
  const recommendedOdd = deriveRecommendedOdd(row);
  const recommendedLabel = formatRecommendedPick(row.recommended?.pick, row.recommended?.family, t, row.recommended);
  const isPickHot = hasExactConfidence && confPct >= 85;

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
        className="relative flex h-full animate-stagger-in cursor-pointer flex-col rounded-[var(--fp-radius)] border border-fp-warning/30 bg-fp-warning/5 shadow-fp-sm p-3.5 sm:p-4 touch-manipulation select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-accent/50 motion-reduce:animate-none"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--fp-warning)]">Insufficient signal</div>
        <div className="font-display mt-1 text-base font-semibold text-[var(--fp-text)]">
          {row.teams?.home} vs {row.teams?.away}
        </div>
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-[var(--fp-text-muted)]">{row.insufficientReason || "Modelul nu a putut estima λ-uri."}</p>
        <p className="mt-3 font-mono text-[10px] text-fp-accent/80">Detalii în fișă analitică →</p>
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
      className="group relative flex h-full animate-stagger-in cursor-pointer flex-col overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-fp-sm p-3.5 sm:p-4 touch-manipulation select-none transition-[transform,box-shadow,border-color] duration-200 ease-out hover-fine:-translate-y-0.5 hover-fine:border-fp-accent/25 hover-fine:shadow-fp active:translate-y-0 motion-reduce:animate-none motion-reduce:hover-fine:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-accent/50"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fp-accent/25 to-transparent opacity-80" />

      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {onToggleWatch && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatch();
              }}
              className={`flex h-11 min-w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                watched
                  ? "border-fp-warning/40 bg-fp-warning/15 text-[var(--fp-warning)]"
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
              className={`flex h-11 min-w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                bookmarked
                  ? "border-fp-accent/40 bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
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
          {/* Deliberately last and unfilled: reporting is rare, and a loud button
              would compete with the prediction the card exists to show. */}
          {onReport && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReport();
              }}
              className="flex h-11 min-w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] text-[11px] text-[var(--fp-text-muted)] hover-fine:border-fp-danger/40 hover-fine:text-[var(--fp-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
              aria-label={t("predictionReport.cardAction")}
              title={t("predictionReport.cardAction")}
            >
              ⚑
            </button>
          )}
          <span className="inline-flex items-center gap-1 truncate max-w-[9rem] rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)] sm:max-w-[12rem]">
            {row.logos?.league ? <img src={row.logos.league} className="h-3.5 w-3.5 shrink-0 object-contain" alt="" /> : null}
            {row.league}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chip.className}`}
          >
            {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-live)] motion-reduce:animate-none" />}
            {chip.label}
          </span>
          {tier ? (
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${tier.className}`}
              title={tier.title}
            >
              {tier.label}
            </span>
          ) : null}
          {row.confidenceEngine ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-fp-accent/30 bg-fp-accent/8 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-accent)]"
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
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2.5 py-2 max-xs:gap-1.5 max-xs:px-2 max-xs:py-1.5">
          <div className="min-w-0 text-center">
            <div
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 bg-[var(--fp-bg-card)] p-1 max-xs:h-8 max-xs:w-8"
              style={{ borderColor: homeColor }}
            >
              <img src={row.logos?.home} className="h-full w-full object-contain opacity-90" alt="" />
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] font-semibold leading-tight text-[var(--fp-text)] max-xs:text-[10px]">{row.teams.home}</div>
          </div>
          <div className="font-mono text-[10px] text-[var(--fp-text-faint)] max-xs:text-[10px]">vs</div>
          <div className="min-w-0 text-center">
            <div
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 bg-[var(--fp-bg-card)] p-1 max-xs:h-8 max-xs:w-8"
              style={{ borderColor: awayColor }}
            >
              <img src={row.logos?.away} className="h-full w-full object-contain opacity-90" alt="" />
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] font-semibold leading-tight text-[var(--fp-text)] max-xs:text-[10px]">{row.teams.away}</div>
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
              <div className="line-clamp-2 text-xs font-semibold leading-tight text-[var(--fp-text)]">{row.teams.home}</div>
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
              <div className="line-clamp-2 text-xs font-semibold leading-tight text-[var(--fp-text)]">{row.teams.away}</div>
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
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">Încredere</div>
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
          <div className="min-w-0 flex-1 font-mono text-[10px] leading-snug text-[var(--fp-text-muted)]">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">Gazde</span>
            <span className="text-[var(--fp-accent)]">#{row.teamContext?.home?.rank ?? "—"}</span>
            {row.teamContext?.home?.points != null ? <span className="text-[var(--fp-text-muted)]"> · {row.teamContext.home.points}pt</span> : null}
            {row.teamContext?.home?.form ? (
              <span className="mt-0.5 block truncate tracking-tight text-[var(--fp-text)]" title={row.teamContext.home.form}>
                {row.teamContext.home.form}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 text-right font-mono text-[10px] leading-snug text-[var(--fp-text-muted)]">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">Oaspeți</span>
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
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fp-accent/75">
            <span>Selecție</span>
            {hasExactConfidence && confPct > 0 && confPct < 55 ? (
              <span
                className="rounded-sm bg-fp-warning/15 px-1 py-[1px] text-[10px] font-bold tracking-wider text-[var(--fp-warning)]"
                title={t("card.lowConfTip")}
              >
                Nesigur
              </span>
            ) : null}
            {isPickHot ? (
              <span
                className="rounded-sm bg-fp-success/15 px-1 py-[1px] text-[10px] font-bold tracking-wider text-[var(--fp-success)]"
                title={t("card.strongSignalTip")}
              >
                HOT
              </span>
            ) : null}
          </div>
          <div className={`flex items-center gap-1.5 line-clamp-2 break-words font-display text-xl font-bold tracking-tight text-[var(--fp-text)] max-xs:text-lg sm:text-2xl ${isPickHot ? "drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]" : ""}`}>
            <MarketFamilyIcon familyKey={recommendedLabel.familyKey} className="shrink-0 text-fp-accent/70" />
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
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">Încredere</div>
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
              <span className={isLive ? "text-[var(--fp-live)]" : "text-fp-warning/90"}>
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide">{isLive ? "Live" : "Scor"}</span>
                <span className="font-display text-lg font-bold tabular-nums text-[var(--fp-text)]">
                  {row.score?.home}-{row.score?.away}
                </span>
                {liveMinuteLabel && (
                  <span className="block text-[10px] font-semibold tabular-nums text-fp-danger/80">
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
            { label: "X", val: row.probs.pX, color: "var(--fp-text-muted)" },
            { label: "2", val: row.probs.p2, color: awayColor }
          ].map((b) => (
            <div key={b.label} className="flex items-center gap-2">
              <span className="w-3 font-mono text-[10px] text-[var(--fp-text-muted)]">{b.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--fp-bg-muted)]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, b.val || 0))}%`, backgroundColor: b.color }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[10px] tabular-nums text-[var(--fp-text-muted)]">
                {Math.round(b.val || 0)}%
              </span>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {row.valueBet?.detected && (
              <span className="rounded-md border border-fp-warning/35 bg-fp-warning/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--fp-warning)]">
                +EV
              </span>
            )}
            {hasExactConfidence && confPct > 0 && (
              <span className="rounded-md border border-[var(--fp-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fp-text-muted)]">
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

      {!compact && !row.insufficientData ? (
        <Suspense fallback={null}>
          <PredictionLaboratoryPanel match={row} compact />
        </Suspense>
      ) : null}

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
              className="inline-flex items-center rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]"
              title={t("card.unlockHigher")}
            >
              🔒 {label}
            </span>
          ))}
        </div>
      )}

      {!compact && <MarketPicksGrid row={row} accessTier={accessTier} />}

      {!compact && (
        <SpecialBetSection
          row={row}
          canShowSpecialBet={canShowSpecialBet}
          hasExactConfidence={hasExactConfidence}
          specialLegCount={specialLegCount}
          onLegCountChange={setSpecialLegCount}
        />
      )}

      <p className="relative mt-3 font-mono text-[10px] text-fp-text-muted/90">
        {compact ? t("card.detailsArrow") : t("card.openDetails")}
      </p>
    </div>
  );
}
