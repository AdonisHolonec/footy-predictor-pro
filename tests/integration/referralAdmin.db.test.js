import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

/**
 * PR3d1 — atomic reversal against a REAL Postgres.
 *
 * The whole point of migration 064 is that three writes happen together or not at
 * all: revoke the inviter's grant, revoke the invitee's grant, move the attribution
 * to `reversed`. A fake cannot roll back, so a fake cannot test this.
 *
 * The two assertions that matter most, and that nothing else covers:
 *   - a forced failure mid-reversal leaves BOTH grants active and the state
 *     `rewarded` — never one grant revoked with the reward still standing, and
 *   - reversing frees the inviter's cap slot, so the next referral pays them again.
 *
 * Run:
 *   node scripts/run-gsb-integration.mjs tests/integration/referralAdmin.db.test.js
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";

const INVITER = "aaaa0001-1111-4111-8111-aaaaaaaaaaaa";
const INVITEE = "bbbb0001-2222-4222-8222-bbbbbbbbbbbb";
const OTHER = "cccc0001-3333-4333-8333-cccccccccccc";
const CODE = "AAAA111111";
const FIXTURE = 7201;
const REASON = "duplicate account, support ticket 1423";

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

/* ------------------------------------------------------------------ helpers */

const attribute = (invitee, inviter = INVITER) =>
  psql(
    `delete from public.referral_attributions where invitee_id = '${invitee}';
     insert into public.referral_attributions (inviter_id, invitee_id, code)
     values ('${inviter}', '${invitee}', '${CODE}') returning id;`
  );

const predicted = (user) =>
  psql(
    `insert into public.user_prediction_fixtures (user_id, fixture_id)
     values ('${user}', ${FIXTURE}) on conflict do nothing;`
  );

const qualify = (id) => psql(`select ok from public.qualify_referral('${id}');`);
const rewardRow = (id) =>
  psql(`select (case when ok then 't' else 'f' end) || '|capped=' || coalesce(inviter_capped::text,'?')
          from public.reward_referral('${id}');`);

const reverse = (id, reason = REASON) =>
  psql(`select (case when ok then 't' else 'f' end) || '|' || coalesce(reason, '-')
             || '|inv=' || inviter_grant_revoked::text || '|vitee=' || invitee_grant_revoked::text
          from public.reverse_referral('${id}', '${reason}');`);

const reverseMustFail = (id, reason) =>
  psql(`select * from public.reverse_referral('${id}', '${reason}');`, { expectFailure: true });

const stateOf = (id) => psql(`select state from public.referral_attributions where id = '${id}';`);
const grantCount = (extra = "") => psql(`select count(*) from public.time_grants${extra};`);

/** The exact predicate reward_referral uses for the cap. */
const capCount = (inviter = INVITER) =>
  psql(`select count(*) from public.referral_attributions
         where inviter_id = '${inviter}' and inviter_rewarded_at is not null and state <> 'reversed';`);

/** Give the inviter `n` already-paid referrals WITH real grants, so reversal has something to revoke. */
function seedPaidReferrals(n) {
  for (let i = 0; i < n; i += 1) {
    const uid = `d${String(i).padStart(3, "0")}0001-7777-4777-8777-dddddddddddd`;
    psql(`insert into auth.users (id, email, email_confirmed_at)
          values ('${uid}', 'paid${i}@example.test', now()) on conflict (id) do nothing;
          insert into public.profiles (user_id) values ('${uid}') on conflict do nothing;
          insert into public.referral_attributions (inviter_id, invitee_id, code)
          values ('${INVITER}', '${uid}', '${CODE}');
          -- AFTER the attribution: a Predict that predates it reads as not_new_account,
          -- which is exactly what PR3c's U1 rule is for.
          insert into public.user_prediction_fixtures (user_id, fixture_id)
          values ('${uid}', ${FIXTURE}) on conflict do nothing;`);
    const id = psql(`select id from public.referral_attributions where invitee_id = '${uid}';`);
    qualify(id);
    rewardRow(id);
  }
}

/* -------------------------------------------------------------------- setup */

