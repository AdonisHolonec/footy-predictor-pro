import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MatchModal from "../MatchModal";
import HomeSection from "../ux/HomeSection";
import MatchesSection from "../ux/MatchesSection";
import ConsumerShell from "../ux/ConsumerShell";
import { APP_NAV_ITEMS, PRIMARY_NAV_ITEMS, type MatchesSubFilter } from "../ux/appNav";
import { useWorkspaceRoute } from "../../pages/userDashboard/useWorkspaceRoute";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";

/**
 * UX-D — the live experience at three depths, one grammar:
 *   Today ticker (rows) → Matches › Live (rows) → Match Detail › Live layer
 *   (summary · lean · Momentum · events · stats · story, progressively disclosed).
 * No live analytics in a row; no Live destination; the Matches segment never
 * resets; a finished match is not "live" anywhere.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const startsWith = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})`);
const SRC = join(__dirname, "..", "..");
const src = (rel: string) => readFileSync(join(SRC, rel), "utf8");

vi.mock("../ux/FeaturedPredictionCard", () => ({
  default: ({ match }: { match: PredictionRow }) => <div data-testid="featured">{match.teams.home}</div>
}));
vi.mock("../PredictionLaboratory", () => ({ default: () => null }));
vi.mock("../MonteCarloPanel", () => ({ default: () => null }));

afterEach(cleanup);

const MOMENTUM = {
  homeMomentum: 62,
  awayMomentum: 38,
  dominantTeam: "home" as const,
  trend: "up" as const,
  confidence: 70,
  raw: {
    home: { possession: 58, shotsTotal: 9, shotsOnTarget: 4, corners: 5, yellowCards: 1, redCards: 0 },
    away: { possession: 42, shotsTotal: 4, shotsOnTarget: 1, corners: 2, yellowCards: 2, redCards: 0 }
  }
};
const EVENTS = [
  { minute: 23, team: "home", type: "goal", player: "Saka" },
  { minute: 41, team: "away", type: "yellow", player: "James" },
  { minute: 61, team: "home", type: "goal", player: "Havertz" },
  { minute: 64, team: "away", type: "yellow", player: "Enzo" }
];

function row(id: number, home: string, status = "NS", extra: Record<string, unknown> = {}): PredictionRow {
  const live = status !== "NS" && status !== "FT";
  return {
    id,
    leagueId: 39,
    league: "Premier League",
    teams: { home, away: `${home} Away` },
    // Fixed local 10:05 today: in the past (so the live window is open) and its
    // digits never collide with the pick / confidence / odds the tests count.
    kickoff: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 10, 5).toISOString(),
    status,
    logos: { home: "https://img/h.png", away: "https://img/a.png" },
    score: status === "NS" ? { home: null, away: null, minute: null } : { home: 2, away: 1, minute: live ? 67 : null },
    probs: { p1: 50, pX: 28, p2: 22, pGG: 50, pO25: 55, pU35: 70, pO15: 78 },
    lambdas: { home: 1.6, away: 1.1 },
    predictions: { oneXtwo: "1", gg: "GG", over25: "Over 2.5", correctScore: "1-0" },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 72 + id, odd: 1.8 },
    explanation: { pick: "Over 2.5", confidence: 72, reasons: [{ label: "Both attacks score.", polarity: "positive" }] },
    ...(live ? { momentum: MOMENTUM, liveEvents: EVENTS } : {}),
    ...extra
  } as unknown as PredictionRow;
}

const PRE = [row(1, "Arsenal"), row(2, "Leeds"), row(4, "Wolves")];
const LIVE = [row(3, "Rayo", "2H"), row(5, "Milan", "1H")];
const noop = () => {};

function renderHome(matches: PredictionRow[], liveCount = matches.filter((m) => m.status !== "NS").length) {
  const onOpen = vi.fn();
  const onGoLive = vi.fn();
  render(
    <HomeSection
      matches={matches}
      counts={{ total: matches.length, value: 0, highConfidence: matches.length }}
      analysisMatch={matches.find((m) => m.status === "NS") ?? null}
      liveCount={liveCount}
      accessTier="ultra"
      marketValidationsByFixtureId={new Map()}
      isWatched={() => false}
      onToggleWatch={noop}
      onOpenMatch={onOpen}
      onUpgradeRequired={noop}
      onGoMatches={noop}
      onGoLive={onGoLive}
      onGoHistory={noop}
      onGoStatistics={noop}
      onGoTickets={noop}
      trackerStats={{ wins: 0, losses: 0, winRate: 0, settled: 0, pending: 0 } as never}
      selectedDate="2026-08-25"
    />
  );
  return { onOpen, onGoLive };
}

describe("UX-D · Today live ticker", () => {
  it("[1][19] renders only when live fixtures exist", () => {
    renderHome(PRE);
    expect(screen.queryByTestId("today-live")).toBeNull();
    cleanup();
    renderHome([...PRE, ...LIVE]);
    expect(screen.getByTestId("today-live")).toBeTruthy();
  });

  it("[2][18] uses MatchListRow rows — minute, score, prediction, confidence, odds, and nothing live-analytic", () => {
    renderHome([...PRE, ...LIVE]);
    const ticker = screen.getByTestId("today-live");
    const rows = ticker.querySelectorAll("li[data-match-row='live']");
    expect(rows).toHaveLength(2);
    const r = rows[0];
    expect(r.querySelector("[data-slot='time-value']")?.textContent).toBe("67'");
    expect(r.querySelector("[data-slot='score']")?.textContent).toBe("2–1");
    expect(r.querySelector("[data-slot='prediction']")?.textContent).toMatch(/2\.5/);
    expect(r.querySelector("[data-slot='confidence']")?.textContent).toMatch(/%/);
    expect(r.querySelector("[data-slot='odds']")?.textContent).toBe("1.80");
    expect(ticker.querySelector("[data-testid='momentum-root'], table, [aria-label*='robab']")).toBeNull();
    expect(ticker.textContent).not.toMatch(/Saka|Havertz|possession|Posesie/i);
  });

  it("the ticker opens the match and its 'show all' opens Matches › Live", () => {
    const { onOpen, onGoLive } = renderHome([...PRE, ...LIVE]);
    fireEvent.click(screen.getByTestId("today-live").querySelector("li[data-match-row] > button")!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("today-live").querySelector("button")!);
    expect(onGoLive).toHaveBeenCalledTimes(1);
  });
});

describe("UX-D · Matches › Live", () => {
  it("[3][4][5][6][7][8][9] live and pre-match rows share the component; only time and centre differ", () => {
    render(
      <MatchesSection
        matches={[...PRE, ...LIVE]}
        accessTier="free"
        marketValidationsByFixtureId={new Map()}
        isWatched={() => false}
        onToggleWatch={noop}
        onOpenMatch={noop}
        onUpgradeRequired={noop}
        matchesFilter="all"
        onSetFilter={noop}
        loading={false}
      />
    );
    const pre = document.querySelector("li[data-match-row='upcoming'] > button")!;
    const live = document.querySelector("li[data-match-row='live'] > button")!;
    expect(live.className).toBe(pre.className);
    expect(live.querySelector("[data-slot='time-value']")?.textContent).toBe("67'");
    expect(pre.querySelector("[data-slot='time-value']")?.textContent).not.toMatch(/'/);
    expect(live.querySelector("[data-slot='score']")?.textContent).toBe("2–1");
    expect(pre.querySelector("[data-slot='score']")?.textContent).toMatch(/vs/i);
    for (const slot of ["prediction", "confidence", "odds"]) {
      expect(live.querySelector(`[data-slot='${slot}']`)?.textContent?.trim().length).toBeGreaterThan(0);
    }
    expect(src("components/ux/MatchListRow.tsx")).not.toMatch(/Momentum|LiveWinProbability|liveEvents|momentum\./);
  });

  it("[20] Live is a segment, never a destination; the count badge hides at zero", () => {
    expect(APP_NAV_ITEMS.map((i) => i.id as string)).not.toContain("live");
    expect(PRIMARY_NAV_ITEMS).toHaveLength(5);
    render(
      <ConsumerShell activeNav="matches" onNavigate={noop} date="2026-08-25" onDateChange={noop} liveCount={0}>
        <div />
      </ConsumerShell>
    );
    expect(document.querySelectorAll('[data-nav="matches"] [aria-label]')).toHaveLength(0);
    cleanup();
    render(
      <ConsumerShell activeNav="matches" onNavigate={noop} date="2026-08-25" onDateChange={noop} liveCount={2}>
        <div />
      </ConsumerShell>
    );
    const badges = document.querySelectorAll('[data-nav="matches"] [aria-label]');
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe("2");
  });
});

/** Mirrors UserDashboard's wiring for the filter-preservation invariant. */
function Harness() {
  const { navView, setNavView } = useWorkspaceRoute();
  const [filter, setFilter] = useState<MatchesSubFilter>("all");
  const visible = filter === "live" ? LIVE : filter === "favorites" ? [PRE[1]] : [...PRE, ...LIVE];
  return (
    <ConsumerShell activeNav={navView} onNavigate={setNavView} date="2026-08-25" onDateChange={noop} liveCount={LIVE.length}>
      <span data-testid="segment">{filter}</span>
      {navView === "matches" && (
        <MatchesSection
          matches={visible}
          accessTier="free"
          marketValidationsByFixtureId={new Map()}
          isWatched={() => false}
          onToggleWatch={noop}
          onOpenMatch={noop}
          onUpgradeRequired={noop}
          matchesFilter={filter}
          onSetFilter={setFilter}
          loading={false}
        />
      )}
    </ConsumerShell>
  );
}

