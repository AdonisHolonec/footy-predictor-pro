import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHistory } from "./historyService";

/**
 * The client half of the `view=list` cutover.
 *
 * `src/hooks/useAppController.ts` is the ONLY importer of this module, and it
 * was the last caller still asking /api/history for the FULL document.
 * Production, admin-global branch: 190 rows, 60,406,830 bytes, dbReadMs past
 * statement_timeout.
 *
 * The request URL is the whole behaviour change, so it is what these tests pin.
 * The response contract is deliberately asserted too: predictionListRouting's
 * "envelope is identical across projections" holds server-side, and this is the
 * client-side half of the same guarantee - narrowing the projection must not
 * change how items/stats are parsed.
 */

function jsonResponse(body: unknown) {
  return { json: async () => body } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

function urlOf(call = 0): string {
  return String(fetchMock.mock.calls[call][0]);
}

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    jsonResponse({
      ok: true,
      items: [{ id: 1 }, { id: 2 }],
      stats: { wins: 2, losses: 1, settled: 3, winRate: 66.7, pushes: 0, halfWins: 0, halfLosses: 0 }
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadHistory asks for the light list projection", () => {
  it("sends view=list for an authenticated non-admin, alongside mine=1", async () => {
    await loadHistory(7, { accessToken: "token", isAdmin: false });
    const url = urlOf();
    expect(url).toContain("view=list");
    expect(url).toContain("mine=1");
  });

  /*
    The regression this exists for: loadHistory omits `mine` for an admin, so an
    admin request lands on the GLOBAL branch. That is the branch whose reader
    selects a bare `*`, and the one that produced the 60 MB response.
  */
  it("sends view=list for an admin, which omits mine and hits the global branch", async () => {
    await loadHistory(7, { accessToken: "token", isAdmin: true });
    const url = urlOf();
    expect(url).toContain("view=list");
    expect(url).not.toContain("mine=1");
  });

  it("sends view=list when there is no session at all", async () => {
    await loadHistory(7);
    expect(urlOf()).toContain("view=list");
  });

  it("keeps the window and limit the caller asked for", async () => {
    await loadHistory(7, { accessToken: "token", isAdmin: false });
    const url = urlOf();
    expect(url).toContain("days=7");
    expect(url).toContain("limit=2000");
  });

  it("attaches the bearer only when a token is supplied", async () => {
    await loadHistory(7, { accessToken: "token", isAdmin: false });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: "Bearer token" });

    await loadHistory(7);
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toEqual({});
  });
});

describe("the response contract is unchanged by the narrower projection", () => {
  it("returns items and stats verbatim", async () => {
    const result = await loadHistory(7, { accessToken: "token", isAdmin: false });
    expect(result.items).toHaveLength(2);
    expect(result.stats.wins).toBe(2);
    expect(result.stats.settled).toBe(3);
  });

  it("falls back to empty results when the API omits them", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await loadHistory(7);
    expect(result.items).toEqual([]);
    expect(result.stats).toEqual({ wins: 0, losses: 0, settled: 0, winRate: 0 });
  });

  it("throws the API error rather than returning a half-empty board", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "db_timeout" }));
    await expect(loadHistory(7)).rejects.toThrow("db_timeout");
  });
});
