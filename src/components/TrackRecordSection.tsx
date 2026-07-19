import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadPublicTrackRecord, type PublicTrackRecord } from "../services/trackRecordService";

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtUnits(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}u`;
}

function EquitySpark({ points }: { points: Array<{ pnlUnits: number }> }) {
  if (!points.length) return null;
  const vals = points.map((p) => p.pnlUnits);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 0);
  const span = Math.max(max - min, 1e-6);
  const w = 280;
  const h = 56;
  const d = vals
    .map((v, i) => {
      const x = (i / Math.max(vals.length - 1, 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = vals[vals.length - 1] ?? 0;
  const stroke = last >= 0 ? "rgb(52 211 153)" : "rgb(251 113 133)";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full max-w-xs" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Props = {
  days?: 30 | 45 | 90;
  showLinkToFull?: boolean;
  compact?: boolean;
};

export default function TrackRecordSection({ days = 45, showLinkToFull = true, compact = false }: Props) {
  const [data, setData] = useState<PublicTrackRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void loadPublicTrackRecord(days)
      .then((json) => {
        if (alive) setData(json);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Eroare track record.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [days]);

  const s = data?.summary;

  return (
    <section id="track-record" className="scroll-mt-28 border-t border-[var(--fp-border)] py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--fp-accent)]">Verified Track Record</p>
          <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--fp-text)] sm:text-3xl">
            Settled performance · last {days} days
          </h2>
          <p className="mt-2 max-w-2xl text-sm font-medium text-[var(--fp-text-muted)]">
            Metrics from validated predictions (win/loss), not marketing claims.
          </p>
        </div>
        {showLinkToFull && (
          <Link
            to="/track-record"
            title="Open full track record page"
            className="text-[11px] font-bold uppercase tracking-wider text-[var(--fp-accent)] hover:underline"
          >
            Open dedicated page →
          </Link>
        )}
      </div>

      {loading && (
        <p className="mt-8 text-sm font-medium text-[var(--fp-text-muted)]">Loading track record…</p>
      )}
      {error && !loading && (
        <p className="mt-8 rounded-[var(--fp-radius)] border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-4 py-3 text-sm font-medium text-[var(--fp-danger)]">
          {error}
        </p>
      )}

      {!loading && !error && s && (
        <>
          <div className={`mt-8 grid gap-3 ${compact ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"}`}>
            {[
              { label: "Settled", value: String(s.settled), tone: "text-[var(--fp-text)]" },
              { label: "Hit rate", value: fmtPct(s.hitRate), tone: "text-[var(--fp-success)]" },
              {
                label: "ROI",
                value: fmtPct(s.roi),
                tone: s.roi >= 0 ? "text-[var(--fp-success)]" : "text-[var(--fp-danger)]"
              },
              {
                label: "PnL",
                value: fmtUnits(s.pnlUnits),
                tone: s.pnlUnits >= 0 ? "text-[var(--fp-success)]" : "text-[var(--fp-danger)]"
              },
              { label: "Max DD", value: fmtUnits(s.drawdown), tone: "text-[var(--fp-warning)]" },
              {
                label: "CLV",
                value: s.clvAvailable ? fmtPct(s.clv) : "—",
                tone:
                  s.clvAvailable && s.clv != null
                    ? s.clv >= 0
                      ? "text-[var(--fp-success)]"
                      : "text-[var(--fp-danger)]"
                    : "text-[var(--fp-text-muted)]"
              }
            ]
              .slice(0, compact ? 4 : 6)
              .map((tile) => (
                <div
                  key={tile.label}
                  className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-[var(--fp-shadow-sm)]"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">{tile.label}</p>
                  <p className={`mt-2 font-display text-2xl font-bold ${tile.tone}`}>{tile.value}</p>
                </div>
              ))}
          </div>

          {(data?.trend?.length || 0) > 1 && (
            <div className="mt-6 flex flex-wrap items-center gap-6 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-4 py-3 shadow-[var(--fp-shadow-sm)]">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">Equity spark</p>
                <EquitySpark points={data!.trend} />
              </div>
              <div className="text-xs font-medium text-[var(--fp-text-muted)]">
                <p>
                  As of <span className="font-semibold text-[var(--fp-text)]">{data?.asOf}</span>
                </p>
                <p>
                  Source: <span className="font-semibold text-[var(--fp-accent)]">{data?.source}</span>
                </p>
                <p>
                  W/L: {s.wins}/{s.losses}
                </p>
                {s.clvAvailable ? (
                  <p>
                    CLV sample: <span className="font-semibold text-[var(--fp-text)]">{s.clvCount ?? 0}</span>
                    {s.clvBeatRate != null ? ` · beat close ${fmtPct(s.clvBeatRate)}` : ""}
                  </p>
                ) : (
                  <p>CLV: awaiting closing-line captures</p>
                )}
              </div>
            </div>
          )}

          {!compact && data?.byMarket && data.byMarket.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-[420px] w-full text-left text-xs">
                <thead className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
                  <tr>
                    <th className="py-2 pr-4">Market</th>
                    <th className="py-2 pr-4">Settled</th>
                    <th className="py-2 pr-4">Hit</th>
                    <th className="py-2">ROI</th>
                  </tr>
                </thead>
                <tbody className="font-medium text-[var(--fp-text)]">
                  {data.byMarket.map((row) => (
                    <tr key={row.key} className="border-t border-[var(--fp-border)]">
                      <td className="py-2 pr-4 font-mono">{row.key}</td>
                      <td className="py-2 pr-4">{row.settled}</td>
                      <td className="py-2 pr-4">{fmtPct(row.hitRate)}</td>
                      <td className={`py-2 ${row.roi >= 0 ? "text-[var(--fp-success)]" : "text-[var(--fp-danger)]"}`}>
                        {fmtPct(row.roi)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-6 max-w-3xl font-mono text-[10px] leading-relaxed text-signal-inkMuted">
            {data?.disclaimer}
          </p>
        </>
      )}

      {!loading && !error && s && s.settled === 0 && (
        <p className="mt-4 text-sm text-signal-inkMuted">
          Încă nu există suficiente predicții settled în fereastra selectată. Revino după sync-ul de istoric.
        </p>
      )}
    </section>
  );
}
