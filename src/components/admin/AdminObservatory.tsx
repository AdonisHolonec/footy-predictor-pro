import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import type { FilterMode } from "../../constants/appConstants";
import { BRAND_IMAGES } from "../../constants/brandAssets";
import type { ModelMetricsResponse, MlAdminStatus, PredictionRow } from "../../types";
import {
  EdgeCompass,
  ModelPulseStrip,
  ModelPulseWave,
  SignalLens,
  deriveDataQuality,
  deriveSignalEdge
} from "../SignalLab";

export type KickoffScope = "ALL" | "TODAY" | "TOMORROW";

export function addCalendarDayIso(isoDate: string, deltaDays: number): string {
  const base = new Date(isoDate + "T12:00:00");
  base.setDate(base.getDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function toggleClass(active: boolean) {
  return active
    ? "border-signal-petrol/55 bg-signal-petrol/15 text-signal-petrol shadow-[0_0_18px_rgba(94,234,212,0.18)]"
    : "border-white/[0.08] bg-signal-void/40 text-signal-inkMuted hover:border-signal-petrol/25 hover:text-signal-petrol/90";
}

export function AdminIconRail() {
  const item =
    "flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.06] bg-signal-panel/35 text-signal-inkMuted shadow-inner backdrop-blur-sm transition hover:border-signal-petrol/35 hover:text-signal-petrol hover:shadow-[0_0_14px_rgba(94,234,212,0.12)]";
  return (
    <nav
      className="hidden shrink-0 flex-col items-center gap-2 py-2 lg:flex"
      aria-label="Observatory navigation"
    >
      <Link to="/" className={item} title="Acasă">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
        </svg>
      </Link>
      <span className={item} title="Workspace">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="11" width="7" height="10" rx="1" />
          <rect x="3" y="15" width="7" height="6" rx="1" />
        </svg>
      </span>
      <span className={item} title="Statistici">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 19V5M4 19h16M8 15v-4m4 4V8m4 7v-6" />
        </svg>
      </span>
      <span className={item} title="Setări">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </span>
    </nav>
  );
}

export function AdminBrandLockup({ editorialDate }: { editorialDate: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <div
          className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-cyan-300/65 shadow-[0_0_42px_rgba(34,211,238,0.5)]"
          aria-hidden
        >
          <img
            src={BRAND_IMAGES.logoPrimary}
            alt="Footy Predictor"
            className="h-14 w-14 rounded-xl object-contain p-0.5 brightness-110 saturate-150 animate-[pulse_4s_ease-in-out_infinite] motion-reduce:animate-none"
          />
        </div>
        <div>
          <div className="font-display text-lg font-bold uppercase tracking-[0.14em] text-signal-ink md:text-xl">
            Footy <span className="text-signal-petrol">Predictor</span>
          </div>
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-signal-inkMuted">{editorialDate}</p>
        </div>
      </div>
    </div>
  );
}

type AdminObservatoryHeaderProps = {
  editorialDate: string;
  modelPulse: { tone: "healthy" | "watch" | "alert"; status: string };
  user: { email: string; role?: string } | null;
  authLoading: boolean;
  onOpenAuth: () => void;
  onLogout: () => void;
};

export function AdminObservatoryHeader({
  editorialDate,
  modelPulse,
  user,
  authLoading,
  onOpenAuth,
  onLogout
}: AdminObservatoryHeaderProps) {
  const roleLabel = user?.role === "admin" ? "ADMIN" : user ? "DATA LEAD" : "GUEST";
  return (
    <header className="mb-6 border-b border-white/[0.06] pb-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,1.4fr)_minmax(0,1fr)] lg:items-center">
        <AdminBrandLockup editorialDate={editorialDate} />
        <div className="min-w-0 space-y-2">
          <ModelPulseWave status="OPTIMAL CALIBRATION" className="w-full" />
          <div className="flex justify-center lg:justify-start">
            <ModelPulseStrip status={modelPulse.status} tone={modelPulse.tone} />
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          {authLoading ? (
            <div className="rounded-xl border border-signal-line/50 bg-signal-panel/55 px-3 py-2 text-xs font-semibold text-signal-inkMuted shadow-inner">
              Verific sesiunea…
            </div>
          ) : user ? (
            <>
              <div className="flex items-center gap-2 text-right">
                <div>
                  <div className="max-w-[220px] truncate text-[11px] font-semibold uppercase tracking-wide text-signal-ink">
                    {user.email}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-signal-petrolMuted">{roleLabel}</div>
                </div>
                <div className="h-10 w-10 shrink-0 rounded-full border border-signal-petrol/35 bg-gradient-to-br from-signal-petrol/25 to-signal-void shadow-[0_0_16px_rgba(94,234,212,0.2)]" />
              </div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
                <span className="text-signal-petrol">v4.2</span>
                <span className="mx-2 text-white/20">|</span>
                <span>latency ~12ms</span>
              </div>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="rounded-lg border border-white/10 bg-signal-panel/50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol hover:bg-signal-panel"
              >
                Logout
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="rounded-xl border border-signal-petrol/25 bg-signal-petrol/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-signal-petrol hover:bg-signal-petrol/15"
            >
              Login / Signup
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

type AdminToolbarStripProps = {
  date: string;
  setDate: (v: string) => void;
  selectedDates: string[];
  setSelectedDates: Dispatch<SetStateAction<string[]>>;
  normalizeSelectedDates: (dates: string[]) => string[];
  isoToday: () => string;
  usageCount: number;
  usageLimit: number;
  usagePct: number;
  user: unknown;
  onWarm: () => void;
  onPredict: () => void;
  setStatus: (message: string) => void;
};

export function AdminToolbarStrip({
  date,
  setDate,
  selectedDates,
  setSelectedDates,
  normalizeSelectedDates,
  isoToday,
  usageCount,
  usageLimit,
  usagePct,
  user,
  onWarm,
  onPredict,
  setStatus
}: AdminToolbarStripProps) {
  const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-signal-panel/30 p-3 shadow-inner backdrop-blur-md sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => {
            const next = e.target.value;
            setDate(next);
            setSelectedDates((prev) => {
              const filtered = prev.filter((d) => d !== date);
              return normalizeSelectedDates([next, ...filtered]);
            });
          }}
          className="rounded-xl border glass-input px-3 py-2 text-sm text-signal-ink outline-none focus:ring-2 focus:ring-signal-sage/35"
        />
        <button
          type="button"
          onClick={() => {
            setSelectedDates((prev) => {
              const normalized = normalizeSelectedDates(prev.length ? prev : [date]);
              if (normalized.length >= 3) {
                setStatus("Poți selecta maximum 3 zile.");
                return normalized;
              }
              const base = normalized[normalized.length - 1] || isoToday();
              const nextDate = new Date(base + "T12:00:00");
              nextDate.setDate(nextDate.getDate() + 1);
              return normalizeSelectedDates([...normalized, nextDate.toISOString().slice(0, 10)]);
            });
          }}
          className="touch-manipulation rounded-xl border border-white/10 bg-signal-panel/60 px-3 py-2 text-xs font-semibold text-signal-ink hover:bg-signal-panel hover:text-signal-petrol"
        >
          + Zi
        </button>
        <button
          type="button"
          onClick={onWarm}
          disabled={!user}
          className="touch-manipulation rounded-xl border border-white/10 bg-signal-panel/60 px-3 py-2 text-xs font-semibold text-signal-ink hover:bg-signal-panel disabled:cursor-not-allowed disabled:opacity-50"
        >
          Warm
        </button>
        <button
          type="button"
          onClick={onPredict}
          disabled={!user}
          className="touch-manipulation rounded-xl bg-signal-petrol px-4 py-2 text-xs font-semibold text-signal-mist shadow-atelier hover:bg-signal-petrolMuted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Predict
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {dates.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setSelectedDates((prev) => {
                const next = prev.filter((item) => item !== d);
                const normalized = normalizeSelectedDates(next.length ? next : [date]);
                setDate(normalized[0] || isoToday());
                return normalized;
              });
            }}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
              d === date ? "border-signal-petrol/40 bg-signal-petrol/15 text-signal-petrol" : "border-white/10 bg-signal-panel/40 text-signal-inkMuted"
            }`}
            title="Elimină ziua"
          >
            {d}
            {dates.length > 1 ? " ✕" : ""}
          </button>
        ))}
      </div>
      <div className="flex w-full max-w-[200px] flex-col sm:ml-auto">
        <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-signal-inkMuted">
          API{" "}
          <span className={usagePct > 80 ? "text-signal-rose" : "text-signal-sage"}>
            {usageCount} / {usageLimit}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full border border-signal-line/60 bg-signal-fog">
          <div
            style={{ width: `${usagePct}%` }}
            className={`h-full rounded-full ${usagePct > 80 ? "bg-signal-rose" : "bg-gradient-to-r from-signal-petrol to-signal-sage"}`}
          />
        </div>
      </div>
    </div>
  );
}

type AdminFilterDeckProps = {
  kickoffScope: KickoffScope;
  setKickoffScope: (v: KickoffScope) => void;
  filterMode: FilterMode;
  setFilterMode: (v: FilterMode) => void;
  minXgSpread: number;
  setMinXgSpread: (v: number) => void;
};

export function AdminFilterDeck({
  kickoffScope,
  setKickoffScope,
  filterMode,
  setFilterMode,
  minXgSpread,
  setMinXgSpread
}: AdminFilterDeckProps) {
  const deckBtn = "touch-manipulation rounded-xl border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide transition";
  const high = filterMode === "SAFE";
  const medium = filterMode === "ALL" || filterMode === "VALUE";
  const guarded = filterMode === "LOW";

  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-white/[0.07] bg-signal-panel/25 p-4 shadow-inner backdrop-blur-md">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-signal-inkMuted">Filtre</p>
      <div>
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-signal-petrolMuted">Kickoff</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${deckBtn} ${toggleClass(kickoffScope === "ALL")}`} onClick={() => setKickoffScope("ALL")}>
            All
          </button>
          <button type="button" className={`${deckBtn} ${toggleClass(kickoffScope === "TODAY")}`} onClick={() => setKickoffScope("TODAY")}>
            Today
          </button>
          <button type="button" className={`${deckBtn} ${toggleClass(kickoffScope === "TOMORROW")}`} onClick={() => setKickoffScope("TOMORROW")}>
            Tomorrow
          </button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-signal-petrolMuted">Confidence</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${deckBtn} ${toggleClass(high)}`} onClick={() => setFilterMode("SAFE")}>
            High
          </button>
          <button type="button" className={`${deckBtn} ${toggleClass(medium)}`} onClick={() => setFilterMode("ALL")}>
            Medium
          </button>
          <button type="button" className={`${deckBtn} ${toggleClass(guarded)}`} onClick={() => setFilterMode("LOW")}>
            Guarded
          </button>
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-signal-petrolMuted">xG differential</p>
          <span className="font-mono text-[10px] tabular-nums text-signal-petrol">≥ {minXgSpread.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={2.5}
          step={0.05}
          value={minXgSpread}
          onChange={(e) => setMinXgSpread(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[#5eead4]"
        />
      </div>
    </div>
  );
}

type AdminInsightColumnProps = {
  sample: PredictionRow | null;
};

export function AdminInsightColumn({ sample }: AdminInsightColumnProps) {
  const dq = sample ? deriveDataQuality(sample) : 0.45;
  const edge = sample ? deriveSignalEdge(sample) : 38;
  const conf = sample?.recommended.confidence ?? 42;

  return (
    <aside className="space-y-4 rounded-2xl border border-white/[0.08] bg-signal-panel/30 p-4 shadow-atelier backdrop-blur-xl">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-signal-inkMuted">Insight observatory</p>
      {sample ? (
        <>
          <EdgeCompass dataQuality={dq} valueDetected={!!sample.valueBet?.detected} className="rounded-xl border border-white/[0.06] bg-signal-void/30 p-3" />
          <SignalLens confidence={conf} edge={edge} className="rounded-xl border border-white/[0.06] bg-signal-void/30 p-3" />
          <div className="space-y-2 rounded-xl border border-signal-petrol/15 bg-signal-petrol/5 p-3 font-mono text-[10px] text-signal-inkMuted">
            <div className="flex justify-between gap-2">
              <span>Integrity</span>
              <span className="text-signal-petrol">{sample.insufficientData ? "thin" : "nominal"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Sample</span>
              <span className="text-signal-silver">{sample.modelMeta?.dataQuality != null ? `${(sample.modelMeta.dataQuality * 100).toFixed(0)}%` : "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>State</span>
              <span className="truncate text-signal-mint">{sample.status || "live"}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 bg-signal-void/20 p-6 text-center text-xs text-signal-inkMuted">
          Rulează <span className="text-signal-petrol">Predict</span> pentru semnale live în acest panou.
        </div>
      )}
    </aside>
  );
}

type AdminPerformanceObservatoryProps = {
  children: React.ReactNode;
  /** Override top margin (e.g. `mt-0` when section is first on page). */
  className?: string;
};

export function AdminPerformanceObservatory({ children, className = "mt-10" }: AdminPerformanceObservatoryProps) {
  return (
    <section
      className={`rounded-[1.25rem] border border-signal-petrol/20 bg-signal-panel/25 p-4 shadow-[0_0_40px_rgba(94,234,212,0.06)] backdrop-blur-xl md:p-6 ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-signal-petrolMuted">Performance observatory</h2>
        <span className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">settled stream</span>
      </div>
      {children}
    </section>
  );
}

// =============================================================================
// MODEL METRICS PANEL — vizibil doar pentru admin autentificat.
// Afişează Brier 1X2, log-loss, ECE, defalcări per metodă/ligă/versiune model
// şi status pentru pipeline-ul ML (calibration maps, stacker, Elo).
// =============================================================================

type AdminModelMetricsPanelProps = {
  accessToken: string | null | undefined;
  /** Zile window pentru metrici (default 45). */
  days?: number;
};

function healthTone(value: number | null | undefined, good: number, warn: number, lowerIsBetter = true) {
  if (value == null || !Number.isFinite(value)) return "text-signal-inkMuted";
  const v = Number(value);
  const bad = lowerIsBetter ? v > warn : v < warn;
  const ok = lowerIsBetter ? v <= good : v >= good;
  if (ok) return "text-signal-sage";
  if (bad) return "text-signal-rose";
  return "text-signal-amber";
}

function syncHealthTone(health?: "ok" | "warn" | "fail") {
  if (health === "ok") return "text-signal-sage";
  if (health === "fail") return "text-signal-rose";
  return "text-signal-amber";
}

function syncHintTone(level?: "ok" | "warn" | "fail") {
  if (level === "ok") return "border-signal-sage/25 bg-signal-sage/5 text-signal-sage";
  if (level === "fail") return "border-signal-rose/25 bg-signal-rose/5 text-signal-rose";
  return "border-signal-amber/25 bg-signal-amber/5 text-signal-amber";
}

function reliabilityTone(reliability?: string) {
  if (reliability === "HEALTHY") return "border-signal-sage/30 bg-signal-sage/10 text-signal-sage";
  if (reliability === "CRITICAL") return "border-signal-rose/35 bg-signal-rose/12 text-signal-rose";
  return "border-signal-amber/30 bg-signal-amber/10 text-signal-amber";
}

export function AdminModelMetricsPanel({ accessToken, days = 45 }: AdminModelMetricsPanelProps) {
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
  const [trainReport, setTrainReport] = useState<{
    finishedAt?: string;
    mode?: string;
    modelVersion?: string;
    calibrationRows?: number;
    calibrationSummary?: number;
    stackerRows?: number;
    stackerSamples?: number;
    stackerTrained?: number;
  } | null>(null);

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

  if (!accessToken) return null;

  const brier = metrics?.brier1x2 ?? null;
  const logLoss = metrics?.logLoss1x2 ?? null;
  const ece = metrics?.ece1x2 ?? null;
  const visibleSyncAlerts = (mlStatus?.historySync?.alerts || []).filter((alert) => {
    const code = String(alert.code || "");
    if (!code) return true;
    const until = snoozedAlerts[code];
    return !(Number.isFinite(until) && until > Date.now());
  });
  const syncRecentRows = (mlStatus?.historySync?.recent || [])
    .slice()
    .sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? 1 : -1;
      const ta = a.ranAt ? new Date(a.ranAt).getTime() : 0;
      const tb = b.ranAt ? new Date(b.ranAt).getTime() : 0;
      return tb - ta;
    })
    .filter((row) => (showOnlySyncFailures ? !row.ok : true));

  return (
    <section className="rounded-[1.25rem] border border-signal-petrol/20 bg-signal-panel/25 p-4 shadow-[0_0_40px_rgba(94,234,212,0.06)] backdrop-blur-xl md:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-signal-petrolMuted">Model metrics</h2>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
            window {days}d · {metrics?.nProb ?? 0} settled cu probabilităţi
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mlStatus && (
            <div className="hidden font-mono text-[9px] uppercase tracking-wider text-signal-silver sm:block">
              cal · {mlStatus.calibrationMaps ?? 0} · stk · {mlStatus.activeStackerWeights ?? 0} · elo · {mlStatus.eloTeams ?? 0}
            </div>
          )}
          <button
            type="button"
            onClick={trainNow}
            disabled={training}
            className="touch-manipulation rounded-lg border border-signal-mint/25 bg-signal-mintSoft px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-mint hover:bg-signal-mintSoft/80 disabled:cursor-not-allowed disabled:opacity-50"
            title="Rulează acum agentul de antrenare ML (calibration + stacker) pe baza istoricului."
          >
            {training ? "Training…" : "Train now"}
          </button>
          <button
            type="button"
            onClick={invalidate}
            disabled={refreshing}
            className="touch-manipulation rounded-lg border border-white/10 bg-signal-panel/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-petrol hover:bg-signal-panel disabled:cursor-not-allowed disabled:opacity-50"
            title="Invalidează cache-ul de calibrare/stacker/elo (le reîncarcă la următorul predict)"
          >
            {refreshing ? "…" : "Refresh cache"}
          </button>
          <button
            type="button"
            onClick={runHistorySyncNow}
            disabled={syncingHistoryNow}
            className="touch-manipulation rounded-lg border border-signal-sage/25 bg-signal-sage/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-sage hover:bg-signal-sage/15 disabled:cursor-not-allowed disabled:opacity-50"
            title="Rulează manual /api/history?sync=1 și reîncarcă monitorizarea."
          >
            {syncingHistoryNow ? "Syncing…" : "Run history sync"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="touch-manipulation rounded-lg border border-white/10 bg-signal-panel/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-signal-ink hover:bg-signal-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "…" : "Reload"}
          </button>
        </div>
      </div>

      {err && <div className="mb-3 rounded-lg border border-signal-rose/25 bg-signal-rose/5 px-3 py-2 text-[11px] text-signal-rose">{err}</div>}
      {trainReport && (
        <div className="mb-3 rounded-lg border border-signal-mint/35 bg-signal-mintSoft/60 px-3 py-2">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-signal-mint">Last training run</div>
          <div className="mt-1 grid grid-cols-1 gap-1 font-mono text-[10px] text-signal-petrol sm:grid-cols-2">
            <div>Mode: <span className="text-signal-ink">{trainReport.mode || "all"}</span></div>
            <div>Model: <span className="text-signal-ink">{trainReport.modelVersion || "—"}</span></div>
            <div>Calibration: <span className="text-signal-ink">{trainReport.calibrationRows || 0} rows · {trainReport.calibrationSummary || 0} maps</span></div>
            <div>Stacker: <span className="text-signal-ink">{trainReport.stackerRows || 0} rows · {trainReport.stackerSamples || 0} samples · {trainReport.stackerTrained || 0} weights</span></div>
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">
            finished {trainReport.finishedAt ? new Date(trainReport.finishedAt).toLocaleString() : "—"}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="Brier 1X2" value={brier != null ? brier.toFixed(4) : "—"} subtitle="lower = better" toneClass={healthTone(brier, 0.185, 0.205)} />
        <MetricTile label="LogLoss" value={logLoss != null ? logLoss.toFixed(4) : "—"} subtitle="multinomial CE" toneClass={healthTone(logLoss, 0.98, 1.05)} />
        <MetricTile label="ECE 1X2" value={ece != null ? `${ece.toFixed(2)}%` : "—"} subtitle="calibration gap" toneClass={healthTone(ece, 3, 6)} />
        <MetricTile
          label="Pipeline"
          value={(mlStatus?.calibrationMaps || 0) > 0 ? ((mlStatus?.activeStackerWeights || 0) > 0 ? "ML + CAL" : "CAL") : "DC only"}
          subtitle={mlStatus?.modelVersion || "—"}
          toneClass={(mlStatus?.activeStackerWeights || 0) > 0 ? "text-signal-mint" : (mlStatus?.calibrationMaps || 0) > 0 ? "text-signal-petrol" : "text-signal-silver"}
        />
      </div>

      {mlStatus?.historySync && (
        <div className="mt-4 rounded-xl border border-white/5 bg-signal-void/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">History sync monitor</span>
            <span className={`font-mono text-[10px] uppercase tracking-wider ${syncHealthTone(mlStatus.historySync.health)}`}>
              {mlStatus.historySync.health || "warn"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/5 bg-signal-panel/20 p-2 sm:col-span-3">
              <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Reliability</div>
              <div className="mt-1">
                <span className={`inline-flex rounded px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${reliabilityTone(mlStatus.historySync.summary?.reliability)}`}>
                  {mlStatus.historySync.summary?.reliability || "DEGRADED"}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-white/5 bg-signal-panel/20 p-2">
              <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Last run</div>
              <div className="mt-1 font-mono text-[10px] text-signal-silver">
                {mlStatus.historySync.last?.ranAt ? new Date(mlStatus.historySync.last.ranAt).toLocaleString() : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-white/5 bg-signal-panel/20 p-2">
              <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Last updated</div>
              <div className="mt-1 font-mono text-[10px] text-signal-silver">{mlStatus.historySync.last?.updated ?? 0}</div>
            </div>
            <div className="rounded-lg border border-white/5 bg-signal-panel/20 p-2">
              <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Recent failures</div>
              <div className="mt-1 font-mono text-[10px] text-signal-silver">
                {mlStatus.historySync.summary?.failures ?? 0} / {mlStatus.historySync.summary?.runs ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-white/5 bg-signal-panel/20 p-2 sm:col-span-3">
              <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Sync age (hours)</div>
              <div
                className={`mt-1 font-mono text-[10px] ${
                  (mlStatus.historySync.summary?.hoursSinceLastRun ?? 999) > 8 ? "text-signal-rose" : "text-signal-silver"
                }`}
              >
                {mlStatus.historySync.summary?.hoursSinceLastRun != null ? mlStatus.historySync.summary.hoursSinceLastRun.toFixed(2) : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-white/5 bg-signal-panel/20 p-2 sm:col-span-3">
              <div className="font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Last successful run</div>
              <div className="mt-1 font-mono text-[10px] text-signal-silver">
                {mlStatus.historySync.lastSuccessfulRun?.ranAt
                  ? new Date(mlStatus.historySync.lastSuccessfulRun.ranAt).toLocaleString()
                  : "No successful run in recent window"}
              </div>
              <div
                className={`mt-1 font-mono text-[9px] ${
                  (mlStatus.historySync.summary?.hoursSinceLastSuccess ?? 999) > 8 ? "text-signal-rose" : "text-signal-inkMuted"
                }`}
              >
                age:{" "}
                {mlStatus.historySync.summary?.hoursSinceLastSuccess != null
                  ? `${mlStatus.historySync.summary.hoursSinceLastSuccess.toFixed(2)}h`
                  : "—"}
              </div>
            </div>
          </div>
          {mlStatus.historySync.last?.error && (
            <div className="mt-2 rounded-lg border border-signal-rose/25 bg-signal-rose/5 px-3 py-2 font-mono text-[10px] text-signal-rose">
              {mlStatus.historySync.last.error}
            </div>
          )}
          {mlStatus.historySync.hint && (
            <div className={`mt-2 rounded-lg border px-3 py-2 font-mono text-[10px] ${syncHintTone(mlStatus.historySync.hint.level)}`}>
              <div className="font-semibold uppercase tracking-wider">{mlStatus.historySync.hint.title || "Sync hint"}</div>
              <div className="mt-1">{mlStatus.historySync.hint.message || "—"}</div>
            </div>
          )}
          {Array.isArray(mlStatus.historySync.alerts) && visibleSyncAlerts.length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.keys(snoozedAlerts).length > 0 && (
                <div className="mb-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSnoozedAlerts({})}
                    className="rounded border border-white/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-signal-ink hover:bg-white/10"
                    title="Reafișează toate alertele ascunse local."
                  >
                    Reset snoozed alerts
                  </button>
                </div>
              )}
              {visibleSyncAlerts.map((alert, idx) => (
                <div
                  key={`${alert.code || "alert"}-${idx}`}
                  className={`rounded-lg border px-3 py-2 font-mono text-[10px] ${
                    alert.level === "fail"
                      ? "border-signal-rose/35 bg-signal-rose/10 text-signal-rose"
                      : "border-signal-amber/30 bg-signal-amber/10 text-signal-amber"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{alert.message || "Atenție operațională."}</span>
                    <button
                      type="button"
                      onClick={() => snoozeAlert(String(alert.code || ""), 60)}
                      className="rounded border border-white/20 px-2 py-0.5 text-[9px] uppercase tracking-wide text-signal-ink hover:bg-white/10"
                      title="Ascunde alerta 60 minute (local)."
                    >
                      Snooze 60m
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-white/5 bg-signal-panel/20 px-3 py-2 font-mono text-[10px] text-signal-silver">
              24h runs: <span className="text-signal-ink">{mlStatus.historySync.summary?.runs24h ?? 0}</span>
            </div>
            <div className="rounded-lg border border-white/5 bg-signal-panel/20 px-3 py-2 font-mono text-[10px] text-signal-silver">
              24h success: <span className={(mlStatus.historySync.summary?.successRate24h ?? 0) >= 90 ? "text-signal-sage" : "text-signal-amber"}>
                {mlStatus.historySync.summary?.successRate24h != null ? `${mlStatus.historySync.summary.successRate24h.toFixed(1)}%` : "—"}
              </span>
            </div>
            <div className="rounded-lg border border-white/5 bg-signal-panel/20 px-3 py-2 font-mono text-[10px] text-signal-silver">
              24h updated: <span className="text-signal-ink">{mlStatus.historySync.summary?.updated24h ?? 0}</span>
            </div>
          </div>
          {Array.isArray(mlStatus.historySync.recent) && mlStatus.historySync.recent.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowOnlySyncFailures((prev) => !prev)}
                  className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${
                    showOnlySyncFailures
                      ? "border-signal-rose/35 bg-signal-rose/10 text-signal-rose"
                      : "border-white/20 text-signal-ink hover:bg-white/10"
                  }`}
                  title="Afișează doar rulările eșuate."
                >
                  {showOnlySyncFailures ? "Showing failures only" : "Show only failures"}
                </button>
              </div>
              <table className="w-full min-w-[420px] font-mono text-[10px] tabular-nums">
                <thead className="text-left text-signal-inkMuted">
                  <tr>
                    <th className="py-1 pr-2">Ran at</th>
                    <th className="py-1 pr-2">Source</th>
                    <th className="py-1 pr-2 text-right">Updated</th>
                    <th className="py-1 pr-2 text-right">OK</th>
                  </tr>
                </thead>
                <tbody className="text-signal-silver">
                  {syncRecentRows.slice(0, 6).map((row, idx) => (
                    <tr key={`${row.ranAt || "na"}-${idx}`} className="border-t border-white/5">
                      <td className="py-1 pr-2">{row.ranAt ? new Date(row.ranAt).toLocaleString() : "—"}</td>
                      <td className="py-1 pr-2">{row.source || "—"}</td>
                      <td className="py-1 pr-2 text-right">{row.updated ?? 0}</td>
                      <td className={`py-1 pr-2 text-right ${row.ok ? "text-signal-sage" : "text-signal-rose"}`}>{row.ok ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mlStatus.historySync.persist && (
            <div className="mt-3 rounded-lg border border-white/5 bg-signal-panel/20 p-2">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-signal-inkMuted">Predict persist telemetry</div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-signal-silver sm:grid-cols-3">
                <div>runs: {mlStatus.historySync.persist.runs ?? 0}</div>
                <div>inserted: {mlStatus.historySync.persist.inserted ?? 0}</div>
                <div>updated: {mlStatus.historySync.persist.updated ?? 0}</div>
                <div>skip final: {mlStatus.historySync.persist.skippedFinal ?? 0}</div>
                <div>skip stale: {mlStatus.historySync.persist.skippedStale ?? 0}</div>
                <div>skip prekickoff: {mlStatus.historySync.persist.skippedPrekickoff ?? 0}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {metrics?.calibration1x2 && metrics.calibration1x2.length > 0 && (
        <div className="mt-5 rounded-xl border border-white/5 bg-signal-void/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">Calibration buckets</span>
            <span className="font-mono text-[9px] text-signal-inkMuted">confidence vs accuracy</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] font-mono text-[10px] tabular-nums">
              <thead className="text-left text-signal-inkMuted">
                <tr>
                  <th className="py-1 pr-2">Bucket</th>
                  <th className="py-1 pr-2 text-right">n</th>
                  <th className="py-1 pr-2 text-right">Avg conf</th>
                  <th className="py-1 pr-2 text-right">Accuracy</th>
                  <th className="py-1 pr-2 text-right">Gap</th>
                </tr>
              </thead>
              <tbody className="text-signal-silver">
                {metrics.calibration1x2.map((b) => {
                  const gap = b.avgConfidence - b.accuracy1x2;
                  const tone = Math.abs(gap) <= 3 ? "text-signal-sage" : Math.abs(gap) <= 6 ? "text-signal-amber" : "text-signal-rose";
                  return (
                    <tr key={b.bucket} className="border-t border-white/5">
                      <td className="py-1 pr-2">{b.bucket}</td>
                      <td className="py-1 pr-2 text-right">{b.n}</td>
                      <td className="py-1 pr-2 text-right">{b.avgConfidence.toFixed(1)}%</td>
                      <td className="py-1 pr-2 text-right">{b.accuracy1x2.toFixed(1)}%</td>
                      <td className={`py-1 pr-2 text-right ${tone}`}>{gap > 0 ? "+" : ""}{gap.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {metrics?.byModelVersion && metrics.byModelVersion.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <BreakdownTable title="By model version" rows={metrics.byModelVersion.slice(0, 6)} />
          {metrics.byMethod && <BreakdownTable title="By method" rows={metrics.byMethod.slice(0, 6)} />}
        </div>
      )}

      {mlStatus?.helpers?.scripts && (
        <details className="mt-5 rounded-xl border border-dashed border-white/10 bg-signal-void/20 p-3 font-mono text-[10px] text-signal-inkMuted">
          <summary className="cursor-pointer text-signal-petrol/80">Refit scripts</summary>
          <ul className="mt-2 space-y-1 list-inside">
            {mlStatus.helpers.scripts.map((s) => (
              <li key={s} className="break-all">
                <code className="text-signal-silver">{s}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function MetricTile({
  label,
  value,
  subtitle,
  toneClass
}: {
  label: string;
  value: string;
  subtitle?: string;
  toneClass: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-signal-void/40 p-3 text-center shadow-inner">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-signal-inkMuted">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {subtitle && <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-wider text-signal-inkMuted/70">{subtitle}</div>}
    </div>
  );
}

function BreakdownTable({
  title,
  rows
}: {
  title: string;
  rows: Array<{ key: string; n: number; brier: number; logLoss: number }>;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-signal-void/30 p-3">
      <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-signal-petrol/80">{title}</div>
      <table className="w-full font-mono text-[10px] tabular-nums">
        <thead className="text-left text-signal-inkMuted">
          <tr>
            <th className="py-1 pr-2">Key</th>
            <th className="py-1 pr-2 text-right">n</th>
            <th className="py-1 pr-2 text-right">Brier</th>
            <th className="py-1 pr-2 text-right">LogLoss</th>
          </tr>
        </thead>
        <tbody className="text-signal-silver">
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-white/5">
              <td className="py-1 pr-2 max-w-[140px] truncate" title={r.key}>{r.key}</td>
              <td className="py-1 pr-2 text-right">{r.n}</td>
              <td className="py-1 pr-2 text-right">{r.brier.toFixed(4)}</td>
              <td className="py-1 pr-2 text-right">{r.logLoss.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
