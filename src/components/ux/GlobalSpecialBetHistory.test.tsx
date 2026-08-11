import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalSpecialBetHistory from "./GlobalSpecialBetHistory";

const fetchWithAuth = vi.fn();
vi.mock("../../utils/apiAuth", () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
  authHeaders: async () => ({})
}));

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function storedBet(overrides: Record<string, unknown> = {}) {
  return {
    id: "bet-1",
    user_id: "user-1",
    bet_date: "2026-08-10",
    league_ids: [39],
    league_scope: "39",
    variant: 3,
    status: "won",
    total_odds: 4.81,
    average_confidence: 78,
    model_version: "v3",
    created_at: "2026-08-10T09:00:00.000Z",
    settled_at: "2026-08-10T22:00:00.000Z",
    settled_total_odds: 3.21,
    selections: [
      {
        id: "sel-1",
        special_bet_id: "bet-1",
        fixture_id: 999001,
        league_id: 39,
        // A bet stored before migration 048 — no names of its own.
        fixture_label: null,
        league_name: null,
        kickoff_at: "2026-08-10T18:30:00.000Z",
        market: "corners",
        selection: "Over 7.5",
        side: "over",
        line: 7.5,
        odds: 1.32,
        confidence: 82,
        value_score: 12.4,
        status: "won",
        settled_at: "2026-08-10T22:00:00.000Z"
      }
    ],
    ...overrides
  };
}

describe("GlobalSpecialBetHistory", () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
  });
  afterEach(cleanup);

  it("reads the stored bets through the API's own pagination", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });

    const [url] = fetchWithAuth.mock.calls[0] as [string];
    expect(url).toContain("/api/special-bets?");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=0");
  });

  it("states plainly when nothing has been generated yet", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });

    await waitFor(() => expect(screen.getByText("Nu ai încă niciun Global Special Bet salvat.")).toBeTruthy());
  });

  it("keeps status and price readable without opening the item", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [storedBet()] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });

    await waitFor(() => expect(screen.getByText("Câștigat")).toBeTruthy());
    expect(screen.getByText(/4\.81/)).toBeTruthy();
    expect(screen.getByText(/3\.21/)).toBeTruthy();
    expect(screen.getByText(/78%/)).toBeTruthy();
    // Collapsed: the legs are not in the tree yet.
    expect(screen.queryByText("Over 7.5")).toBeNull();
  });

  it("expands and collapses an item's selections", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [storedBet()] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Vezi selecțiile" })).toBeTruthy());

    await act(async () => {
      screen.getByRole("button", { name: "Vezi selecțiile" }).click();
    });
    expect(screen.getByText("Over 7.5")).toBeTruthy();
    // Pre-048 and no fixture loaded: the id is the honest answer.
    expect(screen.getByText("Meci #999001")).toBeTruthy();

    await act(async () => {
      screen.getByRole("button", { name: "Ascunde selecțiile" }).click();
    });
    expect(screen.queryByText("Over 7.5")).toBeNull();
  });

  it("names a leg from the bet's own snapshot, with no fixture loaded", async () => {
    // The whole point of migration 048: history is read long after the fixtures
    // it names have left the app, so the bet has to name itself.
    const bet = storedBet();
    const named = storedBet({
      selections: [
        { ...bet.selections[0], fixture_label: "Arsenal – Chelsea", league_name: "Premier League" }
      ]
    });
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [named] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Vezi selecțiile" })).toBeTruthy());

    await act(async () => {
      screen.getByRole("button", { name: "Vezi selecțiile" }).click();
    });

    expect(screen.getByText("Arsenal – Chelsea")).toBeTruthy();
    expect(screen.getByText(/Premier League/)).toBeTruthy();
    expect(screen.queryByText("Meci #999001")).toBeNull();
  });

  it("withholds a settled odd the API did not send rather than showing a zero", async () => {
    fetchWithAuth.mockResolvedValue(
      jsonResponse(200, { ok: true, bets: [storedBet({ status: "lost", settled_total_odds: null })] })
    );
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });

    await waitFor(() => expect(screen.getByText("Pierdut")).toBeTruthy());
    expect(screen.queryByText(/Cotă la decontare/)).toBeNull();
    expect(screen.queryByText(/0\.00/)).toBeNull();
  });

  it("offers a retry when the list fails to load", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(500, { ok: false, error: "boom" }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Reîncearcă" })).toBeTruthy();
  });

  it("renders nothing and asks for nothing when access is withheld", () => {
    const { container } = render(<GlobalSpecialBetHistory />);
    expect(container.firstChild).toBeNull();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});
