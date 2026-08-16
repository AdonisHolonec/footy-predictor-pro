import type { ReactNode } from "react";
import { useId } from "react";
import { useLocale } from "../context/LocaleContext";
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
  const { t } = useLocale();
  const c = Math.max(0, Math.min(100, confidence));
  const e = Math.max(0, Math.min(100, edge));
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">
        <span className="font-semibold text-fp-accent/90">{t("panels.signalLens")}</span>
        <span className="font-mono text-[var(--fp-text)] tabular-nums">
          C {Math.round(c)}% · E {Math.round(e)}%
        </span>
      </div>
      <div className="space-y-1.5">
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-[var(--fp-bg-muted)] ring-1 ring-[var(--fp-border)]"
          title={t("panels.confidenceBar")}
        >
          <div
            className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[var(--fp-accent-hover)] to-[var(--fp-accent)] transition-transform duration-700 ease-out"
            style={{ transform: `scaleX(${c / 100})` }}
          />
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--fp-bg-muted)] ring-1 ring-[var(--fp-border)]" title={t("panels.edgeBar")}>
          <div
            className="h-full w-full origin-left rounded-full bg-gradient-to-r from-fp-success/70 to-[var(--fp-success)] transition-transform duration-700 ease-out"
            style={{ transform: `scaleX(${e / 100})` }}
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
  const { t } = useLocale();
  const sum = p1 + pX + p2 || 1;
  const w1 = (p1 / sum) * 100;
  const wX = (pX / sum) * 100;
  const w2 = (p2 / sum) * 100;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">
        <span className="font-semibold text-fp-accent/80">{t("panels.formRibbon")}</span>
        <span className="font-mono tabular-nums text-[var(--fp-text)]">1 · X · 2</span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-md bg-[var(--fp-bg-muted)] ring-1 ring-[var(--fp-border)]">
        <div
          className="h-full transition-[width] duration-700 ease-out"
          style={{ width: `${w1}%`, backgroundColor: homeTint || "#38bdf8" }}
        />
        <div className="h-full bg-[var(--fp-border-strong)] transition-[width] duration-700 ease-out" style={{ width: `${wX}%` }} />
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
  const { t } = useLocale();
  const gid = useId().replace(/:/g, "");
  const compassFillId = `compassFill-${gid}`;
  const dq = Math.max(0, Math.min(1, dataQuality));
  const angle = -90 + dq * 180;
  const label = valueDetected
    ? t("panels.valueBias")
    : dq >= 0.65
      ? t("panels.balanced")
      : dq >= 0.4
        ? t("panels.thinData")
        : t("panels.caution");

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="relative h-12 w-12 shrink-0 rounded-xl border border-[var(--fp-border)] bg-fp-bg-muted/80 shadow-inner ring-1 ring-fp-accent/10"
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
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">{t("panels.edgeCompass")}</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[10px]">
          <span className="font-mono tabular-nums text-[var(--fp-accent)]">DQ {(dq * 100).toFixed(0)}%</span>
          <span
            className={`font-medium ${
              valueDetected ? "text-[var(--fp-warning)]" : dq < 0.4 ? "text-[var(--fp-danger)]" : "text-[var(--fp-success)]"
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
      ? "border-fp-danger/40 bg-fp-danger/10 shadow-[0_0_24px_rgba(239,68,68,0.15)]"
      : tone === "watch"
      ? "border-fp-warning/35 bg-fp-warning/8 shadow-[0_0_20px_rgba(245,158,11,0.1)]"
      : "border-fp-accent/30 bg-fp-accent/8 shadow-fp-sm";
  const dot =
    tone === "alert" ? "bg-[var(--fp-danger)] shadow-[0_0_8px_#ef4444]" : tone === "watch" ? "bg-[var(--fp-warning)]" : "bg-[var(--fp-success)]";
  return (
    <div
      className={`inline-flex max-w-full items-center gap-2.5 rounded-full border px-3.5 py-2 text-[10px] font-medium text-[var(--fp-text)] ${ring} ${className}`}
      title={status}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot} motion-reduce:animate-none animate-pulse-soft`} />
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fp-accent/90">Model pulse</span>
      <span className="truncate text-[var(--fp-text)]">{status}</span>
    </div>
  );
}

