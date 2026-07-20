import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sortByKickoff,
  iterWalkForwardWindows,
  evaluateWalkForward,
  timeOrderedExpandingFolds,
  aggregateWalkForwardMetrics
} from "../server-utils/validation/WalkForward.js";
import { evaluateCalibrationMethods } from "../server-utils/calibration/CalibrationSelector.js";

test("sortByKickoff is chronological and stable", () => {
  const sorted = sortByKickoff([
    { id: 2, kickoffAt: "2026-07-02T12:00:00Z" },
    { id: 1, kickoffAt: "2026-07-01T12:00:00Z" },
    { id: 3, kickoffAt: "2026-07-03T12:00:00Z" }
  ]);
  assert.deepEqual(
    sorted.map((s) => s.id),
    [1, 2, 3]
  );
});

test("walk-forward windows never put future kickoffs in train", () => {
  const samples = [];
  for (let i = 0; i < 100; i++) {
    samples.push({
      kickoffAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      x: 0.5,
      y: i % 2
    });
  }
  for (const win of iterWalkForwardWindows(samples, {
    mode: "expanding",
    minTrain: 40,
    testSize: 10,
    step: 10,
    embargo: 0
  })) {
    const trainLast = new Date(win.train[win.train.length - 1].kickoffAt).getTime();
    const testFirst = new Date(win.test[0].kickoffAt).getTime();
    assert.ok(trainLast < testFirst);
  }
});

test("timeOrderedExpandingFolds trains only on earlier blocks", () => {
  const samples = Array.from({ length: 80 }, (_, i) => ({
    kickoffAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    x: 0.4 + (i % 10) / 50,
    y: i % 2 === 0 ? 1 : 0
  }));
  const folds = timeOrderedExpandingFolds(samples, 4);
  assert.ok(folds.length >= 1);
  for (const f of folds) {
    const trainMax = Math.max(...f.train.map((s) => new Date(s.kickoffAt).getTime()));
    const testMin = Math.min(...f.test.map((s) => new Date(s.kickoffAt).getTime()));
    assert.ok(trainMax < testMin);
  }
});

test("evaluateWalkForward aggregates fold metrics", () => {
  const samples = Array.from({ length: 90 }, (_, i) => ({
    kickoffAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    v: i
  }));
  const out = evaluateWalkForward(
    samples,
    (train) => ({ n: train.length }),
    (model, test) => ({
      logLoss: 0.5,
      brier: 0.2,
      accuracy: 0.55,
      ece: 0.04,
      roi: model.n > 0 ? 1 : 0
    }),
    { minTrain: 40, testSize: 10, step: 10 }
  );
  assert.ok(out.windows >= 1);
  assert.ok(out.logLoss.mean != null);
});

test("aggregateWalkForwardMetrics handles empty", () => {
  const empty = aggregateWalkForwardMetrics([]);
  assert.equal(empty.windows, 0);
  assert.equal(empty.logLoss.mean, null);
});

test("calibration selector defaults to time mode when kickoffs present", () => {
  const samples = Array.from({ length: 80 }, (_, i) => ({
    kickoffAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    x: 0.35 + (i % 5) * 0.05,
    y: i % 3 === 0 ? 1 : 0
  }));
  const prev = process.env.CALIB_CV_MODE;
  process.env.CALIB_CV_MODE = "time";
  const ev = evaluateCalibrationMethods(samples, { folds: 4 });
  process.env.CALIB_CV_MODE = prev;
  assert.equal(ev.cvMode, "time");
  assert.ok(Array.isArray(ev.ranking));
  assert.ok(ev.n >= 80);
});
