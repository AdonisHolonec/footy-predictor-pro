import test from "node:test";
import assert from "node:assert/strict";

import { computeDataHealth } from "../../server-utils/metaLearning/MetaDataHealth.js";
import { STATS } from "../../server-utils/metaLearning/metaLearningConfig.js";

const PROVIDER_KEY_BY_ID = new Map([
  [1, "predictor_v3"],
  [2, "api_football"]
]);

function selection(overrides = {}) {
  return {
    fixture_id: 1,
    provider_id: 1,
    market_family: "1x2",
    selection: "1",
    is_primary: true,
    signal_quality: 1,
    priced_from: "own_quote",
    result: "win",
    kickoff_at: "2026-08-05T18:00:00.000Z",
    ...overrides
  };
}

/** n paired fixtures where our side wins and theirs loses => n discordant pairs. */
function discordantPairs(n, startId = 1) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const fixtureId = startId + i;
    rows.push(selection({ fixture_id: fixtureId, provider_id: 1, result: "win" }));
    rows.push(
      selection({ fixture_id: fixtureId, provider_id: 2, result: "loss", priced_from: "our_recorded_1x2" })
    );
  }
  return rows;
}

test("discordant pairs are counted, concordant ones are not", () => {
  const selections = [
    // discordant: only ours correct
    selection({ fixture_id: 1, provider_id: 1, result: "win" }),
    selection({ fixture_id: 1, provider_id: 2, result: "loss" }),
    // discordant: only theirs correct
    selection({ fixture_id: 2, provider_id: 1, result: "loss" }),
    selection({ fixture_id: 2, provider_id: 2, result: "win" }),
    // concordant: both correct — carries no information about who is better
    selection({ fixture_id: 3, provider_id: 1, result: "win" }),
    selection({ fixture_id: 3, provider_id: 2, result: "win" }),
    // concordant: both wrong
    selection({ fixture_id: 4, provider_id: 1, result: "loss" }),
    selection({ fixture_id: 4, provider_id: 2, result: "loss" })
  ];

  const { power } = computeDataHealth({ selections, windowDays: 30, providerKeyById: PROVIDER_KEY_BY_ID });

  assert.equal(power.settledPairs, 4);
  assert.equal(power.onlyOursCorrect, 1);
  assert.equal(power.onlyTheirsCorrect, 1);
  assert.equal(power.bothCorrect, 1);
  assert.equal(power.bothWrong, 1);
  assert.equal(power.discordantN, 2, "the real sample size is only the discordant cells");
});

test("readiness stays insufficient_data below the leaning floor", () => {
  const { power } = computeDataHealth({
    selections: discordantPairs(STATS.minDiscordantLeaning - 1),
    windowDays: 30,
    providerKeyById: PROVIDER_KEY_BY_ID
  });
  assert.equal(power.readiness, "insufficient_data");
});

test("readiness reaches leaning then dominant as discordant pairs accrue", () => {
  const leaning = computeDataHealth({
    selections: discordantPairs(STATS.minDiscordantLeaning),
    windowDays: 30,
    providerKeyById: PROVIDER_KEY_BY_ID
  });
  assert.equal(leaning.power.readiness, "leaning_possible");

  const dominant = computeDataHealth({
    selections: discordantPairs(STATS.minDiscordantDominant),
    windowDays: 30,
    providerKeyById: PROVIDER_KEY_BY_ID
  });
  assert.equal(dominant.power.readiness, "dominant_possible");
  assert.equal(dominant.power.projectedDaysToDominant, 0, "already reached");
});

test("days-to-support is projected from the observed accrual rate", () => {
  // 10 discordant pairs over 100 days = 0.1/day; reaching 25 needs 15 more => 150 days.
  const { power } = computeDataHealth({
    selections: discordantPairs(10),
    windowDays: 100,
    providerKeyById: PROVIDER_KEY_BY_ID
  });
  assert.equal(power.discordantPerDay, 0.1);
  assert.equal(power.projectedDaysToDominant, Math.ceil((STATS.minDiscordantDominant - 10) / 0.1));
});

