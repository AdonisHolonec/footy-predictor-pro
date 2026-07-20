import { useCallback, useRef, useState } from "react";

type UseHistorySyncOptions = {
  accessToken?: string;
  /** When false (default), sync is a no-op — only cron/admin may sync. */
  allowSync?: boolean;
  defaultDays?: number;
  cooldownMs?: number;
  onAfterSync?: (days: number) => Promise<void> | void;
};

/**
 * History sync is server-side CRON/ADMIN only.
 * For normal users this hook is intentionally a no-op (P0 certification).
 * Pass `allowSync: true` only from admin UI paths that already hit /api/admin.
 */
export function useHistorySync(options: UseHistorySyncOptions) {
  const { accessToken, allowSync = false, defaultDays = 30, cooldownMs = 0, onAfterSync } = options;
  const [isHistorySyncing, setIsHistorySyncing] = useState(false);
  const inFlightRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  const syncHistory = useCallback(
    async (days = defaultDays) => {
      if (!allowSync) {
        // P0: never POST ?sync=1 with a regular user JWT.
        await onAfterSync?.(days);
        return;
      }
      const now = Date.now();
      if (inFlightRef.current) return;
      if (cooldownMs > 0 && now - lastSyncAtRef.current < cooldownMs) return;

      inFlightRef.current = true;
      lastSyncAtRef.current = now;
      setIsHistorySyncing(true);

      try {
        const headers: Record<string, string> = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        // Admin UI should prefer /api/admin?action=history-sync-now; keep direct sync only when allowSync.
        await fetch(`/api/history?sync=1&days=${days}`, { method: "POST", headers });
        await onAfterSync?.(days);
      } finally {
        setIsHistorySyncing(false);
        inFlightRef.current = false;
      }
    },
    [accessToken, allowSync, cooldownMs, defaultDays, onAfterSync]
  );

  return { isHistorySyncing, syncHistory };
}
