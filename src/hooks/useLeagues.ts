import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DayResponse } from "../types";
import { ELITE_LEAGUES, ELITE_LEAGUE_META } from "../constants/appConstants";
import { fetchDaysAggregation } from "../services/fixturesService";
import { normalizeSelectedDates, useLocalStorageState } from "../utils/appUtils";

export type UseLeaguesOptions = {
  date: string;
  selectedDates: string[];
  setSelectedDates: (value: string[] | ((prev: string[]) => string[])) => void;
  user: { id: string; favoriteLeagues?: number[] } | null;
  updateFavoriteLeagues: (leagueIds: number[]) => Promise<unknown>;
  requireAuth: (message?: string) => boolean;
  setStatus: (message: string | ((prev: string) => string)) => void;
};

export function useLeagues({
  date,
  selectedDates,
  setSelectedDates,
  user,
  updateFavoriteLeagues,
  requireAuth,
  setStatus
}: UseLeaguesOptions) {
  const [selectedLeagueIds, setSelectedLeagueIds] = useLocalStorageState<number[]>("footy.selectedLeagueIds", []);
  const [favoriteLeaguesByUser, setFavoriteLeaguesByUser] = useLocalStorageState<Record<string, number[]>>(
    "footy.favoriteLeagueByUser",
    {}
  );
  const [day, setDay] = useState<DayResponse | null>(null);
  const [searchLeague, setSearchLeague] = useState("");
  const lastSelectionHydrateUserId = useRef<string | null>(null);

  const leaguesSorted = useMemo(() => {
    const dayLeagues = day?.leagues ?? [];
    const byId = new Map(dayLeagues.map((league) => [Number(league.id), league] as const));
    const eliteComplete = ELITE_LEAGUE_META.map((meta) => {
      const existing = byId.get(Number(meta.id));
      return {
        id: meta.id,
        name: existing?.name || meta.name,
        country: existing?.country || meta.country,
        matches: Number(existing?.matches || 0),
        logo: existing?.logo
      };
    });
    const nonElite = dayLeagues.filter((league) => !ELITE_LEAGUES.includes(Number(league.id)));
    const leagues = [...eliteComplete, ...nonElite];
    const filtered = leagues.filter(
      (l) =>
        l.name.toLowerCase().includes(searchLeague.toLowerCase()) ||
        l.country.toLowerCase().includes(searchLeague.toLowerCase())
    );
    const elite = filtered.filter((l) => ELITE_LEAGUES.includes(Number(l.id)));
    const rest = filtered.filter((l) => !ELITE_LEAGUES.includes(Number(l.id))).sort((a, b) => b.matches - a.matches);
    return [...elite, ...rest];
  }, [day, searchLeague]);

  const fetchDays = useCallback(
    async (dates: string[]) => {
      const effectiveDates = normalizeSelectedDates(dates.length ? dates : [date]);
      setStatus("Încarc ligile...");
      try {
        const aggregated = await fetchDaysAggregation(effectiveDates, date);
        setDay(aggregated);
        setStatus(
          aggregated.totalFixtures
            ? `OK: ${aggregated.totalFixtures} meciuri pentru ${effectiveDates.length} zi(le).`
            : "Lipsă meciuri."
        );
      } catch (e) {
        setStatus(`Eroare: ${(e as Error).message}`);
      }
    },
    [date, setStatus]
  );

  function selectEliteLeagues() {
    if (!requireAuth()) return;
    const eliteIds = (day?.leagues ?? [])
      .filter((lg) => ELITE_LEAGUES.includes(Number(lg.id)))
      .map((lg) => Number(lg.id));
    setSelectedLeagueIds(eliteIds);
    setStatus(eliteIds.length ? `Selectate ${eliteIds.length} ligi elite.` : "Nu există ligi elite disponibile.");
  }

  function clearLeagueSelection() {
    if (!requireAuth()) return;
    setSelectedLeagueIds([]);
    setStatus("Selecția ligilor a fost resetată.");
  }

  useEffect(() => {
    const normalized = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
    if (normalized.length === 0) return;
    if (normalized.join("|") !== (selectedDates || []).join("|")) {
      setSelectedDates(normalized);
      return;
    }
    void fetchDays(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is deliberately keyed to date/selection; fetchDays/setSelectedDates identities would add render-driven refetches
  }, [date, selectedDates]);

  useEffect(() => {
    if (!user?.id) {
      lastSelectionHydrateUserId.current = null;
      return;
    }
    if (lastSelectionHydrateUserId.current === user.id) return;
    lastSelectionHydrateUserId.current = user.id;
    const localFavorites = favoriteLeaguesByUser[user.id];
    if (Array.isArray(localFavorites) && localFavorites.length > 0) {
      setSelectedLeagueIds(Array.from(new Set(localFavorites)));
      return;
    }
    const profileFavorites = Array.isArray(user.favoriteLeagues) ? Array.from(new Set(user.favoriteLeagues)) : [];
    setSelectedLeagueIds(profileFavorites);
  }, [user?.id, user?.favoriteLeagues, favoriteLeaguesByUser, setSelectedLeagueIds]);

  useEffect(() => {
    if (!user) return;
    setFavoriteLeaguesByUser((prev) => ({ ...prev, [user.id]: selectedLeagueIds }));
    const saveTimer = setTimeout(() => {
      void updateFavoriteLeagues(selectedLeagueIds).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Nu am putut salva preferintele utilizatorului.";
        setStatus(message);
      });
    }, 450);
    return () => clearTimeout(saveTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced save is keyed to user.id + selection; whole `user` object identity (token refresh) must not re-trigger writes
  }, [user?.id, selectedLeagueIds, updateFavoriteLeagues, setFavoriteLeaguesByUser]);

  const selectedSet = new Set(selectedLeagueIds);

  return {
    selectedLeagueIds,
    setSelectedLeagueIds,
    searchLeague,
    setSearchLeague,
    leaguesSorted,
    selectEliteLeagues,
    clearLeagueSelection,
    day,
    setDay,
    fetchDays,
    selectedSet,
    favoriteLeaguesByUser
  };
}
