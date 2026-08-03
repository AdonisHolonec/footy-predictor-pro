import test from "node:test";
import assert from "node:assert/strict";
import { buildFingerprint, buildCacheKey, narrateMatchState } from "../server-utils/momentum/narrateMatchState.js";

test("buildFingerprint is stable for the same interpretation and changes when it materially changes", () => {
  const base = {
    momentum: { dominantTeam: "home", trend: "up", confidence: 61, raw: { home: { shotsOnTarget: 6, redCards: 0 }, away: { shotsOnTarget: 3, redCards: 0 } } },
    score: { home: 1, away: 0 }
  };
  const same = {
    // Confidence 58 buckets to the same nearest-10 as 61 (60); SOT gap 6-3=3 buckets to the same
    // nearest-2 as 7-4=3 → neither should bust the cache on poll-to-poll noise.
    momentum: { dominantTeam: "home", trend: "up", confidence: 58, raw: { home: { shotsOnTarget: 7, redCards: 0 }, away: { shotsOnTarget: 4, redCards: 0 } } },
    score: { home: 1, away: 0 }
  };
  const scoreChanged = { ...base, score: { home: 2, away: 0 } };
  const redCardChanged = {
    ...base,
    momentum: { ...base.momentum, raw: { ...base.momentum.raw, home: { ...base.momentum.raw.home, redCards: 1 } } }
  };

  assert.equal(buildFingerprint(base), buildFingerprint(same));
  assert.notEqual(buildFingerprint(base), buildFingerprint(scoreChanged));
  assert.notEqual(buildFingerprint(base), buildFingerprint(redCardChanged));
});

test("buildCacheKey namespaces by locale and fixture so ro/en never collide", () => {
  const fingerprint = "home|up|c60|1-0|r0-0|sot:home4";
  const ro = buildCacheKey({ locale: "ro", fixtureId: 123, fingerprint });
  const en = buildCacheKey({ locale: "en", fixtureId: 123, fingerprint });
  assert.notEqual(ro, en);
  assert.match(ro, /^momentum_narrative:v1:ro:123:/);
});

test("narrateMatchState fails open (returns null, never throws) when no AI Gateway key is configured", async () => {
  const previous = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  try {
    const result = await narrateMatchState({
      locale: "en",
      fixtureId: 999,
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      score: { home: 1, away: 0, minute: 40 },
      momentum: { homeMomentum: 60, awayMomentum: 40, dominantTeam: "home", trend: "stable", confidence: 80 },
      recentEvents: []
    });
    assert.equal(result, null);
  } finally {
    if (previous !== undefined) process.env.AI_GATEWAY_API_KEY = previous;
  }
});

test("narrateMatchState fails open when Momentum Engine confidence is below the gate threshold, even with a key present", async () => {
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "test-key-should-never-be-used";
  try {
    const result = await narrateMatchState({
      locale: "en",
      fixtureId: 998,
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      score: { home: 0, away: 0, minute: 12 },
      // Below CONFIDENCE_GATE_THRESHOLD (50) — too few stat fields populated to ground a sentence.
      momentum: { homeMomentum: 55, awayMomentum: 45, dominantTeam: "home", trend: "stable", confidence: 40 },
      recentEvents: []
    });
    assert.equal(result, null);
  } finally {
    if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previous;
  }
});
