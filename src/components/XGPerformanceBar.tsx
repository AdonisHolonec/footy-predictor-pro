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
    <div className="relative mt-3 rounded-2xl border border-signal-line/80 bg-white/50 px-3 py-3 shadow-inner">
      <div className="mb-2 flex justify-center px-1">
        <span className="text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-signal-inkMuted">xG intensity</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-1 flex-col items-end">
          <span className="mb-1 font-mono text-[11px] font-semibold text-signal-petrolMuted">{safeHomeXG.toFixed(2)}</span>
          <div className="h-1.5 w-full overflow-hidden rounded-full border border-signal-line/50 bg-signal-fog">
            <div
              className="h-full bg-gradient-to-r from-signal-petrol to-signal-petrolMuted transition-[width] duration-500 ease-out"
              style={{ width: `${hW}%` }}
            />
          </div>
        </div>
        <div className="font-display text-[8px] italic text-signal-stone">v</div>
        <div className="flex flex-1 flex-col items-start">
          <span className="mb-1 font-mono text-[11px] font-semibold text-signal-sage">{safeAwayXG.toFixed(2)}</span>
          <div className="h-1.5 w-full overflow-hidden rounded-full border border-signal-line/50 bg-signal-fog">
            <div
              className="h-full bg-gradient-to-r from-signal-sage to-signal-mint transition-[width] duration-500 ease-out"
              style={{ width: `${aW}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
