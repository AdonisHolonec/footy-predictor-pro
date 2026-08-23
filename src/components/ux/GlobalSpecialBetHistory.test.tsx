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

/** The compact row is a two-line overview; everything else sits behind its disclosure. */
const rowButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[data-slot="ticket-row"]')];
const rowButton = () => rowButtons()[0];
async function openAll() {
  await waitFor(() => expect(rowButtons().length).toBeGreaterThan(0));
  await act(async () => {
    for (const b of rowButtons()) if (b.getAttribute("aria-expanded") !== "true") b.click();
  });
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

    // The section now opens on the Combo tab, and each product owns its own empty
    // copy: a single "nothing saved" line would be a claim neither tab can make,
    // since neither tab has seen the other's rows.
    await waitFor(() => expect(screen.getByText("Nu ai încă niciun bilet Combo salvat.")).toBeTruthy());
  });

  it("keeps status and price readable without opening the item", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [storedBet()] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });

    await waitFor(() => expect(screen.getByText("Câștigat")).toBeTruthy());
    expect(screen.getByText(/4\.81/)).toBeTruthy();
    // Collapsed: the overview shows status, legs and price only — no settled
    // odds, no confidence, no legs in the tree yet.
    expect(screen.queryByText(/3\.21/)).toBeNull();
    expect(screen.queryByText(/78%/)).toBeNull();
    expect(screen.queryByText("Over 7.5")).toBeNull();
    await openAll();
    expect(screen.getByText(/3\.21/)).toBeTruthy();
    expect(screen.getByText(/78%/)).toBeTruthy();
  });

  it("a post-050 bet shows its stored ticket chance instead of the confidence line", async () => {
    fetchWithAuth.mockResolvedValue(
      jsonResponse(200, { ok: true, bets: [storedBet({ ticket_probability: 0.3256 })] })
    );
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });

    await openAll();
    await waitFor(() => expect(screen.getByText(/Șansă estimată bilet: 33%/)).toBeTruthy());
    expect(screen.queryByText(/Încredere medie/)).toBeNull();
  });

  it("a legacy bet keeps its confidence line and invents no ticket chance", async () => {
    // storedBet() carries no ticket_probability — exactly a pre-050 row.
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [storedBet()] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });

    await openAll();
    await waitFor(() => expect(screen.getByText(/Încredere medie/)).toBeTruthy());
    expect(screen.queryByText(/Șansă estimată bilet/)).toBeNull();
    expect(screen.queryByText(/0%/)).toBeNull();
  });

  it("expands and collapses an item's selections", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [storedBet()] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });
    await waitFor(() => expect(rowButton()).toBeTruthy());

    await act(async () => {
      rowButton().click();
    });
    expect(screen.getByText("Over 7.5")).toBeTruthy();
    // Pre-048 and no fixture loaded: the id is the honest answer.
    expect(screen.getByText("Meci #999001")).toBeTruthy();

    await act(async () => {
      rowButton().click();
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
    await waitFor(() => expect(rowButton()).toBeTruthy());

    await act(async () => {
      rowButton().click();
    });

    expect(screen.getByText("Arsenal – Chelsea")).toBeTruthy();
    expect(screen.getByText(/Premier League/)).toBeTruthy();
    expect(screen.queryByText("Meci #999001")).toBeNull();
  });

  it("says what happened, not just that the bet was lost", async () => {
    const base = storedBet();
    const leg = (id: string, status: string) => ({ ...base.selections[0], id, status });
    const lost = storedBet({
      status: "lost",
      settled_total_odds: null,
      selections: [leg("sel-1", "won"), leg("sel-2", "won"), leg("sel-3", "lost")]
    });
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [lost] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });

    // Visible while collapsed: this is the thing the user opened the history for.
    await openAll();
    await waitFor(() => expect(screen.getByText("A picat pe o singură selecție")).toBeTruthy());
    expect(screen.getByText("Selecția care a pierdut biletul")).toBeTruthy();
  });

  it("does not single out a leg of a bet that won", async () => {
    // Three legs, not one: a bet is always 3, 5 or 8, and "toate cele 1
    // selecții" is not a sentence anyone would ship.
    const base = storedBet();
    const leg = (id: string) => ({ ...base.selections[0], id, status: "won" });
    const won = storedBet({ selections: [leg("sel-1"), leg("sel-2"), leg("sel-3")] });
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [won] }));
    await act(async () => {
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
    });
    await waitFor(() => expect(rowButton()).toBeTruthy());

    await act(async () => {
      rowButton().click();
    });

    // Every leg had to land, so naming one would tell a story settlement does
    // not support.
    expect(screen.queryByText("Selecția care a pierdut biletul")).toBeNull();
    expect(screen.getByText("Toate cele 3 selecții au intrat")).toBeTruthy();
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

  describe("kind, not variant", () => {
    // A Combo 5 and Systems 3/5, 4/5 and 5/5 share variant 5. Rendered on the
    // variant alone they are four identical rows for four different tickets.
    it("tells a Combo 5 and the three Systems apart on one day", async () => {
      const day = [
        storedBet({ id: "b-combo", variant: 5, bet_kind: "combo", system_k: null }),
        storedBet({ id: "b-3", variant: 5, bet_kind: "system", system_k: 3 }),
        storedBet({ id: "b-4", variant: 5, bet_kind: "system", system_k: 4 }),
        storedBet({ id: "b-5", variant: 5, bet_kind: "system", system_k: 5 })
      ];
      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: day }));
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);

    // The shape is part of the overview line, readable without opening anything.
    expect(await screen.findByText(/Combo · 5/)).toBeTruthy();
      expect(screen.getByText(/Sistem 3\/5/)).toBeTruthy();
      expect(screen.getByText(/Sistem 4\/5/)).toBeTruthy();
      expect(screen.getByText(/Sistem 5\/5/)).toBeTruthy();
    });

    it("does not present a System's product of odds as the ticket price", async () => {
      // total_odds is the ALL-legs combination, one of C(5,3) = 10.
      fetchWithAuth.mockResolvedValue(
        jsonResponse(200, {
          ok: true,
          bets: [storedBet({ variant: 5, bet_kind: "system", system_k: 3, total_odds: 18.9 })]
        })
      );
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);

      await openAll();
    expect(await screen.findByText(/Cota celor 5/)).toBeTruthy();
      expect(screen.getByText(/Combinații 10/)).toBeTruthy();
      expect(screen.queryByText(/Cotă totală/)).toBeNull();
    });

    it("keeps calling a Combo's product of odds the total odds", async () => {
      fetchWithAuth.mockResolvedValue(
        jsonResponse(200, { ok: true, bets: [storedBet({ bet_kind: "combo", system_k: null })] })
      );
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
      await openAll();
    expect(await screen.findByText(/Cotă totală/)).toBeTruthy();
      expect(screen.queryByText(/Cota celor/)).toBeNull();
    });
  });

  describe("a won ticket is not automatically a profitable one", () => {
    it("warns when a win came back under the stake", async () => {
      // A 3/5 whose three winners were each at 2.00 pays one combination in ten:
      // 0.80 back for every 1.00 staked. Won, and down twenty percent.
      fetchWithAuth.mockResolvedValue(
        jsonResponse(200, {
          ok: true,
          bets: [
            storedBet({
              variant: 5,
              bet_kind: "system",
              system_k: 3,
              status: "won",
              settled_total_odds: 0.8
            })
          ]
        })
      );
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);

      await openAll();
    expect(await screen.findByText(/Returnarea este sub miză/)).toBeTruthy();
      expect(screen.getByText(/0\.80×/)).toBeTruthy();
      expect(screen.getByText(/-20%/)).toBeTruthy();
      // The status word still says WON — the shortfall is stated beside it, not
      // instead of it.
      // Opened: the ticket status and each won leg both read "Câștigat".
      expect(screen.getAllByText("Câștigat").length).toBeGreaterThan(0);
    });

    it("says nothing about a shortfall when the win beat the stake", async () => {
      fetchWithAuth.mockResolvedValue(
        jsonResponse(200, {
          ok: true,
          bets: [
            storedBet({
              variant: 5,
              bet_kind: "system",
              system_k: 4,
              status: "won",
              settled_total_odds: 3.2
            })
          ]
        })
      );
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);

      await openAll();
      expect(await screen.findByText(/3\.20×/)).toBeTruthy();
      expect(screen.getByText(/\+220%/)).toBeTruthy();
      expect(screen.queryByText(/sub miză/)).toBeNull();
    });

    it("reports a lost ticket as no return rather than as a missing figure", async () => {
      fetchWithAuth.mockResolvedValue(
        jsonResponse(200, {
          ok: true,
          bets: [storedBet({ status: "lost", settled_total_odds: null })]
        })
      );
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
      await openAll();
      expect(await screen.findByText(/Fără returnare/)).toBeTruthy();
    });
  });

});
