/**
 * OverviewHero — moved verbatim from MatchModal.tsx (Sprint 7, step c). The tab()
 * visibility helper arrives as a prop so CSS-hidden tab behavior is unchanged.
 */

import CollapsiblePanel from "../../design-system/CollapsiblePanel";
import LiveWinProbabilityStrip from "../ux/LiveWinProbabilityStrip";
import MatchMomentumTimeline from "../ux/MatchMomentumTimeline";
import { EdgeCompass, FormRibbon, SignalLens } from "../SignalLab";
import { LeagueStandingEntry, PredictionRow } from "../../types";
import type { DetailTabId, MatchModalProps } from "../MatchModal";
import type { TranslateFn } from "../../i18n";
import type { Dispatch, SetStateAction } from "react";
import type { pickSpecialBetLegs } from "../../utils/specialBet";
import type { formatRecommendedPick } from "../../utils/formatRecommendation";
import type { resolveCardMarketOutcome } from "../../utils/cardMarketOutcome";
import TeamSnapshotCard from "./TeamSnapshotCard";
import LeagueStandingsTable from "./LeagueStandingsTable";

type OverviewHeroProps = {
  match: PredictionRow;
  tr: TranslateFn;
  tab: (ids: DetailTabId[]) => string;
  detailTab: DetailTabId;
  homeColor: string;
  awayColor: string;
  hasLiveScore: boolean;
  hasExactConfidence: boolean;
  isFreeLike: boolean;
  isPremiumLike: boolean;
  confPct: number | null;
  confidenceCategory: string;
  dq: number;
  edgeScore: number;
  recommendedLabel: ReturnType<typeof formatRecommendedPick>;
  outcomeTextClass: (outcome: ReturnType<typeof resolveCardMarketOutcome>) => string;
  showStandingsBlock: boolean;
  standingsRows: LeagueStandingEntry[];
  canShowSpecialBet: boolean;
  onUpgradeRequired: MatchModalProps["onUpgradeRequired"];
  specialLegCount: 2 | 3;
  setSpecialLegCount: Dispatch<SetStateAction<2 | 3>>;
  specialBetLegs: ReturnType<typeof pickSpecialBetLegs>;
  specialBetCandidatesLen: number;
  specialBetCombinedOdd: number | null;
  specialCombinedOutcome: string;
  specialCombinedTone: string;
  specialBetLiveAdjustmentBadge: (liveAdjustment?: { delta: number; reason: "neutral" | "aligned" | "contradicted" }) => { delta: string; tone: "danger" | "success" };
};

export default function OverviewHero(props: OverviewHeroProps) {
  const {
    match, tr, tab, detailTab, homeColor, awayColor, hasLiveScore, hasExactConfidence,
    isFreeLike, isPremiumLike, confPct, confidenceCategory, dq, edgeScore,
    recommendedLabel, outcomeTextClass, showStandingsBlock, standingsRows,
    canShowSpecialBet, onUpgradeRequired, specialLegCount, setSpecialLegCount,
    specialBetLegs, specialBetCandidatesLen, specialBetCombinedOdd,
    specialCombinedOutcome, specialCombinedTone, specialBetLiveAdjustmentBadge
  } = props;
  return (
    <>
          {hasLiveScore && <LiveWinProbabilityStrip match={match} className={`w-full ${tab(["overview"])}`} />}
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
    </>
  );
}