/** Wide oscilloscope-style strip — matches reference dashboards (“MODEL PULSE · waveform”). */
export function ModelPulseWave({
  status = "OPTIMAL CALIBRATION",
  className = ""
}: {
  status?: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const gid = `mpw-glow-${uid}`;
  const pathId = `mpw-path-${uid}`;
  const wavePath =
    "M0,32 Q30,10 60,32 T120,28 T180,34 T240,22 T300,30 T360,26 T420,32 T480,28 T540,32 L540,48 L0,48 Z";
  const linePath = "M0,30 C45,8 90,42 135,26 S225,6 270,28 S360,38 405,24 S495,14 540,30";

  return (
    <div
      className={`relative overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-gradient-to-r from-fp-bg-muted/90 via-fp-bg-card/80 to-fp-bg-muted/90 px-4 py-3 shadow-inner backdrop-blur-md ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(37,99,235,0.1),transparent)]" />
      <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-fp-accent/95">Model pulse</span>
          <span className="hidden h-3 w-px bg-[var(--fp-border)] sm:block" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-wider text-fp-success/95">{status}</span>
        </div>
        <div className="font-mono text-[10px] tabular-nums text-[var(--fp-text-muted)] sm:text-right">
          <span className="text-[var(--fp-success)]">●</span> stream active
        </div>
      </div>
      <div className="relative mt-2 h-11 w-full sm:h-12">
        <svg className="h-full w-full" viewBox="0 0 540 48" preserveAspectRatio="none" aria-hidden role="presentation">
          <defs>
            <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.15" />
              <stop offset="40%" stopColor="#5eead4" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id={pathId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#5eead4" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          <path d={wavePath} fill={`url(#${gid})`} className="motion-reduce:opacity-90" />
          <path
            d={linePath}
            fill="none"
            stroke={`url(#${pathId})`}
            strokeWidth="1.75"
            strokeLinecap="round"
            className="opacity-95"
          />
        </svg>
      </div>
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
        className="absolute inset-0 rounded-full opacity-70 blur-xl motion-reduce:opacity-35"
        style={{
          background: `conic-gradient(from -90deg, var(--fp-accent-muted) ${v * 3.6}deg, transparent 0deg)`
        }}
      />
      <svg className="relative h-full w-full -rotate-90" viewBox={`0 0 ${vb} ${vb}`} aria-hidden>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--fp-border)" strokeWidth={size === "compact" ? 2 : 2.5} />
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
            <stop stopColor="var(--fp-accent-hover)" />
            <stop offset="1" stopColor="var(--fp-accent)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-mono font-semibold tabular-nums leading-none text-[var(--fp-text)] ${size === "compact" ? "text-sm" : "text-lg"}`}
        >
          {Math.round(v)}
        </span>
        <span className={`font-mono uppercase tracking-widest text-[var(--fp-text-muted)] ${size === "compact" ? "text-[10px]" : "text-[10px]"}`}>
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
      className={`grid grid-cols-3 gap-2 border-t border-[var(--fp-border)] pt-3 ${className}`}
      aria-label="Signal scan: edge, data quality, value"
    >
      <div>
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">Edge</span>
          <span className="font-mono text-[10px] tabular-nums text-fp-accent/90">{Math.round(e)}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--fp-bg-muted)] ring-1 ring-[var(--fp-border)]">
          <div
            className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[var(--fp-accent-hover)] to-[var(--fp-accent)] transition-transform duration-500"
            style={{ transform: `scaleX(${e / 100})` }}
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">Lens</span>
          <span className="font-mono text-[10px] tabular-nums text-[var(--fp-text)]">{Math.round(dq)}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--fp-bg-muted)] ring-1 ring-[var(--fp-border)]">
          <div
            className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[var(--fp-border-strong)] to-fp-success/80 transition-transform duration-500"
            style={{ transform: `scaleX(${dq / 100})` }}
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">Value</span>
          <span className={`font-mono text-[10px] tabular-nums ${valueDetected ? "text-[var(--fp-warning)]" : "text-[var(--fp-text-muted)]"}`}>
            {valueDetected ? "ON" : "—"}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--fp-bg-muted)] ring-1 ring-[var(--fp-border)]">
          <div
            className={`h-full w-full origin-left rounded-full transition-transform duration-500 ${valueDetected ? "bg-fp-warning/90" : "bg-[var(--fp-border)]"}`}
            style={{ transform: `scaleX(${vPulse / 100})` }}
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
    <div className={`relative overflow-hidden rounded-[var(--fp-radius)] ${className}`}>
      <div className="pointer-events-none absolute left-3 top-3 h-4 w-4 border-l border-t border-fp-accent/35" />
      <div className="pointer-events-none absolute right-3 top-3 h-4 w-4 border-r border-t border-fp-accent/35" />
      <div className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 border-b border-l border-fp-accent/20" />
      <div className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 border-b border-r border-fp-accent/20" />
      {dossierId && (
        <div className="absolute right-4 top-4 font-mono text-[10px] uppercase tracking-[0.14em] text-fp-text-muted/80">
          {dossierId}
        </div>
      )}
      {children}
    </div>
  );
}
