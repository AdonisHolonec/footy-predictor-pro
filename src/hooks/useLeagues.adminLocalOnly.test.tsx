import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSaveErrorMessage, useLeagues } from "./useLeagues";

/**
 * Admin favourite leagues are local-only: an admin's own `profiles` row is not
 * client-updatable (RLS `users_update_own_profile` requires role = 'user'), so the
 * legacy hook must never attempt the remote save for admins, while consumers keep
 * the existing debounced `updateFavoriteLeagues` contract unchanged.
 */

vi.mock("../services/fixturesService", () => ({
  fetchDaysAggregation: async () => ({ ok: true, date: "2026-09-23", totalFixtures: 0, leagues: [], usage: { date: "2026-09-23", count: 0, limit: 100 } })
}));

const DAY = "2026-09-23";
const FALLBACK = "Nu am putut salva preferintele utilizatorului.";
const SELECTED_DATES = [DAY]; // stable identity: the hook keys its day fetch on this array
const requireAuth = () => true;
const setSelectedDates = () => {};
type Role = "user" | "admin";

function renderLeagues(user: { id: string; favoriteLeagues?: number[]; role?: Role } | null, updateFavoriteLeagues = vi.fn(async () => undefined), setStatus = vi.fn()) {
  const hook = renderHook(() => useLeagues({ date: DAY, selectedDates: SELECTED_DATES, setSelectedDates, user, updateFavoriteLeagues, requireAuth, setStatus }));
  return { ...hook, updateFavoriteLeagues, setStatus };
}
const settle = () => new Promise((r) => setTimeout(r, 700)); // past the 450 ms debounce
/** The hook also reports day-fetch progress through setStatus; only save failures matter here. */
const saveErrorMessages = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0])).filter((m) => m === FALLBACK || /salva|row-level|Eroare/i.test(m));
const stored = () => JSON.parse(window.localStorage.getItem("footy.favoriteLeagueByUser") || "{}") as Record<string, number[]>;

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("useLeagues · admin selection is local-only", () => {
  it("hydration on page load does not trigger any remote save for an admin", async () => {
    const { updateFavoriteLeagues, setStatus } = renderLeagues({ id: "admin-1", favoriteLeagues: [39, 283], role: "admin" });
    await settle();
    expect(updateFavoriteLeagues).not.toHaveBeenCalled();
    expect(saveErrorMessages(setStatus)).toEqual([]);
  });

  it("persists an admin's selection locally, never calls updateFavoriteLeagues, never enters the error state", async () => {
    const { result, updateFavoriteLeagues, setStatus } = renderLeagues({ id: "admin-1", favoriteLeagues: [], role: "admin" });
    act(() => result.current.setSelectedLeagueIds([39, 140]));
    await settle();
    expect(result.current.selectedLeagueIds).toEqual([39, 140]);
    expect(stored()["admin-1"]).toEqual([39, 140]);
    expect(updateFavoriteLeagues).not.toHaveBeenCalled();
    expect(saveErrorMessages(setStatus)).toEqual([]);
  });

  it("restores an admin's local selection on refresh, still without a remote save", async () => {
    window.localStorage.setItem("footy.favoriteLeagueByUser", JSON.stringify({ "admin-1": [283, 61] }));
    const { result, updateFavoriteLeagues } = renderLeagues({ id: "admin-1", favoriteLeagues: [39], role: "admin" });
    await waitFor(() => expect(result.current.selectedLeagueIds).toEqual([283, 61]));
    await settle();
    expect(updateFavoriteLeagues).not.toHaveBeenCalled();
  });
});

describe("useLeagues · consumer contract unchanged", () => {
  it("an ordinary user still reaches updateFavoriteLeagues with the selection, after the debounce, and persists locally under the same key", async () => {
    const { result, updateFavoriteLeagues } = renderLeagues({ id: "user-1", favoriteLeagues: [], role: "user" });
    act(() => result.current.setSelectedLeagueIds([39, 140]));
    await waitFor(() => expect(updateFavoriteLeagues).toHaveBeenLastCalledWith([39, 140]), { timeout: 1500 });
    expect(stored()["user-1"]).toEqual([39, 140]);
  });

  it("a user without an explicit role (legacy callers) keeps the remote save", async () => {
    const { result, updateFavoriteLeagues } = renderLeagues({ id: "user-2", favoriteLeagues: [] });
    act(() => result.current.setSelectedLeagueIds([135]));
    await waitFor(() => expect(updateFavoriteLeagues).toHaveBeenLastCalledWith([135]), { timeout: 1500 });
  });

  it("a rejected consumer save still surfaces its message (plain PostgREST object) and is not swallowed", async () => {
    const failing = vi.fn(async () => { throw { message: "new row violates row-level security policy for table \"profiles\"", code: "42501" }; });
    const { result, setStatus } = renderLeagues({ id: "user-3", favoriteLeagues: [], role: "user" }, failing, vi.fn());
    act(() => result.current.setSelectedLeagueIds([39]));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("new row violates row-level security policy for table \"profiles\""), { timeout: 1500 });
  });

  it("a guest (no user) never saves anywhere", async () => {
    const { updateFavoriteLeagues, setStatus } = renderLeagues(null);
    await settle();
    expect(updateFavoriteLeagues).not.toHaveBeenCalled();
    expect(saveErrorMessages(setStatus)).toEqual([]);
  });
});

describe("readSaveErrorMessage", () => {
  it("Error instance → its message", () => expect(readSaveErrorMessage(new Error("boom"))).toBe("boom"));
  it("plain object with string message → that message", () => expect(readSaveErrorMessage({ message: "rls denied", code: "42501" })).toBe("rls denied"));
  it("anything else → the existing fallback, never a raw object", () => {
    expect(readSaveErrorMessage(undefined)).toBe(FALLBACK);
    expect(readSaveErrorMessage("nope")).toBe(FALLBACK);
    expect(readSaveErrorMessage({ message: 42 })).toBe(FALLBACK);
    expect(readSaveErrorMessage({ message: "   " })).toBe(FALLBACK);
    expect(readSaveErrorMessage(new Error(""))).toBe(FALLBACK);
  });
});
