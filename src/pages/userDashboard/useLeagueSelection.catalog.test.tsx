import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ELITE_LEAGUES, ELITE_LEAGUE_META } from "../../constants/appConstants";
import { useLeagueCatalog } from "../../hooks/useLeagueCatalog";
import { fetchLeagueCatalog, resetLeagueCatalogCache } from "../../services/leagueCatalogService";
import type { LeagueCatalogEntry } from "../../types";
import { useLeagueSelection } from "./useLeagueSelection";

/**
 * „Selectează ligi” must show the ENTIRE catalog, not only the elite subset.
 * The catalog arrives through one cached fetch (`/api/fixtures?view=leagues`);
 * the selection contract (`selectedLeagueIds`, localStorage key, profile save)
 * is untouched.
 */

const PREMIER = 39; // elite, present in ELITE_LEAGUES
const ARGENTINA = 128;
const AUSTRIA = 218;
const ZAMBIA = 351;
const STALE = 999_999; // not in the catalog

const CATALOG: LeagueCatalogEntry[] = [
  { id: ZAMBIA, name: "Super League", country: "Zambia", type: "League" },
  { id: AUSTRIA, name: "Bundesliga", country: "Austria", type: "League" },
  { id: ARGENTINA, name: "Liga Profesional Argentina", country: "Argentina", type: "League" },
  { id: ARGENTINA, name: "Liga Profesional Argentina", country: "Argentina", type: "League" }, // duplicate id
  ...ELITE_LEAGUE_META.map((m) => ({ id: Number(m.id), name: m.name, country: m.country, type: "League" as const }))
];

type AuthUser = Parameters<typeof useLeagueSelection>[0]["user"];
function makeUser(favoriteLeagues: number[] = []): AuthUser {
  return { id: "user-1", email: "u@example.com", role: "user", tier: "free", favoriteLeagues, isBlocked: false } as unknown as AuthUser;
}

const DAY = "2026-09-23";
const noop = () => {};
function dayResponse(leagues: Array<{ id: number; name: string; country: string; matches: number }>) {
  return { ok: true, leagues, totalFixtures: leagues.reduce((s, l) => s + l.matches, 0), usage: { date: DAY, count: 0, limit: 100 } };
}

