import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

/**
 * GSB System foundation (migration 052) — DATABASE integration suite.
 *
 * Everything this increment adds lives in SQL: two columns, two CHECK
 * constraints, a widened identity index and a reissued RPC. None of it is
 * assertable from JavaScript, so it is asserted here, against the production
 * migration chain applied byte for byte.
 *
 * The split this suite proves is the point of the increment:
 *   · the SCHEMA accepts every system shape — 3/5, 4/5, 5/5
 *   · the RPC refuses to write one, because settlement cannot grade k-of-n yet
 * A system row can therefore be reasoned about, indexed and constrained today,
 * and still cannot reach a user.
 *
 * Runs against the same throwaway container as the other GSB database suites;
 * `npm run test:integration:global-special-bets` starts it.
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BET_DATE = "2026-08-09";
const KICKOFF = "2026-08-09T18:00:00Z";
const SCOPE = "39,140";
const LEAGUES = "{39,140}";

function psql(sqlText, { expectFailure = false } = {}) {
  const res = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"],
    { input: sqlText, encoding: "utf8" }
  );
  if (res.error) {
    throw new Error(
      `Cannot reach the test container "${CONTAINER}". Start it with ` +
        `npm run test:integration:global-special-bets. Underlying error: ${res.error.message}`
    );
  }
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  if (!expectFailure && res.status !== 0) throw new Error(`SQL failed:\n${sqlText}\n---\n${stderr}`);
  return { ok: res.status === 0, stdout, stderr };
}

function value(sqlText) {
  return psql(sqlText).stdout;
}

function selectionsJson(count) {
  const rows = Array.from({ length: count }, (_, i) => ({
    fixture_id: 900 + i,
    league_id: 39,
    kickoff_at: KICKOFF,
    market: "ou",
    selection: "Over 2.5",
    side: "over",
    line: 2.5,
    odds: 1.8,
    confidence: 80,
    value_score: 60
  }));
  return JSON.stringify(rows).replace(/'/g, "''");
}

/**
 * Call the RPC. `kind`/`k` are omitted entirely unless a test asks for them, so
 * the default call is byte-identical to the 9-argument shape deployed server
 * code uses — which is exactly the compatibility this suite has to prove.
 */
function createBet({ variant = 3, kind, k, selections, expectFailure = false } = {}) {
  const sel = selections ?? selectionsJson(variant);
  let tail = "";
  if (kind !== undefined) {
    tail = `, null, '${kind}'::text`;
    if (k !== undefined) tail += `, ${k === null ? "null" : `${k}::smallint`}`;
  }
  return psql(
    `select public.create_global_special_bet(
       '${USER_A}'::uuid, '${BET_DATE}'::date, ${variant}::smallint, '${LEAGUES}'::int[],
       5.832, 80.00, 'predictor-v3.1-test', '${sel}'::jsonb${tail}
     );`,
    { expectFailure }
  );
}

/** Insert a bet row directly, bypassing the RPC — the only way to reach a system row today. */
function insertRow({ variant, kind, k, expectFailure = false }) {
  const kValue = k === null || k === undefined ? "null" : k;
  return psql(
    `insert into public.special_bets
       (user_id, bet_date, league_ids, league_scope, variant, total_odds, average_confidence, bet_kind, system_k)
     values ('${USER_A}', '${BET_DATE}', '${LEAGUES}', '${SCOPE}', ${variant}, 5.832, 80.00, '${kind}', ${kValue});`,
    { expectFailure }
  );
}

