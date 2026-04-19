import type { ReactNode } from "react";
import { useId } from "react";
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

export function SignalLens({ confidence, edge, className = "" }: SignalLensProps) {
  const c = Math.max(0, Math.min(100, confidence));
  const e = Math.max(0, Math.min(100, edge));
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-[8px] uppercase tracking-[0.18em] text-signal-inkMuted">
        <span className="font-semibold text-signal-petrol/90">Signal lens</span>
        <span className="font-mono text-signal-silver tabular-nums">
          C {Math.round(c)}% · E {Math.round(e)}%
        </span>
      </div>
      <div className="space-y-1.5">
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-signal-void ring-1 ring-white/5"
          title="Confidence"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-signal-petrolDeep to-signal-petrol transition-[width] duration-700 ease-out"
            style={{ width: `${c}%` }}
          />
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-signal-void ring-1 ring-white/5" title="Edge">
          <div
            className="h-full rounded-full bg-gradient-to-r from-signal-sage to-signal-mint transition-[width] duration-700 ease-out"
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

export function FormRibbon({ p1, pX, p2, homeTint, awayTint, className = "" }: FormRibbonProps) {
  const t = p1 + pX + p2 || 1;
  const w1 = (p1 / t) * 100;
  const wX = (pX / t) * 100;
  const w2 = (p2 / t) * 100;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between text-[8px] uppercase tracking-[0.18em] text-signal-inkMuted">
        <span className="font-semibold text-signal-petrol/80">Form ribbon</span>
        <span className="font-mono tabular-nums text-signal-silver">1 · X · 2</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-md bg-signal-void ring-1 ring-white/5">
        <div
          className="h-full transition-[width] duration-700 ease-out"
          style={{ width: `${w1}%`, backgroundColor: homeTint || "#38bdf8" }}
        />
        <div className="h-full bg-signal-stone/60 transition-[width] duration-700 ease-out" style={{ width: `${wX}%` }} />
        <div
          className="h-full transition-[width] duration-700 ease-out"
          style={{ width: `${w2}%`, backgroundColor: awayTint || "#34d399" }}
        />
      </div>
    </div>
  );
}

type EdgeCompassProps = {
  dataQuality: number;
  valueDetected: boolean;
  className?: string;
};

