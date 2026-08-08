

import CollapsiblePanel from "../design-system/CollapsiblePanel";
import MatchMomentumStickyStrip from "./ux/MatchMomentumStickyStrip";

import { PredictionRow } from "../types";

import { outcomeTextClass, specialBetLiveAdjustmentBadge } from "../utils/specialBet";

import MatchDecisionBlock from "./matchModal/MatchDecisionBlock";
import { finalScoreBadgeClass, finalScoreLabel } from "./matchModal/helpers";
import TeamSnapshotCard from "./matchModal/TeamSnapshotCard";
import LeagueStandingsTable from "./matchModal/LeagueStandingsTable";
import { ProbBar } from "./matchModal/ProbBar";
import { useMatchModalModel } from "./matchModal/useMatchModalModel";
import OverviewHero from "./matchModal/OverviewHero";
import AnalysisPanels from "./matchModal/AnalysisPanels";
import DerivedMarketsPanels from "./matchModal/DerivedMarketsPanels";

export type MatchModalProps = {
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

export type DetailTabId = (typeof DETAIL_TABS)[number]["id"];

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
  const model = useMatchModalModel({ match, accessTier, presentation, onClose, hashColor, logoColors });
  const {
    awayColor, clamp100, closeBtnRef, confPct, confidenceCategory, correctScoreCandidates,
    decisionBenchmark, decisionEvPct, decisionRationale, detailTab, dq, edgeScore,
    effectiveAccessTier, ext, finalPickResult, firstHalfPick, firstHalfVerdict,
    hasExactConfidence, hasFinalScore, hasLiveScore, hasNumericScore, homeColor, htGoalsActual,
    isFocus, isFreeLike, isPremiumLike, kickoffDate, modalRef, recommendedLabel,
    recommendedOdd, setDetailTab, setSpecialLegCount, showStandingsBlock, showTierUpgradeLocks,
    specialBetCandidatesLen, specialBetCombinedOdd, specialBetLegs, specialCombinedOutcome,
    specialCombinedTone, specialLegCount, standingsRows, tab, tr, xgData
  } = model;

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
          <OverviewHero
            match={match} tr={tr} tab={tab} detailTab={detailTab}
            homeColor={homeColor} awayColor={awayColor}
            hasLiveScore={hasLiveScore} hasExactConfidence={hasExactConfidence}
            isFreeLike={isFreeLike} isPremiumLike={isPremiumLike}
            confPct={confPct} confidenceCategory={confidenceCategory}
            dq={dq} edgeScore={edgeScore}
            recommendedLabel={recommendedLabel} outcomeTextClass={outcomeTextClass}
            showStandingsBlock={showStandingsBlock} standingsRows={standingsRows}
            canShowSpecialBet={canShowSpecialBet} onUpgradeRequired={onUpgradeRequired}
            specialLegCount={specialLegCount} setSpecialLegCount={setSpecialLegCount}
            specialBetLegs={specialBetLegs} specialBetCandidatesLen={specialBetCandidatesLen}
            specialBetCombinedOdd={specialBetCombinedOdd} specialCombinedOutcome={specialCombinedOutcome}
            specialCombinedTone={specialCombinedTone} specialBetLiveAdjustmentBadge={specialBetLiveAdjustmentBadge}
          />

          <AnalysisPanels
            match={match} tr={tr} tab={tab}
            homeColor={homeColor} awayColor={awayColor}
            xgData={xgData} hasFinalScore={hasFinalScore}
            recommendedLabel={recommendedLabel}
            firstHalfPick={firstHalfPick} firstHalfVerdict={firstHalfVerdict}
            correctScoreCandidates={correctScoreCandidates}
          />
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

          <DerivedMarketsPanels
            match={match} tr={tr} tab={tab}
            homeColor={homeColor} awayColor={awayColor}
            xgData={xgData} hasExactConfidence={hasExactConfidence}
            isPremiumLike={isPremiumLike}
            firstHalfPick={firstHalfPick} firstHalfVerdict={firstHalfVerdict}
            htGoalsActual={htGoalsActual}
          />
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
