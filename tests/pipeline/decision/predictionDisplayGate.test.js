import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_DISPLAY_ODDS,
  passesMinDisplayOdds,
  filterByMinDisplayOdds
} from "../../../server-utils/predictionDisplayGate.js";

test("passesMinDisplayOdds rejects a row whose recommended odd is below the floor", () => {
  assert.equal(passesMinDisplayOdds({ recommended: { odd: 1.2 } }), false);
});

test("passesMinDisplayOdds accepts a row exactly at the floor and above it", () => {
  assert.equal(passesMinDisplayOdds({ recommended: { odd: MIN_DISPLAY_ODDS } }), true);
  assert.equal(passesMinDisplayOdds({ recommended: { odd: 2.4 } }), true);
});

test("passesMinDisplayOdds fails open when the field is missing entirely (undefined)", () => {
  assert.equal(passesMinDisplayOdds({ recommended: {} }), true);
  assert.equal(passesMinDisplayOdds({}), true);
  assert.equal(passesMinDisplayOdds(null), true);
});

test("passesMinDisplayOdds rejects an explicit null odd (Number(null) === 0, pre-existing behavior)", () => {
  assert.equal(passesMinDisplayOdds({ recommended: { odd: null } }), false);
});

test("filterByMinDisplayOdds drops only the sub-floor rows, preserving order of the rest", () => {
  const rows = [
    { id: 1, recommended: { odd: 1.1 } },
    { id: 2, recommended: { odd: 1.25 } },
    { id: 3, recommended: { odd: 3.5 } },
    { id: 4, recommended: { odd: 1.24 } },
    { id: 5, recommended: {} }
  ];
  const out = filterByMinDisplayOdds(rows);
  assert.deepEqual(out.map((r) => r.id), [2, 3, 5]);
});

test("filterByMinDisplayOdds never consumes a slot: filtering happens before any slice/limit", () => {
  const rows = [
    { id: 1, recommended: { odd: 1.1 } },
    { id: 2, recommended: { odd: 2.0 } },
    { id: 3, recommended: { odd: 1.15 } },
    { id: 4, recommended: { odd: 1.8 } },
    { id: 5, recommended: { odd: 1.05 } }
  ];
  const recommendationSlots = 2;
  const top = filterByMinDisplayOdds(rows).slice(0, recommendationSlots);
  assert.equal(top.length, 2);
  assert.deepEqual(top.map((r) => r.id), [2, 4]);
});

test("filterByMinDisplayOdds passes non-array input through unchanged", () => {
  assert.equal(filterByMinDisplayOdds(null), null);
  assert.equal(filterByMinDisplayOdds(undefined), undefined);
});
