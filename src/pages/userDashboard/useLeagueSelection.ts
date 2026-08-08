import { useEffect, useMemo, useRef, useState } from "react";
import { ELITE_LEAGUES, ELITE_LEAGUE_META } from "../../constants/appConstants";
import type { useAuth } from "../../hooks/useAuth";
import type { DayResponse, League } from "../../types";
import { isoToday, normalizeSelectedDates, useLocalStorageState } from "../../utils/appUtils";

type AuthUser = ReturnType<typeof useAuth>["user"];

/**
 * Selecția de ligi + lista sortată, mutate verbatim din UserDashboard:
 * încărcarea zilelor (/api/fixtures), hidratarea selecției din profil sau
 * localStorage și salvarea debounced a ligilor favorite.
 */
export function useLeagueSelection({
  user,
  accessToken,
  date,
  selectedDates,
  updateFavoriteLeagues,
  setStatus
}: {
  user: AuthUser;
  accessToken: string | undefined;
  date: string;
  selectedDates: string[];
  updateFavoriteLeagues: (leagueIds: number[]) => Promise<unknown>;
  setStatus: (message: string) => void;
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

  const leaguesSorted = useMemo(() => {
    const allowedLeagueSet = new Set(ELITE_LEAGUES.map((id) => Number(id)));
    const liveById = new Map((day?.leagues ?? []).map((league) => [Number(league.id), league] as const));
    const leagues = ELITE_LEAGUE_META.map((meta) => {
      const existing = liveById.get(Number(meta.id));
      return {
        id: meta.id,
        name: existing?.name || meta.name,
        country: existing?.country || meta.country,
        matches: Number(existing?.matches || 0),
        logo: existing?.logo
      };
    })
      .filter((league) => allowedLeagueSet.has(Number(league.id)))
      .filter((league) => league.name.toLowerCase().includes(searchLeague.toLowerCase()) || league.country.toLowerCase().includes(searchLeague.toLowerCase()));
    const favoriteSet = new Set((user?.favoriteLeagues || []).map((id) => Number(id)));
    const favorites = leagues.filter((league) => favoriteSet.has(Number(league.id)));
    const elite = leagues
      .filter((league) => ELITE_LEAGUES.includes(Number(league.id)) && !favoriteSet.has(Number(league.id)))
      .sort((a, b) => b.matches - a.matches);
    return [...favorites, ...elite];
  }, [day, searchLeague, user?.favoriteLeagues]);

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
    fetchDays
  };
}
