import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalSpecialBetSection from "./GlobalSpecialBetSection";
import { buildFixtureLabelIndex } from "../../utils/globalSpecialBetView";

const fetchWithAuth = vi.fn();
vi.mock("../../utils/apiAuth", () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
  authHeaders: async () => ({})
}));

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function selection(overrides: Record<string, unknown> = {}) {
  return {
    id: "sel-1",
    special_bet_id: "bet-1",
    fixture_id: 999001,
    league_id: 39,
    kickoff_at: "2026-08-11T18:30:00.000Z",
    market: "corners",
    selection: "Over 7.5",
    side: "over",
    line: 7.5,
    odds: 1.32,
    confidence: 82,
    value_score: 12.4,
    status: "pending",
    settled_at: null,
    ...overrides
  };
}

const READY_BODY = {
  ok: true,
  created: true,
  bet: {
    id: "bet-1",
    user_id: "user-1",
    bet_date: "2026-08-11",
    league_ids: [39],
    league_scope: "39",
    variant: 3,
    status: "pending",
    total_odds: 4.81,
    average_confidence: 78,
    model_version: "v3",
    created_at: "2026-08-11T09:00:00.000Z",
    settled_at: null,
    settled_total_odds: null
  },
  selections: [
    selection(),
    selection({ id: "sel-2", fixture_id: 999002, market: "1x2", selection: "1", status: "won", odds: 1.9 }),
    selection({ id: "sel-3", fixture_id: 999003, market: "btts", selection: "GG", status: "void", odds: 1.75 })
  ]
};

const fixtureIndex = buildFixtureLabelIndex([
  [
    { id: 999001, league: "Premier League", teams: { home: "Arsenal", away: "Chelsea" } },
    { id: 999002, league: "La Liga", teams: { home: "Betis", away: "Sevilla" } }
  ]
]);

function renderSection(props: Record<string, unknown> = {}) {
  return render(
    <GlobalSpecialBetSection
      betDate="2026-08-11"
      favoriteLeagueIds={[39, 140]}
      fixtureIndex={fixtureIndex}
      canUseGlobalSpecialBet
      {...props}
    />
  );
}

describe("GlobalSpecialBetSection", () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
  });
  afterEach(cleanup);

  it("offers exactly the three server-built variants, with 3 selected", () => {
    renderSection();
    const group = screen.getByRole("group", { name: "Numărul de selecții" });
    const options = group.querySelectorAll("button");
    expect(options).toHaveLength(3);
    expect([...options].map((b) => b.textContent)).toEqual(["3 selecții", "5 selecții", "8 selecții"]);
    expect(options[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the variant selector thumb-sized and wrappable at 390px", () => {
    // jsdom has no layout, so the responsive decision is asserted where it is
    // actually made: a wrapping row of touch-target-sized options, which is what
    // stops the selector overflowing a 390px viewport.
    renderSection();
    const group = screen.getByRole("group", { name: "Numărul de selecții" });
    expect(group.className).toContain("flex-wrap");
    for (const option of group.querySelectorAll("button")) {
      expect(option.className).toContain("min-h-[var(--fp-touch)]");
    }
  });

  it("asks the server for the variant the user picked", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(201, READY_BODY));
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "8 selecții" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });

    const [, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).variant).toBe(8);
  });

  it("shows a loading state instead of an empty card while generating", async () => {
    let release: (value: unknown) => void = () => {};
    fetchWithAuth.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });
    expect(screen.getByText("Îți construim Global Special Bet…")).toBeTruthy();
    // The variant selector locks too, so a switch mid-flight cannot desync the answer.
    expect(screen.getByRole("button", { name: "5 selecții" }).hasAttribute("disabled")).toBe(true);

    await act(async () => {
      release(jsonResponse(201, READY_BODY));
    });
    await waitFor(() => expect(screen.queryByText("Îți construim Global Special Bet…")).toBeNull());
  });

  it("renders each selection with its own status, and falls back to the id it cannot name", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(201, READY_BODY));
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });

    await waitFor(() => expect(screen.getByText("Arsenal – Chelsea")).toBeTruthy());
    expect(screen.getByText("Betis – Sevilla")).toBeTruthy();
    // Not in the index: falls back to the id rather than inventing a name.
    expect(screen.getByText("Meci #999003")).toBeTruthy();

    expect(screen.getAllByText("Câștigat").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Anulat").length).toBeGreaterThan(0);
    expect(screen.getAllByText("În desfășurare").length).toBeGreaterThan(0);

    expect(screen.getByText("Over 7.5")).toBeTruthy();
    expect(screen.getByText("Cornere")).toBeTruthy();
  });

  it("summarises the bet from the snapshot and withholds a settled odd the API did not send", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(201, READY_BODY));
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });

    await waitFor(() => expect(screen.getByText("4.81")).toBeTruthy());
    expect(screen.getByText("78%")).toBeTruthy();
    // settled_total_odds is null while pending — no hint, and certainly no 0.00.
    expect(screen.queryByText(/Cotă la decontare/)).toBeNull();
  });

  it("states an unavailable variant explicitly and never pads it", async () => {
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
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });

    await waitFor(() =>
      expect(screen.getByText("Nu sunt suficiente selecții eligibile pentru această variantă.")).toBeTruthy()
    );
    expect(screen.getByText("6 din 8 selecții eligibile disponibile")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the server's own reason on failure, with no retry where retrying cannot help", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(403, { ok: false, error: "Ligi în afara favoritelor: 61." }));
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Ligi în afara favoritelor: 61.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reîncearcă" })).toBeNull();
  });

  it("offers a retry on a server failure", async () => {
    fetchWithAuth.mockResolvedValue(jsonResponse(500, { ok: false, error: "boom" }));
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Reîncearcă" })).toBeTruthy());
  });

  it("explains the missing prerequisite when the user follows no leagues", () => {
    renderSection({ favoriteLeagueIds: [] });
    expect(screen.getByText("Nicio ligă favorită")).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("fails closed and reuses the existing upgrade prompt when access is withheld", () => {
    const onUpgradeRequired = vi.fn();
    render(
      <GlobalSpecialBetSection
        betDate="2026-08-11"
        favoriteLeagueIds={[39]}
        onUpgradeRequired={onUpgradeRequired}
      />
    );
    expect(screen.queryByRole("group")).toBeNull();
    screen.getByRole("button", { name: /Deblochează/ }).click();
    expect(onUpgradeRequired).toHaveBeenCalledWith("Global Special Bet", "ultra");
  });
});
