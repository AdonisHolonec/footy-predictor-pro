import { useEffect, useState } from "react";
import LuckBadge from "./LuckBadge";
import XGPerformanceBar from "./XGPerformanceBar";
import { deriveDataQuality, deriveSignalEdge, EdgeCompass, FormRibbon, SignalLens } from "./SignalLab";
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
  if (result === true) return "text-signal-petrol border-signal-sage/40 bg-signal-mintSoft/50";
  if (result === false) return "text-signal-rose border-signal-rose/35 bg-signal-rose/10";
  return "text-signal-inkMuted border-signal-line bg-white/60";
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
        className="fixed inset-0 z-50 flex items-center justify-center bg-signal-petrolDeep/40 p-3 backdrop-blur-md sm:p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md rounded-2xl border border-signal-amber/35 bg-gradient-to-br from-amber-50 to-signal-fog p-8 text-center shadow-atelierLg"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-display text-lg font-semibold text-signal-petrol">Date insuficiente pentru model</p>
          <p className="mt-2 text-sm leading-relaxed text-signal-inkMuted">{match.insufficientReason}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 rounded-xl border border-signal-line bg-white px-4 py-2.5 text-sm font-semibold text-signal-petrol shadow-sm hover:bg-signal-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/40"
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
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">
        <span>{label}</span>
        <span className="font-mono tabular-nums" style={{ color }}>
          {pct(val)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full border border-signal-line/60 bg-signal-fog">
        <div style={{ width: `${val}%`, backgroundColor: color }} className="h-full shadow-sm" />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-signal-petrolDeep/35 p-3 backdrop-blur-md sm:p-4" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.75rem] border border-white/70 bg-signal-mist/95 shadow-atelierLg backdrop-blur-xl lg:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="sticky top-3 z-10 ml-auto mr-3 mt-3 flex h-10 w-10 items-center justify-center rounded-full border border-signal-line bg-white/90 text-signal-inkMuted shadow-sm transition hover:bg-white hover:text-signal-petrol focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/40"
          type="button"
          aria-label="Închide"
        >
          ✕
        </button>

        <div className="border-b border-signal-line/80 bg-gradient-to-b from-white/80 to-signal-fog/40 px-5 pb-6 pt-2 text-center sm:px-8">
          <div className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-signal-sage">Fișă analiză · Poisson & xG</div>
          <div className="mb-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-1 sm:gap-8 sm:px-2">
            <div className="flex flex-col items-center gap-3 justify-self-start">
              <img src={match.logos?.home} className="h-14 w-14 object-contain drop-shadow-sm sm:h-16 sm:w-16" alt="" />
              <div className="text-sm font-semibold leading-tight text-signal-petrol">{match.teams.home}</div>
            </div>
            <div className="min-w-[160px] text-center">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted">{match.league}</div>
              <div className="font-display text-4xl font-semibold tracking-tight text-signal-petrol">
                {hasFinalScore ? `${match.score?.home}-${match.score?.away}` : "—"}
              </div>
              <div className="mt-2 inline-block rounded-full border border-signal-sage/35 bg-signal-mintSoft/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-petrolMuted">
                Pick · {match.recommended.pick}
              </div>
              {hasFinalScore && (
                <div className={`mt-2 inline-block rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${finalScoreBadgeClass(finalPickResult)}`}>
                  {finalScoreLabel(finalPickResult)} · {match.score?.home}-{match.score?.away}
                </div>
              )}
              {hasLiveScore && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" /> Live ·{" "}
                  {match.score?.home}-{match.score?.away}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] text-signal-inkMuted">
                <span className="font-mono tabular-nums">{kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}</span>
                <span>·</span>
                <span className="font-mono tabular-nums">{new Date(match.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span>·</span>
                <span>{match.referee || "—"}</span>
              </div>
            </div>
            <div className="flex flex-col items-center gap-3 justify-self-end">
              <img src={match.logos?.away} className="h-14 w-14 object-contain drop-shadow-sm sm:h-16 sm:w-16" alt="" />
              <div className="text-sm font-semibold leading-tight text-signal-petrol">{match.teams.away}</div>
            </div>
          </div>

          <div className="mx-auto max-w-xl rounded-2xl border border-signal-line/80 bg-white/50 p-4 shadow-inner">
            <SignalLens confidence={confPct} edge={edgeScore} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:items-start">
              <FormRibbon p1={match.probs.p1} pX={match.probs.pX} p2={match.probs.p2} homeTint={homeColor} awayTint={awayColor} />
              <EdgeCompass dataQuality={dq} valueDetected={Boolean(match.valueBet?.detected)} />
            </div>
          </div>
        </div>

        <div className="space-y-6 p-5 sm:space-y-8 sm:p-8">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
            <div className="rounded-3xl border border-signal-line/80 bg-white/55 p-5 text-center shadow-inner">
              <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-inkMuted">xG & luck</div>
              <div className="flex justify-center">{xgData ? <XGPerformanceBar xg={xgData} /> : null}</div>
              {match.luckStats && (
                <div className="mt-2 flex flex-wrap justify-center gap-2 px-1 lg:justify-between">
                  <LuckBadge goals={match.luckStats.hG} xg={xgData?.homeXG ?? match.luckStats.hXG} />
                  <LuckBadge goals={match.luckStats.aG} xg={xgData?.awayXG ?? match.luckStats.aXG} />
                </div>
              )}
              {!match.luckStats && <div className="text-[10px] text-signal-inkMuted">Luck factor indisponibil</div>}
            </div>

            <div className="rounded-3xl border border-signal-line/80 bg-white/55 p-5 shadow-inner">
              <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-inkMuted">Cote & value</div>
              <div className="grid grid-cols-3 gap-2 text-center lg:gap-3">
                <div className="rounded-2xl border border-signal-line/60 bg-signal-fog/50 p-2.5 lg:p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">1</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums lg:text-2xl" style={{ color: homeColor }}>
                    {match.odds?.home ?? "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-signal-line/60 bg-signal-fog/50 p-2.5 lg:p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">X</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-signal-petrol lg:text-2xl">{match.odds?.draw ?? "—"}</div>
                </div>
                <div className="rounded-2xl border border-signal-line/60 bg-signal-fog/50 p-2.5 lg:p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">2</div>
                  <div className="mt-1 font-mono text-xl font-semibold tabular-nums lg:text-2xl" style={{ color: awayColor }}>
                    {match.odds?.away ?? "—"}
                  </div>
                </div>
              </div>

              {match.valueBet?.detected && (
                <div className="mt-4 rounded-2xl border border-signal-amber/40 bg-amber-50/90 p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-amber">Value bet</div>
                  {match.odds?.bookmaker && (
                    <div className="mt-1 text-[10px] font-medium text-signal-inkMuted">Operator · {match.odds.bookmaker}</div>
                  )}
                  <div className="mt-2 flex flex-col gap-1 font-mono text-[12px] font-semibold text-signal-petrol lg:flex-row lg:justify-between">
                    <span>{match.valueBet.type}</span>
                    <span>EV +{match.valueBet.ev ?? 0}%</span>
                    <span>Stake {match.valueBet.kelly ?? 0}%</span>
                  </div>
                </div>
              )}
              {!match.valueBet?.detected && (
                <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-inkMuted">Value bet · nu detectat</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
            {match.lambdas && (
              <div className="rounded-3xl border border-signal-line/80 bg-white/55 p-5 text-center shadow-inner">
                <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-inkMuted">Momentum ofensiv (λ)</div>
                <div className="flex items-center justify-center gap-4">
                  <div className="w-1/2 text-right font-mono text-2xl font-semibold tabular-nums" style={{ color: homeColor }}>
                    {formatLambda(match.lambdas.home)}
                  </div>
                  <div className="font-display text-xs italic text-signal-stone">v</div>
                  <div className="w-1/2 text-left font-mono text-2xl font-semibold tabular-nums" style={{ color: awayColor }}>
                    {formatLambda(match.lambdas.away)}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-3xl border border-signal-line/80 bg-white/55 p-5 shadow-inner">
              <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-inkMuted">Piețe & scor</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-signal-line/60 bg-signal-fog/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">1X2</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.oneXtwo}</div>
                </div>
                <div className="rounded-2xl border border-signal-line/60 bg-signal-fog/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">GG</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.gg}</div>
                </div>
                <div className="rounded-2xl border border-signal-line/60 bg-signal-fog/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">Over 2.5</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.over25}</div>
                </div>
                <div className="rounded-2xl border border-signal-line/60 bg-signal-fog/40 p-3 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">Correct score</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.correctScore || "—"}</div>
                  {hasFinalScore && (
                    <div className="mt-1 font-mono text-[10px] text-signal-inkMuted">Final · {match.score?.home}-{match.score?.away}</div>
                  )}
                </div>
                {match.predictions.cards && (
                  <div className="col-span-2 rounded-2xl border border-signal-line/60 bg-signal-fog/40 p-3 text-center">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted">Cartonașe</div>
                    <div className="mt-1 font-mono text-sm font-semibold">{match.predictions.cards}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:gap-10 lg:grid-cols-2">
            <div className="space-y-4 rounded-2xl border border-dashed border-signal-line/60 bg-white/40 p-4">
              <div className="border-b border-signal-line/50 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-inkMuted">Rezultat · probabilități</div>
              <ProbBar label="Victorie gazde" val={match.probs.p1} color={homeColor} />
              <ProbBar label="Egalitate" val={match.probs.pX} color="#8a8074" />
              <ProbBar label="Victorie oaspeți" val={match.probs.p2} color={awayColor} />
            </div>
            <div className="space-y-4 rounded-2xl border border-dashed border-signal-line/60 bg-white/40 p-4">
              <div className="border-b border-signal-line/50 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-inkMuted">Piața goluri</div>
              <ProbBar label="Peste 2.5" val={match.probs.pO25} color="#134842" />
              <ProbBar label="Sub 3.5" val={match.probs.pU35} color="#6d8f7e" />
              <ProbBar label="Ambele (GG)" val={match.probs.pGG} color="#9a7218" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
