import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SPRINT1_DEPLOY_AT,
  splitByDeployTimestamp,
  buildSprint4ValidationStatus,
  printSprint4ValidationStatus
} from "../server-utils/backtest/Sprint4ValidationStatus.js";

test("splitByDeployTimestamp: buckets by saved_at relative to the deploy timestamp", () => {
  const rows = [
    { saved_at: "2026-07-20T00:00:00.000Z" }, // before
    { saved_at: "2026-07-24T13:00:50.000Z" }, // exactly at deploy -> after (inclusive)
    { saved_at: "2026-07-25T00:00:00.000Z" }, // after
    { saved_at: null } // unknown -> conservatively "before"
  ];
  const split = splitByDeployTimestamp(rows);
  assert.equal(split.deployedAtIso, SPRINT1_DEPLOY_AT);
  assert.equal(split.beforeCount, 2);
  assert.equal(split.afterCount, 2);
});

test("splitByDeployTimestamp: accepts a custom deploy timestamp override", () => {
  const rows = [{ saved_at: "2026-01-01T00:00:00.000Z" }, { saved_at: "2026-06-01T00:00:00.000Z" }];
  const split = splitByDeployTimestamp(rows, "2026-03-01T00:00:00.000Z");
  assert.equal(split.beforeCount, 1);
  assert.equal(split.afterCount, 1);
});

function settledRow(overrides = {}) {
  return {
    score_home: 1,
    score_away: 1,
    saved_at: "2026-07-24T13:15:44.000Z",
    raw_payload: {},
    ...overrides
  };
}

test("buildSprint4ValidationStatus: assembles all four features with the requested field shape", () => {
  const rows = [
    settledRow({
      raw_payload: {
        evaluation: { calibratedSideMarketsPct: { pGG: 45 } },
        probs: { pGG: 53 }
      }
    }),
    settledRow({ score_home: null, score_away: null }) // unsettled, excluded
  ];
  const status = buildSprint4ValidationStatus(rows);
  assert.equal(status.totalRowsAnalyzed, 1);

  assert.equal(status.features.cleanSheet.feature, "Clean Sheet / BTTS");
  assert.equal(status.features.cleanSheet.runtime, "ACTIVE");
  assert.equal(status.features.cleanSheet.historicalSample, 1);
  assert.equal(status.features.cleanSheet.appliedSample, 1);

  assert.equal(status.features.correctScore.feature, "Correct Score Value Engine");
  assert.ok(["ACTIVE", "NOT DETECTED"].includes(status.features.correctScore.engine));
  assert.ok(["AVAILABLE", "MISSING"].includes(status.features.correctScore.odds));

  assert.equal(status.features.motivation.feature, "Motivation Enhancement");
  assert.equal(status.features.motivation.metadata, "MISSING");

  assert.equal(status.features.cards.feature, "Cards Market");
  assert.equal(status.features.cards.runtime, "BLOCKED");
  assert.ok(status.features.cards.blockedReason.length > 0);
});

test("buildSprint4ValidationStatus: never fabricates a verdict when everything is empty", () => {
  const status = buildSprint4ValidationStatus([]);
  assert.equal(status.totalRowsAnalyzed, 0);
  assert.equal(status.features.cleanSheet.verdict, "insufficient_sample");
  assert.equal(status.features.correctScore.verdict, "insufficient_sample");
  assert.equal(status.features.motivation.verdict, "insufficient_sample");
  assert.equal(status.features.cards.verdict, "insufficient_sample");
});

test("printSprint4ValidationStatus: renders the mandatory per-feature block layout", () => {
  const status = buildSprint4ValidationStatus([
    settledRow({
      raw_payload: { evaluation: { calibratedSideMarketsPct: { pGG: 45 } }, probs: { pGG: 53 } }
    })
  ]);
  const text = printSprint4ValidationStatus(status);
  assert.match(text, /=== Deployment Timing ===/);
  assert.match(text, /=== Feature Validation Status ===/);
  assert.match(text, /Feature:\nClean Sheet \/ BTTS/);
  assert.match(text, /Runtime:\nACTIVE/);
  assert.match(text, /Feature:\nCorrect Score Value Engine/);
  assert.match(text, /Engine:\n/);
  assert.match(text, /Odds:\n/);
  assert.match(text, /Feature:\nMotivation Enhancement/);
  assert.match(text, /Metadata:\n/);
  assert.match(text, /Feature:\nCards Market/);
  assert.match(text, /Blocked reason:\n/);
});
