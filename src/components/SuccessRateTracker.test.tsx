import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SuccessRateTracker from "./SuccessRateTracker";
import type { HistoryStats } from "../types";

afterEach(cleanup);

/**
 * Mirrors `historyStatsFromRows`: `winRate` falls back to 0 when nothing has
 * settled, which is exactly the placeholder these tests are about.
 */
function stats(wins: number, losses: number): HistoryStats {
  const settled = wins + losses;
  return {
    wins,
    losses,
    settled,
    winRate: settled ? (wins / settled) * 100 : 0,
    pushes: 0,
    halfWins: 0,
    halfLosses: 0
  } as unknown as HistoryStats;
}

function renderTracker(s: HistoryStats, pendingHistoryCount = 0) {
  return render(
    <SuccessRateTracker
      stats={s}
      animatedWins={s.wins}
      animatedLosses={s.losses}
      animatedWinRate={s.winRate}
      isWinRatePulsing={false}
      isHistorySyncing={false}
      pendingHistoryCount={pendingHistoryCount}
    />
  );
}

/** The hit-rate figure, which is the only percentage the tracker prints. */
function hitRate(): string {
  const match = Array.from(document.querySelectorAll("p")).find((p) =>
    /^(—|\d+\.\d%)$/.test((p.textContent || "").trim())
  );
  return (match?.textContent || "").trim();
}

describe("SuccessRateTracker hit rate", () => {
  it("reports no rate at all when nothing has settled", () => {
    renderTracker(stats(0, 0));

    // NOT "0.0%" — there is no denominator, so there is no rate. Printing one
    // tells a brand-new user they lost every prediction they ever made.
    expect(hitRate()).toBe("—");
  });

  it("still counts the zero wins and zero losses behind it", () => {
    renderTracker(stats(0, 0));

    // Counts are defined where a ratio is not: you have won nothing, and that
    // genuinely is zero. Blanking these too would lose real information.
    const numbers = Array.from(document.querySelectorAll("p")).map((p) => (p.textContent || "").trim());
    expect(numbers.filter((n) => n === "0").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a legitimate 0.0% when results settled and none were won", () => {
    renderTracker(stats(0, 3));

    // The case this fix must not break: three settled losses IS a measured
    // zero success rate, and it has to stay visible.
    expect(hitRate()).toBe("0.0%");
  });

  it("keeps 100.0% when every settled result was won", () => {
    renderTracker(stats(3, 0));
    expect(hitRate()).toBe("100.0%");
  });

  it("keeps a mixed rate", () => {
    renderTracker(stats(2, 1));
    expect(hitRate()).toBe("66.7%");
  });

  it("shows no rate while predictions are pending but nothing has settled", () => {
    renderTracker(stats(0, 0), 4);

    // Pending is not a loss. The rate stays absent, and the existing pending
    // line is what explains why.
    expect(hitRate()).toBe("—");
    expect(screen.getByText(/4 matches without FT result/)).toBeTruthy();
  });
});
