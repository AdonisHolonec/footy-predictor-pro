import assert from "node:assert/strict";
import { test } from "node:test";
import { computeMatchProbs, strengthRatingsLambdas, syntheticLambdas } from "../server-utils/math.js";

test("computeMatchProbs is deterministic for identical inputs", () => {
  const a = computeMatchProbs(1.8, 1.4, 0, { correlation: 0.12 });
  const b = computeMatchProbs(1.8, 1.4, 999, { correlation: 0.12 });
  assert.equal(a.probs.p1, b.probs.p1);
  assert.equal(a.probs.pX, b.probs.pX);
  assert.equal(a.probs.p2, b.probs.p2);
});

test("1X2 probabilities sum to ~100%", () => {
  const { probs } = computeMatchProbs(3.5, 3.5, 0, {});
  const s = probs.p1 + probs.pX + probs.p2;
  assert.ok(s >= 99.5 && s <= 100.01, `sum=${s}`);
});

test("strengthRatingsLambdas returns stable lambdas", () => {
  const h = { gfHome: 1.5, gaHome: 1.2, gfAway: 1.4, gaAway: 1.3 };
  const a = { gfHome: 1.3, gaHome: 1.4, gfAway: 1.5, gaAway: 1.2 };
  const s = strengthRatingsLambdas(h, a, 1, 1, { leagueAvgGoals: 1.35 });
  assert.ok(s.lambdaHome > 0.2 && s.lambdaHome < 4);
  assert.ok(s.lambdaAway > 0.2 && s.lambdaAway < 4);
});

test("syntheticLambdas exists for regression tests only", () => {
  const s = syntheticLambdas(10, 20);
  assert.ok(s.lambdaHome > 0);
  assert.ok(s.lambdaAway > 0);
});
