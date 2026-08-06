/**
 * Ownership invariant: "if a user receives predictions, ownership must exist."
 *
 * Part A — contract of the single shared helper `linkUserPredictionFixtures`.
 * Part B — structural guard: every path that returns predictions writes ownership,
 *          and nothing outside the helper touches `user_prediction_fixtures`.
 *
 * Part B is deliberately source-level (same convention as tests/metaLearning/importBoundary.test.js):
 * the regression this fixes was a short-circuit added ahead of Stage10Persistence, and a behavioural
 * test of Stage01 cannot see a future short-circuit that does not exist yet.
 */

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const USER_ID = "00000000-0000-0000-0000-000000000000";
const OTHER_USER_ID = "11111111-1111-1111-1111-111111111111";

/** Swapped per test; the mocked getSupabaseAdmin always reads this. */
let currentClient = null;

function makeClient({ error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(rows, options) {
          calls.push({ table, rows, options });
          return Promise.resolve({ error });
        }
      };
    }
  };
}

mock.module("../server-utils/supabaseAdmin.js", {
  namedExports: {
    getSupabaseAdmin: () => currentClient,
    assertSupabaseConfigured: () => ({ ok: true })
  }
});

const { linkUserPredictionFixtures } = await import("../server-utils/linkUserPredictionFixtures.js");

/* ---------------------------------------------------------------- Part A */

test("ownership: cron/internal runs (no userId) write nothing and do not fail", async () => {
  currentClient = makeClient();
  const result = await linkUserPredictionFixtures(null, [1, 2, 3]);
  assert.equal(result.ok, true);
  assert.equal(result.linked, 0);
  assert.equal(result.reason, "no_user");
  assert.equal(currentClient.calls.length, 0);
});

test("ownership: empty or unusable fixture ids write nothing", async () => {
  currentClient = makeClient();
  assert.equal((await linkUserPredictionFixtures(USER_ID, [])).linked, 0);
  assert.equal((await linkUserPredictionFixtures(USER_ID, null)).linked, 0);
  assert.equal((await linkUserPredictionFixtures(USER_ID, [null, undefined, "abc", 0, -5])).linked, 0);
  assert.equal(currentClient.calls.length, 0);
});

test("ownership: writes one row per fixture to user_prediction_fixtures", async () => {
  currentClient = makeClient();
  const result = await linkUserPredictionFixtures(USER_ID, [101, 102, 103]);

  assert.equal(result.ok, true);
  assert.equal(result.linked, 3);
  assert.equal(currentClient.calls.length, 1);
  const [call] = currentClient.calls;
  assert.equal(call.table, "user_prediction_fixtures");
  assert.deepEqual(call.rows, [
    { user_id: USER_ID, fixture_id: 101 },
    { user_id: USER_ID, fixture_id: 102 },
    { user_id: USER_ID, fixture_id: 103 }
  ]);
});

test("ownership: duplicate Predict clicks never create duplicate rows (idempotent upsert)", async () => {
  currentClient = makeClient();
  await linkUserPredictionFixtures(USER_ID, [101, 102]);
  await linkUserPredictionFixtures(USER_ID, [101, 102]);

  assert.equal(currentClient.calls.length, 2);
  for (const call of currentClient.calls) {
    // The PK (user_id, fixture_id) plus these options are what make the write idempotent.
    assert.deepEqual(call.options, { onConflict: "user_id,fixture_id", ignoreDuplicates: true });
  }
  assert.deepEqual(currentClient.calls[0].rows, currentClient.calls[1].rows);
});

test("ownership: repeated fixture ids inside one request are de-duplicated before the write", async () => {
  currentClient = makeClient();
  const result = await linkUserPredictionFixtures(USER_ID, [101, 101, "101", 102]);

  assert.equal(result.linked, 2);
  assert.deepEqual(currentClient.calls[0].rows, [
    { user_id: USER_ID, fixture_id: 101 },
    { user_id: USER_ID, fixture_id: 102 }
  ]);
});

test("ownership: multi-device logins link per user, never across users", async () => {
  currentClient = makeClient();
  await linkUserPredictionFixtures(USER_ID, [101]);
  await linkUserPredictionFixtures(OTHER_USER_ID, [101]);

  assert.deepEqual(currentClient.calls[0].rows, [{ user_id: USER_ID, fixture_id: 101 }]);
  assert.deepEqual(currentClient.calls[1].rows, [{ user_id: OTHER_USER_ID, fixture_id: 101 }]);
});

test("ownership: a failed write never throws, so the prediction response still goes out", async () => {
  currentClient = makeClient({ error: { message: "insert or update violates foreign key constraint" } });
  const result = await linkUserPredictionFixtures(USER_ID, [101]);
  assert.equal(result.ok, false);
  assert.match(result.error, /foreign key/);

  currentClient = null; // Supabase not configured
  const unconfigured = await linkUserPredictionFixtures(USER_ID, [101]);
  assert.equal(unconfigured.ok, false);
  assert.equal(unconfigured.error, "supabase_unavailable");
});

/* ---------------------------------------------------------------- Part B */

function readSource(relPath) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

const STAGE01 = readSource("../server-utils/pipeline/stages/Stage01DataCollection.js");
const STAGE10 = readSource("../server-utils/pipeline/stages/Stage10Persistence.js");

test("invariant: every Stage01 short-circuit that returns 200 links ownership first", () => {
  // Stage01 halts jump straight to Stage12Response (PredictorV3.js), skipping Stage10Persistence.
  // A `halt(context, 200, items)` therefore returns predictions with no other chance to write ownership.
  const successHalts = [...STAGE01.matchAll(/halt\(\s*context\s*,\s*200\b/g)].map((m) => m.index);
  const links = [...STAGE01.matchAll(/await linkUserPredictionFixtures\(/g)].map((m) => m.index);

  assert.ok(successHalts.length > 0, "expected Stage01 to contain DB-cache short-circuits");
  assert.equal(
    links.length,
    successHalts.length,
    `every 200-halt needs a preceding ownership link (${successHalts.length} halts, ${links.length} links)`
  );
  for (let i = 0; i < successHalts.length; i += 1) {
    assert.ok(
      links[i] < successHalts[i],
      `ownership link #${i + 1} must be awaited before its halt(context, 200, …)`
    );
  }
});

test("invariant: Stage10Persistence links ownership on the live path", () => {
  assert.match(STAGE10, /await linkUserPredictionFixtures\(/);
});

test("invariant: only the shared helper writes user_prediction_fixtures", () => {
  for (const [name, source] of [
    ["Stage01DataCollection.js", STAGE01],
    ["Stage10Persistence.js", STAGE10]
  ]) {
    assert.doesNotMatch(
      source,
      /from\(["']user_prediction_fixtures["']\)/,
      `${name} must go through linkUserPredictionFixtures, not write the table directly`
    );
  }
  assert.match(
    readSource("../server-utils/linkUserPredictionFixtures.js"),
    /from\(OWNERSHIP_TABLE\)\.upsert\(/
  );
});
