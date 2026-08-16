import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_PRODUCT, comboProduct, useGlobalSpecialBet } from "./useGlobalSpecialBet";

const fetchWithAuth = vi.fn();
vi.mock("../utils/apiAuth", () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
  authHeaders: async () => ({})
}));

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const SNAPSHOT = {
  ok: true,
  created: true,
  bet: {
    id: "bet-1",
    user_id: "user-1",
    bet_date: "2026-08-11",
    league_ids: [39],
    league_scope: "39",
    variant: 5,
    status: "pending",
    total_odds: 6.4,
    average_confidence: 74,
    model_version: "v3",
    created_at: "2026-08-11T09:00:00.000Z",
    settled_at: null,
    settled_total_odds: null
  },
  selections: [{ id: "sel-1", fixture_id: 999001, status: "pending" }]
};

function setup(overrides: { betDate?: string; leagueIds?: number[] } = {}) {
  return renderHook(() =>
    useGlobalSpecialBet({
      betDate: overrides.betDate ?? "2026-08-11",
      leagueIds: overrides.leagueIds ?? [39, 140]
    })
  );
}

describe("useGlobalSpecialBet", () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
  });

  it("starts idle on the 3-selection variant and asks for nothing", () => {
    const { result } = setup();
    expect(result.current.product).toEqual({ kind: "combo", variant: 3 });
    expect(result.current.state.phase).toBe("idle");
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("sends intent only — the chosen variant, the date and the favourite leagues", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(201, SNAPSHOT));
    const { result } = setup();

    act(() => result.current.setProduct(comboProduct(5)));
    await act(async () => {
      await result.current.generate();
    });

    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/special-bets");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ bet_date: "2026-08-11", variant: 5, leagueIds: [39, 140] });
    // Nothing the server owns may travel in the request.
    expect(Object.keys(body)).not.toContain("selections");
    expect(Object.keys(body)).not.toContain("odds");
    expect(Object.keys(body)).not.toContain("confidence");
    expect(Object.keys(body)).not.toContain("user_id");
  });

  it("exposes a loading phase while the request is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    fetchWithAuth.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const { result } = setup();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.generate();
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));
    expect(result.current.state.phase).toBe("generating");

    await act(async () => {
      release(jsonResponse(201, SNAPSHOT));
      await pending;
    });
    expect(result.current.state.phase).toBe("ready");
  });

  it("refuses a second in-flight POST — the server still owns idempotency", async () => {
    let release: (value: unknown) => void = () => {};
    fetchWithAuth.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const { result } = setup();

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.generate();
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    await act(async () => {
      await result.current.generate();
    });
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(jsonResponse(201, SNAPSHOT));
      await first;
    });
  });

  it("reports an unavailable variant as a product state, writing nothing", async () => {
    fetchWithAuth.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        created: false,
        available: false,
        variant: 8,
        required: 8,
        availableCandidates: 6
      })
    );
    const { result } = setup();

    act(() => result.current.setProduct(comboProduct(8)));
    await act(async () => {
      await result.current.generate();
    });

    expect(result.current.state.phase).toBe("unavailable");
    if (result.current.state.phase === "unavailable") {
      expect(result.current.state.unavailable.availableCandidates).toBe(6);
      expect(result.current.state.unavailable.required).toBe(8);
    }
  });

  it("keeps each variant's answer, so switching back costs no request", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(201, SNAPSHOT));
    const { result } = setup();

    await act(async () => {
      await result.current.generate();
    });
    act(() => result.current.setProduct(comboProduct(5)));
    expect(result.current.state.phase).toBe("idle");

    act(() => result.current.setProduct(comboProduct(3)));
    expect(result.current.state.phase).toBe("ready");
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's reason on a 403 and does not offer a retry", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(403, { ok: false, error: "Ligi în afara favoritelor: 61." }));
    const { result } = setup();

    await act(async () => {
      await result.current.generate();
    });

    expect(result.current.state.phase).toBe("error");
    if (result.current.state.phase === "error") {
      expect(result.current.state.error.message).toBe("Ligi în afara favoritelor: 61.");
      expect(result.current.state.error.retryable).toBe(false);
    }
  });

  it("treats a 500 as a retryable failure, never as an unavailable variant", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(500, { ok: false, error: "boom" }));
    const { result } = setup();

    await act(async () => {
      await result.current.generate();
    });

    expect(result.current.state.phase).toBe("error");
    if (result.current.state.phase === "error") expect(result.current.state.error.retryable).toBe(true);
  });

  it("does not call the API without favourite leagues", async () => {
    const { result } = setup({ leagueIds: [] });
    await act(async () => {
      await result.current.generate();
    });
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  describe("Bilet Sistem", () => {
    it("asks for the System by kind, and never sends a k", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(201, SNAPSHOT));
      const { result } = setup();

      act(() => result.current.setProduct(SYSTEM_PRODUCT));
      await act(async () => {
        await result.current.generate();
      });

      const [, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({ bet_date: "2026-08-11", variant: 5, leagueIds: [39, 140], bet_kind: "system" });
      // The k is the server's. Sending one would be refused with 400, and the
      // product would be a lie either way.
      expect(Object.keys(body)).not.toContain("system_k");
      expect(Object.keys(body)).not.toContain("systemK");
    });

    it("the System product is five selections and carries no k", () => {
      expect(SYSTEM_PRODUCT).toEqual({ kind: "system", variant: 5 });
      expect(Object.keys(SYSTEM_PRODUCT)).not.toContain("systemK");
    });

    it("a Combo request is byte-identical to the one sent before System existed", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(201, SNAPSHOT));
      const { result } = setup();

      act(() => result.current.setProduct(comboProduct(5)));
      await act(async () => {
        await result.current.generate();
      });

      const [, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      // No bet_kind at all: absent means combo, so nothing about the legacy
      // request changed when the System was added beside it.
      expect(body).toEqual({ bet_date: "2026-08-11", variant: 5, leagueIds: [39, 140] });
    });

    it("Combo 5 and the System never share a slot", async () => {
      // Both are five selections. Keyed on the number alone, one would overwrite
      // the other's state and the user would see a system's snapshot under the
      // combo heading.
      fetchWithAuth.mockResolvedValue(jsonResponse(201, SNAPSHOT));
      const { result } = setup();

      act(() => result.current.setProduct(comboProduct(5)));
      await act(async () => {
        await result.current.generate();
      });
      expect(result.current.state.phase).toBe("ready");

      act(() => result.current.setProduct(SYSTEM_PRODUCT));
      expect(result.current.state.phase).toBe("idle");
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.generate();
      });
      expect(result.current.state.phase).toBe("ready");
      expect(fetchWithAuth).toHaveBeenCalledTimes(2);

      // And the combo's own answer survived the trip.
      act(() => result.current.setProduct(comboProduct(5)));
      expect(result.current.state.phase).toBe("ready");
      expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    });

    it("an error on the System leaves the Combo's state alone", async () => {
      fetchWithAuth.mockResolvedValueOnce(jsonResponse(201, SNAPSHOT));
      const { result } = setup();
      act(() => result.current.setProduct(comboProduct(5)));
      await act(async () => {
        await result.current.generate();
      });
      expect(result.current.state.phase).toBe("ready");

      fetchWithAuth.mockResolvedValue(jsonResponse(500, { ok: false, error: "boom" }));
      act(() => result.current.setProduct(SYSTEM_PRODUCT));
      await act(async () => {
        await result.current.generate();
      });
      expect(result.current.state.phase).toBe("error");

      act(() => result.current.setProduct(comboProduct(5)));
      expect(result.current.state.phase).toBe("ready");
    });
  });
});
