import { describe, expect, it } from "vitest";
import { mergeLiveMomentum } from "./useLiveFixtureScorePoll";

const sample = (home: number, away: number) => ({
  homeMomentum: home,
  awayMomentum: away,
  dominantTeam: (home - away > 10 ? "home" : away - home > 10 ? "away" : "balanced") as
    | "home"
    | "away"
    | "balanced",
  trend: "stable" as const,
  confidence: 80
});

describe("mergeLiveMomentum", () => {
  it("keeps previous momentum when poll returns null while still in play", () => {
    const prev = sample(62, 38);
    expect(mergeLiveMomentum(prev, null, "2H")).toBe(prev);
  });

  it("clears previous momentum when the match is finished", () => {
    const prev = sample(62, 38);
    expect(mergeLiveMomentum(prev, null, "FT")).toBeNull();
  });

  it("derives trend from previous vs incoming", () => {
    const prev = sample(50, 50);
    const incoming = sample(62, 38);
    const merged = mergeLiveMomentum(prev, incoming, "2H");
    expect(merged?.homeMomentum).toBe(62);
    expect(merged?.trend).toBe("up");
  });
});
