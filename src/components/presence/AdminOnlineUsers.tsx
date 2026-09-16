import { useAdminPresence } from "../../hooks/useAdminPresence";

/**
 * Admin activity: both counts always, plus who is currently online.
 *
 * ALWAYS BOTH NUMBERS. Unlike the user badge, which swaps between them, an admin
 * is operating the system and needs "nobody is online" and "74 people came
 * today" side by side — the second explains the first.
 *
 * THE LIST IS NOT SECURED BY THIS FILE. `scope=admin` is authorised by
 * `assertAdmin` in server-utils/presenceApi.js before any name or email is
 * assembled, and `user_presence` has RLS enabled with no policies. If this
 * component rendered for a non-admin it would simply have nothing to render,
 * because the request returns 403 with no identities in the body.
 */

export type AdminOnlineUsersProps = {
  /** Gate rendering only; the server decides what may be returned. */
  enabled: boolean;
};

function formatSince(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AdminOnlineUsers({ enabled }: AdminOnlineUsersProps) {
  const { data, failed } = useAdminPresence(enabled);

  if (!enabled) return null;

  const onlineCount = data?.onlineCount ?? null;
  const accessesToday = data?.accessesToday ?? null;
  const users = data?.users ?? [];

  return (
    <section
      data-testid="admin-online-users"
      className="mt-3 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fp-accent)]">
          Activitate aplicație
        </p>
        {failed && (
          <span className="text-[10px] text-[var(--fp-text-muted)]">
            Ultima citire a eșuat — se afișează valorile anterioare
          </span>
        )}
      </div>

      {/* KPI pair. `dl` so each number is programmatically tied to its label. */}
      <dl className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-[var(--fp-border)] px-3 py-2">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">Online acum</dt>
          <dd data-testid="admin-online-count" className="text-lg font-semibold tabular-nums">
            {onlineCount ?? "—"}
          </dd>
        </div>
        <div className="rounded-lg border border-[var(--fp-border)] px-3 py-2">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">Accesări astăzi</dt>
          <dd data-testid="admin-accesses-today" className="text-lg font-semibold tabular-nums">
            {accessesToday ?? "—"}
          </dd>
        </div>
      </dl>

      {users.length === 0 ? (
        <p className="mt-2 text-[11px] text-[var(--fp-text-muted)]">
          {data ? "Niciun utilizator online." : "Se încarcă..."}
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
              <tr>
                <th scope="col" className="py-1 pr-3 font-semibold">Utilizator</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Email</th>
                <th scope="col" className="py-1 font-semibold">Online din</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId} className="border-t border-[var(--fp-border)]">
                  {/* `name` is already display_name, or email when unset — the
                      fallback is resolved server-side so both surfaces agree. */}
                  <td className="py-1 pr-3 font-medium">{user.name}</td>
                  <td className="py-1 pr-3 text-[var(--fp-text-muted)]">{user.email ?? "—"}</td>
                  <td className="py-1 tabular-nums text-[var(--fp-text-muted)]">
                    {formatSince(user.onlineSince)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
