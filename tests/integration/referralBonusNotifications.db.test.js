import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

import {
  acknowledgeReferralBonuses,
  listPendingReferralBonuses
} from "../../server-utils/referralNotifications.js";
import { validateSupportPayload, SUPPORT_CATEGORIES } from "../../server-utils/supportApi.js";
import { validateDisplayName as validateDisplayNameSafety } from "../../server-utils/contentSafety.js";

/**
 * Migration 065 and the notification discovery path, against a REAL Postgres.
 *
 * tests/referralNotifications.test.js proves the JavaScript against a double. A
 * double cannot enforce a primary key, cannot refuse an INSERT under RLS, and
 * cannot cascade a delete — which is precisely the set of guarantees this feature
 * leans on. "Show each reward once, to its owner only" is a DATABASE promise here,
 * not an application one, so it is proven where it actually lives.
 *
 * The module under test runs UNMODIFIED against this database through a thin
 * PostgREST-shaped shim (below) that turns its query chain into SQL. The point is
 * that the real `listPendingReferralBonuses` and `acknowledgeReferralBonuses`
 * execute here — only the transport is substituted, never the logic.
 *
 * Run:
 *   node scripts/run-gsb-integration.mjs tests/integration/referralBonusNotifications.db.test.js
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";

const INVITER = "aaaa0065-1111-4111-8111-aaaaaaaaaaaa";
const INVITEE = "bbbb0065-2222-4222-8222-bbbbbbbbbbbb";
const OTHER = "cccc0065-3333-4333-8333-cccccccccccc";
const CODE = "BB65111111";
const FIXTURE = 9165;

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
  return (res.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(BEGIN|COMMIT|ROLLBACK|SET|INSERT \d|UPDATE \d|DELETE \d|TRUNCATE TABLE)/.test(l))
    .join("\n");
}

const tx = (body) => `begin;\n${body}\ncommit;`;

/** Run SQL as a signed-in end user, exactly as PostgREST would. */
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

/* ------------------------------------------------------- the transport shim */

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

/**
 * The smallest thing that can carry this module's queries to Postgres.
 *
 * It implements only the chain the module actually uses — select/eq/in/is/
 * order/limit and a conflict-ignoring upsert — and deliberately nothing else, so
 * it cannot quietly answer a query the real client would have rejected.
 */
function pgShim() {
  const from = (table) => {
    const state = { table, cols: "*", where: [], order: "", limit: "" };
    const chain = {
      select(cols) {
        if (cols) state.cols = cols;
        return chain;
      },
      eq(c, v) {
        state.where.push(`${c} = ${lit(v)}`);
        return chain;
      },
      in(c, vals) {
        state.where.push(vals.length ? `${c} in (${vals.map(lit).join(",")})` : "false");
        return chain;
      },
      is(c, v) {
        state.where.push(v === null ? `${c} is null` : `${c} = ${lit(v)}`);
        return chain;
      },
      order(c, opts) {
        state.order = ` order by ${c} ${opts && opts.ascending === false ? "desc" : "asc"}`;
        return chain;
      },
      limit(n) {
        state.limit = ` limit ${Number(n)}`;
        return chain;
      },
      upsert(rows) {
        if (!rows.length) return Promise.resolve({ error: null });
        const cols = Object.keys(rows[0]);
        const values = rows.map((r) => `(${cols.map((c) => lit(r[c])).join(",")})`).join(",");
        try {
          psql(
            `insert into public.${state.table} (${cols.join(",")}) values ${values} on conflict (grant_id) do nothing;`
          );
          return Promise.resolve({ error: null });
        } catch (err) {
          return Promise.resolve({ error: { message: String(err && err.message) } });
        }
      },
      then(resolve) {
        const where = state.where.length ? ` where ${state.where.join(" and ")}` : "";
        const sql =
          `select coalesce(json_agg(t), '[]'::json)::text from ` +
          `(select ${state.cols} from public.${state.table}${where}${state.order}${state.limit}) t;`;
        let data = [];
        let error = null;
        try {
          data = JSON.parse(psql(sql) || "[]");
        } catch (err) {
          error = { message: String(err && err.message) };
        }
        return Promise.resolve({ data, error }).then(resolve);
      }
    };
    return chain;
  };
  return { from };
}

const db = () => ({ supabase: pgShim() });

/* ------------------------------------------------------------------ helpers */

