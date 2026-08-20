import { describe, expect, test } from "vitest";

import type { HistoryEntry, PredictionRow } from "../types";
import { applyLiveStateCarryForward, carryForwardLiveState } from "./liveState";
import { mergePredsWithHistory } from "./appUtils";

/**
 * Live state must survive a stored row landing on top of it.
 *
 * `/api/fixtures?view=live` answers in a few hundred ms and writes momentum, live
 * events and the minute onto `preds`. `/api/history?mine=1` answers seconds later
 * and describes the match as STORED — no momentum, no events, no minute. Because
 * the history response lands last, replacing the row wholesale erased everything
 * the live poll had just written, and the momentum widget fell back to
 * "Momentum unavailable" a couple of seconds after opening a live match.
 *
 * These tests pin the merge from both sides: live state survives an ordinary
 * hydration, and stops surviving the moment the stored row says the match is over.
 */

const MOMENTUM = {
  homeMomentum: 62,
  awayMomentum: 38,
  dominantTeam: "home" as const,
  trend: "up" as const,
  confidence: 75
};

const LIVE_EVENTS = [
  { minute: 23, extra: null, team: "home" as const, type: "goal" as const, player: "A", assist: null }
];

/** The row as the live poll leaves it: momentum, events, minute, live nudge. */
function liveRow(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 101,
    status: "2H",
    kickoff: "2026-08-21T18:00:00Z",
    teams: { home: "Home", away: "Away" },
    recommended: { pick: "1", confidence: 70 },
    score: { home: 1, away: 0, minute: 67, extra: 2, halftime: { home: 1, away: 0 } },
    momentum: MOMENTUM,
    liveEvents: LIVE_EVENTS,
    confidenceEngine: { overall: 70, liveAdjustment: { delta: 3, reason: "aligned" } },
    ...over
  } as unknown as PredictionRow;
}

/** The row as a stored source describes it: no live-only fields at all. */
function storedRow(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 101,
    status: "2H",
    kickoff: "2026-08-21T18:00:00Z",
    teams: { home: "Home", away: "Away" },
    recommended: { pick: "1", confidence: 70 },
    score: { home: 1, away: 0 },
    confidenceEngine: { overall: 70 },
    ...over
  } as unknown as PredictionRow;
}

/* -- the regression this fix exists for ------------------------------------- */

describe("history hydration lands on top of live state", () => {
  test("momentum survives", () => {
    const [merged] = applyLiveStateCarryForward([liveRow()], [storedRow()]);
    expect(merged.momentum).toEqual(MOMENTUM);
  });

  test("live events survive", () => {
    const [merged] = applyLiveStateCarryForward([liveRow()], [storedRow()]);
    expect(merged.liveEvents).toEqual(LIVE_EVENTS);
  });

  test("the live confidence adjustment survives", () => {
    const [merged] = applyLiveStateCarryForward([liveRow()], [storedRow()]);
    expect(merged.confidenceEngine?.liveAdjustment).toEqual({ delta: 3, reason: "aligned" });
  });

  test("score.minute, score.extra and halftime survive", () => {
    const [merged] = applyLiveStateCarryForward([liveRow()], [storedRow()]);
    expect(merged.score?.minute).toBe(67);
    expect(merged.score?.extra).toBe(2);
    expect(merged.score?.halftime).toEqual({ home: 1, away: 0 });
  });

  test("THE regression: a stored row without live fields cannot blank them", () => {
    // Exactly the production sequence — live poll first, history second.
    const live = [liveRow()];
    const hydrated = [storedRow()];

    const [merged] = applyLiveStateCarryForward(live, hydrated);

    // Every field the momentum widget renders from must still be here, or the UI
    // falls through to "Momentum unavailable".
    expect(merged.momentum).toBeTruthy();
    expect(merged.liveEvents?.length).toBe(1);
    expect(merged.score?.minute).toBe(67);
  });

  test("pre-kickoff fields still come from the stored row", () => {
    // The point of enumerating carried fields: the stored row stays authoritative
    // about everything decided before kickoff.
    const live = [liveRow({ recommended: { pick: "STALE", confidence: 1 } } as Partial<PredictionRow>)];
    const [merged] = applyLiveStateCarryForward(live, [storedRow()]);
    expect(merged.recommended.pick).toBe("1");
    expect(merged.recommended.confidence).toBe(70);
  });
});

/* -- the settled escape ------------------------------------------------------ */

