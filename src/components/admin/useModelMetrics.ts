import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelMetricsResponse, MlAdminStatus } from "../../types";

export type TrainReport = {
  finishedAt?: string;
  mode?: string;
  modelVersion?: string;
  calibrationRows?: number;
  calibrationSummary?: number;
  stackerRows?: number;
  stackerSamples?: number;
  stackerTrained?: number;
};

type UseModelMetricsArgs = {
  accessToken: string | null | undefined;
  days: number;
};

export function useModelMetrics({ accessToken, days }: UseModelMetricsArgs) {
  const [metrics, setMetrics] = useState<ModelMetricsResponse | null>(null);
  const [mlStatus, setMlStatus] = useState<MlAdminStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [training, setTraining] = useState(false);
  const [syncingHistoryNow, setSyncingHistoryNow] = useState(false);
  const [snoozedAlerts, setSnoozedAlerts] = useState<Record<string, number>>({});
  const [showOnlySyncFailures, setShowOnlySyncFailures] = useState(false);
  const loadInFlightRef = useRef(false);
  const [trainReport, setTrainReport] = useState<TrainReport | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    setLoading(true);
    setErr(null);
    try {
      const [m, s] = await Promise.all([
        fetch(`/api/backtest?view=metrics&days=${days}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        }).then((r) => r.json()),
        fetch(`/api/admin?view=ml`, { headers: { Authorization: `Bearer ${accessToken}` } }).then((r) => r.json())
      ]);
      if (m?.ok) setMetrics(m as ModelMetricsResponse);
      else setErr((m?.error as string) || "Nu am putut încărca metricile.");
      if (s?.ok) setMlStatus(s as MlAdminStatus);
    } catch {
      setErr("Rețea sau răspuns invalid.");
    } finally {
      setLoading(false);
      loadInFlightRef.current = false;
    }
  }, [accessToken, days]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!accessToken) return;
    const tm = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, 60_000);
    return () => clearInterval(tm);
  }, [accessToken, load]);

  useEffect(() => {
    if (!accessToken) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [accessToken, load]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("footy.admin.syncAlerts.snoozed");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (!parsed || typeof parsed !== "object") return;
      setSnoozedAlerts(parsed);
    } catch {
      // ignore malformed local storage payload
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("footy.admin.syncAlerts.snoozed", JSON.stringify(snoozedAlerts));
    } catch {
      // ignore quota/permission errors
    }
  }, [snoozedAlerts]);

  const snoozeAlert = useCallback((code: string, minutes = 60) => {
    if (!code) return;
    const until = Date.now() + minutes * 60 * 1000;
    setSnoozedAlerts((prev) => ({ ...prev, [code]: until }));
  }, []);

  const invalidate = useCallback(async () => {
    if (!accessToken) return;
    setRefreshing(true);
    try {
      await fetch(`/api/admin?view=ml&action=invalidate-cache`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [accessToken, load]);

  const trainNow = useCallback(async () => {
    if (!accessToken) return;
    setTraining(true);
    try {
      const res = await fetch(`/api/admin?view=ml&action=train-now&mode=all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        setErr(typeof body?.error === "string" ? body.error : "Train-now a eșuat.");
        return;
      }
      const train = body?.train && typeof body.train === "object" ? body.train : {};
      setTrainReport({
        finishedAt: typeof train.finishedAt === "string" ? train.finishedAt : new Date().toISOString(),
        mode: typeof train.mode === "string" ? train.mode : "all",
        modelVersion: typeof train.modelVersion === "string" ? train.modelVersion : undefined,
        calibrationRows: Number(train?.calibration?.rows || 0),
        calibrationSummary: Array.isArray(train?.calibration?.summary) ? train.calibration.summary.length : 0,
        stackerRows: Number(train?.stacker?.rows || 0),
        stackerSamples: Number(train?.stacker?.samples || 0),
        stackerTrained: Array.isArray(train?.stacker?.trained) ? train.stacker.trained.length : 0
      });
      await load();
    } finally {
      setTraining(false);
    }
  }, [accessToken, load]);

  const runHistorySyncNow = useCallback(async () => {
    if (!accessToken) return;
    setSyncingHistoryNow(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin?view=ml&action=history-sync-now&days=30`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        setErr(typeof body?.error === "string" ? body.error : "History sync now a eșuat.");
        return;
      }
      await load();
    } finally {
      setSyncingHistoryNow(false);
    }
  }, [accessToken, load]);

  return {
    metrics,
    mlStatus,
    loading,
    err,
    refreshing,
    training,
    syncingHistoryNow,
    snoozedAlerts,
    setSnoozedAlerts,
    showOnlySyncFailures,
    setShowOnlySyncFailures,
    trainReport,
    load,
    snoozeAlert,
    invalidate,
    trainNow,
    runHistorySyncNow
  };
}
