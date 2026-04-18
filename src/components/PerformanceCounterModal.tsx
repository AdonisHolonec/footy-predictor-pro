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
  /** Global breakdown from client history (main app). */
  globalByLeague?: PerformanceLeagueBreakdown[];
  /** When set, loads `/api/history?performance=1` for per-user rows. */
  accessToken?: string | null;
  /** Whether the signed-in user is admin (extra columns / copy). */
  isAdmin?: boolean;
  /** Heading for the first league table (default: global aggregate). */
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
  leagueTableHeading = "Global · pe ligă"
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

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-t-2xl border border-white/10 bg-slate-950 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="perf-counter-title"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 id="perf-counter-title" className="text-sm font-black uppercase tracking-wide text-emerald-200">
            Performance counter · detalii
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="touch-manipulation rounded-full border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-black text-slate-300 hover:bg-slate-800"
          >
            Închide
          </button>
        </div>
        <div className="max-h-[calc(88vh-3.5rem)] overflow-y-auto px-4 py-3 text-left">
          <p className="mb-3 text-[11px] text-slate-500">
            Fereastră: ultimele <span className="font-mono text-slate-400">{days}</span> zile (kickoff). Scorurile provin din istoricul sincronizat; rândurile per utilizator apar după ce rulezi Predict autentificat (legătură salvată pe server).
          </p>
          {err && <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">{err}</div>}
          {loading && showServer && <div className="mb-3 text-center text-[11px] font-black uppercase tracking-widest text-cyan-400">Se încarcă…</div>}

          {showGlobal && (
            <section className="mb-6">
              <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">{leagueTableHeading}</h3>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-left text-[11px] text-slate-200">
                  <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Ligă</th>
                      <th className="px-2 py-2 text-right">W</th>
                      <th className="px-2 py-2 text-right">L</th>
                      <th className="px-2 py-2 text-right">Pending</th>
                      <th className="px-2 py-2 text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalByLeague.map((row) => (
                      <tr key={row.leagueId} className="border-t border-white/5">
                        <td className="max-w-[200px] truncate px-2 py-1.5 font-semibold text-slate-100" title={row.leagueName}>
                          {row.leagueName || row.leagueId}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-emerald-300">{row.wins}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-rose-300">{row.losses}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-amber-200/90">{row.pending}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-cyan-200">{pct(row.winRate)}%</td>
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
                <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
                  {adminEffective ? "Per utilizator (contor)" : "Contul tău · total"}
                </h3>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-left text-[11px] text-slate-200">
                    <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-500">
                      <tr>
                        {adminEffective && <th className="px-2 py-2">Email</th>}
                        <th className="px-2 py-2 text-right">W</th>
                        <th className="px-2 py-2 text-right">L</th>
                        <th className="px-2 py-2 text-right">Pending</th>
                        <th className="px-2 py-2 text-right">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byUser.length === 0 && !loading ? (
                        <tr>
                          <td colSpan={adminEffective ? 5 : 4} className="px-2 py-4 text-center text-slate-500">
                            Niciun rând încă (rulează Predict autentificat ca să legăm meciurile de cont).
                          </td>
                        </tr>
                      ) : (
                        byUser.map((row) => (
                          <tr key={row.userId} className="border-t border-white/5">
                            {adminEffective && (
                              <td
                                className="max-w-[220px] truncate px-2 py-1.5 text-[10px] text-slate-200"
                                title={row.email ? `${row.email} · ${row.userId}` : row.userId}
                              >
                                {row.email || "—"}
                              </td>
                            )}
                            <td className="px-2 py-1.5 text-right font-mono text-emerald-300">{row.wins}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-rose-300">{row.losses}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-amber-200/90">{row.pending}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-cyan-200">{pct(row.winRate)}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
                  {adminEffective ? "Utilizator + ligă" : "Pe ligă (contul tău)"}
                </h3>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-left text-[11px] text-slate-200">
                    <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-500">
                      <tr>
                        {adminEffective && <th className="px-2 py-2">Email</th>}
                        <th className="px-2 py-2">Ligă</th>
                        <th className="px-2 py-2 text-right">W</th>
                        <th className="px-2 py-2 text-right">L</th>
                        <th className="px-2 py-2 text-right">Pending</th>
                        <th className="px-2 py-2 text-right">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byUserLeague.length === 0 && !loading ? (
                        <tr>
                          <td colSpan={adminEffective ? 6 : 5} className="px-2 py-4 text-center text-slate-500">
                            Niciun rând pe ligă.
                          </td>
                        </tr>
                      ) : (
                        byUserLeague.map((row) => (
                          <tr key={`${row.userId}-${row.leagueId}-${row.leagueName}`} className="border-t border-white/5">
                            {adminEffective && (
                              <td
                                className="max-w-[140px] truncate px-2 py-1.5 text-[9px] text-slate-200"
                                title={row.email ? `${row.email} · ${row.userId}` : row.userId}
                              >
                                {row.email ? (row.email.length > 22 ? `${row.email.slice(0, 22)}…` : row.email) : "—"}
                              </td>
                            )}
                            <td className="max-w-[180px] truncate px-2 py-1.5 font-semibold text-slate-100" title={row.leagueName}>
                              {row.leagueName || row.leagueId}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-emerald-300">{row.wins}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-rose-300">{row.losses}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-amber-200/90">{row.pending}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-cyan-200">{pct(row.winRate)}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {!showGlobal && !showServer && (
            <p className="text-center text-[12px] text-slate-500">Nu există date de afișat.</p>
          )}
        </div>
      </div>
    </div>
  );
}
