import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

/**
 * PR3c — qualification and reward against a REAL Postgres.
 *
 * tests/referralRewards.test.js proves the JavaScript maps the database's answer.
 * This proves the answer, and everything that actually protects money is here:
 * the eligibility predicate, the atomic two-grant transaction, the lifetime cap
 * under concurrency, the uuid lock ordering that keeps reciprocal referrals from
 * deadlocking, and the rollback that keeps a half-paid referral from existing.
 *
 * None of that can be simulated. A fake cannot deadlock, cannot roll back, and
 * cannot disagree with an advisory lock — which is exactly why PR1's
 * #variable_conflict defect survived 26 green unit tests, typecheck and lint before
 * a suite like this one caught it.
 *
 * Run:
 *   node scripts/run-gsb-integration.mjs tests/integration/referralRewards.db.test.js
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";

const INVITER = "aaaa0001-1111-4111-8111-aaaaaaaaaaaa";
const INVITEE = "bbbb0001-2222-4222-8222-bbbbbbbbbbbb";
const OTHER = "cccc0001-3333-4333-8333-cccccccccccc";
/** Verified, but has predicted BEFORE any attribution — the not-new account. */
const VETERAN = "dddd0001-4444-4444-8444-dddddddddddd";
/** Never confirmed their email. */
const UNVERIFIED = "eeee0001-5555-4555-8555-eeeeeeeeeeee";

const CODE = "AAAA111111";
const FIXTURE = 9101;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    /*
      Command tags only. CREATE/DROP/ALTER are deliberately NOT filtered: real query
      output starts with them too — `pg_indexes.indexdef` begins "CREATE INDEX" —
      and swallowing that turns a passing assertion into an empty string.
    */
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

/* ------------------------------------------------------------------ helpers */

/** A fresh attribution for this invitee, optionally backdated. Returns its id. */
const attribute = (invitee, ageInterval = "0 seconds", inviter = INVITER) =>
  psql(
    `delete from public.referral_attributions where invitee_id = '${invitee}';
     insert into public.referral_attributions (inviter_id, invitee_id, code, attributed_at)
     values ('${inviter}', '${invitee}', '${CODE}', now() - interval '${ageInterval}')
     returning id;`
  );

/** A persisted prediction ownership row — the canonical successful-Predict signal. */
const predicted = (user, offsetInterval = "0 seconds", fixture = FIXTURE) =>
  psql(
    `insert into public.user_prediction_fixtures (user_id, fixture_id, first_predicted_at)
     values ('${user}', ${fixture}, now() - interval '${offsetInterval}')
     on conflict (user_id, fixture_id) do update set first_predicted_at = excluded.first_predicted_at;`
  );

/** "t|-" on success, "f|<reason>" otherwise. */
const qualify = (id) =>
  psql(`select (case when ok then 't' else 'f' end) || '|' || coalesce(reason, '-')
          from public.qualify_referral('${id}');`);

const reward = (id) =>
  psql(`select (case when ok then 't' else 'f' end) || '|' || coalesce(reason, '-')
             || '|capped=' || coalesce(inviter_capped::text, '?')
          from public.reward_referral('${id}');`);

/** For the forced-failure tests: the RPC must RAISE, so psql must exit non-zero. */
const rewardMustFail = (id) =>
  psql(`select * from public.reward_referral('${id}');`, { expectFailure: true });

const stateOf = (id) => psql(`select state from public.referral_attributions where id = '${id}';`);

const grantCount = (source) =>
  psql(`select count(*) from public.time_grants${source ? ` where source = '${source}'` : ""};`);

/**
 * Fire N statements simultaneously in one container shell and wait for all.
 *
 * VALIDATED, NOT ESCAPED. These statements are interpolated into a double-quoted
 * shell string, and an escaper that handles a quote but not a backslash is a hole
 * rather than a defence — CodeQL flags exactly that (js/incomplete-sanitization),
 * and it is right to. Every statement this helper is ever given is built a few
 * lines above from a function name and a uuid, so the honest fix is to REFUSE
 * anything outside that shape instead of trying to neutralise it. A future test
 * needing a character this allowlist rejects should pass its SQL on stdin rather
 * than widen the pattern.
 */
