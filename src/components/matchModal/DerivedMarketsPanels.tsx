/**
 * DerivedMarketsPanels — moved verbatim from MatchModal.tsx (Sprint 7, step c). The tab()
 * visibility helper arrives as a prop so CSS-hidden tab behavior is unchanged.
 */

import CollapsiblePanel from "../../design-system/CollapsiblePanel";
import { PredictionRow, XGData } from "../../types";
import { deriveAlignedOuPick, matchingMarketOdd, shotsDisplayOdd } from "../../utils/marketPicks";
import type { DetailPart } from "./detailParts";
import type { TranslateFn } from "../../i18n";
import PoissonMarketSection from "./PoissonMarketSection";
import { ProbBar } from "./ProbBar";
import { marketResultBadge } from "./helpers";
import { isFinalMatchStatus } from "../../utils/cardMarketOutcome";

type DerivedMarketsPanelsProps = {
  match: PredictionRow;
  tr: TranslateFn;
  tab: (ids: DetailPart[]) => string;
  /** Account › Model internals. Off: λ / scale / sample lines stay out of the market rows. */
  showInternals?: boolean;
  homeColor: string;
  awayColor: string;
  xgData: XGData | null;
  hasExactConfidence: boolean;
  isPremiumLike: boolean;
  firstHalfPick: { pick: string; displayPick: string; probability: number; line: number; side: "over" | "under" } | null;
  firstHalfVerdict: boolean | null;
  htGoalsActual: number | null;
};

export default function DerivedMarketsPanels(props: DerivedMarketsPanelsProps) {
  const {
    match, tr, tab, homeColor, awayColor, xgData, hasExactConfidence,
    isPremiumLike, firstHalfPick, firstHalfVerdict, htGoalsActual, showInternals = false
  } = props;
  return (
    <>
          {/* === PRIMA REPRIZĂ — derivată din distribuţia goluri pe minute (/teams/statistics) === */}
          {match.probs.firstHalf && (
            <CollapsiblePanel
              compact
              title={tr("panels.firstHalf")}
              subtitle={tr("match.htSubtitle")}
              className={tab(["derived"])}
            >
              {showInternals && match.modelMeta?.firstHalf && (
                <div className="mb-3 text-right font-mono text-[10px] text-[var(--fp-text-muted)] tabular-nums">
                  <div>
                    λ FH · {match.modelMeta.firstHalf.lambdaHome.toFixed(2)} vs{" "}
                    {match.modelMeta.firstHalf.lambdaAway.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-[var(--fp-text-muted)]">
                    scale · {(match.modelMeta.firstHalf.scaleHome * 100).toFixed(0)}% /{" "}
                    {(match.modelMeta.firstHalf.scaleAway * 100).toFixed(0)}%
                    {match.modelMeta.firstHalf.baselineUsed ? " · baseline" : ""}
                  </div>
                </div>
              )}
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                    {tr("match.htResult")}
                  </div>
                  <ProbBar label={tr("match.htHomeLead")} val={match.probs.firstHalf.p1} color={homeColor} />
                  <ProbBar label={tr("match.htDraw")} val={match.probs.firstHalf.pX} color="#475569" />
                  <ProbBar label={tr("match.htAwayLead")} val={match.probs.firstHalf.p2} color={awayColor} />
                </div>
                <div>
                  <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">
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
                  <span className="text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.htBestScore")}</span>
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
                    <span className="ml-2 font-mono text-[10px] text-[var(--fp-text-muted)]">
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
              className={tab(["derived"])}
            >
              <p className="text-sm text-[var(--fp-text-muted)]">
                {isPremiumLike ? tr("match.htLockedUltra") : tr("match.htLocked")}
              </p>
            </CollapsiblePanel>
          )}

          {/* === CORNERE + ŞUTURI LA POARTĂ + CARTONAŞE (Poisson pe rolling stats) === */}
          {(match.probs.corners || match.probs.shotsOnTarget || match.probs.shotsTotal || match.probs.cards) && (
            <div className={`space-y-2 ${tab(["derived"])}`}>
              {match.probs.corners && (
                <CollapsiblePanel compact title={tr("match.featCorners")} subtitle={tr("match.cornersSub")}>
                  <PoissonMarketSection
                    showInternals={showInternals}
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
                    showInternals={showInternals}
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
                      // No pick means no line to price against, so there is no odd to
                      // show. Falling back to a raw quote here would print a price
                      // belonging to another line, or to the total-shots market entirely.
                      if (!pick) return null;
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
                    showInternals={showInternals}
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
                      if (!pick) return null;
                      // Exact line only: the shots-total ladder steps by 2.0, so a loose
                      // tolerance here reliably priced the wrong bet.
                      return matchingMarketOdd(match.marketOdds?.shotsTotal, pick.side, pick.line);
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
                    showInternals={showInternals}
                    title={tr("match.featCards")}
                    subtitle={tr("match.cardsSub")}
                    accent="var(--fp-warning)"
                    icon="▢"
                    data={match.probs.cards}
                    homeLabel={match.teams.home}
                    awayLabel={match.teams.away}
                    actualTotal={
                      // C3: a card count is only "final" once the match is; in play it is not shown.
                      isFinalMatchStatus(match.status)
                        ? (xgData?.marketResults?.cardsTotal ?? match.marketResults?.cardsTotal ?? null)
                        : null
                    }
                    quotedOdd={match.marketOdds?.cards?.odd ?? null}
                    quoteSource={match.marketOdds?.cards?.bookmaker ?? null}
                    badgeTone="cards"
                    framed={false}
                  />
                </CollapsiblePanel>
              )}
            </div>
          )}
    </>
  );
}