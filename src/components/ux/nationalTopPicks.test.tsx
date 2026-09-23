import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeSection from "./HomeSection";
import type { PredictionRow } from "../../types";

/**
 * National-team TEST MODE: a Nations League prediction that satisfies the existing Top picks
 * eligibility (high confidence or value) is listed exactly like a club prediction. Home applies
 * no competition filter, and must not gain one during the evaluation.
 */

vi.mock("../../hooks/useKickoffWeather", () => ({ useKickoffWeather: () => ({ weather: null, loading: false }), weatherCodeKey: () => "weather.clear" }));
vi.mock("./GlobalSpecialBetSection", () => ({ default: () => null }));
vi.mock("./RecentPerformanceCard", () => ({ default: () => null }));
vi.mock("./FeaturedPredictionCard", () => ({ default: ({ match }: { match: PredictionRow }) => <div data-testid="featured">{match.teams.home}</div> }));

afterEach(cleanup);

function row(id: number, home: string, confidence: number, extra: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id, leagueId: 39, league: "Premier League", teams: { home, away: `${home} Away` }, kickoff: "2026-09-24T17:30:00.000Z", status: "NS",
    probs: { p1: 0.5, pX: 0.25, p2: 0.25 }, recommended: { pick: "Over 2.5", family: "Over/Under", confidence }, ...extra
  } as unknown as PredictionRow;
}
const national = (id: number, home: string, away: string, confidence: number) =>
  row(id, home, confidence, { leagueId: 5, league: "UEFA Nations League", teams: { home, away }, recommended: { pick: "Over 7.5", family: "Corners", confidence } } as Partial<PredictionRow>);

function renderHome(matches: PredictionRow[]) {
  render(
    <HomeSection matches={matches} counts={{ total: matches.length, value: 0, highConfidence: matches.length }} analysisMatch={matches[0]} liveCount={0} accessTier="ultra"
      marketValidationsByFixtureId={new Map()} isWatched={() => false} onToggleWatch={() => {}} onOpenMatch={() => {}} onUpgradeRequired={() => {}} onGoMatches={() => {}}
      onGoLive={() => {}} onGoHistory={() => {}} onGoStatistics={() => {}} onGoTickets={() => {}} trackerStats={{ wins: 0, losses: 0, winRate: 0, settled: 0, pending: 0 } as never} selectedDate="2026-09-24" />
  );
}
const outsideFeatured = (pattern: RegExp) => screen.queryAllByText(pattern).filter((el) => el.closest("[data-testid='featured']") == null);

describe("Top picks · national-team rows are not filtered", () => {
  it("lists a high-confidence Nations League row among club rows", () => {
    renderHome([row(1, "Arsenal", 88), national(1528862, "Netherlands", "Germany", 75), row(2, "Chelsea", 72), row(3, "Leeds", 71), row(4, "Wolves", 60)]);
    expect(outsideFeatured(/^Netherlands$/).length).toBeGreaterThan(0);
  });

  it("lists a 68-confidence Nations League row when it is what the user has (eligibility fallback), exactly like a club row would be", () => {
    renderHome([row(1, "Arsenal", 88), national(1528879, "Kosovo", "Rep. Of Ireland", 68.376), national(1528865, "Norway", "Denmark", 68.376)]);
    expect(outsideFeatured(/^Kosovo$/).length).toBeGreaterThan(0);
    expect(outsideFeatured(/^Norway$/).length).toBeGreaterThan(0);
  });
});
