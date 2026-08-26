import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

/**
 * time_grants — DATABASE integration suite for migration 061.
 *
 * Everything asserted here lives in SQL and cannot be proven from JavaScript:
 * the RLS policies, the CHECK constraints, the UNIQUE idempotency guard, and above
 * all the SEQUENTIAL STACKING arithmetic inside grant_bonus_days. tests/
 * timeGrants.test.js covers the service contract and the entitlement function with
 * fakes; this covers what remains true even if that service is bypassed entirely.
 *
 * The whole migration chain 001..061 is applied to an empty schema, so a clean apply
 * of 061 in order is itself part of what this suite proves.
 *
 * Runs against a throwaway Postgres container, never a real database:
 *   node scripts/run-gsb-integration.mjs tests/integration/timeGrantsRls.db.test.js
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function psql(sqlText, { expectFailure = false } = {}) {
  const res = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"],
    { input: sqlText, encoding: "utf8" }
  );
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  if (expectFailure) {
    assert.notEqual(res.status, 0, `expected SQL to fail but it succeeded:\n${sqlText}\n${out}`);
    return out;
  }
  assert.equal(res.status, 0, `SQL failed:\n${sqlText}\n${out}`);
  // `-t -A` suppresses headers but psql still echoes a status tag for every
  // non-SELECT statement, so a query inside a transaction returns
  // "BEGIN/SET/1/COMMIT" instead of "1". Same filter as supportRls.db.test.js.
  return (res.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(BEGIN|COMMIT|ROLLBACK|SET|INSERT \d|UPDATE \d|DELETE \d|TRUNCATE TABLE)/.test(line))
    .join("\n");
}

/**
 * Wraps in a transaction so `set local` is scoped and nothing leaks between cases.
 * Without the explicit transaction `set local` is a no-op, the statement would run
 * as the superuser, and every RLS denial below would silently pass as a success.
 */
const tx = (body) => `begin;
${body}
commit;`;

/** Run as an authenticated end user, so RLS actually applies. */
function asUser(userId, sqlText, opts) {
  return psql(
    tx(
      `set local role authenticated;
       set local "request.jwt.claims" = '{"sub":"${userId}","role":"authenticated"}';
       ${sqlText}`
    ),
    opts
  );
}

