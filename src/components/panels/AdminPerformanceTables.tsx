import type { PerfAdminSnapshot } from "../../types/index";

type AdminPerformanceTablesProps = {
  perfAdminSnapshot: PerfAdminSnapshot | null;
  perfAdminLoading: boolean;
  onReload: () => void;
};

export default function AdminPerformanceTables({
  perfAdminSnapshot,
  perfAdminLoading,
  onReload
}: AdminPerformanceTablesProps) {
  return (
    <div className="mt-4 rounded-xl border border-fp-success/20 bg-[var(--fp-bg-card)] p-3 shadow-inner">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fp-accent)]">Performance counter · 30 zile (server)</p>
        <button
          type="button"
          onClick={() => void onReload()}
          disabled={perfAdminLoading}
          className="touch-manipulation rounded-md border border-fp-accent/20 bg-fp-accent/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-accent)] disabled:opacity-50"
        >
          {perfAdminLoading ? "Se încarcă…" : "Reîncarcă"}
        </button>
      </div>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">Pe utilizator</p>
          <div className="max-h-48 overflow-auto rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
            <table className="min-w-full text-left font-mono text-[10px] text-[var(--fp-accent)]">
              <thead className="sticky top-0 bg-fp-bg-muted/95 text-[9px] uppercase text-[var(--fp-text-muted)]">
                <tr>
                  <th className="px-2 py-1.5">Email</th>
                  <th className="px-2 py-1.5 text-right">W</th>
                  <th className="px-2 py-1.5 text-right">L</th>
                  <th className="px-2 py-1.5 text-right">Pend</th>
                  <th className="px-2 py-1.5 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {(perfAdminSnapshot?.byUser || []).map((row) => (
                  <tr key={row.userId} className="border-t border-[var(--fp-border)]">
                    <td className="max-w-[160px] truncate px-2 py-1 text-[9px]" title={row.email ? `${row.email} · ${row.userId}` : row.userId}>
                      {row.email || "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-[var(--fp-accent)]">{row.wins}</td>
                    <td className="px-2 py-1 text-right text-[var(--fp-danger)]">{row.losses}</td>
                    <td className="px-2 py-1 text-right text-[var(--fp-warning)]">{row.pending}</td>
                    <td className="px-2 py-1 text-right text-[var(--fp-success)]">{row.settled > 0 ? ((row.wins / row.settled) * 100).toFixed(1) : "0.0"}%</td>
                  </tr>
                ))}
                {!perfAdminSnapshot?.byUser?.length && !perfAdminLoading && (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-center text-[var(--fp-text-muted)]">
                      Fără date (utilizatorii trebuie să ruleze Predict autentificat).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">Utilizator + ligă</p>
          <div className="max-h-48 overflow-auto rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
            <table className="min-w-full text-left font-mono text-[10px] text-[var(--fp-accent)]">
              <thead className="sticky top-0 bg-fp-bg-muted/95 text-[9px] uppercase text-[var(--fp-text-muted)]">
                <tr>
                  <th className="px-2 py-1.5">Email</th>
                  <th className="px-2 py-1.5">Ligă</th>
                  <th className="px-2 py-1.5 text-right">W</th>
                  <th className="px-2 py-1.5 text-right">L</th>
                  <th className="px-2 py-1.5 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {(perfAdminSnapshot?.byUserLeague || []).map((row) => (
                  <tr key={`${row.userId}-${row.leagueId}-${row.leagueName}`} className="border-t border-[var(--fp-border)]">
                    <td className="max-w-[100px] truncate px-2 py-1 text-[8px]" title={row.email ? `${row.email} · ${row.userId}` : row.userId}>
                      {row.email ? (row.email.length > 18 ? `${row.email.slice(0, 18)}…` : row.email) : "—"}
                    </td>
                    <td className="max-w-[100px] truncate px-2 py-1" title={row.leagueName}>
                      {row.leagueName || row.leagueId}
                    </td>
                    <td className="px-2 py-1 text-right text-[var(--fp-accent)]">{row.wins}</td>
                    <td className="px-2 py-1 text-right text-[var(--fp-danger)]">{row.losses}</td>
                    <td className="px-2 py-1 text-right text-[var(--fp-success)]">{row.settled > 0 ? ((row.wins / row.settled) * 100).toFixed(1) : "0.0"}%</td>
                  </tr>
                ))}
                {!perfAdminSnapshot?.byUserLeague?.length && !perfAdminLoading && (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-center text-[var(--fp-text-muted)]">
                      Fără date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
