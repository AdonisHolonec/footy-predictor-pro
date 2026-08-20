import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearHistoryDetailCache, useHistoryDetail } from "./useHistoryDetail";

/**
 * A real Supabase session, so the REAL fetchWithAuth runs.
 *
 * Deliberately NOT mocking ../utils/apiAuth: mocking it would only prove the
 * hook calls a helper, which is the assertion that would have passed while the
 * bug was live. Mocking one layer lower — the session — lets the genuine
 * fetchWithAuth build the headers and hands the assertion the object that
 * actually reaches the network.
 */
const ACCESS_TOKEN = "test-access-token";
let currentSession: { access_token: string } | null = { access_token: ACCESS_TOKEN };

vi.mock("../utils/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: currentSession }, error: null })
    }
  }
}));

/**
 * The history LIST ships ~261 KB of `raw_payload` per row purely so the match
 * modal can render without a fetch — the measured cause of /api/history's
 * statement timeouts. This hook is the detail source that lets the list stop.
 *
 * These tests pin the four properties that make it safe to rely on: it asks
 * once per fixture, it never re-asks for a fixture it already holds, a slow
 * answer for a fixture the user has navigated away from cannot overwrite the
 * current one, and a failure surfaces as an error rather than as data.
 */

/** Renders the hook's state so assertions read the real values. */
function Probe({ id }: { id: number | null }) {
  const { detail, loading, error } = useHistoryDetail(id);
  return <span data-testid="state">{loading ? "loading" : error ? `error:${error}` : (detail?.id ?? "none")}</span>;
}

let fetchMock: ReturnType<typeof vi.fn>;

/** A resolved detail response for one fixture. */
function itemResponse(id: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, scope: "fixture_detail", item: { id, teams: { home: "H", away: "A" } } })
  };
}

beforeEach(() => {
  __clearHistoryDetailCache();
  currentSession = { access_token: ACCESS_TOKEN };
  fetchMock = vi.fn(async (url: string) => itemResponse(Number(String(url).split("fixtureId=")[1])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Detail requests only, ignoring anything else the tree might fetch. */
function detailCalls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("fixtureId="));
}

/** The RequestInit each detail request was actually issued with. */
function detailInits(): RequestInit[] {
  return fetchMock.mock.calls
    .filter((c) => String(c[0]).includes("fixtureId="))
    .map((c) => (c[1] ?? {}) as RequestInit);
}

/** Header value as the network layer would see it, whatever form init.headers took. */
function headerOf(init: RequestInit, name: string): string | null {
  return new Headers(init.headers ?? {}).get(name);
}

describe("useHistoryDetail", () => {
  it("fetches the detail for a fixture", async () => {
    render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));
    expect(detailCalls()).toEqual(["/api/history?fixtureId=101"]);
  });

  it("does not re-request a fixture it already holds", async () => {
    const { unmount } = render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));
    unmount();

    // Reopening the same match must be free: a settled row cannot change.
    render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));
    expect(detailCalls().length, "the second open re-requested the same fixture").toBe(1);
  });

  it("fetches different fixtures independently", async () => {
    const { unmount } = render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));
    unmount();

    render(<Probe id={202} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("202"));
    expect(detailCalls()).toEqual(["/api/history?fixtureId=101", "/api/history?fixtureId=202"]);
  });

  it("never lets a slow answer overwrite the fixture now selected", async () => {
    // 101 resolves AFTER 202: without the guard, the user would open 202 and
    // then watch it silently become 101.
    fetchMock.mockImplementation(async (url: string) => {
      const id = Number(String(url).split("fixtureId=")[1]);
      if (id === 101) await new Promise((r) => setTimeout(r, 60));
      return itemResponse(id);
    });

    const view = render(<Probe id={101} />);
    view.rerender(<Probe id={202} />);

    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("202"));
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.getByTestId("state").textContent, "a stale response replaced the current fixture").toBe("202");
  });

  it("surfaces a failure as an error, not as data", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: "Fixture inexistent în istoric." })
    }));

    render(<Probe id={999} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("error:"));
    expect(screen.getByTestId("state").textContent).toContain("inexistent");
  });

  it("asks for nothing when no fixture is selected", async () => {
    render(<Probe id={null} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(detailCalls()).toEqual([]);
    expect(screen.getByTestId("state").textContent).toBe("none");
  });

  it("does not update state after unmount", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => errors.push(a));
    fetchMock.mockImplementation(async (url: string) => {
      await new Promise((r) => setTimeout(r, 40));
      return itemResponse(Number(String(url).split("fixtureId=")[1]));
    });

    const { unmount } = render(<Probe id={303} />);
    unmount();
    await new Promise((r) => setTimeout(r, 90));
    expect(errors, "unmount produced a React state-update warning").toEqual([]);
    spy.mockRestore();
  });
  /**
   * The regression that shipped: the hook issued a bare fetch, api/history.js
   * reads only the Authorization header, so every request 401'd and the modal
   * fell back to the list row. Nothing surfaced, because the fallback is also
   * the correct behaviour when detail is unavailable.
   *
   * Asserted on the object handed to fetch, not on the hook's source and not on
   * "was fetchWithAuth called" — the header has to survive all the way to the
   * network layer for the endpoint to accept it.
   */
  it("sends the session bearer token on the detail request", async () => {
    render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));

    const inits = detailInits();
    expect(inits).toHaveLength(1);
    expect(
      headerOf(inits[0], "Authorization"),
      "the detail request went out unauthenticated - api/history.js answers 401"
    ).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("still carries the abort signal alongside the auth header", async () => {
    render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));

    const [init] = detailInits();
    expect(headerOf(init, "Authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    // Losing `signal` would silently undo the unmount/stale-navigation guards.
    expect(init.signal, "fetchWithAuth dropped the AbortController signal").toBeInstanceOf(AbortSignal);
  });

  it("asks anonymously rather than throwing when there is no session", async () => {
    // Signed-out users have no history to open, but the hook must degrade to an
    // ordinary 401 rather than crash the modal on a missing session.
    currentSession = null;
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error: "Lipsește token-ul de autorizare." })
    }));

    render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("error:"));
    expect(headerOf(detailInits()[0], "Authorization")).toBeNull();
  });

  it("does not cache a failure", async () => {
    // A 401 during a token refresh must not permanently blank the fixture: the
    // cache is keyed by fixture and holds ANSWERS, never attempts.
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error: "Token invalid sau expirat." })
    }));

    const { unmount } = render(<Probe id={404} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("error:"));
    unmount();

    render(<Probe id={404} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("404"));
    expect(detailCalls().length, "a failed attempt poisoned the cache").toBe(2);
  });

  it("does not cache a network failure", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });

    const { unmount } = render(<Probe id={505} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("error:"));
    unmount();

    render(<Probe id={505} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("505"));
    expect(detailCalls().length, "a network failure poisoned the cache").toBe(2);
  });
});
