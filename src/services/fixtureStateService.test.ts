import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithAuth = vi.fn();
vi.mock("../utils/apiAuth", () => ({ fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a) }));

const { FIXTURE_STATE_BATCH_LIMIT, fetchFixtureStates, normalizeFixtureIds } = await import("./fixtureStateService");

/**
 * The batching contract.
 *
 * The panel expands one ticket of at most eight legs, so "one request" is the
 * requirement and N+1 is the failure. These tests count calls, not just results.
 */

const ok = (fixtures: unknown[]) => ({
  ok: true,
  json: async () => ({ ok: true, fixtures })
});

beforeEach(() => {
  fetchWithAuth.mockReset();
});

describe("normalizeFixtureIds", () => {
  it("deduplicates while preserving first-seen order", () => {
    expect(normalizeFixtureIds([903, 901, 903, 902, 901])).toEqual([903, 901, 902]);
  });

  it("drops anything that is not a usable id", () => {
    expect(normalizeFixtureIds([null, undefined, "", "abc", NaN, 0, -5])).toEqual([]);
  });

  it("accepts numeric strings, since ids cross the wire as JSON", () => {
    expect(normalizeFixtureIds(["901", 902])).toEqual([901, 902]);
  });
});

describe("fetchFixtureStates", () => {
  it("issues ONE request for a whole ticket", async () => {
    fetchWithAuth.mockResolvedValue(ok([{ id: 901, status: "FT", elapsed: null, score: { home: 2, away: 1 } }]));
    await fetchFixtureStates([901, 902, 903, 904, 905, 906, 907, 908]);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it("collapses duplicate fixture ids into a single id", async () => {
    fetchWithAuth.mockResolvedValue(ok([]));
    await fetchFixtureStates([901, 901, 901, 902]);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const url = String(fetchWithAuth.mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain("ids=901,902");
  });

  it("makes no request at all when there is nothing to ask for", async () => {
    await fetchFixtureStates([]);
    await fetchFixtureStates([null, "x"]);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("maps each fixture to its own id", async () => {
    fetchWithAuth.mockResolvedValue(
      ok([
        { id: 901, status: "FT", elapsed: null, score: { home: 2, away: 1 } },
        { id: 902, status: "2H", elapsed: 67, inPlay: true, score: { home: 0, away: 0 } }
      ])
    );
    const map = await fetchFixtureStates([901, 902]);
    expect(map.get(901)?.status).toBe("FT");
    expect(map.get(901)?.score).toEqual({ home: 2, away: 1 });
    expect(map.get(902)?.elapsed).toBe(67);
    expect(map.get(902)?.inPlay).toBe(true);
  });

  it("leaves an unanswered id ABSENT rather than empty-but-present", async () => {
    // Absent means "unknown"; a present-but-blank entry would render as a result.
    fetchWithAuth.mockResolvedValue(ok([{ id: 901, status: "FT", elapsed: null, score: { home: 1, away: 0 } }]));
    const map = await fetchFixtureStates([901, 902]);
    expect(map.has(901)).toBe(true);
    expect(map.has(902)).toBe(false);
  });

  it("never turns a missing score into 0-0", async () => {
    fetchWithAuth.mockResolvedValue(ok([{ id: 901, status: "NS", elapsed: null, score: { home: null, away: null } }]));
    const map = await fetchFixtureStates([901]);
    expect(map.get(901)?.score).toEqual({ home: null, away: null });
    expect(map.get(901)?.elapsed).toBeNull();
  });

  it("returns an empty map on an HTTP failure instead of throwing", async () => {
    fetchWithAuth.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(fetchFixtureStates([901])).resolves.toEqual(new Map());
  });

  it("returns an empty map when the body is not the expected shape", async () => {
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ ok: false }) });
    await expect(fetchFixtureStates([901])).resolves.toEqual(new Map());
  });

  it("survives a body that is not JSON at all", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("not json");
      }
    });
    await expect(fetchFixtureStates([901])).resolves.toEqual(new Map());
  });

  it("chunks beyond the upstream id cap without becoming N+1", async () => {
    fetchWithAuth.mockResolvedValue(ok([]));
    const many = Array.from({ length: FIXTURE_STATE_BATCH_LIMIT + 5 }, (_, i) => 1000 + i);
    await fetchFixtureStates(many);
    // 45 ids => two requests, not 45.
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
  });
});
