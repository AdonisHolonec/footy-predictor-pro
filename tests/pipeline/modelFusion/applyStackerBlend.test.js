import assert from "node:assert/strict";
import { test } from "node:test";
import { applyStackerBlend } from "../../../server-utils/pipeline/modelFusion/applyStackerBlend.js";

const pRaw = { p1: 45, pX: 28, p2: 27 };
const calTriple = { p1: 0.44, pX: 0.29, p2: 0.27 };
const leagueParams = { homeAdv: 1.06, rho: -0.1 };

test("applyStackerBlend falls back to calibrated+market blend when no stacker entry exists for the league", () => {
  const out = applyStackerBlend({
    stackerWeightsMap: new Map(),
    lId: 39,
    method: "poisson",
    odds: { home: 2.1, draw: 3.3, away: 3.4 },
    luckStats: null,
    homeIdStr: "33",
    awayIdStr: "50",
    calTriple,
    eloInfo: null,
    leagueParams,
    marketProbs: { p1: 0.47, pX: 0.27, p2: 0.26 },
    blendW: 0.6,
    pRaw
  });
  assert.equal(out.stackerApplied, false);
  assert.equal(out.stackerEntry, null);
  assert.ok(Number.isFinite(out.dataQualityEarly));
  assert.ok(out.pFinal);
  const sum = out.pFinal.p1 + out.pFinal.pX + out.pFinal.p2;
  assert.ok(Math.abs(sum - 1) < 0.02, `pFinal should sum to ~1, got ${sum}`);
});

test("applyStackerBlend falls back to raw/100 when no calibrated triple and no market", () => {
  const out = applyStackerBlend({
    stackerWeightsMap: new Map(),
    lId: 39,
    method: "poisson",
    odds: null,
    luckStats: null,
    homeIdStr: null,
    awayIdStr: null,
    calTriple: null,
    eloInfo: null,
    leagueParams,
    marketProbs: null,
    blendW: 0.6,
    pRaw
  });
  assert.equal(out.stackerApplied, false);
  assert.ok(Math.abs(out.pFinal.p1 - pRaw.p1 / 100) < 1e-9);
  assert.ok(Math.abs(out.pFinal.pX - pRaw.pX / 100) < 1e-9);
  assert.ok(Math.abs(out.pFinal.p2 - pRaw.p2 / 100) < 1e-9);
});

test("applyStackerBlend ignores an unusable stacker entry (missing weights) and still falls back cleanly", () => {
  const stackerWeightsMap = new Map([["GLOBAL", { weights: null }]]);
  const out = applyStackerBlend({
    stackerWeightsMap,
    lId: 999,
    method: "poisson",
    odds: null,
    luckStats: null,
    homeIdStr: "1",
    awayIdStr: "2",
    calTriple,
    eloInfo: null,
    leagueParams,
    marketProbs: null,
    blendW: 0.6,
    pRaw
  });
  assert.equal(out.stackerApplied, false);
  assert.ok(out.stackerEntry, "GLOBAL fallback entry should still be picked");
  assert.ok(Math.abs(out.pFinal.p1 - calTriple.p1) < 1e-9);
});