describe("UX-D · filter preservation around Live", () => {
  it("[21] entering and leaving Live keeps Favorites; the segment survives a tab switch", () => {
    render(
      <MemoryRouter initialEntries={["/workspace/matches"]}>
        <Routes>
          <Route path="/workspace" element={<Harness />} />
          <Route path="/workspace/:view" element={<Harness />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: startsWith("dash", "filterFavorites") }));
    expect(screen.getByTestId("segment").textContent).toBe("favorites");
    fireEvent.click(screen.getByRole("button", { name: startsWith("dash", "filterLive") }));
    expect(document.querySelectorAll("li[data-match-row='live']")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: startsWith("dash", "filterFavorites") }));
    expect(screen.getByTestId("segment").textContent).toBe("favorites");
    fireEvent.click(screen.getByRole("button", { name: startsWith("dash", "filterLive") }));
    fireEvent.click(document.querySelector('nav.lg\\:hidden [data-nav="history"]')!);
    fireEvent.click(document.querySelector('nav.lg\\:hidden [data-nav="matches"]')!);
    expect(screen.getByTestId("segment").textContent).toBe("live");
    const dash = src("pages/UserDashboard.tsx");
    expect(dash.slice(dash.indexOf("const handleNav"), dash.indexOf("const goLive"))).not.toMatch(/setMatchesFilter|updateFilters/);
  });
});

