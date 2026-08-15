import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

/**
 * Global Special Bet — DATABASE integration suite.
 *
 * Proves the guarantees that live in SQL and cannot be asserted from JavaScript:
 * the identity unique index, the CHECK constraints, RLS, SECURITY DEFINER
 * hardening, single-transaction atomicity and the ON CONFLICT concurrency path.
 *
 * Runs against a throwaway Postgres container, never against a real database.
 * `npm run test:integration:global-special-bets` starts it.
 *
 * The container is plain Postgres, because this project has no local Supabase
 * stack (no supabase/config.toml). tests/integration/bootstrap.auth.sql supplies
 * the three Supabase objects migration 043 depends on — auth.users, auth.uid()
 * and the anon/authenticated/service_role roles — so the PRODUCTION migration is
 * applied here unmodified, byte for byte.
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BET_DATE = "2026-08-09";
const KICKOFF = "2026-08-09T18:00:00Z";

function psql(sqlText, { expectFailure = false } = {}) {
  const res = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-f",
      "-"
    ],
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
  if (!expectFailure && res.status !== 0) {
    throw new Error(`SQL failed:\n${sqlText}\n---\n${stderr}`);
  }
  return { ok: res.status === 0, stdout, stderr };
}

/** Single scalar/JSON value. */
function value(sqlText) {
  return psql(sqlText).stdout;
}

/**
 * Rows a statement actually touched.
 *
 * psql prints command tags (BEGIN / SET / COMMIT) alongside results, and RLS
 * makes a policy-less UPDATE or DELETE succeed having matched nothing — so "did
 * it error" is the wrong question and "how many rows moved" is the right one.
 */
function rowsAffected(result) {
  const numeric = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[0-9]+$/.test(line));
  return numeric.length ? Number(numeric[numeric.length - 1]) : null;
}

/** Runs a statement as an end user: role `authenticated` plus their JWT claim. */
function asUser(userId, statement, opts = {}) {
  return psql(
    `begin;
     set local role authenticated;
     set local request.jwt.claims = '{"sub":"${userId}"}';
     ${statement}
     commit;`,
    opts
  );
}

