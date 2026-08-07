/**
 * AnalysisPanels — moved verbatim from MatchModal.tsx (Sprint 7, step c). The tab()
 * visibility helper arrives as a prop so CSS-hidden tab behavior is unchanged.
 */

import CollapsiblePanel from "../../design-system/CollapsiblePanel";
import ConfidenceEnginePanel from "../ConfidenceEnginePanel";
import ExplanationCard from "../ExplanationCard";
import FeatureImportanceChart from "../FeatureImportanceChart";
import LuckBadge from "../LuckBadge";
import MonteCarloPanel from "../MonteCarloPanel";
import PredictionContributionsChart from "../PredictionContributionsChart";
import PredictionLaboratoryPanel from "../PredictionLaboratory";
import ValueCard from "../ValueCard";
import XGPerformanceBar from "../XGPerformanceBar";
import { PredictionRow, XGData } from "../../types";
import type { DetailTabId } from "../MatchModal";
import type { TranslateFn } from "../../i18n";
import type { ValueEngine } from "../../types";
import type { formatRecommendedPick } from "../../utils/formatRecommendation";
import MarketPickCard from "./MarketPickCard";
import { evaluateScoreDerivedPick, fallbackTierFromProb } from "./helpers";

type AnalysisPanelsProps = {
  match: PredictionRow;
  tr: TranslateFn;
  tab: (ids: DetailTabId[]) => string;
  homeColor: string;
  awayColor: string;
  xgData: XGData | null;
  hasFinalScore: boolean;
  recommendedLabel: ReturnType<typeof formatRecommendedPick>;
  firstHalfPick: { pick: string; displayPick: string; probability: number; line: number; side: "over" | "under" } | null;
  firstHalfVerdict: boolean | null;
  correctScoreCandidates: NonNullable<ValueEngine["markets"]>;
};

export default function AnalysisPanels(props: AnalysisPanelsProps) {
  const {
    match, tr, tab, homeColor, awayColor, xgData, hasFinalScore,
    recommendedLabel, firstHalfPick, firstHalfVerdict, correctScoreCandidates
  } = props;
  return (
    <>
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

    </>
  );
}