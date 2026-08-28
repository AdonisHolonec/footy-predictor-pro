import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MatchListRow from "./MatchListRow";
import HomeSection from "./HomeSection";
import MatchesSection from "./MatchesSection";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";

/**
 * UX-A — the list row. LIST = scan + selection: one structure for pre-match,
 * live and settled; both crests on every row; the prediction is the only
 * accent; confidence and odds are read, not decorated; everything else lives
 * behind the row in Match Detail.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`(${esc(E[ns][key])}|${esc(R[ns][key])})`);

vi.mock("./GlobalSpecialBetSection", () => ({ default: () => null }));
vi.mock("./RecentPerformanceCard", () => ({ default: () => null }));
vi.mock("./FeaturedPredictionCard", () => ({
  default: ({ match }: { match: PredictionRow }) => <div data-testid="featured">{match.teams.home}</div>
}));

afterEach(cleanup);

function row(overrides: Record<string, unknown> = {}): PredictionRow {
  return {
    id: 1,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Arsenal", away: "Chelsea" },
    kickoff: "2026-08-25T17:30:00.000Z",
    status: "NS",
    logos: { home: "https://img/arsenal.png", away: "https://img/chelsea.png" },
    probs: { p1: 0.5, pX: 0.25, p2: 0.25 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 78, odd: 1.85 },
    ...overrides
  } as unknown as PredictionRow;
}

function renderRow(r: PredictionRow, props: Record<string, unknown> = {}) {
  const onOpen = vi.fn();
  const onToggleWatch = vi.fn();
  const { container } = render(
    <ul>
      <MatchListRow row={r} onOpen={onOpen} onToggleWatch={onToggleWatch} {...props} />
    </ul>
  );
  const li = container.querySelector("li")!;
  const slot = (name: string) => li.querySelector(`[data-slot="${name}"]`) as HTMLElement | null;
  return { container, li, slot, onOpen, onToggleWatch };
}

const kickoffText = new Date("2026-08-25T17:30:00.000Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

describe("MatchListRow · pre-match", () => {
  it("[1][11] renders kickoff and 'vs' in the time and centre slots", () => {
    const { slot } = renderRow(row());
    expect(slot("time-value")?.textContent).toBe(kickoffText);
    expect(slot("score")?.textContent).toMatch(either("common", "vs"));
    expect(slot("score")?.textContent).not.toMatch(/\d/);
  });

  it("in play with a null score prints 'vs' — never null–null (live-state audit, case B)", () => {
    const { slot } = renderRow(row({ status: "1H", score: { home: null, away: null, minute: 12 } }));
    expect(slot("score")?.textContent).toMatch(either("common", "vs"));
    expect(slot("score")?.textContent).not.toMatch(/null|\d/);
    expect(slot("time")?.textContent).toMatch(/12/);
  });

  it("in play with 0–0 prints the real score", () => {
    const { slot } = renderRow(row({ status: "1H", score: { home: 0, away: 0, minute: 3 } }));
    expect(slot("score")?.textContent).toMatch(/0–0/);
  });

  it("[4][5] shows both team badges from the existing logo source, same size", () => {
    const { li } = renderRow(row());
    const badges = li.querySelectorAll("[data-team-badge='image']");
    expect(badges).toHaveLength(2);
    expect((badges[0] as HTMLImageElement).src).toContain("arsenal");
    expect((badges[1] as HTMLImageElement).src).toContain("chelsea");
    expect(badges[0].className).toBe(badges[1].className);
  });

  it("[6][7][8] shows prediction, confidence and odds", () => {
    const { slot } = renderRow(row());
    expect(slot("prediction")?.textContent).toMatch(/2\.5/);
    expect(slot("confidence")?.textContent).toBe("78%");
    expect(slot("odds")?.textContent).toBe("1.85");
  });

  it("[9] uses a compact chevron as the details affordance, not a sentence", () => {
    const { slot } = renderRow(row());
    expect(slot("details")?.textContent?.trim()).toBe("›");
    expect(slot("details")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("prediction carries the accent and nothing else does", () => {
    const { slot, li } = renderRow(row());
    expect(slot("prediction")?.className).toMatch(/--fp-accent/);
    expect(slot("confidence")?.className).not.toMatch(/--fp-accent|success|danger/);
    expect(slot("odds")?.className).not.toMatch(/--fp-accent|success|danger/);
    // No red/green before settlement, anywhere in the row.
    expect(li.innerHTML).not.toMatch(/fp-success|fp-danger/);
  });
});

describe("MatchListRow · live", () => {
  const liveRow = row({ status: "2H", score: { home: 1, away: 0, minute: 67 } });

  it("[2][10] renders minute and score in the same two slots", () => {
    const { slot } = renderRow(liveRow);
    expect(slot("time-value")?.textContent).toBe("67'");
    expect(slot("score")?.textContent).toBe("1–0");
  });

  it("formats stoppage time from upstream minute + extra", () => {
    const { slot } = renderRow(row({ status: "1H", score: { home: 0, away: 0, minute: 45, extra: 2 } }));
    expect(slot("time-value")?.textContent).toBe("45+2'");
  });

  it("[3] is the same component with the same structure as pre-match", () => {
    const pre = renderRow(row());
    // The day label ("Astăzi") is pre-match-only by design: a live match is
    // today by definition and a finished one has no upcoming day. Everything
    // else must be structurally identical across states.
    const DAY_SLOTS = new Set(["day", "day-separator"]);
    const slotsOf = (root: HTMLElement) =>
      [...root.querySelectorAll("[data-slot]")].map((el) => el.getAttribute("data-slot")).filter((s) => !DAY_SLOTS.has(s || ""));
    const preSlots = slotsOf(pre.li);
    const preClasses = (pre.li.querySelector("button") as HTMLElement).className;
    const [preBadge] = pre.li.querySelectorAll("[data-team-badge]");
    const preBadgeClass = preBadge.className;
    cleanup();
    const live = renderRow(liveRow);
    const liveSlots = slotsOf(live.li);
    const liveClasses = (live.li.querySelector("button") as HTMLElement).className;
    expect(liveSlots).toEqual(preSlots);
    expect(liveClasses).toBe(preClasses);
    // Every slot keeps its exact classes across states, except the two whose
    // DATA changes colour by design (time → live token, score → live token).
    const classesOf = (root: HTMLElement) =>
      [...root.querySelectorAll("[data-slot]")]
        .filter((el) => !["time", "score"].includes(el.getAttribute("data-slot") || "") && !DAY_SLOTS.has(el.getAttribute("data-slot") || ""))
        .map((el) => `${el.getAttribute("data-slot")}:${el.className}`);
    expect(classesOf(live.li)).toEqual(classesOf(pre.li));
    // Badges keep the same size in play.
    const [liveBadge] = live.li.querySelectorAll("[data-team-badge]");
    expect(liveBadge.className).toBe(preBadgeClass);
  });

  it("marks live with the live token only, never red/green", () => {
    const { slot, li } = renderRow(liveRow);
    expect(slot("time")?.className).toMatch(/--fp-live/);
    expect(li.innerHTML).not.toMatch(/fp-success|fp-danger/);
    expect(li.getAttribute("data-match-row")).toBe("live");
  });

  it("[21][22][23] carries no momentum, market table, win-probability strip or referee/weather", () => {
    const { li } = renderRow(
      row({
        status: "2H",
        score: { home: 1, away: 0, minute: 67 },
        referee: "Michael Oliver",
        momentum: { homeMomentum: 60, awayMomentum: 40, dominantTeam: "home", trend: "up", confidence: 70 }
      })
    );
    expect(li.querySelector("table")).toBeNull();
    expect(li.textContent).not.toMatch(/Michael Oliver|°C/);
    expect(li.textContent).not.toMatch(either("card", "momentum"));
    expect(li.querySelector("[aria-label*='robab']")).toBeNull();
  });
});

describe("MatchListRow · fallbacks and settled", () => {
  it("[12] shows the compact fallback when odds are missing", () => {
    const { slot } = renderRow(row({ recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 78 }, odds: undefined }));
    expect(slot("odds")?.textContent).toBe(E.card.noBookOdd);
  });

  it("[13] keeps the badge slot when a logo is missing or fails to load", () => {
    const { li } = renderRow(row({ logos: { home: undefined, away: "https://img/chelsea.png" } }));
    const fallbacks = li.querySelectorAll("[data-team-badge='fallback']");
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0].textContent).toBe("A");
    const img = li.querySelector("[data-team-badge='image']") as HTMLImageElement;
    fireEvent.error(img);
    expect(li.querySelectorAll("[data-team-badge='fallback']")).toHaveLength(2);
    expect(li.querySelectorAll("[data-team-badge]")).toHaveLength(2);
  });

  it("[14] settled: FT in the time slot, score in the centre, outcome token, prediction no longer accented", () => {
    const { slot, li } = renderRow(
      row({ status: "FT", score: { home: 3, away: 1 }, cardMarketValidations: { recommended: "win" } })
    );
    expect(slot("time-value")?.textContent).toBe(E.list.fullTimeShort);
    expect(slot("score")?.textContent).toBe("3–1");
    expect(slot("prediction")?.className).not.toMatch(/--fp-accent/);
    expect(li.getAttribute("data-match-row")).toBe("final");
    expect(li.textContent).toMatch(either("history", "win"));
  });
});

describe("MatchListRow · interaction and accessibility", () => {
  it("[16] the row is a real button: click and keyboard open the match", () => {
    const { li, onOpen } = renderRow(row());
    const btn = li.querySelector("button")!;
    expect(btn.getAttribute("type")).toBe("button");
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(btn.className).toMatch(/focus-visible:outline/);
  });

  it("has an accessible name carrying teams, time, prediction, confidence, odds and state", () => {
    const { li } = renderRow(row({ status: "2H", score: { home: 1, away: 0, minute: 67 } }));
    const name = li.querySelector("button")!.getAttribute("aria-label")!;
    expect(name).toMatch(/Arsenal/);
    expect(name).toMatch(/Chelsea/);
    expect(name).toMatch(/67'/);
    expect(name).toMatch(/1–0/);
    expect(name).toMatch(/2\.5/);
    expect(name).toMatch(/78%/);
    expect(name).toMatch(/1\.85/);
    expect(name).toMatch(either("card", "live"));
  });

  it("[15] the favourite control is a 44 px sibling that never opens the row", () => {
    const { li, onOpen, onToggleWatch } = renderRow(row());
    const star = screen.getByRole("button", { name: either("card", "addFavorite") });
    expect(star.parentElement).toBe(li);
    expect(star.className).toMatch(/\bh-11\b/);
    expect(star.className).toMatch(/\bw-11\b/);
    fireEvent.click(star);
    expect(onToggleWatch).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(star.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders no favourite slot when the handler is absent", () => {
    const { li } = renderRow(row(), { onToggleWatch: undefined });
    expect(li.querySelectorAll("button")).toHaveLength(1);
  });
});

describe("MatchListRow · layout grammar (390 / 430 / desktop)", () => {
  // jsdom has no layout engine; the breakpoint contract is pinned through the
  // grid grammar: two rows on mobile, one row of six columns from `sm`.
  it("[17][18] mobile: time and chevron span two rows, decision wraps under the teams", () => {
    const { slot } = renderRow(row());
    expect(slot("time")?.className).toMatch(/row-span-2/);
    expect(slot("details")?.className).toMatch(/row-span-2/);
    expect(slot("decision")?.className).toMatch(/col-start-2 row-start-2/);
  });

  it("[19] desktop: the decision block dissolves into its own columns", () => {
    const { slot, li } = renderRow(row());
    expect(slot("decision")?.className).toMatch(/sm:contents/);
    expect(li.querySelector("button")?.className).toMatch(/sm:grid-cols-\[/);
    expect(slot("time")?.className).toMatch(/sm:row-span-1/);
  });

  it("sets no word below 11 px (10 px is reserved for the vs / initial glyphs)", () => {
    const src = readFileSync(join(__dirname, "MatchListRow.tsx"), "utf8");
    const sizes = [...src.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
    expect(src).not.toMatch(/text-\[[0-9]px\]/);
  });
});

function renderHome(overrides: Record<string, unknown> = {}) {
  const matches = [
    row({ id: 1, teams: { home: "Arsenal", away: "Chelsea" }, recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 88, odd: 1.8 } }),
    row({ id: 2, teams: { home: "Leeds", away: "Burnley" }, recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 81, odd: 1.9 } }),
    row({ id: 3, teams: { home: "Rayo", away: "Alaves" }, status: "2H", score: { home: 1, away: 0, minute: 67 } }),
    row({ id: 4, teams: { home: "Wolves", away: "Brentford" }, recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 72, odd: 2.0 } })
  ];
  render(
    <HomeSection
      matches={matches}
      counts={{ total: 4, value: 0, highConfidence: 3 }}
      analysisMatch={matches[0]}
      liveCount={1}
      accessTier="ultra"
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
      trackerStats={{ wins: 0, losses: 0, winRate: 0, settled: 0, pending: 0 } as never}
      selectedDate="2026-08-25"
      {...overrides}
    />
  );
}

describe("Home · list-first composition", () => {
  it("[20] renders rows in lists and never repeats the featured match", () => {
    renderHome();
    expect(screen.getAllByRole("list").length).toBeGreaterThanOrEqual(2);
    const rows = document.querySelectorAll("li[data-match-row]");
    expect(rows).toHaveLength(3); // 1 live + 2 upcoming (Arsenal is featured)
    expect([...rows].some((r) => /Arsenal/.test(r.textContent || ""))).toBe(false);
    expect(screen.getByTestId("featured").textContent).toBe("Arsenal");
  });

  it("live and upcoming rows share the component and grammar", () => {
    renderHome();
    const live = document.querySelector("li[data-match-row='live'] button")!;
    const upcoming = document.querySelector("li[data-match-row='upcoming'] button")!;
    expect(live.className).toBe(upcoming.className);
  });
});

describe("Matches · list composition", () => {
  it("renders every match as a row in one list, no cards, no table", () => {
    render(
      <MatchesSection
        matches={[row({ id: 1 }), row({ id: 2, status: "2H", score: { home: 0, away: 2, minute: 80 } })]}
        accessTier="free"
        marketValidationsByFixtureId={new Map()}
        isWatched={() => false}
        onToggleWatch={() => {}}
        onOpenMatch={() => {}}
        onUpgradeRequired={() => {}}
        matchesFilter="all"
        onSetFilter={() => {}}
        valueOnly={false}
        onToggleValueOnly={() => {}}
        loading={false}
      />
    );
    expect(screen.getAllByRole("list")).toHaveLength(1);
    expect(document.querySelectorAll("li[data-match-row]")).toHaveLength(2);
    expect(document.querySelector("table")).toBeNull();
  });
});
