import { useState } from "react";
import type { UserTier } from "../types";

type AuthApi = {
  login: (email: string, password: string) => Promise<unknown>;
  signup: (email: string, password: string) => Promise<unknown>;
  logout: () => Promise<unknown>;
  sendPasswordResetEmail: (email: string) => Promise<unknown>;
  updatePassword: (password: string) => Promise<unknown>;
  updateProfileRole: (userId: string, role: "user" | "admin") => Promise<unknown>;
  toggleProfileBlock: (userId: string, isBlocked: boolean) => Promise<unknown>;
  updateProfileMonetization: (
    userId: string,
    payload: { tier: UserTier; subscriptionExpiresAt: string | null }
  ) => Promise<unknown>;
};

export function useAppAuthActions(
  api: AuthApi,
  setStatus: (message: string) => void,
  adminTierDraftByUser: Record<string, UserTier>,
  adminExpiryDraftByUser: Record<string, string>
) {
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [busyAdminUserIds, setBusyAdminUserIds] = useState<Set<string>>(new Set());
  const isAdminWorking = busyAdminUserIds.size > 0;

  function setAdminUserBusy(userId: string, busy: boolean) {
    setBusyAdminUserIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  function localDatetimeInputToIso(value: string) {
    if (!value) return null;
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  }

  async function handleLogin(email: string, password: string) {
    setIsAuthSubmitting(true);
    try {
      await api.login(email, password);
      setStatus("Autentificat cu succes.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Autentificarea a esuat.");
      throw error;
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleSignup(email: string, password: string) {
    setIsAuthSubmitting(true);
    try {
      await api.signup(email, password);
      setStatus("Cont creat. Verifica email-ul pentru confirmare daca este necesar.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Inregistrarea a esuat.");
      throw error;
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
      setStatus("Deconectat.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Logout esuat.");
    }
  }

  async function handleForgotPassword(email: string) {
    setIsAuthSubmitting(true);
    try {
      await api.sendPasswordResetEmail(email);
      setStatus("Email-ul pentru reset parola a fost trimis.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Nu am putut trimite link-ul de reset.");
      throw error;
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleUpdatePassword(newPassword: string) {
    setIsAuthSubmitting(true);
    try {
      await api.updatePassword(newPassword);
      setStatus("Parola a fost actualizata cu succes.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Nu am putut actualiza parola.");
      throw error;
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleAdminRoleChange(
    targetUserId: string,
    role: "user" | "admin"
  ): Promise<{ ok: boolean; message?: string }> {
    setAdminUserBusy(targetUserId, true);
    try {
      await api.updateProfileRole(targetUserId, role);
      const message = `Rol actualizat la ${role} pentru ${targetUserId.slice(0, 8)}...`;
      setStatus(message);
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Nu am putut actualiza rolul.";
      setStatus(message);
      return { ok: false, message };
    } finally {
      setAdminUserBusy(targetUserId, false);
    }
  }

  async function handleAdminToggleBlock(
    targetUserId: string,
    isBlocked: boolean
  ): Promise<{ ok: boolean; message?: string }> {
    setAdminUserBusy(targetUserId, true);
    try {
      await api.toggleProfileBlock(targetUserId, isBlocked);
      const message = `${isBlocked ? "Blocat" : "Deblocat"} utilizator ${targetUserId.slice(0, 8)}...`;
      setStatus(message);
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Nu am putut actualiza statusul utilizatorului.";
      setStatus(message);
      return { ok: false, message };
    } finally {
      setAdminUserBusy(targetUserId, false);
    }
  }

  async function handleAdminMonetizationSave(
    userId: string,
    fallbackTier: UserTier,
    fallbackExpiry?: string | null
  ): Promise<{ ok: boolean; message?: string }> {
    setAdminUserBusy(userId, true);
    try {
      const tier = (adminTierDraftByUser[userId] || fallbackTier) as UserTier;
      const expiryRaw = adminExpiryDraftByUser[userId];
      let subscriptionExpiresAt =
        expiryRaw !== undefined ? localDatetimeInputToIso(expiryRaw) : (fallbackExpiry ?? null);
      // Open-ended paid grant when expiry is missing or already past (otherwise effectiveTier stays free).
      if (tier === "premium" || tier === "ultra") {
        const expiryMs = subscriptionExpiresAt ? new Date(subscriptionExpiresAt).getTime() : NaN;
        if (!subscriptionExpiresAt || !Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
          subscriptionExpiresAt = null;
        }
      }
      await api.updateProfileMonetization(userId, { tier, subscriptionExpiresAt });
      const message = subscriptionExpiresAt
        ? `Abonament actualizat pentru ${userId}.`
        : `Abonament actualizat pentru ${userId} (${tier}, nelimitat).`;
      setStatus(message);
      return { ok: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Nu am putut actualiza abonamentul.";
      setStatus(message);
      return { ok: false, message };
    } finally {
      setAdminUserBusy(userId, false);
    }
  }

  return {
    isAuthSubmitting,
    isAdminWorking,
    busyAdminUserIds,
    handleLogin,
    handleSignup,
    handleLogout,
    handleForgotPassword,
    handleUpdatePassword,
    handleAdminRoleChange,
    handleAdminToggleBlock,
    handleAdminMonetizationSave
  };
}
