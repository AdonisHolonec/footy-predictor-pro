import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ConsumerShell from "./ConsumerShell";
import MatchesSection from "./MatchesSection";
import HomeSection from "./HomeSection";
import HistorySection from "./HistorySection";
import StatisticsSection from "./StatisticsSection";
import TicketsSection from "./TicketsSection";
import {
  APP_NAV_ITEMS,
  DESKTOP_SECONDARY_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  slugToView,
  viewToSlug,
  workspacePath,
  type AppNavView,
  type MatchesSubFilter
} from "./appNav";
import { useWorkspaceRoute } from "../../pages/userDashboard/useWorkspaceRoute";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";

/**
 * UX-B — information architecture + navigation.
 *
 * Five destinations, one name each, the same on both bars; Live and
 * Predictions are not destinations; the destination is the URL; navigating
 * never resets unrelated state; the detail sheet never loses the page it was
 * opened from. Pinned against a small harness that composes the real shell,
 * the real route hook and the real sections — everything UserDashboard does
 * for navigation, without its data hooks.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})$`);
const contains = (ns: string, key: string) => new RegExp(`${esc(E[ns][key])}|${esc(R[ns][key])}`);
const SRC = join(__dirname, "..", "..");
const src = (rel: string) => readFileSync(join(SRC, rel), "utf8");

vi.mock("./GlobalSpecialBetSection", () => ({ default: () => <div data-testid="gsb" /> }));
vi.mock("./GlobalSpecialBetHistory", () => ({ default: () => <div data-testid="gsb-history" /> }));
vi.mock("./FeaturedPredictionCard", () => ({
  default: ({ match }: { match: PredictionRow }) => <div data-testid="featured">{match.teams.home}</div>
}));
vi.mock("./CalibrationChart", () => ({ default: () => null }));
vi.mock("./HistoryTrustSection", () => ({ default: () => null }));
vi.mock("../TrackRecordSection", () => ({ default: () => <div data-testid="track-record" /> }));

afterEach(cleanup);

function row(id: number, home: string, status = "NS"): PredictionRow {
  return {
    id,
    leagueId: 39,
    league: "Premier League",
    teams: { home, away: `${home} Away` },
    kickoff: "2026-08-25T17:30:00.000Z",
    status,
    score: status === "NS" ? undefined : { home: 1, away: 0, minute: 60 },
    probs: { p1: 0.5, pX: 0.25, p2: 0.25 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 80 - id, odd: 1.9 }
  } as unknown as PredictionRow;
}
const ROWS = [row(1, "Arsenal"), row(2, "Leeds"), row(3, "Rayo", "2H"), row(4, "Wolves")];
const noop = () => {};

/** Mirrors UserDashboard's navigation wiring: URL-driven view, session-local segment, detail overlay. */
function Harness() {
  const { navView, setNavView } = useWorkspaceRoute();
  const navigate = useNavigate();
  const [matchesFilter, setMatchesFilter] = useState<MatchesSubFilter>("all");
  const [selected, setSelected] = useState<PredictionRow | null>(null);
  const location = useLocation();
  const live = ROWS.filter((r) => r.status !== "NS");
  const visible =
    matchesFilter === "live" ? live : matchesFilter === "favorites" ? ROWS.filter((r) => r.id === 2) : ROWS;
  return (
    <ConsumerShell activeNav={navView} onNavigate={setNavView} date="2026-08-25" onDateChange={noop} liveCount={live.length}>
      <span data-testid="path">{location.pathname}</span>
      <span data-testid="segment">{matchesFilter}</span>
      <button type="button" data-testid="browser-back" onClick={() => navigate(-1)}>
        back
      </button>
      {navView === "home" && (
        <HomeSection
          matches={ROWS}
          counts={{ total: ROWS.length, value: 0, highConfidence: 3 }}
          analysisMatch={ROWS[0]}
          liveCount={live.length}
          accessTier="ultra"
          marketValidationsByFixtureId={new Map()}
          isWatched={() => false}
          onToggleWatch={noop}
          onOpenMatch={setSelected}
          onUpgradeRequired={noop}
          onGoMatches={() => setNavView("matches")}
          onGoLive={() => {
            setMatchesFilter("live");
            setNavView("matches");
          }}
          onGoHistory={() => setNavView("history")}
          onGoStatistics={() => setNavView("statistics")}
          onGoTickets={() => setNavView("tickets")}
          trackerStats={{ wins: 3, losses: 1, winRate: 75, settled: 4, pending: 0 } as never}
          selectedDate="2026-08-25"
        />
      )}
      {navView === "matches" && (
        <MatchesSection
          matches={visible}
          accessTier="ultra"
          marketValidationsByFixtureId={new Map()}
          isWatched={() => false}
          onToggleWatch={noop}
          onOpenMatch={setSelected}
          onUpgradeRequired={noop}
          matchesFilter={matchesFilter}
          onSetFilter={setMatchesFilter}
          search=""
          onSearchChange={noop}
          valueOnly={false}
          onToggleValueOnly={noop}
          loading={false}
        />
      )}
      {navView === "history" && <HistorySection history={[]} onGoTickets={() => setNavView("tickets")} />}
      {navView === "statistics" && <StatisticsSection trackerSlot={<div data-testid="tracker" />} history={[]} />}
      {navView === "tickets" && <TicketsSection betDate="2026-08-25" favoriteLeagueIds={[39]} canUseGlobalSpecialBet />}
      {navView === "profile" && <h1>{E.nav.account}</h1>}
      {selected && (
        <div role="dialog" data-testid="detail">
          {selected.teams.home}
          <button type="button" onClick={() => setSelected(null)}>
            close
          </button>
        </div>
      )}
    </ConsumerShell>
  );
}

