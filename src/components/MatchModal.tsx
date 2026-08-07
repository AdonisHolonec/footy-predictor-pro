import { useEffect, useRef, useState } from "react";
import { useLocale } from "../context/LocaleContext";
import CollapsiblePanel from "../design-system/CollapsiblePanel";
import LuckBadge from "./LuckBadge";
import XGPerformanceBar from "./XGPerformanceBar";
import ConfidenceEnginePanel from "./ConfidenceEnginePanel";
import ExplanationCard from "./ExplanationCard";
import FeatureImportanceChart from "./FeatureImportanceChart";
import PredictionContributionsChart from "./PredictionContributionsChart";
import ValueCard from "./ValueCard";
import PredictionLaboratoryPanel from "./PredictionLaboratory";
import MonteCarloPanel from "./MonteCarloPanel";
import MatchMomentumTimeline from "./ux/MatchMomentumTimeline";
import MatchMomentumStickyStrip from "./ux/MatchMomentumStickyStrip";
import {
  deriveDataQuality,
  deriveSignalEdge,
  EdgeCompass,
  FormRibbon,
  SignalLens
} from "./SignalLab";
import { LeagueStandingEntry, MarketTier, MarketTierInfo, MatchScore, PoissonMarketProbs, PredictionRow, TeamStandingsFormSnapshot, XGData } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";
import {
  listSpecialBetCandidates,
  pickSpecialBetLegs,
  outcomeTextClass,
  specialBetCombinedOdd as specialBetCombinedOddValue,
  specialBetCombinedOutcome,
  specialBetLiveAdjustmentBadge
} from "../utils/specialBet";
import { matchingMarketOdd, shotsDisplayOdd, deriveAlignedOuPick } from "../utils/marketPicks";
import { resolveCardMarketOutcome } from "../utils/cardMarketOutcome";
import { fetchWithAuth } from "../utils/apiAuth";
import { formatRecommendedPick } from "../utils/formatRecommendation";
import MatchDecisionBlock, { type BenchmarkConsensus } from "./matchModal/MatchDecisionBlock";
import {
  deriveRecommendedOdd,
  evaluateScoreDerivedPick,
  fallbackTierFromProb,
  finalScoreBadgeClass,
  finalScoreLabel,
  isFinalStatus,
  marketResultBadge
} from "./matchModal/helpers";
import PoissonMarketSection from "./matchModal/PoissonMarketSection";
import MarketPickCard from "./matchModal/MarketPickCard";
import TeamSnapshotCard from "./matchModal/TeamSnapshotCard";
import LeagueStandingsTable from "./matchModal/LeagueStandingsTable";

type MatchModalProps = {
  match: PredictionRow;
  logoColors: Record<string, string>;
  onClose: () => void;
  hashColor: (seed: string) => string;
  canShowSpecialBet?: boolean;
  /** Effective access tier — avoids false upgrade locks for premium/ultra. */
  accessTier?: "free" | "premium" | "ultra" | string;
  /** Enterprise UI V2: right drawer (desktop) / bottom sheet (mobile). */
  presentation?: "modal" | "focus";
  /** Called when user clicks a plan-locked control. */
  onUpgradeRequired?: (feature: string, requiredTier: "premium" | "ultra") => void;
};

/**
 * Stil vizual pentru un pick în funcţie de nivelul de încredere.
 * `toss` înseamnă practic 50/50 — UI trebuie să clarifice asta explicit.
 */
/**
 * Four decision-oriented sections, down from eleven data-oriented tabs.
 * The tab count now matches the number of user intents, not the number of model
 * outputs. Every former tab's content is preserved — it moved into the group
 * that answers the same question:
 *
 *   overview → live context, special bet, form/standings  (what is happening)
 *   analysis → prediction lab, why/key factors, xG, Monte Carlo  (why this pick)
 *   markets  → 1X2 odds, value, per-market Poisson panels  (every price)
 *   advanced → model internals, previously buried in prediction/why
 */
const DETAIL_TABS = [
  { id: "overview", labelKey: "match.tabOverview" },
  { id: "analysis", labelKey: "match.tabAnalysis" },
  { id: "markets", labelKey: "match.tabMarkets" },
  { id: "advanced", labelKey: "match.tabAdvanced" }
] as const;

type DetailTabId = (typeof DETAIL_TABS)[number]["id"];

