import test from "node:test";
import assert from "node:assert/strict";
import {
  countFirstHalfGoalsFromEvents,
  parseHalftimeGoalsFromFixture
} from "../server-utils/fixtureHalftimeGoals.js";

test("parseHalftimeGoalsFromFixture ignores null (does not become 0)", () => {
  assert.equal(parseHalftimeGoalsFromFixture({ score: { halftime: { home: null, away: null } } }), null);
  assert.equal(parseHalftimeGoalsFromFixture({ score: { halftime: { home: 0, away: 0 } } }), 0);
  assert.equal(parseHalftimeGoalsFromFixture({ score: { halftime: { home: 1, away: 0 } } }), 1);
  assert.equal(parseHalftimeGoalsFromFixture({ score: { halftime: { home: "2", away: "1" } } }), 3);
});

test("countFirstHalfGoalsFromEvents counts only FH goals", () => {
  const events = [
    { type: "Goal", detail: "Normal Goal", time: { elapsed: 12 } },
    { type: "Goal", detail: "Normal Goal", time: { elapsed: 45, extra: 2 } },
    { type: "Goal", detail: "Normal Goal", time: { elapsed: 67 } },
    { type: "Goal", detail: "Missed Penalty", time: { elapsed: 30 } },
    { type: "Card", detail: "Yellow Card", time: { elapsed: 20 } }
  ];
  assert.equal(countFirstHalfGoalsFromEvents(events), 2);
  assert.equal(countFirstHalfGoalsFromEvents([]), null);
});