function concurrently(statements) {
  for (const statement of statements) {
    assert.match(
      statement,
      /^[A-Za-z0-9_ ().,;:'-]+$/,
      `refusing to shell-interpolate an unexpected statement: ${statement}`
    );
  }
  const jobs = statements.map((s) => `psql -U postgres -d postgres -q -c "${s}" &`).join("\n");
  return spawnSync("docker", ["exec", "-i", CONTAINER, "bash", "-lc", `(${jobs}\nwait)`], { encoding: "utf8" });
}

/* -------------------------------------------------------------------- setup */

before(() => {
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  for (const file of fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    psql(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  psql(`insert into auth.users (id, email, email_confirmed_at) values
          ('${INVITER}',    'inviter@example.test',    now()),
          ('${INVITEE}',    'invitee@example.test',    now()),
          ('${OTHER}',      'other@example.test',      now()),
          ('${VETERAN}',    'veteran@example.test',    now()),
          ('${UNVERIFIED}', 'unverified@example.test', null)
        on conflict (id) do nothing;
        insert into public.profiles (user_id) select id from auth.users on conflict do nothing;
        insert into public.predictions_history (fixture_id, validation, saved_at, updated_at, raw_payload)
        values (${FIXTURE}, 'pending', now(), now(), '{}'::jsonb)
        on conflict (fixture_id) do nothing;
        insert into public.referral_codes (user_id, code) values ('${INVITER}', '${CODE}')
        on conflict (code) do nothing;`);
});

beforeEach(() => {
  /*
    The forced-failure triggers are dropped here as well as in their own tests. A
    leaked trigger would fail every LATER test for a reason that has nothing to do
    with them — which is exactly what happened the first time this suite ran.
  */
  psql(`drop trigger if exists tg_force_fail on public.time_grants;
        drop trigger if exists tg_force_fail2 on public.time_grants;
        delete from public.time_grants;
        delete from public.referral_attributions;
        delete from public.user_prediction_fixtures;`);
});

/* ------------------------------------------------------------------- schema */

test("[schema] migration 063 adds both reward columns and the partial cap index", () => {
  assert.equal(
    psql(`select string_agg(column_name, ',' order by column_name)
            from information_schema.columns
           where table_name = 'referral_attributions'
             and column_name in ('inviter_rewarded_at', 'invitee_rewarded_at');`),
    "invitee_rewarded_at,inviter_rewarded_at"
  );
  // Partial, because the cap only ever asks for rows that were actually paid.
  assert.match(
    psql(`select indexdef from pg_indexes
           where indexname = 'referral_attributions_inviter_rewarded_idx';`),
    /WHERE \(inviter_rewarded_at IS NOT NULL\)/
  );
});

test("[schema] auth.users carries email_confirmed_at — qualification depends on it", () => {
  assert.equal(
    psql(`select count(*) from information_schema.columns
           where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at';`),
    "1"
  );
});

/* ------------------------------------------------------------ qualification */

test("[qualify] verified email + post-attribution Predict qualifies", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  assert.equal(qualify(id), "t|-");
  assert.equal(stateOf(id), "qualified");
  assert.equal(
    psql(`select (qualified_at is not null)::text from public.referral_attributions where id = '${id}';`),
    "true"
  );
  // Qualification is not payment.
  assert.equal(grantCount(), "0", "qualify_referral must never write time_grants");
});

test("[qualify] an UNVERIFIED email cannot qualify, however many Predicts exist", () => {
  const id = attribute(UNVERIFIED);
  predicted(UNVERIFIED);
  assert.equal(qualify(id), "f|email_unverified");
  assert.equal(stateOf(id), "attributed");
});

test("[qualify] verification is read from auth.users, not from any caller", () => {
  const id = attribute(UNVERIFIED);
  predicted(UNVERIFIED);
  assert.equal(qualify(id), "f|email_unverified");
  // Confirm the address and the SAME call now succeeds — nothing else changed.
  psql(`update auth.users set email_confirmed_at = now() where id = '${UNVERIFIED}';`);
  assert.equal(qualify(id), "t|-");
  psql(`update auth.users set email_confirmed_at = null where id = '${UNVERIFIED}';`);
});

test("[qualify] no Predict at all cannot qualify", () => {
  const id = attribute(INVITEE);
  assert.equal(qualify(id), "f|no_qualifying_predict");
  assert.equal(stateOf(id), "attributed");
});

test("[qualify] a Predict BEFORE attribution does not qualify — U1", () => {
  // The referral caused nothing: this account was already using the product.
  const id = attribute(VETERAN, "1 hour");
  predicted(VETERAN, "2 hours");
  assert.equal(qualify(id), "f|not_new_account");
  assert.equal(stateOf(id), "attributed");
});

test("[qualify] a prior Predict blocks the referral even if a NEW one follows", () => {
  const id = attribute(VETERAN, "1 hour");
  predicted(VETERAN, "2 hours", FIXTURE);
  psql(`insert into public.predictions_history (fixture_id, validation, saved_at, updated_at, raw_payload)
        values (${FIXTURE + 1}, 'pending', now(), now(), '{}'::jsonb) on conflict (fixture_id) do nothing;`);
  predicted(VETERAN, "0 seconds", FIXTURE + 1);
  // A post-attribution Predict exists, but the account was not new. Still refused.
  assert.equal(qualify(id), "f|not_new_account");
});

test("[qualify] the ownership row is the signal — a usage counter is not", () => {
  const id = attribute(INVITEE);
  /*
    Migration 009's counter moves BEFORE persistence (012 ships
    rollback_predict_increment precisely because it must be walked back when
    persistence fails), so it must never be what pays a reward.
  */
  psql(`select public.increment_warm_predict_usage('${INVITEE}', current_date, 'predict', 50);`);
  assert.equal(qualify(id), "f|no_qualifying_predict", "an attempt is not a persisted prediction");
  predicted(INVITEE);
  assert.equal(qualify(id), "t|-");
});

/* ------------------------------------------------------------------ expiry */

test("[expiry] day 29 qualifies; day 31 does not", () => {
  const open = attribute(INVITEE, "29 days");
  predicted(INVITEE);
  assert.equal(qualify(open), "t|-");

  const closed = attribute(OTHER, "31 days");
  predicted(OTHER);
  assert.equal(qualify(closed), "f|expired");
  assert.equal(stateOf(closed), "attributed", "qualification refuses; it does not transition");
});

test("[expiry] the 30-day boundary is HALF-OPEN — the instant itself is expired", () => {
  // Matches isAttributionExpired's `>=` exactly. One clock, two languages.
  const justInside = attribute(INVITEE, "29 days 23 hours 59 minutes");
  predicted(INVITEE);
  assert.equal(qualify(justInside), "t|-");

  const exactlyAt = attribute(OTHER, "30 days");
  predicted(OTHER);
  assert.equal(qualify(exactlyAt), "f|expired");
});

test("[expiry] a QUALIFIED referral still pays after the window closes", () => {
  /*
    Earned on day 29, delivered on day 31. Re-checking the clock at payment time
    would let a transient failure confiscate a reward the user already earned, in a
    way indistinguishable from being cheated.
  */
  const id = attribute(INVITEE, "29 days");
  predicted(INVITEE);
  assert.equal(qualify(id), "t|-");

  psql(`update public.referral_attributions
           set attributed_at = now() - interval '31 days'
         where id = '${id}';`);
  assert.equal(reward(id), "t|-|capped=false", "delivery must not re-test expiry");
  assert.equal(grantCount(), "2");
});

/* ------------------------------------------------------------ terminal states */

for (const state of ["rejected", "reversed", "expired"]) {
  test(`[qualify] a "${state}" attribution can never be qualified`, () => {
    const id = attribute(INVITEE);
    predicted(INVITEE);
    psql(`update public.referral_attributions set state = '${state}' where id = '${id}';`);
    assert.equal(qualify(id), `f|${state}`);
    assert.equal(stateOf(id), state);
    assert.equal(grantCount(), "0");
  });
}

test("[qualify] replaying qualification is idempotent, not a second transition", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  assert.equal(qualify(id), "t|-");
  const first = psql(`select qualified_at from public.referral_attributions where id = '${id}';`);
  assert.equal(qualify(id), "f|already_qualified");
  assert.equal(
    psql(`select qualified_at from public.referral_attributions where id = '${id}';`),
    first,
    "qualified_at must not be rewritten by a replay"
  );
});

/* ------------------------------------------------------------------ reward */

test("[reward] a qualified referral pays BOTH parties 5 days, correctly attributed", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  assert.equal(reward(id), "t|-|capped=false");

  assert.equal(grantCount(), "2");
  assert.equal(
    psql(`select source || '|' || days || '|' || (reference_id = '${id}')::text
             || '|' || (metadata->'referral'->>'role')
             || '|' || (metadata->'referral'->>'campaign')
            from public.time_grants order by source;`),
    ["referral_invitee|5|true|invitee|v1", "referral_inviter|5|true|inviter|v1"].join("\n")
  );
  // The bonus really is five days long, not five of something else.
  assert.equal(
    psql(`select count(*) from public.time_grants
           where effective_until between now() + interval '4 days' and now() + interval '6 days';`),
    "2"
  );
});

