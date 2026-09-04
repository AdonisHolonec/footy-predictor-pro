import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

/**
 * create_global_ticket (migration 070) — DATABASE integration suite.
 *
 * 068 gave special_bets the ability to HOLD a GLOBAL ticket and proved nothing
 * could write one. This suite proves the one thing that now can, and proves it
 * cannot do anything else.
 *
 * Three properties carry the weight, all of which fail SILENTLY:
 *
 *   1. ARBITER INFERENCE. 068's GLOBAL identity index is PARTIAL. Postgres only
 *      infers a partial index as an ON CONFLICT arbiter when the statement
 *      repeats its predicate — which is exactly why 068 refused to make the USER
 *      index partial. If 070 got that wrong the function would raise on EVERY
 *      call; if it got the coalesce wrong instead it would raise on none and
 *      quietly store duplicate combos. T6 and T11 pin both halves.
 *
 *   2. OWNERSHIP. A GLOBAL ticket must be unowned, and no caller may influence
 *      that. The function has no p_user_id — asserted against pg_proc, not
 *      against behaviour, because a parameter that exists is a parameter someone
 *      will eventually pass.
 *
 *   3. THE USER PATH IS UNTOUCHED. 070 adds a function; it must not have
 *      disturbed create_global_special_bet, its identity, or its ACL.
 *
 * Runs against the same throwaway container as the other GSB database suites;
 * `npm run test:integration:global-tickets-rpc` starts it.
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BET_DATE = "2026-09-05";
const KICKOFF = "2026-09-05T18:00:00Z";
const SCOPE = "39,140";
const LEAGUES = "{39,140}";

const SIGNATURE = "date, smallint, numeric, numeric, text, jsonb, numeric, text, smallint";

function psql(sqlText, { expectFailure = false } = {}) {
  const res = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"],
    { input: sqlText, encoding: "utf8" }
  );
  if (res.error) {
    throw new Error(
      `Cannot reach the test container "${CONTAINER}". Start it with ` +
        `npm run test:integration:global-tickets-rpc. Underlying error: ${res.error.message}`
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

/** `count` selections, deterministic and distinct, as the engine would emit them. */
function selections(count) {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      fixture_id: 901 + i,
      league_id: i % 2 === 0 ? 39 : 140,
      kickoff_at: KICKOFF,
      market: "ou",
      selection: "Over 2.5",
      side: "over",
      line: 2.5,
      odds: 1.85,
      confidence: 80,
      value_score: 61.5,
      fixture_label: `Home ${901 + i} vs Away ${901 + i}`,
      league_name: "Premier League",
      probability: 0.7203
    }))
  );
}

/**
 * One call to the function under test. Positional, because that is how the
 * PostgREST client calls it too, and a named-argument test would not catch a
 * reordered signature.
 */
function createGlobalTicket({
  betDate = `'${BET_DATE}'`,
  variant = 3,
  betKind = "'combo'",
  systemK = "null",
  count = null,
  expectFailure = false
} = {}) {
  const payload = selections(count ?? variant);
  return psql(
    `select public.create_global_ticket(
       ${betDate}::date, ${variant}::smallint, 5.832, 80.00, 'v3.1',
       '${payload}'::jsonb, 0.3721, ${betKind}, ${systemK}::smallint
     );`,
    { expectFailure }
  ).stdout;
}

/** A USER bet through the UNTOUCHED RPC, so its behaviour can be compared. */
function createUserBet({ variant = 3 } = {}) {
  return psql(
    `select public.create_global_special_bet(
       '${USER_A}'::uuid, '${BET_DATE}'::date, ${variant}::smallint, '${LEAGUES}'::int[],
       5.832, 80.00, 'v3.1', '${selections(variant)}'::jsonb
     );`
  ).stdout;
}

const jsonField = (raw, field) => JSON.parse(raw)[field];

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

// ── T1–T5 the function's shape ─────────────────────────────────────────────

test("T1: the function exists with exactly the declared signature", () => {
  // Names included: pg_get_function_identity_arguments reports them, and a
  // renamed parameter breaks every named-argument caller, PostgREST first.
  assert.equal(
    value(`select pg_get_function_identity_arguments('public.create_global_ticket(${SIGNATURE})'::regprocedure);`),
    "p_bet_date date, p_variant smallint, p_total_odds numeric, p_average_confidence numeric, " +
      "p_model_version text, p_selections jsonb, p_ticket_probability numeric, p_bet_kind text, " +
      "p_system_k smallint"
  );
});

