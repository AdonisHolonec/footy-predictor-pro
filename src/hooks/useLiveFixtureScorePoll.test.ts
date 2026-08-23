import { describe, expect, it } from "vitest";
import { appendMomentumHistory, MAX_MOMENTUM_HISTORY_POINTS, mergeLiveMomentum } from "./useLiveFixtureScorePoll";

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

  it("accumulates one history point per observed minute on the row, carried across polls", () => {
    const first = mergeLiveMomentum(null, sample(50, 50), "1H", 12);
    expect(first?.history).toEqual([{ minute: 12, homeMomentum: 50, awayMomentum: 50 }]);
    const same = mergeLiveMomentum(first, sample(55, 45), "1H", 12);
    expect(same?.history).toHaveLength(1);
    const later = mergeLiveMomentum(same, sample(62, 38), "2H", 63);
    expect(later?.history?.map((p) => p.minute)).toEqual([12, 63]);
    expect(later?.history?.[1]).toEqual({ minute: 63, homeMomentum: 62, awayMomentum: 38 });
  });

  it("a transient null poll keeps the history with the preserved momentum", () => {
    const prev = mergeLiveMomentum(null, sample(62, 38), "2H", 40);
    expect(mergeLiveMomentum(prev, null, "2H")?.history).toHaveLength(1);
  });

  it("never records a reading without a minute or with non-finite momentum", () => {
    expect(appendMomentumHistory(undefined, null, sample(50, 50))).toEqual([]);
    expect(appendMomentumHistory([], Number.NaN, sample(50, 50))).toEqual([]);
    expect(appendMomentumHistory([], 10, { homeMomentum: Number.NaN, awayMomentum: 50 })).toEqual([]);
    expect(appendMomentumHistory([], 10, { homeMomentum: 50, awayMomentum: Number.POSITIVE_INFINITY })).toEqual([]);
  });

  it("caps the history and does not mutate the previous array", () => {
    const previous = Array.from({ length: MAX_MOMENTUM_HISTORY_POINTS }, (_, i) => ({ minute: i, homeMomentum: 50, awayMomentum: 50 }));
    const next = appendMomentumHistory(previous, 999, sample(60, 40));
    expect(next).toHaveLength(MAX_MOMENTUM_HISTORY_POINTS);
    expect(next[next.length - 1].minute).toBe(999);
    expect(previous).toHaveLength(MAX_MOMENTUM_HISTORY_POINTS);
    expect(previous[previous.length - 1].minute).toBe(MAX_MOMENTUM_HISTORY_POINTS - 1);
  });
});