test("[reward] the grants go to the right two people", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  reward(id);
  assert.equal(
    psql(`select source || '=' || user_id from public.time_grants order by source;`),
    [`referral_invitee=${INVITEE}`, `referral_inviter=${INVITER}`].join("\n")
  );
});

test("[reward] metadata carries no PII", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  reward(id);
  const meta = psql(`select metadata::text from public.time_grants;`).toLowerCase();
  for (const forbidden of ["@", "example.test", "cus_", "stripe", "token"]) {
    assert.ok(!meta.includes(forbidden), `${forbidden} must not appear in grant metadata`);
  }
  assert.match(meta, /qualifiedat/);
});

test("[reward] both reward columns are stamped, and state becomes rewarded", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  reward(id);
  assert.equal(
    psql(`select state || '|' || (rewarded_at is not null)::text
             || '|' || (inviter_rewarded_at is not null)::text
             || '|' || (invitee_rewarded_at is not null)::text
            from public.referral_attributions where id = '${id}';`),
    "rewarded|true|true|true"
  );
});

test("[reward] NO reward is possible before qualification", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  assert.equal(reward(id), "f|not_qualified|capped=?");
  assert.equal(grantCount(), "0", "an unqualified referral must never produce a grant");
  assert.equal(stateOf(id), "attributed");
});