function selectionsJson(count, { duplicateFixture = false, badOdds = false, labels } = {}) {
  const rows = Array.from({ length: count }, (_, i) => ({
    fixture_id: duplicateFixture ? 900 : 900 + i,
    league_id: 39,
    kickoff_at: KICKOFF,
    market: "ou",
    selection: "Over 2.5",
    side: "over",
    line: 2.5,
    odds: badOdds && i === count - 1 ? 0.5 : 1.8,
    confidence: 80,
    value_score: 60,
    // Omitted entirely unless a test asks for them, so the default rows stay
    // exactly what a pre-048 (labels) / pre-050 (probability) caller sends.
    ...(labels ? labels(i) : {})
  }));
  return JSON.stringify(rows).replace(/'/g, "''");
}

function createBet({
  userId = USER_A,
  variant = 3,
  leagues = "{39,140}",
  selections,
  ticketProbability,
  expectFailure = false
} = {}) {
  const sel = selections ?? selectionsJson(variant);
  // Without ticketProbability the call keeps the exact 8-argument shape every
  // pre-050 caller uses — the default-NULL parameter is what makes that legal,
  // and most tests exercising it here is the deploy-window compatibility proof.
  const tail =
    ticketProbability === undefined ? "" : `, ${ticketProbability === null ? "null" : ticketProbability}`;
  return psql(
    `select public.create_global_special_bet(
       '${userId}'::uuid, '${BET_DATE}'::date, ${variant}::smallint, '${leagues}'::int[],
       5.832, 80.00, 'predictor-v3.1-test', '${sel}'::jsonb${tail}
     );`,
    { expectFailure }
  );
}

before(() => {
  // Idempotent: the schema is rebuilt from the production migration each run, so
  // the suite proves the migration itself, not a hand-maintained copy of it.
  // The container is shared with the other database suites, one of which keeps a
  // cut-down stand-in for predictions_history. Start from an empty schema so
  // this suite depends on nothing but the migrations, whatever ran before it.
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  // The whole chain, not a hand-picked pair. Now that the bootstrap reproduces
  // hosted Supabase's default EXECUTE grant, 043's `revoke ... from public` no
  // longer locks the RPC down on its own — 046 is what completes it, exactly as
  // in production. K2/K3 below assert the end state a deployed database has, so
  // the suite has to be given that same state.
  const migrations = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  for (const file of migrations) {
    psql(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  psql(`insert into auth.users (id, email) values
        ('${USER_A}', 'a@test.local'), ('${USER_B}', 'b@test.local')
        on conflict (id) do nothing;`);
});

beforeEach(() => {
  psql("truncate table public.special_bets cascade;");
});

// ── A. Schema ─────────────────────────────────────────────────────────────

test("A1: both tables exist", () => {
  assert.equal(value("select count(*) from information_schema.tables where table_name='special_bets';"), "1");
  assert.equal(
    value("select count(*) from information_schema.tables where table_name='special_bet_selections';"),
    "1"
  );
});

test("A2: variant is constrained to 3, 5 and 8", () => {
  for (const bad of [1, 2, 4, 7, 9]) {
    const r = psql(
      `insert into public.special_bets (user_id, bet_date, league_ids, league_scope, variant, total_odds, average_confidence)
       values ('${USER_A}', '${BET_DATE}', '{39}', '39', ${bad}, 2.0, 70);`,
      { expectFailure: true }
    );
    assert.equal(r.ok, false, `variant ${bad} must be rejected`);
    assert.match(r.stderr, /special_bets_variant_allowed/);
  }
});

test("A3: status is constrained", () => {
  const bet = psql(
    `insert into public.special_bets (user_id, bet_date, league_ids, league_scope, variant, total_odds, average_confidence, status)
     values ('${USER_A}', '${BET_DATE}', '{39}', '39', 3, 2.0, 70, 'settled');`,
    { expectFailure: true }
  );
  assert.equal(bet.ok, false);
  assert.match(bet.stderr, /special_bets_status_allowed/);
});

test("A4: odds must exceed 1 on a selection", () => {
  createBet();
  const id = value(`select id from public.special_bets limit 1;`);
  const r = psql(
    `insert into public.special_bet_selections (special_bet_id, fixture_id, league_id, kickoff_at, market, selection, odds, confidence)
     values ('${id}', 555, 39, '${KICKOFF}', 'ou', 'Over 2.5', 0.9, 70);`,
    { expectFailure: true }
  );
  assert.equal(r.ok, false);
  assert.match(r.stderr, /special_bet_selections_odds_positive/);
});

test("A5: one selection per fixture is enforced by the schema", () => {
  createBet();
  const id = value(`select id from public.special_bets limit 1;`);
  const r = psql(
    `insert into public.special_bet_selections (special_bet_id, fixture_id, league_id, kickoff_at, market, selection, odds, confidence)
     values ('${id}', 900, 39, '${KICKOFF}', 'ou', 'Under 3.5', 1.9, 70);`,
    { expectFailure: true }
  );
  assert.equal(r.ok, false, "fixture 900 already has a selection in this bet");
  assert.match(r.stderr, /special_bet_selections_one_per_fixture/);
});

// ── B. Canonical identity ─────────────────────────────────────────────────

test("B1: [140,39,39], [39,140] and [39,39,140] produce one identity", () => {
  createBet({ leagues: "{140,39,39}" });
  createBet({ leagues: "{39,140}" });
  createBet({ leagues: "{39,39,140}" });

  assert.equal(value("select count(*) from public.special_bets;"), "1");
  assert.equal(value("select league_scope from public.special_bets;"), "39,140");
  assert.equal(value("select league_ids::text from public.special_bets;"), "{39,140}");
});

// ── C. Idempotency ────────────────────────────────────────────────────────

test("C1: an identical repeat returns the same entity and writes no second row", () => {
  const first = createBet();
  const second = createBet();

  assert.equal(value("select count(*) from public.special_bets;"), "1");

  const firstJson = JSON.parse(first.stdout);
  const secondJson = JSON.parse(second.stdout);
  assert.equal(firstJson.created, true);
  assert.equal(secondJson.created, false);
  assert.equal(firstJson.bet.id, secondJson.bet.id);
  assert.equal(value("select count(*) from public.special_bet_selections;"), "3");
});

// ── D. Concurrency ────────────────────────────────────────────────────────

test("D1: two concurrent creations yield exactly one bet and no duplicate selections", async () => {
  // Genuinely parallel: two separate psql processes, two separate sessions.
  const run = () => new Promise((resolve) => setImmediate(() => resolve(createBet())));
  const [a, b] = await Promise.all([run(), run()]);

  assert.equal(value("select count(*) from public.special_bets;"), "1", "exactly one bet survives the race");
  assert.equal(value("select count(*) from public.special_bet_selections;"), "3", "no duplicated selections");

  const jsonA = JSON.parse(a.stdout);
  const jsonB = JSON.parse(b.stdout);
  assert.equal(jsonA.bet.id, jsonB.bet.id, "both callers receive the same entity");
  assert.equal(
    [jsonA, jsonB].filter((r) => r.created === true).length,
    1,
    "exactly one caller created it; the other recovered it"
  );
});

// ── E. Atomicity ──────────────────────────────────────────────────────────

test("E1: a failing selection takes the whole bet with it", () => {
  // The last selection violates the odds CHECK, after the parent row and the
  // earlier selections have already been inserted inside the transaction.
  const r = createBet({ selections: selectionsJson(3, { badOdds: true }), expectFailure: true });

  assert.equal(r.ok, false);
  assert.match(r.stderr, /special_bet_selections_odds_positive/);
  assert.equal(value("select count(*) from public.special_bets;"), "0", "no partial bet");
  assert.equal(value("select count(*) from public.special_bet_selections;"), "0", "no orphan selections");
});

test("E2: a duplicate fixture inside one request also rolls the bet back", () => {
  const r = createBet({ selections: selectionsJson(3, { duplicateFixture: true }), expectFailure: true });

  assert.equal(r.ok, false);
  assert.equal(value("select count(*) from public.special_bets;"), "0");
  assert.equal(value("select count(*) from public.special_bet_selections;"), "0");
});

// ── F. RLS ────────────────────────────────────────────────────────────────

test("F1: a user reads their own bet", () => {
  createBet({ userId: USER_A });
  assert.match(asUser(USER_A, "select count(*) from public.special_bets;").stdout, /\b1\b/);
});

test("F2: another user cannot see it", () => {
  createBet({ userId: USER_A });
  const r = asUser(USER_B, "select count(*) from public.special_bets;");
  assert.match(r.stdout, /\b0\b/, "user B must see zero rows, not an error and not data");
});

test("F3: selections inherit the owner's isolation", () => {
  createBet({ userId: USER_A });
  assert.match(asUser(USER_A, "select count(*) from public.special_bet_selections;").stdout, /\b3\b/);
  assert.match(asUser(USER_B, "select count(*) from public.special_bet_selections;").stdout, /\b0\b/);
});

// ── G. Write isolation ────────────────────────────────────────────────────

test("G1: an end user cannot insert, update or delete a bet", () => {
  createBet({ userId: USER_A });
  const id = value("select id from public.special_bets limit 1;");

  // INSERT is the one that raises: Postgres rejects a row no policy admits.
  const insert = asUser(
    USER_A,
    `insert into public.special_bets (user_id, bet_date, league_ids, league_scope, variant, total_odds, average_confidence)
     values ('${USER_A}', '2026-08-10', '{39}', '39', 3, 2.0, 70);`,
    { expectFailure: true }
  );
  assert.equal(insert.ok, false, "no INSERT policy exists");
  assert.match(insert.stderr, /row-level security/);

  // UPDATE and DELETE do NOT raise. With no policy for them, RLS makes the rows
  // invisible to the statement, so it succeeds having touched nothing. Asserting
  // on an error here would be asserting the wrong thing — what matters is that
  // zero rows moved.
  const updated = asUser(
    USER_A,
    `with upd as (update public.special_bets set status = 'won' where id = '${id}' returning 1)
     select count(*) from upd;`
  );
  assert.equal(rowsAffected(updated), 0, "an end user's UPDATE must reach no rows");

  const deleted = asUser(
    USER_A,
    `with del as (delete from public.special_bets where id = '${id}' returning 1)
     select count(*) from del;`
  );
  assert.equal(rowsAffected(deleted), 0, "an end user's DELETE must reach no rows");

  assert.equal(value("select count(*) from public.special_bets;"), "1");
  assert.equal(value("select status from public.special_bets limit 1;"), "pending");
});

// ── H. Immutability ───────────────────────────────────────────────────────

test("H1: no normal path exists to alter a stored snapshot", () => {
  createBet({ userId: USER_A });
  const selId = value("select id from public.special_bet_selections order by fixture_id limit 1;");

  for (const column of [
    "fixture_id = 1",
    "odds = 99.0",
    "confidence = 1.0",
    "value_score = 1.0",
    "selection = 'Under 0.5'",
    "line = 0.5"
  ]) {
    const r = asUser(
      USER_A,
      `with upd as (update public.special_bet_selections set ${column} where id = '${selId}' returning 1)
       select count(*) from upd;`
    );
    assert.equal(rowsAffected(r), 0, `an end user must not be able to set ${column}`);
  }

  const meta = asUser(
    USER_A,
    `with upd as (update public.special_bets set model_version = 'forged' where user_id = '${USER_A}' returning 1)
     select count(*) from upd;`
  );
  assert.equal(rowsAffected(meta), 0);

  // The stored values are still exactly the ones written at creation.
  assert.equal(value("select odds::text from public.special_bet_selections order by fixture_id limit 1;"), "1.800");
  assert.equal(value("select confidence::text from public.special_bet_selections order by fixture_id limit 1;"), "80.00");
  assert.equal(value("select value_score::text from public.special_bet_selections order by fixture_id limit 1;"), "60.00");
  assert.equal(value("select selection from public.special_bet_selections order by fixture_id limit 1;"), "Over 2.5");
  assert.equal(value("select model_version from public.special_bets limit 1;"), "predictor-v3.1-test");
});

// ── I / J. Snapshot independence ──────────────────────────────────────────

test("I1: the snapshot is stored data, with no link back to predictions", () => {
  createBet();

  // No foreign key, view or trigger ties a selection to predictions_history —
  // which is why a later edit of raw_payload cannot reach an existing bet.
  const fks = value(
    `select count(*) from information_schema.table_constraints tc
       join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.table_name in ('special_bets','special_bet_selections')
        and tc.constraint_type = 'FOREIGN KEY'
        and ccu.table_name = 'predictions_history';`
  );
  assert.equal(fks, "0");

  const views = value(
    `select count(*) from information_schema.views where table_name in ('special_bets','special_bet_selections');`
  );
  assert.equal(views, "0", "these are tables, not views over predictions");
});

test("J1: a stored bet reads back with no prediction row behind it", () => {
  createBet({ userId: USER_A });
  // Whether the table exists at all depends on which suites have run; what
  // matters is that nothing backs these fixtures and the snapshot still reads
  // back in full.
  // cascade, because the full migration chain gives predictions_history
  // dependents. Without it the DROP errors and the assertion below never runs —
  // the table has to actually go for this test to mean anything.
  psql("drop table if exists public.predictions_history cascade;");
  assert.match(
    asUser(USER_A, "select count(*) from public.special_bet_selections;").stdout,
    /\b3\b/,
    "reading a snapshot cannot depend on predictions"
  );
});

// ── K. SECURITY DEFINER audit ─────────────────────────────────────────────

test("K1: the RPC is SECURITY DEFINER with a pinned search_path", () => {
  const row = value(
    `select prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), 'NONE')
       from pg_proc where proname = 'create_global_special_bet';`
  );
  const [secdef, config] = row.split("|");

  assert.equal(secdef, "true", "must run as its owner");
  assert.match(
    config,
    /search_path=public/,
    "an unpinned search_path is the classic SECURITY DEFINER hijack: the caller could " +
      "shadow a referenced object from a schema earlier on the path"
  );
});

test("K2: execution is granted to service_role only", () => {
  const acl = value(
    `select coalesce(array_to_string(proacl, ','), 'NONE') from pg_proc where proname = 'create_global_special_bet';`
  );

  assert.ok(!/(^|,)=X\//.test(acl), `PUBLIC must not hold EXECUTE, got: ${acl}`);
  assert.match(acl, /service_role=X/, `service_role must hold EXECUTE, got: ${acl}`);
  assert.ok(!/authenticated=X/.test(acl), "an end user must not be able to call it directly");
});

test("K3: an end user cannot execute the RPC to forge a bet", () => {
  createBet({ userId: USER_B });
  assert.match(asUser(USER_A, "select count(*) from public.special_bets;").stdout, /\b0\b/);

  const canExecute = asUser(
    USER_A,
    `select public.create_global_special_bet('${USER_B}'::uuid, '${BET_DATE}'::date, 3::smallint,
       '{39}'::int[], 2.0, 70.0, 'x', '${selectionsJson(3)}'::jsonb);`,
    { expectFailure: true }
  );
  assert.equal(canExecute.ok, false, "an end user must not be able to execute the RPC at all");
});

test("K4: the RPC validates its own inputs rather than trusting the caller", () => {
  const badVariant = psql(
    `select public.create_global_special_bet('${USER_A}'::uuid, '${BET_DATE}'::date, 4::smallint,
       '{39}'::int[], 2.0, 70.0, 'x', '${selectionsJson(4)}'::jsonb);`
  );
  assert.match(badVariant.stdout, /invalid_variant/);

  const wrongCount = psql(
    `select public.create_global_special_bet('${USER_A}'::uuid, '${BET_DATE}'::date, 5::smallint,
       '{39}'::int[], 2.0, 70.0, 'x', '${selectionsJson(3)}'::jsonb);`
  );
  assert.match(wrongCount.stdout, /selection_count_mismatch/);
  assert.equal(value("select count(*) from public.special_bets;"), "0");
});

// ── L. The readable snapshot (048) ────────────────────────────────────────

test("L1: a selection can carry the names it was built from", () => {
  const columns = value(
    `select string_agg(column_name || ':' || is_nullable, ',' order by column_name)
     from information_schema.columns
     where table_name = 'special_bet_selections'
       and column_name in ('fixture_label', 'league_name');`
  );
  assert.equal(columns, "fixture_label:YES,league_name:YES");
});

test("L2: the RPC stores the label the caller sent, verbatim", () => {
  createBet({
    selections: selectionsJson(3, {
      labels: (i) => ({ fixture_label: `Arsenal – Chelsea ${i}`, league_name: "Premier League" })
    })
  });

  assert.equal(
    value(
      `select fixture_label from public.special_bet_selections
       where fixture_id = 900;`
    ),
    "Arsenal – Chelsea 0"
  );
  assert.equal(
    value(`select count(*) from public.special_bet_selections where league_name = 'Premier League';`),
    "3"
  );
});

test("L3: a caller that sends no label writes NULL, not an empty string", () => {
  // Both the pre-048 caller (field absent) and a caller with nothing to say
  // (field empty) must land on NULL — the UI tests one thing, not two.
  createBet({ selections: selectionsJson(3, { labels: (i) => (i === 0 ? { fixture_label: "" } : {}) }) });

  assert.equal(
    value(`select count(*) from public.special_bet_selections where fixture_label is null;`),
    "3"
  );
  assert.equal(
    value(`select count(*) from public.special_bet_selections where fixture_label = '';`),
    "0"
  );
});

test("L4: the reissued RPC keeps its SECURITY DEFINER hardening", () => {
  // 048 replaced in place; 050 dropped and recreated with a new signature. In
  // both cases the deployed end state must be the one 046 established — this
  // asserts that it is, rather than trusting either mechanism.
  const acl = value(
    `select coalesce(array_to_string(proacl, ','), 'NONE') from pg_proc where proname = 'create_global_special_bet';`
  );
  assert.ok(!/(^|,)=X\//.test(acl), `PUBLIC must not hold EXECUTE after 048, got: ${acl}`);
  assert.match(acl, /service_role=X/, `service_role must still hold EXECUTE, got: ${acl}`);

  const definer = value(
    `select prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), 'NONE')
     from pg_proc where proname = 'create_global_special_bet';`
  );
  assert.equal(definer, "true|search_path=public", "the replacement must not drop the pinned search_path");
});

// ── M. The probability snapshot (050) ─────────────────────────────────────

test("M1: probability and ticket_probability exist, nullable, at the agreed precision", () => {
  assert.equal(
    value(
      `select column_name || ':' || is_nullable || ':' || numeric_precision || ',' || numeric_scale
       from information_schema.columns
       where table_name = 'special_bet_selections' and column_name = 'probability';`
    ),
    "probability:YES:5,4"
  );
  assert.equal(
    value(
      `select column_name || ':' || is_nullable || ':' || numeric_precision || ',' || numeric_scale
       from information_schema.columns
       where table_name = 'special_bets' and column_name = 'ticket_probability';`
    ),
    "ticket_probability:YES:6,4"
  );
});

test("M2: the RPC persists per-leg probability and the ticket product verbatim", () => {
  createBet({
    ticketProbability: 0.504,
    selections: selectionsJson(3, { labels: (i) => ({ probability: [0.9, 0.8, 0.7][i] }) })
  });

  assert.equal(
    value(`select ticket_probability::text from public.special_bets;`),
    "0.5040",
    "numeric(6,4) stores the engine's 4-decimal product exactly"
  );
  assert.equal(
    value(
      `select string_agg(probability::text, ',' order by fixture_id) from public.special_bet_selections;`
    ),
    "0.9000,0.8000,0.7000"
  );
});

test("M3: a pre-050 caller (8 arguments, no probability keys) writes NULL and still works", () => {
  // The exact call shape deployed server code used before this migration.
  const r = createBet();
  assert.equal(JSON.parse(r.stdout).ok, true);

  assert.equal(value(`select count(*) from public.special_bets where ticket_probability is null;`), "1");
  assert.equal(
    value(`select count(*) from public.special_bet_selections where probability is null;`),
    "3",
    "legacy rows stay NULL — no value is invented retroactively"
  );
});

test("M4: exactly one create_global_special_bet exists — the drop left no overload behind", () => {
  // CREATE with a changed signature beside the old one would leave TWO callable
  // functions, the old one still writing pre-050 rows. The drop must have been
  // real.
  assert.equal(value(`select count(*) from pg_proc where proname = 'create_global_special_bet';`), "1");
  assert.equal(
    value(
      `select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'create_global_special_bet';`
    ),
    // 052 reissued it again, adding p_bet_kind and p_system_k. Both carry
    // defaults, which is what keeps this suite's own 9-argument calls resolving.
    "p_user_id uuid, p_bet_date date, p_variant smallint, p_league_ids integer[], " +
      "p_total_odds numeric, p_average_confidence numeric, p_model_version text, " +
      "p_selections jsonb, p_ticket_probability numeric, p_bet_kind text, p_system_k smallint"
  );
});

test("M5: a probability outside (0,1] is rejected by the schema, NULL is not", () => {
  const bad = createBet({
    selections: selectionsJson(3, { labels: () => ({ probability: 1.2 }) }),
    expectFailure: true
  });
  assert.equal(bad.ok, false);
  assert.match(bad.stderr, /special_bet_selections_probability_range/);
  assert.equal(value("select count(*) from public.special_bets;"), "0", "the whole bet rolls back");

  const badTicket = createBet({ ticketProbability: 1.5, expectFailure: true });
  assert.equal(badTicket.ok, false);
  assert.match(badTicket.stderr, /special_bets_ticket_probability_range/);
});

test("M6: the probability snapshot is owner-isolated like everything else", () => {
  createBet({
    userId: USER_A,
    ticketProbability: 0.504,
    selections: selectionsJson(3, { labels: () => ({ probability: 0.8 }) })
  });

  assert.match(
    asUser(USER_A, "select count(*) from public.special_bets where ticket_probability = 0.504;").stdout,
    /\b1\b/,
    "the owner reads their own stored probability"
  );
  assert.match(
    asUser(USER_B, "select count(*) from public.special_bets;").stdout,
    /\b0\b/,
    "another user sees nothing — 050 added columns, not access"
  );
  const forged = asUser(
    USER_A,
    `with upd as (update public.special_bets set ticket_probability = 0.99 returning 1)
     select count(*) from upd;`
  );
  assert.equal(rowsAffected(forged), 0, "the stored probability is as immutable as the rest of the snapshot");
});
