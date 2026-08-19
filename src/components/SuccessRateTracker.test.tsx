import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SuccessRateTracker from "./SuccessRateTracker";
import type { HistoryStats } from "../types";
import { en } from "../i18n/en";
import { ro } from "../i18n/ro";

/** Escapes a resolved string so it can be matched literally. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The active locale's rendering of one tracker key, with {n} filled in. */
function line(key: "pendingAwaiting" | "pendingInList" | "pendingOtherDays", n: number): string {
  const pick = (d: typeof en) => (d.tracker as unknown as Record<string, string>)[key];
  const raw = pick(en);
  const roRaw = pick(ro as unknown as typeof en);
  const active = document.documentElement.lang === "en" ? raw : roRaw;
  return active.replace("{n}", String(n));
}

/** Matches the pending headline in whichever locale is active. */
function pendingCopy(n: number): RegExp {
  const pick = (d: typeof en) => (d.tracker as unknown as Record<string, string>).pendingAwaiting;
  const variants = [pick(en), pick(ro as unknown as typeof en)].map((s) => esc(s.replace("{n}", String(n))));
  return new RegExp(variants.join("|"));
}

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

function renderTracker(
  s: HistoryStats,
  pendingHistoryCount = 0,
  breakdown?: { displayedPredsCount: number; pendingAmongDisplayedPreds: number }
) {
  return render(
    <SuccessRateTracker
      stats={s}
      animatedWins={s.wins}
      animatedLosses={s.losses}
      animatedWinRate={s.winRate}
      isWinRatePulsing={false}
      isHistorySyncing={false}
      pendingHistoryCount={pendingHistoryCount}
      displayedPredsCount={breakdown?.displayedPredsCount}
      pendingAmongDisplayedPreds={breakdown?.pendingAmongDisplayedPreds}
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

    // Pending is not a loss. The rate stays absent, and the pending line is
    // what explains why.
    expect(hitRate()).toBe("—");
    expect(screen.getByText(pendingCopy(4))).toBeTruthy();
  });
});

describe("SuccessRateTracker pending copy", () => {
  it("says how many are awaiting a final result, in the active locale", () => {
    renderTracker(stats(2, 1), 5);
    expect(screen.getByText(pendingCopy(5))).toBeTruthy();
  });

  it("reads correctly for a single pending match", () => {
    // `translate` has no plural machinery and the catalogues use one invariant
    // form, so the copy is a label rather than a sentence: "…: 1" is right in
    // both languages where "1 meciuri" would not be.
    renderTracker(stats(1, 1), 1);
    const el = screen.getByText(pendingCopy(1));
    expect(el.textContent).toContain("1");
    expect(el.textContent).not.toMatch(/\b1 (meciuri|matches)\b/);
  });

  it("breaks the count down against the list on screen", () => {
    renderTracker(stats(0, 0), 7, { displayedPredsCount: 3, pendingAmongDisplayedPreds: 2 });

    // 2 of the 7 are in the list being viewed; the other 5 are on other days.
    expect(screen.getByText(new RegExp(esc(line("pendingInList", 2))))).toBeTruthy();
    expect(screen.getByText(new RegExp(esc(line("pendingOtherDays", 5))))).toBeTruthy();
  });

  it("says nothing at all when no prediction is pending", () => {
    renderTracker(stats(2, 1), 0);
    expect(screen.queryByText(pendingCopy(0))).toBeNull();
    expect(hitRate()).toBe("66.7%");
  });

  it("carries the copy in both catalogues, translated", () => {
    for (const key of ["pendingAwaiting", "pendingInList", "pendingOtherDays"] as const) {
      const enLeaf = (en.tracker as unknown as Record<string, string>)[key];
      const roLeaf = (ro.tracker as unknown as Record<string, string>)[key];
      expect(enLeaf, `en.tracker.${key} missing`).toBeTruthy();
      expect(roLeaf, `ro.tracker.${key} missing`).toBeTruthy();
      expect(roLeaf, `ro.tracker.${key} is not translated`).not.toBe(enLeaf);
      // Both must keep the interpolation token the component passes.
      expect(enLeaf).toContain("{n}");
      expect(roLeaf).toContain("{n}");
    }
  });
});
