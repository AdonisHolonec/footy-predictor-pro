import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeSection from "./HomeSection";
import PredictionFocusCard from "./PredictionFocusCard";
import { canShowSpecialBet } from "../../pages/userDashboard/helpers";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";

/** Typed leaf access: the catalogues are `Dict` (string | nested), so cast once here. */
type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;

/**
 * UX-0 quick wins — behavioural pins for the information-hierarchy cleanup.
 *
 * Every block below guards one audited defect: a fixture rendered twice on Home,
 * a date line that ignored the browsed date, an apology row on the card, a
 * 32 px favourite target, a destination without a pointer route, a filter hidden
 * on mobile, a search field that opened a dialog over itself, a role string used
 * as an entitlement, and engineering copy reaching end users.
 */

/** Weather is a network hook; the card must not depend on it in tests. */
const weatherState: { weather: { tempC: number; code: number } | null } = { weather: null };
vi.mock("../../hooks/useKickoffWeather", () => ({
  useKickoffWeather: () => ({ weather: weatherState.weather, loading: false }),
  weatherCodeKey: () => "weather.clear"
}));

/** Home pulls two self-contained sub-products that fetch; neither is under test here. */
vi.mock("./GlobalSpecialBetSection", () => ({ default: () => null }));
vi.mock("./RecentPerformanceCard", () => ({ default: () => null }));
vi.mock("./FeaturedPredictionCard", () => ({
  default: ({ match }: { match: PredictionRow }) => <div data-testid="featured">{match.teams.home}</div>
}));

afterEach(() => {
  cleanup();
  weatherState.weather = null;
});

function row(id: number, home: string, confidence: number, extra: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id,
    leagueId: 39,
    league: "Premier League",
    teams: { home, away: `${home} Away` },
    kickoff: "2026-08-25T17:30:00.000Z",
    status: "NS",
    probs: { p1: 0.5, pX: 0.25, p2: 0.25 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence },
    ...extra
  } as unknown as PredictionRow;
}

