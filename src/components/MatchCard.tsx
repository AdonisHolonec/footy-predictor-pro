import { useEffect, useState } from "react";
import LuckBadge from "./LuckBadge";
import XGPerformanceBar from "./XGPerformanceBar";
import { MatchScore, PredictionRow, XGData } from "../types";
import { isFixtureInPlay } from "../utils/appUtils";

type MatchCardProps = {
  row: PredictionRow;
  logoColors: Record<string, string>;
  onClick: () => void;
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
  if (result === true) return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  if (result === false) return "text-rose-300 bg-rose-500/10 border-rose-500/20";
  return "text-slate-300 bg-white/5 border-white/10";
}

function finalScoreLabel(result: boolean | null) {
  if (result === true) return "WIN";
  if (result === false) return "LOSS";
  return "FINAL";
}

export default function MatchCard({ row, logoColors, onClick, hashColor }: MatchCardProps) {
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
  const confColor = confPct >= 75 ? "#10b981" : confPct >= 60 ? "#f59e0b" : "#ef4444";
  const hasFinalScore = isFinalStatus(row.status) && row.score?.home !== null && row.score?.away !== null && row.score?.home !== undefined && row.score?.away !== undefined;
  const finalPickResult = hasFinalScore ? evaluateTopPick(row.recommended.pick, row.score) : null;
  const kickoffDate = new Date(row.kickoff);
  const noBetReasonTokens = [
    "edge_too_small",
    "low_ev",
    "low_confidence",
    "market_disagrees",
    "min_sample_guardrail",
    "low_data_quality"
  ];
  const normalizedModelMethod = String(row.modelMeta?.method || "").toLowerCase();
  const modelBadgeLabel = normalizedModelMethod.includes("advanced")
    ? "Advanced"
    : normalizedModelMethod.includes("standings")
    ? "Standings"
    : normalizedModelMethod.includes("synthetic")
    ? "Synthetic"
    : row.modelMeta?.method || null;
  const hasMarketCalibration = Array.isArray(row.valueBet?.reasons)
    && row.valueBet.reasons.includes("market_calibrated");
  const showCalibratedBadge = hasMarketCalibration
    && isFinite(Number(row.odds?.home))
    && isFinite(Number(row.odds?.draw))
    && isFinite(Number(row.odds?.away));
  const showNoBetFilteredBadge = Array.isArray(row.valueBet?.reasons)
    && row.valueBet.reasons.some((reason) => noBetReasonTokens.some((token) => reason.includes(token)))
    && !row.valueBet?.detected;

  return (
    <div
      onClick={onClick}
      className="relative isolate flex h-full flex-col rounded-[1.5rem] border border-white/5 bg-slate-900/30 p-4 sm:rounded-[2rem] sm:p-5 cursor-pointer transition-[border-color,box-shadow,background-color] duration-200 ease-out hover:border-emerald-500/50 hover:bg-slate-800/40 hover:shadow-lg"
    >
      <div className="flex justify-between items-start gap-3 mb-3 sm:mb-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[8px] sm:text-[9px] bg-white/5 text-slate-300 px-2 py-1 rounded-md uppercase font-black tracking-widest">{row.league}</span>
            {isLive && (
              <span className="flex items-center gap-1 text-[8px] sm:text-[9px] text-red-500 font-bold bg-red-500/10 px-2 py-1 rounded-md border border-red-500/20">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span> LIVE
              </span>
            )}
          </div>
          <div className="text-[8px] sm:text-[9px] text-slate-500 flex flex-wrap items-center gap-1 font-medium tracking-tight">
            📅 {kickoffDate.toLocaleDateString([], { day: "2-digit", month: "2-digit" })}
            <span className="opacity-50 mx-1">|</span>
            ⏱️ {new Date(row.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            <span className="opacity-50 mx-1">|</span> ⚖️ {row.referee || "-"}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <div className="text-[8px] text-slate-500 uppercase font-black tracking-wide">Top Pick</div>
            <div className="text-xs sm:text-sm font-black text-emerald-400">{row.recommended.pick}</div>
          </div>
          <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-slate-800/50 shadow-inner" style={{ background: `conic-gradient(${confColor} ${confPct}%, rgba(255,255,255,0.05) 0)` }}>
            <div className="w-7 h-7 sm:w-8 sm:h-8 bg-slate-900 rounded-full flex flex-col items-center justify-center text-[7px] sm:text-[8px] font-black text-white shadow-md leading-none">
              <span>{confPct}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {modelBadgeLabel && (
          <span className="text-[8px] px-2 py-0.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 text-cyan-200 font-black uppercase tracking-wide">
            Model: {modelBadgeLabel}
          </span>
        )}
        {showCalibratedBadge && (
          <span className="text-[8px] px-2 py-0.5 rounded-full border border-blue-400/30 bg-blue-500/10 text-blue-200 font-black uppercase tracking-wide">
            Calibrated
          </span>
        )}
        {showNoBetFilteredBadge && (
          <span className="text-[8px] px-2 py-0.5 rounded-full border border-amber-400/30 bg-amber-500/10 text-amber-200 font-black uppercase tracking-wide">
            No-bet filtered
          </span>
        )}
      </div>

      {row.valueBet?.detected && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-2.5 mb-3 sm:mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-[9px] sm:text-[10px] text-yellow-400 font-black uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <span>💎 Value: {row.valueBet.type}</span>
            {row.odds?.bookmaker && <span className="text-yellow-200/80">· {row.odds.bookmaker}</span>}
          </div>
          <div className="bg-black/20 px-2 py-1 rounded-lg border border-yellow-500/10">
            EV: +{row.valueBet.ev}% | Stake: {row.valueBet.kelly}%
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="w-1/3 text-center flex flex-col items-center gap-2">
          <img src={row.logos?.home} className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,0.4)]" alt="" />
          <div className="text-[10px] sm:text-[11px] font-bold text-slate-200 line-clamp-2 leading-tight tracking-tight">{row.teams.home}</div>
        </div>
        <div className="text-slate-600 font-black italic text-[9px] sm:text-[10px] bg-slate-800/40 px-2 py-1 rounded-md border border-white/5">VS</div>
        <div className="w-1/3 text-center flex flex-col items-center gap-2">
          <img src={row.logos?.away} className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,0.4)]" alt="" />
          <div className="text-[10px] sm:text-[11px] font-bold text-slate-200 line-clamp-2 leading-tight tracking-tight">{row.teams.away}</div>
        </div>
      </div>

      <XGPerformanceBar xg={xgData} />

      {row.luckStats && (
        <div className="flex flex-wrap justify-between mt-2 px-1 gap-2">
          <LuckBadge goals={row.luckStats.hG} xg={xgData?.homeXG ?? row.luckStats.hXG} />
          <LuckBadge goals={row.luckStats.aG} xg={xgData?.awayXG ?? row.luckStats.aXG} />
        </div>
      )}

      <div className="space-y-1.5 mb-3 sm:mb-4 mt-4 sm:mt-5">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800/50">
          <div
            style={{ width: `${row.probs.p1}%`, backgroundColor: homeColor }}
            className="shadow-[inset_-2px_0_4px_rgba(0,0,0,0.3)] transition-[width] duration-500 ease-out"
          />
          <div style={{ width: `${row.probs.pX}%` }} className="bg-slate-600 transition-[width] duration-500 ease-out" />
          <div
            style={{ width: `${row.probs.p2}%`, backgroundColor: awayColor }}
            className="shadow-[inset_2px_0_4px_rgba(0,0,0,0.3)] transition-[width] duration-500 ease-out"
          />
        </div>
        <div className="flex justify-between text-[7px] sm:text-[8px] font-black text-slate-400 uppercase px-1 gap-2">
          <span className={`${row.valueBet?.type === "1" ? "text-yellow-400" : ""}`}>{pct(row.probs.p1)}% · {row.odds?.home || "-"}</span>
          <span className="opacity-50">{pct(row.probs.pX)}% · {row.odds?.draw || "-"}</span>
          <span className={`${row.valueBet?.type === "2" ? "text-yellow-400" : ""}`}>{row.odds?.away || "-"} · {pct(row.probs.p2)}%</span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <span className="text-[8px] font-black uppercase px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">{row.predictions?.oneXtwo}</span>
        <span className="text-[8px] font-black uppercase px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">{row.predictions?.gg}</span>
        <span className="text-[8px] font-black uppercase px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">{row.predictions?.over25}</span>
      </div>

      <div className="mt-auto bg-slate-900/50 p-2.5 rounded-xl border border-white/5 flex flex-col items-center">
        {hasFinalScore && (
          <div className={`mt-2 text-[9px] font-black border rounded-lg px-2.5 py-1 uppercase tracking-wide ${finalScoreBadgeClass(finalPickResult)}`}>
            {finalScoreLabel(finalPickResult)} · {row.score?.home}-{row.score?.away}
          </div>
        )}
        {!hasFinalScore && (
          <div className="text-[8px] text-slate-500 uppercase font-black tracking-wider opacity-60">
            Rezultat final indisponibil
          </div>
        )}
      </div>
    </div>
  );
}