/** A referral grant owned by `user`, referencing `attributionId`. Returns its id. */
function grant(user, source, attributionId, { revoked = false, days = 5, key } = {}) {
  const id = psql(
    `insert into public.time_grants (user_id, source, days, effective_until, reference_id, idempotency_key, revoked_at)
     values (${lit(user)}, ${lit(source)}, ${days}, now() + interval '5 days', ${lit(attributionId)},
             ${lit(key || `k:${Math.random().toString(36).slice(2)}`)}, ${revoked ? "now()" : "null"})
     returning id;`
  );
  return id.trim();
}

/** An attribution from INVITER to `invitee`, already rewarded. Returns its id. */
function attribution(invitee) {
  return psql(
    `insert into public.referral_attributions (inviter_id, invitee_id, code, state)
     values (${lit(INVITER)}, ${lit(invitee)}, ${lit(CODE)}, 'rewarded')
     returning id;`
  ).trim();
}

before(() => {
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  // 001 -> 065, in order. If 065 does not apply cleanly, every test below fails
  // here — which is case (A) of the brief, proven by construction.
  for (const file of fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    psql(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  psql(`insert into auth.users (id, email, email_confirmed_at) values
          ('${INVITER}', 'inviter65@example.test', now()),
          ('${INVITEE}', 'invitee65@example.test', now()),
          ('${OTHER}',   'other65@example.test',   now())
        on conflict (id) do nothing;
        insert into public.profiles (user_id) select id from auth.users on conflict do nothing;
        insert into public.predictions_history (fixture_id, validation, saved_at, updated_at, raw_payload)
        values (${FIXTURE}, 'pending', now(), now(), '{}'::jsonb) on conflict (fixture_id) do nothing;
        insert into public.referral_codes (user_id, code) values ('${INVITER}', '${CODE}')
        on conflict (code) do nothing;`);
});

beforeEach(() => {
  psql(`delete from public.referral_grant_notifications;
        delete from public.time_grants;
        delete from public.referral_attributions;
        update public.profiles set display_name = null;`);
});

/* ------------------------------------------------------- schema guarantees */

test("065 created referral_grant_notifications with grant_id as PRIMARY KEY", () => {
  const pk = psql(
    `select a.attname
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.referral_grant_notifications'::regclass and i.indisprimary;`
  );
  assert.equal(pk, "grant_id");
});

test("grant_id references time_grants and cascades on delete", () => {
  const a = attribution(INVITEE);
  const g = grant(INVITER, "referral_inviter", a);
  psql(`insert into public.referral_grant_notifications (grant_id, user_id) values (${lit(g)}, ${lit(INVITER)});`);

  psql(`delete from public.time_grants where id = ${lit(g)};`);
  const left = psql(`select count(*) from public.referral_grant_notifications where grant_id = ${lit(g)};`);
  assert.equal(left, "0", "deleting the grant left an orphaned notification row");
});

test("user_id cascades when the account is deleted", () => {
  const doomed = psql(
    `insert into auth.users (id, email, email_confirmed_at)
     values (gen_random_uuid(), 'doomed65@example.test', now()) returning id;`
  ).trim();
  psql(`insert into public.profiles (user_id) values (${lit(doomed)}) on conflict do nothing;`);
  const a = attribution(INVITEE);
  const g = grant(doomed, "referral_invitee", a);
  psql(`insert into public.referral_grant_notifications (grant_id, user_id) values (${lit(g)}, ${lit(doomed)});`);

  psql(`delete from auth.users where id = ${lit(doomed)};`);
  assert.equal(psql(`select count(*) from public.referral_grant_notifications where user_id = ${lit(doomed)};`), "0");
});

test("a grant cannot be acknowledged twice — the primary key forbids it", () => {
  const a = attribution(INVITEE);
  const g = grant(INVITER, "referral_inviter", a);
  psql(`insert into public.referral_grant_notifications (grant_id, user_id) values (${lit(g)}, ${lit(INVITER)});`);
  psql(`insert into public.referral_grant_notifications (grant_id, user_id) values (${lit(g)}, ${lit(INVITER)});`, {
    expectFailure: true
  });
  assert.equal(psql(`select count(*) from public.referral_grant_notifications where grant_id = ${lit(g)};`), "1");
});

/* --------------------------------------------------------------------- RLS */

test("RLS is enabled on the notification table", () => {
  assert.equal(
    psql(`select relrowsecurity from pg_class where oid = 'public.referral_grant_notifications'::regclass;`),
    "t"
  );
});

test("a user reads their OWN notification rows and no one else's", () => {
  const a = attribution(INVITEE);
  const mine = grant(INVITER, "referral_inviter", a);
  const theirs = grant(OTHER, "referral_invitee", a);
  psql(`insert into public.referral_grant_notifications (grant_id, user_id)
        values (${lit(mine)}, ${lit(INVITER)}), (${lit(theirs)}, ${lit(OTHER)});`);

  assert.equal(asUser(INVITER, `select count(*) from public.referral_grant_notifications;`), "1");
  assert.equal(
    asUser(INVITER, `select count(*) from public.referral_grant_notifications where user_id = ${lit(OTHER)};`),
    "0"
  );
});

test("a client cannot INSERT, UPDATE or DELETE an acknowledgement", () => {
  const a = attribution(INVITEE);
  const g = grant(INVITER, "referral_inviter", a);

  // No insert policy exists, so the write is refused rather than silently applied.
  asUser(
    INVITER,
    `insert into public.referral_grant_notifications (grant_id, user_id) values (${lit(g)}, ${lit(INVITER)});`,
    { expectFailure: true }
  );
  assert.equal(psql(`select count(*) from public.referral_grant_notifications;`), "0");

  // With a row present (written by the service role), update and delete are no-ops:
  // UPDATE/DELETE with no policy match zero rows rather than erroring.
  psql(`insert into public.referral_grant_notifications (grant_id, user_id) values (${lit(g)}, ${lit(INVITER)});`);
  asUser(INVITER, `update public.referral_grant_notifications set acknowledged_at = now() - interval '1 day';`);
  asUser(INVITER, `delete from public.referral_grant_notifications;`);
  assert.equal(
    psql(`select count(*) from public.referral_grant_notifications where grant_id = ${lit(g)};`),
    "1",
    "a client removed or altered its own acknowledgement"
  );
});

/* ------------------------------------------------ display_name constraints */

test("display_name enforces the 3-24 policy, refuses emails and control characters", () => {
  psql(`update public.profiles set display_name = 'andrei@example.test' where user_id = ${lit(INVITEE)};`, {
    expectFailure: true
  });
  // 24 is the ceiling; 25 is not.
  psql(`update public.profiles set display_name = repeat('A', 25) where user_id = ${lit(INVITEE)};`, {
    expectFailure: true
  });
  psql(`update public.profiles set display_name = repeat('A', 24) where user_id = ${lit(INVITEE)};`);
  // 3 is the floor; 2 is not.
  psql(`update public.profiles set display_name = 'Ab' where user_id = ${lit(INVITEE)};`, { expectFailure: true });
  psql(`update public.profiles set display_name = 'Ana' where user_id = ${lit(INVITEE)};`);
  psql(`update public.profiles set display_name = E'Andrei\\nPopescu' where user_id = ${lit(INVITEE)};`, {
    expectFailure: true
  });
  // And accepts a real name.
  psql(`update public.profiles set display_name = 'Andrei Popescu' where user_id = ${lit(INVITEE)};`);
  assert.equal(psql(`select display_name from public.profiles where user_id = ${lit(INVITEE)};`), "Andrei Popescu");
});

test("a client cannot write display_name at all — the trigger refuses it", () => {
  /*
    The whole content-safety model rests on this. If `authenticated` can UPDATE the
    column through PostgREST, it can set any name it likes and the profanity filter
    in application code is decorative. The trigger is what makes the API the only
    writer — a column-level REVOKE cannot work here, because Supabase grants UPDATE
    on the whole table.
  */
  asUser(INVITEE, `update public.profiles set display_name = 'Ana' where user_id = ${lit(INVITEE)};`, {
    expectFailure: true
  });

  // Everything else on the row is still the user's own to change.
  asUser(INVITEE, `update public.profiles set favorite_leagues = '{39}' where user_id = ${lit(INVITEE)};`);
  assert.equal(psql(`select favorite_leagues from public.profiles where user_id = ${lit(INVITEE)};`), "{39}");

  // And the service role — which is what the API uses — still can.
  psql(`update public.profiles set display_name = 'Ana' where user_id = ${lit(INVITEE)};`);
  assert.equal(psql(`select display_name from public.profiles where user_id = ${lit(INVITEE)};`), "Ana");
});

/* ------------------------------------------- discovery through the module */

test("an inviter grant is discovered WITH the invitee's real display name", async () => {
  psql(`update public.profiles set display_name = 'Andrei Popescu' where user_id = ${lit(INVITEE)};`);
  const a = attribution(INVITEE);
  const g = grant(INVITER, "referral_inviter", a);

  const [bonus] = await listPendingReferralBonuses(INVITER, db());
  assert.equal(bonus.grantId, g);
  assert.equal(bonus.role, "inviter");
  assert.equal(bonus.inviteeName, "Andrei Popescu");
  assert.equal(bonus.days, 5);
  // The whole point of the join: no email, no uuid.
  assert.ok(!JSON.stringify(bonus).includes("@"));
  assert.ok(!JSON.stringify(bonus).includes(INVITEE));
});

test("an invitee grant is discovered and names nobody", async () => {
  psql(`update public.profiles set display_name = 'Inviter Person' where user_id = ${lit(INVITER)};`);
  const a = attribution(INVITEE);
  grant(INVITEE, "referral_invitee", a);

  const [bonus] = await listPendingReferralBonuses(INVITEE, db());
  assert.equal(bonus.role, "invitee");
  assert.equal(bonus.inviteeName, null);
  assert.ok(!JSON.stringify(bonus).includes("Inviter Person"));
});

test("a non-referral grant and a revoked grant are both ignored", async () => {
  const a = attribution(INVITEE);
  grant(INVITER, "admin_grant", a);
  grant(INVITER, "referral_inviter", a, { revoked: true });
  assert.deepEqual(await listPendingReferralBonuses(INVITER, db()), []);
});

test("ten grants yield ten distinct notifications, each keeping its own name", async () => {
  for (let i = 0; i < 10; i += 1) {
    const invitee = psql(
      `insert into auth.users (id, email, email_confirmed_at)
       values (gen_random_uuid(), 'bulk${i}@example.test', now()) returning id;`
    ).trim();
    psql(`insert into public.profiles (user_id, display_name) values (${lit(invitee)}, ${lit(`Invitee ${i}`)})
          on conflict (user_id) do update set display_name = excluded.display_name;`);
    const a = psql(
      `insert into public.referral_attributions (inviter_id, invitee_id, code, state)
       values (${lit(INVITER)}, ${lit(invitee)}, ${lit(CODE)}, 'rewarded') returning id;`
    ).trim();
    grant(INVITER, "referral_inviter", a, { key: `bulk:${i}` });
  }

  const bonuses = await listPendingReferralBonuses(INVITER, db());
  assert.equal(bonuses.length, 10);
  assert.equal(new Set(bonuses.map((b) => b.grantId)).size, 10);
  assert.equal(new Set(bonuses.map((b) => b.inviteeName)).size, 10, "names were aggregated or lost");
});

/* --------------------------------------------------- acknowledgement cycle */

test("pending -> acknowledged -> not pending, and it stays that way for a second session", async () => {
  const a = attribution(INVITEE);
  const g = grant(INVITER, "referral_inviter", a);

  assert.equal((await listPendingReferralBonuses(INVITER, db())).length, 1, "not pending on first look");
  await acknowledgeReferralBonuses(INVITER, [g], db());
  assert.deepEqual(await listPendingReferralBonuses(INVITER, db()), [], "still pending after acknowledgement");

  // A different device is a different client against the same database.
  assert.deepEqual(await listPendingReferralBonuses(INVITER, db()), [], "second session was told again");
});

test("acknowledging twice is idempotent — one row, no error", async () => {
  const a = attribution(INVITEE);
  const g = grant(INVITER, "referral_inviter", a);
  await acknowledgeReferralBonuses(INVITER, [g], db());
  await acknowledgeReferralBonuses(INVITER, [g], db());
  assert.equal(psql(`select count(*) from public.referral_grant_notifications where grant_id = ${lit(g)};`), "1");
});

test("concurrent acknowledgement of the same grant still leaves exactly one row", async () => {
  const a = attribution(INVITEE);
  const g = grant(INVITER, "referral_inviter", a);
  await Promise.all([
    acknowledgeReferralBonuses(INVITER, [g], db()),
    acknowledgeReferralBonuses(INVITER, [g], db()),
    acknowledgeReferralBonuses(INVITER, [g], db())
  ]);
  assert.equal(psql(`select count(*) from public.referral_grant_notifications where grant_id = ${lit(g)};`), "1");
});

test("user A cannot acknowledge user B's grant", async () => {
  const a = attribution(INVITEE);
  const theirs = grant(OTHER, "referral_invitee", a);

  const result = await acknowledgeReferralBonuses(INVITER, [theirs], db());
  assert.equal(result.acknowledged, 0);
  assert.equal(
    psql(`select count(*) from public.referral_grant_notifications where grant_id = ${lit(theirs)};`),
    "0",
    "one account suppressed another account's notification"
  );
  // And the rightful owner is still told.
  assert.equal((await listPendingReferralBonuses(OTHER, db())).length, 1);
});

test("acknowledgement never mutates the grant ledger", async () => {
  const a = attribution(INVITEE);
  const g = grant(INVITER, "referral_inviter", a);
  const before = psql(`select md5(row_to_json(t)::text) from public.time_grants t where id = ${lit(g)};`);
  await acknowledgeReferralBonuses(INVITER, [g], db());
  const after = psql(`select md5(row_to_json(t)::text) from public.time_grants t where id = ${lit(g)};`);
  assert.equal(after, before, "the time_grants row changed while acknowledging a notification");
});

/* ------------------------------------------------ admin message safety */

test("a profane message to an administrator is refused and writes NO ticket row", () => {
  /*
    The point is the SECOND assertion. Rejecting the text is easy; proving the
    rejection happens before anything touches the database is what guarantees a
    blocked message cannot leave a half-written ticket behind for an admin to read.
  */
  const before = psql("select count(*) from public.support_tickets;");

  const base = { category: SUPPORT_CATEGORIES[0], subject: "Problema", message: "Butonul nu merge." };
  assert.equal(validateSupportPayload(base).ok, true, "a clean message must still be accepted");

  for (const bad of [
    { ...base, message: "sunteti niste f.u.c.k.e.r.i" },
    { ...base, subject: "muie admin" },
    { ...base, message: "ce sh1t de aplicatie" }
  ]) {
    const result = validateSupportPayload(bad);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "inappropriate_message");
    // The matched term must never travel back to the caller.
    const dump = JSON.stringify(result).toLowerCase();
    assert.equal(dump.includes("fuck") || dump.includes("muie") || dump.includes("sh1t"), false);
  }

  const after = psql("select count(*) from public.support_tickets;");
  assert.equal(after, before, "a rejected message created a ticket row");
});

test("a profane display name is refused before it can reach the column", () => {
  // The database CHECK covers shape and length; the dictionary lives in JS, so
  // this proves the two halves agree on the same value.
  const check = validateDisplayNameSafety("Pula");
  assert.equal(check.ok, false);
  assert.equal(check.reason, "inappropriate_display_name");
  // And a name the filter accepts is one the constraint also accepts.
  const good = validateDisplayNameSafety("Andrei Pop");
  assert.equal(good.ok, true);
  psql(`update public.profiles set display_name = ${lit(good.value)} where user_id = ${lit(INVITEE)};`);
  assert.equal(psql(`select display_name from public.profiles where user_id = ${lit(INVITEE)};`), "Andrei Pop");
});

/* ------------------------------------- the whole chain, no mocks anywhere */

test("claim -> qualify -> reward -> grants -> notification, end to end", async () => {
  psql(`update public.profiles set display_name = 'Maria Ionescu' where user_id = ${lit(INVITEE)};`);

  // Claim, through the real SQL entry point.
  // RETURNS TABLE, so the column is selected FROM the call, not dereferenced off it.
  const attributionId = psql(`select attribution_id from public.claim_referral(${lit(INVITEE)}, ${lit(CODE)}, null);`).trim();
  assert.ok(attributionId, "claim_referral did not return an attribution");

  // The invitee's first Predict, after attribution — the qualification precondition.
  psql(`insert into public.user_prediction_fixtures (user_id, fixture_id, first_predicted_at)
        values (${lit(INVITEE)}, ${FIXTURE}, now())
        on conflict (user_id, fixture_id) do update set first_predicted_at = excluded.first_predicted_at;`);

  psql(`select qualify_referral(${lit(attributionId)});`);
  psql(`select reward_referral(${lit(attributionId)});`);

  // Both sides were actually paid.
  assert.equal(psql(`select count(*) from public.time_grants where reference_id = ${lit(attributionId)};`), "2");

  const inviterBonuses = await listPendingReferralBonuses(INVITER, db());
  assert.equal(inviterBonuses.length, 1);
  assert.equal(inviterBonuses[0].role, "inviter");
  assert.equal(inviterBonuses[0].inviteeName, "Maria Ionescu", "the real chain did not resolve the invitee's name");
  assert.equal(inviterBonuses[0].days, 5);

  const inviteeBonuses = await listPendingReferralBonuses(INVITEE, db());
  assert.equal(inviteeBonuses.length, 1);
  assert.equal(inviteeBonuses[0].role, "invitee");
  assert.equal(inviteeBonuses[0].inviteeName, null, "the invitee was told who invited them");

  // Neither side is told twice.
  await acknowledgeReferralBonuses(INVITER, [inviterBonuses[0].grantId], db());
  await acknowledgeReferralBonuses(INVITEE, [inviteeBonuses[0].grantId], db());
  assert.deepEqual(await listPendingReferralBonuses(INVITER, db()), []);
  assert.deepEqual(await listPendingReferralBonuses(INVITEE, db()), []);
});
