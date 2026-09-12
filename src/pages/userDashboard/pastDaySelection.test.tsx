import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import { usePredictionsCache } from "./usePredictionsCache";
import { useLeagueSelection } from "./useLeagueSelection";
import HomeSection from "../../components/ux/HomeSection";
import { localCalendarDateKey } from "../../utils/appUtils";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { HistoryEntry, PredictionRow } from "../../types";

/**
 * A past day on the dashboard.
 *
 * The rows come from what already exists — this device's cache and the user's
 * own 30-day history, the very rows Results renders — and they render through
 * the same MatchListRow with the same settlement, so a finished match reads
 * "FT", its final score and its outcome exactly as it does in Results.
 */

vi.mock("../../components/ux/FeaturedPredictionCard", () => ({ default: () => null }));

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`(${esc(E[ns][key])}|${esc(R[ns][key])})`);
/**
 * Both "matches analyzed" messages BEGIN with the `{n}` placeholder, so their
 * heads are empty and an empty alternation matches every string. What tells
 * them apart is the wording around the count, so match on the message with its
 * placeholders removed instead.
 */
const literal = (s: string) => s.replace(/\{[^}]*\}/g, "").trim();
const eitherText = (ns: string, key: string) =>
  new RegExp(`(${esc(literal(E[ns][key]))}|${esc(literal(R[ns][key]))})`);

const TODAY = localCalendarDateKey();

/** Local ISO day arithmetic; `addIsoDay` lives in helpers and is UTC-anchored. */
function addIsoDayLocal(iso: string, plus: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + plus);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return localCalendarDateKey(new Date(y, m - 1, d + days));
};
const YESTERDAY = shift(TODAY, -1);
const FIVE_DAYS_AGO = shift(TODAY, -5);

function entry(id: number, day: string, overrides: Record<string, unknown> = {}): HistoryEntry {
  return {
    id,
    leagueId: 39,
    league: "Premier League",
    teams: { home: `Home${id}`, away: `Away${id}` },
    kickoff: `${day}T12:00:00.000Z`,
    status: "FT",
    score: { home: 2, away: 1 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 71, odd: 1.8 },
    savedAt: `${day}T08:00:00.000Z`,
    validation: "win",
    ...overrides
  } as unknown as HistoryEntry;
}

const HISTORY = [
  entry(1, YESTERDAY),
  entry(2, FIVE_DAYS_AGO, { score: { home: 0, away: 0 }, validation: "loss" }),
  entry(3, TODAY, { status: "NS", score: undefined, validation: "pending" }),
  entry(4, YESTERDAY, { leagueId: 140, league: "La Liga" })
];

let lastPreds: PredictionRow[] = [];

function CacheProbe({
  userId = "user-1",
  day,
  history = HISTORY,
  setDate,
  setSelectedDates = () => {}
}: {
  userId?: string;
  day: string;
  history?: HistoryEntry[];
  setDate?: (v: string) => void;
  setSelectedDates?: (v: string[]) => void;
}) {
  const cache = usePredictionsCache({
    user: { id: userId, tier: "free" } as never,
    userTier: "free",
    accessToken: undefined,
    date: day,
    selectedDates: [day],
    setSelectedDates,
    setDate,
    selectedLeagueIds: [39],
    history,
    setStatus: () => {}
  } as never);
  useEffect(() => {
    lastPreds = cache.preds;
  });
  return null;
}

function renderCache(props: Parameters<typeof CacheProbe>[0]) {
  return render(
    <LocaleProvider>
      <CacheProbe {...props} />
    </LocaleProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  lastPreds = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("past day · data", () => {
  it("fills yesterday with that day's own finished rows, keeping status and final score", async () => {
    renderCache({ day: YESTERDAY });
    await waitFor(() => expect(lastPreds.map((r) => r.id)).toEqual([1]));
    expect(lastPreds[0].status).toBe("FT");
    expect(lastPreds[0].score).toMatchObject({ home: 2, away: 1 });
  });

  it("fills an older day the same way — beyond the ~3-day hydration window", async () => {
    renderCache({ day: FIVE_DAYS_AGO });
    await waitFor(() => expect(lastPreds.map((r) => r.id)).toEqual([2]));
  });

  it("never fills today from history — the current day keeps its existing sources", async () => {
    renderCache({ day: TODAY });
    await new Promise((r) => setTimeout(r, 30));
    expect(lastPreds).toEqual([]);
  });

  it("keeps the league scope and prefers the cached document for the same fixture", async () => {
    localStorage.setItem(
      "footy.user.predictionsByUser",
      JSON.stringify({ "user-1": [{ ...entry(1, YESTERDAY), modelVersion: "v3", fromCache: true }] })
    );
    renderCache({ day: YESTERDAY });
    await waitFor(() => expect(lastPreds.map((r) => r.id)).toEqual([1]));
    expect((lastPreds[0] as unknown as { fromCache?: boolean }).fromCache).toBe(true);
  });

  it("an account switch resets the browsed date together with the selection", async () => {
    const setDate = vi.fn();
    const setSelectedDates = vi.fn();
    const { rerender } = renderCache({ day: YESTERDAY, setDate, setSelectedDates });
    rerender(
      <LocaleProvider>
        <CacheProbe userId="user-2" day={YESTERDAY} setDate={setDate} setSelectedDates={setSelectedDates} />
      </LocaleProvider>
    );
    await waitFor(() => expect(setDate).toHaveBeenCalledWith(TODAY));
    expect(setSelectedDates).toHaveBeenCalledWith([TODAY]);
  });
});

describe("past day · the data layer requests the selected ISO day", () => {
  it("asks /api/fixtures for exactly the chosen day, and for the next one when it changes", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, leagues: [], totalFixtures: 0, usage: { date: TODAY, count: 0, limit: 100 } })
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderHook(
      ({ day }) =>
        useLeagueSelection({
          user: null,
          accessToken: undefined,
          date: day,
          selectedDates: [day],
          updateFavoriteLeagues: async () => undefined,
          setStatus: () => {}
        }),
      { initialProps: { day: YESTERDAY } }
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/fixtures?date=${YESTERDAY}`));
    rerender({ day: FIVE_DAYS_AGO });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/fixtures?date=${FIVE_DAYS_AGO}`));
    expect(fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))).not.toContain(`/api/fixtures?date=${TODAY}`);
  });
});

