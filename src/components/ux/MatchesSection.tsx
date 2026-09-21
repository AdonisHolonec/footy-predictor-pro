import { useMemo } from "react";
import type { CardMarketValidations, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import { predictSurfaceProps, type PredictAction } from "./predictState";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import SegmentedControl from "../../design-system/SegmentedControl";
import Button from "../../design-system/Button";
import EmptyState from "../../design-system/EmptyState";
import Skeleton from "../../design-system/Skeleton";
import MatchList from "./MatchList";
import MatchListRow, { type MarketFocus } from "./MatchListRow";
import type { MatchesSubFilter } from "./appNav";
import {
  MARKET_FAMILY,
  MARKET_FILTERS,
  isMarketKey,
  marketOdd,
  marketProbability,
  type MarketFilter
} from "../../utils/marketProbabilityFilter";

type AccessTier = UpgradeTier | "free" | string;

/** Chip label and full market name, per option. "all" reuses the segment's own "Toate". */
const MARKET_COPY: Record<MarketFilter, { label: string; name: string }> = {
  all: { label: "dash.filterAll", name: "dash.filterAll" },
  gg: { label: "dash.marketGg", name: "dash.marketGgName" },
  o15ft: { label: "dash.marketO15Ft", name: "dash.marketO15FtName" },
  o25ft: { label: "dash.marketO25Ft", name: "dash.marketO25FtName" },
  o15fh: { label: "dash.marketO15Fh", name: "dash.marketO15FhName" }
};

type Props = {
  matches: PredictionRow[];
  accessTier: AccessTier;
  marketValidationsByFixtureId: Map<number, CardMarketValidations>;
  isWatched: (fixtureId: number) => boolean;
  onToggleWatch: (fixtureId: number) => void;
  onOpenMatch: (row: PredictionRow) => void;
  onUpgradeRequired: (feature: string, requiredTier: UpgradeTier) => void;
  /** The shared Predict contract. Never call onPredict directly — use action.onActivate. */
  predictAction?: PredictAction;
  /** Segment state — session-local, owned by the page, never a route. */
  matchesFilter?: MatchesSubFilter;
  onSetFilter?: (filter: MatchesSubFilter) => void;
  /**
   * Market ranking — session-local, owned by the page, orthogonal to the
   * segment above. The control only exists when a setter is supplied, so a
   * surface that does not own this state never grows a dead control.
   */
  marketFilter?: MarketFilter;
  onSetMarketFilter?: (market: MarketFilter) => void;
  /** Rows before the market filter ran: > 0 with an empty list means "no such market here". */
  marketBaseCount?: number;
  /** Free-text filter — session-local, owned by the page. */
  search?: string;
  onSearchChange?: (q: string) => void;
  /** Scope controls that used to live in the global header. */
  onOpenLeagues?: () => void;
  onRefresh?: () => void;
  refreshBusy?: boolean;
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
 * value; search, leagues, the date range and Refresh act on this list, so
 * they live here.
 */
export default function MatchesSection({
  matches,
  marketValidationsByFixtureId,
  isWatched,
  onToggleWatch,
  onOpenMatch,
  predictAction,
  matchesFilter = "all",
  onSetFilter,
  marketFilter = "all",
  onSetMarketFilter,
  marketBaseCount = 0,
  search = "",
  onSearchChange,
  onOpenLeagues,
  onRefresh,
  refreshBusy = false,
  loading = false
}: Props) {
  const { t } = useLocale();
  const mode = matchesFilter === "live" ? "live" : "all";

  const marketLabel = t(MARKET_COPY[marketFilter].label);
  const marketName = t(MARKET_COPY[marketFilter].name);
  /*
    What each row shows while a market is selected. Built once per list/market
    change rather than per row per render, and keyed by fixture id so the row
    lookup below is a Map hit. Null when no market is selected: the rows then
    receive no `marketFocus` at all and render exactly as they always have.
  */
  const focusByFixtureId = useMemo(() => {
    if (!isMarketKey(marketFilter)) return null;
    const focus = new Map<number, MarketFocus>();
    for (const row of matches) {
      const probability = marketProbability(row, marketFilter);
      if (probability === null) continue;
      focus.set(Number(row.id), {
        label: marketLabel,
        name: marketName,
        familyKey: MARKET_FAMILY[marketFilter],
        probability,
        odd: marketOdd(row, marketFilter)
      });
    }
    return focus;
  }, [matches, marketFilter, marketLabel, marketName]);
  /*
    The list is empty BECAUSE of the market only when there were rows to rank.
    Otherwise the segment's own empty state is the true one (no live games, no
    favourites, nothing predicted yet) and must keep its message and its action.
  */
  const emptiedByMarket = isMarketKey(marketFilter) && marketBaseCount > 0 && !matches.length;

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
      </div>

      {onSetMarketFilter && (
        /*
          Its own container, not a fifth-to-ninth button inside matches-controls:
          it answers a different question (rank by which market) from the segment
          (which rows), and the two combine. It scrolls rather than wraps — a
          wrapped second line would push the list down by a row as the labels
          grow — and `max-w-full` keeps the scroller inside the page, so the
          viewport itself never scrolls sideways. `scrollbar-none` is the repo's
          cross-engine utility; the Firefox-only arbitrary value is not.
        */
        <div className="max-w-full overflow-x-auto scrollbar-none" data-testid="matches-market-filter">
          <SegmentedControl
            mode="toggle"
            aria-label={t("dash.marketFilterLabel")}
            className="w-max"
            options={MARKET_FILTERS.map((id) => ({
              value: id,
              label: t(MARKET_COPY[id].label),
              title:
                id === "all"
                  ? t("dash.filterTitle", { label: t(MARKET_COPY[id].label) })
                  : t("dash.marketFilterTitle", { label: t(MARKET_COPY[id].name) })
            }))}
            value={marketFilter}
            onChange={(id) => onSetMarketFilter(id)}
          />
        </div>
      )}

      {(onSearchChange || onOpenLeagues || onRefresh) && (
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
      ) : emptiedByMarket ? (
        /*
          There ARE matches — none of them carries this market. Same EmptyState
          as every other narrowed view, and the same kind of exit: step out of
          the filter that emptied the list. Only the market is cleared, so the
          segment the user chose (Live, Favorites…) is still theirs afterwards.
          Never Predict: regenerating would produce the same rows without it.
        */
        <EmptyState
          title={t("dash.emptyMarketTitle", { label: marketName })}
          description={t("dash.emptyMarketDesc")}
          actionLabel={t("dash.showAll")}
          onAction={() => onSetMarketFilter?.("all")}
        />
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
                  : /* Never instruct an action the system will refuse. */
                    predictAction?.reason ?? t("dash.emptyPredsDesc")
          }
          /* Every narrowed segment — live included — offers the way back out;
             only the unfiltered slate offers Predict. */
          actionLabel={matchesFilter === "all" ? t("shell.predict") : t("dash.showAll")}
          onAction={matchesFilter === "all" ? predictAction?.onActivate : () => onSetFilter?.("all")}
          /*
            Only the Predict branch carries Predict's state; "show all" is
            always available and gets no surface at all. The state arrives whole
            rather than as a native `disabled` beside it — see EmptyState.
          */
          actionProps={
            matchesFilter === "all" && predictAction ? predictSurfaceProps(predictAction) : undefined
          }
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
              marketFocus={focusByFixtureId?.get(Number(row.id)) ?? null}
            />
          ))}
        </MatchList>
      )}
    </section>
  );
}