test("[reward] replaying a reward creates no second grant and no second stacking", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  reward(id);
  const until = psql(`select effective_until from public.time_grants order by source;`);

  assert.equal(reward(id), "t|already_rewarded|capped=false");
  assert.equal(reward(id), "t|already_rewarded|capped=false");
  assert.equal(grantCount(), "2", "idempotency keys must collapse every replay");
  assert.equal(
    psql(`select effective_until from public.time_grants order by source;`),
    until,
    "a replay must not extend the bonus"
  );
});

/* --------------------------------------------------------------------- cap */

/** Give the inviter `n` already-paid referrals, without going through reward. */
function seedInviterRewards(n) {
  for (let i = 0; i < n; i += 1) {
    const uid = `f${String(i).padStart(3, "0")}0001-6666-4666-8666-ffffffffffff`;
    psql(`insert into auth.users (id, email, email_confirmed_at)
          values ('${uid}', 'cap${i}@example.test', now()) on conflict (id) do nothing;
          insert into public.profiles (user_id) values ('${uid}') on conflict do nothing;
          insert into public.referral_attributions
            (inviter_id, invitee_id, code, state, attributed_at, qualified_at, rewarded_at,
             inviter_rewarded_at, invitee_rewarded_at)
          values ('${INVITER}', '${uid}', '${CODE}', 'rewarded', now(), now(), now(), now(), now());`);
  }
}

test("[cap] the 10th referral still pays the inviter", () => {
  seedInviterRewards(9);
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  assert.equal(reward(id), "t|-|capped=false", "nine paid referrals leaves one");
  assert.equal(grantCount("referral_inviter"), "1");
  assert.equal(grantCount("referral_invitee"), "1");
});

