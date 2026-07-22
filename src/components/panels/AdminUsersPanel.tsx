import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { UserTier } from "../../types";
import { localCalendarDateKey } from "../../utils/appUtils";
import AdminUsageSnapshot from "./AdminUsageSnapshot";
import AdminPerformanceTables from "./AdminPerformanceTables";
import AdminUsersTable from "./AdminUsersTable";
import type { PerfAdminSnapshot, UsageSnapshot } from "../../types/index";

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

type AdminUsersPanelProps = {
  managedProfiles: ManagedProfile[];
  isAdminWorking: boolean;
  onRefreshProfiles: () => void;
  usageSnapshot: UsageSnapshot | null;
  usageLoading: boolean;
  onLoadUsage: () => void;
  perfAdminSnapshot: PerfAdminSnapshot | null;
  perfAdminLoading: boolean;
  onLoadPerfAdmin: () => void;
  adminTierDraftByUser: Record<string, UserTier>;
  setAdminTierDraftByUser: Dispatch<SetStateAction<Record<string, UserTier>>>;
  adminExpiryDraftByUser: Record<string, string>;
  setAdminExpiryDraftByUser: Dispatch<SetStateAction<Record<string, string>>>;
  onRoleChange: (userId: string, role: "user" | "admin") => void;
  onToggleBlock: (userId: string, isBlocked: boolean) => void;
  onMonetizationSave: (userId: string, fallbackTier: UserTier, fallbackExpiry?: string | null) => void;
};

export default function AdminUsersPanel({
  managedProfiles,
  isAdminWorking,
  onRefreshProfiles,
  usageSnapshot,
  usageLoading,
  onLoadUsage,
  perfAdminSnapshot,
  perfAdminLoading,
  onLoadPerfAdmin,
  adminTierDraftByUser,
  setAdminTierDraftByUser,
  adminExpiryDraftByUser,
  setAdminExpiryDraftByUser,
  onRoleChange,
  onToggleBlock,
  onMonetizationSave
}: AdminUsersPanelProps) {
  return (
    <section className="mb-6 rounded-2xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-[var(--fp-shadow-sm)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--fp-accent)]">Admin · utilizatori</h2>
          <p className="text-xs text-[var(--fp-text-muted)]">Roluri, blocare și preferințe.</p>
          <p className="mt-1 text-[10px] text-[var(--fp-text-muted)]">
            Warm/Predict (calendar local): <span className="font-mono text-[var(--fp-accent)]">{localCalendarDateKey()}</span>
            {" · "}
            <Link to="/privacy" className="font-medium text-[var(--fp-accent)] underline-offset-2 hover:underline">
              GDPR
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRefreshProfiles()}
          disabled={isAdminWorking}
          className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-accent)] hover:bg-[var(--fp-bg-card)] disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <AdminUsageSnapshot usageSnapshot={usageSnapshot} usageLoading={usageLoading} onLoad={onLoadUsage} />
      <AdminPerformanceTables
        perfAdminSnapshot={perfAdminSnapshot}
        perfAdminLoading={perfAdminLoading}
        onReload={onLoadPerfAdmin}
      />
      <AdminUsersTable
        managedProfiles={managedProfiles}
        isAdminWorking={isAdminWorking}
        adminTierDraftByUser={adminTierDraftByUser}
        setAdminTierDraftByUser={setAdminTierDraftByUser}
        adminExpiryDraftByUser={adminExpiryDraftByUser}
        setAdminExpiryDraftByUser={setAdminExpiryDraftByUser}
        onRoleChange={onRoleChange}
        onToggleBlock={onToggleBlock}
        onMonetizationSave={onMonetizationSave}
      />
    </section>
  );
}
