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
    border: "border-[var(--fp-success)]/40",
    bg: "bg-[var(--fp-success)]/10",
    text: "text-[var(--fp-success)]",
    label: "Positive EV",
    badge: "border-[var(--fp-success)]/40 bg-[var(--fp-success)]/15 text-[var(--fp-success)]"
  },
  neutral: {
    border: "border-[var(--fp-warning)]/40",
    bg: "bg-[var(--fp-warning)]/10",
    text: "text-[var(--fp-warning)]",
    label: "Neutral",
    badge: "border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/15 text-[var(--fp-warning)]"
  },
  negative: {
    border: "border-[var(--fp-danger)]/40",
    bg: "bg-[var(--fp-danger)]/10",
    text: "text-[var(--fp-danger)]",
    label: "Negative EV",
    badge: "border-[var(--fp-danger)]/40 bg-[var(--fp-danger)]/15 text-[var(--fp-danger)]"
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
    <section
      className={`rounded-[var(--fp-radius)] border bg-[var(--fp-bg-card)] p-4 shadow-[var(--fp-shadow-sm)] sm:p-5 ${tone.border} ${className}`}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--fp-border)] pb-3">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">Value Betting Engine</h3>
          <p className="mt-1 text-xs font-medium text-[var(--fp-text-muted)]">prediction probability × bookmaker odds</p>
          {bookmaker ? <p className="mt-1 text-xs font-medium text-[var(--fp-text-muted)]">Operator · {bookmaker}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tone.badge}`}>
            {tone.label}
          </div>
          {recommendable ? (
            <div className="rounded-md border border-[var(--fp-success)]/45 bg-[var(--fp-success)]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--fp-success)]">
              Best market · {family ? `${family} · ` : ""}
              {selection}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Expected Value" value={formatEv(ev)} tone={tone.text} />
        <Metric label="Kelly Stake" value={`${kelly.toFixed(2)}%`} tone="text-[var(--fp-text)]" />
        <Metric label="Value Score" value={`${score}`} tone="text-[var(--fp-text)]" />
        <Metric label="Selection" value={selection} tone="text-[var(--fp-text)]" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Flag
          active={Boolean(engine.positiveEV)}
          label="Positive EV"
          activeClass="border-[var(--fp-success)]/35 bg-[var(--fp-success)]/15 text-[var(--fp-success)]"
        />
        <Flag
          active={signal === "neutral"}
          label="Neutral"
          activeClass="border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/15 text-[var(--fp-warning)]"
        />
        <Flag
          active={Boolean(engine.negativeEV)}
          label="Negative EV"
          activeClass="border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/15 text-[var(--fp-danger)]"
        />
        <Flag
          active={recommendable}
          label={recommendable ? "Recommendable" : "Not recommended"}
          activeClass="border-[var(--fp-success)]/35 bg-[var(--fp-success)]/15 text-[var(--fp-success)]"
          inactiveClass="border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"
        />
      </div>

      {engine.negativeEV || ev < 0 ? (
        <p className="mt-4 rounded-lg border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-3 py-2 text-xs font-semibold text-[var(--fp-danger)]">
          Negative EV — never recommend this bet.
        </p>
      ) : null}

      {!recommendable && !engine.negativeEV && ev >= 0 ? (
        <p className="mt-4 text-xs font-medium text-[var(--fp-text-muted)]">
          No value recommendation — no Positive EV market cleared Kelly / edge guards.
        </p>
      ) : null}

      {recommendable ? (
        <p className="mt-4 text-xs font-semibold text-[var(--fp-success)]">
          Best market highlighted · stake guide {kelly.toFixed(2)}% bankroll (fractional Kelly).
        </p>
      ) : null}

      {ranked.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]">
          <table className="w-full min-w-[420px] border-collapse text-left text-[10px]">
            <thead>
              <tr className="border-b border-[var(--fp-border)] text-[8px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
                <th className="px-2.5 py-2">Market</th>
                <th className="px-2.5 py-2">Family</th>
                <th className="px-2.5 py-2 text-right">EV</th>
                <th className="px-2.5 py-2 text-right">Kelly</th>
                <th className="px-2.5 py-2 text-right">Score</th>
                <th className="px-2.5 py-2 text-right">Flag</th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, 12).map((m, idx) => {
                const ms = marketSignal(m);
                const isBest = Boolean(m.bestMarket || (recommendable && m.type === selection && m.family === family));
                return (
                  <tr
                    key={`${m.family}-${m.type}-${idx}`}
                    className={`border-b border-[var(--fp-border)] last:border-0 ${
                      isBest ? "bg-[var(--fp-success)]/10" : "bg-[var(--fp-bg-card)]"
                    }`}
                  >
                    <td className="px-2.5 py-1.5 font-semibold text-[var(--fp-text)]">
                      {isBest ? <span className="mr-1 text-[var(--fp-success)]">★</span> : null}
                      {m.type || "—"}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--fp-text-muted)]">{m.family || "—"}</td>
                    <td className={`px-2.5 py-1.5 text-right font-bold tabular-nums ${SIGNAL_STYLES[ms].text}`}>
                      {formatEv(m.expectedValue)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-[var(--fp-text)]">
                      {(Number(m.kellyPct) || 0).toFixed(2)}%
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-[var(--fp-text)]">
                      {Math.round(Number(m.valueScore) || 0)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <span className={`rounded border px-1 py-0.5 text-[8px] font-bold uppercase ${SIGNAL_STYLES[ms].badge}`}>
                        {m.negativeEV ? "Neg" : m.positiveEV ? "Pos" : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-[var(--fp-border)] px-2.5 py-1.5 text-[9px] font-medium text-[var(--fp-text-muted)]">
            Supported · {(engine.familiesSupported || ["1X2", "Double Chance", "BTTS", "Over/Under", "Corners", "Cards"]).join(" · ")}
            {engine.positiveEvCount != null ? ` · +EV ${engine.positiveEvCount}` : ""}
            {engine.negativeEvCount != null ? ` · −EV ${engine.negativeEvCount}` : ""}
          </div>
        </div>
      ) : null}

      {Array.isArray(engine.explanation) && engine.explanation.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs font-medium text-[var(--fp-text-muted)]">
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
    <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2.5 text-center">
      <div className="text-[8px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function Flag({
  active,
  label,
  activeClass,
  inactiveClass = "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"
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