test("[cap] the 11th pays the INVITEE only — U2", () => {
  seedInviterRewards(10);
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  assert.equal(reward(id), "t|-|capped=true");

  assert.equal(grantCount("referral_inviter"), "0", "the inviter has exhausted their cap");
  assert.equal(grantCount("referral_invitee"), "1", "the invitee did the work and is paid regardless");
  assert.equal(
    psql(`select state || '|' || (inviter_rewarded_at is null)::text || '|' || (invitee_rewarded_at is not null)::text
            from public.referral_attributions where id = '${id}';`),
    "rewarded|true|true",
    "a capped referral is REWARDED, not rejected or failed"
  );
});

test("[cap] a capped referral does not consume a cap slot", () => {
  seedInviterRewards(10);
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  reward(id);
  // Still exactly ten paid inviter rewards — the capped one is not counted.
  assert.equal(
    psql(`select count(*) from public.referral_attributions
           where inviter_id = '${INVITER}' and inviter_rewarded_at is not null and state <> 'reversed';`),
    "10"
  );
});

test("[cap] a REVERSED referral frees its slot", () => {
  seedInviterRewards(10);
  psql(`update public.referral_attributions set state = 'reversed'
         where id = (select id from public.referral_attributions
                      where inviter_id = '${INVITER}' and state = 'rewarded' limit 1);`);
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  assert.equal(reward(id), "t|-|capped=false", "nine countable rewards leaves one slot");
});

test("[cap] the cap counts only PAID inviter halves — not attributions or expiries", () => {
  seedInviterRewards(9);
  for (const [i, state] of ["attributed", "expired", "rejected", "qualified"].entries()) {
    const uid = `a${String(i).padStart(3, "0")}0002-7777-4777-8777-aaaaaaaaaaaa`;
    psql(`insert into auth.users (id, email, email_confirmed_at)
          values ('${uid}', 'noise${i}@example.test', now()) on conflict (id) do nothing;
          insert into public.profiles (user_id) values ('${uid}') on conflict do nothing;
          insert into public.referral_attributions (inviter_id, invitee_id, code, state)
          values ('${INVITER}', '${uid}', '${CODE}', '${state}');`);
  }
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  assert.equal(reward(id), "t|-|capped=false", "only inviter_rewarded_at counts");
});

/* ------------------------------------------------------------- concurrency */

test("[concurrency] simultaneous qualification produces exactly one transition", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  const proc = concurrently(Array.from({ length: 4 }, () => `select public.qualify_referral('${id}')`));
  assert.equal(proc.status, 0, `concurrent qualification errored:\n${proc.stdout}${proc.stderr}`);
  assert.equal(stateOf(id), "qualified");
  assert.equal(grantCount(), "0", "qualification never pays");
});

test("[concurrency] simultaneous reward pays exactly once", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  const proc = concurrently(Array.from({ length: 4 }, () => `select public.reward_referral('${id}')`));
  assert.equal(proc.status, 0, `concurrent reward errored:\n${proc.stdout}${proc.stderr}`);
  assert.equal(grantCount(), "2", "exactly-once EFFECT, however many executions");
  assert.equal(stateOf(id), "rewarded");
});

test("[concurrency] 9 paid + two simultaneous rewards pays the inviter exactly once more", () => {
  /*
    THE CAP RACE. Both transactions read the count; without the advisory lock both
    would see nine and both would pay, taking the inviter to eleven.
  */
  seedInviterRewards(9);
  const a = attribute(INVITEE);
  const b = attribute(OTHER);
  predicted(INVITEE);
  predicted(OTHER);
  qualify(a);
  qualify(b);

  const proc = concurrently([`select public.reward_referral('${a}')`, `select public.reward_referral('${b}')`]);
  assert.equal(proc.status, 0, `cap race errored:\n${proc.stdout}${proc.stderr}`);

  assert.equal(grantCount("referral_inviter"), "1", "exactly ONE more inviter payout");
  assert.equal(grantCount("referral_invitee"), "2", "both invitees are paid regardless");
  assert.equal(
    psql(`select count(*) from public.referral_attributions
           where inviter_id = '${INVITER}' and inviter_rewarded_at is not null;`),
    "10",
    "the cap holds at exactly ten"
  );
  // Both referrals are still REWARDED — the capped one is not a failure.
  assert.equal(
    psql(`select count(*) from public.referral_attributions where id in ('${a}','${b}') and state = 'rewarded';`),
    "2"
  );
});