before(() => {
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  for (const file of fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    psql(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  psql(`insert into auth.users (id, email, email_confirmed_at) values
          ('${INVITER}', 'inviter@example.test', now()),
          ('${INVITEE}', 'invitee@example.test', now()),
          ('${OTHER}',   'other@example.test',   now())
        on conflict (id) do nothing;
        insert into public.profiles (user_id) select id from auth.users on conflict do nothing;
        insert into public.predictions_history (fixture_id, validation, saved_at, updated_at, raw_payload)
        values (${FIXTURE}, 'pending', now(), now(), '{}'::jsonb) on conflict (fixture_id) do nothing;
        insert into public.referral_codes (user_id, code) values ('${INVITER}', '${CODE}')
        on conflict (code) do nothing;`);
});

beforeEach(() => {
  psql(`drop trigger if exists tg_block_revoke on public.time_grants;
        delete from public.time_grants;
        delete from public.referral_attributions;
        delete from public.user_prediction_fixtures;`);
});

/** A rewarded referral for INVITEE, returning its attribution id. */
function rewardedReferral() {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  rewardRow(id);
  return id;
}

/* ------------------------------------------------------------------- schema */

test("[schema] migration 064 applies and reverse_referral is service_role only", () => {
  assert.equal(
    psql(`select prosecdef::text || '|' || coalesce(array_to_string(proconfig, ','), 'none')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'reverse_referral';`),
    "true|search_path=public"
  );
  const acl = psql(`select coalesce(array_to_string(proacl, ','), '(default)')
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'reverse_referral';`);
  assert.match(acl, /service_role=X/, "service_role must execute");
  assert.ok(!/\banon=X/.test(acl), "anon must not execute");
  assert.ok(!/authenticated=X/.test(acl), "authenticated must not execute");
});

/* ----------------------------------------------------------------- reversal */

test("[reverse] a rewarded referral is reversed, revoking BOTH grants", () => {
  const id = rewardedReferral();
  assert.equal(grantCount(), "2");
  assert.equal(reverse(id), "t|-|inv=true|vitee=true");
  assert.equal(stateOf(id), "reversed");
  assert.equal(grantCount(" where revoked_at is not null"), "2", "both grants must be revoked");
  assert.equal(grantCount(), "2", "grants are revoked, never deleted");
});

test("[reverse] the reason is stored on both grants and on the attribution", () => {
  const id = rewardedReferral();
  reverse(id);
  assert.equal(psql(`select rejected_reason from public.referral_attributions where id = '${id}';`), REASON);
  assert.equal(
    psql(`select count(*) from public.time_grants where revoked_reason = '${REASON}';`),
    "2",
    "the reason must reach the ledger — it is the answer to 'why did my bonus stop?'"
  );
});

test("[reverse] every reward timestamp survives — audit, not erasure", () => {
  const id = rewardedReferral();
  const snapshot = psql(`select rewarded_at::text || '|' || inviter_rewarded_at::text || '|' || invitee_rewarded_at::text
                           from public.referral_attributions where id = '${id}';`);
  reverse(id);
  assert.equal(
    psql(`select rewarded_at::text || '|' || inviter_rewarded_at::text || '|' || invitee_rewarded_at::text
            from public.referral_attributions where id = '${id}';`),
    snapshot,
    "clearing them would make a reversal indistinguishable from a referral that never paid"
  );
  assert.equal(
    psql(`select (inviter_rewarded_at is not null)::text from public.referral_attributions where id = '${id}';`),
    "true"
  );
});

test("[reverse] a non-rewarded attribution is refused in every state", () => {
  for (const state of ["attributed", "qualified", "expired", "rejected"]) {
    const id = attribute(INVITEE);
    psql(`update public.referral_attributions set state = '${state}' where id = '${id}';`);
    assert.equal(reverse(id), "f|not_rewarded|inv=false|vitee=false");
    assert.equal(stateOf(id), state, "a refused reversal must not move the state");
  }
});

test("[reverse] a duplicate reversal converges instead of double-revoking", () => {
  const id = rewardedReferral();
  assert.equal(reverse(id), "t|-|inv=true|vitee=true");
  const firstRevokedAt = psql(`select string_agg(revoked_at::text, '|' order by source) from public.time_grants;`);

  assert.equal(reverse(id, "second attempt"), "t|already_reversed|inv=true|vitee=true");
  assert.equal(
    psql(`select string_agg(revoked_at::text, '|' order by source) from public.time_grants;`),
    firstRevokedAt,
    "a replay must not rewrite the original revocation timestamps"
  );
  assert.equal(
    psql(`select rejected_reason from public.referral_attributions where id = '${id}';`),
    REASON,
    "nor overwrite the original reason"
  );
});

test("[reverse] an empty or whitespace reason is refused", () => {
  const id = rewardedReferral();
  for (const reason of ["", "   ", "\t"]) {
    assert.equal(reverse(id, reason), "f|reason_required|inv=false|vitee=false");
  }
  assert.equal(stateOf(id), "rewarded");
  assert.equal(grantCount(" where revoked_at is not null"), "0", "nothing may be revoked without a reason");
});

test("[reverse] an over-long reason is refused rather than truncated", () => {
  const id = rewardedReferral();
  assert.equal(reverse(id, "x".repeat(501)), "f|reason_too_long|inv=false|vitee=false");
  assert.equal(stateOf(id), "rewarded");
});

test("[reverse] a CAPPED referral (no inviter grant) is still reversible", () => {
  // 063 pays the invitee only at the cap, so there is no inviter grant to revoke.
  // Treating that as an error would make capped referrals permanently un-reversible.
  seedPaidReferrals(10);
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  assert.equal(rewardRow(id), "t|capped=true");

  assert.equal(reverse(id), "t|-|inv=false|vitee=true", "no inviter grant existed; the invitee's is revoked");
  assert.equal(stateOf(id), "reversed");
  assert.equal(
    psql(`select count(*) from public.time_grants where reference_id = '${id}' and revoked_at is not null;`),
    "1"
  );
});

/* --------------------------------------------------------------- atomicity */

test("[atomicity] a failed revoke rolls the WHOLE reversal back", () => {
  /*
    THE MOST IMPORTANT TEST HERE. One grant revoked with the referral still
    `rewarded` is the state the system cannot describe — the inviter would keep a cap
    slot consumed for a reward that no longer stands.

    The trigger forces the UPDATE inside revoke_time_grant to fail for the invitee's
    grant, which happens AFTER the inviter's has already been revoked in the same
    transaction. Everything must vanish together.
  */
  const id = rewardedReferral();
  psql(`create or replace function block_revoke() returns trigger language plpgsql as $$
        begin
          if new.revoked_at is not null and new.source = 'referral_invitee' then
            raise exception 'forced revoke failure';
          end if;
          return new;
        end $$;
        create trigger tg_block_revoke before update on public.time_grants
          for each row execute function block_revoke();`);
  try {
    assert.match(reverseMustFail(id, REASON), /forced revoke failure/);

    assert.equal(stateOf(id), "rewarded", "state must not move when a revoke fails");
    assert.equal(grantCount(" where revoked_at is not null"), "0", "the inviter's revoke must roll back too");
    assert.equal(
      psql(`select (rejected_reason is null)::text from public.referral_attributions where id = '${id}';`),
      "true"
    );
  } finally {
    psql(`drop trigger if exists tg_block_revoke on public.time_grants;`);
  }

  // And the retry, on the untouched row, completes normally.
  assert.equal(reverse(id), "t|-|inv=true|vitee=true");
  assert.equal(grantCount(" where revoked_at is not null"), "2");
});

/* --------------------------------------------------------- cap restoration */

test("[cap] reversing a paid referral RESTORES the inviter's cap slot", () => {
  /*
    The end-to-end scenario, and the reason reversal must set `state='reversed'`
    rather than only revoking grants: 063's cap counts
    `inviter_rewarded_at is not null and state <> 'reversed'`, so revoking alone
    would leave the slot consumed and quietly cost the inviter future earnings.
  */
  seedPaidReferrals(10);
  assert.equal(capCount(), "10", "cap is full");

  // At the cap, a new referral pays the invitee only.
  const capped = attribute(OTHER);
  predicted(OTHER);
  qualify(capped);
  assert.equal(rewardRow(capped), "t|capped=true");

  // Reverse one of the ten paid referrals.
  const victim = psql(`select id from public.referral_attributions
                        where inviter_id = '${INVITER}' and inviter_rewarded_at is not null limit 1;`);
  assert.equal(reverse(victim), "t|-|inv=true|vitee=true");
  assert.equal(capCount(), "9", "the slot is freed");

  // The next qualified referral pays the inviter again.
  const fresh = attribute(INVITEE);
  predicted(INVITEE);
  qualify(fresh);
  assert.equal(rewardRow(fresh), "t|capped=false", "capRemaining is 1, so the inviter earns");
  assert.equal(capCount(), "10");
});

test("[cap] a reversal does NOT resurrect the reversed referral's own grants", () => {
  seedPaidReferrals(1);
  const victim = psql(`select id from public.referral_attributions where inviter_id = '${INVITER}' limit 1;`);
  reverse(victim);
  assert.equal(
    psql(`select count(*) from public.time_grants where reference_id = '${victim}' and revoked_at is null;`),
    "0",
    "both grants stay revoked; only the cap slot returns"
  );
});

/* ------------------------------------------------------- retry / no bypass */

test("[retry] a qualified-but-unrewarded referral is completed by reward_referral", () => {
  const id = attribute(INVITEE);
  predicted(INVITEE);
  qualify(id);
  assert.equal(
    psql(`select count(*) from public.referral_attributions where state = 'qualified' and rewarded_at is null;`),
    "1",
    "this is the earned-but-undelivered queue"
  );

  assert.equal(rewardRow(id), "t|capped=false");
  assert.equal(grantCount(), "2");
  assert.equal(
    psql(`select count(*) from public.referral_attributions where state = 'qualified' and rewarded_at is null;`),
    "0",
    "the queue drains"
  );
});

test("[retry] retrying after the reward landed is safe and creates nothing", () => {
  const id = rewardedReferral();
  const until = psql(`select string_agg(effective_until::text, '|' order by source) from public.time_grants;`);
  assert.equal(rewardRow(id), "t|capped=false");
  assert.equal(rewardRow(id), "t|capped=false");
  assert.equal(grantCount(), "2", "no duplicate grants");
  assert.equal(
    psql(`select string_agg(effective_until::text, '|' order by source) from public.time_grants;`),
    until,
    "and no second stacking"
  );
});

test("[safety] there is no grant path that bypasses reward_referral", () => {
  // Every referral grant must carry a referral source and an attribution reference.
  // A hand-rolled admin grant would have neither.
  rewardedReferral();
  assert.equal(
    psql(`select count(*) from public.time_grants
           where source in ('referral_inviter','referral_invitee')
             and (reference_id is null or idempotency_key not like 'ref:v1:%');`),
    "0"
  );
});

/* --------------------------------------------------------------------- RLS */

test("[rls] a signed-in client cannot reverse anything", () => {
  const id = rewardedReferral();
  asUser(INVITEE, `select public.reverse_referral('${id}', 'let me out');`, { expectFailure: true });
  asUser(INVITER, `select public.reverse_referral('${id}', 'mine now');`, { expectFailure: true });
  assert.equal(stateOf(id), "rewarded");
  assert.equal(grantCount(" where revoked_at is not null"), "0");
});

test("[rls] a signed-in client cannot reverse by writing the state directly", () => {
  const id = rewardedReferral();
  asUser(INVITEE, `update public.referral_attributions set state = 'reversed' where id = '${id}';`);
  asUser(INVITER, `update public.time_grants set revoked_at = now();`);
  assert.equal(stateOf(id), "rewarded");
  assert.equal(grantCount(" where revoked_at is not null"), "0");
});

test("[rls] a client cannot read the admin referral payload", () => {
  rewardedReferral();
  // The invitee sees only their OWN attribution row (062's policy); the inviter sees
  // none, and neither can reach the other party's grants.
  assert.equal(asUser(INVITEE, `select count(*) from public.referral_attributions;`), "1");
  assert.equal(asUser(INVITER, `select count(*) from public.referral_attributions;`), "0");
  assert.equal(asUser(OTHER, `select count(*) from public.referral_attributions;`), "0");
  /*
    061's `users_read_own_time_grants` lets a user read their OWN ledger rows — that
    is deliberate, and it is how "why did my bonus stop?" is answerable. What must
    not leak is the OTHER party's grant.
  */
  assert.equal(asUser(INVITER, `select count(*) from public.time_grants;`), "1", "own grant only");
  assert.equal(
    asUser(INVITER, `select count(*) from public.time_grants where user_id <> '${INVITER}';`),
    "0",
    "the inviter must never see the invitee's grant"
  );
  assert.equal(asUser(OTHER, `select count(*) from public.time_grants;`), "0");
});

/* ----------------------------------------------------------------- privacy */

test("[privacy] ip_hash stays a hash and no raw address is anywhere", () => {
  const id = attribute(INVITEE);
  psql(`update public.referral_attributions set ip_hash = '${"a".repeat(64)}' where id = '${id}';`);
  predicted(INVITEE);
  qualify(id);
  rewardRow(id);

  assert.match(
    psql(`select ip_hash from public.referral_attributions where id = '${id}';`),
    /^[0-9a-f]{64}$/,
    "the column holds a digest, never an address"
  );
  assert.equal(
    psql(`select count(*) from public.referral_attributions
           where (coalesce(ip_hash,'') || coalesce(rejected_reason,'') || code)
                 ~ '[0-9]{1,3}([.][0-9]{1,3}){3}';`),
    "0",
    "no dotted quad may be persisted"
  );
});

test("[privacy] referral grants carry no email, IP or Stripe identifier", () => {
  const id = rewardedReferral();
  const meta = psql(`select string_agg(metadata::text, ' ') from public.time_grants;`).toLowerCase();
  for (const forbidden of ["@", "example.test", "cus_", "sk_", "stripe", "ip_hash"]) {
    assert.ok(!meta.includes(forbidden), `${forbidden} must not appear in grant metadata`);
  }
  reverse(id);
  const after = psql(`select string_agg(coalesce(revoked_reason,'') || metadata::text, ' ') from public.time_grants;`);
  assert.ok(!after.includes("@"), "the reversal reason must not carry an email either");
});
