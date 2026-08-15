import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  SYSTEM_K_VALUES,
  SYSTEM_SELECTION_COUNT,
  validateSystemShape
} from "../server-utils/globalSpecialBetEngine.js";
import { SELECTION_STATUS, settleTicket } from "../server-utils/globalSpecialBetSettlement.js";

/**
 * The System product contract: exactly five selections, of which 3, 4 or 5 must
 * win. Nothing else is a System.
 *
 * This is deliberately STRICTER than the settlement engine, which grades any
 * k-of-n it is handed. The two are different jobs: settlement must be able to
 * grade whatever the schema allowed to exist, or a row would hang pending
 * forever; validation decides what is allowed to be created in the first place.
 * The tests below hold both ends of that at once.
 */

const legs = (count) =>
  Array.from({ length: count }, (_, i) => ({ fixtureId: 900 + i, odds: 2.0, status: SELECTION_STATUS.WON }));

// ── 1–3. The three shapes the product sells ───────────────────────────────

test("[1][2][3] five selections with k of 3, 4 or 5 is the contract", () => {
  for (const k of [3, 4, 5]) {
    const out = validateSystemShape({ selections: legs(5), systemK: k });
    assert.equal(out.valid, true, `5/${k} must be valid`);
    assert.equal(out.reason, null);
    assert.equal(out.systemK, k);
    assert.equal(out.selectionCount, 5);
    assert.equal(out.requiredSelectionCount, SYSTEM_SELECTION_COUNT);
  }
  assert.deepEqual([...SYSTEM_K_VALUES], [3, 4, 5]);
});

// ── 4–6, 12. Wrong number of selections ───────────────────────────────────

test("[4][5][6][12] anything but five selections is rejected on its size", () => {
  for (const [count, k] of [
    [3, 3],
    [4, 3],
    [4, 4],
    [6, 3],
    [0, 3],
    [1, 1]
  ]) {
    const out = validateSystemShape({ selections: legs(count), systemK: k });
    assert.equal(out.valid, false, `${count} selections with k=${k}`);
    assert.equal(out.reason, "invalid_selection_count", `${count} selections with k=${k}`);
    assert.equal(out.selectionCount, count);
    assert.equal(out.combinationCount, null);
  }
});

test("[6b] the count is checked before the k, so the caller is sent to the right field", () => {
  // Both fields are wrong here. The size is the one reported.
  const out = validateSystemShape({ selections: legs(4), systemK: 9 });
  assert.equal(out.reason, "invalid_selection_count");
});

test("[6c] a missing or non-array selections field is a count failure, not a crash", () => {
  for (const selections of [undefined, null, "five", 5, {}]) {
    const out = validateSystemShape({ selections, systemK: 3 });
    assert.equal(out.valid, false);
    assert.equal(out.reason, "invalid_selection_count");
    assert.equal(out.selectionCount, 0);
  }
  assert.equal(validateSystemShape().valid, false, "no argument at all is still an answer");
});

// ── 7–8. A k the product does not sell ────────────────────────────────────

test("[7][8] an integer k outside 3..5 is unsupported, not invalid", () => {
  for (const k of [2, 6, 0, -1, 7, 100]) {
    const out = validateSystemShape({ selections: legs(5), systemK: k });
    assert.equal(out.valid, false, `k=${k}`);
    assert.equal(out.reason, "unsupported_k", `k=${k}`);
    assert.equal(out.systemK, k, "the offending value is reported back");
    assert.deepEqual(out.supportedK, [3, 4, 5]);
  }
});

// ── 9–11. No k at all ─────────────────────────────────────────────────────

test("[9][10][11] a k that is not an integer is invalid, and distinct from unsupported", () => {
  for (const k of [undefined, null, 3.5, "3", "three", NaN, Infinity, true, {}]) {
    const out = validateSystemShape({ selections: legs(5), systemK: k });
    assert.equal(out.valid, false, `k=${JSON.stringify(k)}`);
    assert.equal(out.reason, "invalid_k", `k=${JSON.stringify(k)}`);
    assert.equal(out.systemK, null, "there is no k to report");
  }
});

test("[11b] the two k failures are never conflated", () => {
  assert.equal(validateSystemShape({ selections: legs(5), systemK: "3" }).reason, "invalid_k");
  assert.equal(validateSystemShape({ selections: legs(5), systemK: 2 }).reason, "unsupported_k");
});

