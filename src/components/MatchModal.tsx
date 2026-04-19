import { useEffect, useState } from "react";
import LuckBadge from "./LuckBadge";
import XGPerformanceBar from "./XGPerformanceBar";
import {
  ConfidenceAura,
  deriveDataQuality,
  deriveSignalEdge,
  EdgeCompass,
  FormRibbon,
  SignalLens
} from "./SignalLab";
import { MatchScore, PredictionRow, XGData } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";

type MatchModalProps = {
  match: PredictionRow;
  logoColors: Record<string, string>;
  onClose: () => void;
  hashColor: (seed: string) => string;
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

function finalScoreBadgeClass(result: boolean | null) {
  if (result === true) return "text-signal-sage border-signal-sage/35 bg-signal-sage/10";
  if (result === false) return "text-signal-rose border-signal-rose/30 bg-signal-rose/10";
  return "text-signal-inkMuted border-white/10 bg-signal-void/50";
}

function finalScoreLabel(result: boolean | null) {
  if (result === true) return "WIN";
  if (result === false) return "LOSS";
  return "FINAL";
}

function formatLambda(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export default function MatchModal({ match, logoColors, onClose, hashColor }: MatchModalProps) {
  if (match.insufficientData) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-signal-void/85 p-3 backdrop-blur-md sm:p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md rounded-2xl border border-signal-amber/25 bg-signal-panel/90 p-8 text-center shadow-atelierLg backdrop-blur-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-display text-lg font-semibold text-signal-ink">Date insuficiente pentru model</p>
          <p className="mt-2 text-sm leading-relaxed text-signal-inkMuted">{match.insufficientReason}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 rounded-xl border border-signal-line bg-signal-fog px-4 py-2.5 text-sm font-semibold text-signal-petrol hover:bg-signal-panel hover:text-signal-ink"
          >
            Închide
          </button>
        </div>
      </div>
    );
  }

  const homeColor = logoColors[match.logos?.home || ""] || hashColor(match.teams.home);
  const awayColor = logoColors[match.logos?.away || ""] || hashColor(match.teams.away);
  const pct = (n: number) => Math.round(n || 0);
  const hasFinalScore =
    isFinalStatus(match.status) &&
    match.score?.home !== null &&
    match.score?.away !== null &&
    match.score?.home !== undefined &&
    match.score?.away !== undefined;
  const hasNumericScore = match.score != null && typeof match.score.home === "number" && typeof match.score.away === "number";
  const hasLiveScore = isFixtureInPlay(match.status) && !hasFinalScore && hasNumericScore;
  const finalPickResult = hasFinalScore ? evaluateTopPick(match.recommended.pick, match.score) : null;
  const kickoffDate = new Date(match.kickoff);
  const confPct = pct(match.recommended?.confidence);
  const edgeScore = deriveSignalEdge(match);
  const dq = deriveDataQuality(match);

  const [xgData, setXgData] = useState<XGData | null>(() => {
    if (!match.luckStats) return null;
    return { homeXG: match.luckStats.hXG, awayXG: match.luckStats.aXG };
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/get-xg?fixtureId=${match.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && !data?.error) setXgData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [match.id]);

  const ProbBar = ({ label, val, color }: { label: string; val: number; color: string }) => (
    <div className="mb-4">
      <div className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">
        <span>{label}</span>
        <span className="font-mono tabular-nums" style={{ color }}>
          {pct(val)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-signal-void ring-1 ring-white/5">
        <div style={{ width: `${val}%`, backgroundColor: color }} className="h-full rounded-full" />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-signal-void/88 p-3 backdrop-blur-md sm:p-4" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-gradient-to-b from-signal-panel/98 to-signal-mist shadow-atelierLg backdrop-blur-2xl lg:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-petrol/40 to-transparent" />
        <button
          onClick={onClose}
          className="sticky top-3 z-10 ml-auto mr-3 mt-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-signal-void/80 text-signal-inkMuted transition hover:border-signal-petrol/40 hover:text-signal-petrol"
          type="button"
          aria-label="Închide"
        >
          ✕
        </button>

        <div className="border-b border-white/5 px-5 pb-8 pt-2 sm:px-10">
          <p className="mb-6 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-signal-petrol/80">
            Analitică predictivă · Poisson / xG
          </p>
          <div className="mb-8 flex flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-1 flex-col items-center gap-3">
              <img src={match.logos?.home} className="h-16 w-16 object-contain opacity-90 sm:h-20 sm:w-20" alt="" />
              <div className="text-center font-display text-lg font-semibold text-signal-ink">{match.teams.home}</div>
            </div>
            <div className="flex w-full max-w-sm flex-col items-center">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted">{match.league}</div>
              <div className="font-display text-5xl font-bold tracking-tighter text-signal-ink">
                {hasFinalScore ? `${match.score?.home}-${match.score?.away}` : "—"}
              </div>
              <div className="mt-4 flex items-center gap-4">
                <ConfidenceAura value={confPct} />
                <div className="text-left">
                  <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-petrol/70">Pick</div>
                  <div className="font-display text-3xl font-bold text-signal-petrol">{match.recommended.pick}</div>
                </div>
              </div>
              {hasFinalScore && (
                <div className={`mt-3 inline-block rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${finalScoreBadgeClass(finalPickResult)}`}>
                  {finalScoreLabel(finalPickResult)} · {match.score?.home}-{match.score?.away}
                </div>
              )}
              {hasLiveScore && (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 motion-reduce:animate-none" /> Live ·{" "}
                  {match.score?.home}-{match.score?.away}
                </div>
              )}
              <div className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-signal-inkMuted">
                <span className="font-mono tabular-nums">{kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}</span>
                <span>·</span>
                <span className="font-mono tabular-nums">{new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span>·</span>
                <span>{match.referee || "—"}</span>
              </div>
            </div>
            <div className="flex flex-1 flex-col items-center gap-3">
              <img src={match.logos?.away} className="h-16 w-16 object-contain opacity-90 sm:h-20 sm:w-20" alt="" />
              <div className="text-center font-display text-lg font-semibold text-signal-ink">{match.teams.away}</div>
            </div>
          </div>

          <div className="mx-auto max-w-2xl rounded-2xl border border-white/5 bg-signal-void/40 p-5">
            <SignalLens confidence={confPct} edge={edgeScore} />
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <FormRibbon p1={match.probs.p1} pX={match.probs.pX} p2={match.probs.p2} homeTint={homeColor} awayTint={awayColor} />
              <EdgeCompass dataQuality={dq} valueDetected={Boolean(match.valueBet?.detected)} />
            </div>
          </div>
        </div>

        <div className="space-y-8 p-5 sm:p-10">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6">
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">01 — xG & luck</h3>
              <div className="flex justify-center">{xgData ? <XGPerformanceBar xg={xgData} /> : null}</div>
              {match.luckStats && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <LuckBadge goals={match.luckStats.hG} xg={xgData?.homeXG ?? match.luckStats.hXG} />
                  <LuckBadge goals={match.luckStats.aG} xg={xgData?.awayXG ?? match.luckStats.aXG} />
                </div>
              )}
              {!match.luckStats && <p className="text-center text-[10px] text-signal-inkMuted">Luck factor indisponibil</p>}
            </section>

            <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6">
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">02 — Cote & value</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-white/5 bg-signal-mist/50 p-3">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">1</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums lg:text-2xl" style={{ color: homeColor }}>
                    {match.odds?.home ?? "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/50 p-3">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">X</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-signal-petrol lg:text-2xl">{match.odds?.draw ?? "—"}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/50 p-3">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">2</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums lg:text-2xl" style={{ color: awayColor }}>
                    {match.odds?.away ?? "—"}
                  </div>
                </div>
              </div>
              {match.valueBet?.detected && (
                <div className="mt-4 rounded-xl border border-signal-amber/25 bg-signal-amber/10 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-amber">Value bet</div>
                  {match.odds?.bookmaker && <div className="mt-1 text-[10px] text-signal-inkMuted">Operator · {match.odds.bookmaker}</div>}
                  <div className="mt-2 flex flex-col gap-1 font-mono text-[12px] font-semibold text-signal-silver lg:flex-row lg:justify-between">
                    <span>{match.valueBet.type}</span>
                    <span>EV +{match.valueBet.ev ?? 0}%</span>
                    <span>Stake {match.valueBet.kelly ?? 0}%</span>
                  </div>
                  {match.valueBet.stakePlan && (
                    <p className="mt-2 font-mono text-[10px] text-signal-inkMuted">Plan · {match.valueBet.stakePlan}</p>
                  )}
                  {match.valueBet.ensemble && (
                    <div className="mt-3 rounded-lg border border-white/5 bg-signal-void/40 px-3 py-2 font-mono text-[10px] text-signal-silver">
                      <div className="text-[9px] uppercase tracking-wider text-signal-inkMuted">Ensemble</div>
                      <div className="mt-1 grid gap-1 sm:grid-cols-2">
                        <span>kelly base {String(match.valueBet.ensemble.baseKelly ?? "—")}</span>
                        <span>conf boost {String(match.valueBet.ensemble.confidenceBoost ?? "—")}</span>
                        <span>vol penalty {String(match.valueBet.ensemble.volatilityPenalty ?? "—")}</span>
                        <span>EV boost {String(match.valueBet.ensemble.evBoost ?? "—")}</span>
                      </div>
                    </div>
                  )}
                  {Array.isArray(match.valueBet.reasons) && match.valueBet.reasons.length > 0 && (
                    <ul className="mt-3 list-inside list-disc space-y-1 text-[10px] text-signal-inkMuted">
                      {match.valueBet.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {!match.valueBet?.detected && (
                <p className="mt-4 text-[10px] text-signal-inkMuted">Value bet · nu detectat</p>
              )}
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {match.lambdas && (
              <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6 text-center">
                <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">03 — λ ofensiv</h3>
                <div className="flex items-center justify-center gap-6">
                  <div className="font-mono text-3xl font-semibold tabular-nums" style={{ color: homeColor }}>
                    {formatLambda(match.lambdas.home)}
                  </div>
                  <span className="font-display text-signal-stone">vs</span>
                  <div className="font-mono text-3xl font-semibold tabular-nums" style={{ color: awayColor }}>
                    {formatLambda(match.lambdas.away)}
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-white/5 bg-signal-void/30 p-6">
              <h3 className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">04 — Piețe & scor</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">1X2</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.oneXtwo}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">GG</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.gg}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">Over 2.5</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.over25}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">Correct score</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.correctScore || "—"}</div>
                  {hasFinalScore && (
                    <div className="mt-1 font-mono text-[10px] text-signal-inkMuted">Final · {match.score?.home}-{match.score?.away}</div>
                  )}
                </div>
                {match.predictions.cards && (
                  <div className="col-span-2 rounded-xl border border-white/5 bg-signal-mist/40 p-3 text-center">
                    <div className="text-[10px] font-semibold uppercase text-signal-inkMuted">Cartonașe</div>
                    <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.cards}</div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="rounded-2xl border border-dashed border-signal-line/40 bg-signal-void/20 p-4 sm:p-5">
              <h3 className="mb-4 border-b border-white/5 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Probabilități 1X2</h3>
              <ProbBar label="Victorie gazde" val={match.probs.p1} color={homeColor} />
              <ProbBar label="Egalitate" val={match.probs.pX} color="#94a3b8" />
              <ProbBar label="Victorie oaspeți" val={match.probs.p2} color={awayColor} />
            </div>
            <div className="rounded-2xl border border-dashed border-signal-line/40 bg-signal-void/20 p-4 sm:p-5">
              <h3 className="mb-4 border-b border-white/5 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Piața goluri</h3>
              <ProbBar label="Peste 2.5" val={match.probs.pO25} color="#38bdf8" />
              <ProbBar label="Sub 3.5" val={match.probs.pU35} color="#34d399" />
              <ProbBar label="Ambele (GG)" val={match.probs.pGG} color="#fbbf24" />
            </div>
          </div>

          {match.modelMeta &&
            (match.modelMeta.method ||
              match.modelMeta.reasonCodes?.length ||
              match.modelMeta.stakeBucket ||
              match.evaluation) && (
              <details className="group rounded-2xl border border-white/[0.07] bg-signal-void/25 p-4 sm:p-5">
                <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/90 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    Model audit
                    <span className="text-signal-inkMuted transition group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="mt-4 space-y-3 border-t border-white/5 pt-4 text-[11px] text-signal-inkMuted">
                  {match.modelMeta.method && (
                    <p>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-signal-silver">Method</span> · {match.modelMeta.method}
                    </p>
                  )}
                  {match.modelMeta.probsModel && (
                    <p>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-signal-silver">Probs</span> · {match.modelMeta.probsModel}
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
                      <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-signal-silver">Reason codes</div>
                      <ul className="list-inside list-disc space-y-0.5 font-mono text-[10px] text-signal-silver">
                        {match.modelMeta.reasonCodes.map((code) => (
                          <li key={code}>{code}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {match.evaluation && (
                    <div className="rounded-lg border border-white/5 bg-signal-mist/30 px-3 py-2 font-mono text-[10px] text-signal-silver">
                      {match.evaluation.recommendedTrack && <div>Track · {match.evaluation.recommendedTrack}</div>}
                      {match.evaluation.marketBlendWeight != null && (
                        <div>Market blend · {(match.evaluation.marketBlendWeight * 100).toFixed(0)}%</div>
                      )}
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
