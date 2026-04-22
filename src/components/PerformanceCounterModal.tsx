import { useCallback, useEffect, useState } from "react";
import type { PerformanceLeagueBreakdown, PerformanceUserBreakdown, PerformanceUserLeagueBreakdown } from "../types";

type PerformanceApiResponse = {
  ok: boolean;
  days?: number;
  isAdmin?: boolean;
  byUser?: PerformanceUserBreakdown[];
  byUserLeague?: PerformanceUserLeagueBreakdown[];
  error?: string;
};

type PerformanceCounterModalProps = {
  open: boolean;
  onClose: () => void;
  days: number;
  globalByLeague?: PerformanceLeagueBreakdown[];
  accessToken?: string | null;
  isAdmin?: boolean;
  leagueTableHeading?: string;
};

function pct(n: number) {
  return Number.isFinite(n) ? n.toFixed(1) : "0.0";
}

export default function PerformanceCounterModal({
  open,
  onClose,
  days,
  globalByLeague = [],
  accessToken,
  isAdmin = false,
  leagueTableHeading = "Global · pe ligă (toți utilizatorii)"
}: PerformanceCounterModalProps) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [byUser, setByUser] = useState<PerformanceUserBreakdown[]>([]);
  const [byUserLeague, setByUserLeague] = useState<PerformanceUserLeagueBreakdown[]>([]);
  const [serverIsAdmin, setServerIsAdmin] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) {
      setByUser([]);
      setByUserLeague([]);
      setErr(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ performance: "1", days: String(days) });
      const res = await fetch(`/api/history?${qs}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const json = (await res.json()) as PerformanceApiResponse;
      if (!json?.ok) {
        setErr(typeof json?.error === "string" ? json.error : "Nu am putut încărca detaliile.");
        setByUser([]);
        setByUserLeague([]);
        return;
      }
      setByUser(Array.isArray(json.byUser) ? json.byUser : []);
      setByUserLeague(Array.isArray(json.byUserLeague) ? json.byUserLeague : []);
      setServerIsAdmin(Boolean(json.isAdmin));
    } catch {
      setErr("Rețea sau răspuns invalid.");
      setByUser([]);
      setByUserLeague([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, days]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  if (!open) return null;

  const showGlobal = globalByLeague.length > 0;
  const showServer = Boolean(accessToken);
  const adminEffective = isAdmin || serverIsAdmin;

  const tableWrap = "overflow-x-auto rounded-xl border border-white/5 bg-signal-void/50 shadow-inner";
  const th = "px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-signal-inkMuted";
  const td = "border-t border-signal-line/35 px-2 py-1.5 font-mono text-[11px] text-signal-petrol";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-t-2xl border border-white/10 bg-gradient-to-b from-signal-panel/98 to-signal-mist shadow-atelierLg backdrop-blur-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="perf-counter-title"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-signal-void/40 px-4 py-3">
          <div>
            <h2 id="perf-counter-title" className="font-display text-sm font-semibold text-signal-ink">
              Consolă laborator · performanță
            </h2>
            <p className="font-mono text-[10px] text-signal-inkMuted">Fereastră {days} zile · kickoff</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="touch-manipulation rounded-full border border-white/10 bg-signal-fog px-3 py-1.5 text-xs font-semibold text-signal-petrol hover:bg-signal-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-petrol/40"
          >
            Închide
          </button>
        </div>
        <div className="max-h-[calc(88vh-3.5rem)] overflow-y-auto px-4 py-3 text-left">
          <p className="mb-3 text-[11px] leading-relaxed text-signal-inkMuted">
            Scoruri din istoric sincronizat; rândurile per utilizator apar după Predict autentificat.
          </p>
          {err && (
            <div className="mb-3 rounded-lg border border-signal-amber/40 bg-signal-amber/10 px-3 py-2 text-[11px] text-signal-amber">{err}</div>
          )}
          {loading && showServer && (
            <div className="mb-3 text-center font-mono text-[11px] font-semibold uppercase tracking-widest text-signal-sage">Se încarcă…</div>
          )}

          {showGlobal && (
            <section className="mb-6">
              <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrolMuted">{leagueTableHeading}</h3>
              <div className={tableWrap}>
                <table className="min-w-full text-left">
                  <thead className="bg-signal-fog/90">
                    <tr>
                      <th className={th}>Ligă</th>
                      <th className={`${th} text-right`}>W</th>
                      <th className={`${th} text-right`}>L</th>
                      <th className={`${th} text-right`}>Pend</th>
                      <th className={`${th} text-right`}>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalByLeague.map((row) => (
                      <tr key={row.leagueId}>
                        <td className={`${td} max-w-[200px] truncate font-sans font-semibold`} title={row.leagueName}>
                          {row.leagueName || row.leagueId}
                        </td>
                        <td className={`${td} text-right text-signal-petrolMuted`}>{row.wins}</td>
                        <td className={`${td} text-right text-signal-rose`}>{row.losses}</td>
                        <td className={`${td} text-right text-signal-amber`}>{row.pending}</td>
                        <td className={`${td} text-right text-signal-sage`}>{pct(row.winRate)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {showServer && (
            <>
              <section className="mb-6">
                <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrolMuted">
                  {adminEffective ? "Per utilizator" : "Contul tău"}
                </h3>
                <div className={tableWrap}>
                  <table className="min-w-full text-left">
                    <thead className="bg-signal-fog/90">
                      <tr>
                        {adminEffective && <th className={th}>Email</th>}
                        <th className={`${th} text-right`}>W</th>
                        <th className={`${th} text-right`}>L</th>
                        <th className={`${th} text-right`}>Pend</th>
                        <th className={`${th} text-right`}>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byUser.length === 0 && !loading ? (
                        <tr>
                          <td colSpan={adminEffective ? 5 : 4} className={`${td} text-center text-signal-inkMuted`}>
                            Niciun rând încă.
                          </td>
                        </tr>
                      ) : (
                        byUser.map((row) => (
                          <tr key={row.userId}>
                            {adminEffective && (
                              <td className={`${td} max-w-[220px] truncate font-sans text-[10px]`} title={row.email ? `${row.email} · ${row.userId}` : row.userId}>
                                {row.email || "—"}
                              </td>
                            )}
                            <td className={`${td} text-right text-signal-petrolMuted`}>{row.wins}</td>
                            <td className={`${td} text-right text-signal-rose`}>{row.losses}</td>
                            <td className={`${td} text-right text-signal-amber`}>{row.pending}</td>
                            <td className={`${td} text-right text-signal-sage`}>{pct(row.winRate)}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrolMuted">
                  {adminEffective ? "Utilizator + ligă" : "Pe ligă"}
                </h3>
                <div className={tableWrap}>
                  <table className="min-w-full text-left">
                    <thead className="bg-signal-fog/90">
                      <tr>
                        {adminEffective && <th className={th}>Email</th>}
                        <th className={th}>Ligă</th>
                        <th className={`${th} text-right`}>W</th>
                        <th className={`${th} text-right`}>L</th>
                        <th className={`${th} text-right`}>Pend</th>
                        <th className={`${th} text-right`}>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byUserLeague.length === 0 && !loading ? (
                        <tr>
                          <td colSpan={adminEffective ? 6 : 5} className={`${td} text-center text-signal-inkMuted`}>
                            Niciun rând pe ligă.
                          </td>
                        </tr>
                      ) : (
                        byUserLeague.map((row) => (
                          <tr key={`${row.userId}-${row.leagueId}-${row.leagueName}`}>
                            {adminEffective && (
                              <td className={`${td} max-w-[140px] truncate font-sans text-[9px]`} title={row.email ? `${row.email} · ${row.userId}` : row.userId}>
                                {row.email ? (row.email.length > 22 ? `${row.email.slice(0, 22)}…` : row.email) : "—"}
                              </td>
                            )}
                            <td className={`${td} max-w-[180px] truncate font-sans font-semibold`} title={row.leagueName}>
                              {row.leagueName || row.leagueId}
                            </td>
                            <td className={`${td} text-right text-signal-petrolMuted`}>{row.wins}</td>
                            <td className={`${td} text-right text-signal-rose`}>{row.losses}</td>
                            <td className={`${td} text-right text-signal-amber`}>{row.pending}</td>
                            <td className={`${td} text-right text-signal-sage`}>{pct(row.winRate)}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {!showGlobal && !showServer && <p className="text-center text-[12px] text-signal-inkMuted">Nu există date de afișat.</p>}
        </div>
      </div>
    </div>
  );
}
