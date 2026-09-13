import test from "node:test";
import assert from "node:assert/strict";
import {
  UNIVERSAL_STATS_DEFAULTS,
  isUniversalStatsEligible,
  readUniversalStatsConfig
} from "../server-utils/settlement/universalStatsTier.js";

/**
 * Tier 3 config + eligibility.
 *
 * The assertions that matter most are the refusals. This tier's failure mode is
 * not "captures too little" — it is reaching a historical fixture, or claiming a
 * row that belongs to a pending recommendation. Both are asserted directly.
 */

const ACTIVE_FROM = "2026-09-20T00:00:00Z";
const NOW = Date.parse("2026-09-21T12:00:00Z");

/** Config as it would be with the tier deliberately armed (tests only). */
const armed = (over = {}) =>
  readUniversalStatsConfig({ HISTORY_SYNC_UNIVERSAL_STATS_FROM: ACTIVE_FROM, ...over });

/** A row that passes every rule, so each test can break exactly one thing. */
const row = (over = {}) => ({
  matchStatus: "FT",
  cardsTotal: null,
  kickoffAt: "2026-09-20T18:00:00Z",
  isRecommendedGap: false,
  needsHigherTierStats: false,
  ...over
});

/* ------------------------------ configuration ------------------------------ */

test("MAX missing falls back to the default 25", () => {
  assert.equal(readUniversalStatsConfig({}).cap, 25);
  assert.equal(UNIVERSAL_STATS_DEFAULTS.cap, 25);
});

test("MAX = 0 disables the tier even with a valid boundary", () => {
  const cfg = armed({ HISTORY_SYNC_UNIVERSAL_STATS_MAX: "0" });
  assert.equal(cfg.cap, 0);
  assert.equal(cfg.enabled, false);
});

test("MAX above the clamp is capped at 60", () => {
  assert.equal(readUniversalStatsConfig({ HISTORY_SYNC_UNIVERSAL_STATS_MAX: "5000" }).cap, 60);
});

test("MAX below zero clamps to 0 and disables", () => {
  const cfg = armed({ HISTORY_SYNC_UNIVERSAL_STATS_MAX: "-10" });
  assert.equal(cfg.cap, 0);
  assert.equal(cfg.enabled, false);
});

test("MAX that is not a number falls back rather than becoming NaN", () => {
  assert.equal(readUniversalStatsConfig({ HISTORY_SYNC_UNIVERSAL_STATS_MAX: "abc" }).cap, 25);
});

test("LOOKBACK missing falls back to 3", () => {
  assert.equal(readUniversalStatsConfig({}).lookbackDays, 3);
});

test("LOOKBACK below 1 clamps to 1", () => {
  assert.equal(readUniversalStatsConfig({ HISTORY_SYNC_UNIVERSAL_LOOKBACK_DAYS: "0" }).lookbackDays, 1);
});

test("LOOKBACK above 7 clamps to 7", () => {
  assert.equal(readUniversalStatsConfig({ HISTORY_SYNC_UNIVERSAL_LOOKBACK_DAYS: "99" }).lookbackDays, 7);
});

test("FROM missing leaves the tier inactive", () => {
  const cfg = readUniversalStatsConfig({});
  assert.equal(cfg.activeFromMs, null);
  assert.equal(cfg.enabled, false);
});

test("FROM valid is parsed and activates the tier", () => {
  const cfg = armed();
  assert.equal(cfg.activeFromMs, Date.parse(ACTIVE_FROM));
  assert.equal(cfg.enabled, true);
});

test("FROM invalid falls back to inactive, never to an open boundary", () => {
  for (const raw of ["not-a-date", "   ", "2026-13-45"]) {
    const cfg = readUniversalStatsConfig({ HISTORY_SYNC_UNIVERSAL_STATS_FROM: raw });
    assert.equal(cfg.activeFromMs, null, `expected inactive for ${JSON.stringify(raw)}`);
    assert.equal(cfg.enabled, false);
  }
});

test("SHIPPED STATE: an empty environment yields an inert tier", () => {
  const cfg = readUniversalStatsConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(isUniversalStatsEligible(row(), cfg, NOW), false);
});

/* ------------------------------- eligibility ------------------------------- */

test("A. a finished, uncaptured, in-window residual row is eligible", () => {
  assert.equal(isUniversalStatsEligible(row(), armed(), NOW), true);
});

