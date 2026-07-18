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
  if (tier === "ultra") return "border-signal-amber/35 bg-signal-amber/10 text-signal-amber";
  if (tier === "premium") return "border-signal-petrol/35 bg-signal-petrol/10 text-signal-petrol";
  return "border-white/10 bg-signal-void/40 text-signal-inkMuted";
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
    <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-white/5 bg-signal-void/40">
      <table className="min-w-full text-left text-[11px] text-signal-petrol">
        <thead className="sticky top-0 bg-signal-fog/95 text-[10px] uppercase text-signal-inkMuted">
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
            <tr key={profile.userId} className="border-t border-signal-line/40">
              <td className="px-3 py-2 font-mono text-[10px] text-signal-ink">
                {profile.email ? (
                  profile.email
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span>—</span>
                    <span className="rounded-full border border-signal-amber/40 bg-signal-amber/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-signal-amber">
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
                  className="rounded-md border border-signal-line bg-signal-fog px-2 py-1 text-[10px] font-semibold text-signal-petrol"
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
                  className="rounded-md border border-signal-line bg-signal-fog px-2 py-1 text-[10px] text-signal-petrol"
                />
                <button
                  type="button"
                  onClick={() =>
                    setAdminExpiryDraftByUser((prev) => ({
                      ...prev,
                      [profile.userId]: ""
                    }))
                  }
                  className="ml-1 rounded-md border border-white/10 bg-signal-void/40 px-1.5 py-1 text-[9px] text-signal-inkMuted"
                  title="Clear expiry"
                >
                  Clear
                </button>
                {isExpiredSubscription(profile.subscriptionExpiresAt) && (
                  <div className="mt-1 inline-flex rounded-md border border-signal-rose/30 bg-signal-rose/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-signal-rose">
                    Expired
                  </div>
                )}
              </td>
              <td className="px-3 py-2">{profile.isBlocked ? "yes" : "no"}</td>
              <td className="px-3 py-2 font-mono text-[10px] text-signal-inkMuted">
                {profile.warmPredictUsage ? `${profile.warmPredictUsage.warm} / ${profile.warmPredictUsage.predict}` : "—"}
              </td>
              <td className="px-3 py-2">{profile.favoriteLeagues.length ? profile.favoriteLeagues.join(", ") : "-"}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void onRoleChange(profile.userId, profile.role === "admin" ? "user" : "admin")}
                    disabled={isAdminWorking}
                    className="rounded-md border border-signal-petrol/20 bg-signal-petrol/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol disabled:opacity-50"
                  >
                    Make {profile.role === "admin" ? "user" : "admin"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onToggleBlock(profile.userId, !profile.isBlocked)}
                    disabled={isAdminWorking}
                    className="rounded-md border border-signal-rose/30 bg-signal-rose/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-signal-rose disabled:opacity-50"
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
                    className="rounded-md border border-signal-sage/30 bg-signal-sage/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-signal-sage disabled:opacity-50"
                  >
                    Save Plan
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!managedProfiles.length && (
            <tr>
              <td colSpan={9} className="px-3 py-4 text-center text-signal-inkMuted">
                Nu exista profile disponibile.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