before(() => {
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  const migrations = fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    psql(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  psql(`insert into auth.users (id, email) values ('${USER_A}', 'a@test.local') on conflict (id) do nothing;`);
});

beforeEach(() => {
  psql("truncate table public.special_bets cascade;");
});

// ── Backward compatibility ────────────────────────────────────────────────

test("S1: a bet written the old way is a combo with no k", () => {
  // The 9-argument call: no bet_kind, no system_k. This is what every deployed
  // caller sends today, and what 043-era rows already in production look like
  // once the column default fills in.
  const out = createBet({ variant: 3 });
  assert.match(out.stdout, /"ok"\s*:\s*true/);
  assert.equal(value(`select bet_kind from public.special_bets;`), "combo");
  assert.equal(value(`select coalesce(system_k::text, 'NULL') from public.special_bets;`), "NULL");
});

test("S2: combo 3 still generates", () => {
  assert.match(createBet({ variant: 3 }).stdout, /"created"\s*:\s*true/);
  assert.equal(value(`select count(*) from public.special_bet_selections;`), "3");
});

test("S3: combo 5 still generates", () => {
  assert.match(createBet({ variant: 5 }).stdout, /"created"\s*:\s*true/);
  assert.equal(value(`select count(*) from public.special_bet_selections;`), "5");
});

test("S4: combo 8 still generates", () => {
  assert.match(createBet({ variant: 8 }).stdout, /"created"\s*:\s*true/);
  assert.equal(value(`select count(*) from public.special_bet_selections;`), "8");
});

// ── The system shapes the schema must accept ──────────────────────────────

test("S5: System 3/5 is a valid row", () => {
  const r = insertRow({ variant: 5, kind: "system", k: 3 });
  assert.equal(r.ok, true);
  assert.equal(value(`select variant || '/' || system_k from public.special_bets;`), "5/3");
});

test("S6: System 4/5 is a valid row", () => {
  assert.equal(insertRow({ variant: 5, kind: "system", k: 4 }).ok, true);
});

test("S7: System 5/5 is a valid row", () => {
  // k = variant is deliberately legal: it settles like a combo but belongs to
  // the system's price table, and excluding it here would move that special
  // case into application code.
  assert.equal(insertRow({ variant: 5, kind: "system", k: 5 }).ok, true);
});

// ── The shapes it must refuse ─────────────────────────────────────────────

test("S8: a system cannot require more winners than it has legs", () => {
  const r = insertRow({ variant: 5, kind: "system", k: 6, expectFailure: true });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /special_bets_system_shape/);
});

test("S9: a combo cannot carry a k", () => {
  const r = insertRow({ variant: 5, kind: "combo", k: 3, expectFailure: true });
  assert.equal(r.ok, false, "a combo needs every leg; a k would make its payout rule ambiguous");
  assert.match(r.stderr, /special_bets_system_shape/);
});

test("S9b: a system cannot omit its k", () => {
  const r = insertRow({ variant: 5, kind: "system", k: null, expectFailure: true });
  assert.equal(r.ok, false);
  assert.match(r.stderr, /special_bets_system_shape/);
});

test("S10: an unknown bet_kind is rejected", () => {
  for (const bad of ["combi", "SYSTEM", "system_3_of_5", ""]) {
    const r = psql(
      `insert into public.special_bets
         (user_id, bet_date, league_ids, league_scope, variant, total_odds, average_confidence, bet_kind)
       values ('${USER_A}', '${BET_DATE}', '${LEAGUES}', '${SCOPE}', 5, 5.832, 80.00, '${bad}');`,
      { expectFailure: true }
    );
    assert.equal(r.ok, false, `bet_kind "${bad}" must be rejected`);
    assert.match(r.stderr, /special_bets_kind_allowed/);
  }
});

// ── Identity ──────────────────────────────────────────────────────────────

test("S11: Combo 5 and System 3/5 are different tickets", () => {
  createBet({ variant: 5 });
  assert.equal(
    insertRow({ variant: 5, kind: "system", k: 3 }).ok,
    true,
    "same user/date/variant/scope, different ticket"
  );
  assert.equal(value(`select count(*) from public.special_bets;`), "2");
});

test("S12: System 3/5 and System 4/5 are different tickets", () => {
  assert.equal(insertRow({ variant: 5, kind: "system", k: 3 }).ok, true);
  assert.equal(insertRow({ variant: 5, kind: "system", k: 4 }).ok, true);
  assert.equal(value(`select count(*) from public.special_bets;`), "2");
});

test("S13: System 4/5 and System 5/5 are different tickets", () => {
  assert.equal(insertRow({ variant: 5, kind: "system", k: 4 }).ok, true);
  assert.equal(insertRow({ variant: 5, kind: "system", k: 5 }).ok, true);
  assert.equal(value(`select count(*) from public.special_bets;`), "2");
});

test("S13b: all four tickets coexist, and each is unique", () => {
  createBet({ variant: 5 });
  for (const k of [3, 4, 5]) assert.equal(insertRow({ variant: 5, kind: "system", k }).ok, true);
  assert.equal(value(`select count(*) from public.special_bets;`), "4");

  // The same four again: every one collides with itself, none with another.
  for (const k of [3, 4, 5]) {
    const dup = insertRow({ variant: 5, kind: "system", k, expectFailure: true });
    assert.equal(dup.ok, false);
    assert.match(dup.stderr, /special_bets_identity_idx/);
  }
  assert.equal(value(`select count(*) from public.special_bets;`), "4");
});