function renderDetail(m: PredictionRow, props: Record<string, unknown> = {}) {
  render(
    <MatchModal match={m} logoColors={{}} onClose={noop} hashColor={() => "#888"} accessTier="ultra" canShowSpecialBet {...props} />
  );
}
const layer = (name: string) => document.querySelector(`[data-layer="${name}"]`) as HTMLElement | null;
const disclosure = (ns: string, key: string) => screen.getByRole("button", { name: startsWith(ns, key) });

describe("UX-D · Match Detail › Live layer", () => {
  it("[10][11] opens with the Live layer right after xG and the summary visible: minute, momentum direction, recent events", () => {
    renderDetail(LIVE[0]);
    const order = [...document.querySelectorAll("[data-layer]")].map((e) => e.getAttribute("data-layer"));
    expect(order.slice(0, 4)).toEqual(["header", "decision", "xg", "live"]);
    const summary = layer("live")!.querySelector("[data-slot='live-summary']")!;
    expect(summary.textContent).toMatch(/67'/);
    expect(summary.querySelector("[data-slot='live-dominant']")?.textContent).toBe("Rayo");
    const recent = summary.querySelector("[data-slot='live-recent']")!;
    expect(recent.querySelectorAll("[role='img']")).toHaveLength(2);
    expect(recent.textContent).toMatch(/64'/);
    expect(recent.textContent).toMatch(/61'/);
    expect(recent.textContent).not.toMatch(/23'/);
  });

  it("[12][13][14] Momentum, events and stats are separate, collapsed disclosures", () => {
    renderDetail(LIVE[0]);
    for (const [ns, key] of [
      ["card", "momentum"],
      ["detail", "eventsTitle"],
      ["detail", "statsTitle"]
    ] as const) {
      expect(disclosure(ns, key).getAttribute("aria-expanded"), key).toBe("false");
    }
    expect(screen.queryAllByTestId("momentum-root")).toHaveLength(0);
    expect(layer("live")!.querySelector("[data-slot='live-events']")).toBeNull();
    expect(layer("live")!.querySelector("[data-slot='live-stats']")).toBeNull();
  });

  it("[15][16][17] each disclosure reveals the full Momentum timeline, the full event list, the full stats — once", () => {
    renderDetail(LIVE[0]);
    fireEvent.click(disclosure("card", "momentum"));
    expect(screen.getAllByTestId("momentum-root")).toHaveLength(1);
    // The timeline's own nested "Full timeline & stats" panel is off: events and stats are not stated twice.
    expect(screen.queryByRole("button", { name: startsWith("match", "momentumDetails") })).toBeNull();
    fireEvent.click(disclosure("detail", "eventsTitle"));
    const events = layer("live")!.querySelector("[data-slot='live-events']")!;
    expect(events.querySelectorAll("li")).toHaveLength(4);
    expect(events.textContent).toMatch(/Saka/);
    fireEvent.click(disclosure("detail", "statsTitle"));
    const stats = layer("live")!.querySelector("[data-slot='live-stats']")!;
    expect(stats.textContent).toMatch(/58/);
    expect(stats.textContent).toMatch(/42/);
    expect(document.querySelectorAll("[data-slot='live-stats']")).toHaveLength(1);
  });

  it("omits levels whose data is absent — no 'n/a', no waiting copy", () => {
    renderDetail(row(7, "Genoa", "2H", { momentum: { ...MOMENTUM, raw: undefined }, liveEvents: [] }));
    const live = layer("live")!;
    expect(screen.queryByRole("button", { name: startsWith("detail", "eventsTitle") })).toBeNull();
    expect(screen.queryByRole("button", { name: startsWith("detail", "statsTitle") })).toBeNull();
    expect(live.querySelector("[data-slot='live-recent']")).toBeNull();
    expect(live.textContent).not.toMatch(/n\/a|unavailable|waiting|așteapt/i);
  });

  it("Match Story sits after the raw facts, collapsed", () => {
    renderDetail(LIVE[0]);
    expect(disclosure("match", "storyTitle").getAttribute("aria-expanded")).toBe("false");
    const titles = [...layer("live")!.querySelectorAll("button[aria-expanded]")].map((b) => b.textContent || "");
    const storyAt = titles.findIndex((t) => startsWith("match", "storyTitle").test(t));
    const eventsAt = titles.findIndex((t) => startsWith("detail", "eventsTitle").test(t));
    expect(storyAt).toBeGreaterThan(eventsAt);
  });

  it("[22] a finished match carries no Live layer; the header keeps the final score and outcome", () => {
    renderDetail(row(9, "Leeds", "FT", { cardMarketValidations: { recommended: "win" } }));
    expect(layer("live")).toBeNull();
    const header = layer("header")!;
    expect(header.textContent).toMatch(/2–1/);
    expect(header.textContent).toMatch(new RegExp(`${esc(E.list.fullTimeShort)}|${esc(R.list.fullTimeShort)}`));
    expect(header.textContent).toMatch(new RegExp(`${esc(E.history.win)}|${esc(R.history.win)}`));
    expect(document.querySelector("[data-slot='live-summary']")).toBeNull();
  });

  it("[23] accessibility: the live heading names the state, event icons carry labels, disclosures are wired", () => {
    renderDetail(LIVE[0]);
    const live = layer("live")!;
    expect(live.getAttribute("aria-labelledby")).toBe("detail-live-title");
    expect(live.querySelector("#detail-live-title")!.textContent).toMatch(/67'/);
    for (const img of live.querySelectorAll("[role='img']")) {
      expect(img.getAttribute("aria-label")?.length).toBeGreaterThan(0);
    }
    for (const b of live.querySelectorAll("button[aria-expanded]")) {
      expect(b.getAttribute("aria-controls")).toBeTruthy();
    }
  });

  it("[24][25][26] one sticky band, no nested scroll, side panel on desktop — unchanged by the live stack", () => {
    renderDetail(LIVE[0]);
    const panel = document.querySelector("[role='dialog']")!;
    expect([...panel.querySelectorAll("[class*='sticky']")]).toHaveLength(1);
    expect([...panel.querySelectorAll("[class*='overflow-y-auto']")].filter((el) => el !== panel)).toHaveLength(0);
    expect(panel.className).toMatch(/lg:w-\[42vw\]/);
  });
});

describe("UX-D · live-state predicates are documented, not changed", () => {
  it("score strip follows hasLiveScore, Momentum/events/stats follow isFixtureInPlay, polling follows shouldPollFixtureScore", () => {
    const live = src("components/matchModal/LiveLayer.tsx");
    expect(live).toMatch(/hasLiveScore && <LiveWinProbabilityStrip/);
    expect(live).toMatch(/inPlay && momentum &&/);
    expect(live).toMatch(/inPlay && events\.length > 0/);
    expect(live).toMatch(/inPlay && raw && hasStats/);
    expect(src("hooks/useLiveFixtureScorePoll.ts")).toMatch(/export function shouldPollFixtureScore/);
    expect(src("components/MatchModal.tsx")).toMatch(/\(hasLiveScore \|\| isInPlay\) && \(/);
  });
});
