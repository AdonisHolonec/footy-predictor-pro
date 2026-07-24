import { FilterMode, SortBy } from "../../constants/appConstants";
import { PredictionRow } from "../../types";
import type { PredictionListVariant } from "../../types/index";
import PredictionCard from "./PredictionCard";

type GroupedMatches = {
  dateKey: string;
  matches: PredictionRow[];
};

type PredictionListProps = {
  variant: PredictionListVariant;
  user: { role?: string; tier?: string } | null;
  preds: PredictionRow[];
  groupedDisplayedMatches: GroupedMatches[];
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
  sortBy: SortBy;
  setSortBy: (sort: SortBy) => void;
  pendingAmongDisplayedPreds: number;
  logoColors: Record<string, string>;
  hashColor: (seed: string) => string;
  onSelectMatch: (match: PredictionRow) => void;
  onOpenAuth: () => void;
  showDossierLabel?: boolean;
};

export default function PredictionList({
  variant,
  user,
  preds,
  groupedDisplayedMatches,
  filterMode,
  setFilterMode,
  sortBy,
  setSortBy,
  pendingAmongDisplayedPreds,
  logoColors,
  hashColor,
  onSelectMatch,
  onOpenAuth,
  showDossierLabel = false
}: PredictionListProps) {
  const gridClass =
    variant === "observatory"
      ? "grid grid-cols-1 items-stretch gap-3 sm:gap-3.5 md:grid-cols-2"
      : "grid grid-cols-1 items-stretch gap-3 sm:gap-3.5 md:grid-cols-2 2xl:grid-cols-3";

  return (
    <>
      {showDossierLabel && (
        <p className="lab-section-eyebrow mb-2.5">
          Prediction dossier
        </p>
      )}
      {preds.length > 0 && (
        <div className="lab-card mb-4 flex flex-col gap-2.5 p-2.5 sm:gap-3 sm:p-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="custom-scrollbar flex snap-x snap-mandatory gap-1.5 overflow-x-auto border-b border-white/[0.06] pb-2 xl:overflow-visible xl:border-b-0 xl:border-r xl:border-white/[0.06] xl:pb-0 xl:pr-3">
            <button
              type="button"
              onClick={() => setFilterMode("ALL")}
              className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                filterMode === "ALL" ? "bg-signal-petrol text-signal-void shadow-sm" : "bg-signal-void/45 text-signal-inkMuted hover:bg-signal-panelHi/60"
              }`}
            >
              Toate ({preds.length}
              {pendingAmongDisplayedPreds > 0 ? ` · ${pendingAmongDisplayedPreds} nevalidate` : ""})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("VALUE")}
              className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                filterMode === "VALUE" ? "border border-signal-amber/45 bg-signal-amber/15 text-signal-amber shadow-sm" : "bg-signal-void/45 text-signal-inkMuted hover:bg-signal-panelHi/60"
              }`}
            >
              Value bets
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("SAFE")}
              className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                filterMode === "SAFE" ? "border border-signal-sage/35 bg-signal-sage/15 text-signal-sage shadow-sm" : "bg-signal-void/45 text-signal-inkMuted hover:bg-signal-panelHi/60"
              }`}
            >
              +70% siguranță
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("LOW")}
              className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                filterMode === "LOW" ? "border border-signal-rose/30 bg-signal-rose/10 text-signal-rose shadow-sm" : "bg-signal-void/45 text-signal-inkMuted hover:bg-signal-panelHi/60"
              }`}
            >
              &lt;55% guarded
            </button>
          </div>
          <div className="custom-scrollbar flex snap-x snap-mandatory items-center gap-2 overflow-x-auto xl:overflow-visible">
            <span className="shrink-0 px-1 text-[9px] font-semibold uppercase tracking-wide text-signal-inkMuted">Sortare</span>
            <button
              type="button"
              onClick={() => setSortBy("TIME")}
              className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                sortBy === "TIME" ? "bg-signal-petrol/15 text-signal-petrol" : "bg-signal-void/40 text-signal-inkMuted hover:bg-signal-panel/50"
              }`}
            >
              Ora
            </button>
            <button
              type="button"
              onClick={() => setSortBy("CONFIDENCE")}
              className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                sortBy === "CONFIDENCE" ? "bg-signal-petrol/15 text-signal-petrol" : "bg-signal-void/40 text-signal-inkMuted hover:bg-signal-panel/50"
              }`}
            >
              Încredere
            </button>
            <button
              type="button"
              onClick={() => setSortBy("VALUE")}
              className={`snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-all touch-manipulation sm:py-1.5 ${
                sortBy === "VALUE" ? "bg-signal-petrol/15 text-signal-petrol" : "bg-signal-void/40 text-signal-inkMuted hover:bg-signal-panel/50"
              }`}
            >
              EV
            </button>
          </div>
        </div>
      )}
      {!user ? (
        <div className="grid h-[400px] place-items-center rounded-[2rem] border-2 border-dashed border-signal-line/30 bg-signal-panel/20 px-6 text-center">
          <div>
            <p className="font-medium text-signal-petrol">Autentifică-te pentru predicții personalizate.</p>
            <button
              type="button"
              onClick={onOpenAuth}
              className="mt-4 rounded-xl bg-signal-petrol px-4 py-2 text-sm font-semibold text-white hover:bg-signal-petrolMuted"
            >
              Deschide autentificarea
            </button>
          </div>
        </div>
      ) : !preds.length ? (
        <div className="grid h-[400px] place-items-center rounded-[2rem] border-2 border-dashed border-signal-line/25 bg-signal-void/30 text-center text-signal-inkMuted">
          <p className="font-medium italic">Selectează ligile, apoi apasă Predict.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedDisplayedMatches.map((group) => (
            <section key={group.dateKey} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-signal-petrolMuted">
                  {group.dateKey === "Fără dată"
                    ? group.dateKey
                    : new Date(group.dateKey).toLocaleDateString([], {
                        weekday: "short",
                        day: "2-digit",
                        month: "2-digit"
                      })}
                </div>
                <div className="h-px flex-1 bg-gradient-to-r from-signal-sage/35 to-transparent" />
                <div className="font-mono text-[10px] tabular-nums text-signal-inkMuted">{group.matches.length} meciuri</div>
              </div>
              <div className={gridClass}>
                {group.matches.map((m, idx) => (
                  <PredictionCard
                    key={m.id}
                    row={m}
                    logoColors={logoColors}
                    hashColor={hashColor}
                    animationDelayMs={idx * 45}
                    canShowSpecialBet={user?.role === "admin" || user?.tier === "ultra"}
                    accessTier={user?.tier}
                    onClick={() => onSelectMatch(m)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