test("T2: there is no p_user_id and no p_league_ids parameter", () => {
  const names = value(
    `select coalesce(array_to_string(p.proargnames, ','), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_global_ticket';`
  ).split(",");

  // Asserted against the catalogue rather than against behaviour: a parameter
  // that exists is a parameter someone will eventually pass.
  assert.equal(names.includes("p_user_id"), false);
  assert.equal(names.includes("p_league_ids"), false);
  assert.deepEqual(names, [
    "p_bet_date",
    "p_variant",
    "p_total_odds",
    "p_average_confidence",
    "p_model_version",
    "p_selections",
    "p_ticket_probability",
    "p_bet_kind",
    "p_system_k"
  ]);
});

test("T3: it is SECURITY DEFINER with a pinned search_path", () => {
  assert.equal(
    value(
      `select p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_global_ticket';`
    ),
    "true|search_path=public"
  );
});

test("T4: only service_role may execute it", () => {
  const check = (role) =>
    value(`select has_function_privilege('${role}', 'public.create_global_ticket(${SIGNATURE})', 'execute')::text;`);

  assert.equal(check("service_role"), "true");
  assert.equal(check("authenticated"), "false");
  assert.equal(check("anon"), "false");
  assert.equal(
    value(`select has_function_privilege('public', 'public.create_global_ticket(${SIGNATURE})', 'execute')::text;`),
    "false"
  );
});

test("T5: it never reads auth.uid() — a GLOBAL ticket has no owner to infer", () => {
  const body = value(
    `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_global_ticket';`
  );
  assert.equal(body.includes("auth.uid"), false);
  assert.equal(body.includes("current_user"), false);
});

// ── T6–T9 what it writes ───────────────────────────────────────────────────

test("T6: a created ticket is GLOBAL, admin-sourced, unowned and unpublished", () => {
  // The whole point of the migration, and the reason arbiter inference matters:
  // if the partial index could not be inferred this would raise instead.
  assert.equal(jsonField(createGlobalTicket({ variant: 3 }), "created"), true);

  assert.equal(
    value(
      `select bet_type || '|' || bet_source || '|' ||
              coalesce(user_id::text, 'NULL') || '|' ||
              coalesce(league_ids::text, 'NULL') || '|' ||
              coalesce(league_scope, 'NULL') || '|' ||
              coalesce(published_at::text, 'NULL')
       from public.special_bets;`
    ),
    "GLOBAL|ADMIN_PREDICTIONS|NULL|NULL|NULL|NULL"
  );
});

test("T7: the selection snapshot is stored exactly as it was passed", () => {
  createGlobalTicket({ variant: 3 });

  assert.equal(
    value(
      `select fixture_id || '|' || league_id || '|' || market || '|' ||
              selection || '|' || side || '|' || line::text || '|' || odds::text || '|' ||
              confidence::text || '|' || value_score::text || '|' || fixture_label || '|' ||
              league_name || '|' || probability::text
       from public.special_bet_selections where fixture_id = 901;`
    ),
    // `2.50` and `1.850` are the columns' declared scale (numeric(4,2) and
    // numeric(6,3)) rendering the values that were passed, not a rounding of
    // them. Every digit sent is present.
    "901|39|ou|Over 2.5|over|2.50|1.850|80.00|61.50|Home 901 vs Away 901|Premier League|0.7203"
  );
  // The kickoff instant survives the round trip through jsonb and timestamptz.
  assert.equal(
    value(
      `select to_char(kickoff_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
       from public.special_bet_selections where fixture_id = 901;`
    ),
    KICKOFF
  );
});

test("T8: the ticket carries the shape and probability it was created with", () => {
  createGlobalTicket({ variant: 5 });

  assert.equal(
    value(
      `select variant || '|' || bet_kind || '|' || coalesce(system_k::text, 'NULL') || '|' ||
              total_odds::text || '|' || ticket_probability::text || '|' || model_version
       from public.special_bets;`
    ),
    "5|combo|NULL|5.832|0.3721|v3.1"
  );
  assert.equal(value("select count(*)::text from public.special_bet_selections;"), "5");
});

