import test from "node:test";
import assert from "node:assert/strict";
import { pickUltraUniqueAllowedFixtures } from "../server-utils/ultraUniqueQuota.js";

function fx(id, leagueId) {
  return { fixture: { id }, league: { id: leagueId } };
}

test("ultra unique: re-runs of known fixtures do not consume new slots", () => {
  const knownIds = new Set(["1", "2", "3"]);
  const { allowed, remainingNew } = pickUltraUniqueAllowedFixtures({
    leagueIds: [39],
    allFixtures: [fx(1, 39), fx(2, 39), fx(3, 39)],
    knownIds,
    dailyLimit: 50,
    requestLimit: 15
  });
  assert.deepEqual([...allowed].sort(), ["1", "2", "3"]);
  assert.equal(remainingNew, 47);
});

test("ultra unique: caps new fixtures at remaining capacity", () => {
  const knownIds = new Set(Array.from({ length: 48 }, (_, i) => String(i + 1)));
  const { allowed, remainingNew } = pickUltraUniqueAllowedFixtures({
    leagueIds: [39],
    allFixtures: [fx(100, 39), fx(101, 39), fx(102, 39)],
    knownIds,
    dailyLimit: 50,
    requestLimit: 15
  });
  assert.equal(allowed.size, 2);
  assert.equal(allowed.has("100"), true);
  assert.equal(allowed.has("101"), true);
  assert.equal(allowed.has("102"), false);
  assert.equal(remainingNew, 0);
});

test("ultra unique: empty when at cap and all candidates are new", () => {
  const knownIds = new Set(Array.from({ length: 50 }, (_, i) => String(i + 1)));
  const { allowed } = pickUltraUniqueAllowedFixtures({
    leagueIds: [39],
    allFixtures: [fx(999, 39)],
    knownIds,
    dailyLimit: 50,
    requestLimit: 15
  });
  assert.equal(allowed.size, 0);
});

test("ultra unique: respects requestLimit with mixed known + new", () => {
  const knownIds = new Set(["1"]);
  const fixtures = Array.from({ length: 20 }, (_, i) => fx(i + 1, 39));
  const { allowed } = pickUltraUniqueAllowedFixtures({
    leagueIds: [39],
    allFixtures: fixtures,
    knownIds,
    dailyLimit: 50,
    requestLimit: 5
  });
  assert.equal(allowed.size, 5);
  assert.equal(allowed.has("1"), true);
});
