import { useEffect, useMemo, useRef, useState } from "react";
import { ELITE_LEAGUE_META } from "../../constants/appConstants";
import type { useAuth } from "../../hooks/useAuth";
import type { DayResponse, League, LeagueCatalogEntry } from "../../types";
import { isoToday, normalizeSelectedDates, useLocalStorageState } from "../../utils/appUtils";
import { sortLeagues } from "../../utils/leagueOrdering";

type AuthUser = ReturnType<typeof useAuth>["user"];

/**
 * Selecția de ligi + lista sortată pentru dashboard-ul consumer.
 *
 * Lista afișată = TOT catalogul (provider, o singură încărcare / 24h, vezi useLeagueCatalog)
 * ∪ ligile elite configurate, cu numărul de meciuri din zilele selectate suprapus. Lipsa
 * meciurilor într-o zi nu scoate liga din listă. Până se încarcă catalogul (sau dacă
 * încărcarea eșuează) lista cade pe ligile elite — comportamentul dinainte.
 *
 * Ordine: favoritele utilizatorului, apoi diviziile domestice global (toate tier 1, apoi toate
 * tier 2, …), apoi competițiile internaționale de club, apoi restul alfabetic (utils/leagueOrdering).
 * Persistența selecției este neschimbată: localStorage per user + favorite_leagues în profil.
 */
export function useLeagueSelection({
  user,
  accessToken,
  date,
  selectedDates,
  updateFavoriteLeagues,
  setStatus,
  catalog = null
}: {
  user: AuthUser;
  accessToken: string | undefined;
  date: string;
  selectedDates: string[];
  updateFavoriteLeagues: (leagueIds: number[]) => Promise<unknown>;
  setStatus: (message: string) => void;
  /** Full catalog once loaded; null keeps the elite-only fallback and disables pruning. */
  catalog?: LeagueCatalogEntry[] | null;
}) {
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);
  const [favoriteLeaguesByUser, setFavoriteLeaguesByUser] = useLocalStorageState<Record<string, number[]>>("footy.user.favoriteLeagueByUser", {});
  const [searchLeague, setSearchLeague] = useState("");
  const [day, setDay] = useState<DayResponse | null>(null);
  /** Avoid re-hydrating selection from profile every time favoriteLeaguesByUser echoes from saves (caused “stuck” league list). */
  const lastSelectionHydrateUserId = useRef<string | null>(null);

  function setSelectedLeagueIdsLimited(nextIds: number[]) {
    const normalized = Array.from(new Set(nextIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))));
    setSelectedLeagueIds(normalized);
  }

  /** Catalog ∪ elite meta, one entry per id, day match counts overlaid. Unfiltered and unsorted. */
  const catalogLeagues = useMemo<League[]>(() => {
    const liveById = new Map((day?.leagues ?? []).map((league) => [Number(league.id), league] as const));
    const byId = new Map<number, League>();
    for (const meta of ELITE_LEAGUE_META) {
      byId.set(Number(meta.id), { id: Number(meta.id), name: meta.name, country: meta.country, matches: 0 });
    }
    for (const entry of catalog ?? []) {
      const id = Number(entry.id);
      if (byId.has(id)) continue;
      byId.set(id, { id, name: entry.name, country: entry.country, matches: 0, logo: entry.logo });
    }
    return Array.from(byId.values()).map((league) => {
      const live = liveById.get(league.id);
      if (!live) return league;
      return {
        ...league,
        matches: Number(live.matches || 0),
        logo: league.logo || live.logo,
        name: live.name || league.name,
        country: live.country || league.country
      };
    });
  }, [day, catalog]);

  // Global division ordering (favorites → tier 1 → tier 2 → … → unclassified), see
  // utils/leagueOrdering. Search only narrows visibility; it never changes the order.
  const leaguesSorted = useMemo(() => {
    const q = searchLeague.trim().toLowerCase();
    const leagues = q
      ? catalogLeagues.filter((league) => league.name.toLowerCase().includes(q) || league.country.toLowerCase().includes(q))
      : catalogLeagues;
    return sortLeagues(leagues, user?.favoriteLeagues || []);
  }, [catalogLeagues, searchLeague, user?.favoriteLeagues]);

  /** Every id in the catalog, ignoring the search box — what "Toate ligile" selects. */
  const allCatalogLeagueIds = useMemo(() => catalogLeagues.map((league) => league.id), [catalogLeagues]);

  useEffect(() => {
    if (!user) {
      lastSelectionHydrateUserId.current = null;
      return;
    }
    if (lastSelectionHydrateUserId.current === user.id) return;
    lastSelectionHydrateUserId.current = user.id;
    const localFavorites = favoriteLeaguesByUser[user.id];
    if (Array.isArray(localFavorites) && localFavorites.length > 0) {
      setSelectedLeagueIds(localFavorites);
    } else if (user.favoriteLeagues.length) {
      setSelectedLeagueIds(user.favoriteLeagues);
    } else {
      setSelectedLeagueIds([]);
    }
  }, [user, favoriteLeaguesByUser]);

  // Deterministic prune: only against a SUCCESSFULLY loaded catalog, and only ids that
  // catalog ∪ elite do not know. A league without matches today is still known → kept.
  useEffect(() => {
    if (!catalog) return;
    const known = new Set(allCatalogLeagueIds);
    setSelectedLeagueIds((prev) => {
      const next = prev.filter((id) => known.has(Number(id)));
      return next.length === prev.length ? prev : next;
    });
  }, [catalog, allCatalogLeagueIds]);

  useEffect(() => {
    if (!user?.id || !accessToken) return;
    setFavoriteLeaguesByUser((prev) => ({ ...prev, [user.id]: selectedLeagueIds }));
    const timer = setTimeout(() => {
      void updateFavoriteLeagues(selectedLeagueIds).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Nu am putut salva preferintele de ligi.";
        setStatus(message);
      });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verbatim din UserDashboard
  }, [selectedLeagueIds, user?.id, accessToken, updateFavoriteLeagues, setFavoriteLeaguesByUser]);

  async function fetchDays(dates: string[]) {
    const effectiveDates = normalizeSelectedDates(dates.length ? dates : [date]);
    try {
      const responses = await Promise.all(
        effectiveDates.map(async (currentDate) => {
          const response = await fetch(`/api/fixtures?date=${currentDate}`);
          const json = await response.json();
          if (!json.ok) throw new Error(json.error || "Eroare API");
          return json as DayResponse;
        })
      );
      const leaguesMap = new Map<number, League>();
      for (const resp of responses) {
        for (const league of resp.leagues || []) {
          const existing = leaguesMap.get(league.id);
          if (existing) existing.matches += league.matches;
          else leaguesMap.set(league.id, { ...league });
        }
      }
      setDay({
        ok: true,
        date: effectiveDates.join(", "),
        totalFixtures: responses.reduce((sum, resp) => sum + (resp.totalFixtures || 0), 0),
        leagues: Array.from(leaguesMap.values()),
        usage: responses[responses.length - 1]?.usage || { date: isoToday(), count: 0, limit: 100 }
      });
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Nu am putut incarca ligile.");
    }
  }

  useEffect(() => {
    void fetchDays(normalizeSelectedDates(selectedDates.length ? selectedDates : [date]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verbatim din UserDashboard
  }, [date, selectedDates.join("|")]);

  return {
    selectedLeagueIds,
    setSelectedLeagueIdsLimited,
    searchLeague,
    setSearchLeague,
    leaguesSorted,
    allCatalogLeagueIds,
    fetchDays
  };
}
