

import { useState } from "react";

import CollapsiblePanel from "../design-system/CollapsiblePanel";
import IconButton from "../design-system/IconButton";
import Overlay from "../design-system/Overlay";

import { PredictionRow } from "../types";

import { outcomeTextClass, specialBetLiveAdjustmentBadge } from "../utils/specialBet";

import MatchDecisionBlock from "./matchModal/MatchDecisionBlock";
import TeamSnapshotCard from "./matchModal/TeamSnapshotCard";
import LeagueStandingsTable from "./matchModal/LeagueStandingsTable";
import { ProbBar } from "./matchModal/ProbBar";
import { useMatchModalModel } from "./matchModal/useMatchModalModel";
import OverviewHero from "./matchModal/OverviewHero";
import AnalysisPanels from "./matchModal/AnalysisPanels";
import DerivedMarketsPanels from "./matchModal/DerivedMarketsPanels";
import WhyThisPickPanel from "./matchModal/WhyThisPickPanel";
import XgCard from "./matchModal/XgCard";
import LiveLayer from "./matchModal/LiveLayer";
import { partsGate, type DetailPart } from "./matchModal/detailParts";
import { formatLiveMinute } from "./matchCard/derivations";
import { isFixtureInPlay } from "../utils/appUtils";

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
  /** Opens the prediction report dialog. Moved here from the list card in UX-A: the list row carries no secondary actions. */
  onReport?: () => void;
  /**
   * UX-I. Favourite state + toggle for THIS match - the same handler the list
   * row's star calls. On narrow screens the star lives in the recommendation
   * card (the row hides it there); from `sm` the row keeps its own.
   */
  watched?: boolean;
  onToggleWatch?: () => void;
  /** Account › Model internals. When false the Advanced tab (λ, ρ, Shin z, pipeline, version) is not offered. */
  showModelInternals?: boolean;
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
export type { DetailPart };

/** Stable id so the Why trigger's aria-controls always resolves to its region. */
const WHY_PANEL_ID = "detail-why-panel";

