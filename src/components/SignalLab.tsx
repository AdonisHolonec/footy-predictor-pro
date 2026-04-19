import type { PredictionRow } from "../types";

/** Edge / value intensity 0–100 for UI (EV, spread, or conviction). */
export function deriveSignalEdge(row: PredictionRow): number {
  if (row.valueBet?.detected && row.valueBet.ev != null && Number.isFinite(row.valueBet.ev)) {
    return Math.min(100, Math.max(0, 45 + row.valueBet.ev * 2.2));
  }
  const m = Math.max(row.probs.p1, row.probs.pX, row.probs.p2);
  return Math.min(100, Math.max(0, (m - 33.33) * 1.8 + 40));
}

type SignalLensProps = {
  confidence: number;
  edge: number;
  className?: string;
};

/** Dual strip: confidence (petrol/teal) vs edge / conviction (sage/mint). */
export function SignalLens({ confidence, edge, className = "" }: SignalLensProps) {
  const c = Math.max(0, Math.min(100, confidence));
  const e = Math.max(0, Math.min(100, edge));
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between text-[8px] uppercase tracking-[0.12em] text-signal-inkMuted font-semibold">
        <span>Signal lens</span>
        <span className="font-mono text-signal-petrol tabular-nums">
          conf {Math.round(c)}% · edge {Math.round(e)}%
        </span>
      </div>
      <div className="space-y-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full border border-signal-line/80 bg-white/60 shadow-inner" title="Confidence">
          <div
            className="h-full rounded-full bg-gradient-to-r from-signal-petrol to-signal-petrolMuted transition-[width] duration-500 ease-out"
            style={{ width: `${c}%` }}
          />
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full border border-signal-line/80 bg-white/60 shadow-inner" title="Edge / conviction">
          <div
            className="h-full rounded-full bg-gradient-to-r from-signal-sage to-signal-mint transition-[width] duration-500 ease-out"
            style={{ width: `${e}%` }}
          />
        </div>
      </div>
    </div>
  );
}

type FormRibbonProps = {
  p1: number;
  pX: number;
  p2: number;
  homeTint?: string;
  awayTint?: string;
  className?: string;
};

/** Recent market-shape ribbon from 1X2 model probabilities. */
export function FormRibbon({ p1, pX, p2, homeTint, awayTint, className = "" }: FormRibbonProps) {
  const t = p1 + pX + p2 || 1;
  const w1 = (p1 / t) * 100;
  const wX = (pX / t) * 100;
  const w2 = (p2 / t) * 100;
  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center justify-between text-[8px] uppercase tracking-[0.12em] text-signal-inkMuted font-semibold">
        <span>Form ribbon</span>
        <span className="font-mono tabular-nums text-signal-petrol/90">1 · X · 2</span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-lg border border-signal-line bg-white/40 shadow-inner">
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{ width: `${w1}%`, backgroundColor: homeTint || "#134842" }}
        />
        <div className="h-full bg-signal-stone/50 transition-[width] duration-500 ease-out" style={{ width: `${wX}%` }} />
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{ width: `${w2}%`, backgroundColor: awayTint || "#6d8f7e" }}
        />
      </div>
    </div>
  );
}

type EdgeCompassProps = {
  /** Data quality 0–1 from modelMeta, or derived. */
  dataQuality: number;
  valueDetected: boolean;
  className?: string;
};

/** Risk / value / data quality compass (diamond + needle). */
export function EdgeCompass({ dataQuality, valueDetected, className = "" }: EdgeCompassProps) {
  const dq = Math.max(0, Math.min(1, dataQuality));
  const angle = -90 + dq * 180;
  const label = valueDetected ? "Value bias" : dq >= 0.65 ? "Balanced" : dq >= 0.4 ? "Thin data" : "Caution";

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="relative h-12 w-12 shrink-0 rounded-2xl border border-signal-line bg-white/50 shadow-inner"
        aria-hidden
      >
        <svg viewBox="0 0 48 48" className="h-full w-full">
          <defs>
            <linearGradient id="compassFill" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0c302c" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#6d8f7e" stopOpacity="0.2" />
            </linearGradient>
          </defs>
          <path
            d="M24 6 L40 24 L24 42 L8 24 Z"
            fill="url(#compassFill)"
            stroke="rgba(12,48,44,0.15)"
            strokeWidth="1"
          />
          <line
            x1="24"
            y1="24"
            x2="24"
            y2="12"
            stroke={valueDetected ? "#c9a04a" : "#0c302c"}
            strokeWidth="2"
            strokeLinecap="round"
            transform={`rotate(${angle} 24 24)`}
            className="motion-reduce:transition-none transition-transform duration-500"
          />
          <circle cx="24" cy="24" r="2.5" fill="#0c302c" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[8px] uppercase tracking-[0.12em] text-signal-inkMuted font-semibold">Edge compass</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[10px]">
          <span className="font-mono tabular-nums text-signal-petrol">DQ {(dq * 100).toFixed(0)}%</span>
          <span
            className={`font-medium ${
              valueDetected ? "text-signal-amber" : dq < 0.4 ? "text-signal-rose" : "text-signal-sage"
            }`}
          >
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

type ModelPulseStripProps = {
  /** short status line */
  status: string;
  /** healthy | watch | alert */
  tone?: "healthy" | "watch" | "alert";
  className?: string;
};

export function ModelPulseStrip({ status, tone = "healthy", className = "" }: ModelPulseStripProps) {
  const ring =
    tone === "alert"
      ? "border-signal-rose/35 bg-signal-rose/8"
      : tone === "watch"
      ? "border-signal-amber/40 bg-signal-amber/10"
      : "border-signal-sage/35 bg-signal-mintSoft/25";
  const dot =
    tone === "alert" ? "bg-signal-rose" : tone === "watch" ? "bg-signal-amberSoft" : "bg-signal-sage";
  return (
    <div
      className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-medium text-signal-ink shadow-inner ${ring} ${className}`}
      title={status}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot} motion-reduce:animate-none animate-pulse-soft`} />
      <span className="truncate font-mono text-[9px] uppercase tracking-wide text-signal-inkMuted">Calibration</span>
      <span className="truncate text-signal-petrol">{status}</span>
    </div>
  );
}

export function deriveDataQuality(row: PredictionRow): number {
  const d = row.modelMeta?.dataQuality;
  if (d != null && Number.isFinite(d)) return Math.max(0, Math.min(1, d));
  return 0.55;
}
