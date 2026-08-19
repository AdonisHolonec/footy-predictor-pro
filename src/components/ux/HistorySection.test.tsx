import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import HistorySection from "./HistorySection";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";

afterEach(cleanup);

/** The one performance block. Its content is irrelevant here — its count is not. */
const TRACKER = <div data-testid="tracker">performance tracker</div>;

/**
 * Whichever locale the environment resolves to, the copy must be one of these.
 *
 * `Dict` is recursive (`string | Dict`), so the leaf is narrowed explicitly
 * rather than reached through dotted access, which does not typecheck.
 */
function eitherLocale(key: "emptyTitle" | "empty"): RegExp {
  const leaf = (d: typeof en) => (d.history as unknown as Record<string, string>)[key];
  const variants = [leaf(en), leaf(ro)].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(variants.join("|"));
}

describe("HistorySection", () => {
  it("shows the performance tracker once, with no stat row repeating it", () => {
    render(<HistorySection history={[]} trackerSlot={TRACKER} />);

    expect(screen.getAllByTestId("tracker")).toHaveLength(1);

    // "W / L" was the hardcoded label of the duplicate StatTile row that sat
    // directly beneath the tracker, restating wins and losses the tracker had
    // just shown. It is the locale-independent fingerprint of that row: if it
    // ever comes back, the view is repeating itself again.
    expect(screen.queryByText("W / L")).toBeNull();
  });

  it("explains an empty history instead of stating it", () => {
    render(<HistorySection history={[]} trackerSlot={TRACKER} />);

    // EmptyState gives the user a heading plus a reason. The old bare Card gave
    // one muted line that named "sync" — an internal concept, not a user action.
    expect(screen.getByText(eitherLocale("emptyTitle"))).toBeTruthy();
    expect(screen.getByText(eitherLocale("empty"))).toBeTruthy();
    expect(screen.queryByText(/sync/i)).toBeNull();
  });

  it("still renders match rows when history has entries", () => {
    const history = [
      {
        id: 1,
        kickoff: "2026-08-17T18:00:00Z",
        teams: { home: "Rapid", away: "Farul" },
        validation: "win"
      }
    ] as unknown as Parameters<typeof HistorySection>[0]["history"];

    render(<HistorySection history={history} trackerSlot={TRACKER} />);

    expect(screen.getByText(/Rapid/)).toBeTruthy();
    expect(screen.getAllByTestId("tracker")).toHaveLength(1);
  });
});

/**
 * Exactly what `?view=list` returns: the eight fields the list reads, and none
 * of the analytical payload. Any component in this subtree that quietly assumed
 * a full row would throw here rather than in production.
 */
const LIGHT_ROW = {
  id: 1234567,
  leagueId: 283,
  league: "Liga I - Superliga",
  teams: { home: "FCSB Bucuresti", away: "CFR 1907 Cluj" },
  kickoff: "2026-08-01T18:00:00.000Z",
  status: "FT",
  score: { home: 2, away: 1 },
  recommended: { pick: "Peste 2.5", confidence: 0.71, odd: 1.85 },
  savedAt: "2026-08-01T21:05:00.000Z",
  validation: "win",
  cardMarkets: null,
  cardMarketValidations: { corners: "win" },
  modelVersion: "v3.2.1",
  logos: { home: "https://media.api-sports.io/football/teams/2246.png", away: "https://media.api-sports.io/football/teams/2249.png" },
  probs: { corners: { over85: 0.51 } }
} as unknown as Parameters<typeof HistorySection>[0]["history"][number];

describe("HistorySection on the light list projection", () => {
  it("renders a row that carries no analytical payload", () => {
    render(<HistorySection history={[LIGHT_ROW]} trackerSlot={TRACKER} />);

    // Teams, score and recommendation all come from the light contract now.
    expect(screen.getByText(/FCSB Bucuresti/)).toBeTruthy();
    expect(screen.getByText(/CFR 1907 Cluj/)).toBeTruthy();
    expect(screen.getByText(/2\s*-\s*1|2\s*–\s*1|2:1/)).toBeTruthy();
  });

  it("still renders the logos the light projection carries", () => {
    const { container } = render(<HistorySection history={[LIGHT_ROW]} trackerSlot={TRACKER} />);
    const logos = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src") || "");
    expect(logos.some((s) => s.includes("2246.png")), "home logo missing from the light row").toBe(true);
    expect(logos.some((s) => s.includes("2249.png")), "away logo missing from the light row").toBe(true);
  });

  it("does not fall back to the empty state for a light row", () => {
    render(<HistorySection history={[LIGHT_ROW]} trackerSlot={TRACKER} />);
    expect(screen.queryByText(eitherLocale("emptyTitle"))).toBeNull();
  });
});