before(() => {
  // Same ownership as the other .db suites: the runner only starts the container,
  // so each suite resets the schema, installs the Supabase auth compatibility layer
  // and applies the WHOLE migration chain itself. 061 references auth.users, so the
  // bootstrap has to land before the migrations, not merely before the fixtures.
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  const migrations = fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    psql(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  psql(`insert into auth.users (id, email) values
          ('${USER_A}', 'a@example.test'),
          ('${USER_B}', 'b@example.test')
        on conflict (id) do nothing;`);
});

beforeEach(() => {
  psql(`delete from public.time_grants where user_id in ('${USER_A}', '${USER_B}');`);
});

/* ------------------------------------------------------------------ */
/* Schema + constraints                                                */
/* ------------------------------------------------------------------ */

test("[schema] days must be positive and source must be one of the five", () => {
  psql(`select public.grant_bonus_days('${USER_A}'::uuid, 0, 'admin_grant', 'k-zero');`, { expectFailure: true });
  psql(`select public.grant_bonus_days('${USER_A}'::uuid, -5, 'admin_grant', 'k-neg');`, { expectFailure: true });
  psql(
    `insert into public.time_grants (user_id, source, days, effective_until, idempotency_key)
     values ('${USER_A}', 'free_lunch', 5, now() + interval '5 days', 'k-src');`,
    { expectFailure: true }
  );
});

/* ------------------------------------------------------------------ */
/* [H][I] Sequential stacking — the reason this suite exists           */
/* ------------------------------------------------------------------ */

test("[H] a second grant issued DURING an active window extends it, not replaces it", () => {
  // +5 days now
  psql(`select public.grant_bonus_days('${USER_A}'::uuid, 5, 'promo_campaign', 'k1');`);
  const first = psql(
    `select round(extract(epoch from (public.active_bonus_until('${USER_A}'::uuid) - now())) / 86400);`
  );
  assert.equal(first, "5", "first grant gives ~5 days");

  // +5 more while the first is still running -> 10 days total, NOT 5
  psql(`select public.grant_bonus_days('${USER_A}'::uuid, 5, 'promo_campaign', 'k2');`);
  const second = psql(
    `select round(extract(epoch from (public.active_bonus_until('${USER_A}'::uuid) - now())) / 86400);`
  );
  assert.equal(second, "10", "the second grant must EXTEND the first (10 days), not be swallowed (5)");
});

test("[I] four standard 5-day grants stack to 20 days", () => {
  for (let i = 1; i <= 4; i++) {
    psql(`select public.grant_bonus_days('${USER_A}'::uuid, 5, 'referral_inviter', 'stack-${i}');`);
  }
  const days = psql(
    `select round(extract(epoch from (public.active_bonus_until('${USER_A}'::uuid) - now())) / 86400);`
  );
  assert.equal(days, "20");
});

test("a grant issued after the window lapsed restarts from now, not from the stale end", () => {
  psql(
    `insert into public.time_grants (user_id, source, days, granted_at, effective_until, idempotency_key)
     values ('${USER_A}', 'admin_grant', 5, now() - interval '30 days', now() - interval '25 days', 'expired-1');`
  );
  psql(`select public.grant_bonus_days('${USER_A}'::uuid, 5, 'admin_grant', 'fresh-1');`);
  const days = psql(
    `select round(extract(epoch from (public.active_bonus_until('${USER_A}'::uuid) - now())) / 86400);`
  );
  assert.equal(days, "5", "an expired grant must not push the new window into the past");
});

/* ------------------------------------------------------------------ */
/* [K] Idempotency is enforced by the DB, not the caller               */
/* ------------------------------------------------------------------ */

test("[K] replaying the same idempotency key creates no second grant and does not re-stack", () => {
  psql(`select public.grant_bonus_days('${USER_A}'::uuid, 5, 'referral_inviter', 'dup-key');`);
  const created1 = psql(
    `select created from public.grant_bonus_days('${USER_A}'::uuid, 5, 'referral_inviter', 'dup-key');`
  );
  assert.equal(created1, "f", "a replay must report created = false");

  assert.equal(psql(`select count(*) from public.time_grants where idempotency_key = 'dup-key';`), "1");
  const days = psql(
    `select round(extract(epoch from (public.active_bonus_until('${USER_A}'::uuid) - now())) / 86400);`
  );
  assert.equal(days, "5", "a replay must not extend the window");
});

test("the unique constraint rejects a duplicate key inserted directly", () => {
  psql(`select public.grant_bonus_days('${USER_A}'::uuid, 5, 'admin_grant', 'unique-1');`);
  psql(
    `insert into public.time_grants (user_id, source, days, effective_until, idempotency_key)
     values ('${USER_B}', 'admin_grant', 5, now() + interval '5 days', 'unique-1');`,
    { expectFailure: true }
  );
});

/* ------------------------------------------------------------------ */
/* [J] Revocation is non-destructive                                   */
/* ------------------------------------------------------------------ */

test("[J] a revoked grant stops counting but keeps its row, days and window", () => {
  const id = psql(`select id from public.grant_bonus_days('${USER_A}'::uuid, 5, 'referral_inviter', 'rev-1');`);
  assert.equal(psql(`select public.active_bonus_until('${USER_A}'::uuid) is not null;`), "t");

  const revoked = psql(`select revoked from public.revoke_time_grant('${id}'::uuid, 'invitee refunded');`);
  assert.equal(revoked, "t");
  assert.equal(psql(`select public.active_bonus_until('${USER_A}'::uuid) is null;`), "t", "revoked grant must not count");

  // the row survives, unmutated, and auditable
  const row = psql(
    `select days || '|' || (revoked_at is not null) || '|' || coalesce(revoked_reason, '')
       from public.time_grants where id = '${id}';`
  );
  // `||` casts the boolean to text as 'true' (a bare `select bool` prints t)
  assert.equal(row, "5|true|invitee refunded");

  // revoking again is a no-op, not an overwrite
  assert.equal(psql(`select revoked from public.revoke_time_grant('${id}'::uuid, 'other reason');`), "f");
  assert.equal(psql(`select revoked_reason from public.time_grants where id = '${id}';`), "invitee refunded");
});

test("a revoked grant is excluded from the stacking base", () => {
  const id = psql(`select id from public.grant_bonus_days('${USER_A}'::uuid, 30, 'compensation', 'big-1');`);
  psql(`select public.revoke_time_grant('${id}'::uuid, 'granted in error');`);
  psql(`select public.grant_bonus_days('${USER_A}'::uuid, 5, 'admin_grant', 'after-revoke');`);
  const days = psql(
    `select round(extract(epoch from (public.active_bonus_until('${USER_A}'::uuid) - now())) / 86400);`
  );
  assert.equal(days, "5", "the revoked 30-day grant must not inflate the new window");
});

/* ------------------------------------------------------------------ */
/* [U] RLS                                                             */
/* ------------------------------------------------------------------ */

test("[U] a user may read only their own grants", () => {
  psql(`select public.grant_bonus_days('${USER_A}'::uuid, 5, 'admin_grant', 'rls-a');`);
  psql(`select public.grant_bonus_days('${USER_B}'::uuid, 5, 'admin_grant', 'rls-b');`);

  assert.equal(asUser(USER_A, `select count(*) from public.time_grants;`), "1", "A sees only A's grant");
  assert.equal(
    asUser(USER_A, `select count(*) from public.time_grants where user_id = '${USER_B}';`),
    "0",
    "A must not see B's grants"
  );
});

test("[U] a user may NOT insert, update or delete grants", () => {
  const id = psql(`select id from public.grant_bonus_days('${USER_A}'::uuid, 5, 'admin_grant', 'rls-write');`);

  // minting yourself ultra must be impossible from the client
  asUser(
    USER_A,
    `insert into public.time_grants (user_id, source, days, effective_until, idempotency_key)
     values ('${USER_A}', 'admin_grant', 3650, now() + interval '10 years', 'self-mint');`,
    { expectFailure: true }
  );
  /*
    UPDATE and DELETE are different, and the difference matters. With RLS on and
    no UPDATE/DELETE policy Postgres does not raise — the rows are simply not
    visible to modify, so the statement succeeds affecting ZERO rows. Asserting an
    error here would assert the wrong guarantee; what must hold is that the row is
    UNCHANGED and still present.
  */
  assert.equal(
    asUser(
      USER_A,
      `update public.time_grants set effective_until = now() + interval '10 years' where id = '${id}' returning 1;`
    ),
    "",
    "an authenticated client must update zero rows"
  );
  assert.equal(
    asUser(USER_A, `delete from public.time_grants where id = '${id}' returning 1;`),
    "",
    "an authenticated client must delete zero rows"
  );

  // and nothing changed
  assert.equal(psql(`select count(*) from public.time_grants where user_id = '${USER_A}';`), "1");
  assert.equal(psql(`select days from public.time_grants where id = '${id}';`), "5");
  assert.equal(
    psql(`select (effective_until < now() + interval '1 year') from public.time_grants where id = '${id}';`),
    "t",
    "the window must not have been extended to 10 years"
  );
  assert.equal(psql(`select count(*) from public.time_grants where idempotency_key = 'self-mint';`), "0");
});

test("[U] a client cannot execute the privileged grant/revoke functions", () => {
  asUser(USER_A, `select public.grant_bonus_days('${USER_A}'::uuid, 3650, 'admin_grant', 'client-grant');`, {
    expectFailure: true
  });
  const id = psql(`select id from public.grant_bonus_days('${USER_B}'::uuid, 5, 'admin_grant', 'srv-1');`);
  asUser(USER_A, `select public.revoke_time_grant('${id}'::uuid, 'nope');`, { expectFailure: true });
});

test("grants cascade away with the user", () => {
  psql(`insert into auth.users (id, email) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@example.test')
        on conflict (id) do nothing;`);
  psql(`select public.grant_bonus_days('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, 5, 'admin_grant', 'cascade-1');`);
  psql(`delete from auth.users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';`);
  assert.equal(psql(`select count(*) from public.time_grants where idempotency_key = 'cascade-1';`), "0");
});

/* ------------------------------------------------------------------ */
/* Stripe isolation                                                    */
/* ------------------------------------------------------------------ */

test("granting bonus time never touches profiles.subscription_expires_at", () => {
  /*
    profiles.tier / subscription_expires_at are guarded by migrations 027 and 029,
    which let only `service_role` through. The suite otherwise runs as the superuser
    `postgres`, which the guard correctly rejects, so the paid-state fixture is
    seeded as service_role — the same role the Stripe webhook writes under.
  */
  psql(
    tx(`set local role service_role;
        insert into public.profiles (user_id, tier, subscription_expires_at)
        values ('${USER_A}', 'premium', now() + interval '15 days')
        on conflict (user_id) do update set tier = 'premium',
          subscription_expires_at = now() + interval '15 days';`)
  );
  const before = psql(`select subscription_expires_at from public.profiles where user_id = '${USER_A}';`);

  psql(`select public.grant_bonus_days('${USER_A}'::uuid, 5, 'referral_inviter', 'stripe-iso');`);

  const after = psql(`select subscription_expires_at from public.profiles where user_id = '${USER_A}';`);
  assert.equal(after, before, "the Stripe-owned paid expiry must be byte-identical after a grant");
  assert.equal(psql(`select tier from public.profiles where user_id = '${USER_A}';`), "premium", "tier unchanged");
});
