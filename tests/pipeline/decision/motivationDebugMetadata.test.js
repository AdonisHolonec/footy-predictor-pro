import assert from "node:assert/strict";
import { test } from "node:test";
import { matchedCompetitionKeyword, calculate } from "../../../server-utils/PredictionEngine/MotivationEngine.js";

test("matchedCompetitionKeyword returns null for missing/empty description", () => {
  assert.equal(matchedCompetitionKeyword(null), null);
  assert.equal(matchedCompetitionKeyword(undefined), null);
  assert.equal(matchedCompetitionKeyword(""), null);
  assert.equal(matchedCompetitionKeyword("Mid-table"), null);
});

test("matchedCompetitionKeyword is case-insensitive and returns the matched keyword", () => {
  assert.equal(matchedCompetitionKeyword("Promotion - Champions League (Group Stage)"), "champion");
  assert.equal(matchedCompetitionKeyword("RELEGATION zone"), "relegation");
  assert.equal(matchedCompetitionKeyword("Europa League"), "europa");
});

test("matchedCompetitionKeyword is a pure read-only helper: never mutates calculate()'s output", () => {
  const ctx = {
    homeStandingsRow: { rank: 3, description: "Promotion - Champions League" },
    awayStandingsRow: { rank: 15, description: null }
  };
  const before = calculate(ctx);
  matchedCompetitionKeyword(ctx.homeStandingsRow.description);
  const after = calculate(ctx);
  assert.deepEqual(before, after);
});