test("B/C. AET and PEN count as finished", () => {
  assert.equal(isUniversalStatsEligible(row({ matchStatus: "AET" }), armed(), NOW), true);
  assert.equal(isUniversalStatsEligible(row({ matchStatus: "PEN" }), armed(), NOW), true);
});

test("D. an unfinished fixture is never eligible", () => {
  for (const s of ["NS", "1H", "HT", "2H", "PST", "CANC", ""]) {
    assert.equal(isUniversalStatsEligible(row({ matchStatus: s }), armed(), NOW), false, s);
  }
});

test("E. a row that already has cards is not re-requested", () => {
  assert.equal(isUniversalStatsEligible(row({ cardsTotal: 4 }), armed(), NOW), false);
});

test("E2. a genuine 0-card match counts as captured, not as missing", () => {
  // `!cardsTotal` would wrongly re-request this one forever.
  assert.equal(isUniversalStatsEligible(row({ cardsTotal: 0 }), armed(), NOW), false);
});

test("F. a Tier 1 row (recommended gap) is never claimed by Tier 3", () => {
  assert.equal(isUniversalStatsEligible(row({ isRecommendedGap: true }), armed(), NOW), false);
});

test("G. a Tier 2 row (needs market totals) is never claimed by Tier 3", () => {
  assert.equal(isUniversalStatsEligible(row({ needsHigherTierStats: true }), armed(), NOW), false);
});

test("H. a kickoff before the activation boundary is refused", () => {
  assert.equal(isUniversalStatsEligible(row({ kickoffAt: "2026-09-19T23:59:59Z" }), armed(), NOW), false);
});

test("H2. NO-BACKFILL: historical months stay out of scope", () => {
  for (const ko of ["2026-04-10T18:00:00Z", "2026-05-15T18:00:00Z", "2026-07-02T18:00:00Z"]) {
    assert.equal(isUniversalStatsEligible(row({ kickoffAt: ko }), armed(), NOW), false, ko);
  }
});

test("I. a kickoff older than the lookback window is refused", () => {
  // Inside the activation boundary but 5 days old, with lookback 3.
  const now = Date.parse("2026-09-27T12:00:00Z");
  assert.equal(isUniversalStatsEligible(row({ kickoffAt: "2026-09-22T18:00:00Z" }), armed(), now), false);
});

test("I2. the lookback bound is what stops the 225-attempt tail", () => {
  const cfg = armed({ HISTORY_SYNC_UNIVERSAL_LOOKBACK_DAYS: "1" });
  const now = Date.parse("2026-09-23T12:00:00Z");
  assert.equal(isUniversalStatsEligible(row({ kickoffAt: "2026-09-21T18:00:00Z" }), cfg, now), false);
});

test("J. with the boundary unset nothing is eligible, whatever the row says", () => {
  const cfg = readUniversalStatsConfig({});
  assert.equal(isUniversalStatsEligible(row(), cfg, NOW), false);
  assert.equal(isUniversalStatsEligible(row({ kickoffAt: "2030-01-01T00:00:00Z" }), cfg, NOW), false);
});

test("K. a kickoff exactly on the boundary is eligible", () => {
  assert.equal(isUniversalStatsEligible(row({ kickoffAt: ACTIVE_FROM }), armed(), NOW), true);
});

test("L. overlapping candidates: higher tiers always win", () => {
  const cfg = armed();
  // Both flags, either flag — Tier 3 refuses in all three shapes.
  assert.equal(isUniversalStatsEligible(row({ isRecommendedGap: true, needsHigherTierStats: true }), cfg, NOW), false);
  assert.equal(isUniversalStatsEligible(row({ isRecommendedGap: true }), cfg, NOW), false);
  assert.equal(isUniversalStatsEligible(row({ needsHigherTierStats: true }), cfg, NOW), false);
  // …and accepts only the residual.
  assert.equal(isUniversalStatsEligible(row(), cfg, NOW), true);
});

test("M. a missing or unparseable kickoff is refused", () => {
  for (const ko of [null, undefined, "", "nonsense"]) {
    assert.equal(isUniversalStatsEligible(row({ kickoffAt: ko }), armed(), NOW), false, String(ko));
  }
});

test("a null row or config never throws and is never eligible", () => {
  assert.equal(isUniversalStatsEligible(null, armed(), NOW), false);
  assert.equal(isUniversalStatsEligible(row(), null, NOW), false);
});