test("[deadlock] reciprocal referrals rewarded simultaneously do not deadlock", () => {
  /*
    A invites B and B invites A — allowed in V1. Both transactions want the same two
    per-user grant locks. Ordering the grants by ROLE would have one take (A then B)
    and the other (B then A); ordering by uuid gives both the same sequence, so
    neither can hold what the other needs.
  */
  const ab = attribute(INVITEE, "0 seconds", INVITER);
  const ba = attribute(INVITER, "0 seconds", INVITEE);
  predicted(INVITEE);
  predicted(INVITER);
  qualify(ab);
  qualify(ba);

  const proc = concurrently([`select public.reward_referral('${ab}')`, `select public.reward_referral('${ba}')`]);
  const out = `${proc.stdout || ""}${proc.stderr || ""}`;
  assert.equal(proc.status, 0, `reciprocal reward errored:\n${out}`);
  assert.ok(!/deadlock detected/i.test(out), `uuid lock ordering failed:\n${out}`);

  assert.equal(grantCount(), "4", "two referrals, two parties each");
  assert.equal(psql(`select count(*) from public.referral_attributions where state = 'rewarded';`), "2");
  // Each person is paid twice: once as inviter, once as invitee.
  assert.equal(
    psql(`select user_id || '=' || count(*) from public.time_grants group by user_id order by user_id;`)
      .split("\n")
      .every((line) => line.endsWith("=2")),
    true
  );
});

test("[deadlock] the migration orders both grants by user id, not by role", () => {
  const sql = fs.readFileSync("supabase/migrations/063_referral_rewards.sql", "utf8");
  assert.match(
    sql,
    /v_a\.inviter_id::text\s*<\s*v_a\.invitee_id::text/,
    "the lock order must be decided by uuid comparison"
  );
});

/* --------------------------------------------------------- partial failure */

test("[atomicity] an inviter grant failure rolls the invitee grant back entirely", () => {
  /*
    THE MOST IMPORTANT TEST IN THIS FILE. A half-paid referral is the one outcome
    the ledger cannot express and no compensation can reliably repair.

    The inviter's grant is forced to fail with a trigger, which is the only way to
    make a healthy grant_bonus_days raise. Everything must vanish with it.
  */
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);

  psql(`create or replace function force_fail_inviter() returns trigger language plpgsql as $$
        begin
          if new.user_id = '${INVITER}' then
            raise exception 'forced inviter grant failure';
          end if;
          return new;
        end $$;
        create trigger tg_force_fail before insert on public.time_grants
          for each row execute function force_fail_inviter();`);

  try {
    // The RPC must RAISE — anything less would mean a half-paid referral committed.
    assert.match(rewardMustFail(id), /forced inviter grant failure/);

    assert.equal(grantCount(), "0", "the invitee grant must NOT survive the inviter's failure");
    assert.equal(stateOf(id), "qualified", "state must stay qualified — earned, undelivered, retryable");
    assert.equal(
      psql(`select (rewarded_at is null)::text from public.referral_attributions where id = '${id}';`),
      "true",
      "rewarded_at must never be stamped on a failed reward"
    );
  } finally {
    psql(`drop trigger if exists tg_force_fail on public.time_grants;`);
  }

  // And the retry, on the unchanged row, completes normally.
  assert.equal(reward(id), "t|-|capped=false");
  assert.equal(grantCount(), "2");
  assert.equal(stateOf(id), "rewarded");
});

