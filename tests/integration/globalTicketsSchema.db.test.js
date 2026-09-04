import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

/**
 * Global Tickets foundation (migration 068) — DATABASE integration suite.
 *
 * Everything this increment adds lives in SQL: three columns, four constraints,
 * two partial unique indexes replacing one, a list index and two RLS policies.
 * None of it is assertable from JavaScript, so it is asserted here against the
 * production migration chain applied byte for byte.
 *
 * The split this suite proves is the point of the increment:
 *   · the SCHEMA accepts a GLOBAL row — unowned, league-less, publishable
 *   · nothing WRITES one: no INSERT policy, no RPC, no application path
 *   · a USER row is unchanged in every respect, including its idempotency
 *
 * Two properties get disproportionate attention because they fail SILENTLY:
 *
 *   1. Uniqueness. Postgres treats NULLs as distinct, so making user_id nullable
 *      would have quietly stopped the old identity index constraining anything —
 *      no error, just duplicate tickets. G10/G11 pin both halves.
 *
 *   2. Draft visibility. A draft is invisible because it matches no policy, not
 *      because anything checks a flag. R4 asserts that from the user's side.
 *
 * Runs against the same throwaway container as the other GSB database suites;
 * `npm run test:integration:global-tickets` starts it.
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
        `npm run test:integration:global-tickets. Underlying error: ${res.error.message}`
    );
  }
  const stderr = (res.stderr || "").trim();
  if (!expectFailure && res.status !== 0) throw new Error(`SQL failed:\n${sqlText}\n---\n${stderr}`);
  const stdout = (res.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(BEGIN|COMMIT|ROLLBACK|SET|INSERT \d|UPDATE \d|DELETE \d|TRUNCATE TABLE)/.test(line))
    .join("\n");
  return { ok: res.status === 0, stdout, stderr };
}

const value = (sqlText) => psql(sqlText).stdout;

/** Wraps in a transaction so `set local` is scoped and nothing leaks between cases. */
const tx = (body) => `begin;\n${body}\ncommit;`;

/** Runs statements as the `authenticated` role with a given auth.uid(). */
function asUser(userId, body, opts) {
  return psql(
    tx(
      `set local role authenticated;
       set local "request.jwt.claims" = '{"sub":"${userId}","role":"authenticated"}';
       ${body}`
    ),
    opts
  );
}

/** A USER bet, written directly. Mirrors what create_global_special_bet produces. */
function insertUserBet({ userId = USER_A, variant = 3, expectFailure = false } = {}) {
  return psql(
    `insert into public.special_bets
       (user_id, bet_date, league_ids, league_scope, variant, total_odds, average_confidence)
     values ('${userId}', '${BET_DATE}', '${LEAGUES}', '${SCOPE}', ${variant}, 5.832, 80.00);`,
    { expectFailure }
  );
}

/**
 * A GLOBAL bet, written directly — the ONLY way one can exist today. There is no
 * RPC and no INSERT policy, which is itself the subject of R8.
 */
function insertGlobalBet({ variant = 3, published = false, expectFailure = false } = {}) {
  const cols = ["bet_date", "variant", "total_odds", "average_confidence", "bet_type", "bet_source"];
  const vals = [`'${BET_DATE}'`, `${variant}`, "5.832", "80.00", "'GLOBAL'", "'ADMIN_PREDICTIONS'"];
  if (published) {
    cols.push("published_at");
    vals.push("now()");
  }
  return psql(`insert into public.special_bets (${cols.join(", ")}) values (${vals.join(", ")});`, {
    expectFailure
  });
}

function insertSelection(fixtureId = 900) {
  return psql(
    `insert into public.special_bet_selections
       (special_bet_id, fixture_id, league_id, kickoff_at, market, selection, side, line, odds, confidence)
     values ((select id from public.special_bets limit 1), ${fixtureId}, 39, '${KICKOFF}',
             'ou', 'Over 2.5', 'over', 2.5, 1.8, 80);`
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
  psql(
    `insert into auth.users (id, email) values
       ('${USER_A}', 'a@test.local'), ('${USER_B}', 'b@test.local')
     on conflict (id) do nothing;`
  );
});

beforeEach(() => {
  psql("truncate table public.special_bets cascade;");
});

// ── Existing data is untouched ────────────────────────────────────────────

test("G1: a row written the old way is a USER bet from USER_PREDICTIONS", () => {
  // The pre-068 INSERT names neither new column. This is what every row already
  // in production looks like once the defaults fill in — and it must need no
  // backfill to be correct.
  assert.equal(insertUserBet().ok, true);
  assert.equal(value("select bet_type from public.special_bets;"), "USER");
  assert.equal(value("select bet_source from public.special_bets;"), "USER_PREDICTIONS");
  assert.equal(value("select coalesce(published_at::text, 'NULL') from public.special_bets;"), "NULL");
});