function mount(initialEntries: string[] = ["/workspace"], initialIndex?: number) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <Routes>
        <Route path="/workspace" element={<Harness />} />
        <Route path="/workspace/:view" element={<Harness />} />
      </Routes>
    </MemoryRouter>
  );
}

const path = () => screen.getByTestId("path").textContent;
const segment = () => screen.getByTestId("segment").textContent;
const tab = (id: AppNavView) => document.querySelector(`nav.lg\\:hidden [data-nav="${id}"]`) as HTMLButtonElement;
const heading = () => (document.querySelector("main h1")?.textContent || "").trim();

describe("UX-B · destination model", () => {
  it("[1] has exactly five primary destinations, in the product order", () => {
    expect(PRIMARY_NAV_ITEMS.map((i) => i.id)).toEqual(["home", "matches", "history", "statistics", "profile"]);
    expect(PRIMARY_NAV_ITEMS.map((i) => i.slug)).toEqual(["today", "matches", "results", "performance", "account"]);
  });

  it("[2][3] defines no Predictions and no Live destination", () => {
    const ids = APP_NAV_ITEMS.map((i) => i.id as string);
    expect(ids).not.toContain("predictions");
    expect(ids).not.toContain("live");
    expect(APP_NAV_ITEMS.map((i) => i.slug)).not.toContain("live");
  });

  it("[16] every primary label is the destination's concept and matches the page heading", () => {
    const expected: Record<string, string> = {
      home: "today",
      matches: "matches",
      history: "results",
      statistics: "performance",
      profile: "account"
    };
    for (const item of PRIMARY_NAV_ITEMS) expect(item.labelKey).toBe(`nav.${expected[item.id]}`);
    for (const [id, key] of Object.entries(expected).filter(([id]) => id !== "home")) {
      cleanup();
      mount([workspacePath(id as AppNavView)]);
      expect(heading(), id).toMatch(either("nav", key));
    }
  });

  it("[17] has RO and EN strings for every nav label", () => {
    for (const item of APP_NAV_ITEMS) {
      const key = item.labelKey.split(".")[1];
      expect(E.nav[key], key).toBeTypeOf("string");
      expect(R.nav[key], key).toBeTypeOf("string");
    }
    expect(E.nav.today).not.toBe(R.nav.today);
    expect(E.nav.results).not.toBe(R.nav.results);
    expect(E.nav.account).not.toBe(R.nav.account);
  });

  it("Tickets is the only secondary item and never a primary", () => {
    expect(DESKTOP_SECONDARY_NAV_ITEMS.map((i) => i.id)).toEqual(["tickets"]);
    expect(PRIMARY_NAV_ITEMS.map((i) => i.id as string)).not.toContain("tickets");
  });

  it("slug ↔ view is total and unknown slugs land on Today", () => {
    for (const item of APP_NAV_ITEMS) expect(slugToView(viewToSlug(item.id))).toBe(item.id);
    expect(slugToView("nope")).toBe("home");
    expect(slugToView(undefined)).toBe("home");
    expect(slugToView("live")).toBe("home");
    expect(workspacePath("home")).toBe("/workspace");
    expect(workspacePath("history")).toBe("/workspace/results");
  });
});