export default function MatchModal({
  match,
  logoColors,
  onClose,
  hashColor,
  canShowSpecialBet = false,
  accessTier = "free",
  presentation = "focus",
  onUpgradeRequired
}: MatchModalProps) {
  const { t: tr } = useLocale();
  const [specialLegCount, setSpecialLegCount] = useState<2 | 3>(2);
  const [detailTab, setDetailTab] = useState<DetailTabId>("overview");
  const tab = (ids: DetailTabId[]) => (ids.includes(detailTab) ? "" : "hidden");
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [xgData, setXgData] = useState<XGData | null>(() => {
    if (!match.luckStats) return null;
    return { homeXG: match.luckStats.hXG, awayXG: match.luckStats.aXG };
  });

  useEffect(() => {
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const tm = setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      clearTimeout(tm);
      prevFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = modalRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth(`/api/fixtures?view=xg&fixtureId=${match.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && !data?.error) setXgData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [match.id]);

  if (match.insufficientData) {
    const table = match.leagueStandings;
    const ctx = match.teamContext;
    const hasRich = Boolean((table && table.length > 0) || ctx?.home || ctx?.away);
    const homeColor = logoColors[match.logos?.home || ""] || hashColor(match.teams.home);
    const awayColor = logoColors[match.logos?.away || ""] || hashColor(match.teams.away);
    const hid = match.fixtureTeamIds?.home;
    const aid = match.fixtureTeamIds?.away;

    if (!hasRich) {
      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--fp-navy)]/85 p-3 backdrop-blur-md sm:p-4"
          onClick={onClose}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--fp-warning)]/25 bg-[var(--fp-bg-card)]/90 p-8 text-center shadow-[var(--fp-shadow-lg)] backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-lg font-semibold text-[var(--fp-text)]">{tr("match.insufficientTitle")}</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--fp-text-muted)]">{match.insufficientReason}</p>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="mt-6 min-h-[var(--fp-touch)] rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--fp-accent)] hover:bg-[var(--fp-border)] hover:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]/45"
            >
              {tr("match.close")}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--fp-navy)]/88 p-3 backdrop-blur-md sm:p-4"
        onClick={onClose}
      >
        <div
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--fp-warning)]/25 bg-[var(--fp-bg-card)]/95 p-5 shadow-[var(--fp-shadow-lg)] backdrop-blur-xl sm:max-w-2xl sm:p-8"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="match-modal-insufficient-title"
          aria-describedby="match-modal-insufficient-desc"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p id="match-modal-insufficient-title" className="font-display text-lg font-semibold text-[var(--fp-text)]">{tr("match.insufficientTitle")}</p>
              <p id="match-modal-insufficient-desc" className="mt-1 text-[11px] text-[var(--fp-text-muted)]">{match.insufficientReason}</p>
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--fp-border)] text-sm text-[var(--fp-text-muted)] hover:border-[var(--fp-accent)]/40 hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]/45"
              aria-label={tr("match.close")}
            >
              ✕
            </button>
          </div>
          <p className="mt-4 text-center font-display text-base font-semibold text-[var(--fp-text)]">
            {match.teams.home} <span className="text-[var(--fp-text-muted)]">vs</span> {match.teams.away}
          </p>
          <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-wide text-[var(--fp-accent)]/70">{match.league}</p>

          {(ctx?.home || ctx?.away) && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <TeamSnapshotCard title={tr("match.home")} snap={ctx?.home} accent={homeColor} />
              <TeamSnapshotCard title={tr("match.away")} snap={ctx?.away} accent={awayColor} />
            </div>
          )}

          {table && table.length > 0 ? (
            <div className="mt-6">
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fp-accent)]/80">{tr("match.standings")}</h3>
              <LeagueStandingsTable rows={table} highlightHomeId={hid} highlightAwayId={aid} />
            </div>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="mt-8 w-full rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] py-2.5 text-sm font-semibold text-[var(--fp-accent)] hover:bg-[var(--fp-border)] hover:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]/45"
          >
            {tr("match.close")}
          </button>
        </div>
      </div>
    );
  }

  const homeColor = logoColors[match.logos?.home || ""] || hashColor(match.teams.home);
  const awayColor = logoColors[match.logos?.away || ""] || hashColor(match.teams.away);
  const pct = (n: number) => Math.round(n || 0);
  // UI exposure only — reads existing valueEngine.markets as-is, does not change
  // candidate generation/ranking (server-utils/value/valueMarkets.js).
  const correctScoreCandidates = (match.valueEngine?.markets || [])
    .filter((m) => m.family === "Correct Score")
    .sort((a, b) => (Number(b.probability) || 0) - (Number(a.probability) || 0));
  const hasFinalScore =
    isFinalStatus(match.status) &&
    match.score?.home !== null &&
    match.score?.away !== null &&
    match.score?.home !== undefined &&
    match.score?.away !== undefined;
  const hasNumericScore = match.score != null && typeof match.score.home === "number" && typeof match.score.away === "number";
  const koMs = new Date(match.kickoff).getTime();
  const pastKickoffPollWindow = Number.isFinite(koMs) && Date.now() >= koMs - 15 * 60 * 1000;
  /** Scor în desfășurare: status „live” sau încă NS dar după fereastra de start (poll actualizează). */
  const hasLiveScore =
    hasNumericScore &&
    !hasFinalScore &&
    (isFixtureInPlay(match.status) || (pastKickoffPollWindow && !isFinalStatus(match.status)));
  // Recommended settlement is server-resolved only — never regraded here (see
  // resolveCardMarketOutcome). Renders the persisted verdict, or neutral when still pending.
  const recommendedOutcome = resolveCardMarketOutcome("recommended", match);
  const finalPickResult =
    recommendedOutcome === "win" ? true : recommendedOutcome === "loss" ? false : null;
  const recommendedLabel = formatRecommendedPick(match.recommended?.pick, match.recommended?.family, tr);
  const kickoffDate = new Date(match.kickoff);
  const hasExactConfidence =
    match.recommended?.confidence != null && Number.isFinite(Number(match.recommended?.confidence));
  const confPct = hasExactConfidence ? pct(match.recommended?.confidence) : 0;
  const confidenceCategory = match.recommended?.confidenceCategory || null;
  const isPremiumLike = !hasExactConfidence && Boolean(confidenceCategory);
  const isFreeLike = !hasExactConfidence && !confidenceCategory;
  const effectiveAccessTier = String(accessTier || "free").toLowerCase();
  const showTierUpgradeLocks = effectiveAccessTier === "free" || effectiveAccessTier === "premium";
  const edgeScore = deriveSignalEdge(match);
  const dq = deriveDataQuality(match);

  /**
   * Decision Layer inputs. All three READ already-computed engine output — no EV,
   * confidence or probability math happens here. When an engine reports nothing
   * for this fixture the Decision Block renders a neutral "n/a" instead.
   */
  const decisionEvPct = (() => {
    const fromValueBet = Number(match.valueBet?.ev);
    if (Number.isFinite(fromValueBet)) return fromValueBet;
    const fromEngine = Number(match.valueEngine?.expectedValue);
    if (Number.isFinite(fromEngine)) return fromEngine;
    return null;
  })();

  /** First plain-language reason from the Explanation engine — never a formula. */
  const decisionRationale = (() => {
    const label = match.explanation?.reasons?.[0]?.label;
    if (typeof label === "string" && label.trim()) return label.trim();
    const sentence = match.explanation?.reasoning?.[0];
    if (typeof sentence === "string" && sentence.trim()) return sentence.trim();
    return null;
  })();

  /**
   * Prediction Benchmark placeholder (api/backtest?view=benchmark-*). Intentionally
   * null until the feature ships: the consensus row is omitted entirely when this is
   * absent, so the block degrades gracefully rather than showing an empty slot.
   */
  const decisionBenchmark: BenchmarkConsensus | null = null;

  const ProbBar = ({ label, val, color }: { label: string; val: number; color: string }) => (
    <div className="mb-4">
      <div className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
        <span>{label}</span>
        <span className="font-mono tabular-nums" style={{ color }}>
          {pct(val)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--fp-bg-muted)] ring-1 ring-[var(--fp-border)]">
        <div style={{ width: `${val}%`, backgroundColor: color }} className="h-full rounded-full" />
      </div>
    </div>
  );

  const pr = match.probs;
  const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
  const ext = {
    pDC1X: pr.pDC1X ?? clamp100(pr.p1 + pr.pX),
    pDC12: pr.pDC12 ?? clamp100(pr.p1 + pr.p2),
    pDCX2: pr.pDCX2 ?? clamp100(pr.pX + pr.p2),
    pU15: pr.pU15 ?? clamp100(100 - pr.pO15),
    pNGG: pr.pNGG ?? clamp100(100 - pr.pGG),
    pU25: pr.pU25 ?? clamp100(100 - pr.pO25)
  };
  const standingsRows = match.leagueStandings;
  const showStandingsBlock =
    Boolean(match.teamContext?.home || match.teamContext?.away || (standingsRows && standingsRows.length > 0));
  const firstHalfPick = match.probs.firstHalf
    ? (() => {
        const pOver = match.probs.firstHalf.pO15;
        if (!Number.isFinite(pOver)) return null;
        return pOver >= 50
          ? {
              // Canonical EN pick for odds matching; display uses localized label below.
              pick: "Over 1.5 FH",
              displayPick: `${tr("match.overLine", { line: "1.5" })} FH`,
              probability: pOver,
              line: 1.5,
              side: "over" as const
            }
          : {
              pick: "Under 1.5 FH",
              displayPick: `${tr("match.underLine", { line: "1.5" })} FH`,
              probability: 100 - pOver,
              line: 1.5,
              side: "under" as const
            };
      })()
    : null;
  const htGoalsActual = (() => {
    const fromXg = xgData?.marketResults?.firstHalfGoals;
    if (fromXg != null && Number.isFinite(Number(fromXg))) return Number(fromXg);
    const fromMr = match.marketResults?.firstHalfGoals;
    if (fromMr != null && Number.isFinite(Number(fromMr))) return Number(fromMr);
    const hRaw = match.score?.halftime?.home;
    const aRaw = match.score?.halftime?.away;
    if (hRaw == null || aRaw == null) return null;
    const h = Number(hRaw);
    const a = Number(aRaw);
    if (Number.isFinite(h) && Number.isFinite(a)) return h + a;
    return null;
  })();
  const firstHalfVerdict =
    firstHalfPick && htGoalsActual != null && Number.isFinite(Number(htGoalsActual))
      ? firstHalfPick.side === "over"
        ? Number(htGoalsActual) > firstHalfPick.line
        : Number(htGoalsActual) < firstHalfPick.line
      : null;
  const recommendedOdd = deriveRecommendedOdd(match);
  const specialBetLabels = {
    main: tr("match.featMain"),
    goals: tr("card.marketGoals"),
    corners: tr("match.featCorners"),
    shots: tr("match.featShots"),
    ht: tr("match.featHt"),
    gg: tr("match.marketGgNgg"),
    cards: tr("match.cards")
  };
  const specialBetPool = listSpecialBetCandidates(
    match,
    specialBetLabels,
    match.cardMarketValidations,
    xgData?.marketResults
  );
  const specialBetLegs = pickSpecialBetLegs(specialBetPool, specialLegCount);
  const specialBetCombinedOdd = specialBetCombinedOddValue(specialBetLegs);
  const specialCombinedOutcome = specialBetCombinedOutcome(specialBetLegs);
  const specialCombinedTone = outcomeTextClass(specialCombinedOutcome);
  const specialBetCandidatesLen = specialBetPool.length;

  const isFocus = presentation === "focus";

  return (
    <div
      className={
        isFocus
          ? "fixed inset-0 z-50 flex items-end justify-end bg-[var(--fp-navy)]/40 pb-[env(safe-area-inset-bottom)] backdrop-blur-[2px] sm:items-stretch sm:pb-0"
          : "fixed inset-0 z-50 flex items-center justify-center bg-[var(--fp-navy)]/50 p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:p-4"
      }
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className={
          isFocus
            ? "fp-readable relative flex h-[min(92dvh,100%)] w-full max-w-xl flex-col overflow-y-auto rounded-t-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-lg)] sm:h-full sm:max-w-2xl sm:rounded-none sm:rounded-l-[var(--fp-radius-lg)] lg:max-w-3xl"
            : "fp-readable relative max-h-[min(92dvh,100%)] w-full max-w-lg overflow-y-auto rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-[var(--fp-shadow-lg)] lg:max-w-5xl"
        }
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-modal-title"
        aria-describedby="match-modal-desc"
      >
        <button
          ref={closeBtnRef}
          onClick={onClose}
          title={tr("match.close")}
          className="sticky top-2 z-10 ml-auto mr-2 mt-2 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)] transition hover:border-[var(--fp-accent)] hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
          type="button"
          aria-label={tr("match.close")}
        >
          ✕
        </button>

        {hasLiveScore && match.momentum && (
          <MatchMomentumStickyStrip
            minute={match.score?.minute ?? null}
            status={match.status}
            homeTeam={match.teams.home}
            awayTeam={match.teams.away}
            homeScore={match.score?.home ?? null}
            awayScore={match.score?.away ?? null}
            homeMomentum={match.momentum.homeMomentum}
            awayMomentum={match.momentum.awayMomentum}
            confidenceLabel={hasExactConfidence ? `${confPct}%` : confidenceCategory || tr("match.locked")}
            onJumpToTop={() => {
              const reduceMotion =
                typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
              modalRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
            }}
          />
        )}

        <div className="border-b border-[var(--fp-border)] px-4 pb-4 pt-1 sm:px-6">
          <p id="match-modal-title" className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">
            {tr("match.analysis")}
          </p>
          <div className="mb-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center justify-center gap-2 max-[380px]:gap-1.5 sm:mb-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
            <div className="flex w-[4.5rem] min-w-0 flex-col items-center gap-1 max-[380px]:w-[4rem] sm:w-full sm:gap-1.5">
              <img
                src={match.logos?.home}
                className="h-14 w-14 shrink-0 object-contain opacity-95 max-[380px]:h-12 max-[380px]:w-12 sm:h-16 sm:w-16 lg:h-20 lg:w-20"
                alt=""
              />
              <div className="w-full px-0.5 text-center font-display text-[11px] font-bold leading-tight text-[var(--fp-text)] max-[380px]:text-[10px] sm:text-sm lg:text-base">
                {match.teams.home}
              </div>
            </div>
            <div className="flex w-full min-w-0 max-w-[15.5rem] shrink-0 flex-col items-center px-0.5 max-[380px]:max-w-[12.75rem] sm:w-auto sm:min-w-[10rem] sm:max-w-[23rem] sm:px-2">
              <div className="mb-0.5 text-center text-[9px] font-bold uppercase leading-tight tracking-wider text-[var(--fp-text-muted)] max-[380px]:text-[8px] sm:text-[10px]">
                {match.league}
              </div>
              <div className="font-display text-3xl font-bold leading-none tracking-tighter text-[var(--fp-text)] max-[380px]:text-2xl sm:text-5xl">
                {hasNumericScore && (hasFinalScore || hasLiveScore) ? `${match.score?.home}-${match.score?.away}` : "—"}
              </div>
              {/* Pick / odds / confidence intentionally NOT repeated here — they are
                  the Decision Block's job, directly below. */}
              {hasFinalScore && (
                <div
                    className={`mt-2 inline-block max-w-full truncate rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-wide max-[380px]:text-[8px] sm:mt-3 sm:px-3 sm:py-1.5 sm:text-[10px] ${finalScoreBadgeClass(finalPickResult)}`}
                >
                  {finalScoreLabel(finalPickResult)} · {match.score?.home}-{match.score?.away}
                </div>
              )}
              {hasLiveScore && (
                <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--fp-danger)] sm:mt-3 sm:px-3 sm:py-1.5 sm:text-[10px]">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--fp-danger)] motion-reduce:animate-none" /> Live ·{" "}
                  {match.score?.home}-{match.score?.away}
                  {Number.isFinite(Number(match.score?.minute)) ? ` · ${match.score?.minute}'` : ""}
                </div>
              )}
              <div id="match-modal-desc" className="mt-2 flex max-w-full flex-wrap justify-center gap-x-1.5 gap-y-0.5 text-center text-[9px] text-[var(--fp-text-muted)] sm:mt-3 sm:gap-x-3 sm:text-[10px]">
                <span className="font-mono tabular-nums">{kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}</span>
                <span>·</span>
                <span className="font-mono tabular-nums">{new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span>·</span>
                <span className="max-w-[6rem] truncate sm:max-w-[10rem]">{match.referee || "—"}</span>
              </div>
            </div>
            <div className="flex w-[4.5rem] min-w-0 flex-col items-center gap-1 max-[380px]:w-[4rem] sm:w-full sm:gap-1.5">
              <img
                src={match.logos?.away}
                className="h-14 w-14 shrink-0 object-contain opacity-95 max-[380px]:h-12 max-[380px]:w-12 sm:h-16 sm:w-16 lg:h-20 lg:w-20"
                alt=""
              />
              <div className="w-full px-0.5 text-center font-display text-[11px] font-bold leading-tight text-[var(--fp-text)] max-[380px]:text-[10px] sm:text-sm lg:text-base">
                {match.teams.away}
              </div>
            </div>
          </div>
          {/* Decision Layer — the last thing above the navigation, by design.
              Everything a bet/no-bet call needs lives here; every other block
              moved below the tabs. */}
          <MatchDecisionBlock
            pickLabel={recommendedLabel.label}
            familyKey={recommendedLabel.familyKey}
            odd={recommendedOdd}
            confidencePct={hasExactConfidence ? confPct : null}
            confidenceCategory={confidenceCategory}
            evPct={decisionEvPct}
            dataQuality={dq}
            rationale={decisionRationale}
            benchmark={decisionBenchmark}
          />
        </div>

        {/* Navigation sits immediately after the Decision Block so the user learns
            the modal has sections before scrolling through any of them. */}
        <div className="sticky top-0 z-20 border-b border-[var(--fp-border)] bg-[var(--fp-bg-card)]/95 px-2 py-1.5 backdrop-blur-md sm:px-4">
          <div className="flex gap-0.5 overflow-x-auto pb-0.5" role="tablist" aria-label={tr("match.analysis")}>
            {DETAIL_TABS.map((tabItem) => (
              <button
                key={tabItem.id}
                type="button"
                role="tab"
                aria-selected={detailTab === tabItem.id}
                onClick={() => setDetailTab(tabItem.id)}
                className={`h-9 shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                  detailTab === tabItem.id
                    ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                    : "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)]"
                }`}
              >
                {tr(tabItem.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 p-3 sm:space-y-4 sm:p-5">
          {/* Live context — a single full-width timeline. Previously mounted twice
              (a desktop copy inside the narrow score column plus a mobile copy). */}
          {hasLiveScore && match.momentum && (
            <div className={`w-full ${tab(["overview"])}`}>
              <MatchMomentumTimeline
                fixtureId={Number(match.id)}
                status={match.status}
                score={match.score}
                momentum={match.momentum}
                homeTeam={match.teams.home}
                awayTeam={match.teams.away}
                liveEvents={match.liveEvents}
                recommendedPick={recommendedLabel.label}
                confidenceLabel={hasExactConfidence ? `${confPct}%` : confidenceCategory || tr("match.locked")}
                momentumNarrative={match.momentumNarrative ?? null}
              />
            </div>
          )}
          {hasLiveScore && !match.momentum && (
            <div className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-3 text-center ${tab(["overview"])}`}>
              <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-[var(--fp-text-muted)]">
                <path
                  fill="currentColor"
                  d="M3 14.5a.75.75 0 0 1 .75-.75h.5v-3a.75.75 0 0 1 1.5 0v3h1.5v-6a.75.75 0 0 1 1.5 0v6h1.5v-9a.75.75 0 0 1 1.5 0v9h1.5v-4.5a.75.75 0 0 1 1.5 0v4.5h.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z"
                />
              </svg>
              <p className="text-[10px] text-[var(--fp-text-muted)]">{tr("match.momentumUnavailable")}</p>
            </div>
          )}
          {/* Special Bet — a secondary product (parlay builder). It now sits after the
              recommendation has been justified, so it can no longer compete with the
              single-pick decision for attention. */}
          {!canShowSpecialBet && (
            <div className={`mx-auto flex w-full max-w-[32rem] items-center justify-center px-1 ${tab(["overview"])}`}>
              <div className="relative w-full max-w-[20.5rem] min-w-0 overflow-hidden rounded-xl border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 px-3.5 py-3 text-center shadow-[var(--fp-shadow-sm)] max-[380px]:max-w-[21rem] max-[380px]:px-4 sm:max-w-[28rem]">
                <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--fp-warning)] sm:text-xs">
                    {tr("match.specialBet")}
                  </div>
                  <span className="text-sm" aria-hidden>
                    🔒
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--fp-text-muted)]">{tr("card.specialBetLocked")}</p>
                <button
                  type="button"
                  onClick={() => onUpgradeRequired?.(tr("match.specialBet"), "ultra")}
                  className="mt-2.5 inline-flex items-center gap-1 rounded-md border border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text)] hover:bg-[var(--fp-warning)]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                >
                  🔒 {tr("card.unlock")}
                </button>
              </div>
            </div>
          )}
          {canShowSpecialBet && hasExactConfidence && specialBetLegs.length >= 2 && (
            <div className={`mx-auto flex w-full max-w-[32rem] items-center justify-center px-1 ${tab(["overview"])}`}>
              <div className="relative w-full max-w-[20.5rem] min-w-0 overflow-hidden rounded-xl border border-[var(--fp-success)]/45 bg-[var(--fp-success)]/10 px-3.5 py-3 text-center shadow-[var(--fp-shadow-sm)] max-[380px]:max-w-[21rem] max-[380px]:px-4 sm:max-w-[28rem]">
                <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--fp-success)] sm:text-xs">
                    {tr("match.specialBet")}
                  </div>
                  {specialBetCandidatesLen >= 3 ? (
                    <div
                      className="inline-flex rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-0.5"
                      role="group"
                      aria-label={tr("match.specialBet")}
                    >
                      {[2, 3].map((n) => {
                        const active = specialLegCount === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setSpecialLegCount(n as 2 | 3)}
                            className={`rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors sm:text-[11px] ${
                              active
                                ? "bg-[var(--fp-success)] text-white shadow-sm ring-1 ring-[var(--fp-success)]"
                                : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
                            }`}
                          >
                            {tr("match.specialBetLegs", { n })}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="mt-2.5 space-y-1.5 rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2.5 py-2 max-[380px]:px-3">
                  {specialBetLegs.map((leg) => {
                    const tone = outcomeTextClass(leg.outcome);
                    const liveBadge =
                      leg.id === "recommended" ? specialBetLiveAdjustmentBadge(leg.liveAdjustment) : null;
                    return (
                      <div
                        key={`${leg.label}-${leg.pick}`}
                        className={`flex min-h-[1.4rem] items-center justify-between gap-2 text-[11px] sm:text-xs ${tone}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-left font-semibold">
                          {leg.label}: {leg.pick}
                        </span>
                        <span className="shrink-0 rounded-sm border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-1.5 py-0.5 tabular-nums text-right font-bold">
                          {Math.round(leg.probability)}% · {Number(leg.odd).toFixed(2)}
                          {liveBadge && (
                            <span
                              className={`ml-1 ${liveBadge.tone === "success" ? "text-[var(--fp-success)]" : "text-[var(--fp-danger)]"}`}
                              title={tr(
                                liveBadge.tone === "success"
                                  ? "panels.liveAdjustedAligned"
                                  : "panels.liveAdjustedContradicted",
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
                <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[var(--fp-border)] pt-2">
                  <span className={`text-sm font-extrabold tabular-nums tracking-tight sm:text-base ${specialCombinedTone}`}>
                    {tr("match.combinedOdd", {
                      odd: Number.isFinite(Number(specialBetCombinedOdd))
                        ? Number(specialBetCombinedOdd).toFixed(2)
                        : tr("common.na")
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
                      {specialCombinedOutcome === "win" ? tr("card.chipWin") : tr("card.chipLose")}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Desktop-only today (unchanged behaviour) — see follow-ups for surfacing
              these signals on mobile, which needs its own responsive pass. Explicit
              ternary rather than tab(): "hidden" alone would lose to `sm:block`. */}
          <div className={`mx-auto max-w-2xl ${detailTab === "overview" ? "hidden sm:block" : "hidden"}`}>
            {hasExactConfidence ? (
              <CollapsiblePanel compact title={tr("panels.advancedSignals")} lazy={false}>
                <div className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-4">
                  <SignalLens confidence={confPct} edge={edgeScore} />
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <FormRibbon p1={match.probs.p1} pX={match.probs.pX} p2={match.probs.p2} homeTint={homeColor} awayTint={awayColor} />
                    <EdgeCompass dataQuality={dq} valueDetected={Boolean(match.valueBet?.detected)} />
                  </div>
                </div>
              </CollapsiblePanel>
            ) : (
              <CollapsiblePanel
                compact
                title={tr("panels.advancedSignals")}
                badge={<span className="text-[10px] font-bold text-[var(--fp-warning)]">🔒</span>}
              >
                <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 text-center text-sm font-medium text-[var(--fp-text)]">
                  {isPremiumLike ? tr("match.advancedNeedUltra") : tr("match.advancedHigher")}
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  {(isFreeLike
                    ? [
                        { label: tr("match.featConfidence"), tier: "premium" as const },
                        { label: tr("match.featSignalLens"), tier: "ultra" as const },
                        { label: tr("match.featEdgeCompass"), tier: "ultra" as const }
                      ]
                    : [
                        { label: tr("match.featConfidence"), tier: "ultra" as const },
                        { label: tr("match.featEdgeCompass"), tier: "ultra" as const }
                      ]
                  ).map(({ label, tier }) => (
                    <button
                      key={label}
                      type="button"
                      title={tr("match.upgradeTo", { label, tier })}
                      onClick={() => onUpgradeRequired?.(label, tier)}
                      className="inline-flex h-9 items-center rounded-md border border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 px-2.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text)] hover:bg-[var(--fp-warning)]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                    >
                      🔒 {label}
                    </button>
                  ))}
                </div>
                <div className="mt-4">
                  <FormRibbon p1={match.probs.p1} pX={match.probs.pX} p2={match.probs.p2} homeTint={homeColor} awayTint={awayColor} />
                </div>
              </CollapsiblePanel>
            )}
          </div>

          <section
            className={`mx-auto max-w-2xl rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-[var(--fp-shadow-sm)] sm:p-5 ${tab(["overview"])}`}
          >
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--fp-accent)]">
              {tr("match.standingsForm")}
            </h3>
            {showStandingsBlock ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TeamSnapshotCard title={tr("match.home")} snap={match.teamContext?.home} accent={homeColor} />
                  <TeamSnapshotCard title={tr("match.away")} snap={match.teamContext?.away} accent={awayColor} />
                </div>
                {standingsRows && standingsRows.length > 0 ? (
                  <div className="mt-4">
                    <h4 className="mb-2 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                      {tr("match.fullStandings", { league: match.league })}
                    </h4>
                    <LeagueStandingsTable
                      rows={standingsRows}
                      highlightHomeId={match.fixtureTeamIds?.home}
                      highlightAwayId={match.fixtureTeamIds?.away}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-[var(--fp-text-muted)]">
                {tr("match.noStandingsBody")}
                <span className="mt-2 block font-mono text-[10px] text-[var(--fp-accent)]/90">{tr("match.noStandingsHint")}</span>
              </p>
            )}
          </section>

          <div className={tab(["analysis"])}>
            <CollapsiblePanel compact title={tr("panels.predictionAnalysis")}>
              <PredictionLaboratoryPanel match={match} framed={false} />
            </CollapsiblePanel>
          </div>

          {match.monteCarlo?.probabilityDistribution ? (
            <div className={tab(["analysis"])}>
              <CollapsiblePanel compact title={tr("panels.monteCarlo")}>
                <MonteCarloPanel match={match} homeColor={homeColor} awayColor={awayColor} framed={false} />
              </CollapsiblePanel>
            </div>
          ) : null}

          <div className={`grid grid-cols-1 gap-6 lg:grid-cols-2 ${tab(["overview", "analysis", "markets"])}`}>
            <section className={`rounded-2xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-6 ${tab(["analysis"])}`}>
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fp-accent)]/80">{tr("match.xgLuck")}</h3>
              <div className="w-full">{xgData ? <XGPerformanceBar xg={xgData} /> : null}</div>
              {match.luckStats && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <LuckBadge goals={match.luckStats.hG} xg={xgData?.homeXG ?? match.luckStats.hXG} />
                  <LuckBadge goals={match.luckStats.aG} xg={xgData?.awayXG ?? match.luckStats.aXG} />
                </div>
              )}
              {!match.luckStats && (
                <p className="text-center text-[10px] text-[var(--fp-text-muted)]">{tr("match.luckUnavailable")}</p>
              )}
            </section>

            <section className={`rounded-2xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-6 ${tab(["overview", "markets"])}`}>
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fp-accent)]/80">{tr("match.oddsValue")}</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3">
                  <div className="text-[10px] font-semibold uppercase text-[var(--fp-text-muted)]">1</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums lg:text-2xl" style={{ color: homeColor }}>
                    {match.odds?.home ?? "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3">
                  <div className="text-[10px] font-semibold uppercase text-[var(--fp-text-muted)]">X</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--fp-accent)] lg:text-2xl">{match.odds?.draw ?? "—"}</div>
                </div>
                <div className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3">
                  <div className="text-[10px] font-semibold uppercase text-[var(--fp-text-muted)]">2</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums lg:text-2xl" style={{ color: awayColor }}>
                    {match.odds?.away ?? "—"}
                  </div>
                </div>
              </div>
              {match.valueEngine && (
                <div className="mt-4">
                  <ValueCard engine={match.valueEngine} bookmaker={match.odds?.bookmaker} />
                </div>
              )}
              {correctScoreCandidates.length > 0 && (
                <div className="mt-4">
                  <CollapsiblePanel
                    compact
                    title={tr("panels.correctScoreValue")}
                    subtitle={tr("panels.correctScoreValueSub")}
                  >
                    <div className="overflow-x-auto rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]">
                      <table className="w-full min-w-[360px] border-collapse text-left text-[10px]">
                        <thead>
                          <tr className="border-b border-[var(--fp-border)] text-[8px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
                            <th className="px-2.5 py-2">{tr("panels.colScoreline")}</th>
                            <th className="px-2.5 py-2 text-right">{tr("panels.colProbability")}</th>
                            <th className="px-2.5 py-2 text-right">{tr("panels.colOdds")}</th>
                            <th className="px-2.5 py-2 text-right">{tr("panels.colEv")}</th>
                            <th className="px-2.5 py-2 text-right">{tr("panels.colScore")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {correctScoreCandidates.slice(0, 12).map((m, idx) => {
                            const ev = Number(m.expectedValue);
                            const evClass =
                              Number.isFinite(ev) && ev > 0
                                ? "text-[var(--fp-success)]"
                                : Number.isFinite(ev) && ev < 0
                                  ? "text-[var(--fp-danger)]"
                                  : "text-[var(--fp-text-muted)]";
                            return (
                              <tr
                                key={`${m.type || "cs"}-${idx}`}
                                className={`border-b border-[var(--fp-border)] last:border-0 ${
                                  m.bestMarket ? "bg-[var(--fp-success)]/10" : "bg-[var(--fp-bg-card)]"
                                }`}
                              >
                                <td className="px-2.5 py-1.5 font-semibold text-[var(--fp-text)]">
                                  {m.bestMarket ? <span className="mr-1 text-[var(--fp-success)]">★</span> : null}
                                  {(m.type || "").replace(/^Correct Score\s*/i, "") || "—"}
                                </td>
                                <td className="px-2.5 py-1.5 text-right tabular-nums text-[var(--fp-text)]">
                                  {Number.isFinite(Number(m.probability))
                                    ? `${(Number(m.probability) * 100).toFixed(1)}%`
                                    : "—"}
                                </td>
                                <td className="px-2.5 py-1.5 text-right tabular-nums text-[var(--fp-text)]">
                                  {Number.isFinite(Number(m.odds)) && Number(m.odds) > 1
                                    ? Number(m.odds).toFixed(2)
                                    : "—"}
                                </td>
                                <td className={`px-2.5 py-1.5 text-right font-bold tabular-nums ${evClass}`}>
                                  {Number.isFinite(ev) ? `${ev > 0 ? "+" : ""}${ev.toFixed(2)}%` : "—"}
                                </td>
                                <td className="px-2.5 py-1.5 text-right tabular-nums text-[var(--fp-text-muted)]">
                                  {Number.isFinite(Number(m.valueScore)) ? Math.round(Number(m.valueScore)) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CollapsiblePanel>
                </div>
              )}
              {match.valueBet?.detected && match.valueBet.stakePlan && (
                <div className="mt-3 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text-muted)]">
                  <div className="text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.stakePlan")}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
                    <span>{match.valueBet.type}</span>
                    <span>EV +{match.valueBet.ev ?? 0}%</span>
                    <span>Stake {match.valueBet.kelly ?? 0}%</span>
                    <span className="text-[var(--fp-text-muted)]">Plan · {match.valueBet.stakePlan}</span>
                  </div>
                  {match.valueBet.ensemble && (
                    <div className="mt-2 grid gap-1 text-[var(--fp-text-muted)] sm:grid-cols-2">
                      <span>kelly base · {String(match.valueBet.ensemble.baseKelly ?? "—")}</span>
                      {match.valueBet.ensemble.adjustment != null ? (
                        <span>adj ×{match.valueBet.ensemble.adjustment.toFixed(3)}</span>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
              {!match.valueEngine && !match.valueBet?.detected && (
                <p className="mt-4 text-[10px] text-[var(--fp-text-muted)]">{tr("match.valueNotDetected")}</p>
              )}
            </section>
          </div>

          {match.explanation && (match.explanation.reasons?.length || match.explanation.reasoning?.length) ? (
            <div className={tab(["overview", "analysis"])}>
              <CollapsiblePanel compact title={tr("panels.predictionExplanation")}>
                <ExplanationCard explanation={match.explanation} framed={false} />
              </CollapsiblePanel>
            </div>
          ) : null}

          {match.featureImportance?.items?.length || match.featureImportance?.contributions ? (
            <div className={tab(["analysis"])}>
              <CollapsiblePanel compact title={tr("panels.keyFactors")} subtitle={tr("panels.keyFactorsSub")}>
                <FeatureImportanceChart importance={match.featureImportance} framed={false} />
              </CollapsiblePanel>
            </div>
          ) : null}

          {match.predictionContributions?.items?.length ? (
            <div className={tab(["analysis"])}>
              <CollapsiblePanel compact title={tr("panels.whyPrediction")}>
                <PredictionContributionsChart data={match.predictionContributions} framed={false} />
              </CollapsiblePanel>
            </div>
          ) : null}

          {match.confidenceEngine && (
            <div className={tab(["overview", "analysis"])}>
              <ConfidenceEnginePanel
                engine={match.confidenceEngine}
                recommendationPick={match.recommended?.pick ? recommendedLabel.label : null}
              />
            </div>
          )}

          <div className={`grid grid-cols-1 gap-6 lg:grid-cols-2 ${tab(["markets"])}`}>
            <section className="rounded-2xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-6 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fp-accent)]/80">04 — Piețe & scor</h3>
                <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                  probabilitate · încredere
                </span>
              </div>
              {(() => {
                const tiers = match.predictions.marketTiers;
                const p1 = match.probs.p1;
                const pX = match.probs.pX;
                const p2 = match.probs.p2;
                const oneXtwoPick = match.predictions.oneXtwo;
                // Fallback pentru istoricul vechi fără marketTiers: derivăm tier din probabilităţile brute.
                const oneXtwoInfo =
                  tiers?.oneXtwo ||
                  fallbackTierFromProb(
                    oneXtwoPick,
                    oneXtwoPick === "1" ? p1 : oneXtwoPick === "2" ? p2 : pX
                  );
                const ggInfo =
                  tiers?.gg ||
                  fallbackTierFromProb(
                    match.predictions.gg,
                    match.predictions.gg === "GG" ? match.probs.pGG : 100 - match.probs.pGG
                  );
                const over25Info =
                  tiers?.over25 ||
                  fallbackTierFromProb(
                    match.predictions.over25,
                    match.predictions.over25 === "Peste 2.5" ? match.probs.pO25 : 100 - match.probs.pO25
                  );
                const fhInfo = firstHalfPick
                  ? fallbackTierFromProb(
                      firstHalfPick.displayPick || firstHalfPick.pick,
                      firstHalfPick.probability
                    )
                  : undefined;

                // Detect când mai multe pieţe sunt "toss" — afişăm un hint general.
                const tossCount = [oneXtwoInfo, ggInfo, over25Info, fhInfo].filter(
                  (i) => i?.tier === "toss"
                ).length;

                const oneXtwoOutcome = hasFinalScore
                  ? evaluateScoreDerivedPick(oneXtwoPick, match.score)
                  : null;
                const ggOutcome = hasFinalScore
                  ? evaluateScoreDerivedPick(match.predictions.gg, match.score)
                  : null;
                const over25Outcome = hasFinalScore
                  ? evaluateScoreDerivedPick(match.predictions.over25, match.score)
                  : null;

                return (
                  <>
                    {tossCount > 0 && (
                      <div className="mb-3 rounded-lg border border-[var(--fp-warning)]/25 bg-[var(--fp-warning)]/5 px-3 py-2 text-[10px] leading-snug text-[var(--fp-warning)]">
                        {tr("match.tossWarn", { n: tossCount })}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <MarketPickCard
                        label={tr("match.market1x2")}
                        info={oneXtwoInfo}
                        outcome={oneXtwoOutcome}
                      />
                      <MarketPickCard
                        label={tr("match.marketGgNgg")}
                        info={ggInfo}
                        outcome={ggOutcome}
                      />
                      <MarketPickCard
                        label={tr("match.marketOu25")}
                        info={over25Info}
                        outcome={over25Outcome}
                      />
                      <MarketPickCard
                        label={tr("match.marketFhGoals")}
                        info={fhInfo}
                        outcome={firstHalfVerdict}
                      />
                      {match.predictions.cards && (
                        <div className="col-span-2 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 text-center">
                          <div className="text-[10px] font-semibold uppercase text-[var(--fp-text-muted)]">{tr("match.cards")}</div>
                          <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.cards}</div>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </section>
          </div>

          {/* Previously un-gated: these market panels rendered in every tab, which is
              what made every section feel equally heavy. They belong to Markets. */}
          <div className={`grid grid-cols-1 gap-2 xl:grid-cols-3 xl:gap-3 ${tab(["markets"])}`}>
            <CollapsiblePanel compact title={tr("panels.model1x2")}>
              <ProbBar label={tr("panels.homeWin")} val={match.probs.p1} color={homeColor} />
              <ProbBar label={tr("panels.draw")} val={match.probs.pX} color="#475569" />
              <ProbBar label={tr("panels.awayWin")} val={match.probs.p2} color={awayColor} />
            </CollapsiblePanel>
            <CollapsiblePanel
              compact
              title={tr("panels.doubleChance")}
              subtitle={tr("match.dcSubtitle")}
            >
              <ProbBar label={tr("match.dc1x")} val={ext.pDC1X} color={homeColor} />
              <ProbBar label={tr("match.dc12")} val={ext.pDC12} color="#6d28d9" />
              <ProbBar label={tr("match.dcx2")} val={ext.pDCX2} color={awayColor} />
            </CollapsiblePanel>
            <CollapsiblePanel compact title={tr("panels.goalsMarkets")}>
              <ProbBar label={tr("match.over15")} val={match.probs.pO15} color="#0e7490" />
              <ProbBar label={tr("match.under15")} val={ext.pU15} color="#334155" />
              <ProbBar label={tr("match.over25")} val={match.probs.pO25} color="#0369a1" />
              <ProbBar label={tr("match.under25")} val={ext.pU25} color="#1d4ed8" />
              <ProbBar label={tr("match.over35")} val={clamp100(100 - match.probs.pU35)} color="#0f766e" />
              <ProbBar label={tr("match.under35")} val={match.probs.pU35} color="#15803d" />
              <ProbBar label={tr("match.bttsYes")} val={match.probs.pGG} color="#92400e" />
              <ProbBar label={tr("match.bttsNo")} val={ext.pNGG} color="#475569" />
            </CollapsiblePanel>
          </div>

          {/* === PRIMA REPRIZĂ — derivată din distribuţia goluri pe minute (/teams/statistics) === */}
          {match.probs.firstHalf && (
            <CollapsiblePanel
              compact
              title={tr("panels.firstHalf")}
              subtitle={tr("match.htSubtitle")}
              className={tab(["markets"])}
            >
              {match.modelMeta?.firstHalf && (
                <div className="mb-3 text-right font-mono text-[10px] text-[var(--fp-text-muted)] tabular-nums">
                  <div>
                    λ FH · {match.modelMeta.firstHalf.lambdaHome.toFixed(2)} vs{" "}
                    {match.modelMeta.firstHalf.lambdaAway.toFixed(2)}
                  </div>
                  <div className="text-[9px] text-[var(--fp-text-muted)]">
                    scale · {(match.modelMeta.firstHalf.scaleHome * 100).toFixed(0)}% /{" "}
                    {(match.modelMeta.firstHalf.scaleAway * 100).toFixed(0)}%
                    {match.modelMeta.firstHalf.baselineUsed ? " · baseline" : ""}
                  </div>
                </div>
              )}
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <div className="mb-3 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                    {tr("match.htResult")}
                  </div>
                  <ProbBar label={tr("match.htHomeLead")} val={match.probs.firstHalf.p1} color={homeColor} />
                  <ProbBar label={tr("match.htDraw")} val={match.probs.firstHalf.pX} color="#475569" />
                  <ProbBar label={tr("match.htAwayLead")} val={match.probs.firstHalf.p2} color={awayColor} />
                </div>
                <div>
                  <div className="mb-3 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                    {tr("match.htGoals")}
                  </div>
                  <ProbBar label={tr("match.htOver05")} val={match.probs.firstHalf.pO05} color="#0e7490" />
                  <ProbBar label={tr("match.htOver15")} val={match.probs.firstHalf.pO15} color="#0369a1" />
                  <ProbBar label={tr("match.htOver25")} val={match.probs.firstHalf.pO25} color="#1d4ed8" />
                  <ProbBar label={tr("match.htBtts")} val={match.probs.firstHalf.pGG} color="#92400e" />
                </div>
              </div>
              {match.probs.firstHalf.bestScore && match.probs.firstHalf.bestScoreProb > 0 ? (
                <div className="mt-4 rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text-muted)]">
                  <span className="text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.htBestScore")}</span>
                  <span className="ml-2 text-[var(--fp-warning)] tabular-nums">
                    {match.probs.firstHalf.bestScore} · {match.probs.firstHalf.bestScoreProb.toFixed(0)}%
                  </span>
                </div>
              ) : null}
              {firstHalfPick && (
                <div className="mt-3 border-t border-[var(--fp-border)] pt-2">
                  {marketResultBadge(
                    firstHalfPick.displayPick || firstHalfPick.pick,
                    firstHalfPick.probability,
                    firstHalfVerdict,
                    matchingMarketOdd(
                      match.marketOdds?.firstHalfGoals,
                      firstHalfPick.side,
                      firstHalfPick.line
                    ) ?? match.marketOdds?.firstHalfGoals?.odd,
                    match.marketOdds?.firstHalfGoals?.bookmaker,
                    "ht",
                    tr("card.noBookOdd")
                  )}
                  {htGoalsActual != null && (
                    <span className="ml-2 font-mono text-[9px] text-[var(--fp-text-muted)]">
                      {tr("match.htGoalsLabel", { n: htGoalsActual })}
                    </span>
                  )}
                </div>
              )}
            </CollapsiblePanel>
          )}
          {!match.probs.firstHalf && !hasExactConfidence && (
            <CollapsiblePanel
              compact
              title={tr("match.htLockedTitle")}
              badge={<span className="text-[10px] font-bold text-[var(--fp-warning)]">🔒</span>}
              className={tab(["markets"])}
            >
              <p className="text-sm text-[var(--fp-text-muted)]">
                {isPremiumLike ? tr("match.htLockedUltra") : tr("match.htLocked")}
              </p>
            </CollapsiblePanel>
          )}

          {/* === CORNERE + ŞUTURI LA POARTĂ + CARTONAŞE (Poisson pe rolling stats) === */}
          {(match.probs.corners || match.probs.shotsOnTarget || match.probs.shotsTotal || match.probs.cards) && (
            <div className={`space-y-2 ${tab(["markets"])}`}>
              {match.probs.corners && (
                <CollapsiblePanel compact title={tr("match.featCorners")} subtitle={tr("match.cornersSub")}>
                  <PoissonMarketSection
                    title={tr("match.featCorners")}
                    subtitle={tr("match.cornersSub")}
                    accent="var(--fp-accent)"
                    icon="⚑"
                    data={match.probs.corners}
                    homeLabel={match.teams.home}
                    awayLabel={match.teams.away}
                    actualTotal={xgData?.marketResults?.cornersTotal ?? null}
                    quotedOdd={match.marketOdds?.corners?.odd ?? null}
                    quoteSource={match.marketOdds?.corners?.bookmaker ?? null}
                    badgeTone="corners"
                    framed={false}
                  />
                </CollapsiblePanel>
              )}
              {match.probs.shotsOnTarget && (
                <CollapsiblePanel compact title={tr("match.featShots")} subtitle={tr("match.shotsSub")}>
                  <PoissonMarketSection
                    title={tr("match.featShots")}
                    subtitle={tr("match.shotsSub")}
                    accent="var(--fp-accent)"
                    icon="◎"
                    data={match.probs.shotsOnTarget}
                    homeLabel={match.teams.home}
                    awayLabel={match.teams.away}
                    actualTotal={
                      xgData?.marketResults?.shotsOnTargetTotal ??
                      match.marketResults?.shotsOnTargetTotal ??
                      null
                    }
                    quotedOdd={(() => {
                      const pick = deriveAlignedOuPick(
                        match.probs.shotsOnTarget.total,
                        match.marketOdds?.shotsOnTarget
                      );
                      if (!pick) {
                        return Number(match.marketOdds?.shotsOnTarget?.odd) > 1
                          ? Number(match.marketOdds?.shotsOnTarget?.odd)
                          : Number(match.marketOdds?.shotsTotal?.odd) > 1
                            ? Number(match.marketOdds?.shotsTotal?.odd)
                            : null;
                      }
                      return shotsDisplayOdd(match, pick.side, pick.line);
                    })()}
                    quoteSource={
                      match.marketOdds?.shotsOnTarget?.bookmaker ||
                      match.marketOdds?.shotsTotal?.bookmaker ||
                      null
                    }
                    badgeTone="shots"
                    framed={false}
                  />
                </CollapsiblePanel>
              )}
              {match.probs.shotsTotal && (
                <CollapsiblePanel compact title={tr("match.shotsTotalTitle")} subtitle={tr("match.shotsTotalSub")}>
                  <PoissonMarketSection
                    title={tr("match.shotsTotalTitle")}
                    subtitle={tr("match.shotsTotalSub")}
                    accent="var(--fp-warning)"
                    icon="⌖"
                    data={match.probs.shotsTotal}
                    homeLabel={match.teams.home}
                    awayLabel={match.teams.away}
                    actualTotal={xgData?.marketResults?.shotsTotal ?? null}
                    quotedOdd={(() => {
                      const pick = deriveAlignedOuPick(
                        match.probs.shotsTotal.total,
                        match.marketOdds?.shotsTotal
                      );
                      if (!pick) {
                        return Number(match.marketOdds?.shotsTotal?.odd) > 1
                          ? Number(match.marketOdds?.shotsTotal?.odd)
                          : null;
                      }
                      return matchingMarketOdd(match.marketOdds?.shotsTotal, pick.side, pick.line, 4);
                    })()}
                    quoteSource={match.marketOdds?.shotsTotal?.bookmaker ?? null}
                    badgeTone="shots"
                    framed={false}
                  />
                </CollapsiblePanel>
              )}
              {match.probs.cards && (
                <CollapsiblePanel compact title={tr("match.featCards")} subtitle={tr("match.cardsSub")}>
                  <PoissonMarketSection
                    title={tr("match.featCards")}
                    subtitle={tr("match.cardsSub")}
                    accent="var(--fp-warning)"
                    icon="▢"
                    data={match.probs.cards}
                    homeLabel={match.teams.home}
                    awayLabel={match.teams.away}
                    actualTotal={null}
                    quotedOdd={match.marketOdds?.cards?.odd ?? null}
                    quoteSource={match.marketOdds?.cards?.bookmaker ?? null}
                    badgeTone="shots"
                    framed={false}
                  />
                </CollapsiblePanel>
              )}
            </div>
          )}
          {showTierUpgradeLocks &&
            !match.probs.shotsOnTarget &&
            !match.probs.shotsTotal &&
            !hasExactConfidence && (
            <CollapsiblePanel
              compact
              title={tr("match.lockedMarkets")}
              badge={<span className="text-[10px] font-bold text-[var(--fp-warning)]">🔒</span>}
              className={tab(["markets"])}
            >
              <p className="text-sm font-medium text-[var(--fp-text)]">
                {effectiveAccessTier === "free" || isFreeLike ? tr("match.lockedFree") : tr("match.lockedPremium")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(effectiveAccessTier === "free" || isFreeLike
                  ? [
                      { label: tr("match.featCorners"), tier: "premium" as const },
                      { label: tr("match.featShots"), tier: "ultra" as const },
                      { label: tr("match.featEdge"), tier: "ultra" as const }
                    ]
                  : [
                      { label: tr("match.featShots"), tier: "ultra" as const },
                      { label: tr("match.featEdge"), tier: "ultra" as const }
                    ]
                ).map(({ label, tier }) => (
                  <button
                    key={label}
                    type="button"
                    title={tr("match.upgradeTo", { label, tier })}
                    onClick={() => onUpgradeRequired?.(label, tier)}
                    className="inline-flex h-9 items-center rounded-md border border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 px-2.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text)] hover:bg-[var(--fp-warning)]/20"
                  >
                    🔒 {label}
                  </button>
                ))}
              </div>
            </CollapsiblePanel>
          )}

          {match.modelMeta &&
            (match.modelMeta.method ||
              match.modelMeta.reasonCodes?.length ||
              match.modelMeta.stakeBucket ||
              match.evaluation) && (
              <details className={`group rounded-2xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-4 sm:p-5 ${tab(["advanced"])}`}>
                <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fp-accent)]/90 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    {tr("match.modelAudit")}
                    <span className="text-[var(--fp-text-muted)] transition group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="mt-4 space-y-4 border-t border-[var(--fp-border)] pt-4 text-[11px] text-[var(--fp-text-muted)]">
                  {/* === Pipeline summary: indicator clar pentru ce strat e activ === */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.pipeline")}</span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-0.5 font-mono text-[9px] text-[var(--fp-text-muted)]">
                      Poisson+DC
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[9px] ${match.modelMeta.calibrationApplied ? "border-[var(--fp-accent)]/45 bg-[var(--fp-accent)]/10 text-[var(--fp-accent)]" : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]/60"}`}>
                      Isotonic {match.modelMeta.calibrationApplied ? "✓" : "—"}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[9px] ${match.modelMeta.stackerApplied ? "border-[var(--fp-success)]/45 bg-[var(--fp-success)]/10 text-[var(--fp-success)]" : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]/60"}`}>
                      ML stacker {match.modelMeta.stackerApplied ? "✓" : "—"}
                    </span>
                    {match.modelMeta.elo ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/8 px-2 py-0.5 font-mono text-[9px] text-[var(--fp-warning)]">
                        Elo Δ {match.modelMeta.elo.spread > 0 ? "+" : ""}{Math.round(match.modelMeta.elo.spread)}
                      </span>
                    ) : null}
                  </div>

                  {/* === Probabilităţile la fiecare strat (doar dacă avem raw) === */}
                  {match.evaluation?.rawPoissonProbs1x2Pct && (
                    <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3">
                      <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-accent)]/80">{tr("match.probsPipeline")}</div>
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-left font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                            <th className="py-1">Stage</th>
                            <th className="py-1 text-right">1</th>
                            <th className="py-1 text-right">X</th>
                            <th className="py-1 text-right">2</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono text-[var(--fp-text-muted)] tabular-nums">
                          <tr className="border-t border-[var(--fp-border)]">
                            <td className="py-1">Raw Poisson</td>
                            <td className="py-1 text-right">{match.evaluation.rawPoissonProbs1x2Pct.p1.toFixed(1)}%</td>
                            <td className="py-1 text-right">{match.evaluation.rawPoissonProbs1x2Pct.pX.toFixed(1)}%</td>
                            <td className="py-1 text-right">{match.evaluation.rawPoissonProbs1x2Pct.p2.toFixed(1)}%</td>
                          </tr>
                          {match.evaluation.calibratedProbs1x2Pct && (
                            <tr className="border-t border-[var(--fp-border)] text-[var(--fp-accent)]">
                              <td className="py-1">+ Isotonic</td>
                              <td className="py-1 text-right">{match.evaluation.calibratedProbs1x2Pct.p1.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.calibratedProbs1x2Pct.pX.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.calibratedProbs1x2Pct.p2.toFixed(1)}%</td>
                            </tr>
                          )}
                          {match.evaluation.stackerProbs1x2Pct && (
                            <tr className="border-t border-[var(--fp-border)] text-[var(--fp-success)]">
                              <td className="py-1">+ ML stacker</td>
                              <td className="py-1 text-right">{match.evaluation.stackerProbs1x2Pct.p1.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.stackerProbs1x2Pct.pX.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.stackerProbs1x2Pct.p2.toFixed(1)}%</td>
                            </tr>
                          )}
                          {match.evaluation.modelProbs1x2Pct && (
                            <tr className="border-t border-[var(--fp-border)] font-semibold text-[var(--fp-text)]">
                              <td className="py-1">Final (displayed)</td>
                              <td className="py-1 text-right">{match.evaluation.modelProbs1x2Pct.p1.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.modelProbs1x2Pct.pX.toFixed(1)}%</td>
                              <td className="py-1 text-right">{match.evaluation.modelProbs1x2Pct.p2.toFixed(1)}%</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* === Top pick rationale (lift vs baseline + alternative) === */}
                  {(match.modelMeta.topPickLift != null ||
                    (match.modelMeta.topPickAlternates && match.modelMeta.topPickAlternates.length > 0)) && (
                    <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 font-mono text-[10px] text-[var(--fp-text-muted)]">
                      <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wider">
                        <span className="text-[var(--fp-accent)]/80">{tr("match.whyThisPick")}</span>
                        {match.modelMeta.topPickLift != null && (
                          <span
                            className={
                              match.modelMeta.topPickLift >= 10
                                ? "text-[var(--fp-success)]"
                                : match.modelMeta.topPickLift >= 3
                                  ? "text-[var(--fp-accent)]"
                                  : "text-[var(--fp-warning)]"
                            }
                            title="Cât de mult probabilitatea pick-ului depăşeşte baseline-ul tipic al pieţei. ≥10pp = edge puternic, 3-10pp = moderat, <3pp = pick banal-sigur."
                          >
                            lift {match.modelMeta.topPickLift >= 0 ? "+" : ""}
                            {match.modelMeta.topPickLift.toFixed(1)}pp
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] leading-relaxed text-[var(--fp-text-muted)]">
                        Pick-ul e ales după scor <span className="text-[var(--fp-text-muted)]">prob × (1 + lift/60)</span> —
                        premiază pieţele unde modelul vede clar peste medie, nu doar cea mai mare probabilitate brută.
                      </p>
                      {match.modelMeta.topPickAlternates && match.modelMeta.topPickAlternates.length > 0 && (
                        <div className="mt-2 border-t border-[var(--fp-border)] pt-2">
                          <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                            Alternative considerate
                          </div>
                          <ul className="space-y-0.5 tabular-nums">
                            {match.modelMeta.topPickAlternates.map((alt) => (
                              <li key={alt.pick} className="flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-[var(--fp-text-muted)]">{alt.pick}</span>
                                <span className="text-[var(--fp-text-muted)]">
                                  {alt.prob.toFixed(1)}% · lift {alt.lift >= 0 ? "+" : ""}
                                  {alt.lift.toFixed(1)}pp
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* === League profile + derived params === */}
                  {(match.leagueProfile || match.modelMeta.leagueParams) && (
                    <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 font-mono text-[10px] text-[var(--fp-text-muted)]">
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--fp-accent)]/80">
                        League profile
                        {match.leagueProfile?.name ? ` · ${match.leagueProfile.name}` : ""}
                        {match.leagueProfile?.fromCatalog === false ? " · default" : ""}
                      </div>
                      {match.leagueProfile?.rates && (
                        <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums sm:grid-cols-4">
                          {match.leagueProfile.rates.goalFrequency != null && (
                            <span>goals {match.leagueProfile.rates.goalFrequency.toFixed(2)}</span>
                          )}
                          {match.leagueProfile.rates.drawFrequency != null && (
                            <span>draw {(match.leagueProfile.rates.drawFrequency * 100).toFixed(0)}%</span>
                          )}
                          {match.leagueProfile.rates.bttsRate != null && (
                            <span>BTTS {(match.leagueProfile.rates.bttsRate * 100).toFixed(0)}%</span>
                          )}
                          {match.leagueProfile.rates.overFrequency != null && (
                            <span>O2.5 {(match.leagueProfile.rates.overFrequency * 100).toFixed(0)}%</span>
                          )}
                          {match.leagueProfile.rates.homeAdvantage != null && (
                            <span>home {match.leagueProfile.rates.homeAdvantage.toFixed(2)}×</span>
                          )}
                          {match.leagueProfile.rates.corners != null && (
                            <span>corners {match.leagueProfile.rates.corners.toFixed(1)}</span>
                          )}
                          {match.leagueProfile.rates.cards != null && (
                            <span>cards {match.leagueProfile.rates.cards.toFixed(1)}</span>
                          )}
                          {match.leagueProfile.rates.possessionTendency != null && (
                            <span>poss {(match.leagueProfile.rates.possessionTendency * 100).toFixed(0)}%</span>
                          )}
                        </div>
                      )}
                      {match.modelMeta.leagueParams && (
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-[var(--fp-text-muted)]/80 sm:grid-cols-4">
                          {match.modelMeta.leagueParams.leagueAvg != null && (
                            <span>λ̄ {match.modelMeta.leagueParams.leagueAvg.toFixed(2)}</span>
                          )}
                          {match.modelMeta.leagueParams.rho != null && (
                            <span>DC ρ {match.modelMeta.leagueParams.rho.toFixed(3)}</span>
                          )}
                          {match.modelMeta.leagueParams.blendWeight != null && (
                            <span>blend {Math.round(match.modelMeta.leagueParams.blendWeight * 100)}%</span>
                          )}
                          {match.modelMeta.leagueParams.profileKey != null && (
                            <span>key {match.modelMeta.leagueParams.profileKey}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* === Shin info (market) === */}
                  {match.odds?.marginMethod && (
                    <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 font-mono text-[10px] text-[var(--fp-text-muted)]">
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--fp-accent)]/80">{tr("match.marketDebiasing")}</div>
                      <div className="flex flex-wrap gap-x-3 tabular-nums">
                        <span>method · {match.odds.marginMethod}</span>
                        {match.odds.shinZ != null && <span>z · {match.odds.shinZ.toFixed(4)}</span>}
                        {match.odds.bookmakersUsed != null && <span>bookies · {match.odds.bookmakersUsed}</span>}
                      </div>
                    </div>
                  )}

                  {/* === Strength ratings (atk/def shrinkage) === */}
                  {match.modelMeta.strengthMeta && (
                    <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 font-mono text-[10px] text-[var(--fp-text-muted)]">
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--fp-accent)]/80">{tr("match.strengthRatings")}</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums sm:grid-cols-4">
                        {match.modelMeta.strengthMeta.atkH != null && <span>atk H {match.modelMeta.strengthMeta.atkH.toFixed(2)}</span>}
                        {match.modelMeta.strengthMeta.defH != null && <span>def H {match.modelMeta.strengthMeta.defH.toFixed(2)}</span>}
                        {match.modelMeta.strengthMeta.atkA != null && <span>atk A {match.modelMeta.strengthMeta.atkA.toFixed(2)}</span>}
                        {match.modelMeta.strengthMeta.defA != null && <span>def A {match.modelMeta.strengthMeta.defA.toFixed(2)}</span>}
                        {match.modelMeta.strengthMeta.homePlayed != null && <span>n H {match.modelMeta.strengthMeta.homePlayed}</span>}
                        {match.modelMeta.strengthMeta.awayPlayed != null && <span>n A {match.modelMeta.strengthMeta.awayPlayed}</span>}
                        {match.modelMeta.strengthMeta.shrinkageK != null && <span>k {match.modelMeta.strengthMeta.shrinkageK}</span>}
                      </div>
                    </div>
                  )}

                  {/* === Elo details === */}
                  {match.modelMeta.elo && (
                    <div className={`rounded-lg border p-3 font-mono text-[10px] tabular-nums ${match.modelMeta.elo.thin ? "border-[var(--fp-warning)]/25 bg-[var(--fp-warning)]/8 text-[var(--fp-warning)]" : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"}`}>
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--fp-accent)]/80">
                        Elo {match.modelMeta.elo.thin ? "· thin sample" : ""}
                      </div>
                      <div className="flex flex-wrap gap-x-3">
                        <span>H {Math.round(match.modelMeta.elo.home)}</span>
                        <span>A {Math.round(match.modelMeta.elo.away)}</span>
                        <span>Δ {match.modelMeta.elo.spread > 0 ? "+" : ""}{Math.round(match.modelMeta.elo.spread)}</span>
                      </div>
                    </div>
                  )}

                  {match.modelMeta.method && (
                    <p>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Method</span> · {match.modelMeta.method}
                    </p>
                  )}
                  {match.modelMeta.probsModel && (
                    <p>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">Probs</span> · {match.modelMeta.probsModel}
                    </p>
                  )}
                  {match.modelMeta.stakeBucket != null && (
                    <p className="font-mono tabular-nums">
                      Stake bucket · {match.modelMeta.stakeBucket}
                      {match.modelMeta.stakeCap != null ? ` · cap ${match.modelMeta.stakeCap}` : ""}
                    </p>
                  )}
                  {Array.isArray(match.modelMeta.reasonCodes) && match.modelMeta.reasonCodes.length > 0 && (
                    <div>
                      <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.reasonCodes")}</div>
                      <ul className="list-inside list-disc space-y-0.5 font-mono text-[10px] text-[var(--fp-text-muted)]">
                        {match.modelMeta.reasonCodes.map((code) => (
                          <li key={code}>{code}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {match.evaluation && (
                    <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 font-mono text-[10px] text-[var(--fp-text-muted)]">
                      {match.evaluation.recommendedTrack && <div>Track · {match.evaluation.recommendedTrack}</div>}
                      {match.evaluation.marketBlendWeight != null && (
                        <div>Market blend · {(match.evaluation.marketBlendWeight * 100).toFixed(0)}%</div>
                      )}
                      <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                        v {match.evaluation.modelVersion || match.modelVersion || "?"}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}
        </div>
      </div>
    </div>
  );
}