test("G2: the existing RPC still writes a valid USER bet", () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
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
  const sel = JSON.stringify(rows).replace(/'/g, "''");
  const out = psql(
    `select public.create_global_special_bet(
       '${USER_A}'::uuid, '${BET_DATE}'::date, 3::smallint, '${LEAGUES}'::int[],
       5.832, 80.00, 'predictor-v3.1-test', '${sel}'::jsonb
     );`
  );
  assert.match(out.stdout, /"ok"\s*:\s*true/);
  assert.equal(value("select bet_type from public.special_bets;"), "USER");
});

// ── The GLOBAL shape the schema must accept ───────────────────────────────

test("G3: a GLOBAL bet is valid with no owner and no leagues", () => {
  assert.equal(insertGlobalBet().ok, true);
  assert.equal(value("select coalesce(user_id::text, 'NULL') from public.special_bets;"), "NULL");
  assert.equal(value("select coalesce(league_scope, 'NULL') from public.special_bets;"), "NULL");
});

test("G4: a GLOBAL bet is a draft until published", () => {
  insertGlobalBet();
  assert.equal(value("select coalesce(published_at::text, 'NULL') from public.special_bets;"), "NULL");
  psql("update public.special_bets set published_at = now();");
  assert.equal(value("select (published_at is not null)::text from public.special_bets;"), "true");
});

// ── Contradictory states are unrepresentable ──────────────────────────────

test("G5: GLOBAL with an owner is rejected", () => {
  const r = psql(
    `insert into public.special_bets
       (user_id, bet_date, variant, total_odds, average_confidence, bet_type, bet_source)
     values ('${USER_A}', '${BET_DATE}', 3, 5.832, 80.00, 'GLOBAL', 'ADMIN_PREDICTIONS');`,
    { expectFailure: true }
  );
  assert.equal(r.ok, false);
  assert.match(r.stderr, /special_bets_identity_coherent/);
});

test("G6: USER without an owner is rejected", () => {
  const r = psql(
    `insert into public.special_bets
       (bet_date, league_ids, league_scope, variant, total_odds, average_confidence)
     values ('${BET_DATE}', '${LEAGUES}', '${SCOPE}', 3, 5.832, 80.00);`,
    { expectFailure: true }
  );
  assert.equal(r.ok, false);
  assert.match(r.stderr, /special_bets_identity_coherent/);
});

test("G7: a type/source mismatch is rejected in both directions", () => {
  const globalWithUserSource = psql(
    `insert into public.special_bets (bet_date, variant, total_odds, average_confidence, bet_type, bet_source)
     values ('${BET_DATE}', 3, 5.832, 80.00, 'GLOBAL', 'USER_PREDICTIONS');`,
    { expectFailure: true }
  );
  assert.equal(globalWithUserSource.ok, false);

  const userWithAdminSource = psql(
    `insert into public.special_bets
       (user_id, bet_date, league_ids, league_scope, variant, total_odds, average_confidence, bet_source)
     values ('${USER_A}', '${BET_DATE}', '${LEAGUES}', '${SCOPE}', 3, 5.832, 80.00, 'ADMIN_PREDICTIONS');`,
    { expectFailure: true }
  );
  assert.equal(userWithAdminSource.ok, false);
});

test("G8: an unknown bet_type is rejected — the ELSE branch, not just the enum", () => {
  const r = psql(
    `insert into public.special_bets (bet_date, variant, total_odds, average_confidence, bet_type, bet_source)
     values ('${BET_DATE}', 3, 5.832, 80.00, 'SYSTEM', 'ADMIN_PREDICTIONS');`,
    { expectFailure: true }
  );
  assert.equal(r.ok, false);
});

test("G9: a USER bet cannot carry published_at", () => {
  const r = psql(
    `insert into public.special_bets
       (user_id, bet_date, league_ids, league_scope, variant, total_odds, average_confidence, published_at)
     values ('${USER_A}', '${BET_DATE}', '${LEAGUES}', '${SCOPE}', 3, 5.832, 80.00, now());`,
    { expectFailure: true }
  );
  assert.equal(r.ok, false);
  assert.match(r.stderr, /special_bets_published_only_global/);
});

// ── Uniqueness: the silent-failure surface ────────────────────────────────

test("G10: USER idempotency survives the index split", () => {
  assert.equal(insertUserBet().ok, true);
  const dup = insertUserBet({ expectFailure: true });
  assert.equal(dup.ok, false, "the same (user, date, variant, scope) must still collide");
  assert.equal(value("select count(*) from public.special_bets;"), "1");
});

