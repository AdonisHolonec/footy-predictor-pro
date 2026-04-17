import { XGData } from "../types";

type XGPerformanceBarProps = {
  xg: XGData | null | undefined;
};

export default function XGPerformanceBar({ xg }: XGPerformanceBarProps) {
  if (!xg) return null;

  const homeXG = Number(xg.homeXG);
  const awayXG = Number(xg.awayXG);
  const safeHomeXG = Number.isFinite(homeXG) ? homeXG : 0;
  const safeAwayXG = Number.isFinite(awayXG) ? awayXG : 0;
  const hW = Math.min((safeHomeXG / 4) * 100, 100);
  const aW = Math.min((safeAwayXG / 4) * 100, 100);

  return (
    <div className="mt-4 px-3 py-3 bg-black/40 rounded-2xl border border-white/5 shadow-inner">
      <div className="flex justify-between items-center mb-2 px-1">
        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest text-center w-full opacity-70">xG Intensity Gauge</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex-1 flex flex-col items-end">
          <span className="text-[11px] font-mono font-bold text-emerald-400 mb-1">{safeHomeXG.toFixed(2)}</span>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-1000 ease-out" style={{ width: `${hW}%` }} />
          </div>
        </div>
        <div className="text-[8px] font-black text-slate-700 italic">VS</div>
        <div className="flex-1 flex flex-col items-start">
          <span className="text-[11px] font-mono font-bold text-blue-400 mb-1">{safeAwayXG.toFixed(2)}</span>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-1000 ease-out" style={{ width: `${aW}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