function stubFetch(dayLeagues: Array<{ id: number; name: string; country: string; matches: number }> = []) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("view=leagues")) return { ok: true, json: async () => ({ ok: true, count: CATALOG.length, leagues: CATALOG }) };
    return { ok: true, json: async () => dayResponse(dayLeagues) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSelection(user: AuthUser, updateFavoriteLeagues = async () => undefined) {
  return renderHook(() => {
    const { catalog, status } = useLeagueCatalog(Boolean(user));
    const selection = useLeagueSelection({
      user,
      accessToken: user ? "token" : undefined,
      date: DAY,
      selectedDates: [DAY],
      updateFavoriteLeagues,
      setStatus: () => {},
      catalog
    });
    return { ...selection, catalogStatus: status };
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetLeagueCatalogCache();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("league selector · full catalog", () => {
  it("displays the entire catalog (elite ∪ provider), each id exactly once", async () => {
    stubFetch();
    const { result } = renderSelection(makeUser());
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    const ids = result.current.leaguesSorted.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([ZAMBIA, AUSTRIA, ARGENTINA, ...ELITE_LEAGUES.map(Number)]));
    expect(ids.filter((id) => id === ARGENTINA)).toHaveLength(1);
    expect(ids.length).toBe(new Set(CATALOG.map((c) => c.id)).size);
  });

  it("keeps a league with no matches today in the list (Premier League on a blank day)", async () => {
    stubFetch([{ id: ZAMBIA, name: "Super League", country: "Zambia", matches: 3 }]);
    const { result } = renderSelection(makeUser());
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    const premier = result.current.leaguesSorted.find((l) => l.id === PREMIER);
    expect(premier).toBeDefined();
    expect(premier?.matches).toBe(0);
    expect(result.current.leaguesSorted.find((l) => l.id === ZAMBIA)?.matches).toBe(3);
  });

  it("orders favorites first, then domestic tiers globally, then international club competitions, then the unclassified rest alphabetically", async () => {
    stubFetch();
    const { result } = renderSelection(makeUser([ZAMBIA]));
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    const ids = result.current.leaguesSorted.map((l) => l.id);
    // favorite (unclassified Zambia) first, regardless of tier
    expect(ids[0]).toBe(ZAMBIA);
    // tier 1 block in the project's country priority: England, Spain, Italy, Germany, France, Netherlands, Romania, USA, then Austria + Argentina
    expect(ids.slice(1, 11)).toEqual([39, 140, 135, 78, 61, 88, 283, 253, AUSTRIA, ARGENTINA]);
    // then the international club competitions in config order, then nothing else remains unclassified
    expect(ids.slice(11)).toEqual([2, 3, 848]);
    expect(ids).toHaveLength(new Set(CATALOG.map((c) => c.id)).size);
  });

  it("uses no match count in the order: today's fixtures never move a league", async () => {
    stubFetch([{ id: AUSTRIA, name: "Bundesliga", country: "Austria", matches: 9 }, { id: ZAMBIA, name: "Super League", country: "Zambia", matches: 9 }]);
    const { result } = renderSelection(makeUser());
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    const ids = result.current.leaguesSorted.map((l) => l.id);
    expect(ids.indexOf(39)).toBeLessThan(ids.indexOf(AUSTRIA));
    expect(ids.indexOf(ZAMBIA)).toBe(ids.length - 1);
  });

  it("selects and deselects a non-favorite, non-elite league", async () => {
    stubFetch();
    const { result } = renderSelection(makeUser());
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    act(() => result.current.setSelectedLeagueIdsLimited([...result.current.selectedLeagueIds, AUSTRIA]));
    expect(result.current.selectedLeagueIds).toContain(AUSTRIA);
    act(() => result.current.setSelectedLeagueIdsLimited(result.current.selectedLeagueIds.filter((id) => id !== AUSTRIA)));
    expect(result.current.selectedLeagueIds).not.toContain(AUSTRIA);
  });

  it("search narrows what is displayed but not the catalog id set used for pruning; “clear” empties the selection", async () => {
    window.localStorage.setItem("footy.user.favoriteLeagueByUser", JSON.stringify({ "user-1": [AUSTRIA, PREMIER] }));
    stubFetch();
    const { result } = renderSelection(makeUser());
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    const fullIdSet = new Set(CATALOG.map((c) => c.id));
    expect(result.current.allCatalogLeagueIds.length).toBe(fullIdSet.size);
    act(() => result.current.setSearchLeague("zam"));
    expect(result.current.leaguesSorted.map((l) => l.id)).toEqual([ZAMBIA]);
    // The reconciliation set is search-independent, so a filtered view never prunes a hidden but valid selection.
    expect(new Set(result.current.allCatalogLeagueIds)).toEqual(fullIdSet);
    expect(result.current.selectedLeagueIds).toEqual([AUSTRIA, PREMIER]);
    act(() => result.current.setSelectedLeagueIdsLimited([]));
    expect(result.current.selectedLeagueIds).toEqual([]);
  });

  it("restores the persisted selection on refresh and prunes ids the catalog does not know", async () => {
    window.localStorage.setItem("footy.user.favoriteLeagueByUser", JSON.stringify({ "user-1": [AUSTRIA, STALE, PREMIER] }));
    stubFetch();
    const { result } = renderSelection(makeUser());
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    await waitFor(() => expect(result.current.selectedLeagueIds).toEqual([AUSTRIA, PREMIER]));
  });

  it("never prunes a valid selection just because the league has no matches today", async () => {
    window.localStorage.setItem("footy.user.favoriteLeagueByUser", JSON.stringify({ "user-1": [AUSTRIA] }));
    stubFetch([{ id: ZAMBIA, name: "Super League", country: "Zambia", matches: 2 }]);
    const { result } = renderSelection(makeUser());
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    await waitFor(() => expect(result.current.selectedLeagueIds).toEqual([AUSTRIA]));
  });

  it("does not prune before the catalog has loaded (elite-only fallback keeps the selection)", async () => {
    window.localStorage.setItem("footy.user.favoriteLeagueByUser", JSON.stringify({ "user-1": [AUSTRIA] }));
    stubFetch();
    // Stable callbacks, as UserDashboard passes them (useCallback): an inline lambda in the
    // render callback would re-run the debounced save effect on every render.
    const user = makeUser();
    const updateFavoriteLeagues = async () => undefined;
    const { result } = renderHook(() =>
      useLeagueSelection({ user, accessToken: "token", date: DAY, selectedDates: [DAY], updateFavoriteLeagues, setStatus: noop, catalog: null })
    );
    await waitFor(() => expect(result.current.selectedLeagueIds).toEqual([AUSTRIA]));
    expect(result.current.leaguesSorted.map((l) => l.id).sort()).toEqual(ELITE_LEAGUES.map(Number).sort());
  });

  it("fetches the catalog exactly once per session and never per league", async () => {
    const fetchMock = stubFetch();
    const { result, rerender } = renderSelection(makeUser());
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    rerender();
    act(() => result.current.setSearchLeague("bund"));
    await fetchLeagueCatalog(); // a second consumer hits the session cache
    const catalogCalls = fetchMock.mock.calls.filter((c) => String((c as unknown[])[0]).includes("view=leagues"));
    expect(catalogCalls).toHaveLength(1);
    expect(fetchMock.mock.calls.every((c) => !/[?&]league=/.test(String((c as unknown[])[0])))).toBe(true);
  });

  it("persists selectedLeagueIds exactly as before (same localStorage key, same profile call)", async () => {
    stubFetch();
    const updateFavoriteLeagues = vi.fn(async () => undefined);
    const { result } = renderSelection(makeUser(), updateFavoriteLeagues);
    await waitFor(() => expect(result.current.catalogStatus).toBe("ready"));
    act(() => result.current.setSelectedLeagueIdsLimited([ZAMBIA, PREMIER]));
    await waitFor(() => expect(updateFavoriteLeagues).toHaveBeenLastCalledWith([ZAMBIA, PREMIER]));
    const stored = JSON.parse(window.localStorage.getItem("footy.user.favoriteLeagueByUser") || "{}");
    expect(stored["user-1"]).toEqual([ZAMBIA, PREMIER]);
    expect(result.current.selectedLeagueIds).toEqual([ZAMBIA, PREMIER]);
  });

  it("falls back to the elite list and keeps the selection when the catalog request fails", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes("view=leagues")) return { ok: false, status: 502, json: async () => ({ ok: false, error: "down" }) };
      return { ok: true, json: async () => dayResponse([]) };
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("footy.user.favoriteLeagueByUser", JSON.stringify({ "user-1": [AUSTRIA] }));
    const { result } = renderSelection(makeUser());
    await waitFor(() => expect(result.current.catalogStatus).toBe("error"));
    expect(result.current.leaguesSorted.map((l) => l.id).sort()).toEqual(ELITE_LEAGUES.map(Number).sort());
    expect(result.current.selectedLeagueIds).toEqual([AUSTRIA]);
  });
});
