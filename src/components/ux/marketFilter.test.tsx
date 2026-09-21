import { cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MatchesSection from "./MatchesSection";
import MatchListRow from "./MatchListRow";
import { buildPredictAction } from "./predictState";
import { useDerivedPredictions } from "../../pages/userDashboard/useDerivedPredictions";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";
import type { UiPrefsV3 } from "../../hooks/useUiPrefs";
import type { MarketFilter } from "../../utils/marketProbabilityFilter";

/**
 * The market filter, end to end on the Matches surface: the control, what a row
 * shows while a market is selected, the empty state, and the list order coming
 * out of the same hook the dashboard uses.
 *
 * The pure ranking rules (missing vs zero, ties, scale) live next to the helper
 * in utils/marketProbabilityFilter.test.ts; this file is about the wiring.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whichever locale the environment resolves to, the copy is one of these. */
const either = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})$`);
const contains = (ns: string, key: string) =>
  new RegExp(`(${esc(E[ns][key].split("{")[0])}|${esc(R[ns][key].split("{")[0])})`);

afterEach(cleanup);

function row(id: number, probs: Record<string, unknown>, over: Record<string, unknown> = {}): PredictionRow {
  return {
    id,
    leagueId: 39,
    league: "Premier League",
    teams: { home: `Home${id}`, away: `Away${id}` },
    kickoff: `2026-08-25T1${id}:00:00.000Z`,
    status: "NS",
    logos: { home: "https://img/h.png", away: "https://img/a.png" },
    probs,
    // Confidence runs OPPOSITE to every market below, so a row ordered or
    // labelled by confidence instead of the market fails loudly.
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 10 * id, odd: 1.85 },
    ...over
  } as unknown as PredictionRow;
}

/** The brief's worked example: GG → B,A,C · +1.5 FT → C,A,B · +2.5 FT → C,A,B · +1.5 FH → B,C,A. */
const A = row(1, { pGG: 91, pO15: 96, pO25: 78, firstHalf: { pO15: 54 } });
const B = row(2, { pGG: 96, pO15: 91, pO25: 72, firstHalf: { pO15: 68 } });
const C = row(3, { pGG: 83, pO15: 99, pO25: 87, firstHalf: { pO15: 61 } });

function renderMatches(overrides: Record<string, unknown> = {}) {
  const onSetFilter = vi.fn();
  const onSetMarketFilter = vi.fn();
  const onPredict = vi.fn();
  const predictAction = buildPredictAction({
    state: "idle",
    labels: { label: "Generează Predicții", hint: "hint", busy: "busy", quotaSpent: "spent" },
    run: onPredict
  });
  render(
    <MatchesSection
      matches={[A, B, C]}
      accessTier="ultra"
      marketValidationsByFixtureId={new Map()}
      isWatched={() => false}
      onToggleWatch={() => {}}
      onOpenMatch={() => {}}
      onUpgradeRequired={() => {}}
      predictAction={predictAction}
      matchesFilter="all"
      onSetFilter={onSetFilter}
      marketFilter="all"
      onSetMarketFilter={onSetMarketFilter}
      marketBaseCount={3}
      loading={false}
      {...overrides}
    />
  );
  return { onSetFilter, onSetMarketFilter, onPredict };
}

const marketBar = () => screen.getByTestId("matches-market-filter");
const chip = (key: string) => within(marketBar()).getByRole("button", { name: either("dash", key) });
const rowsOnScreen = () => Array.from(document.querySelectorAll<HTMLElement>("li[data-match-row]"));

describe("market filter · the control", () => {
  it("offers Toate · GG · +1.5 FT · +2.5 FT · +1.5 FH as real buttons, in that order", () => {
    renderMatches();
    const buttons = within(marketBar()).getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringMatching(either("dash", "filterAll")),
      "GG",
      "+1.5 FT",
      "+2.5 FT",
      "+1.5 FH"
    ]);
    for (const b of buttons) expect(b.getAttribute("type")).toBe("button");
  });

  it("is a labelled group of toggles — a filter, not a tab strip", () => {
    renderMatches();
    const group = within(marketBar()).getByRole("group");
    expect(group.getAttribute("aria-label")).toMatch(either("dash", "marketFilterLabel"));
    expect(within(marketBar()).queryByRole("tablist")).toBeNull();
  });

  it("lives in its own container, so the segment control keeps exactly its four buttons", () => {
    renderMatches();
    expect(screen.getByTestId("matches-controls").querySelectorAll("button")).toHaveLength(4);
    expect(screen.getByTestId("matches-controls").contains(marketBar())).toBe(false);
  });

  it("does not exist on a surface that does not own the state", () => {
    renderMatches({ onSetMarketFilter: undefined });
    expect(screen.queryByTestId("matches-market-filter")).toBeNull();
  });

  it("marks only the selected market as pressed", () => {
    renderMatches({ marketFilter: "o25ft" });
    expect(chip("marketO25Ft").getAttribute("aria-pressed")).toBe("true");
    for (const key of ["filterAll", "marketGg", "marketO15Ft", "marketO15Fh"]) {
      expect(chip(key).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("reports the chosen market and leaves the segment alone", () => {
    const { onSetMarketFilter, onSetFilter } = renderMatches();
    fireEvent.click(chip("marketGg"));
    expect(onSetMarketFilter).toHaveBeenCalledWith("gg");
    fireEvent.click(chip("marketO15Fh"));
    expect(onSetMarketFilter).toHaveBeenLastCalledWith("o15fh");
    expect(onSetFilter).not.toHaveBeenCalled();
  });

  it("is keyboard reachable with a visible focus ring", () => {
    renderMatches();
    const gg = chip("marketGg");
    gg.focus();
    expect(document.activeElement).toBe(gg);
    expect(gg.className).toMatch(/focus-visible:outline/);
    expect(gg.hasAttribute("disabled")).toBe(false);
  });

  it("scrolls inside the page instead of widening it or wrapping to a second row", () => {
    renderMatches();
    // The scroller is capped to its parent; the control keeps its natural width.
    expect(marketBar().className).toMatch(/\boverflow-x-auto\b/);
    expect(marketBar().className).toMatch(/\bmax-w-full\b/);
    expect(marketBar().className).toMatch(/\bscrollbar-none\b/);
    expect(within(marketBar()).getByRole("group").className).toMatch(/\bw-max\b/);
  });
});

describe("market filter · what a row shows", () => {
  it("'Toate' leaves the row exactly as it was: recommendation, confidence, its odd", () => {
    renderMatches({ matches: [A] });
    const li = rowsOnScreen()[0];
    expect(li.querySelector('[data-slot="confidence"]')?.textContent).toBe("10%");
    expect(li.querySelector('[data-slot="market-probability"]')).toBeNull();
    expect(li.querySelector('[data-slot="odds"]')?.textContent).toBe("1.85");
  });

  it("a selected market puts ITS probability in the slot — not the recommendation's confidence", () => {
    renderMatches({ matches: [B], marketFilter: "gg" });
    const li = rowsOnScreen()[0];
    expect(li.querySelector('[data-slot="prediction"]')?.textContent).toBe("GG");
    expect(li.querySelector('[data-slot="market-probability"]')?.textContent).toBe("96%");
    // B's confidence is 20% — it must be gone, not sitting beside a GG label.
    expect(li.querySelector('[data-slot="confidence"]')).toBeNull();
    expect(li.textContent).not.toContain("20%");
  });

  it("shows the right number for each market, first half included", () => {
    for (const [market, expected] of [
      ["gg", "91%"],
      ["o15ft", "96%"],
      ["o25ft", "78%"],
      ["o15fh", "54%"]
    ] as [MarketFilter, string][]) {
      cleanup();
      renderMatches({ matches: [A], marketFilter: market });
      expect(rowsOnScreen()[0].querySelector('[data-slot="market-probability"]')?.textContent).toBe(expected);
    }
  });

  it("renders 0% and 100% as values, not as blanks", () => {
    renderMatches({ matches: [row(4, { pGG: 0 }), row(5, { pGG: 100 })], marketFilter: "gg" });
    const shown = rowsOnScreen().map((li) => li.querySelector('[data-slot="market-probability"]')?.textContent);
    expect(shown).toEqual(["0%", "100%"]);
  });

  it("drops the recommendation's price and verdict, which belong to a different bet", () => {
    const settled = row(6, { pGG: 70 }, { status: "FT", score: { home: 2, away: 1 }, cardMarketValidations: { recommended: "win" } });
    renderMatches({ matches: [settled], marketFilter: "gg" });
    const li = rowsOnScreen()[0];
    // 1.85 is the recommended pick's odd; there is no GG quote on this row.
    expect(li.querySelector('[data-slot="odds"]')?.textContent).not.toContain("1.85");
    expect(li.querySelector('[data-slot="odds"]')?.textContent).toMatch(either("card", "noBookOdd"));
  });

  it("prices the selected market from its own quote when one exists", () => {
    const priced = row(7, { pGG: 70 }, { marketOdds: { btts: { pick: "GG", odd: 1.72 } } });
    renderMatches({ matches: [priced], marketFilter: "gg" });
    expect(rowsOnScreen()[0].querySelector('[data-slot="odds"]')?.textContent).toBe("1.72");
  });

  it("speaks the market and its probability in the row's accessible name", () => {
    renderMatches({ matches: [B], marketFilter: "gg" });
    const name = within(rowsOnScreen()[0]).getAllByRole("button")[0].getAttribute("aria-label") || "";
    expect(name).toMatch(contains("dash", "marketGgName"));
    expect(name).toContain("96%");
    expect(name).not.toContain("20%");
  });

  it("other surfaces that reuse the row are untouched: no prop, no change", () => {
    render(
      <ul>
        <MatchListRow row={A} onOpen={() => {}} />
      </ul>
    );
    const li = document.querySelector("li")!;
    expect(li.querySelector('[data-slot="confidence"]')?.textContent).toBe("10%");
    expect(li.querySelector('[data-slot="market-probability"]')).toBeNull();
  });
});

describe("market filter · empty state", () => {
  it("says the market is missing, and steps out of the MARKET only", () => {
    const { onSetMarketFilter, onSetFilter, onPredict } = renderMatches({
      matches: [],
      marketFilter: "o15fh",
      marketBaseCount: 3,
      matchesFilter: "live"
    });
    expect(screen.getByText(contains("dash", "emptyMarketTitle"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: either("dash", "showAll") }));
    expect(onSetMarketFilter).toHaveBeenCalledWith("all");
    // The Live segment the user picked is still theirs; Predict is never offered.
    expect(onSetFilter).not.toHaveBeenCalled();
    expect(onPredict).not.toHaveBeenCalled();
  });

  it("defers to the existing empty state when there was nothing to rank in the first place", () => {
    renderMatches({ matches: [], marketFilter: "gg", marketBaseCount: 0 });
    expect(screen.queryByText(contains("dash", "emptyMarketTitle"))).toBeNull();
    expect(screen.getByText(either("dash", "emptyPredsTitle"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------- the hook the dashboard uses

const prefs = {
  watchlistFixtureIds: [],
  minEv: 0,
  preferredMarkets: [],
  notifyLiveSwing: false
} as unknown as UiPrefsV3;

function useList(preds: PredictionRow[], marketFilter: MarketFilter, matchesFilter = "all") {
  return useDerivedPredictions({
    preds,
    history: [],
    prefs,
    matchesFilter: matchesFilter as never,
    matchSearch: "",
    showSettledMarketsOnly: false,
    marketFilter
  });
}
const orderOf = (rows: PredictionRow[]) => rows.map((r) => r.id);

describe("market filter · list order from useDerivedPredictions", () => {
  it("[1] 'Toate' keeps the existing order: kickoff ascending", () => {
    const { result } = renderHook(() => useList([C, A, B], "all"));
    expect(orderOf(result.current.visiblePreds)).toEqual([1, 2, 3]);
    expect(result.current.marketBaseCount).toBe(3);
  });

  it("omitting the option entirely behaves as 'Toate' — existing callers are unaffected", () => {
    const { result } = renderHook(() =>
      useDerivedPredictions({ preds: [C, A, B], history: [], prefs, matchesFilter: "all", matchSearch: "", showSettledMarketsOnly: false })
    );
    expect(orderOf(result.current.visiblePreds)).toEqual([1, 2, 3]);
  });

  it("[11] changing the market re-ranks the list immediately", () => {
    const { result, rerender } = renderHook(({ m }: { m: MarketFilter }) => useList([A, B, C], m), {
      initialProps: { m: "all" as MarketFilter }
    });
    expect(orderOf(result.current.visiblePreds)).toEqual([1, 2, 3]);
    rerender({ m: "gg" });
    expect(orderOf(result.current.visiblePreds)).toEqual([2, 1, 3]);
    rerender({ m: "o15ft" });
    expect(orderOf(result.current.visiblePreds)).toEqual([3, 1, 2]);
    rerender({ m: "o25ft" });
    expect(orderOf(result.current.visiblePreds)).toEqual([3, 1, 2]);
    rerender({ m: "o15fh" });
    expect(orderOf(result.current.visiblePreds)).toEqual([2, 3, 1]);
    rerender({ m: "all" });
    expect(orderOf(result.current.visiblePreds)).toEqual([1, 2, 3]);
  });

  it("[12] a new day's rows replace the old ones — nothing stale survives the switch", () => {
    const dayOne = [A, B, C];
    const dayTwo = [row(7, { pGG: 40 }), row(8, { pGG: 75 })];
    const { result, rerender } = renderHook(({ p }: { p: PredictionRow[] }) => useList(p, "gg"), {
      initialProps: { p: dayOne }
    });
    expect(orderOf(result.current.visiblePreds)).toEqual([2, 1, 3]);
    rerender({ p: dayTwo });
    expect(orderOf(result.current.visiblePreds)).toEqual([8, 7]);
    // The selection carries over; the rows do not.
    rerender({ p: [] });
    expect(result.current.visiblePreds).toEqual([]);
    expect(result.current.marketBaseCount).toBe(0);
  });

  it("reports rows-before-market so an emptied list can be told from an empty day", () => {
    const noFirstHalf = [row(1, { pGG: 50 }), row(2, { pGG: 60 })];
    const { result } = renderHook(() => useList(noFirstHalf, "o15fh"));
    expect(result.current.visiblePreds).toEqual([]);
    expect(result.current.marketBaseCount).toBe(2);
  });

  it("outranks the 'Top picks' confidence sort when both are chosen", () => {
    // Confidence says 3,2,1; GG says 2,1,3. The market wins, within the picks filter.
    const { result } = renderHook(() => useList([A, B, C], "gg", "picks"));
    expect(orderOf(result.current.visiblePreds)).toEqual([2, 1, 3]);
  });

  it("keeps the same list identity across unrelated re-renders", () => {
    const preds = [A, B, C];
    const { result, rerender } = renderHook(() => useList(preds, "gg"));
    const first = result.current.visiblePreds;
    rerender();
    expect(result.current.visiblePreds).toBe(first);
  });
});