function renderHome(overrides: Record<string, unknown> = {}) {
  const matches = [row(1, "Arsenal", 88), row(2, "Chelsea", 81), row(3, "Leeds", 76), row(4, "Wolves", 72)];
  render(
    <HomeSection
      matches={matches}
      counts={{ total: matches.length, value: 0, highConfidence: 4 }}
      analysisMatch={matches[0]}
      liveCount={0}
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
  return matches;
}

/** Text nodes mentioning a team outside the (mocked) featured slot. */
function outsideFeatured(pattern: RegExp): HTMLElement[] {
  return screen.queryAllByText(pattern).filter((el) => el.closest("[data-testid='featured']") == null);
}

describe("UX-0 · Home: featured pick is not repeated in Top picks", () => {
  it("drops the featured fixture from Top picks and still fills three slots from the rest", () => {
    renderHome();
    expect(screen.getByTestId("featured").textContent).toBe("Arsenal");
    expect(outsideFeatured(/^Arsenal$/)).toHaveLength(0);
    for (const team of ["Chelsea", "Leeds", "Wolves"]) {
      expect(outsideFeatured(new RegExp(`^${team}$`)).length).toBeGreaterThan(0);
    }
  });

  it("does not fabricate placeholders when fewer than three other picks exist", () => {
    const matches = [row(1, "Arsenal", 88), row(2, "Chelsea", 81)];
    renderHome({ matches, analysisMatch: matches[0], counts: { total: 2, value: 0, highConfidence: 2 } });
    expect(outsideFeatured(/^Chelsea$/).length).toBeGreaterThan(0);
    expect(outsideFeatured(/^Arsenal$/)).toHaveLength(0);
  });

  it("applies no exclusion when there is no featured match", () => {
    renderHome({ analysisMatch: null });
    expect(screen.queryByTestId("featured")).toBeNull();
    expect(outsideFeatured(/^Arsenal$/).length).toBeGreaterThan(0);
  });
});

describe("UX-0 · Home: header date follows the browsed date, not the wall clock", () => {
  it("formats the selected date (a Tuesday) rather than today", () => {
    renderHome({ selectedDate: "2026-08-25" });
    // ro is the default catalogue in tests; en is accepted so the pin is not
    // locale-fragile. 2026-08-25 is a Tuesday either way.
    expect(screen.getByText(/(marți, 25 august|Tuesday, August 25)/)).toBeTruthy();
  });

  it("moves with the selection", () => {
    renderHome({ selectedDate: "2026-12-31" });
    expect(screen.getByText(/(joi, 31 decembrie|Thursday, December 31)/)).toBeTruthy();
  });
});

function renderCard(extra: Partial<PredictionRow> = {}, props: Record<string, unknown> = {}) {
  const onToggleWatch = vi.fn();
  const onOpen = vi.fn();
  const { container } = render(
    <PredictionFocusCard
      row={row(9, "Brentford", 74, extra)}
      accessTier="ultra"
      onOpen={onOpen}
      onToggleWatch={onToggleWatch}
      {...props}
    />
  );
  return { container, onToggleWatch, onOpen };
}

describe("UX-0 · card: referee / weather row renders only what exists", () => {
  it("renders nothing when both are absent — no 'unavailable' or 'n/a' copy", () => {
    const { container } = renderCard({ referee: null } as never);
    expect(container.textContent).not.toMatch(/unavailable|nedisponibil|n\/a/i);
    expect(container.querySelector(`[title="${E.card.referee}"], [title="${R.card.referee}"]`)).toBeNull();
    expect(container.querySelector(`[title="${E.card.weather}"], [title="${R.card.weather}"]`)).toBeNull();
  });

  it("renders the referee alone, without a dangling separator", () => {
    renderCard({ referee: "Michael Oliver" } as never);
    const line = screen.getByText("Michael Oliver").parentElement!;
    expect(line.textContent).toBe("Michael Oliver");
  });

  it("renders the weather alone when only the forecast exists", () => {
    weatherState.weather = { tempC: 18, code: 0 };
    const { container } = renderCard({ referee: "" } as never);
    expect(container.textContent).toMatch(/18°C/);
    expect(container.textContent).not.toMatch(/·\s*18°C/);
  });

  it("keeps both with the separator when both exist", () => {
    weatherState.weather = { tempC: 18, code: 0 };
    renderCard({ referee: "Michael Oliver" } as never);
    const line = screen.getByText("Michael Oliver").parentElement!;
    expect(line.textContent).toMatch(/Michael Oliver\s*·\s*18°C/);
  });
});

describe("UX-0 · card: favourite control owns a 44 px hit area", () => {
  it("is a 44×44 button (h-11 w-11) wrapping a 32 px visual, with the same accessible label", () => {
    const { onToggleWatch, onOpen } = renderCard();
    const star = screen.getByRole("button", { name: new RegExp(`^(${E.card.addFavorite}|${R.card.addFavorite})$`) });
    expect(star.className).toMatch(/\bh-11\b/);
    expect(star.className).toMatch(/\bw-11\b/);
    // The vertical overflow is absorbed by a negative margin so the header row,
    // and therefore the card, keeps its height.
    expect(star.className).toMatch(/-my-1\.5/);
    const visual = star.querySelector("span");
    expect(visual?.className).toMatch(/\bh-8\b/);
    fireEvent.click(star);
    expect(onToggleWatch).toHaveBeenCalledTimes(1);
    // The bigger target must not bubble into the card's own open action.
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("UX-0 · entitlement: Special Bet follows tier + the server's quota-exempt flag", () => {
  it.each([
    ["free", false, false],
    ["premium", false, false],
    ["ultra", false, true],
    ["free", true, true], // admin / bootstrap-admin: the server resolves them to Ultra
    ["premium", true, true],
    ["ultra", true, true],
    [undefined, false, false]
  ] as const)("tier=%s quotaExempt=%s → %s", (tier, exempt, expected) => {
    expect(canShowSpecialBet(tier, exempt)).toBe(expected);
  });
});

describe("UX-0 · copy: engineering language is gone and every new string exists in both catalogues", () => {
  type Dict = Record<string, unknown>;
  const dicts: [string, Dict][] = [
    ["en", en as unknown as Dict],
    ["ro", ro as unknown as Dict]
  ];
  const leaf = (d: Dict, path: string) =>
    path.split(".").reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k], d) as string | undefined;

  it.each(dicts)("%s has every UX-0 key", (_name, dict) => {
    for (const key of [
      "match.marketsScore",
      "match.probConfidence",
      "match.sampleHome",
      "match.sampleAway",
      "match.leagueAverage",
      "match.sampleFallback",
      "match.noStandingsBody",
      "dash.billingSuccess",
      "dash.billingCancelled",
      "dash.rehydratedLabel",
      "dash.quotaCallsSuffix",
      "dash.subscriptionSub"
    ]) {
      expect(leaf(dict, key), key).toBeTypeOf("string");
      expect((leaf(dict, key) as string).length, key).toBeGreaterThan(0);
    }
  });

  it("retired the deploy hint and the apology labels", () => {
    for (const [, dict] of dicts) {
      expect(leaf(dict, "match.noStandingsHint")).toBeUndefined();
      expect(leaf(dict, "card.refereeUnavailable")).toBeUndefined();
      expect(leaf(dict, "card.weatherUnavailable")).toBeUndefined();
      expect(leaf(dict, "card.weatherLoading")).toBeUndefined();
    }
  });

  it("no longer says 'calls' / 'Warm/Predict' / 'deploy' / 'API' to end users", () => {
    for (const [, dict] of dicts) {
      expect(leaf(dict, "dash.quotaCallsSuffix")).not.toMatch(/calls|apeluri/i);
      expect(leaf(dict, "dash.subscriptionSub")).not.toMatch(/Warm\/Predict/);
      expect(leaf(dict, "match.noStandingsBody")).not.toMatch(/API|deploy/i);
      expect(leaf(dict, "dash.billingSuccess")).not.toMatch(/tier|reîncarcă|reload/i);
    }
  });

  it("translates rather than copying: RO and EN differ for every new string", () => {
    for (const key of [
      "match.sampleHome",
      "match.sampleAway",
      "match.sampleFallback",
      "match.noStandingsBody",
      "dash.billingSuccess",
      "dash.billingCancelled",
      "dash.rehydratedLabel",
      "dash.quotaCallsSuffix"
    ]) {
      expect(leaf(dicts[0][1], key), key).not.toBe(leaf(dicts[1][1], key));
    }
  });
});
