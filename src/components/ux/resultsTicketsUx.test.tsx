import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HistorySection from "./HistorySection";
import GlobalSpecialBetHistory from "./GlobalSpecialBetHistory";
import { LocaleProvider } from "../../context/LocaleContext";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { HistoryEntry } from "../../types";

/**
 * Results + Tickets UX simplification.
 *
 * Results: the day's rows run EARLIEST → LATEST on the normalised kick-off
 * instant, whatever the filter, the state or the day.
 *
 * Tickets: the compact row is a two-line overview — number · built-at | status,
 * then shape · legs · odds — with everything else behind the disclosure. The
 * status is icon + text in the shared status language, announced once.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`(${esc(E[ns][key])}|${esc(R[ns][key])})`);

const fetchWithAuth = vi.fn();
vi.mock("../../utils/apiAuth", () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
  authHeaders: async () => ({})
}));
vi.mock("./GlobalSpecialBetSection", () => ({ default: () => null }));
vi.mock("./CalibrationChart", () => ({ default: () => null }));
vi.mock("./HistoryTrustSection", () => ({ default: () => null }));
vi.mock("../TrackRecordSection", () => ({ default: () => null }));

afterEach(cleanup);
beforeEach(() => fetchWithAuth.mockReset());

// ── Results ───────────────────────────────────────────────────────────────

const TODAY = "2026-08-22";
function entry(id: number, home: string, kickoff: string, validation: string, status?: string): HistoryEntry {
  const pending = validation === "pending";
  return {
    id,
    leagueId: 39,
    league: "Premier League",
    teams: { home, away: `${home} Away` },
    kickoff,
    status: status ?? (pending ? "NS" : "FT"),
    score: pending ? { home: null, away: null } : { home: 2, away: 1 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 70, odd: 1.9 },
    validation,
    savedAt: kickoff
  } as unknown as HistoryEntry;
}
const homes = () => [...document.querySelectorAll("li[data-match-row]")].map((li) => li.querySelector("[data-slot='home']")?.textContent);
const btn = (key: string) => {
  // Scope to the controls: row buttons also carry outcome words in their names.
  const scope = (document.querySelector('[data-testid="results-controls"]') as HTMLElement | null) ?? document.body;
  const all = [...scope.querySelectorAll<HTMLButtonElement>("button")];
  const match = all.find((b) => either("history", key).test(b.textContent || "") || either("history", key).test(b.getAttribute("aria-label") || ""));
  if (match) return match;
  return screen.getByRole("button", { name: either("history", key) }) as HTMLButtonElement;
};

/** Five kick-offs handed over in a deliberately scrambled order. */
const DAY = [
  entry(3, "C-1800", `${TODAY}T18:00:00+03:00`, "win"),
  entry(1, "A-1400", `${TODAY}T14:00:00+03:00`, "loss"),
  entry(5, "E-2200", `${TODAY}T22:00:00+03:00`, "pending"),
  entry(2, "B-1630", `${TODAY}T16:30:00+03:00`, "win"),
  entry(4, "D-2030", `${TODAY}T20:30:00+03:00`, "push")
];

