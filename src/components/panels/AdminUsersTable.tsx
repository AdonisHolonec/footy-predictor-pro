import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { UserTier } from "../../types";

type ManagedProfile = {
  userId: string;
  email?: string | null;
  role: "user" | "admin";
  tier?: UserTier | null;
  subscriptionExpiresAt?: string | null;
  isBlocked?: boolean;
  warmPredictUsage?: { warm: number; predict: number } | null;
  favoriteLeagues: number[];
};

/** Result is optional: existing callers that don't report success/failure still work, and skip inline row feedback. */
type RowActionOutcome = boolean | { ok: boolean; message?: string };
type RowActionResult = RowActionOutcome | void | Promise<RowActionOutcome | void>;

type AdminUsersTableProps = {
  managedProfiles: ManagedProfile[];
  /** User ids with an admin action currently in flight — only that row disables. */
  busyUserIds: Set<string>;
  adminTierDraftByUser: Record<string, UserTier>;
  setAdminTierDraftByUser: Dispatch<SetStateAction<Record<string, UserTier>>>;
  adminExpiryDraftByUser: Record<string, string>;
  setAdminExpiryDraftByUser: Dispatch<SetStateAction<Record<string, string>>>;
  onRoleChange: (userId: string, role: "user" | "admin") => RowActionResult;
  onToggleBlock: (userId: string, isBlocked: boolean) => RowActionResult;
  onMonetizationSave: (userId: string, fallbackTier: UserTier, fallbackExpiry?: string | null) => RowActionResult;
};

