import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import { ensureCatalog, writeStoredLocale } from "../../i18n";
import GlobalSpecialBetHistory from "./GlobalSpecialBetHistory";

/**
 * The Bilete section: two products, two tabs, two server-filtered lists.
 *
 * What is asserted here is only what the tabs added. The shape and outcome
 * helpers already have their own tests and are not re-tested through the DOM —
 * what matters below is that the right `kind` reaches the server, that a page is
 * never filtered after it arrives, and that one tab can never show the other's
 * rows.
 */

const fetchWithAuth = vi.fn();
vi.mock("../../utils/apiAuth", () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
  authHeaders: async () => ({})
}));

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function bet(overrides: Record<string, unknown> = {}) {
  return {
    id: "bet-1",
    user_id: "user-1",
    bet_date: "2026-08-10",
    league_ids: [39],
    league_scope: "39",
    variant: 5,
    bet_kind: "combo",
    system_k: null,
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
        fixture_label: "Arsenal – Chelsea",
        league_name: "Premier League",
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

const system = (k: number, extra: Record<string, unknown> = {}) =>
  bet({ id: `sys-${k}`, bet_kind: "system", system_k: k, variant: 5, total_odds: 18.9, ...extra });

/** A full page — the only thing that makes the hook report hasMore. */
const fullPage = (kind: "combo" | "system") =>
  Array.from({ length: 10 }, (_, i) =>
    kind === "combo" ? bet({ id: `c-${i}` }) : system(3, { id: `s-${i}` })
  );

/** Every URL the component has asked for, in order. */
const urls = () => fetchWithAuth.mock.calls.map((c) => String(c[0]));
const lastUrl = () => urls()[urls().length - 1];

async function renderTickets() {
  await act(async () => {
    render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);
  });
}

const systemTab = () => screen.getByRole("tab", { name: "Sistem" });
const comboTab = () => screen.getByRole("tab", { name: "Combo" });

async function openSystemTab() {
  await act(async () => {
    fireEvent.click(systemTab());
  });
}

describe("Bilete — Combo and Sistem", () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
    fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [] }));
  });
  afterEach(cleanup);

  describe("the kind reaches the server, and the page is never filtered after it arrives", () => {
    it("opens on Combo and asks the server for combos only", async () => {
      await renderTickets();
      expect(lastUrl()).toContain("kind=combo");
      expect(lastUrl()).not.toContain("kind=system");
      expect(comboTab().getAttribute("aria-selected")).toBe("true");
    });

    it("asks the server for systems when the Sistem tab is chosen", async () => {
      await renderTickets();
      await openSystemTab();
      await waitFor(() => expect(lastUrl()).toContain("kind=system"));
      expect(systemTab().getAttribute("aria-selected")).toBe("true");
    });

    it("re-queries rather than reusing the page it already had", async () => {
      // The proof that no client-side filtering is happening: a tab switch is a
      // new request, so the second list cannot be a subset of the first.
      await renderTickets();
      const before = fetchWithAuth.mock.calls.length;
      await openSystemTab();
      await waitFor(() => expect(fetchWithAuth.mock.calls.length).toBeGreaterThan(before));
    });

    it("only ever reads — no request carries a body or a write method", async () => {
      await renderTickets();
      await openSystemTab();
      for (const call of fetchWithAuth.mock.calls) {
        expect(String(call[0])).toContain("/api/special-bets");
        // The service calls fetchWithAuth(url) with no init at all; a System can
        // be created by the backend but is unreachable from here.
        expect(call[1]).toBeUndefined();
      }
    });
  });

  describe("each tab shows its own product and nothing else", () => {
    it("shows the combos the server returned, and no system row", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [bet()] }));
      await renderTickets();
      expect(await screen.findByText(/Combo · 5/)).toBeTruthy();
      expect(screen.queryByText(/Sistem \d/)).toBeNull();
    });

    it("shows the systems the server returned, and no combo row", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [system(4)] }));
      await renderTickets();
      await openSystemTab();
      expect(await screen.findByText(/Sistem 4\/5/)).toBeTruthy();
      expect(screen.queryByText(/Combo ·/)).toBeNull();
    });

    it("drops the previous tab's rows entirely when the kind changes", async () => {
      fetchWithAuth.mockResolvedValueOnce(jsonResponse(200, { ok: true, bets: [bet({ id: "only-combo" })] }));
      await renderTickets();
      await screen.findByText(/Combo · 5/);

      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [system(5)] }));
      await openSystemTab();

      expect(await screen.findByText(/Sistem 5\/5/)).toBeTruthy();
      // Not hidden — gone. The old list is unmounted, so a stale combo cannot be
      // read under the Sistem heading.
      expect(screen.queryByText(/Combo · 5/)).toBeNull();
    });
  });

  describe("a System says how many combinations it covers", () => {
    it("states 10, 5 and 1 for 3/5, 4/5 and 5/5", async () => {
      fetchWithAuth.mockResolvedValue(
        jsonResponse(200, { ok: true, bets: [system(3), system(4), system(5)] })
      );
      await renderTickets();
      await openSystemTab();

      expect(await screen.findByText(/Sistem 3\/5/)).toBeTruthy();
      expect(screen.getByText(/Combinații 10/)).toBeTruthy();
      expect(screen.getByText(/Combinații 5$/)).toBeTruthy();
      expect(screen.getByText(/Combinații 1$/)).toBeTruthy();
    });

    it("never calls a System's product of odds the ticket price", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [system(3)] }));
      await renderTickets();
      await openSystemTab();

      expect(await screen.findByText(/Cota celor 5/)).toBeTruthy();
      expect(screen.queryByText(/Cotă totală/)).toBeNull();
    });

    it("keeps calling a Combo's odds the ticket odds", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [bet()] }));
      await renderTickets();
      expect(await screen.findByText(/Cotă totală/)).toBeTruthy();
      expect(screen.queryByText(/Cota celor/)).toBeNull();
    });
  });

  describe("pagination belongs to the tab, not to the section", () => {
    it("pages the combos without ever dropping the kind", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: fullPage("combo") }));
      await renderTickets();

      const more = await screen.findByRole("button", { name: "Încarcă mai multe" });
      await act(async () => {
        fireEvent.click(more);
      });

      await waitFor(() => expect(lastUrl()).toContain("offset=10"));
      expect(lastUrl()).toContain("kind=combo");
    });

    it("starts the systems at the first page even after the combos were paged", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: fullPage("combo") }));
      await renderTickets();
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Încarcă mai multe" }));
      });
      await waitFor(() => expect(lastUrl()).toContain("offset=10"));

      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: fullPage("system") }));
      await openSystemTab();

      await waitFor(() => expect(lastUrl()).toContain("kind=system"));
      expect(lastUrl()).toContain("offset=0");
    });

    it("offers no Load more when the page came back short", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [system(3)] }));
      await renderTickets();
      await openSystemTab();

      await screen.findByText(/Sistem 3\/5/);
      expect(screen.queryByRole("button", { name: "Încarcă mai multe" })).toBeNull();
    });
  });

  describe("empty, loading and failure are answered per product", () => {
    it("says there is no Combo yet", async () => {
      await renderTickets();
      expect(await screen.findByText("Nu ai încă niciun bilet Combo salvat.")).toBeTruthy();
    });

    it("says there is no Sistem yet", async () => {
      await renderTickets();
      await openSystemTab();
      expect(await screen.findByText("Nu ai încă niciun bilet Sistem salvat.")).toBeTruthy();
    });

    it("announces loading while the first page is in flight", async () => {
      let resolve: (v: unknown) => void = () => {};
      fetchWithAuth.mockReturnValue(new Promise((r) => (resolve = r)));
      render(<GlobalSpecialBetHistory canUseGlobalSpecialBet />);

      expect(await screen.findByRole("status")).toBeTruthy();
      await act(async () => {
        resolve(jsonResponse(200, { ok: true, bets: [] }));
      });
      await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    });

    it("retries the failed tab with that tab's own kind", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(500, { ok: false, error: "boom" }));
      await renderTickets();
      await openSystemTab();

      await screen.findByRole("alert");
      const retry = screen.getByRole("button", { name: "Reîncearcă" });
      await act(async () => {
        fireEvent.click(retry);
      });

      await waitFor(() => expect(lastUrl()).toContain("kind=system"));
    });
  });

  describe("copy and layout", () => {
    it("renders the section in English when the locale is English", async () => {
      writeStoredLocale("en");
      await ensureCatalog("en");
      fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets: [] }));
      await act(async () => {
        render(
          <LocaleProvider>
            <GlobalSpecialBetHistory canUseGlobalSpecialBet />
          </LocaleProvider>
        );
      });

      expect(await screen.findByText("Tickets")).toBeTruthy();
      expect(screen.getByRole("tab", { name: "System" })).toBeTruthy();
      expect(await screen.findByText("You have no saved Combo ticket yet.")).toBeTruthy();
      writeStoredLocale("ro");
    });

    it("puts the two tabs in a scrollable strip so a narrow screen never stacks them", async () => {
      await renderTickets();
      const tablist = screen.getByRole("tablist");
      // jsdom has no layout engine, so overflow cannot be measured here; what is
      // asserted is that the strip is a single scrolling row of non-shrinking
      // tabs, which is the mechanism that keeps it on one line.
      expect(tablist.className).toContain("overflow-x-auto");
      expect(screen.getAllByRole("tab")).toHaveLength(2);
      for (const tab of screen.getAllByRole("tab")) {
        expect(tab.className).toContain("shrink-0");
      }
    });
  });
});
