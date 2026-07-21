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
    <div className="relative w-full rounded-2xl border border-white/10 bg-signal-void/60 px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-4 flex justify-center">
        <span className="text-center font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-signal-petrol sm:text-xs">
          xG intensity
        </span>
      </div>
      <div className="flex items-center gap-4 sm:gap-6">
        <div className="flex min-w-0 flex-1 flex-col items-end">
          <span className="mb-2 font-mono text-base font-bold tabular-nums text-signal-petrol sm:text-lg">
            {safeHomeXG.toFixed(2)}
          </span>
          <div className="h-3 w-full overflow-hidden rounded-full bg-signal-mist ring-1 ring-white/10 sm:h-3.5">
            <div
              className="h-full bg-gradient-to-r from-signal-petrolDeep to-signal-petrol transition-[width] duration-500 ease-out"
              style={{ width: `${hW}%` }}
            />
          </div>
        </div>
        <div className="shrink-0 font-display text-xs italic text-signal-stone sm:text-sm">v</div>
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <span className="mb-2 font-mono text-base font-bold tabular-nums text-signal-sage sm:text-lg">
            {safeAwayXG.toFixed(2)}
          </span>
          <div className="h-3 w-full overflow-hidden rounded-full bg-signal-mist ring-1 ring-white/10 sm:h-3.5">
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