describe("UX-B · reachability and deep links", () => {
  it("[4][5][6] Results, Performance and Account are reachable from the bottom bar and the rail", () => {
    mount();
    for (const id of ["history", "statistics", "profile"] as const) {
      expect(document.querySelectorAll(`[data-nav="${id}"]`)).toHaveLength(2);
    }
  });

  it("[10] deep links resolve to their destination", () => {
    mount(["/workspace/performance"]);
    expect(heading()).toMatch(either("nav", "performance"));
    expect(document.querySelectorAll('[data-nav="statistics"][aria-current="page"]')).toHaveLength(2);
    cleanup();
    mount(["/workspace/results"]);
    expect(heading()).toMatch(either("nav", "results"));
    cleanup();
    mount(["/workspace/tickets"]);
    // The builder opens on request; the destination itself is the CTA + the history.
    expect(screen.getByTestId("tickets-build-cta")).toBeTruthy();
    expect(screen.getByTestId("gsb-history")).toBeTruthy();
    cleanup();
    mount(["/workspace/whatever"]);
    expect(screen.getByTestId("today-context")).toBeTruthy();
  });

  it("[15][18] every primary destination is one tap away — no command palette, no hidden page", () => {
    mount();
    for (const item of PRIMARY_NAV_ITEMS) {
      fireEvent.click(tab(item.id));
      expect(path()).toBe(workspacePath(item.id));
    }
  });
});

describe("UX-B · Matches segment and state", () => {
  it("[7] shows All | Live | Favorites as one segmented control, Live included on mobile", () => {
    mount(["/workspace/matches"]);
    const controls = screen.getByTestId("matches-controls");
    const live = screen.getByRole("button", { name: either("dash", "filterLive") });
    expect(controls.contains(live)).toBe(true);
    expect(live.className).not.toMatch(/\bhidden\b|lg:inline-flex/);
    for (const key of ["filterAll", "filterLive", "filterFavorites"]) {
      expect(controls.textContent).toMatch(contains("dash", key));
    }
  });

  it("[8] choosing Live narrows the list and leaves the other state untouched; leaving Live restores it", () => {
    mount(["/workspace/matches"]);
    fireEvent.click(screen.getByRole("button", { name: either("dash", "filterFavorites") }));
    expect(segment()).toBe("favorites");
    expect(document.querySelectorAll("li[data-match-row]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: either("dash", "filterLive") }));
    expect(segment()).toBe("live");
    expect(document.querySelectorAll("li[data-match-row='live']")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: either("dash", "filterFavorites") }));
    expect(segment()).toBe("favorites");
  });

  it("[9] switching destinations and coming back keeps the Matches segment", () => {
    mount(["/workspace/matches"]);
    fireEvent.click(screen.getByRole("button", { name: either("dash", "filterLive") }));
    expect(segment()).toBe("live");
    fireEvent.click(tab("history"));
    expect(path()).toBe("/workspace/results");
    fireEvent.click(tab("matches"));
    expect(path()).toBe("/workspace/matches");
    expect(segment()).toBe("live");
  });

  it("Today's live entry opens Matches on the Live segment", () => {
    mount();
    // The "Show all · n" inside the live ticker block, not the one under Top picks.
    fireEvent.click(screen.getByTestId("today-live").querySelector("button")!);
    expect(path()).toBe("/workspace/matches");
    expect(segment()).toBe("live");
  });

  it("UserDashboard's navigation handler touches nothing but the destination", () => {
    const source = src("pages/UserDashboard.tsx");
    const handler = source.slice(source.indexOf("const handleNav"), source.indexOf("const goLive"));
    expect(handler).not.toMatch(/updateFilters|setMatchesFilter|setMatchSearch/);
    expect(source).toMatch(/useState<MatchesSubFilter>\("all"\)/);
    expect(source).not.toMatch(/prefs\.matchesFilter/);
  });
});