describe("the freshly-settled escape", () => {
  test("a final stored row overrides stale live state", () => {
    const [merged] = applyLiveStateCarryForward(
      [liveRow()],
      [storedRow({ status: "FT", score: { home: 2, away: 1 } } as Partial<PredictionRow>)]
    );
    expect(merged.status).toBe("FT");
    expect(merged.score).toEqual({ home: 2, away: 1 });
    // A finished match must not keep rendering a 67' momentum forever.
    expect(merged.momentum).toBeUndefined();
    expect(merged.liveEvents).toBeUndefined();
  });

  test("a non-final stored row preserves live state", () => {
    const [merged] = applyLiveStateCarryForward([liveRow()], [storedRow({ status: "2H" })]);
    expect(merged.momentum).toEqual(MOMENTUM);
    expect(merged.status).toBe("2H");
  });

  test("once the live row is already final the escape does not re-fire", () => {
    // Both sides final: nothing to rescue, and no reason to discard either.
    const merged = carryForwardLiveState(liveRow({ status: "FT" }), storedRow({ status: "FT" }));
    expect(merged.momentum).toEqual(MOMENTUM);
  });
});

/* -- rows with no live counterpart ------------------------------------------- */

describe("rows with no live state", () => {
  test("an unmatched fixture passes through untouched", () => {
    const incoming = storedRow({ id: 999 } as Partial<PredictionRow>);
    const [merged] = applyLiveStateCarryForward([liveRow()], [incoming]);
    expect(merged).toBe(incoming);
  });

  test("a first load behaves exactly like a plain assignment", () => {
    const incoming = [storedRow(), storedRow({ id: 202 } as Partial<PredictionRow>)];
    expect(applyLiveStateCarryForward([], incoming)).toEqual(incoming);
  });

  test("empty and missing inputs do not throw", () => {
    expect(applyLiveStateCarryForward([], [])).toEqual([]);
    expect(carryForwardLiveState(undefined, storedRow()).id).toBe(101);
  });

  test("a live row with no momentum yet does not mask the stored one", () => {
    const stored = storedRow({ momentum: MOMENTUM } as Partial<PredictionRow>);
    const [merged] = applyLiveStateCarryForward(
      [liveRow({ momentum: undefined } as Partial<PredictionRow>)],
      [stored]
    );
    expect(merged.momentum).toEqual(MOMENTUM);
  });
});

/* -- score preservation in the history merge --------------------------------- */

function historyEntry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id: 101, status: "2H", score: { home: 1, away: 0 }, ...over } as unknown as HistoryEntry;
}

describe("mergePredsWithHistory keeps score metadata", () => {
  test("minute, extra and halftime survive a server score", () => {
    const [merged] = mergePredsWithHistory([liveRow()], [historyEntry({ score: { home: 2, away: 0 } })]);
    expect(merged.score?.home).toBe(2);
    expect(merged.score?.minute).toBe(67);
    expect(merged.score?.extra).toBe(2);
    expect(merged.score?.halftime).toEqual({ home: 1, away: 0 });
  });

  test("0-0 is a real score, not an absent one", () => {
    const [merged] = mergePredsWithHistory(
      [liveRow({ score: { home: 3, away: 3, minute: 12 } } as Partial<PredictionRow>)],
      [historyEntry({ score: { home: 0, away: 0 } })]
    );
    expect(merged.score?.home).toBe(0);
    expect(merged.score?.away).toBe(0);
    expect(merged.score?.minute).toBe(12);
  });

  test("a null server score leaves the live score untouched", () => {
    // Number(null) is 0 — without an explicit null check this became a 0-0 draw.
    const [merged] = mergePredsWithHistory([liveRow()], [historyEntry({ score: { home: null, away: null } })]);
    expect(merged.score?.home).toBe(1);
    expect(merged.score?.away).toBe(0);
    expect(merged.score?.minute).toBe(67);
  });

  test("a one-sided server score is not a score", () => {
    const [merged] = mergePredsWithHistory([liveRow()], [historyEntry({ score: { home: 2, away: null } })]);
    expect(merged.score?.home).toBe(1);
    expect(merged.score?.minute).toBe(67);
  });

  test("a row with no prior score still adopts the server score", () => {
    const [merged] = mergePredsWithHistory(
      [liveRow({ score: undefined } as Partial<PredictionRow>)],
      [historyEntry({ score: { home: 2, away: 1 } })]
    );
    expect(merged.score).toEqual({ home: 2, away: 1 });
  });

  test("an unchanged row keeps its identity, so no needless re-render", () => {
    const rows = [liveRow()];
    expect(mergePredsWithHistory(rows, [historyEntry()])).toBe(rows);
  });

  test("status still comes from history", () => {
    const [merged] = mergePredsWithHistory([liveRow()], [historyEntry({ status: "FT", score: { home: 1, away: 0 } })]);
    expect(merged.status).toBe("FT");
  });
});
