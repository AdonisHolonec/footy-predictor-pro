import { useEffect, useState } from "react";
import LuckBadge from "./LuckBadge";
import XGPerformanceBar from "./XGPerformanceBar";
import {
  ConfidenceAura,
  deriveDataQuality,
  deriveSignalEdge,
  EdgeCompass,
  FormRibbon,
  PredictionDossierShell,
  SignalLens
} from "./SignalLab";
import { MatchScore, PredictionRow, XGData } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";

type MatchCardProps = {
  row: PredictionRow;
  logoColors: Record<string, string>;
  onClick: () => void;
  hashColor: (seed: string) => string;
  animationDelayMs?: number;
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
  return "text-signal-inkMuted border-white/10 bg-signal-void/60";
}

function finalScoreLabel(result: boolean | null) {
  if (result === true) return "WIN";
  if (result === false) return "LOSS";
  return "FINAL";
}

export default function MatchCard({ row, logoColors, onClick, hashColor, animationDelayMs = 0 }: MatchCardProps) {
  const [xgData, setXgData] = useState<XGData | null>(() => {
    if (!row.luckStats) return null;
    return { homeXG: row.luckStats.hXG, awayXG: row.luckStats.aXG };
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/get-xg?fixtureId=${row.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && !data?.error) setXgData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const homeColor = logoColors[row.logos?.home || ""] || hashColor(row.teams.home);
  const awayColor = logoColors[row.logos?.away || ""] || hashColor(row.teams.away);
  const pct = (n: number) => Math.round(n || 0);
  const isLive = isFixtureInPlay(row.status);
  const confPct = pct(row.recommended?.confidence);
  const edgeScore = deriveSignalEdge(row);
  const dq = deriveDataQuality(row);
  const hasFinalScore =
    isFinalStatus(row.status) &&
    row.score?.home !== null &&
    row.score?.away !== null &&
    row.score?.home !== undefined &&
    row.score?.away !== undefined;
  const finalPickResult = hasFinalScore ? evaluateTopPick(row.recommended.pick, row.score) : null;
  const kickoffDate = new Date(row.kickoff);
  const dossierRef = `DOS-${String(row.id).slice(-6)}`;

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
        className="relative flex h-full animate-stagger-in cursor-pointer flex-col rounded-2xl border border-signal-amber/25 bg-signal-fog/60 p-4 shadow-atelier backdrop-blur-md sm:rounded-3xl sm:p-5 touch-manipulation select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/50 motion-reduce:animate-none"
      >
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-amber">Insufficient signal</div>
        <div className="font-display mt-1 text-base font-semibold text-signal-ink">
          {row.teams?.home} vs {row.teams?.away}
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-signal-inkMuted">{row.insufficientReason || "Modelul nu a putut estima λ-uri."}</div>
      </div>
    );
  }
  const noBetReasonTokens = [
    "edge_too_small",
    "low_ev",
    "low_confidence",
    "market_disagrees",
    "min_sample_guardrail",
    "low_data_quality"
  ];
  const normalizedModelMethod = String(row.modelMeta?.method || "").toLowerCase();
  const modelBadgeLabel = normalizedModelMethod.includes("advanced") || normalizedModelMethod.includes("strength")
    ? "Advanced"
    : normalizedModelMethod.includes("standings")
    ? "Standings"
    : normalizedModelMethod.includes("synthetic")
    ? "Synthetic"
    : row.modelMeta?.method || null;
  const hasMarketCalibration = Array.isArray(row.valueBet?.reasons) && row.valueBet.reasons.includes("market_calibrated");
  const showCalibratedBadge =
    hasMarketCalibration && isFinite(Number(row.odds?.home)) && isFinite(Number(row.odds?.draw)) && isFinite(Number(row.odds?.away));
  const showNoBetFilteredBadge =
    Array.isArray(row.valueBet?.reasons) &&
    row.valueBet.reasons.some((reason) => noBetReasonTokens.some((token) => reason.includes(token))) &&
    !row.valueBet?.detected;

  return (
    <PredictionDossierShell dossierId={dossierRef}>
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
        className="group relative flex h-full animate-stagger-in flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-b from-signal-panel/90 to-signal-mist/95 p-4 shadow-atelier backdrop-blur-xl sm:rounded-3xl sm:p-5 cursor-pointer touch-manipulation select-none transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-signal-petrol/25 hover:shadow-frost active:translate-y-0 motion-reduce:animate-none motion-reduce:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/50"
      >
        <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-signal-petrol/5 blur-3xl transition-opacity group-hover:opacity-100" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-petrol/35 to-transparent" />

        <div className="relative mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-signal-line/50 bg-signal-void/50 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.16em] text-signal-silver">
                {row.league}
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-red-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 motion-reduce:animate-none" />
                  Live
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] font-medium text-signal-inkMuted">
              <span className="font-mono tabular-nums">{kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}</span>
              <span className="text-signal-stone">·</span>
              <span className="font-mono tabular-nums">{new Date(row.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="text-signal-stone">·</span>
              <span className="truncate">{row.referee || "—"}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4 sm:flex-row-reverse sm:items-center">
            <ConfidenceAura value={confPct} />
            <div className="min-w-0 text-right sm:text-left">
              <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-signal-petrol/80">Primary signal</div>
              <div className="font-display text-2xl font-bold tracking-tight text-signal-ink sm:text-3xl">{row.recommended.pick}</div>
            </div>
          </div>
        </div>

        <div className="relative mb-3 flex flex-wrap gap-1.5">
          {modelBadgeLabel && (
            <span className="rounded-full border border-signal-petrol/25 bg-signal-petrol/10 px-2.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-signal-petrol">
              {modelBadgeLabel}
            </span>
          )}
          {showCalibratedBadge && (
            <span className="rounded-full border border-signal-sage/30 bg-signal-sage/10 px-2.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-signal-sage">
              Calibrated
            </span>
          )}
          {showNoBetFilteredBadge && (
            <span className="rounded-full border border-signal-amber/30 bg-signal-amber/10 px-2.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-signal-amber">
              No-bet filtered
            </span>
          )}
        </div>

        <div className="relative mb-4 grid gap-3 rounded-xl border border-white/5 bg-signal-void/40 p-3 sm:grid-cols-2">
          <SignalLens confidence={confPct} edge={edgeScore} />
          <EdgeCompass dataQuality={dq} valueDetected={Boolean(row.valueBet?.detected)} />
          <div className="sm:col-span-2">
            <FormRibbon p1={row.probs.p1} pX={row.probs.pX} p2={row.probs.p2} homeTint={homeColor} awayTint={awayColor} />
          </div>
        </div>

        {row.valueBet?.detected && (
          <div className="relative mb-4 flex flex-col gap-2 rounded-xl border border-signal-amber/25 bg-gradient-to-r from-signal-amber/10 to-transparent p-3 text-[10px] text-signal-amber sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 font-semibold uppercase tracking-wide">
              <span>Value · {row.valueBet.type}</span>
              {row.odds?.bookmaker && <span className="font-normal normal-case text-signal-inkMuted">· {row.odds.bookmaker}</span>}
            </div>
            <div className="font-mono tabular-nums text-signal-silver">
              EV +{row.valueBet.ev}% · Stake {row.valueBet.kelly}%
            </div>
          </div>
        )}

        <div className="relative mb-3 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div className="flex flex-col items-center gap-2 text-center">
            <img src={row.logos?.home} className="h-10 w-10 object-contain opacity-90 sm:h-11 sm:w-11" alt="" />
            <div className="line-clamp-2 text-[10px] font-semibold leading-tight text-signal-silver sm:text-[11px]">{row.teams.home}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-signal-void/60 px-2 py-1 font-display text-[10px] italic text-signal-stone">
            v
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <img src={row.logos?.away} className="h-10 w-10 object-contain opacity-90 sm:h-11 sm:w-11" alt="" />
            <div className="line-clamp-2 text-[10px] font-semibold leading-tight text-signal-silver sm:text-[11px]">{row.teams.away}</div>
          </div>
        </div>

        <XGPerformanceBar xg={xgData} />

        {row.luckStats && (
          <div className="relative mt-2 flex flex-wrap justify-between gap-2 px-0.5">
            <LuckBadge goals={row.luckStats.hG} xg={xgData?.homeXG ?? row.luckStats.hXG} />
            <LuckBadge goals={row.luckStats.aG} xg={xgData?.awayXG ?? row.luckStats.aXG} />
          </div>
        )}

        <div className="relative mt-4 space-y-2">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-signal-void ring-1 ring-white/5">
            <div
              style={{ width: `${row.probs.p1}%`, backgroundColor: homeColor }}
              className="transition-[width] duration-500 ease-out"
            />
            <div style={{ width: `${row.probs.pX}%` }} className="bg-signal-stone/50 transition-[width] duration-500 ease-out" />
            <div
              style={{ width: `${row.probs.p2}%`, backgroundColor: awayColor }}
              className="transition-[width] duration-500 ease-out"
            />
          </div>
          <div className="flex justify-between gap-2 px-0.5 text-[7px] font-mono font-medium uppercase text-signal-inkMuted sm:text-[8px]">
            <span className={row.valueBet?.type === "1" ? "text-signal-amber" : ""}>
              {pct(row.probs.p1)}% · {row.odds?.home || "—"}
            </span>
            <span className="opacity-70">{pct(row.probs.pX)}% · {row.odds?.draw || "—"}</span>
            <span className={row.valueBet?.type === "2" ? "text-signal-amber" : ""}>
              {row.odds?.away || "—"} · {pct(row.probs.p2)}%
            </span>
          </div>
        </div>

        <div className="relative mt-3 flex flex-wrap gap-2">
          <span className="rounded-md border border-white/10 bg-signal-void/50 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-signal-petrol/90">
            {row.predictions?.oneXtwo}
          </span>
          <span className="rounded-md border border-white/10 bg-signal-void/50 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-signal-petrol/90">
            {row.predictions?.gg}
          </span>
          <span className="rounded-md border border-white/10 bg-signal-void/50 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-signal-petrol/90">
            {row.predictions?.over25}
          </span>
        </div>

        <div className="relative mt-auto rounded-lg border border-white/5 bg-signal-void/50 p-2.5 text-center">
          {hasFinalScore && (
            <div
              className={`inline-flex items-center justify-center rounded-md border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide ${finalScoreBadgeClass(finalPickResult)}`}
            >
              {finalScoreLabel(finalPickResult)} · {row.score?.home}-{row.score?.away}
            </div>
          )}
          {!hasFinalScore && (
            <div className="text-[8px] font-semibold uppercase tracking-wider text-signal-inkMuted">Rezultat final indisponibil</div>
          )}
        </div>
      </div>
    </PredictionDossierShell>
  );
}
