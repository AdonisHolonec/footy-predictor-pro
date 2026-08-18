import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HistoryTrustSection from "./HistoryTrustSection";
import type { HistoryEntry, PerformanceLeagueBreakdown } from "../../types";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";

afterEach(cleanup);

/** Copy is asserted against whichever locale the environment resolves to. */
function eitherLocale(key: "trustEmptyTitle" | "trustEmptyDesc" | "trustEmptyCta"): RegExp {
  const leaf = (d: typeof en) => (d.dash as unknown as Record<string, string>)[key];
  const variants = [leaf(en), leaf(ro)].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(variants.join("|"));
}

/** A settled entry for "today", so it lands inside the 7-day window. */
function settledEntry(outcome: "win" | "loss"): HistoryEntry {
  return {
    id: outcome === "win" ? 1 : 2,
    kickoff: new Date().toISOString(),
    teams: { home: "Rapid", away: "Farul" },
    recommended: { pick: "1" },
    validation: outcome,
    cardMarketValidations: { recommended: outcome }
  } as unknown as HistoryEntry;
}

const LEAGUES: PerformanceLeagueBreakdown[] = [
  { leagueId: 39, leagueName: "Premier League", wins: 0, losses: 3, settled: 3, winRate: 0 }
] as unknown as PerformanceLeagueBreakdown[];

/** Every numeric cell in the card, as rendered text. */
function cellTexts() {
  return Array.from(document.querySelectorAll("td")).map((c) => (c.textContent || "").trim());
}

describe("HistoryTrustSection — empty state", () => {
  it("reports no observation as an em dash, never as a measured zero", () => {
    render(<HistoryTrustSection history={[]} leagueBreakdown={[]} onStartPredicting={vi.fn()} />);

    // The 7 day rows and 3 market rows still render — the structure is what
    // tells a new user what will be tracked. What they must NOT do is claim
    // the user played and scored nothing.
    const cells = cellTexts();
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.filter((c) => c === "0")).toEqual([]);
    expect(cells.filter((c) => c === "—").length).toBeGreaterThan(0);
  });

  it("explains the emptiness and offers the next step", () => {
    const onStartPredicting = vi.fn();
    render(<HistoryTrustSection history={[]} leagueBreakdown={[]} onStartPredicting={onStartPredicting} />);

    expect(screen.getByText(eitherLocale("trustEmptyTitle"))).toBeTruthy();
    expect(screen.getByText(eitherLocale("trustEmptyDesc"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: eitherLocale("trustEmptyCta") }));
    expect(onStartPredicting).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the caller offers no next step", () => {
    // The Home insights panel renders this card without ever passing history,
    // so it must not announce "no results yet" to a user who has plenty.
    render(<HistoryTrustSection history={[]} leagueBreakdown={[]} />);

    expect(screen.queryByText(eitherLocale("trustEmptyTitle"))).toBeNull();
    expect(cellTexts().filter((c) => c === "0")).toEqual([]);
  });

  it("keeps both locales in step", () => {
    for (const key of ["trustEmptyTitle", "trustEmptyDesc", "trustEmptyCta"] as const) {
      const enLeaf = (en.dash as unknown as Record<string, string>)[key];
      const roLeaf = (ro.dash as unknown as Record<string, string>)[key];
      expect(enLeaf, `en.dash.${key} missing`).toBeTruthy();
      expect(roLeaf, `ro.dash.${key} missing`).toBeTruthy();
      expect(roLeaf, `ro.dash.${key} is not translated`).not.toBe(enLeaf);
    }
  });
});

describe("HistoryTrustSection — populated state", () => {
  it("keeps a real measured zero when results exist", () => {
    // One loss today: the day settled, so "0 wins" is a measurement and must
    // survive. This is the case a blanket em-dash rule would have destroyed.
    render(
      <HistoryTrustSection history={[settledEntry("loss")]} leagueBreakdown={LEAGUES} onStartPredicting={vi.fn()} />
    );

    expect(cellTexts()).toContain("0");
    expect(screen.queryByText(eitherLocale("trustEmptyTitle"))).toBeNull();
  });

  it("shows the league row's real zero alongside its losses", () => {
    render(<HistoryTrustSection history={[settledEntry("win")]} leagueBreakdown={LEAGUES} onStartPredicting={vi.fn()} />);

    const leagueRow = screen.getByText("Premier League").closest("tr");
    expect(leagueRow).toBeTruthy();
    const cells = within(leagueRow as HTMLElement).getAllByRole("cell").map((c) => (c.textContent || "").trim());
    expect(cells).toEqual(["Premier League", "0", "3", "0%"]);
  });
});
