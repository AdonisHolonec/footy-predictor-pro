import { useCallback, useState } from "react";
import { DayResponse } from "../types";
import type { UsageSnapshot } from "../types/index";
import { loadUsageSnapshot as fetchUsageSnapshot } from "../services/usageService";

export type UseCallsCounterOptions = {
  day: DayResponse | null;
  setStatus: (message: string) => void;
};

export function useCallsCounter({ day, setStatus }: UseCallsCounterOptions) {
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null);

  const usageCount = Number(day?.usage?.count) || 0;
  const usageLimitRaw = Number(day?.usage?.limit);
  const usageLimit = Number.isFinite(usageLimitRaw) ? usageLimitRaw : 100;
  const usageDenominator = usageLimit > 0 ? usageLimit : 1;
  const usagePct = Math.max(0, Math.min(100, (usageCount / usageDenominator) * 100));

  const loadUsageSnapshot = useCallback(async () => {
    setUsageLoading(true);
    try {
      setUsageSnapshot(await fetchUsageSnapshot());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nu am putut incarca usage.";
      setStatus(message);
    } finally {
      setUsageLoading(false);
    }
  }, [setStatus]);

  return {
    usageCount,
    usageLimit,
    usagePct,
    usageLoading,
    usageSnapshot,
    loadUsageSnapshot
  };
}