test("[atomicity] an invitee grant failure leaves nothing and stays qualified", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);

  psql(`create or replace function force_fail_invitee() returns trigger language plpgsql as $$
        begin
          if new.user_id = '${INVITEE}' then
            raise exception 'forced invitee grant failure';
          end if;
          return new;
        end $$;
        create trigger tg_force_fail2 before insert on public.time_grants
          for each row execute function force_fail_invitee();`);

  try {
    assert.match(rewardMustFail(id), /forced invitee grant failure/);
    assert.equal(grantCount(), "0");
    assert.equal(stateOf(id), "qualified");
  } finally {
    psql(`drop trigger if exists tg_force_fail2 on public.time_grants;`);
  }
  assert.equal(reward(id), "t|-|capped=false");
  assert.equal(grantCount(), "2");
});

/* --------------------------------------------------------------------- RLS */

test("[grants] a signed-in client cannot qualify or reward anything", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  asUser(INVITEE, `select public.qualify_referral('${id}');`, { expectFailure: true });
  asUser(INVITEE, `select public.reward_referral('${id}');`, { expectFailure: true });
  asUser(INVITER, `select public.reward_referral('${id}');`, { expectFailure: true });
  assert.equal(stateOf(id), "attributed");
  assert.equal(grantCount(), "0");
});

test("[rls] a client cannot self-qualify by writing the state directly", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  // No UPDATE policy exists, so Postgres affects zero rows rather than raising —
  // the row itself is the assertion.
  asUser(INVITEE, `update public.referral_attributions set state = 'qualified' where id = '${id}';`);
  asUser(
    INVITEE,
    `update public.referral_attributions set state = 'rewarded', inviter_rewarded_at = now() where id = '${id}';`
  );
  assert.equal(stateOf(id), "attributed");
});

test("[rls] a client cannot mint itself a time_grant", () => {
  asUser(
    INVITEE,
    `insert into public.time_grants (user_id, source, days, effective_until, idempotency_key)
     values ('${INVITEE}', 'referral_invitee', 5, now() + interval '5 days', 'forged');`,
    { expectFailure: true }
  );
  assert.equal(grantCount(), "0");
});

test("[rls] a client cannot forge a Predict ownership row to fake qualification", () => {
  // user_prediction_fixtures is service-only (`using (false)`), which is what stops
  // an invitee from manufacturing the qualifying event.
  const id = attribute(INVITEE);
  asUser(
    INVITEE,
    `insert into public.user_prediction_fixtures (user_id, fixture_id) values ('${INVITEE}', ${FIXTURE});`,
    { expectFailure: true }
  );
  assert.equal(qualify(id), "f|no_qualifying_predict");
});

/* ------------------------------------------------------------- entitlement */

test("[entitlement] both parties become ULTRA, and revert when the bonus lapses", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  reward(id);

  // active_bonus_until is what resolveEffectiveTierFromProfile consumes.
  for (const user of [INVITER, INVITEE]) {
    assert.equal(
      psql(`select (public.active_bonus_until('${user}') > now() + interval '4 days')::text;`),
      "true",
      `${user} must have ~5 days of bonus`
    );
  }

  // Lapse it and the bonus is gone — the underlying tier is untouched throughout.
  psql(`update public.time_grants set effective_until = now() - interval '1 second';`);
  for (const user of [INVITER, INVITEE]) {
    assert.equal(
      psql(`select coalesce(public.active_bonus_until('${user}')::text, 'NONE');`),
      "NONE",
      `${user} must fall back to their underlying tier`
    );
  }
});

test("[entitlement] a second referral STACKS sequentially rather than overlapping", () => {
  const first = attribute(INVITEE);
  predicted(INVITEE);
  qualify(first);
  reward(first);
  const afterOne = psql(`select public.active_bonus_until('${INVITER}');`);

  const second = attribute(OTHER);
  predicted(OTHER);
  qualify(second);
  reward(second);
  const afterTwo = psql(`select public.active_bonus_until('${INVITER}');`);

  assert.ok(
    Date.parse(afterTwo) - Date.parse(afterOne) > 4 * DAY_MS,
    `the second reward must extend the window, not be swallowed by it (${afterOne} -> ${afterTwo})`
  );
});

/* ------------------------------------------------------------- no surprises */

test("[safety] nothing in this flow can pay a user who was not part of the referral", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  reward(id);
  assert.equal(
    psql(`select count(*) from public.time_grants where user_id not in ('${INVITER}', '${INVITEE}');`),
    "0"
  );
});
