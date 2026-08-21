import type { ReactNode } from "react";
import type { CardMarketValidations, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import SegmentedControl from "../../design-system/SegmentedControl";
import FilterChip from "../../design-system/FilterChip";
import Button from "../../design-system/Button";
import EmptyState from "../../design-system/EmptyState";
import Skeleton from "../../design-system/Skeleton";
import MatchList from "./MatchList";
import MatchListRow from "./MatchListRow";
import type { MatchesSubFilter } from "./appNav";

type AccessTier = UpgradeTier | "free" | string;

type Props = {
  matches: PredictionRow[];
  accessTier: AccessTier;
  marketValidationsByFixtureId: Map<number, CardMarketValidations>;
  isWatched: (fixtureId: number) => boolean;
  onToggleWatch: (fixtureId: number) => void;
  onOpenMatch: (row: PredictionRow) => void;
  onUpgradeRequired: (feature: string, requiredTier: UpgradeTier) => void;
  onPredict: () => void;
  /** Segment state — session-local, owned by the page, never a route. */
  matchesFilter?: MatchesSubFilter;
  onSetFilter?: (filter: MatchesSubFilter) => void;
  /** Free-text filter — session-local, owned by the page. */
  search?: string;
  onSearchChange?: (q: string) => void;
  /** Persistent "saved filters" (Settings can reset them). */
  valueOnly?: boolean;
  onToggleValueOnly?: (checked: boolean) => void;
  highConfActive?: boolean;
  onToggleHighConf?: () => void;
  /** Scope controls that used to live in the global header. */
  onOpenLeagues?: () => void;
  onRefresh?: () => void;
  refreshBusy?: boolean;
  extraDates?: ReactNode;
  /** True while a fetch is in flight and no cached rows exist yet — shows skeleton rows instead of the empty state. */
  loading?: boolean;
};

/**
 * Matches — the main scan surface (UX-B).
 *
 * Primary control: All | Live | Favorites, a real segment of ONE list. Live is
 * a filter here, not a destination: choosing it narrows the rows and leaving it
 * restores exactly the segment the user had before — nothing resets on the way
 * in or out. "Top picks" (confidence-ranked) is the fourth, optional segment
 * value; Value / High confidence are the persistent saved filters; search,
 * leagues, the date range and Refresh act on this list, so they live here.
 */
export default function MatchesSection({
  matches,
  marketValidationsByFixtureId,
  isWatched,
  onToggleWatch,
  onOpenMatch,
  onPredict,
  matchesFilter = "all",
  onSetFilter,
  search = "",
  onSearchChange,
  valueOnly = false,
  onToggleValueOnly,
  highConfActive = false,
  onToggleHighConf,
  onOpenLeagues,
  onRefresh,
  refreshBusy = false,
  extraDates,
  loading = false
}: Props) {
  const { t } = useLocale();
  const mode = matchesFilter === "live" ? "live" : "all";

  return (
    <section className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--fp-text)] sm:text-[length:var(--fp-hero)]">
          {t("nav.matches")}
        </h1>
        <p className="mt-0.5 text-xs text-[var(--fp-text-muted)] sm:text-sm">
          {mode === "live" ? t("dash.liveSub") : t("dash.matchesSub")}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2" data-testid="matches-controls">
        <SegmentedControl
          mode="toggle"
          options={(
            [
              ["all", "dash.filterAll"],
              ["live", "dash.filterLive"],
              ["favorites", "dash.filterFavorites"],
              ["picks", "dash.filterPicks"]
            ] as const
          ).map(([id, key]) => ({
            value: id,
            label: t(key),
            title: t("dash.filterTitle", { label: t(key) })
          }))}
          value={matchesFilter}
          onChange={(id) => onSetFilter?.(id)}
        />
        {onToggleValueOnly && (
          <FilterChip selected={valueOnly} onClick={() => onToggleValueOnly(!valueOnly)} title={t("dash.filterTitle", { label: t("dash.filterValue") })}>
            {t("dash.filterValue")}
          </FilterChip>
        )}
        {onToggleHighConf && (
          <FilterChip selected={highConfActive} onClick={onToggleHighConf} title={t("dash.filterTitle", { label: t("dash.filterHighConf") })}>
            {t("dash.filterHighConf")}
          </FilterChip>
        )}
      </div>

      {(onSearchChange || onOpenLeagues || extraDates || onRefresh) && (
        <div className="flex flex-wrap items-center gap-2" data-testid="matches-scope">
          {onSearchChange && (
            <>
              <label className="sr-only" htmlFor="matches-search">
                {t("shell.search")}
              </label>
              <input
                id="matches-search"
                type="search"
                title={t("shell.searchTeams")}
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t("shell.searchTeams")}
                className="h-9 min-w-[8rem] flex-[1_1_10rem] rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-2.5 text-sm font-medium text-[var(--fp-text)] placeholder:text-[var(--fp-text-faint)] sm:max-w-[16rem]"
              />
            </>
          )}
          {extraDates}
          {onOpenLeagues && (
            <Button size="sm" variant="secondary" onClick={onOpenLeagues} className="touch-target" aria-label={t("shell.filterLeagues")}>
              {t("shell.leagues")}
            </Button>
          )}
          {onRefresh && (
            <Button
              size="sm"
              variant="ghost"
              loading={refreshBusy}
              onClick={onRefresh}
              className="touch-target ml-auto"
              aria-label={t("shell.refreshPredictions")}
              aria-busy={refreshBusy}
            >
              {t("shell.refresh")}
            </Button>
          )}
        </div>
      )}

      {!matches.length && loading ? (
        <div className="overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)]" aria-hidden>
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="flex h-[72px] items-center gap-3 border-b border-[var(--fp-border)] px-3 last:border-b-0">
              <Skeleton className="h-3 w-9" />
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="hidden h-3 w-24 sm:block" />
            </div>
          ))}
        </div>
      ) : !matches.length ? (
        /*
          "picks" empties for a different reason than the rest: the slate is
          not missing, it just holds nothing the model will stand behind. So it
          reads like favorites — a filter you can step out of — rather than
          offering Predict, which would regenerate the same unbacked rows.
        */
        <EmptyState
          title={
            mode === "live"
              ? t("dash.emptyLiveTitle")
              : matchesFilter === "favorites"
                ? t("dash.emptyFavoritesTitle")
                : matchesFilter === "picks"
                  ? t("dash.emptyPicksTitle")
                  : t("dash.emptyPredsTitle")
          }
          description={
            mode === "live"
              ? t("dash.emptyLiveDesc")
              : matchesFilter === "favorites"
                ? t("dash.emptyFavoritesDesc")
                : matchesFilter === "picks"
                  ? t("dash.emptyPicksDesc")
                  : t("dash.emptyPredsDesc")
          }
          /* Every narrowed segment — live included — offers the way back out;
             only the unfiltered slate offers Predict. */
          actionLabel={matchesFilter === "all" ? t("shell.predict") : t("dash.showAll")}
          onAction={matchesFilter === "all" ? onPredict : () => onSetFilter?.("all")}
        />
      ) : (
        <MatchList label={mode === "live" ? t("dash.filterLive") : t("nav.matches")}>
          {matches.map((row) => (
            <MatchListRow
              key={row.id}
              row={row}
              marketValidations={marketValidationsByFixtureId.get(Number(row.id)) ?? row.cardMarketValidations ?? null}
              watched={isWatched(Number(row.id))}
              onToggleWatch={() => onToggleWatch(Number(row.id))}
              onOpen={() => onOpenMatch(row)}
            />
          ))}
        </MatchList>
      )}
    </section>
  );
}