test("T9: a system ticket stores its k", () => {
  assert.equal(
    jsonField(createGlobalTicket({ variant: 5, betKind: "'system'", systemK: 3 }), "created"),
    true
  );
  assert.equal(value("select bet_kind || '|' || system_k::text from public.special_bets;"), "system|3");
});

// ── T10–T14 idempotency through the GLOBAL identity ────────────────────────

test("T10: an identical second call creates nothing and returns the same ticket", () => {
  const first = createGlobalTicket({ variant: 3 });
  const second = createGlobalTicket({ variant: 3 });

  assert.equal(jsonField(first, "created"), true);
  assert.equal(jsonField(second, "created"), false);
  assert.equal(jsonField(second, "bet").id, jsonField(first, "bet").id);
  assert.equal(value("select count(*)::text from public.special_bets;"), "1");
  // And it does not duplicate the legs of the ticket it returns.
  assert.equal(value("select count(*)::text from public.special_bet_selections;"), "3");
});

test("T11: a GLOBAL combo cannot be duplicated despite its NULL system_k", () => {
  // The silent failure 068 called out: a bare nullable column in a unique index
  // makes every combo distinct, because NULLs are distinct. coalesce(...,0) is
  // what closes it, and this is the assertion that would catch its removal.
  createGlobalTicket({ variant: 3 });
  createGlobalTicket({ variant: 3 });
  createGlobalTicket({ variant: 3 });

  assert.equal(value("select count(*)::text from public.special_bets;"), "1");
});

test("T12: a different variant is an independent ticket", () => {
  createGlobalTicket({ variant: 3 });
  createGlobalTicket({ variant: 5 });
  createGlobalTicket({ variant: 8 });

  assert.equal(value("select count(*)::text from public.special_bets;"), "3");
  assert.equal(
    value("select string_agg(variant::text, ',' order by variant) from public.special_bets;"),
    "3,5,8"
  );
});

test("T13: a system and a combo of the same date and variant are different tickets", () => {
  createGlobalTicket({ variant: 5 });
  createGlobalTicket({ variant: 5, betKind: "'system'", systemK: 3 });
  assert.equal(value("select count(*)::text from public.special_bets;"), "2");

  // ...and two systems at different k are different tickets too.
  createGlobalTicket({ variant: 5, betKind: "'system'", systemK: 4 });
  assert.equal(value("select count(*)::text from public.special_bets;"), "3");
});

test("T14: a different date is an independent ticket", () => {
  createGlobalTicket({ variant: 3 });
  createGlobalTicket({ variant: 3, betDate: "'2026-09-06'" });

  assert.equal(value("select count(*)::text from public.special_bets;"), "2");
});

// ── T15–T20 validation ─────────────────────────────────────────────────────

test("T15: an unknown bet_kind is refused by name", () => {
  assert.equal(jsonField(createGlobalTicket({ betKind: "'accumulator'" }), "error"), "invalid_bet_kind");
  assert.equal(value("select count(*)::text from public.special_bets;"), "0");
});

test("T16: a combo may not carry a system k", () => {
  assert.equal(
    jsonField(createGlobalTicket({ variant: 3, systemK: 3 }), "error"),
    "system_k_not_allowed_for_combo"
  );
});

test("T17: a system must carry a k the product sells", () => {
  assert.equal(
    jsonField(createGlobalTicket({ variant: 5, betKind: "'system'" }), "error"),
    "invalid_system_k"
  );
  assert.equal(
    jsonField(createGlobalTicket({ variant: 5, betKind: "'system'", systemK: 2 }), "error"),
    "invalid_system_k"
  );
});

test("T18: a system is only ever five selections", () => {
  assert.equal(
    jsonField(createGlobalTicket({ variant: 3, betKind: "'system'", systemK: 3 }), "error"),
    "invalid_system_variant"
  );
});

test("T19: an unsold variant and a missing date are refused", () => {
  assert.equal(jsonField(createGlobalTicket({ variant: 4 }), "error"), "invalid_variant");
  assert.equal(jsonField(createGlobalTicket({ betDate: "null" }), "error"), "missing_identity");
  assert.equal(value("select count(*)::text from public.special_bets;"), "0");
});