describe("past day · rendering (Results semantics)", () => {
  function renderHome(selectedDate: string, rows: PredictionRow[]) {
    return render(
      <LocaleProvider>
        <HomeSection
          matches={rows}
          counts={{ total: rows.length, value: 0, highConfidence: 0 }}
          analysisMatch={null}
          liveCount={0}
          accessTier="free"
          marketValidationsByFixtureId={new Map()}
          isWatched={() => false}
          onToggleWatch={() => {}}
          onOpenMatch={() => {}}
          onUpgradeRequired={() => {}}
          onGoMatches={() => {}}
          onGoLive={() => {}}
          onGoHistory={() => {}}
          onGoStatistics={() => {}}
          onGoTickets={() => {}}
          trackerStats={{ wins: 0, losses: 0, settled: 0, winRate: 0, pushes: 0, halfWins: 0, halfLosses: 0 }}
          selectedDate={selectedDate}
        />
      </LocaleProvider>
    );
  }

  it("shows a finished match with FT, its final score and its settled outcome, as Results does", () => {
    const row = entry(1, YESTERDAY, { cardMarketValidations: { recommended: "win" } });
    renderHome(YESTERDAY, [row]);
    const button = screen.getByRole("button", { name: /Home1/ });
    expect(button.getAttribute("aria-label")).toMatch(either("list", "fullTimeShort"));
    expect(button.getAttribute("aria-label")).toMatch(/2–1/);
    expect(button.getAttribute("aria-label")).toMatch(either("history", "win"));
  });

  it("does not describe a past day as 'today' in its context line", () => {
    renderHome(YESTERDAY, [entry(1, YESTERDAY)]);
    const line = screen.getByTestId("today-context").textContent || "";
    expect(line).not.toMatch(eitherText("dash", "matchesAnalyzedToday"));
    expect(line).toMatch(eitherText("dash", "matchesAnalyzed"));
  });
});

/**
 * FUTURE days inside the plan window, which behave the mirror image of past
 * ones: nothing is filled in from history, because a day that has not happened
 * has no history to fill from. The first visit is therefore empty and Predict
 * is what populates it; afterwards the day reads from the cache like any other.
 *
 * The rule this pins: selecting a future day must never generate anything by
 * itself. Predict costs quota, so it stays a thing the user asks for, and a
 * second visit must not ask again.
 */
describe("future day within the plan window", () => {
  const TOMORROW = addIsoDayLocal(TODAY, 1);

  it("first visit is empty — nothing is generated merely by selecting the day", async () => {
    renderCache({ day: TOMORROW });
    await new Promise((r) => setTimeout(r, 30));
    expect(lastPreds, "a future day must not be filled from history").toEqual([]);
  });

  /*
    Per-day generation state, and the promise that costs money: moving between
    days never generates anything. Asserted against the PREDICT ENDPOINTS
    themselves (/api/warm, /api/predict) rather than against a spy on an
    internal function — those two requests are what spends a user's quota, so
    their absence is the property worth pinning.

    Tier does not appear here on purpose: the cache is tier-agnostic, and which
    days a plan may reach is DaySelector's gate, tested in DaySelector.test.tsx.
  */
  it("switching between a generated and an ungenerated future day never calls Predict", async () => {
    const DAY_AFTER = addIsoDayLocal(TODAY, 2);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    // Only +1 has been generated so far; +2 has not.
    localStorage.setItem(
      "footy.user.predictionsByUser",
      JSON.stringify({ "user-1": [{ ...entry(9, TOMORROW), status: "NS", score: undefined, validation: "pending" }] })
    );

    const { rerender } = renderCache({ day: TOMORROW });
    await waitFor(() => expect(lastPreds.map((r) => r.id)).toEqual([9]));

    // +2 is independently ungenerated — it must read empty, not inherit +1.
    rerender(
      <LocaleProvider>
        <CacheProbe day={DAY_AFTER} />
      </LocaleProvider>
    );
    await waitFor(() => expect(lastPreds).toEqual([]));

    // Back to +1: still READY, served from the cache.
    rerender(
      <LocaleProvider>
        <CacheProbe day={TOMORROW} />
      </LocaleProvider>
    );
    await waitFor(() => expect(lastPreds.map((r) => r.id)).toEqual([9]));

    const predictCalls = fetchMock.mock.calls
      .map((c) => String((c as unknown[])[0]))
      .filter((u) => u.includes("/api/predict") || u.includes("/api/warm"));
    expect(predictCalls, "navigating between days must never spend Predict quota").toEqual([]);
  });

  it("after Predict has cached rows for it, revisiting shows them with no further Predict", async () => {
    localStorage.setItem(
      "footy.user.predictionsByUser",
      JSON.stringify({ "user-1": [{ ...entry(9, TOMORROW), status: "NS", score: undefined, validation: "pending" }] })
    );
    renderCache({ day: TOMORROW });
    await waitFor(() => expect(lastPreds.map((r) => r.id)).toEqual([9]));
  });
});
