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

/**
 * What the server returns for a Bilet Sistem: ONE ticket, five legs, k = 3.
 *
 * `total_odds` is 1.8^5 = 18.896 — the product of all five odds, which is the
 * price of the single all-legs combination and NOT what the ticket pays. At
 * k = 3 the stake is split across C(5,3) = 10 combinations, so five winners
 * return 6.83×.
 */
const SYSTEM_BODY = {
  ok: true,
  created: true,
  bet: {
    ...READY_BODY.bet,
    id: "bet-sys",
    variant: 5,
    bet_kind: "system",
    system_k: 3,
    total_odds: 18.896,
    ticket_probability: 0.8369
  },
  selections: [
    selection({ id: "s1", fixture_id: 999001 }),
    selection({ id: "s2", fixture_id: 999002 }),
    selection({ id: "s3", fixture_id: 999003 }),
    selection({ id: "s4", fixture_id: 999004 }),
    selection({ id: "s5", fixture_id: 999005 })
  ]
};

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

  it("offers the three Combo sizes and the System, with Combo 3 selected", () => {
    // Was three options under "Numărul de selecții". The group now chooses a
    // PRODUCT: the same three combos, plus one System. There is deliberately no
    // 3/5–4/5–5/5 choice — the public System is 3/5 and the server fixes it.
    renderSection();
    const group = screen.getByRole("group", { name: "Tipul biletului" });
    const options = group.querySelectorAll("button");
    expect(options).toHaveLength(4);
    expect([...options].map((b) => b.textContent)).toEqual([
      "3 selecții",
      "5 selecții",
      "8 selecții",
      "Bilet Sistem"
    ]);
    expect(options[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("offers no k selector anywhere", () => {
    renderSection();
    for (const label of [/3\/5/, /4\/5/, /5\/5/, /system_k/i]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });

  it("keeps the product selector thumb-sized and wrappable at 390px", () => {
    // jsdom has no layout, so the responsive decision is asserted where it is
    // actually made: a wrapping row of touch-target-sized options, which is what
    // stops the selector overflowing a 390px viewport.
    renderSection();
    const group = screen.getByRole("group", { name: "Tipul biletului" });
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
    expect(screen.getByText("Îți construim biletul…")).toBeTruthy();
    // The variant selector locks too, so a switch mid-flight cannot desync the answer.
    expect(screen.getByRole("button", { name: "5 selecții" }).hasAttribute("disabled")).toBe(true);

    await act(async () => {
      release(jsonResponse(201, READY_BODY));
    });
    await waitFor(() => expect(screen.queryByText("Îți construim biletul…")).toBeNull());
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
    expect(screen.getAllByText("În așteptare").length).toBeGreaterThan(0);

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
    // Confidence is secondary metadata now: a hint under the headline metric,
    // never a tile of its own and never named as the ticket's chance.
    expect(screen.getByText(/Încredere medie: 78%/)).toBeTruthy();
    expect(screen.queryByText("Încredere medie")).toBeNull();
    // settled_total_odds is null while pending — no hint, and certainly no 0.00.
    expect(screen.queryByText(/Cotă la decontare/)).toBeNull();
  });

  it("legacy snapshot: ticket chance reads as a dash — no 0%, no disclaimer, no crash", async () => {
    // READY_BODY predates migration 050: no ticket_probability, no per-leg
    // probability. The card must stay honest rather than inventing numbers.
    fetchWithAuth.mockResolvedValue(jsonResponse(201, READY_BODY));
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });

    await waitFor(() => expect(screen.getByText("Șansă estimată bilet")).toBeTruthy());
    const tile = screen.getByText("Șansă estimată bilet").parentElement;
    expect(tile?.textContent).toContain("—");
    expect(screen.queryByText(/independența selecțiilor/)).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("shows the STORED ticket probability with its disclaimer, and per-leg probability", async () => {
    fetchWithAuth.mockResolvedValue(
      jsonResponse(201, {
        ...READY_BODY,
        bet: { ...READY_BODY.bet, ticket_probability: 0.3256 },
        selections: [
          selection({ probability: 0.83 }),
          selection({ id: "sel-2", fixture_id: 999002, probability: 0.81, odds: 1.9 }),
          selection({ id: "sel-3", fixture_id: 999003, probability: 0.77, odds: 1.75 })
        ]
      })
    );
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });

    // The headline is the persisted product — not confidence, not a client-side
    // recomputation (0.83 × 0.81 × 0.77 would be 52%, and must NOT appear).
    await waitFor(() => expect(screen.getByText("33%")).toBeTruthy());
    expect(screen.queryByText("52%")).toBeNull();
    expect(screen.getByText("Pe baza probabilităților modelului; presupune independența selecțiilor.")).toBeTruthy();
    // Every leg names its own probability, so 83% cannot read as the ticket's.
    expect(screen.getByText("83%")).toBeTruthy();
    expect(screen.getByText("81%")).toBeTruthy();
    expect(screen.getByText("77%")).toBeTruthy();
    expect(screen.getAllByText("Probabilitate").length).toBe(3);
    // The descriptive aria names both the number and the assumption.
    expect(
      screen.getByRole("group", {
        name: "Șansă estimată bilet: 33 la sută. Pe baza probabilităților modelului; presupune independența selecțiilor."
      })
    ).toBeTruthy();
  });

  it("each variant shows its own stored ticket probability, never the previous one", async () => {
    fetchWithAuth.mockResolvedValueOnce(
      jsonResponse(201, { ...READY_BODY, bet: { ...READY_BODY.bet, ticket_probability: 0.5 } })
    );
    renderSection();

    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });
    await waitFor(() => expect(screen.getByText("50%")).toBeTruthy());

    // Variant 5 is a different snapshot with a different stored product.
    fetchWithAuth.mockResolvedValueOnce(
      jsonResponse(201, {
        ...READY_BODY,
        bet: { ...READY_BODY.bet, id: "bet-5", variant: 5, ticket_probability: 0.33 }
      })
    );
    await act(async () => {
      screen.getByRole("button", { name: "5 selecții" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });

    await waitFor(() => expect(screen.getByText("33%")).toBeTruthy());
    expect(screen.queryByText("50%")).toBeNull();
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
    // No snapshot exists, so no ticket probability may be shown for it.
    expect(screen.queryByText("Șansă estimată bilet")).toBeNull();
  });

  it("speaks probability vocabulary in both locales, and never as confidence", async () => {
    const { en } = await import("../../i18n/en");
    const { ro } = await import("../../i18n/ro");
    const gsbEn = (en as Record<string, Record<string, string>>).gsb;
    const gsbRo = (ro as Record<string, Record<string, string>>).gsb;

    expect(gsbEn.ticketChance).toBe("Estimated ticket chance");
    expect(gsbRo.ticketChance).toBe("Șansă estimată bilet");
    expect(gsbEn.ticketChanceDisclaimer).toBe("Based on model probabilities; assumes independent selections.");
    expect(gsbRo.ticketChanceDisclaimer).toBe(
      "Pe baza probabilităților modelului; presupune independența selecțiilor."
    );
    expect(gsbEn.probability).toBe("Probability");
    expect(gsbRo.probability).toBe("Probabilitate");
    // Probability is not confidence in either language.
    expect(gsbEn.probability).not.toBe(gsbEn.confidence);
    expect(gsbRo.probability).not.toBe(gsbRo.confidence);
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

  /**
   * Increment 050 — a bet that is still running should say where it stands.
   *
   * The clock is stubbed rather than faked with timers: the component samples
   * Date.now() once per state change, and fake timers would also swallow the
   * promise scheduling these tests rely on.
   */
  describe("while the bet is running", () => {
    const NOON = Date.parse("2026-08-11T12:00:00.000Z");

    function runningBody(selections: Record<string, unknown>[]) {
      return { ...READY_BODY, selections };
    }

    beforeEach(() => {
      vi.spyOn(Date, "now").mockReturnValue(NOON);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function generate(body: unknown) {
      fetchWithAuth.mockResolvedValue(jsonResponse(201, body));
      renderSection();
      await act(async () => {
        screen.getByRole("button", { name: "Generează" }).click();
      });
    }

    it("says what has landed and which match comes next", async () => {
      await generate(
        runningBody([
          selection({ id: "sel-1", fixture_id: 999001, kickoff_at: "2026-08-11T19:00:00.000Z" }),
          selection({ id: "sel-2", fixture_id: 999002, kickoff_at: "2026-08-11T11:00:00.000Z" }),
          selection({ id: "sel-3", fixture_id: 999003, kickoff_at: "2026-08-11T09:00:00.000Z", status: "won" })
        ])
      );

      await waitFor(() => expect(screen.getByText("1 din 3 au intrat · 2 încă în joc")).toBeTruthy());
      // The next leg is the earliest one still to come — not the first stored.
      expect(screen.getByText(/Urmează Arsenal – Chelsea/)).toBeTruthy();
    });

    it("marks the leg being played right now, and only that one", async () => {
      await generate(
        runningBody([
          selection({ id: "sel-1", fixture_id: 999001, kickoff_at: "2026-08-11T19:00:00.000Z" }),
          selection({ id: "sel-2", fixture_id: 999002, kickoff_at: "2026-08-11T11:00:00.000Z" }),
          selection({ id: "sel-3", fixture_id: 999003, kickoff_at: "2026-08-11T09:00:00.000Z", status: "won" })
        ])
      );

      await waitFor(() => expect(screen.getAllByText("Se joacă acum")).toHaveLength(1));
      // A graded leg is settled however long ago it kicked off, so the marker
      // belongs to the started-but-ungraded one.
      const marker = screen.getByText("Se joacă acum").closest("li");
      expect(marker?.textContent).toContain("Betis – Sevilla");
    });

    it("lists the legs in kickoff order, so the live one is not buried last", async () => {
      await generate(
        runningBody([
          selection({ id: "sel-1", fixture_id: 999001, kickoff_at: "2026-08-11T19:00:00.000Z" }),
          selection({ id: "sel-2", fixture_id: 999002, kickoff_at: "2026-08-11T11:00:00.000Z" })
        ])
      );

      await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
      const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(rows[0]).toContain("Betis – Sevilla");
      expect(rows[1]).toContain("Arsenal – Chelsea");
    });

    it("stops promising a next match once every leg has started", async () => {
      await generate(
        runningBody([
          selection({ id: "sel-1", fixture_id: 999001, kickoff_at: "2026-08-11T10:00:00.000Z" }),
          selection({ id: "sel-2", fixture_id: 999002, kickoff_at: "2026-08-11T11:00:00.000Z" })
        ])
      );

      await waitFor(() => expect(screen.getByText("Toate meciurile rămase au început")).toBeTruthy());
      expect(screen.queryByText(/Urmează/)).toBeNull();
    });
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
    expect(onUpgradeRequired).toHaveBeenCalledWith("Bilete", "ultra");
  });

  describe("Bilet Sistem", () => {
    /** Pick the System, then build it. The user's whole interaction. */
    async function pickSystemAndGenerate() {
      await act(async () => {
        screen.getByRole("button", { name: "Bilet Sistem" }).click();
      });
      await act(async () => {
        screen.getByRole("button", { name: /Generează|Regenerează/ }).click();
      });
    }

    it("asks the server for a System, and sends no k", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(201, READY_BODY));
      renderSection();

      await act(async () => {
        screen.getByRole("button", { name: "Bilet Sistem" }).click();
      });
      await act(async () => {
        screen.getByRole("button", { name: /Generează|Regenerează/ }).click();
      });

      const [url, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/special-bets");
      const body = JSON.parse(String(init.body));
      expect(body.bet_kind).toBe("system");
      expect(body.variant).toBe(5);
      // The product is 3/5 and the server decides that. The UI has no k to send
      // and no control that could produce one.
      expect(Object.keys(body)).not.toContain("system_k");
      expect(Object.keys(body)).not.toContain("systemK");
    });

    it("names the product it just created, with its combination count", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(201, SYSTEM_BODY));
      renderSection();
      await pickSystemAndGenerate();

      expect(await screen.findByText(/Sistem 3\/5/)).toBeTruthy();
      expect(screen.getByText(/Combinații 10/)).toBeTruthy();
    });

    it("calls the product of the five odds what it is, never the ticket price", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(201, SYSTEM_BODY));
      renderSection();
      await pickSystemAndGenerate();

      // 18.90 is one all-legs combination, not the payout: ten combinations
      // share the stake, so five winners return 6.83×. Labelling it "Cotă
      // totală" promised nearly four times what the ticket can pay.
      expect(await screen.findByText("Cota celor 5")).toBeTruthy();
      expect(screen.queryByText("Cotă totală")).toBeNull();
    });

    it("keeps calling a Combo's odds the total odds", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(201, READY_BODY));
      renderSection();
      await act(async () => {
        screen.getByRole("button", { name: /Generează/ }).click();
      });

      expect(await screen.findByText("Cotă totală")).toBeTruthy();
      expect(screen.queryByText(/Cota celor/)).toBeNull();
      // A combo names no combination count: it has exactly one.
      expect(screen.queryByText(/Combinații/)).toBeNull();
    });

    it("explains the product as soon as it is selected, before anything is built", async () => {
      renderSection();
      expect(screen.queryByText("5 selecții · câștigi cu minimum 3 corecte")).toBeNull();

      await act(async () => {
        screen.getByRole("button", { name: "Bilet Sistem" }).click();
      });
      expect(screen.getByText("5 selecții · câștigi cu minimum 3 corecte")).toBeTruthy();

      // And it belongs to the System alone.
      await act(async () => {
        screen.getByRole("button", { name: "5 selecții" }).click();
      });
      expect(screen.queryByText("5 selecții · câștigi cu minimum 3 corecte")).toBeNull();
    });

    it("shows ONE ticket with five selections, never three", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(201, SYSTEM_BODY));
      const { container } = renderSection();
      await pickSystemAndGenerate();

      await screen.findByText(/Sistem 3\/5/);
      expect(screen.getAllByText(/Sistem \d\/5/)).toHaveLength(1);
      expect(screen.queryByText(/Sistem 4\/5/)).toBeNull();
      expect(screen.queryByText(/Sistem 5\/5/)).toBeNull();
      expect(container.querySelectorAll("ul > li")).toHaveLength(5);
    });

    it("selecting the System does not disturb the Combo the user already built", async () => {
      fetchWithAuth.mockResolvedValue(jsonResponse(201, READY_BODY));
      renderSection();

      await act(async () => {
        screen.getByRole("button", { name: "5 selecții" }).click();
      });
      await act(async () => {
        screen.getByRole("button", { name: /Generează/ }).click();
      });
      const callsAfterCombo = fetchWithAuth.mock.calls.length;

      // Switching to the System shows an untouched product, not the combo's
      // snapshot — the two are keyed apart even though both are variant 5.
      await act(async () => {
        screen.getByRole("button", { name: "Bilet Sistem" }).click();
      });
      expect(fetchWithAuth.mock.calls.length).toBe(callsAfterCombo);
      expect(screen.getByRole("button", { name: "Bilet Sistem" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "5 selecții" }).getAttribute("aria-pressed")).toBe("false");
    });
  });

  // ── Generation feedback: a selected league whose day is over added nothing ──
  const summary = (affected: number[], names: Record<string, string>) => ({
    selectedLeagueIds: [39, 135, 61],
    eligibleLeagueIds: [39],
    noEligibleLeagueIds: [135, 61],
    noEligibleBecauseAlreadyStartedLeagueIds: affected,
    names
  });
  const generate = async (body: unknown) => {
    fetchWithAuth.mockResolvedValue(jsonResponse(201, body));
    renderSection();
    await act(async () => {
      screen.getByRole("button", { name: "Generează" }).click();
    });
  };
  const warning = () => screen.queryByTestId("gsb-exhausted-leagues");

  it("feedback 1: no affected league → no warning (and no warning when the server sends no summary at all)", async () => {
    await generate({ ...READY_BODY, leagueSummary: summary([], { 135: "Serie A" }) });
    expect(warning()).toBeNull();
    cleanup();
    await generate(READY_BODY);
    expect(warning()).toBeNull();
  });

  it("feedback 2/3: one affected league, named — shown beneath the still-successful ticket, as a status, not an alert", async () => {
    await generate({ ...READY_BODY, leagueSummary: summary([135], { 135: "Serie A", 39: "Premier League" }) });
    const w = warning()!;
    expect(w).toBeTruthy();
    expect(w.textContent).toContain("Serie A nu mai are meciuri disponibile pentru această generare");
    expect(w.textContent).toContain("Meciurile de azi au început deja");
    expect(w.querySelector("[role='status']")).toBeTruthy();
    expect(w.querySelector("[role='alert']")).toBeNull();
    // The ticket is still the primary content and precedes the warning.
    const builder = screen.getByTestId("ticket-builder");
    expect(builder.textContent).toMatch(/4[.,]81/);
    expect(builder.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Regenerează" })).toBeTruthy();
  });

  it("feedback 3b: several affected leagues are listed with the locale's conjunction", async () => {
    await generate({ ...READY_BODY, leagueSummary: summary([135, 61], { 135: "Serie A", 61: "Ligue 1" }) });
    expect(warning()!.textContent).toMatch(/Serie A și Ligue 1 nu mai au meciuri disponibile/);
  });

  it("feedback 4: a missing name falls back to the generic sentence — never an id", async () => {
    await generate({ ...READY_BODY, leagueSummary: summary([135, 61], { 135: "Serie A" }) });
    const text = warning()!.textContent || "";
    expect(text).toContain("Unele ligi selectate nu mai au meciuri disponibile pentru această generare");
    expect(text).not.toMatch(/\b135\b|\b61\b/);
    expect(text).not.toContain("Serie A nu mai");
  });

  it("feedback 5: the warning never appears on an unavailable generation", async () => {
    await generate({ ok: true, created: false, available: false, variant: 3, required: 3, availableCandidates: 0, leagueSummary: summary([135, 61], { 135: "Serie A" }) });
    expect(warning()).toBeNull();
    expect(screen.getByTestId("ticket-builder").textContent).toMatch(/indisponibil|Indisponibil|disponibil/i);
  });

  it("feedback 6: an identical-looking ticket is still rendered as created — nothing is suppressed or deduplicated", async () => {
    await generate({ ...READY_BODY, created: true, leagueSummary: summary([135], { 135: "Serie A" }) });
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ticket-builder").textContent).toMatch(/4[.,]81/);
    expect(warning()).toBeTruthy();
  });

  it("feedback 7: mobile — the warning is a block inside the card, no fixed/absolute positioning, no nowrap", async () => {
    await generate({ ...READY_BODY, leagueSummary: summary([135, 61], { 135: "Serie A", 61: "Ligue 1 Uber Eats Championnat de France" }) });
    const w = warning()!;
    expect(w.className).not.toMatch(/fixed|absolute/);
    expect([...w.querySelectorAll("*")].some((el) => /whitespace-nowrap/.test((el as HTMLElement).className))).toBe(false);
    expect(screen.getByTestId("ticket-builder").contains(w)).toBe(true);
  });
});
