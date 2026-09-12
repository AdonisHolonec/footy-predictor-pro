import { describe, expect, it } from "vitest";
import { addIsoDay, buildTierDates, clampTierDates, firstUnforecastableDay } from "./helpers";

/**
 * The plan's forward window, asked from TODAY.
 *
 * This exists because `clampTierDates` cannot answer the question the Predict
 * gate needs. Its window is built from the very date it is handed, so the seed
 * is always inside its own allowed set — and when the filter empties, the
 * fallback puts the seed back. It trims a multi-day range; it never refuses a
 * day. The first test below pins that, so nobody "simplifies" the gate back
 * onto it.
 */
const TODAY = "2026-09-12";
const TOMORROW = addIsoDay(TODAY, 1);
const DAY_AFTER = addIsoDay(TODAY, 2);
const YESTERDAY = addIsoDay(TODAY, -1);

describe("clampTierDates cannot police the browsed day", () => {
  it("returns a free account's tomorrow unchanged when tomorrow is the seed", () => {
    expect(clampTierDates(TOMORROW, "free", [TOMORROW])).toEqual([TOMORROW]);
  });
});

describe("firstUnforecastableDay", () => {
  it("free: names tomorrow and the day after", () => {
    expect(firstUnforecastableDay([TOMORROW], TODAY, "free")).toBe(TOMORROW);
    expect(firstUnforecastableDay([DAY_AFTER], TODAY, "free")).toBe(DAY_AFTER);
  });

  it("premium: allows tomorrow, refuses the day after", () => {
    expect(firstUnforecastableDay([TOMORROW], TODAY, "premium")).toBeNull();
    expect(firstUnforecastableDay([DAY_AFTER], TODAY, "premium")).toBe(DAY_AFTER);
  });

  it("ultra: allows both", () => {
    expect(firstUnforecastableDay([TOMORROW, DAY_AFTER], TODAY, "ultra")).toBeNull();
  });

  it("today is forecastable on every tier", () => {
    for (const tier of ["free", "premium", "ultra", undefined]) {
      expect(firstUnforecastableDay([TODAY], TODAY, tier)).toBeNull();
    }
  });

  /*
    Past days are not this gate's business: browsing them is not a plan feature
    and generating for them is refused by the past-day guard instead. Returning
    them here would make a free account's history unreachable.
  */
  it("never refuses a past day, on any tier", () => {
    for (const tier of ["free", "premium", "ultra"]) {
      expect(firstUnforecastableDay([YESTERDAY], TODAY, tier)).toBeNull();
    }
  });

  it("reports the first offender out of a mixed selection", () => {
    expect(firstUnforecastableDay([TODAY, DAY_AFTER], TODAY, "premium")).toBe(DAY_AFTER);
  });

  it("stays in step with the window helper rather than restating it", () => {
    for (const tier of ["free", "premium", "ultra"]) {
      for (const day of buildTierDates(TODAY, tier)) {
        expect(firstUnforecastableDay([day], TODAY, tier)).toBeNull();
      }
    }
  });
});