test("T20: the selection count must equal the variant — no padding, no truncation", () => {
  assert.equal(jsonField(createGlobalTicket({ variant: 8, count: 6 }), "error"), "selection_count_mismatch");
  assert.equal(jsonField(createGlobalTicket({ variant: 3, count: 5 }), "error"), "selection_count_mismatch");
  assert.equal(value("select count(*)::text from public.special_bets;"), "0");
});

// ── T21–T23 the USER path is untouched ─────────────────────────────────────

test("T21: the USER RPC still creates a USER bet, unchanged", () => {
  assert.equal(jsonField(createUserBet(), "created"), true);
  assert.equal(
    value(
      `select bet_type || '|' || bet_source || '|' || (user_id = '${USER_A}')::text || '|' || league_scope
       from public.special_bets;`
    ),
    `USER|USER_PREDICTIONS|true|${SCOPE}`
  );
});

test("T22: USER idempotency is exactly what 054 left it", () => {
  const first = createUserBet();
  const second = createUserBet();

  assert.equal(jsonField(first, "created"), true);
  assert.equal(jsonField(second, "created"), false);
  assert.equal(jsonField(second, "bet").id, jsonField(first, "bet").id);
  assert.equal(value("select count(*)::text from public.special_bets;"), "1");
});

test("T23: a USER and a GLOBAL ticket of the same date and variant coexist", () => {
  // They are constrained by DIFFERENT indexes — the USER one cannot see a
  // GLOBAL row (its user_id and league_scope are NULL) and the GLOBAL one is
  // partial. Neither may collide with the other.
  createUserBet({ variant: 3 });
  createGlobalTicket({ variant: 3 });

  assert.equal(value("select count(*)::text from public.special_bets;"), "2");
  assert.equal(
    value("select string_agg(bet_type, ',' order by bet_type) from public.special_bets;"),
    "GLOBAL,USER"
  );
});

// ── T24–T27 visibility ─────────────────────────────────────────────────────

test("T24: a freshly created GLOBAL ticket is a DRAFT no user can see", () => {
  createGlobalTicket({ variant: 3 });

  assert.equal(asUser(USER_A, "select count(*) from public.special_bets;").stdout, "0");
  assert.equal(asUser(USER_A, "select count(*) from public.special_bet_selections;").stdout, "0");
});

test("T25: publishing makes it visible to authenticated users, legs included", () => {
  createGlobalTicket({ variant: 3 });
  psql("update public.special_bets set published_at = now() where bet_type = 'GLOBAL';");

  assert.equal(asUser(USER_A, "select count(*) from public.special_bets;").stdout, "1");
  assert.equal(asUser(USER_A, "select count(*) from public.special_bet_selections;").stdout, "3");
});

test("T26: anon cannot read a published GLOBAL ticket", () => {
  createGlobalTicket({ variant: 3 });
  psql("update public.special_bets set published_at = now() where bet_type = 'GLOBAL';");

  // The published policy is `to authenticated`. Without that role gate the anon
  // key would read every published ticket — the reason 068 made it explicit.
  assert.equal(psql(tx("set local role anon;\nselect count(*) from public.special_bets;")).stdout, "0");
});

test("T27: a user's own bets are unaffected by the presence of GLOBAL tickets", () => {
  createUserBet();
  createGlobalTicket({ variant: 5 });

  // One row: their own. The draft beside it matches no policy at all.
  assert.equal(asUser(USER_A, "select count(*) from public.special_bets;").stdout, "1");
  assert.equal(asUser(USER_A, "select bet_type from public.special_bets;").stdout, "USER");
});

// ── T28 the constraint backstop ────────────────────────────────────────────

test("T28: a GLOBAL row with an owner is refused by the schema, not just by the RPC", () => {
  // 070 cannot write one — there is no parameter — but the constraint from 068
  // is what makes that true of every future writer as well.
  const res = psql(
    `insert into public.special_bets (user_id, bet_date, variant, total_odds, average_confidence, bet_type, bet_source)
     values ('${USER_A}', '${BET_DATE}', 3, 5.832, 80.00, 'GLOBAL', 'ADMIN_PREDICTIONS');`,
    { expectFailure: true }
  );
  assert.equal(res.ok, false);
  assert.match(res.stderr, /special_bets_identity_coherent/);
});