test("G11: GLOBAL gets its own identity — nullable user_id does not disable it", () => {
  /*
    The point of the partial index. Had the original index simply been left in
    place, both inserts would have succeeded: NULL != NULL, so every GLOBAL row
    would read as unique and duplicates would appear with no error at all.
  */
  assert.equal(insertGlobalBet({ variant: 3 }).ok, true);
  const dup = insertGlobalBet({ variant: 3, expectFailure: true });
  assert.equal(dup.ok, false, "same date + shape must collide");
  assert.equal(value("select count(*) from public.special_bets;"), "1");

  assert.equal(insertGlobalBet({ variant: 5 }).ok, true, "a different shape is a different ticket");
  assert.equal(value("select count(*) from public.special_bets;"), "2");
});

test("G12: two users may hold the same shape — USER identity is still per user", () => {
  assert.equal(insertUserBet({ userId: USER_A }).ok, true);
  assert.equal(insertUserBet({ userId: USER_B }).ok, true);
  assert.equal(value("select count(*) from public.special_bets;"), "2");
});

// ── RLS ───────────────────────────────────────────────────────────────────

test("R1: a user reads their own USER bet", () => {
  insertUserBet({ userId: USER_A });
  assert.equal(asUser(USER_A, "select count(*) from public.special_bets;").stdout, "1");
});

test("R2: a user cannot read another user's USER bet", () => {
  insertUserBet({ userId: USER_B });
  assert.equal(asUser(USER_A, "select count(*) from public.special_bets;").stdout, "0");
});

test("R3: every authenticated user sees a PUBLISHED global bet", () => {
  insertGlobalBet({ published: true });
  assert.equal(asUser(USER_A, "select count(*) from public.special_bets;").stdout, "1");
  assert.equal(asUser(USER_B, "select count(*) from public.special_bets;").stdout, "1");
});

test("R4: no user sees a DRAFT global bet", () => {
  insertGlobalBet({ published: false });
  assert.equal(asUser(USER_A, "select count(*) from public.special_bets;").stdout, "0");
  assert.equal(asUser(USER_B, "select count(*) from public.special_bets;").stdout, "0");
});

test("R5: draft selections are hidden too — the join does not leak them", () => {
  insertGlobalBet({ published: false });
  insertSelection();
  assert.equal(asUser(USER_A, "select count(*) from public.special_bet_selections;").stdout, "0");

  psql("update public.special_bets set published_at = now();");
  assert.equal(asUser(USER_A, "select count(*) from public.special_bet_selections;").stdout, "1");
});

test("R6: anon sees nothing, published or not", () => {
  /*
    `to authenticated` is what makes this pass. Without it the global policy is a
    bare bet_type predicate — true for anyone holding the anon key — because
    unlike the owner policies it has no auth.uid() to be NULL.
  */
  insertGlobalBet({ published: true });
  const out = psql(
    tx(`set local role anon;
        set local "request.jwt.claims" = '{"role":"anon"}';
        select count(*) from public.special_bets;`)
  );
  assert.equal(out.stdout, "0");
});

test("R7: a user cannot publish, unpublish or delete a global bet", () => {
  insertGlobalBet({ published: false });
  asUser(USER_A, "update public.special_bets set published_at = now();");
  assert.equal(value("select coalesce(published_at::text, 'NULL') from public.special_bets;"), "NULL");

  asUser(USER_A, "delete from public.special_bets;");
  assert.equal(value("select count(*) from public.special_bets;"), "1");
});

test("R8: a user cannot insert a global bet — there is no INSERT policy at all", () => {
  asUser(
    USER_A,
    `insert into public.special_bets (bet_date, variant, total_odds, average_confidence, bet_type, bet_source)
     values ('${BET_DATE}', 3, 5.832, 80.00, 'GLOBAL', 'ADMIN_PREDICTIONS');`,
    { expectFailure: true }
  );
  assert.equal(value("select count(*) from public.special_bets;"), "0");
});

test("R9: service_role manages drafts — RLS is bypassed, which is the admin path", () => {
  insertGlobalBet({ published: false });
  const out = psql(
    tx(`set local role service_role;
        select count(*) from public.special_bets;`)
  );
  assert.equal(out.stdout, "1");
});

test("R10: a published global bet does not expose USER bets alongside it", () => {
  insertUserBet({ userId: USER_B });
  insertGlobalBet({ published: true });
  assert.equal(asUser(USER_A, "select count(*) from public.special_bets;").stdout, "1");
  assert.equal(asUser(USER_A, "select bet_type from public.special_bets;").stdout, "GLOBAL");
});
