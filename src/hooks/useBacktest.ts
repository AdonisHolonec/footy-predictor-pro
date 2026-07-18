import { useCallback, useEffect, useMemo, useState } from "react";
import { BacktestKpi, RiskAlert } from "../types";
import type { AlertThresholdOverrides } from "../types/index";
import { loadKpi as fetchKpi } from "../services/backtestService";
import { loadAlerts as fetchAlerts } from "../services/alertsService";
import { useLocalStorageState } from "../utils/appUtils";

export type UseBacktestOptions = {
  requireAuth: (message?: string) => boolean;
};

export function useBacktest({ requireAuth }: UseBacktestOptions) {
  const [kpi, setKpi] = useState<BacktestKpi | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [riskAlerts, setRiskAlerts] = useState<RiskAlert[]>([]);
  const [alertsSeverity, setAlertsSeverity] = useState<"none" | "medium" | "high">("none");
  const [alertDrawdownThreshold, setAlertDrawdownThreshold] = useLocalStorageState<number>("footy.alert.drawdown", 3);
  const [alertDriftThreshold, setAlertDriftThreshold] = useLocalStorageState<number>("footy.alert.drift", 24);
  const [alertLowDataThreshold, setAlertLowDataThreshold] = useLocalStorageState<number>("footy.alert.lowDataShare", 0.35);
  const [draftDrawdownThreshold, setDraftDrawdownThreshold] = useState<number>(alertDrawdownThreshold);
  const [draftDriftThreshold, setDraftDriftThreshold] = useState<number>(alertDriftThreshold);
  const [draftLowDataThreshold, setDraftLowDataThreshold] = useState<number>(alertLowDataThreshold);
  const [thresholdsSaved, setThresholdsSaved] = useState<"idle" | "saved" | "reset">("idle");

  const loadKpi = useCallback(async (days = 45) => {
    setKpiLoading(true);
    try {
      setKpi(await fetchKpi(days));
    } catch {
      setKpi(null);
    } finally {
      setKpiLoading(false);
    }
  }, []);

  const loadAlerts = useCallback(
    async (days = 7, overrides?: AlertThresholdOverrides) => {
      try {
        const result = await fetchAlerts(days, {
          drawdown: overrides?.drawdown ?? alertDrawdownThreshold,
          drift: overrides?.drift ?? alertDriftThreshold,
          lowDataShare: overrides?.lowDataShare ?? alertLowDataThreshold
        });
        setRiskAlerts(result.alerts);
        setAlertsSeverity(result.severity);
      } catch {
        setRiskAlerts([]);
        setAlertsSeverity("none");
      }
    },
    [alertDrawdownThreshold, alertDriftThreshold, alertLowDataThreshold]
  );

  useEffect(() => {
    setDraftDrawdownThreshold(alertDrawdownThreshold);
    setDraftDriftThreshold(alertDriftThreshold);
    setDraftLowDataThreshold(alertLowDataThreshold);
  }, [alertDrawdownThreshold, alertDriftThreshold, alertLowDataThreshold]);

  useEffect(() => {
    if (thresholdsSaved === "idle") return;
    const timer = setTimeout(() => setThresholdsSaved("idle"), 1400);
    return () => clearTimeout(timer);
  }, [thresholdsSaved]);

  const hasThresholdDraftChanges = useMemo(
    () =>
      Math.abs(draftDrawdownThreshold - alertDrawdownThreshold) > 0.0001
      || Math.abs(draftDriftThreshold - alertDriftThreshold) > 0.0001
      || Math.abs(draftLowDataThreshold - alertLowDataThreshold) > 0.0001,
    [
      draftDrawdownThreshold,
      draftDriftThreshold,
      draftLowDataThreshold,
      alertDrawdownThreshold,
      alertDriftThreshold,
      alertLowDataThreshold
    ]
  );

  function normalizeThresholds(drawdown: number, drift: number, lowDataShare: number) {
    return {
      drawdown: Math.max(0.5, Math.min(Number(drawdown) || 3, 20)),
      drift: Math.max(5, Math.min(Number(drift) || 24, 100)),
      lowDataShare: Math.max(0.05, Math.min(Number(lowDataShare) || 0.35, 0.95))
    };
  }

  async function applyAlertThresholds() {
    if (!requireAuth()) return;
    const normalized = normalizeThresholds(draftDrawdownThreshold, draftDriftThreshold, draftLowDataThreshold);
    setAlertDrawdownThreshold(normalized.drawdown);
    setAlertDriftThreshold(normalized.drift);
    setAlertLowDataThreshold(normalized.lowDataShare);
    await loadAlerts(7, normalized);
    setThresholdsSaved("saved");
  }

  async function resetAlertThresholds() {
    if (!requireAuth()) return;
    const defaults = { drawdown: 3, drift: 24, lowDataShare: 0.35 };
    setDraftDrawdownThreshold(defaults.drawdown);
    setDraftDriftThreshold(defaults.drift);
    setDraftLowDataThreshold(defaults.lowDataShare);
    setAlertDrawdownThreshold(defaults.drawdown);
    setAlertDriftThreshold(defaults.drift);
    setAlertLowDataThreshold(defaults.lowDataShare);
    await loadAlerts(7, defaults);
    setThresholdsSaved("reset");
  }

  return {
    kpi,
    kpiLoading,
    loadKpi,
    riskAlerts,
    alertsSeverity,
    alertDrawdownThreshold,
    alertDriftThreshold,
    alertLowDataThreshold,
    draftDrawdownThreshold,
    setDraftDrawdownThreshold,
    draftDriftThreshold,
    setDraftDriftThreshold,
    draftLowDataThreshold,
    setDraftLowDataThreshold,
    thresholdsSaved,
    hasThresholdDraftChanges,
    loadAlerts,
    applyAlertThresholds,
    resetAlertThresholds
  };
}