export function EdgeCompass({ dataQuality, valueDetected, className = "" }: EdgeCompassProps) {
  const gid = useId().replace(/:/g, "");
  const compassFillId = `compassFill-${gid}`;
  const dq = Math.max(0, Math.min(1, dataQuality));
  const angle = -90 + dq * 180;
  const label = valueDetected ? "Value bias" : dq >= 0.65 ? "Balanced" : dq >= 0.4 ? "Thin data" : "Caution";

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="relative h-12 w-12 shrink-0 rounded-xl border border-signal-line/40 bg-signal-void/80 shadow-inner ring-1 ring-signal-petrol/10"
        aria-hidden
      >
        <svg viewBox="0 0 48 48" className="h-full w-full">
          <defs>
            <linearGradient id={compassFillId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0.12" />
            </linearGradient>
          </defs>
          <path
            d="M24 6 L40 24 L24 42 L8 24 Z"
            fill={`url(#${compassFillId})`}
            stroke="rgba(56,189,248,0.25)"
            strokeWidth="1"
          />
          <line
            x1="24"
            y1="24"
            x2="24"
            y2="12"
            stroke={valueDetected ? "#fbbf24" : "#38bdf8"}
            strokeWidth="2"
            strokeLinecap="round"
            transform={`rotate(${angle} 24 24)`}
            className="motion-reduce:transition-none transition-transform duration-500"
          />
          <circle cx="24" cy="24" r="2.5" fill="#38bdf8" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[8px] uppercase tracking-[0.18em] text-signal-inkMuted">Edge compass</div>
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
  status: string;
  tone?: "healthy" | "watch" | "alert";
  className?: string;
};

export function ModelPulseStrip({ status, tone = "healthy", className = "" }: ModelPulseStripProps) {
  const ring =
    tone === "alert"
      ? "border-signal-rose/40 bg-signal-rose/10 shadow-[0_0_24px_rgba(251,113,133,0.15)]"
      : tone === "watch"
      ? "border-signal-amber/35 bg-signal-amber/8 shadow-[0_0_20px_rgba(251,191,36,0.1)]"
      : "border-signal-petrol/30 bg-signal-petrol/8 shadow-frost";
  const dot =
    tone === "alert" ? "bg-signal-rose shadow-[0_0_8px_#fb7185]" : tone === "watch" ? "bg-signal-amber" : "bg-signal-sage";
  return (
    <div
      className={`inline-flex max-w-full items-center gap-2.5 rounded-full border px-3.5 py-2 text-[10px] font-medium text-signal-ink ${ring} ${className}`}
      title={status}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot} motion-reduce:animate-none animate-pulse-soft`} />
      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-petrol/90">Model pulse</span>
      <span className="truncate text-signal-silver">{status}</span>
    </div>
  );
}

export function deriveDataQuality(row: PredictionRow): number {
  const d = row.modelMeta?.dataQuality;
  if (d != null && Number.isFinite(d)) return Math.max(0, Math.min(1, d));
  return 0.55;
}

type ConfidenceAuraProps = {
  value: number;
  className?: string;
  /** Compact ring for dense lists (match cards). */
  size?: "default" | "compact";
};

/** Conic confidence ring — soft sci-fi halo. */
export function ConfidenceAura({ value, className = "", size = "default" }: ConfidenceAuraProps) {
  const gradId = useId().replace(/:/g, "");
  const auraGrad = `auraGrad-${gradId}`;
  const v = Math.max(0, Math.min(100, value));
  const r = size === "compact" ? 16 : 20;
  const vb = size === "compact" ? 36 : 44;
  const c = vb / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (v / 100) * circumference;
  const dim = size === "compact" ? "h-[3.25rem] w-[3.25rem]" : "h-[4.5rem] w-[4.5rem]";
  return (
    <div className={`relative flex ${dim} shrink-0 items-center justify-center ${className}`} title={`Confidence ${Math.round(v)}%`}>
      <div
        className="absolute inset-0 rounded-full opacity-40 blur-xl motion-reduce:opacity-20"
        style={{
          background: `conic-gradient(from -90deg, rgba(56,189,248,0.5) ${v * 3.6}deg, transparent 0deg)`
        }}
      />
      <svg className="relative h-full w-full -rotate-90" viewBox={`0 0 ${vb} ${vb}`} aria-hidden>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={size === "compact" ? 2 : 2.5} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={`url(#${auraGrad})`}
          strokeWidth={size === "compact" ? 2 : 2.5}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="motion-reduce:transition-none transition-[stroke-dasharray] duration-700"
        />
        <defs>
          <linearGradient id={auraGrad} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop stopColor="#38bdf8" />
            <stop offset="1" stopColor="#34d399" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-mono font-semibold tabular-nums leading-none text-signal-ink ${size === "compact" ? "text-sm" : "text-lg"}`}
        >
          {Math.round(v)}
        </span>
        <span className={`font-mono uppercase tracking-widest text-signal-inkMuted ${size === "compact" ? "text-[7px]" : "text-[8px]"}`}>
          conf
        </span>
      </div>
    </div>
  );
}

/** Single-row micro meters: edge · data quality · value pulse (for scan-friendly cards). */
export function SignalScanStrip({
  edge,
  dataQuality,
  valueDetected,
  className = ""
}: {
  edge: number;
  dataQuality: number;
  valueDetected: boolean;
  className?: string;
}) {
  const e = Math.max(0, Math.min(100, edge));
  const dq = Math.max(0, Math.min(100, dataQuality * 100));
  const vPulse = valueDetected ? 88 : Math.min(100, e * 0.65 + dq * 0.35);
  return (
    <div
      className={`grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-3 ${className}`}
      aria-label="Signal scan: edge, data quality, value"
    >
      <div>
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="font-mono text-[8px] uppercase tracking-wider text-signal-inkMuted">Edge</span>
          <span className="font-mono text-[9px] tabular-nums text-signal-petrol/90">{Math.round(e)}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-signal-void ring-1 ring-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-signal-petrolDeep to-signal-petrol transition-[width] duration-500"
            style={{ width: `${e}%` }}
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="font-mono text-[8px] uppercase tracking-wider text-signal-inkMuted">Lens</span>
          <span className="font-mono text-[9px] tabular-nums text-signal-silver">{Math.round(dq)}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-signal-void ring-1 ring-white/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-signal-stone/50 to-signal-sage/80 transition-[width] duration-500"
            style={{ width: `${dq}%` }}
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="font-mono text-[8px] uppercase tracking-wider text-signal-inkMuted">Value</span>
          <span className={`font-mono text-[9px] tabular-nums ${valueDetected ? "text-signal-amber" : "text-signal-inkMuted"}`}>
            {valueDetected ? "ON" : "—"}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-signal-void ring-1 ring-white/5">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${valueDetected ? "bg-signal-amber/90" : "bg-signal-line/40"}`}
            style={{ width: `${vPulse}%` }}
          />
        </div>
      </div>
    </div>
  );
}

type PredictionDossierShellProps = {
  children: ReactNode;
  dossierId?: string;
  className?: string;
};

/** Editorial frame: corners + ref line — “prediction dossier”. */
export function PredictionDossierShell({ children, dossierId, className = "" }: PredictionDossierShellProps) {
  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`}>
      <div className="pointer-events-none absolute left-3 top-3 h-4 w-4 border-l border-t border-signal-petrol/35" />
      <div className="pointer-events-none absolute right-3 top-3 h-4 w-4 border-r border-t border-signal-petrol/35" />
      <div className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 border-b border-l border-signal-petrol/20" />
      <div className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 border-b border-r border-signal-petrol/20" />
      {dossierId && (
        <div className="absolute right-4 top-4 font-mono text-[9px] uppercase tracking-[0.2em] text-signal-inkMuted/80">
          {dossierId}
        </div>
      )}
      {children}
    </div>
  );
}
