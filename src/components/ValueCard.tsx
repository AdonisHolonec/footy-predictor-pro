import { PredictionRow } from "../types";

type ValueEngineData = NonNullable<PredictionRow["valueEngine"]>;

type ValueCardProps = {
  engine: ValueEngineData;
  bookmaker?: string;
  /** Compact strip for MatchCard; default is the full MatchModal card. */
  compact?: boolean;
  className?: string;
};

const SIGNAL_STYLES: Record<
  NonNullable<ValueEngineData["signal"]>,
  { border: string; bg: string; text: string; label: string; badge: string }
> = {
  positive: {
    border: "border-emerald-400/40",
    bg: "bg-emerald-500/10",
    text: "text-emerald-300",
    label: "Positive EV",
    badge: "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
  },
  neutral: {
    border: "border-amber-400/40",
    bg: "bg-amber-500/10",
    text: "text-amber-200",
    label: "Neutral",
    badge: "border-amber-400/40 bg-amber-500/15 text-amber-200"
  },
  negative: {
    border: "border-rose-400/40",
    bg: "bg-rose-500/10",
    text: "text-rose-300",
    label: "Negative EV",
    badge: "border-rose-400/40 bg-rose-500/15 text-rose-300"
  }
};

function resolveSignal(engine: ValueEngineData): keyof typeof SIGNAL_STYLES {
  if (engine.signal === "positive" || engine.signal === "neutral" || engine.signal === "negative") {
    return engine.signal;
  }
  if (engine.negativeEV || (engine.expectedValue ?? 0) < 0) return "negative";
  if (engine.positiveEV && (engine.expectedValue ?? 0) >= 1.25) return "positive";
  return "neutral";
}

function formatEv(ev: number | undefined): string {
  const n = Number(ev) || 0;
  if (n > 0) return `+${n.toFixed(2)}%`;
  return `${n.toFixed(2)}%`;
}

/**
 * Value Card — visual readout of the Value Betting Engine.
 *
 * Green = Positive EV · Yellow = Neutral · Red = Negative EV
 * Negative EV is never presented as a recommended bet.
 */
export default function ValueCard({ engine, bookmaker, compact = false, className = "" }: ValueCardProps) {
  const signal = resolveSignal(engine);
  const tone = SIGNAL_STYLES[signal];
  const recommendable = Boolean(engine.recommendable && engine.detected && !engine.negativeEV && (engine.expectedValue ?? 0) > 0);
  const ev = Number(engine.expectedValue) || 0;
  const kelly = Number(engine.kellyPct) || 0;
  const score = Math.round(Number(engine.valueScore) || 0);
  const selection = engine.type || "—";

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${tone.badge} ${className}`}
        title={`EV ${formatEv(ev)} · Kelly ${kelly}% · Score ${score} · ${tone.label}`}
      >
        <span className={tone.text}>EV</span>
        <span className="tabular-nums">{formatEv(ev)}</span>
        {!recommendable && signal === "negative" ? <span className="opacity-80">· skip</span> : null}
      </div>
    );
  }

  return (
    <section className={`rounded-2xl border p-5 ${tone.border} ${tone.bg} ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/5 pb-3">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">Value Engine</h3>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
            predicted probability × bookmaker odds
          </p>
          {bookmaker ? <p className="mt-1 text-[10px] text-signal-inkMuted">Operator · {bookmaker}</p> : null}
        </div>
        <div
          className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${tone.badge}`}
        >
          {tone.label}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Expected Value" value={formatEv(ev)} tone={tone.text} />
        <Metric label="Kelly %" value={`${kelly.toFixed(2)}%`} tone="text-signal-silver" />
        <Metric label="Value Score" value={`${score}`} tone="text-signal-silver" />
        <Metric label="Selection" value={selection} tone="text-signal-silver" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Flag active={Boolean(engine.positiveEV)} label="Positive EV" activeClass="border-emerald-400/35 bg-emerald-500/15 text-emerald-300" />
        <Flag active={signal === "neutral"} label="Neutral" activeClass="border-amber-400/35 bg-amber-500/15 text-amber-200" />
        <Flag active={Boolean(engine.negativeEV)} label="Negative EV" activeClass="border-rose-400/35 bg-rose-500/15 text-rose-300" />
        <Flag
          active={recommendable}
          label={recommendable ? "Recommendable" : "Not recommended"}
          activeClass="border-emerald-400/35 bg-emerald-500/15 text-emerald-300"
          inactiveClass="border-white/10 bg-signal-void/30 text-signal-inkMuted"
        />
      </div>

      {engine.negativeEV || ev < 0 ? (
        <p className="mt-4 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 font-mono text-[10px] text-rose-200">
          Negative EV — never recommend this bet.
        </p>
      ) : null}

      {!recommendable && !engine.negativeEV && ev >= 0 ? (
        <p className="mt-4 font-mono text-[10px] text-signal-inkMuted">
          No value recommendation — EV is not above the Positive EV threshold (or stake guards failed).
        </p>
      ) : null}

      {recommendable ? (
        <p className="mt-4 font-mono text-[10px] text-emerald-200/90">
          Positive EV value bet · stake guide {kelly.toFixed(2)}% bankroll (fractional Kelly).
        </p>
      ) : null}

      {Array.isArray(engine.explanation) && engine.explanation.length > 0 ? (
        <ul className="mt-3 space-y-1 font-mono text-[9px] text-signal-inkMuted">
          {engine.explanation.slice(0, 3).map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-signal-void/30 px-3 py-2.5 text-center">
      <div className="font-mono text-[8px] uppercase tracking-wider text-signal-inkMuted">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function Flag({
  active,
  label,
  activeClass,
  inactiveClass = "border-white/5 bg-signal-void/20 text-signal-inkMuted/70"
}: {
  active: boolean;
  label: string;
  activeClass: string;
  inactiveClass?: string;
}) {
  return (
    <div
      className={`rounded-lg border px-2 py-1.5 text-center font-mono text-[9px] uppercase tracking-wider ${
        active ? activeClass : inactiveClass
      }`}
    >
      {label}
    </div>
  );
}
