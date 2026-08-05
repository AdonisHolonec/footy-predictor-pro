import test from "node:test";
import assert from "node:assert/strict";
import { buildMomentumEngine } from "../server-utils/momentum/MomentumEngine.js";

test("buildMomentumEngine returns null when one side has no usable stats", () => {
  const engine = buildMomentumEngine({
    home: { possession: 55, shotsTotal: 8, shotsOnTarget: 3, corners: 4, yellowCards: 1, redCards: 0 },
    away: { possession: null, shotsTotal: null, shotsOnTarget: null, corners: null, yellowCards: null, redCards: null }
  });
  assert.equal(engine, null);
});

test("buildMomentumEngine returns scores when both sides have stats", () => {
  const engine = buildMomentumEngine({
    home: { possession: 55, shotsTotal: 8, shotsOnTarget: 3, corners: 4, yellowCards: 1, redCards: 0 },
    away: { possession: 45, shotsTotal: 5, shotsOnTarget: 1, corners: 2, yellowCards: 2, redCards: 0 }
  });
  assert.ok(engine);
  assert.equal(engine.homeMomentum + engine.awayMomentum, 100);
  assert.ok(engine.confidence > 0);
});
