import { describe, expect, it } from "vitest";
import { describeFixture, formatFixtureStatus, formatScore } from "./fixtureStateView";
import type { FixtureState } from "../services/fixtureStateService";

/**
 * Fixture presentation — the scoreboard, never the bet.
 *
 * The assertions that matter most are the refusals: no fabricated 0-0, no
 * fabricated minute, no invented status word, and nothing anywhere that looks
 * at or produces a settlement.
 */

const state = (o: Partial<FixtureState> = {}): FixtureState => ({
  id: 901,
  status: "FT",
  elapsed: null,
  inPlay: false,
  score: { home: 2, away: 1 },
  ...o
});

describe("formatScore", () => {
  it("renders a real score", () => {
    expect(formatScore({ home: 2, away: 1 })).toBe("2 – 1");
  });

  it("renders a genuine goalless draw", () => {
    // 0-0 is only banned as a STAND-IN for missing data, never as a real result.
    expect(formatScore({ home: 0, away: 0 })).toBe("0 – 0");
  });

  it("refuses to invent a score from absence", () => {
    expect(formatScore(null)).toBeNull();
    expect(formatScore(undefined)).toBeNull();
    expect(formatScore({ home: null, away: null })).toBeNull();
  });

  it("refuses a half-known score rather than zero-filling it", () => {
    expect(formatScore({ home: 2, away: null })).toBeNull();
    expect(formatScore({ home: null, away: 1 })).toBeNull();
  });
});

describe("formatFixtureStatus", () => {
  it("shows the upstream code unchanged", () => {
    expect(formatFixtureStatus({ status: "FT", elapsed: null, inPlay: false })).toBe("FT");
    expect(formatFixtureStatus({ status: "NS", elapsed: null, inPlay: false })).toBe("NS");
    expect(formatFixtureStatus({ status: "PST", elapsed: null, inPlay: false })).toBe("PST");
    expect(formatFixtureStatus({ status: "CANC", elapsed: null, inPlay: false })).toBe("CANC");
  });

  it("passes through a code it has never seen rather than guessing", () => {
    expect(formatFixtureStatus({ status: "WO", elapsed: null, inPlay: false })).toBe("WO");
  });

  it("appends the live minute while in play", () => {
    expect(formatFixtureStatus({ status: "2H", elapsed: 67, inPlay: true })).toBe("2H 67'");
  });

  it("never fabricates a minute from a null elapsed", () => {
    // Number(null) === 0 would read as minute zero.
    expect(formatFixtureStatus({ status: "1H", elapsed: null, inPlay: true })).toBe("1H");
  });

  it("does not attach a minute to a finished match", () => {
    expect(formatFixtureStatus({ status: "FT", elapsed: 90, inPlay: false })).toBe("FT");
  });

  it("returns empty for an absent status", () => {
    expect(formatFixtureStatus({ status: "", elapsed: 12, inPlay: true })).toBe("");
  });
});

describe("describeFixture", () => {
  it("describes a finished match with its score", () => {
    const d = describeFixture(state());
    expect(d?.statusLabel).toBe("FT");
    expect(d?.scoreLabel).toBe("2 – 1");
    expect(d?.inPlay).toBe(false);
  });

  it("describes a live match with minute and running score", () => {
    const d = describeFixture(state({ status: "2H", elapsed: 67, inPlay: true, score: { home: 0, away: 0 } }));
    expect(d?.statusLabel).toBe("2H 67'");
    expect(d?.scoreLabel).toBe("0 – 0");
    expect(d?.inPlay).toBe(true);
  });

  it("describes a scheduled match with no score at all", () => {
    const d = describeFixture(state({ status: "NS", score: { home: null, away: null } }));
    expect(d?.statusLabel).toBe("NS");
    expect(d?.scoreLabel).toBeNull();
  });

  it("returns null when the fixture is unknown", () => {
    expect(describeFixture(null)).toBeNull();
    expect(describeFixture(undefined)).toBeNull();
    expect(describeFixture(state({ status: "" }))).toBeNull();
  });

  it("never reports anything resembling a settlement", () => {
    const d = describeFixture(state());
    expect(Object.keys(d || {})).toEqual(["statusLabel", "scoreLabel", "inPlay", "tone"]);
    expect(JSON.stringify(d)).not.toMatch(/won|lost|pending|void|Câștigat|Pierdut/i);
  });
});