test("S14: repeating a combo still returns the same bet instead of creating a second", () => {
  // The trap this guards: coalesce(system_k, 0) in the index exists because NULL
  // is not equal to NULL in a unique index. A bare nullable column would stop
  // constraining combos entirely and quietly restore duplicate tickets.
  const first = createBet({ variant: 5 });
  const second = createBet({ variant: 5 });
  assert.match(first.stdout, /"created"\s*:\s*true/);
  assert.match(second.stdout, /"created"\s*:\s*false/);
  assert.equal(value(`select count(*) from public.special_bets;`), "1");
  assert.equal(value(`select count(*) from public.special_bet_selections;`), "5");

  const idOf = (out) => /"id"\s*:\s*"([0-9a-f-]+)"/.exec(out)?.[1];
  assert.equal(idOf(first.stdout), idOf(second.stdout), "a retry must converge on one row");
});

test("S15: the selection count must still equal the variant", () => {
  for (const [variant, count] of [
    [3, 2],
    [5, 3],
    [8, 5]
  ]) {
    const out = createBet({ variant, selections: selectionsJson(count) });
    assert.match(out.stdout, /"selection_count_mismatch"/, `variant ${variant} with ${count} selections`);
  }
  assert.equal(value(`select count(*) from public.special_bets;`), "0", "a mismatch writes nothing");
});

// ── The foundation gate ───────────────────────────────────────────────────

test("S16: migration 053 lifted the gate — a System is created, and stored as one", () => {
  // 052 shipped the schema and refused to fill it, because settlement could not
  // grade k-of-n. It can now, so 053 dropped that branch. This is the assertion
  // that flipped: the same three calls that used to return system_not_enabled
  // must now write three rows.
  for (const k of [3, 4, 5]) {
    const out = createBet({ variant: 5, kind: "system", k });
    assert.match(out.stdout, /"created"\s*:\s*true/, `system 5/${k} must be created`);
    assert.doesNotMatch(out.stdout, /system_not_enabled/, "the gate is gone");
  }

  assert.equal(value(`select count(*) from public.special_bets;`), "3");
  assert.equal(
    value(`select string_agg(bet_kind || '/' || system_k, ',' order by system_k) from public.special_bets;`),
    "system/3,system/4,system/5"
  );
  assert.equal(
    value(`select count(*) from public.special_bets where variant = 5;`),
    "3",
    "variant keeps meaning the number of selections"
  );
  assert.equal(
    value(`select count(*) from public.special_bet_selections;`),
    "15",
    "five legs on each of the three tickets"
  );
});

test("S16b: the three tickets carry the same five legs", () => {
  for (const k of [3, 4, 5]) createBet({ variant: 5, kind: "system", k });

  assert.equal(
    value(
      `select count(*) from (
         select legs from (
           select special_bet_id, string_agg(fixture_id::text, ',' order by fixture_id) as legs
           from public.special_bet_selections group by special_bet_id
         ) per_bet group by legs
       ) distinct_leg_sets;`
    ),
    "1",
    "all three bets share one leg set"
  );
});

test("S16c: an invalid k never becomes a ticket", () => {
  // The CHECK constraint accepts 2..variant; the product sells only 3, 4 and 5,
  // and the function is where that is said.
  for (const k of [2, 6, 0, 1]) {
    const out = createBet({ variant: 5, kind: "system", k });
    assert.match(out.stdout, /"invalid_system_k"/, `k=${k} must be refused`);
  }
  // A missing k is the same refusal: a system without one has no payout rule.
  assert.match(createBet({ variant: 5, kind: "system", k: null }).stdout, /"invalid_system_k"/);
  assert.equal(value(`select count(*) from public.special_bets;`), "0");
});

// ── 053: the real System, end to end ──────────────────────────────────────

/** Five legs at 1.80 with a stored probability of 0.70 each. */
function systemSelections() {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    fixture_id: 950 + i,
    league_id: 39,
    kickoff_at: KICKOFF,
    market: "ou",
    selection: "Over 2.5",
    side: "over",
    line: 2.5,
    odds: 1.8,
    confidence: 80,
    value_score: 60,
    probability: 0.7
  }));
  return JSON.stringify(rows).replace(/'/g, "''");
}

/** The exact call the server makes for one System ticket. */
function createSystem(k, probability, { betDate = BET_DATE, expectFailure = false } = {}) {
  return psql(
    `select public.create_global_special_bet(
       '${USER_A}'::uuid, '${betDate}'::date, 5::smallint, '${LEAGUES}'::int[],
       18.89568, 80.00, 'predictor-v3.1-test', '${systemSelections()}'::jsonb,
       ${probability}, 'system'::text, ${k}::smallint
     );`,
    { expectFailure }
  );
}