describe("Results · chronological order", () => {
  it("1/2. five fixtures render earliest → latest, never the reversed order", () => {
    render(<HistorySection history={DAY} today={TODAY} onOpenMatch={vi.fn()} />);
    expect(homes()).toEqual(["A-1400", "B-1630", "C-1800", "D-2030", "E-2200"]);
    expect(homes()).not.toEqual([...homes()].reverse());
  });

  it("3/7. multi-day history stays globally ascending on every day the navigation shows", () => {
    const history = [
      ...DAY,
      entry(11, "Y-2045", "2026-08-21T20:45:00+03:00", "win"),
      entry(10, "Y-1200", "2026-08-21T12:00:00+03:00", "loss"),
      entry(20, "X-1600", "2026-08-20T16:00:00+03:00", "win")
    ];
    render(<HistorySection history={history} today={TODAY} onOpenMatch={vi.fn()} />);
    expect(homes()).toEqual(["A-1400", "B-1630", "C-1800", "D-2030", "E-2200"]);
    fireEvent.click(btn("dayPrev"));
    expect(homes()).toEqual(["Y-1200", "Y-2045"]);
    fireEvent.click(btn("dayPrev"));
    expect(homes()).toEqual(["X-1600"]);
    fireEvent.click(btn("dayToday"));
    expect(homes()).toEqual(["A-1400", "B-1630", "C-1800", "D-2030", "E-2200"]);
  });

  it("4. filtering keeps the ascending order", () => {
    render(<HistorySection history={DAY} today={TODAY} onOpenMatch={vi.fn()} />);
    fireEvent.click(btn("win"));
    expect(homes()).toEqual(["B-1630", "C-1800"]);
    fireEvent.click(btn("pendingBadge"));
    expect(homes()).toEqual(["E-2200"]);
  });

  it("5. equal kick-offs keep their incoming order (stable sort)", () => {
    const same = [
      entry(1, "P", `${TODAY}T18:00:00+03:00`, "win"),
      entry(2, "Q", `${TODAY}T18:00:00+03:00`, "win"),
      entry(3, "R", `${TODAY}T18:00:00+03:00`, "win"),
      entry(0, "O", `${TODAY}T17:00:00+03:00`, "win")
    ];
    render(<HistorySection history={same} today={TODAY} onOpenMatch={vi.fn()} />);
    expect(homes()).toEqual(["O", "P", "Q", "R"]);
  });

  it("6. live, settled and pre-match states do not affect the order", () => {
    const mixed = [
      entry(3, "FT-1800", `${TODAY}T18:00:00+03:00`, "win", "FT"),
      entry(1, "NS-1400", `${TODAY}T14:00:00+03:00`, "pending", "NS"),
      entry(2, "LIVE-1630", `${TODAY}T16:30:00+03:00`, "pending", "2H")
    ];
    render(<HistorySection history={mixed} today={TODAY} onOpenMatch={vi.fn()} />);
    expect(homes()).toEqual(["NS-1400", "LIVE-1630", "FT-1800"]);
  });

  it("8. an empty list stays empty", () => {
    render(<HistorySection history={[]} today={TODAY} onOpenMatch={vi.fn()} />);
    expect(homes()).toEqual([]);
  });

  it("sorts on the instant, not on the string: a lexically-later ISO string that is an earlier instant still comes first", () => {
    const rows = [
      entry(1, "LATER", `${TODAY}T19:00:00Z`, "win"), // 22:00 +03
      entry(2, "EARLIER", `${TODAY}T20:30:00+03:00`, "win") // 20:30 +03 — the string sorts AFTER "…19:00:00Z"
    ];
    render(<HistorySection history={rows} today={TODAY} onOpenMatch={vi.fn()} />);
    expect(homes()).toEqual(["EARLIER", "LATER"]);
  });

  it("ignores the localized time string entirely: a 12-hour format that sorts backwards changes nothing", () => {
    // In a 12-hour locale "1:00 PM" sorts BEFORE "9:00 AM" as text. The list
    // must still put the 09:00 kick-off first.
    const spy = vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date) {
      return this.getHours() >= 12 ? `${this.getHours() - 12 || 12}:00 PM` : `${this.getHours()}:00 AM`;
    });
    try {
      const rows = [entry(1, "AFTERNOON", `${TODAY}T13:00:00+03:00`, "win"), entry(2, "MORNING", `${TODAY}T09:00:00+03:00`, "win")];
      render(<HistorySection history={rows} today={TODAY} onOpenMatch={vi.fn()} />);
      expect(homes()).toEqual(["MORNING", "AFTERNOON"]);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── Tickets ───────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function leg(id: string, status: string) {
  return {
    id,
    special_bet_id: "bet-4821",
    fixture_id: 1623434,
    league_id: 39,
    fixture_label: "Hull City – Manchester United",
    league_name: "Premier League",
    kickoff_at: "2026-08-18T18:00:00.000Z",
    market: "corners",
    selection: "Over 7.5",
    side: "over",
    line: 7.5,
    odds: 1.62,
    confidence: 82,
    value_score: 12.4,
    status,
    settled_at: null
  };
}
/** Production shape: a 3-leg combo built on 18 Aug. */
function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: "4821aa77-b967-41a9-87e6-689297d6164a",
    user_id: "user-1",
    bet_date: "2026-08-18",
    league_ids: [39],
    league_scope: "39",
    variant: 3,
    bet_kind: "combo",
    system_k: null,
    status: "lost",
    total_odds: 4.28,
    average_confidence: 78,
    ticket_probability: 0.31,
    model_version: "v3",
    created_at: "2026-08-18T13:08:38.594Z",
    settled_at: "2026-08-21T20:11:14.633Z",
    settled_total_odds: null,
    selections: [leg("l1", "won"), leg("l2", "won"), leg("l3", "lost")],
    ...overrides
  };
}

async function renderTickets(bets: unknown[], locale?: "ro" | "en") {
  fetchWithAuth.mockResolvedValue(jsonResponse(200, { ok: true, bets }));
  const ui = <GlobalSpecialBetHistory canUseGlobalSpecialBet />;
  await act(async () => {
    render(locale ? <LocaleProvider>{ui}</LocaleProvider> : ui);
  });
  await waitFor(() => expect(document.querySelector('[data-slot="ticket-row"]')).toBeTruthy());
  const row = document.querySelector('[data-slot="ticket-row"]') as HTMLButtonElement;
  const slot = (name: string) => row.querySelector(`[data-slot="${name}"]`) as HTMLElement | null;
  return { row, slot };
}

/** The row's direct children are its content lines. */
const contentLines = (row: HTMLElement) => [...row.children].filter((c) => c.tagName === "SPAN");

describe("Tickets · two-line overview", () => {
  it("1/8/9/10/11. exactly two content lines: number · built-at | status, then shape · legs · odds", async () => {
    const { row, slot } = await renderTickets([ticket()]);
    const lines = contentLines(row);
    expect(lines.map((l) => l.getAttribute("data-slot"))).toEqual(["ticket-line-1", "ticket-line-2"]);
    expect(lines).toHaveLength(2);
    const line1 = slot("ticket-line-1")!;
    expect([...line1.children].map((c) => c.getAttribute("data-slot"))).toEqual(["ticket-meta", "ticket-status"]);
    expect(slot("ticket-number")!.textContent).toMatch(/#4821AA77/);
    expect(slot("ticket-date")!.textContent).toMatch(/18 .*aug.* · \d{2}:\d{2}/i);
    const line2 = slot("ticket-line-2")!;
    expect(line2.textContent).toMatch(/3 (selecții|legs)/);
    expect(slot("ticket-odds")!.textContent).toMatch(/4\.28/);
    expect(line2.contains(slot("ticket-legs"))).toBe(true);
    expect(line2.contains(slot("ticket-odds"))).toBe(true);
  });

  it("2/3/7/15. the layout cannot grow a third line: a fixed two-track grid, nowrap status, truncating metadata", async () => {
    const { slot } = await renderTickets([ticket()]);
    const line1 = slot("ticket-line-1")!;
    expect(line1.className).toMatch(/\bgrid\b/);
    expect(line1.className).toMatch(/grid-cols-\[minmax\(0,1fr\)_auto\]/);
    expect(slot("ticket-meta")!.className).toMatch(/\bmin-w-0\b/);
    expect(slot("ticket-meta")!.className).toMatch(/\btruncate\b/);
    expect(slot("ticket-status")!.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(slot("ticket-status")!.className).toMatch(/\bshrink-0\b/);
    expect(slot("ticket-line-2")!.className).toMatch(/\btruncate\b/);
    expect(slot("ticket-line-2")!.className).toMatch(/\bblock\b/);
  });

  it("4/5/6. status is icon + text in the shared status language", async () => {
    for (const [status, labelKey, kind] of [
      ["won", "statusWon", "win"],
      ["lost", "statusLost", "loss"],
      ["pending", "statusPending", "pending"]
    ] as const) {
      cleanup();
      const { slot } = await renderTickets([ticket({ status })]);
      const st = slot("ticket-status")!;
      expect(st.textContent, status).toMatch(either("gsb", labelKey));
      const iconEl = st.querySelector("[role='img'], svg") as HTMLElement;
      expect(iconEl, status).toBeTruthy();
      expect(iconEl.closest("[aria-hidden='true']"), status).toBeTruthy();
      // The icon is the status's OWN kind (shared vocabulary: common.status.*), not any icon.
      const iconName = iconEl.getAttribute("aria-label") || iconEl.querySelector("title")?.textContent || "";
      expect(iconName, status).toMatch(new RegExp(`^(${esc((E.common as unknown as Record<string, Record<string, string>>).status[kind])}|${esc((R.common as unknown as Record<string, Record<string, string>>).status[kind])})$`));
    }
  });

  it("12/13/14. the compact row carries no legs, no leg odds, no scores; the detail still carries all of it", async () => {
    const { row } = await renderTickets([ticket()]);
    expect(row.textContent).not.toContain("Over 7.5");
    expect(row.textContent).not.toContain("1.62");
    expect(row.textContent).not.toContain("Hull City");
    expect(document.querySelector('[data-slot="ticket-detail"]')).toBeNull();
    await act(async () => {
      row.click();
    });
    const detail = document.querySelector('[data-slot="ticket-detail"]')!;
    expect(detail).toBeTruthy();
    expect(detail.querySelectorAll("li")).toHaveLength(3);
    expect(detail.textContent).toContain("Over 7.5");
    expect(detail.textContent).toContain("1.62");
    expect(detail.textContent).toContain("Hull City");
    expect(detail.querySelector('[data-slot="ticket-shape"]')).toBeTruthy();
    const reading = detail.querySelector('[data-slot="ticket-reading"]') as HTMLElement;
    expect(reading).toBeTruthy();
    expect(reading.hidden).toBe(false);
    expect(reading.textContent).toMatch(either("gsb", "readingLostOne"));
    expect(detail.querySelector('[data-slot="ticket-bet-date"]')!.textContent).toMatch(/2026/);
    expect(detail.textContent).toMatch(either("gsb", "summaryTotalOdds"));
    expect(detail.textContent).toMatch(either("gsb", "ticketChance"));
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  it("16. the accessible name carries number, status, legs, odds and date — the status exactly once", async () => {
    const { row, slot } = await renderTickets([ticket()]);
    const name = row.getAttribute("aria-label") || "";
    const status = slot("ticket-status")!.textContent!.trim();
    expect(name).toContain("#4821AA77");
    expect(name.split(status).length - 1).toBe(1);
    expect(name).toMatch(/3 (selecții|legs)/);
    expect(name).toMatch(/4\.28/);
    expect(name).toMatch(/18 .*aug/i);
    // Any nested label (the StatusIcon's own) is inert inside the aria-hidden wrapper.
    for (const labelled of row.querySelectorAll("[aria-label]")) expect(labelled.closest("[aria-hidden='true']")).toBeTruthy();
    expect(slot("ticket-status")!.querySelector("[aria-hidden='true']")).toBeTruthy();
  });

  it("17/18. RO and EN", async () => {
    const { slot } = await renderTickets([ticket()], "ro");
    expect(slot("ticket-number")!.textContent).toMatch(/^(Bilet|Ticket) #/);
    expect(slot("ticket-odds")!.textContent).toMatch(/^(Cotă|Odds) 4\.28$/);
    for (const key of ["ticketNumber", "oddsShort", "legs"]) {
      expect(R.tickets[key], key).toBeTruthy();
      expect(E.tickets[key], key).toBeTruthy();
      expect(R.tickets[key]).not.toBe(E.tickets[key]);
    }
  });

  it("19/20. a long id and a long status still yield two lines (the status track never wraps, the meta truncates)", async () => {
    const { row, slot } = await renderTickets([ticket({ id: "ffffffffffffffffffffffffffffffffffffffff-long-id-that-goes-on", status: "pending" })]);
    expect(contentLines(row)).toHaveLength(2);
    expect(slot("ticket-number")!.textContent).toMatch(/#FFFFFFFF$/);
    expect(slot("ticket-status")!.className).toMatch(/whitespace-nowrap/);
  });

  it("21. the disclosure is the whole row (keyboard-reachable button), one open at a time", async () => {
    await renderTickets([ticket(), ticket({ id: "b2000000-0000-0000-0000-000000000000", status: "won" })]);
    const rows = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="ticket-row"]')];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tagName === "BUTTON" && r.getAttribute("aria-expanded") === "false")).toBe(true);
    await act(async () => {
      rows[0].click();
    });
    await act(async () => {
      rows[1].click();
    });
    expect(rows[0].getAttribute("aria-expanded")).toBe("false");
    expect(rows[1].getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll('[data-slot="ticket-detail"]')).toHaveLength(1);
  });
});
