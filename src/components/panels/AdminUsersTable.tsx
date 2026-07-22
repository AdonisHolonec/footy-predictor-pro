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

type AdminUsersTableProps = {
  managedProfiles: ManagedProfile[];
  isAdminWorking: boolean;
  adminTierDraftByUser: Record<string, UserTier>;
  setAdminTierDraftByUser: Dispatch<SetStateAction<Record<string, UserTier>>>;
  adminExpiryDraftByUser: Record<string, string>;
  setAdminExpiryDraftByUser: Dispatch<SetStateAction<Record<string, string>>>;
  onRoleChange: (userId: string, role: "user" | "admin") => void;
  onToggleBlock: (userId: string, isBlocked: boolean) => void;
  onMonetizationSave: (userId: string, fallbackTier: UserTier, fallbackExpiry?: string | null) => void;
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

export default function AdminUsersTable({
  managedProfiles,
  isAdminWorking,
  adminTierDraftByUser,
  setAdminTierDraftByUser,
  adminExpiryDraftByUser,
  setAdminExpiryDraftByUser,
  onRoleChange,
  onToggleBlock,
  onMonetizationSave
}: AdminUsersTableProps) {
  return (
    <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
      <table className="min-w-full text-left text-[11px] text-[var(--fp-accent)]">
        <thead className="sticky top-0 bg-[var(--fp-bg-muted)]/95 text-[10px] uppercase text-[var(--fp-text-muted)]">
          <tr>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">User ID</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Tier</th>
            <th className="px-3 py-2">Subscription Expiry</th>
            <th className="px-3 py-2">Blocked</th>
            <th className="px-3 py-2">Warm / Predict</th>
            <th className="px-3 py-2">Favorite Leagues</th>
            <th className="px-3 py-2">Actions</th>
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
                      email missing
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
                  title="Clear expiry"
                >
                  Clear
                </button>
                {isExpiredSubscription(profile.subscriptionExpiresAt) && (
                  <div className="mt-1 inline-flex rounded-md border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--fp-danger)]">
                    Expired — Save Plan clears it for paid tiers
                  </div>
                )}
              </td>
              <td className="px-3 py-2">{profile.isBlocked ? "yes" : "no"}</td>
              <td className="px-3 py-2 font-mono text-[10px] text-[var(--fp-text-muted)]">
                {profile.warmPredictUsage ? `${profile.warmPredictUsage.warm} / ${profile.warmPredictUsage.predict}` : "—"}
              </td>
              <td className="px-3 py-2">{profile.favoriteLeagues.length ? profile.favoriteLeagues.join(", ") : "-"}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void onRoleChange(profile.userId, profile.role === "admin" ? "user" : "admin")}
                    disabled={isAdminWorking}
                    className="rounded-md border border-[var(--fp-accent)]/20 bg-[var(--fp-accent)]/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-accent)] disabled:opacity-50"
                  >
                    Make {profile.role === "admin" ? "user" : "admin"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onToggleBlock(profile.userId, !profile.isBlocked)}
                    disabled={isAdminWorking}
                    className="rounded-md border border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-danger)] disabled:opacity-50"
                  >
                    {profile.isBlocked ? "Unblock" : "Block"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void onMonetizationSave(
                        profile.userId,
                        (profile.tier || "free") as UserTier,
                        profile.subscriptionExpiresAt ?? null
                      )
                    }
                    disabled={isAdminWorking}
                    className="rounded-md border border-[var(--fp-success)]/30 bg-[var(--fp-success)]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-success)] disabled:opacity-50"
                  >
                    Save Plan
                  </button>
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
