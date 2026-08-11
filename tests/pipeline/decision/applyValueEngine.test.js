import assert from "node:assert/strict";
import { test } from "node:test";
import { applyValueEngine } from "../../../server-utils/pipeline/decision/applyValueEngine.js";

const baseInput = {
  cardsQuote: null,
  leagueParams: {},
  modularScores: null,
  cornersBlock: null,
  doubleChanceQuote: null,
  bttsQuote: null,
  goals15Quote: null,
  goals25Quote: null,
  goals35Quote: null,
  marketOdds: null,
  cornersPick: null,
  dataQuality: 0.8,
  maxConf: 60,
  leagueStakeCap: 3,
  cooldownCap: 3,
  fixtureId: 12345,
  valueEngine: null,
  valueDetected: false,
  valueType: "",
  finalEv: 0,
  finalKelly: 0,
  stakingCompact: "",
  reasonCodes: []
};

test("applyValueEngine promotes a clear positive-EV market and recalculates the stake", () => {
  const out = applyValueEngine({
    ...baseInput,
    pOut: { p1: 60, pX: 25, p2: 15 },
    odds: { home: 2.2, draw: 3.3, away: 4.0, bookmakersUsed: 5 }
  });
  assert.equal(out.valueDetected, true);
  assert.equal(out.valueType, "1");
  assert.ok(out.finalEv > 0);
  assert.ok(out.finalKelly > 0);
  assert.ok(out.stakingCompact.includes("S:") && out.stakingCompact.includes("E:"));
  assert.ok(out.reasonCodes.includes("value_engine_pro"));
  assert.equal(out.valueEngine.detected, true);
  assert.equal(out.valueEngine.recommendable, true);
  assert.equal(out.valueEngine.bestMarket.type, "1");
});

test("applyValueEngine leaves valueDetected false when every candidate is negative/zero EV", () => {
  const out = applyValueEngine({
    ...baseInput,
    pOut: { p1: 20, pX: 30, p2: 50 },
    odds: { home: 1.5, draw: 2.0, away: 1.8, bookmakersUsed: 5 }
  });
  assert.equal(out.valueDetected, false);
  assert.equal(out.stakingCompact, "");
  assert.equal(out.valueEngine.detected, false);
  assert.equal(out.valueEngine.recommendable, false);
});

test("applyValueEngine falls back to an empty valueEngine on internal failure without throwing", () => {
  // Cards probabilities are no longer derived here (Stage08 supplies already-repriced
  // selections), so `leagueParams: null` is harmless now. Force a genuine failure inside
  // candidate construction instead — the guarantee under test is that a value-engine
  // fault can never fail predict.
  const explodingProbs = new Proxy(
    {},
    {
      get() {
        throw new Error("simulated internal failure");
      }
    }
  );
  const out = applyValueEngine({
    ...baseInput,
    pOut: explodingProbs,
    odds: { home: 2.2, draw: 3.3, away: 4.0, bookmakersUsed: 5 }
  });
  assert.equal(out.valueDetected, false);
  assert.equal(out.valueEngine.detected, false);
  assert.equal(out.valueEngine.markets.length, 0);
});
