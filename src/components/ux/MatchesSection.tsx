import type { CardMarketValidations, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import type { UpgradeTier } from "../../design-system/UpgradePrompt";
import SegmentedControl from "../../design-system/SegmentedControl";
import EmptyState from "../../design-system/EmptyState";
import Skeleton from "../../design-system/Skeleton";
import MatchList from "./MatchList";
import MatchListRow from "./MatchListRow";

type AccessTier = UpgradeTier | "free" | string;
/** "picks" ranks the slate by confidence; see useDerivedPredictions. */
type MatchesSubFilter = "all" | "favorites" | "picks";

type Props = {
  mode: "all" | "live";
  matches: PredictionRow[];
  accessTier: AccessTier;
  marketValidationsByFixtureId: Map<number, CardMarketValidations>;
  isWatched: (fixtureId: number) => boolean;
  onToggleWatch: (fixtureId: number) => void;
  onOpenMatch: (row: PredictionRow) => void;
  onUpgradeRequired: (feature: string, requiredTier: UpgradeTier) => void;
  onPredict: () => void;
  matchesFilter?: MatchesSubFilter;
  onSetFilter?: (filter: MatchesSubFilter) => void;
  onGoLive?: () => void;
  valueOnly?: boolean;
  onToggleValueOnly?: (checked: boolean) => void;
  /** True while a fetch is in flight and no cached rows exist yet — shows skeleton cards instead of the empty state. */
  loading?: boolean;
};

export default function MatchesSection({
  mode,
  matches,
  marketValidationsByFixtureId,
  isWatched,
  onToggleWatch,
  onOpenMatch,
  onPredict,
  matchesFilter = "all",
  onSetFilter,
  onGoLive,
  valueOnly = false,
  onToggleValueOnly,
  loading = false
}: Props) {
  const { t } = useLocale();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--fp-text)] sm:text-[length:var(--fp-hero)]">
          {mode === "live" ? t("nav.live") : t("nav.matches")}
        </h1>
        <p className="mt-0.5 text-xs text-[var(--fp-text-muted)] sm:text-sm">
          {mode === "live" ? t("dash.liveSub") : t("dash.matchesSub")}
        </p>
      </header>

      {/* The all/favorites pair is the FILTER (toggle semantics). "Live" is a
          navigation shortcut and the Value checkbox is a separate control —
          both stay in the same track via `trailing`, in today's exact order. */}
      {mode === "all" && (
        <SegmentedControl
          mode="toggle"
          options={(
            [
              ["all", "dash.filterAll"],
              ["picks", "dash.filterPicks"],
              ["favorites", "dash.filterFavorites"]
            ] as const
          ).map(([id, key]) => ({
            value: id,
            label: t(key),
            title: t("dash.filterTitle", { label: t(key) })
          }))}
          value={matchesFilter ?? "all"}
          onChange={(id) => onSetFilter?.(id)}
          trailing={
            <>
              <button
                type="button"
                onClick={onGoLive}
                title={t("dash.filterTitle", { label: t("dash.filterLive") })}
                className="inline-flex h-9 items-center rounded-md px-2.5 text-xs font-bold text-[var(--fp-text-muted)] hover:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
              >
                {t("dash.filterLive")}
              </button>
              <label className="flex h-9 items-center gap-1.5 border-l border-[var(--fp-border)] px-2.5 text-xs font-bold text-[var(--fp-text-muted)]">
                {t("dash.filterValue")}
                <input
                  type="checkbox"
                  checked={valueOnly}
                  onChange={(e) => onToggleValueOnly?.(e.target.checked)}
                  className="h-4 w-4 accent-[var(--fp-accent)]"
                />
              </label>
            </>
          }
        />
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
          actionLabel={
            mode === "live"
              ? undefined
              : matchesFilter === "favorites" || matchesFilter === "picks"
                ? t("dash.showAll")
                : t("shell.predict")
          }
          onAction={
            mode === "live"
              ? undefined
              : matchesFilter === "favorites" || matchesFilter === "picks"
                ? () => onSetFilter?.("all")
                : onPredict
          }
        />
      ) : (
        <MatchList label={mode === "live" ? t("nav.live") : t("nav.matches")}>
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
