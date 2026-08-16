import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import type { FilterMode } from "../../constants/appConstants";
import { BRAND_IMAGES } from "../../constants/brandAssets";
import type { PredictionRow } from "../../types";
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
    ? "border-fp-accent/55 bg-fp-accent/15 text-[var(--fp-accent)] shadow-fp-sm"
    : "border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)] hover:border-fp-accent/40 hover:text-fp-accent/90";
}

export function AdminIconRail() {
  const item =
    "flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)] shadow-fp-sm transition hover:border-fp-accent/40 hover:text-[var(--fp-accent)]";
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
          className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--fp-radius)] border border-fp-accent/40 shadow-fp-sm"
          aria-hidden
        >
          <img
            src={BRAND_IMAGES.logoPrimary}
            alt="Footy Predictor"
            className="h-14 w-14 rounded-xl object-contain p-0.5 brightness-110 saturate-150 animate-[pulse_4s_ease-in-out_infinite] motion-reduce:animate-none"
          />
        </div>
        <div>
          <div className="font-display text-lg font-bold uppercase tracking-[0.14em] text-[var(--fp-text)] md:text-xl">
            Footy <span className="text-[var(--fp-accent)]">Predictor</span>
          </div>
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--fp-text-muted)]">{editorialDate}</p>
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
  const roleLabel = user ? "ADMIN" : "GUEST";
  return (
    <header className="mb-6 rounded-card border border-white/[0.07] bg-[var(--fp-bg-card)] shadow-card p-6">
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
            <div className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-3 py-2 text-xs font-semibold text-[var(--fp-text-muted)] shadow-fp-sm">
              Verific sesiunea…
            </div>
          ) : user ? (
            <>
              <div className="flex items-center gap-2 text-right">
                <div>
                  <div className="max-w-[220px] truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--fp-text)]">
                    {user.email}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--fp-accent-hover)]">{roleLabel}</div>
                </div>
                <div className="h-10 w-10 shrink-0 rounded-full border border-fp-accent/35 bg-gradient-to-br from-fp-accent/25 to-[var(--fp-bg-card)] shadow-fp-sm" />
              </div>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="rounded-lg border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-accent)] hover:bg-[var(--fp-bg-muted)]"
              >
                Logout
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="rounded-xl border border-fp-accent/25 bg-fp-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--fp-accent)] hover:bg-fp-accent/15"
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
    <div className="mb-4 flex flex-col gap-2.5 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-2.5 shadow-fp-sm sm:mb-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:p-3">
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
          className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg)] px-3 py-2 text-sm text-[var(--fp-text)] outline-none focus:ring-2 focus:ring-fp-success/35"
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
          className="touch-manipulation rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 text-xs font-semibold text-[var(--fp-text)] hover:bg-[var(--fp-border)] hover:text-[var(--fp-accent)]"
        >
          + Zi
        </button>
        <button
          type="button"
          onClick={onWarm}
          disabled={!user}
          className="touch-manipulation rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2 text-xs font-semibold text-[var(--fp-text)] hover:bg-[var(--fp-border)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Warm
        </button>
        <button
          type="button"
          onClick={onPredict}
          disabled={!user}
          className="touch-manipulation rounded-xl bg-[var(--fp-accent)] px-4 py-2 text-xs font-semibold text-white shadow-fp-sm hover:bg-[var(--fp-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
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
              d === date
                ? "border-fp-accent/40 bg-fp-accent/15 text-[var(--fp-accent)]"
                : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"
            }`}
            title="Elimină ziua"
          >
            {d}
            {dates.length > 1 ? " ✕" : ""}
          </button>
        ))}
      </div>
      <div className="flex w-full max-w-[200px] flex-col sm:ml-auto">
        <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
          API{" "}
          <span className={usagePct > 80 ? "text-[var(--fp-danger)]" : "text-[var(--fp-success)]"}>
            {usageCount} / {usageLimit}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]">
          <div
            style={{ width: `${usagePct}%` }}
            className={`h-full rounded-full ${usagePct > 80 ? "bg-[var(--fp-danger)]" : "bg-gradient-to-r from-[var(--fp-accent)] to-[var(--fp-success)]"}`}
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
    <div className="mt-4 space-y-4 rounded-2xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-fp-sm">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--fp-text-muted)]">Filtre</p>
      <div>
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--fp-accent-hover)]">Kickoff</p>
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
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--fp-accent-hover)]">Confidence</p>
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
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--fp-accent-hover)]">xG differential</p>
          <span className="font-mono text-[10px] tabular-nums text-[var(--fp-accent)]">≥ {minXgSpread.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={2.5}
          step={0.05}
          value={minXgSpread}
          onChange={(e) => setMinXgSpread(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[var(--fp-accent)]"
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
    <aside className="space-y-4 rounded-2xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 shadow-fp-sm">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--fp-text-muted)]">Insight observatory</p>
      {sample ? (
        <>
          <EdgeCompass dataQuality={dq} valueDetected={!!sample.valueBet?.detected} className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg)] p-3" />
          <SignalLens confidence={conf} edge={edge} className="rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg)] p-3" />
          <div className="space-y-2 rounded-xl border border-fp-accent/15 bg-fp-accent/5 p-3 font-mono text-[10px] text-[var(--fp-text-muted)]">
            <div className="flex justify-between gap-2">
              <span>Integrity</span>
              <span className="text-[var(--fp-accent)]">{sample.insufficientData ? "thin" : "nominal"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Sample</span>
              <span className="text-[var(--fp-text)]">{sample.modelMeta?.dataQuality != null ? `${(sample.modelMeta.dataQuality * 100).toFixed(0)}%` : "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>State</span>
              <span className="truncate text-[var(--fp-success)]">{sample.status || "live"}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg)] p-6 text-center text-xs text-[var(--fp-text-muted)]">
          Rulează <span className="text-[var(--fp-accent)]">Predict</span> pentru semnale live în acest panou.
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
      className={`rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3.5 shadow-fp-sm sm:p-5 md:p-6 ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--fp-accent-hover)]">Performance observatory</h2>
        <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--fp-text-muted)]">settled stream</span>
      </div>
      {children}
    </section>
  );
}