describe("UX-B · Back navigation and detail overlay", () => {
  it("[11] Back returns to the previous destination", () => {
    mount();
    fireEvent.click(tab("history"));
    fireEvent.click(tab("statistics"));
    expect(path()).toBe("/workspace/performance");
    fireEvent.click(screen.getByTestId("browser-back"));
    expect(path()).toBe("/workspace/results");
    expect(heading()).toMatch(either("nav", "results"));
    fireEvent.click(screen.getByTestId("browser-back"));
    expect(path()).toBe("/workspace");
    expect(screen.getByTestId("today-context")).toBeTruthy();
  });

  it("[12] Today → detail → close keeps Today and its URL", () => {
    mount();
    const rows = document.querySelectorAll("li[data-match-row] > button");
    fireEvent.click(rows[0]);
    expect(screen.getByTestId("detail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByTestId("detail")).toBeNull();
    expect(path()).toBe("/workspace");
    expect(screen.getByTestId("featured")).toBeTruthy();
  });

  it("[13] Matches → detail → close keeps the segment and the URL", () => {
    mount(["/workspace/matches"]);
    fireEvent.click(screen.getByRole("button", { name: either("dash", "filterLive") }));
    fireEvent.click(document.querySelector("li[data-match-row] > button")!);
    expect(screen.getByTestId("detail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(path()).toBe("/workspace/matches");
    expect(segment()).toBe("live");
  });
});

describe("UX-B · Today, Results, Performance composition", () => {
  it("[14] Today: context line, Featured once, live ticker, picks, entry cards — no H1 greeting, no chips", () => {
    mount();
    expect(screen.getByTestId("today-context").textContent).toMatch(/25/);
    expect(document.querySelector("main h1")).toBeNull();
    expect(screen.getByTestId("featured").textContent).toBe("Arsenal");
    const rows = [...document.querySelectorAll("li[data-match-row]")].map((r) => r.textContent || "");
    expect(rows.some((t) => /Arsenal/.test(t))).toBe(false);
    expect(screen.getByTestId("today-live")).toBeTruthy();
    expect(screen.getByTestId("today-entries").querySelectorAll("button")).toHaveLength(4);
    expect(screen.queryByTestId("gsb")).toBeNull();
    expect(screen.queryByRole("button", { name: either("dash", "filterHighConf") })).toBeNull();
  });

  it("Results: no tracker on top, a day with navigation, an outcome filter, a Tickets link", () => {
    render(
      <HistorySection
        today="2026-08-20"
        history={
          [
            { id: 1, kickoff: "2026-08-20T18:00:00Z", teams: { home: "Rapid", away: "Farul" }, validation: "win" },
            { id: 2, kickoff: "2026-08-19T18:00:00Z", teams: { home: "CFR", away: "Dinamo" }, validation: "loss" }
          ] as never
        }
        onGoTickets={noop}
      />
    );
    expect(screen.queryByTestId("tracker")).toBeNull();
    expect(screen.getByTestId("results-controls")).toBeTruthy();
    expect(screen.getByTestId("results-day-nav")).toBeTruthy();
    // The selected day shows its own rows only; the previous day is one tap back.
    expect(screen.getByText(/Rapid/)).toBeTruthy();
    expect(screen.queryByText(/CFR/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: either("history", "dayPrev") }));
    expect(screen.getByText(/CFR/)).toBeTruthy();
    expect(screen.queryByText(/Rapid/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: either("history", "win") }));
    expect(screen.queryByText(/CFR/)).toBeNull();
    expect(screen.getByTestId("results-tickets-link")).toBeTruthy();
  });

  it("Performance: 'Your results' and 'Model track record' are two labelled sections, one tracker", () => {
    mount(["/workspace/performance"]);
    expect(screen.getByTestId("performance-yours")).toBeTruthy();
    expect(screen.getByTestId("performance-model")).toBeTruthy();
    expect(screen.getAllByTestId("tracker")).toHaveLength(1);
    expect(screen.getByTestId("performance-yours").textContent).toMatch(contains("perf", "yoursTitle"));
    expect(screen.getByTestId("performance-model").textContent).toMatch(contains("perf", "modelTitle"));
  });

  it("Model internals stay behind the Account setting: the Advanced tab is offered only when enabled", () => {
    // UX-C: the Advanced TAB became the Advanced LAYER; the gate is the same prop.
    expect(src("components/MatchModal.tsx")).toMatch(/\{showModelInternals && \(\s*<div data-layer="advanced">/);
    expect(src("hooks/useUiPrefs.ts")).toMatch(/showModelInternals: false/);
    expect(src("pages/userDashboard/ProfileView.tsx")).toMatch(/model-internals-toggle/);
  });
});
