import { PredictionRow } from "../types";

type ValueEngineData = NonNullable<PredictionRow["valueEngine"]>;
type MarketRow = NonNullable<ValueEngineData["markets"]>[number];

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

function marketSignal(m: MarketRow): keyof typeof SIGNAL_STYLES {
  if (m.signal === "positive" || m.signal === "neutral" || m.signal === "negative") return m.signal;
  if (m.negativeEV || (m.expectedValue ?? 0) < 0) return "negative";
  if (m.positiveEV) return "positive";
  return "neutral";
}

/**
 * Value Card — professional Value Betting Engine readout.
 *
 * Green = Positive EV · Yellow = Neutral · Red = Negative EV
 * Negative EV is never presented as a recommended bet.
 * Best market is highlighted across 1X2 / DC / BTTS / O/U / Corners / Cards.
 */
export default function ValueCard({ engine, bookmaker, compact = false, className = "" }: ValueCardProps) {
  const signal = resolveSignal(engine);
  const tone = SIGNAL_STYLES[signal];
  const recommendable = Boolean(
    engine.recommendable && engine.detected && !engine.negativeEV && (engine.expectedValue ?? 0) > 0
  );
  const ev = Number(engine.expectedValue) || 0;
  const kelly = Number(engine.kellyPct) || 0;
  const score = Math.round(Number(engine.valueScore) || 0);
  const selection = engine.bestMarket?.type || engine.type || "—";
  const family = engine.bestMarket?.family || engine.family || "";
  const markets = Array.isArray(engine.markets) ? engine.markets : [];
  const ranked = [...markets].sort(
    (a, b) => (Number(b.valueScore) || 0) - (Number(a.valueScore) || 0) || (Number(b.expectedValue) || 0) - (Number(a.expectedValue) || 0)
  );

  if (compact) {
    return (
      <div
        className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${tone.badge} ${className}`}
        title={`EV ${formatEv(ev)} · Kelly ${kelly}% · Score ${score} · ${selection} · ${tone.label}`}
      >
        <span className={tone.text}>EV</span>
        <span className="tabular-nums">{formatEv(ev)}</span>
        {recommendable && selection !== "—" ? (
          <span className="truncate opacity-90">· {selection}</span>
        ) : null}
        {!recommendable && signal === "negative" ? <span className="opacity-80">· skip</span> : null}
      </div>
    );
  }

  return (
    <section className={`rounded-2xl border p-5 ${tone.border} ${tone.bg} ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/5 pb-3">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol/80">
            Value Betting Engine
          </h3>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
            prediction probability × bookmaker odds
          </p>
          {bookmaker ? <p className="mt-1 text-[10px] text-signal-inkMuted">Operator · {bookmaker}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div
            className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${tone.badge}`}
          >
            {tone.label}
          </div>
          {recommendable ? (
            <div className="rounded-md border border-emerald-400/45 bg-emerald-500/20 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-emerald-200">
              Best market · {family ? `${family} · ` : ""}
              {selection}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Expected Value" value={formatEv(ev)} tone={tone.text} />
        <Metric label="Kelly Stake" value={`${kelly.toFixed(2)}%`} tone="text-signal-silver" />
        <Metric label="Value Score" value={`${score}`} tone="text-signal-silver" />
        <Metric label="Selection" value={selection} tone="text-signal-silver" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Flag
          active={Boolean(engine.positiveEV)}
          label="Positive EV"
          activeClass="border-emerald-400/35 bg-emerald-500/15 text-emerald-300"
        />
        <Flag
          active={signal === "neutral"}
          label="Neutral"
          activeClass="border-amber-400/35 bg-amber-500/15 text-amber-200"
        />
        <Flag
          active={Boolean(engine.negativeEV)}
          label="Negative EV"
          activeClass="border-rose-400/35 bg-rose-500/15 text-rose-300"
        />
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
          No value recommendation — no Positive EV market cleared Kelly / edge guards.
        </p>
      ) : null}

      {recommendable ? (
        <p className="mt-4 font-mono text-[10px] text-emerald-200/90">
          Best market highlighted · stake guide {kelly.toFixed(2)}% bankroll (fractional Kelly).
        </p>
      ) : null}

      {ranked.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/5 bg-signal-void/35">
          <table className="w-full min-w-[420px] border-collapse text-left font-mono text-[10px]">
            <thead>
              <tr className="border-b border-white/8 text-[8px] uppercase tracking-wider text-signal-inkMuted">
                <th className="px-2.5 py-2 font-medium">Market</th>
                <th className="px-2.5 py-2 font-medium">Family</th>
                <th className="px-2.5 py-2 text-right font-medium">EV</th>
                <th className="px-2.5 py-2 text-right font-medium">Kelly</th>
                <th className="px-2.5 py-2 text-right font-medium">Score</th>
                <th className="px-2.5 py-2 text-right font-medium">Flag</th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, 12).map((m, idx) => {
                const ms = marketSignal(m);
                const isBest = Boolean(m.bestMarket || (recommendable && m.type === selection && m.family === family));
                return (
                  <tr
                    key={`${m.family}-${m.type}-${idx}`}
                    className={`border-b border-white/[0.04] last:border-0 ${
                      isBest ? "bg-emerald-500/10" : ""
                    }`}
                  >
                    <td className="px-2.5 py-1.5 text-signal-ink">
                      {isBest ? <span className="mr-1 text-emerald-300">★</span> : null}
                      {m.type || "—"}
                    </td>
                    <td className="px-2.5 py-1.5 text-signal-inkMuted">{m.family || "—"}</td>
                    <td className={`px-2.5 py-1.5 text-right tabular-nums ${SIGNAL_STYLES[ms].text}`}>
                      {formatEv(m.expectedValue)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-signal-silver">
                      {(Number(m.kellyPct) || 0).toFixed(2)}%
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-signal-silver">
                      {Math.round(Number(m.valueScore) || 0)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <span className={`rounded border px-1 py-0.5 text-[8px] uppercase ${SIGNAL_STYLES[ms].badge}`}>
                        {m.negativeEV ? "Neg" : m.positiveEV ? "Pos" : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-white/5 px-2.5 py-1.5 font-mono text-[9px] text-signal-inkMuted">
            Supported · {(engine.familiesSupported || ["1X2", "Double Chance", "BTTS", "Over/Under", "Corners", "Cards"]).join(" · ")}
            {engine.positiveEvCount != null ? ` · +EV ${engine.positiveEvCount}` : ""}
            {engine.negativeEvCount != null ? ` · −EV ${engine.negativeEvCount}` : ""}
          </div>
        </div>
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