test("S20: a System is persisted with P(X >= k) and the product of the five odds", () => {
  // The mandated figures for five legs at 0.70. The columns round to their own
  // precision: ticket_probability is numeric(6,4), total_odds numeric(10,3).
  const expected = { 3: "0.8369", 4: "0.5282", 5: "0.1681" };

  for (const k of [3, 4, 5]) {
    assert.match(createSystem(k, expected[k]).stdout, /"created"\s*:\s*true/, `5/${k}`);
  }

  assert.equal(
    value(
      `select string_agg(system_k || ':' || ticket_probability, ' ' order by system_k) from public.special_bets;`
    ),
    "3:0.8369 4:0.5282 5:0.1681"
  );
  assert.equal(
    value(`select string_agg(distinct total_odds::text, ',') from public.special_bets;`),
    "18.896",
    "1.8^5 = 18.89568, stored at the column's three decimals"
  );
  assert.equal(value(`select count(*) from public.special_bets where variant = 5 and bet_kind = 'system';`), "3");
  assert.equal(value(`select count(*) from public.special_bet_selections;`), "15");
});

test("S21: creating the same System twice returns the first row", () => {
  for (const k of [3, 4, 5]) {
    const first = createSystem(k, "0.8369");
    const second = createSystem(k, "0.8369");
    assert.match(first.stdout, /"created"\s*:\s*true/, `5/${k} first`);
    assert.match(second.stdout, /"created"\s*:\s*false/, `5/${k} repeat`);

    const idOf = (out) => /"id"\s*:\s*"([0-9a-f-]+)"/.exec(out)?.[1];
    assert.equal(idOf(first.stdout), idOf(second.stdout), `5/${k} converges on one row`);
  }
  assert.equal(value(`select count(*) from public.special_bets;`), "3", "no duplicates");
});

test("S22: a Combo and the three Systems coexist on one user, date, variant and scope", () => {
  createBet({ variant: 5 }); // the legacy nine-argument call: combo, no k
  for (const k of [3, 4, 5]) createSystem(k, "0.8369");

  assert.equal(value(`select count(*) from public.special_bets;`), "4");
  assert.equal(
    value(
      `select string_agg(bet_kind || '/' || coalesce(system_k::text, '-'), ' ' order by bet_kind, system_k) from public.special_bets;`
    ),
    "combo/- system/3 system/4 system/5"
  );
  // One identity each: every one of the four collides only with itself.
  assert.equal(value(`select count(distinct (variant, league_scope, bet_date)) from public.special_bets;`), "1");
});

test("S23: the legacy nine-argument Combo call still works and stays a combo", () => {
  const out = createBet({ variant: 3 });
  assert.match(out.stdout, /"created"\s*:\s*true/);
  assert.equal(value(`select bet_kind from public.special_bets;`), "combo", "the default still applies");
  assert.equal(value(`select coalesce(system_k::text, 'NULL') from public.special_bets;`), "NULL");
});

test("S17: the RPC rejects an unknown kind and a combo carrying a k", () => {
  assert.match(createBet({ variant: 5, kind: "combi" }).stdout, /"invalid_bet_kind"/);
  assert.match(createBet({ variant: 5, kind: "combo", k: 3 }).stdout, /"system_k_not_allowed_for_combo"/);
  assert.equal(value(`select count(*) from public.special_bets;`), "0");
});

test("S18: exactly one create_global_special_bet exists, with the new signature", () => {
  assert.equal(value(`select count(*) from pg_proc where proname = 'create_global_special_bet';`), "1");
  assert.equal(
    value(`select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'create_global_special_bet';`),
    "p_user_id uuid, p_bet_date date, p_variant smallint, p_league_ids integer[], " +
      "p_total_odds numeric, p_average_confidence numeric, p_model_version text, " +
      "p_selections jsonb, p_ticket_probability numeric, p_bet_kind text, p_system_k smallint"
  );
});

test("S19: the reissued function is still service-role only", () => {
  // A dropped-and-recreated function does not inherit 046's ACL. If the revoke
  // in 052 were forgotten, hosted Supabase would come up with anon and
  // authenticated able to execute it — the exact leak 046 exists to close.
  const acl = value(
    `select coalesce(array_to_string(proacl, ','), 'NONE') from pg_proc where proname = 'create_global_special_bet';`
  );
  assert.ok(acl.includes("service_role=X"), `service_role must keep EXECUTE, got: ${acl}`);
  assert.ok(!/\banon=X/.test(acl), `anon must not execute, got: ${acl}`);
  assert.ok(!/\bauthenticated=X/.test(acl), `authenticated must not execute, got: ${acl}`);
});