function isoToLocalDatetimeInput(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tierToneClass(tier: UserTier) {
  if (tier === "ultra") return "border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]";
  if (tier === "premium") return "border-[var(--fp-accent)]/35 bg-[var(--fp-accent)]/10 text-[var(--fp-accent)]";
  return "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]";
}

function isExpiredSubscription(iso?: string | null) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

/** Describes what Save Plan will actually do, for the confirmation prompt. */
function describeMonetizationChange(
  who: string,
  tier: UserTier,
  expiryDraft: string | undefined,
  fallbackExpiry: string | null | undefined
) {
  if (tier === "free") return `seteze ${who} pe nivelul free`;
  const expiryIso = expiryDraft ? new Date(expiryDraft).toISOString() : fallbackExpiry;
  const expiryMs = expiryIso ? new Date(expiryIso).getTime() : NaN;
  const willBeOpenEnded = !expiryIso || !Number.isFinite(expiryMs) || expiryMs <= Date.now();
  return willBeOpenEnded
    ? `acorde ${who} acces ${tier} pe termen nelimitat (fara data de expirare)`
    : `seteze ${who} pe nivelul ${tier} pana la ${new Date(expiryMs).toLocaleString("ro-RO")}`;
}

export default function AdminUsersTable({
  managedProfiles,
  busyUserIds,
  adminTierDraftByUser,
  setAdminTierDraftByUser,
  adminExpiryDraftByUser,
  setAdminExpiryDraftByUser,
  onRoleChange,
  onToggleBlock,
  onMonetizationSave
}: AdminUsersTableProps) {
  const [rowFeedback, setRowFeedback] = useState<
    Record<string, { ok: boolean; label: string; detail?: string } | undefined>
  >({});

  function clearRowFeedbackAfterDelay(userId: string) {
    window.setTimeout(() => {
      setRowFeedback((prev) => {
        if (!(userId in prev)) return prev;
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }, 4000);
  }

  async function runRowAction(userId: string, label: string, confirmMessage: string, action: () => RowActionResult) {
    if (!window.confirm(confirmMessage)) return;
    const result = await action();
    // Callers that don't report an outcome (plain void) are treated as successful — no regression for existing behavior.
    const ok = typeof result === "object" && result !== null ? result.ok !== false : result !== false;
    const detail = typeof result === "object" && result !== null && result.ok === false ? result.message : undefined;
    setRowFeedback((prev) => ({ ...prev, [userId]: { ok, label, detail } }));
    clearRowFeedbackAfterDelay(userId);
  }

  return (
    <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
      <table className="min-w-full text-left text-[11px] text-[var(--fp-accent)]">
        <thead className="sticky top-0 bg-[var(--fp-bg-muted)]/95 text-[10px] uppercase text-[var(--fp-text-muted)]">
          <tr>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">ID utilizator</th>
            <th className="px-3 py-2">Rol</th>
            <th className="px-3 py-2">Nivel</th>
            <th className="px-3 py-2">Expirare abonament</th>
            <th className="px-3 py-2">Blocat</th>
            <th className="px-3 py-2">Warm / Predict</th>
            <th className="px-3 py-2">Ligi favorite</th>
            <th className="px-3 py-2">Acțiuni</th>
          </tr>
        </thead>
        <tbody>
          {managedProfiles.map((profile) => (
            <tr key={profile.userId} className="border-t border-[var(--fp-border)]">
              <td className="px-3 py-2 font-mono text-[10px] text-[var(--fp-text)]">
                {profile.email ? (
                  profile.email
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span>—</span>
                    <span className="rounded-full border border-[var(--fp-warning)]/40 bg-[var(--fp-warning)]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--fp-warning)]">
                      email lipsă
                    </span>
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-[10px]">{profile.userId}</td>
              <td className="px-3 py-2">{profile.role}</td>
              <td className="px-3 py-2">
                <div className="mb-1">
                  <span
                    className={`inline-flex rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${tierToneClass(
                      (adminTierDraftByUser[profile.userId] || profile.tier || "free") as UserTier
                    )}`}
                  >
                    {(adminTierDraftByUser[profile.userId] || profile.tier || "free").toUpperCase()}
                  </span>
                </div>
                <select
                  value={adminTierDraftByUser[profile.userId] || profile.tier || "free"}
                  onChange={(e) =>
                    setAdminTierDraftByUser((prev) => ({
                      ...prev,
                      [profile.userId]: e.target.value as UserTier
                    }))
                  }
                  className="rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--fp-accent)]"
                >
                  <option value="free">free</option>
                  <option value="premium">premium</option>
                  <option value="ultra">ultra</option>
                </select>
              </td>
              <td className="px-3 py-2">
                <input
                  type="datetime-local"
                  value={
                    adminExpiryDraftByUser[profile.userId] !== undefined
                      ? adminExpiryDraftByUser[profile.userId]
                      : isoToLocalDatetimeInput(profile.subscriptionExpiresAt || null)
                  }
                  onChange={(e) =>
                    setAdminExpiryDraftByUser((prev) => ({
                      ...prev,
                      [profile.userId]: e.target.value
                    }))
                  }
                  className="rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-2 py-1 text-[10px] text-[var(--fp-accent)]"
                />
                <button
                  type="button"
                  onClick={() =>
                    setAdminExpiryDraftByUser((prev) => ({
                      ...prev,
                      [profile.userId]: ""
                    }))
                  }
                  className="ml-1 rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-1.5 py-1 text-[9px] text-[var(--fp-text-muted)]"
                  title="Șterge data expirării"
                >
                  Șterge
                </button>
                {isExpiredSubscription(profile.subscriptionExpiresAt) && (
                  <div className="mt-1 inline-flex rounded-md border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--fp-danger)]">
                    Expirat — Salvează planul pentru acces nelimitat pe nivelurile plătite
                  </div>
                )}
              </td>
              <td className="px-3 py-2">{profile.isBlocked ? "da" : "nu"}</td>
              <td className="px-3 py-2 font-mono text-[10px] text-[var(--fp-text-muted)]">
                {profile.warmPredictUsage ? `${profile.warmPredictUsage.warm} / ${profile.warmPredictUsage.predict}` : "—"}
              </td>
              <td className="px-3 py-2">{profile.favoriteLeagues.length ? profile.favoriteLeagues.join(", ") : "-"}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextRole = profile.role === "admin" ? "user" : "admin";
                      const who = profile.email || profile.userId;
                      void runRowAction(
                        profile.userId,
                        "Rol actualizat",
                        `Faci ${who} ${nextRole === "admin" ? "admin" : "user obișnuit"}? Accesul se schimbă imediat.`,
                        () => onRoleChange(profile.userId, nextRole)
                      );
                    }}
                    disabled={busyUserIds.has(profile.userId)}
                    className="rounded-md border border-[var(--fp-accent)]/20 bg-[var(--fp-accent)]/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-accent)] disabled:opacity-50"
                  >
                    Fă {profile.role === "admin" ? "user" : "admin"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const willBlock = !profile.isBlocked;
                      const who = profile.email || profile.userId;
                      void runRowAction(
                        profile.userId,
                        willBlock ? "Blocat" : "Deblocat",
                        willBlock
                          ? `Blochezi ${who}? Va pierde accesul imediat.`
                          : `Deblochezi ${who}? Va recăpăta accesul imediat.`,
                        () => onToggleBlock(profile.userId, willBlock)
                      );
                    }}
                    disabled={busyUserIds.has(profile.userId)}
                    className="rounded-md border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-danger)] disabled:opacity-50"
                  >
                    {profile.isBlocked ? "Deblochează" : "Blochează"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const who = profile.email || profile.userId;
                      const tier = (adminTierDraftByUser[profile.userId] || profile.tier || "free") as UserTier;
                      const consequence = describeMonetizationChange(
                        who,
                        tier,
                        adminExpiryDraftByUser[profile.userId],
                        profile.subscriptionExpiresAt
                      );
                      void runRowAction(
                        profile.userId,
                        "Plan salvat",
                        `Salvezi planul? Aceasta va ${consequence}.`,
                        () =>
                          onMonetizationSave(
                            profile.userId,
                            (profile.tier || "free") as UserTier,
                            profile.subscriptionExpiresAt ?? null
                          )
                      );
                    }}
                    disabled={busyUserIds.has(profile.userId)}
                    className="rounded-md border border-[var(--fp-success)]/30 bg-[var(--fp-success)]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-success)] disabled:opacity-50"
                  >
                    Salvează planul
                  </button>
                  {rowFeedback[profile.userId] && (
                    <span
                      role="status"
                      className={`inline-flex max-w-[240px] items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold uppercase tracking-wide ${
                        rowFeedback[profile.userId]!.ok
                          ? "border-[var(--fp-success)]/30 bg-[var(--fp-success)]/10 text-[var(--fp-success)]"
                          : "border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 text-[var(--fp-danger)]"
                      }`}
                    >
                      {rowFeedback[profile.userId]!.ok ? "✓" : "✗"} {rowFeedback[profile.userId]!.label}
                      {!rowFeedback[profile.userId]!.ok &&
                        (rowFeedback[profile.userId]!.detail ? (
                          <span className="truncate normal-case tracking-normal">
                            : {rowFeedback[profile.userId]!.detail}
                          </span>
                        ) : (
                          " — eșuat"
                        ))}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!managedProfiles.length && (
            <tr>
              <td colSpan={9} className="px-3 py-4 text-center text-[var(--fp-text-muted)]">
                Nu exista profile disponibile.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