export default function MatchModal({
  match,
  logoColors,
  onClose,
  hashColor,
  canShowSpecialBet = false,
  accessTier = "free",
  presentation = "focus",
  onUpgradeRequired,
  onReport,
  watched = false,
  onToggleWatch,
  showModelInternals = false
}: MatchModalProps) {
  const model = useMatchModalModel({ match, accessTier, presentation, hashColor, logoColors });
  const {
    awayColor, clamp100, closeBtnRef, confPct, confidenceCategory, correctScoreCandidates,
    decisionBenchmark, decisionEvPct, decisionRationale, dq, edgeScore,
    effectiveAccessTier, ext, finalPickResult, firstHalfPick, firstHalfVerdict,
    hasExactConfidence, hasFinalScore, hasLiveScore, hasNumericScore, homeColor, htGoalsActual,
    isFocus, isFreeLike, isPremiumLike, kickoffDate, modalRef, recommendedLabel,
    recommendedOdd, setSpecialLegCount, showStandingsBlock, showTierUpgradeLocks,
    specialBetCandidatesLen, specialBetCombinedOdd, specialBetLegs, specialCombinedOutcome,
    specialCombinedTone, specialLegCount, standingsRows, tr, xgData
  } = model;

  /*
    WHY THIS PICK is closed on open. The card must answer "what is the bet" at a
    glance; the reasoning is one deliberate click away, the same depth-on-demand the
    tiers inside it already use. Declared above the insufficientData early return so
    hook order never depends on the data.
  */
  const [whyOpen, setWhyOpen] = useState(false);

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
        <Overlay
          open
          onClose={onClose}
          presentation="center"
          closeOnBackdrop
          zClassName="z-[var(--fp-z-overlay)]"
          aria-label={tr("match.insufficientTitle")}
          initialFocusRef={closeBtnRef}
          backdropClassName="bg-fp-navy/85 backdrop-blur-md"
          panelClassName="w-full max-w-md rounded-[var(--fp-radius)] border border-fp-warning/25 bg-fp-bg-card/90 p-8 text-center shadow-fp-lg backdrop-blur-xl"
        >
          <p className="font-display text-lg font-semibold text-[var(--fp-text)]">{tr("match.insufficientTitle")}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--fp-text-muted)]">{match.insufficientReason}</p>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="mt-6 min-h-[var(--fp-touch)] rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--fp-accent)] hover:bg-[var(--fp-border)] hover:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-accent/45"
          >
            {tr("match.close")}
          </button>
        </Overlay>
      );
    }

    return (
      <Overlay
        open
        onClose={onClose}
        presentation="center"
        closeOnBackdrop
        zClassName="z-[var(--fp-z-overlay)]"
        aria-labelledby="match-modal-insufficient-title"
        aria-describedby="match-modal-insufficient-desc"
        initialFocusRef={closeBtnRef}
        backdropClassName="bg-fp-navy/88 backdrop-blur-md"
        panelClassName="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--fp-radius)] border border-fp-warning/25 bg-fp-bg-card/95 p-5 shadow-fp-lg backdrop-blur-xl sm:max-w-2xl sm:p-8"
      >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p id="match-modal-insufficient-title" className="font-display text-lg font-semibold text-[var(--fp-text)]">{tr("match.insufficientTitle")}</p>
              <p id="match-modal-insufficient-desc" className="mt-1 text-[11px] text-[var(--fp-text-muted)]">{match.insufficientReason}</p>
            </div>
            <IconButton ref={closeBtnRef} shape="round" onClick={onClose} aria-label={tr("match.close")} className="shrink-0 !text-sm">
              ✕
            </IconButton>
          </div>
          <p className="mt-4 text-center font-display text-base font-semibold text-[var(--fp-text)]">
            {match.teams.home} <span className="text-[var(--fp-text-muted)]">vs</span> {match.teams.away}
          </p>
          <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-wide text-fp-accent/70">{match.league}</p>

          {(ctx?.home || ctx?.away) && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <TeamSnapshotCard title={tr("match.home")} snap={ctx?.home} accent={homeColor} />
              <TeamSnapshotCard title={tr("match.away")} snap={ctx?.away} accent={awayColor} />
            </div>
          )}

          {table && table.length > 0 ? (
            <div className="mt-6">
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fp-accent/80">{tr("match.standings")}</h3>
              <LeagueStandingsTable rows={table} highlightHomeId={hid} highlightAwayId={aid} />
            </div>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="mt-8 w-full rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] py-2.5 text-sm font-semibold text-[var(--fp-accent)] hover:bg-[var(--fp-border)] hover:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-accent/45"
          >
            {tr("match.close")}
          </button>
      </Overlay>
    );
  }

  const isInPlay = isFixtureInPlay(match.status);
  const liveMinute = formatLiveMinute(match.score?.minute, match.score?.extra);
  const kickoffTime = new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // In play with no score yet: "vs", never the kickoff time — the match has started.
  const centreLabel =
    hasNumericScore && (hasFinalScore || hasLiveScore)
      ? `${match.score?.home}–${match.score?.away}`
      : isInPlay
        ? tr("common.vs")
        : kickoffTime;
  // LIVE identity (label, colour, dot) is the in-play question; the score slot
  // is the score question. An NS fixture in the poll grace shows its score in
  // neutral colour with the date — it never claims to be live.
  const statusLabel = isInPlay
    ? (liveMinute ?? tr("card.live"))
    : hasFinalScore
      // Settlement token in the header slot: the one place the outcome is stated.
      ? finalPickResult === true
        ? `${tr("list.fullTimeShort")} · ${tr("history.win")}`
        : finalPickResult === false
          ? `${tr("list.fullTimeShort")} · ${tr("history.loss")}`
          : tr("list.fullTimeShort")
      : kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
  const whyFactors = (match.explanation?.reasons ?? [])
    .map((r) => (typeof r?.label === "string" ? r.label.trim() : ""))
    .filter((label) => label && label !== decisionRationale)
    .slice(0, 3);
  const hasTicket = canShowSpecialBet && hasExactConfidence && specialBetLegs.length >= 2;
  const specialBetPreview =
    hasTicket && specialBetCombinedOdd
      ? tr("detail.ticketPreview", { n: specialBetLegs.length, odd: specialBetCombinedOdd.toFixed(2) })
      : undefined;
  const refereeText = match.referee?.trim() || null;
  // C3: supporting context only (the Cards λ ignores the referee). Absent = nothing shown.
  const refereeCards =
    match.refereeCards &&
    Number.isFinite(Number(match.refereeCards.avgCards)) &&
    Number(match.refereeCards.sampleSize) > 0
      ? match.refereeCards
      : null;
  const hasConditions = Boolean(refereeText);
  const lockedFamilies: { label: string; tier: "premium" | "ultra" }[] =
    showTierUpgradeLocks && !match.probs.shotsOnTarget && !match.probs.shotsTotal && !hasExactConfidence
      ? effectiveAccessTier === "free" || isFreeLike
        ? [
            { label: tr("match.featCorners"), tier: "premium" },
            { label: tr("match.featShots"), tier: "ultra" },
            { label: tr("match.featEdge"), tier: "ultra" }
          ]
        : [
            { label: tr("match.featShots"), tier: "ultra" },
            { label: tr("match.featEdge"), tier: "ultra" }
          ]
      : [];
  const marketsBoundaryTier = lockedFamilies.length ? lockedFamilies[0].tier : null;

  return (
    <Overlay
      open
      onClose={onClose}
      presentation={isFocus ? "drawer" : "center"}
      closeOnBackdrop
      zClassName="z-[var(--fp-z-overlay)]"
      aria-labelledby="match-modal-title"
      aria-describedby="match-modal-desc"
      initialFocusRef={closeBtnRef}
      panelRef={modalRef}
      backdropClassName={isFocus ? "bg-fp-navy/30 backdrop-blur-[1px] lg:bg-transparent lg:backdrop-blur-0" : "bg-fp-navy/50 backdrop-blur-sm"}
      panelClassName={
        isFocus
          ? /* Mobile: bottom sheet. sm+: right drawer. lg+: a side panel at ~42% of the
               viewport so the list stays readable behind it (UX-C §18). */
            "fp-readable relative flex h-[min(92dvh,100%)] w-full max-w-xl flex-col overflow-y-auto rounded-t-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-fp-lg sm:h-full sm:max-w-2xl sm:rounded-none sm:rounded-l-[var(--fp-radius-lg)] lg:w-[42vw] lg:min-w-[30rem] lg:max-w-[42vw]"
          : "fp-readable relative max-h-[min(92dvh,100%)] w-full max-w-lg overflow-y-auto rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-fp-lg lg:max-w-5xl"
      }
    >
        {/* 1 · HEADER — orientation only: who, score-or-kickoff, status. ≤ 64 px. */}
        <header
          data-layer="header"
          className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-[var(--fp-border)] bg-fp-bg-card/95 px-3 backdrop-blur-md sm:h-16 sm:px-4"
        >
          <h2 id="match-modal-title" className="sr-only">
            {match.teams.home} {tr("common.vs")} {match.teams.away}
          </h2>
          <p id="match-modal-desc" className="sr-only">
            {statusLabel} · {centreLabel}
          </p>
          <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-x-1.5">
            <img src={match.logos?.home} alt="" className="h-6 w-6 shrink-0 object-contain" />
            <span className="truncate text-[13px] font-semibold text-[var(--fp-text)] sm:text-sm" data-slot="home">
              {match.teams.home}
            </span>
            <span className="flex flex-col items-center px-1 leading-none">
              <span
                data-slot="centre"
                className={`font-mono text-sm font-bold tabular-nums sm:text-base ${
                  isInPlay ? "text-[var(--fp-live)]" : "text-[var(--fp-text)]"
                }`}
              >
                {centreLabel}
              </span>
              <span
                data-slot="status"
                className={`mt-0.5 flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tabular-nums ${
                  isInPlay ? "text-[var(--fp-live)]" : "text-[var(--fp-text-muted)]"
                }`}
              >
                {isInPlay && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--fp-live)] motion-safe:animate-pulse" />}
                {statusLabel}
              </span>
            </span>
            <span className="truncate text-right text-[13px] font-semibold text-[var(--fp-text)] sm:text-sm" data-slot="away">
              {match.teams.away}
            </span>
            <img src={match.logos?.away} alt="" className="h-6 w-6 shrink-0 object-contain" />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onReport && (
              /* Narrow screens: the report flag sits in the recommendation card
                 (UX-I); the header keeps only Close. From `sm` it stays here. */
              <IconButton
                shape="round"
                onClick={onReport}
                title={tr("predictionReport.cardAction")}
                aria-label={tr("predictionReport.cardAction")}
                className="hidden sm:inline-flex"
                data-slot="header-report"
              >
                ⚑
              </IconButton>
            )}
            <IconButton ref={closeBtnRef} shape="round" onClick={onClose} title={tr("match.close")} aria-label={tr("match.close")}>
              ✕
            </IconButton>
          </div>
        </header>

        <div className="space-y-3 p-3 sm:space-y-4 sm:p-4">
          {/* 2 · DECISION — recommendation, confidence, odds, value: stated here and
              nowhere else. The rationale sentence moved to Why. */}
          <div data-layer="decision">
            <MatchDecisionBlock
              pickLabel={recommendedLabel.label}
              familyKey={recommendedLabel.familyKey}
              odd={recommendedOdd}
              confidencePct={hasExactConfidence ? confPct : null}
              confidenceCategory={confidenceCategory}
              evPct={decisionEvPct}
              dataQuality={dq}
              rationale={null}
              benchmark={decisionBenchmark}
              actions={{ watched, onToggleWatch, onReport }}
              /* WHY THIS PICK — the same three tiers, now owned by the card they
                 explain rather than competing with it as a sibling block. */
              why={{
                label: tr("detail.whyTitle"),
                panelId: WHY_PANEL_ID,
                open: whyOpen,
                onToggle: () => setWhyOpen((v) => !v),
                content: (
                  <WhyThisPickPanel tr={tr} summary={decisionRationale} factors={whyFactors}>
                    <AnalysisPanels
                      match={match} tr={tr} tab={partsGate(["explanation", "keyFactors", "whyPrediction", "confidence"])}
                      homeColor={homeColor} awayColor={awayColor}
                      xgData={xgData} hasFinalScore={hasFinalScore}
                      recommendedLabel={recommendedLabel}
                      firstHalfPick={firstHalfPick} firstHalfVerdict={firstHalfVerdict}
                      correctScoreCandidates={correctScoreCandidates}
                    />
                  </WhyThisPickPanel>
                )
              }}
            />
          </div>

          {/* 3 · xG — the model's shot-quality read, in the slot the explanation card
              used to hold. The card is not new: it is the existing `xg` part of
              AnalysisPanels (XGPerformanceBar + the two luck badges, fed by the same
              `xgData`), which until now was only reachable through Advanced and so was
              invisible to every default account. It renders HERE and nowhere else — the
              Advanced gate below no longer lists `xg`, so exactly one exists. */}
          <div data-layer="xg">
            <XgCard match={match} tr={tr} xgData={xgData} />
          </div>

          {/* 4 · LIVE — only while the existing live-state semantics say so. Compact
              strip by default; timeline and stats behind one disclosure. */}
          {/* The two existing live predicates, unchanged: the strip follows hasLiveScore,
              Momentum follows isFixtureInPlay (PR #139). The layer exists when either does. */}
          {(hasLiveScore || isInPlay) && (
            <LiveLayer
              match={match}
              tr={tr}
              hasLiveScore={hasLiveScore}
              recommendedPick={recommendedLabel.label}
              confidenceLabel={hasExactConfidence ? `${confPct}%` : confidenceCategory || tr("match.locked")}
            />
          )}

          {/* 5 · MARKETS — collapsed; families expand independently. The entitlement
              boundary is the section badge + one CTA, not a padlock per cell. */}
          <div data-layer="markets">
            <CollapsiblePanel
              compact
              title={tr("detail.marketsTitle")}
              subtitle={tr("detail.marketsSub")}
              badge={
                marketsBoundaryTier ? (
                  <span className="rounded-md border border-fp-warning/40 bg-fp-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--fp-warning)]">
                    {marketsBoundaryTier}
                  </span>
                ) : undefined
              }
            >
              <div className="space-y-2">
                <CollapsiblePanel compact title={tr("panels.model1x2")}>
                  <ProbBar label={tr("panels.homeWin")} val={match.probs.p1} color={homeColor} />
                  <ProbBar label={tr("panels.draw")} val={match.probs.pX} color="#475569" />
                  <ProbBar label={tr("panels.awayWin")} val={match.probs.p2} color={awayColor} />
                </CollapsiblePanel>
                <CollapsiblePanel compact title={tr("panels.doubleChance")} subtitle={tr("match.dcSubtitle")}>
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
                <DerivedMarketsPanels
                  match={match} tr={tr} tab={partsGate(["derived"])}
                  homeColor={homeColor} awayColor={awayColor}
                  xgData={xgData} hasExactConfidence={hasExactConfidence}
                  isPremiumLike={isPremiumLike}
                  firstHalfPick={firstHalfPick} firstHalfVerdict={firstHalfVerdict}
                  htGoalsActual={htGoalsActual}
                  showInternals={showModelInternals}
                />
                <CollapsiblePanel compact title={tr("detail.oddsValue")}>
              <AnalysisPanels
                match={match} tr={tr} tab={partsGate(["odds", "marketPicks"])}
                homeColor={homeColor} awayColor={awayColor}
                xgData={xgData} hasFinalScore={hasFinalScore}
                recommendedLabel={recommendedLabel}
                firstHalfPick={firstHalfPick} firstHalfVerdict={firstHalfVerdict}
                correctScoreCandidates={correctScoreCandidates}
              />
                </CollapsiblePanel>
                {lockedFamilies.length > 0 && (
                  <div
                    data-slot="markets-boundary"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--fp-radius)] border border-fp-warning/35 bg-fp-warning/10 px-3 py-2"
                  >
                    <p className="text-sm font-medium text-[var(--fp-text)]">
                      {effectiveAccessTier === "free" || isFreeLike ? tr("match.lockedFree") : tr("match.lockedPremium")}
                    </p>
                    <button
                      type="button"
                      onClick={() => onUpgradeRequired?.(lockedFamilies[0].label, lockedFamilies[0].tier)}
                      className="inline-flex h-9 items-center rounded-md border border-fp-warning/40 bg-fp-warning/10 px-3 text-[11px] font-bold uppercase tracking-wide text-[var(--fp-text)] hover:bg-fp-warning/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                    >
                      {tr("card.unlock")}
                    </button>
                  </div>
                )}
              </div>
            </CollapsiblePanel>
          </div>

          {/* 6 · SPECIAL BET — a secondary product: one collapsed row with a preview. */}
          <div data-layer="specialBet">
            <CollapsiblePanel compact title={tr("detail.ticketTitle")} subtitle={specialBetPreview}>
              <OverviewHero
                match={match} tr={tr} tab={partsGate(["specialBet"])}
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
                hideLiveStrip
              />
              {canShowSpecialBet && !hasTicket && (
                <p className="text-sm text-[var(--fp-text-muted)]">{tr("detail.ticketNone")}</p>
              )}
            </CollapsiblePanel>
          </div>

          {/* 7 · CONTEXT — collapsed: standings & form, and conditions only when present. */}
          {(showStandingsBlock || hasConditions) && (
            <div data-layer="context">
              <CollapsiblePanel compact title={tr("detail.contextTitle")} subtitle={tr("detail.contextSub")}>
                <div className="space-y-2">
                  {showStandingsBlock && (
                    <CollapsiblePanel compact title={tr("match.standingsForm")}>
              <OverviewHero
                match={match} tr={tr} tab={partsGate(["standings"])}
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
                hideLiveStrip
              />
                    </CollapsiblePanel>
                  )}
                  {hasConditions && (
                    <CollapsiblePanel compact title={tr("detail.conditionsTitle")}>
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                        <dt className="text-[var(--fp-text-muted)]">{tr("card.referee")}</dt>
                        <dd className="text-[var(--fp-text)]">
                          {refereeText}
                          {refereeCards && (
                            <span
                              className="mt-0.5 block text-xs text-[var(--fp-text-muted)]"
                              data-testid="referee-cards-context"
                              title={tr("match.refereeCardsNote")}
                            >
                              {tr("match.refereeCardsAvg", {
                                avg: refereeCards.avgCards.toFixed(1),
                                n: refereeCards.sampleSize
                              })}
                            </span>
                          )}
                        </dd>
                      </dl>
                    </CollapsiblePanel>
                  )}
                </div>
              </CollapsiblePanel>
            </div>
          )}

          {/* 8 · ADVANCED — model internals. Absent unless Account says otherwise. */}
          {showModelInternals && (
            <div data-layer="advanced">
              <CollapsiblePanel compact title={tr("detail.advancedTitle")} subtitle={tr("detail.advancedSub")}>
                <div className="space-y-3">
              <AnalysisPanels
                match={match} tr={tr} tab={partsGate(["lab", "monteCarlo"])}
                homeColor={homeColor} awayColor={awayColor}
                xgData={xgData} hasFinalScore={hasFinalScore}
                recommendedLabel={recommendedLabel}
                firstHalfPick={firstHalfPick} firstHalfVerdict={firstHalfVerdict}
                correctScoreCandidates={correctScoreCandidates}
              />
              <OverviewHero
                match={match} tr={tr} tab={partsGate(["signals"])}
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
                hideLiveStrip
              />
          {match.modelMeta &&
            (match.modelMeta.method ||
              match.modelMeta.reasonCodes?.length ||
              match.modelMeta.stakeBucket ||
              match.evaluation) && (
              <details className="group rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-4 sm:p-5">
                <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.14em] text-fp-accent/90 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    {tr("match.modelAudit")}
                    <span className="text-[var(--fp-text-muted)] transition group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="mt-4 space-y-4 border-t border-[var(--fp-border)] pt-4 text-[11px] text-[var(--fp-text-muted)]">
                  {/* === Pipeline summary: indicator clar pentru ce strat e activ === */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.pipeline")}</span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-0.5 font-mono text-[10px] text-[var(--fp-text-muted)]">
                      Poisson+DC
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] ${match.modelMeta.calibrationApplied ? "border-fp-accent/45 bg-fp-accent/10 text-[var(--fp-accent)]" : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-fp-text-muted/60"}`}>
                      Isotonic {match.modelMeta.calibrationApplied ? "✓" : "—"}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] ${match.modelMeta.stackerApplied ? "border-fp-success/45 bg-fp-success/10 text-[var(--fp-success)]" : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-fp-text-muted/60"}`}>
                      ML stacker {match.modelMeta.stackerApplied ? "✓" : "—"}
                    </span>
                    {match.modelMeta.elo ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-fp-warning/35 bg-fp-warning/8 px-2 py-0.5 font-mono text-[10px] text-[var(--fp-warning)]">
                        Elo Δ {match.modelMeta.elo.spread > 0 ? "+" : ""}{Math.round(match.modelMeta.elo.spread)}
                      </span>
                    ) : null}
                  </div>

                  {/* === Probabilităţile la fiecare strat (doar dacă avem raw) === */}
                  {match.evaluation?.rawPoissonProbs1x2Pct && (
                    <div className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fp-accent/80">{tr("match.probsPipeline")}</div>
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">
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
                      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider">
                        <span className="text-fp-accent/80">{tr("match.whyThisPick")}</span>
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
                          <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">
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
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-fp-accent/80">
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
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-fp-text-muted/80 sm:grid-cols-4">
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
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-fp-accent/80">{tr("match.marketDebiasing")}</div>
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
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-fp-accent/80">{tr("match.strengthRatings")}</div>
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
                    <div className={`rounded-lg border p-3 font-mono text-[10px] tabular-nums ${match.modelMeta.elo.thin ? "border-fp-warning/25 bg-fp-warning/8 text-[var(--fp-warning)]" : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"}`}>
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-fp-accent/80">
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
                      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">Method</span> · {match.modelMeta.method}
                    </p>
                  )}
                  {match.modelMeta.probsModel && (
                    <p>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">Probs</span> · {match.modelMeta.probsModel}
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
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.reasonCodes")}</div>
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
                      <div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                        v {match.evaluation.modelVersion || match.modelVersion || "?"}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}
                </div>
              </CollapsiblePanel>
            </div>
          )}
        </div>
    </Overlay>
  );
}
