import { useCallback, useRef, useState } from "react";

type UseHistorySyncOptions = {
  accessToken?: string;
  defaultDays?: number;
  cooldownMs?: number;
  onAfterSync?: (days: number) => Promise<void> | void;
};

export function useHistorySync(options: UseHistorySyncOptions) {
  const { accessToken, defaultDays = 30, cooldownMs = 0, onAfterSync } = options;
  const [isHistorySyncing, setIsHistorySyncing] = useState(false);
  const inFlightRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  const syncHistory = useCallback(
    async (days = defaultDays) => {
      const now = Date.now();
      if (inFlightRef.current) return;
      if (cooldownMs > 0 && now - lastSyncAtRef.current < cooldownMs) return;

      inFlightRef.current = true;
      lastSyncAtRef.current = now;
      setIsHistorySyncing(true);

      try {
        const headers: Record<string, string> = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        await fetch(`/api/history?sync=1&days=${days}`, { method: "POST", headers });
        await onAfterSync?.(days);
      } finally {
        setIsHistorySyncing(false);
        inFlightRef.current = false;
      }
    },
    [accessToken, cooldownMs, defaultDays, onAfterSync]
  );

  return { isHistorySyncing, syncHistory };
}