test("days-to-support is null (unknown) when nothing has accrued, never optimistic", () => {
  const { power } = computeDataHealth({
    selections: [selection({ provider_id: 1, result: "pending" })],
    windowDays: 30,
    providerKeyById: PROVIDER_KEY_BY_ID
  });
  assert.equal(power.discordantN, 0);
  assert.equal(power.projectedDaysToDominant, null, "no accrual means unknown, not soon");
});

test("comparability is the share of our settled picks that could be paired at all", () => {
  const selections = [
    // paired and settled
    selection({ fixture_id: 1, provider_id: 1, result: "win" }),
    selection({ fixture_id: 1, provider_id: 2, result: "loss" }),
    // our settled pick with no provider counterpart
    selection({ fixture_id: 2, provider_id: 1, result: "loss" }),
    // our settled corners pick — structurally uncomparable
    selection({ fixture_id: 3, provider_id: 1, market_family: "corners", selection: "Over 8.5", result: "win" }),
    // our unsettled pick does not count in the denominator
    selection({ fixture_id: 4, provider_id: 1, result: "pending" })
  ];

  const { coverage } = computeDataHealth({
    selections,
    windowDays: 30,
    providerKeyById: PROVIDER_KEY_BY_ID
  });

  assert.equal(coverage.ourSelections, 4);
  assert.equal(coverage.ourSettled, 3);
  assert.equal(coverage.comparabilityPct, 33.33);
  assert.equal(coverage.noExternalCounterpartPct, 25);
});

test("families with no external counterpart are labelled, not scored as failures", () => {
  const selections = [
    selection({ fixture_id: 1, provider_id: 1, market_family: "corners", selection: "Over 8.5", result: "loss" }),
    selection({ fixture_id: 2, provider_id: 1, market_family: "cards", selection: "Over 3.5", result: "loss" }),
    selection({ fixture_id: 3, provider_id: 1, market_family: "1x2", result: "win" }),
    selection({ fixture_id: 3, provider_id: 2, market_family: "1x2", result: "loss" })
  ];

  const { byFamily } = computeDataHealth({ selections, windowDays: 30, providerKeyById: PROVIDER_KEY_BY_ID });

  const corners = byFamily.find((f) => f.family === "corners");
  assert.equal(corners.externallyComparable, false);
  assert.equal(corners.readiness, "no_external_counterpart");
  assert.equal(corners.projectedDaysToDominant, null);

  const oneXTwo = byFamily.find((f) => f.family === "1x2");
  assert.equal(oneXTwo.externallyComparable, true);
  assert.equal(oneXTwo.discordantN, 1);
  assert.equal(oneXTwo.readiness, "insufficient_data");
});

test("provider price coverage and advice share are reported for honesty", () => {
  const selections = [
    selection({ fixture_id: 1, provider_id: 2, priced_from: "our_recorded_1x2", signal_quality: 1 }),
    selection({ fixture_id: 2, provider_id: 2, priced_from: "unpriced", signal_quality: 3 }),
    selection({ fixture_id: 3, provider_id: 2, priced_from: "unpriced", signal_quality: 1 }),
    selection({ fixture_id: 4, provider_id: 2, priced_from: "our_recorded_1x2", signal_quality: 1 })
  ];

  const { coverage } = computeDataHealth({ selections, windowDays: 30, providerKeyById: PROVIDER_KEY_BY_ID });
  assert.equal(coverage.providerPricedCoveragePct, 50);
  assert.equal(coverage.adviceSourcedPct, 25);
});

test("Sprint 1 reports no hit rate anywhere — power, not performance", () => {
  const bundle = computeDataHealth({
    selections: discordantPairs(30),
    windowDays: 30,
    providerKeyById: PROVIDER_KEY_BY_ID
  });
  const serialized = JSON.stringify(bundle);
  assert.ok(!/hitRate|hit_rate/.test(serialized), "Data Health must not imply a who-is-better verdict");
});

test("an empty input yields nulls rather than zeroes that read as findings", () => {
  const { coverage, power } = computeDataHealth({
    selections: [],
    windowDays: 30,
    providerKeyById: PROVIDER_KEY_BY_ID
  });
  assert.equal(coverage.comparabilityPct, null);
  assert.equal(coverage.adviceSourcedPct, null);
  assert.equal(power.discordantN, 0);
  assert.equal(power.readiness, "insufficient_data");
});