// ── 13–15. Combination counts, and they match settlement ──────────────────

test("[13][14][15] a valid shape reports C(5,k): 10, 5 and 1", () => {
  assert.equal(validateSystemShape({ selections: legs(5), systemK: 3 }).combinationCount, 10);
  assert.equal(validateSystemShape({ selections: legs(5), systemK: 4 }).combinationCount, 5);
  assert.equal(validateSystemShape({ selections: legs(5), systemK: 5 }).combinationCount, 1);
});

test("[13b] validation and settlement agree on the combination count", () => {
  for (const k of SYSTEM_K_VALUES) {
    const shape = validateSystemShape({ selections: legs(5), systemK: k });
    const settled = settleTicket({ selections: legs(5), k });
    assert.equal(shape.combinationCount, settled.combinationCount, `k=${k}`);
  }
});

// ── 16. Settlement is untouched ───────────────────────────────────────────

test("[16] settleTicket still returns exactly what it returned before", () => {
  const pattern = (chars) =>
    [...chars].map((ch, i) => ({
      odds: 2.0,
      status: { W: SELECTION_STATUS.WON, L: SELECTION_STATUS.LOST, V: SELECTION_STATUS.VOID }[ch],
      fixtureId: 900 + i
    }));

  assert.equal(settleTicket({ selections: pattern("WWWWW"), k: 3 }).returnMultiple, 8.0);
  assert.equal(settleTicket({ selections: pattern("WWWLL"), k: 3 }).returnMultiple, 0.8);
  assert.equal(settleTicket({ selections: pattern("WWVLL"), k: 3 }).returnMultiple, 0.4);
  assert.equal(settleTicket({ selections: pattern("VVVVV"), k: 3 }).status, "void");
  assert.equal(settleTicket({ selections: pattern("VVVVV"), k: 3 }).returnMultiple, 1.0);
  assert.equal(settleTicket({ selections: pattern("WWLLL"), k: 3 }).status, "lost");
  assert.equal(settleTicket({ selections: pattern("WWWWL"), k: 4 }).returnMultiple, 3.2);
  assert.equal(settleTicket({ selections: pattern("WWWWW"), k: 5 }).returnMultiple, 32.0);
});

test("[16b] settlement stays deliberately more general than the product", () => {
  // A 3-of-3 is not a System — validation rejects it — but if such a row existed
  // settlement would still grade it rather than leaving it pending forever.
  assert.equal(validateSystemShape({ selections: legs(3), systemK: 3 }).valid, false);
  assert.equal(settleTicket({ selections: legs(3), k: 3 }).status, "won");
});

// ── Structural guard: this layer activates nothing ────────────────────────

test("[guard] the contract layer neither creates a System nor unlocks one", () => {
  const engine = fs.readFileSync("server-utils/globalSpecialBetEngine.js", "utf8");
  const persistence = fs.readFileSync("server-utils/globalSpecialBets.js", "utf8");
  const api = fs.readFileSync("server-utils/globalSpecialBetsApi.js", "utf8");
  const migration = fs.readFileSync("supabase/migrations/052_gsb_system_tickets.sql", "utf8");
  const view = fs.readFileSync("src/utils/globalSpecialBetView.ts", "utf8");

  // The database still refuses to store a System.
  assert.ok(migration.includes("system_not_enabled"), "the creation guard must remain in place");

  // Nothing built a System, and nothing sent one to the RPC.
  assert.ok(!persistence.includes("buildGlobalSystemBets"), "persistence must not build a System");
  assert.ok(!persistence.includes("validateSystemShape"), "creation is the NEXT increment, not this one");
  assert.ok(!persistence.includes("p_bet_kind"), "no bet kind reaches the RPC");
  assert.ok(!persistence.includes("p_system_k"), "no k reaches the RPC");
  assert.ok(!api.includes("system_k"), "the HTTP layer stays unaware of System");

  // Validation is a pure verdict: no I/O, no database client, no fetch.
  assert.ok(!engine.includes("getSupabaseAdmin"), "the engine stays free of a database client");
  assert.ok(!/\bfetch\s*\(/.test(view), "the presentation helper performs no network call");
});
