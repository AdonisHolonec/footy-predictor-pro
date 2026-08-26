import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

/**
 * PR3a — referral attribution against a REAL Postgres.
 *
 * tests/referrals.test.js proves the JavaScript maps the database's answer. This
 * proves the answer. Everything that actually protects the feature is SQL:
 * UNIQUE(invitee_id), the self-referral CASE inside claim_referral, the email
 * normalisation rule, the RLS policies and the function grants. A fake cannot
 * disagree with any of them, which is exactly why PR1's #variable_conflict defect
 * survived 26 green unit tests, typecheck and lint before this gate caught it.
 *
 * Run:
 *   node scripts/run-gsb-integration.mjs tests/integration/referrals.db.test.js
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";

const INVITER = "11111111-1111-4111-8111-111111111111";
const INVITEE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
/** Same human as INVITER, seen through Gmail's dot- and +tag-insensitivity. */
const ALIAS = "44444444-4444-4444-8444-444444444444";
const CODE = "ABCD234567";
const OTHER_CODE = "ZYXW987654";

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

/** "t|-" on success, "f|<reason>" otherwise. Cast explicitly: psql renders a
 *  boolean concatenated with text as "true"/"false", not as t/f. */
const claim = (invitee, code) =>
  psql(
    `select (case when ok then 't' else 'f' end) || '|' || coalesce(reason, '-')
       from public.claim_referral('${invitee}', '${code}');`
  );

before(() => {
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  for (const file of fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    psql(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  psql(`insert into auth.users (id, email) values
          ('${INVITER}', 'inviter.person+work@gmail.com'),
          ('${INVITEE}', 'invitee@example.test'),
          ('${OTHER}',   'other@example.test'),
          ('${ALIAS}',   'inviterperson@googlemail.com')
        on conflict (id) do nothing;`);
});

beforeEach(() => {
  psql(`delete from public.referral_attributions;
        delete from public.referral_codes;
        insert into public.referral_codes (user_id, code) values ('${INVITER}', '${CODE}'), ('${OTHER}', '${OTHER_CODE}');`);
});

/* ------------------------------------------------------------ constraints */

test("[schema] UNIQUE(invitee_id) — an invitee can be attributed exactly once", () => {
  assert.equal(claim(INVITEE, CODE), "t|-");
  psql(
    `insert into public.referral_attributions (inviter_id, invitee_id, code)
     values ('${OTHER}', '${INVITEE}', '${OTHER_CODE}');`,
    { expectFailure: true }
  );
  assert.equal(psql(`select count(*) from public.referral_attributions;`), "1");
});

test("[schema] UNIQUE(code) — two inviters cannot share a code", () => {
  psql(`insert into public.referral_codes (user_id, code) values ('${INVITEE}', '${CODE}');`, {
    expectFailure: true
  });
});

test("[schema] one ACTIVE code per inviter, but disabled history is preserved", () => {
  // A second ACTIVE row is refused...
  psql(`insert into public.referral_codes (user_id, code) values ('${INVITER}', 'SECOND2345');`, {
    expectFailure: true
  });
  // ...while a replacement alongside a DISABLED row is allowed. This is the whole
  // reason the index is partial rather than a plain unique(user_id).
  psql(`update public.referral_codes set disabled_at = now() where user_id = '${INVITER}';`);
  psql(`insert into public.referral_codes (user_id, code) values ('${INVITER}', 'SECOND2345');`);
  assert.equal(psql(`select count(*) from public.referral_codes where user_id = '${INVITER}';`), "2");
});

test("[schema] the CHECK constraint blocks self-attribution even by direct insert", () => {
  psql(
    `insert into public.referral_attributions (inviter_id, invitee_id, code)
     values ('${INVITER}', '${INVITER}', '${CODE}');`,
    { expectFailure: true }
  );
});

test("[schema] state is constrained to the declared set", () => {
  claim(INVITEE, CODE);
  psql(`update public.referral_attributions set state = 'banana';`, { expectFailure: true });
  for (const s of ["attributed", "qualified", "rewarded", "rejected", "expired", "reversed"]) {
    psql(`update public.referral_attributions set state = '${s}';`);
  }
});

test("[schema] FK enforcement — attribution requires real users", () => {
  psql(
    `insert into public.referral_attributions (inviter_id, invitee_id, code)
     values ('${INVITER}', '99999999-9999-4999-8999-999999999999', '${CODE}');`,
    { expectFailure: true }
  );
});

test("[schema] deleting a user cascades their referral rows away", () => {
  psql(`insert into auth.users (id, email) values ('55555555-5555-4555-8555-555555555555','tmp@example.test');`);
  psql(`insert into public.referral_codes (user_id, code) values ('55555555-5555-4555-8555-555555555555','TMPCODE234');`);
  psql(`delete from auth.users where id = '55555555-5555-4555-8555-555555555555';`);
  assert.equal(psql(`select count(*) from public.referral_codes where code = 'TMPCODE234';`), "0");
});

/* --------------------------------------------------------- claim outcomes */

test("[claim] a valid claim attributes the invitee to the code owner", () => {
  assert.equal(claim(INVITEE, CODE), "t|-");
  assert.equal(
    psql(`select inviter_id || '|' || state from public.referral_attributions where invitee_id = '${INVITEE}';`),
    `${INVITER}|attributed`
  );
});

test("[claim] codes are matched case- and whitespace-insensitively", () => {
  assert.equal(claim(INVITEE, "  abcd234567  "), "t|-");
});

test("[claim] invalid, missing and disabled codes are distinguished", () => {
  assert.equal(claim(INVITEE, "NOSUCHCODE"), "f|invalid_code");
  assert.equal(claim(INVITEE, ""), "f|missing_code");
  psql(`update public.referral_codes set disabled_at = now() where code = '${CODE}';`);
  assert.equal(claim(INVITEE, CODE), "f|disabled_code");
});

test("[claim] a rejected claim writes NOTHING", () => {
  /*
    Load-bearing: referral_attributions is UNIQUE(invitee_id), so persisting a
    rejection would burn the invitee's only slot and bar them from a legitimate
    referral for ever over a typo.
  */
  claim(INVITEE, "NOSUCHCODE");
  claim(INVITEE, "");
  claim(INVITER, CODE);
  assert.equal(psql(`select count(*) from public.referral_attributions;`), "0");
  // ...and the invitee can still be attributed properly afterwards.
  assert.equal(claim(INVITEE, CODE), "t|-");
});

test("[claim] attribution is immutable — a second inviter is refused", () => {
  assert.equal(claim(INVITEE, CODE), "t|-");
  assert.equal(claim(INVITEE, OTHER_CODE), "f|already_attributed");
  assert.equal(
    psql(`select inviter_id from public.referral_attributions where invitee_id = '${INVITEE}';`),
    INVITER
  );
});

test("[claim] re-claiming the SAME code converges instead of failing", () => {
  const first = psql(`select attribution_id from public.claim_referral('${INVITEE}', '${CODE}');`);
  const second = psql(`select attribution_id from public.claim_referral('${INVITEE}', '${CODE}');`);
  assert.equal(second, first, "an idempotent retry must return the same attribution");
});

/* -------------------------------------------------------- self-referral */

test("[self] same account is blocked", () => {
  assert.equal(claim(INVITER, CODE), "f|self_referral_same_account");
});

test("[self] exact email match is blocked", () => {
  psql(`insert into auth.users (id, email) values
          ('66666666-6666-4666-8666-666666666666', 'inviter.person+work@gmail.com')
        on conflict (id) do nothing;`);
  const out = psql(`select reason from public.claim_referral('66666666-6666-4666-8666-666666666666', '${CODE}');`);
  assert.equal(out, "self_referral_same_email");
  psql(`delete from auth.users where id = '66666666-6666-4666-8666-666666666666';`);
});

test("[self] Gmail +tag and dot aliasing is blocked", () => {
  // inviter.person+work@gmail.com  vs  inviterperson@googlemail.com
  assert.equal(claim(ALIAS, CODE), "f|self_referral_normalized_email");
});

test("[self] two accounts cannot share a Stripe customer in the first place", () => {
  /*
    Migration 028 already carries `profiles_stripe_customer_id_uidx` — a partial
    UNIQUE on stripe_customer_id where not null. So the shared-customer case that
    claim_referral tests for cannot physically occur: the database refuses the
    second profile before a referral is ever claimed.

    The branch in claim_referral is therefore DEFENCE IN DEPTH, not the live
    protection, and this test asserts the protection that actually holds. Keeping
    the branch costs nothing and survives the index being relaxed; pretending it is
    what stops the attack would be the misleading part.
  */
  psql(tx(`set local role service_role;
           insert into public.profiles (user_id, stripe_customer_id) values ('${INVITER}', 'cus_shared')
             on conflict (user_id) do update set stripe_customer_id = 'cus_shared';`));

  psql(
    tx(`set local role service_role;
        insert into public.profiles (user_id, stripe_customer_id) values ('${INVITEE}', 'cus_shared')
          on conflict (user_id) do update set stripe_customer_id = 'cus_shared';`),
    { expectFailure: true }
  );

  psql(tx(`set local role service_role;
           update public.profiles set stripe_customer_id = null where user_id in ('${INVITER}', '${INVITEE}');`));
});

test("[self] a NULL stripe customer on both sides is not a match", () => {
  // Two users who have simply never paid must not look like one person.
  assert.equal(claim(INVITEE, CODE), "t|-");
});

test("[normalize] the email rule is Gmail-specific", () => {
  assert.equal(psql(`select public.referral_normalize_email('A.B+tag@Gmail.com');`), "ab@gmail.com");
  assert.equal(psql(`select public.referral_normalize_email('A.B+tag@GoogleMail.com');`), "ab@gmail.com");
  // Dots are significant everywhere else — stripping them globally would merge
  // two genuinely different people.
  assert.equal(psql(`select public.referral_normalize_email('a.b@example.test');`), "a.b@example.test");
  assert.equal(psql(`select public.referral_normalize_email('a.b+tag@example.test');`), "a.b@example.test");
  assert.equal(psql(`select coalesce(public.referral_normalize_email('nonsense'), 'NULL');`), "NULL");
});

/* ------------------------------------------------------------ concurrency */

test("[concurrency] simultaneous claims converge on exactly one attribution", () => {
  /*
    Three sessions racing for the same invitee, two naming one inviter and one
    naming another. The unique constraint is the serialisation point — there is no
    advisory lock and none is needed.
  */
  const proc = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      CONTAINER,
      "bash",
      "-lc",
      `(psql -U postgres -d postgres -q -c "select public.claim_referral('${INVITEE}','${CODE}')" &
        psql -U postgres -d postgres -q -c "select public.claim_referral('${INVITEE}','${CODE}')" &
        psql -U postgres -d postgres -q -c "select public.claim_referral('${INVITEE}','${OTHER_CODE}')" &
        wait)`
    ],
    { encoding: "utf8" }
  );
  assert.equal(proc.status, 0, `concurrent claims errored:\n${proc.stdout}${proc.stderr}`);
  assert.equal(
    psql(`select count(*) from public.referral_attributions where invitee_id = '${INVITEE}';`),
    "1",
    "concurrent claims must produce exactly one attribution"
  );
});

/* -------------------------------------------------------------------- RLS */

test("[rls] a client cannot self-mint a referral code", () => {
  asUser(INVITEE, `insert into public.referral_codes (user_id, code) values ('${INVITEE}', 'SELFMINT12');`, {
    expectFailure: true
  });
});

test("[rls] a client cannot forge an attribution, for themselves or anyone", () => {
  asUser(
    INVITEE,
    `insert into public.referral_attributions (inviter_id, invitee_id, code)
     values ('${OTHER}', '${INVITEE}', '${OTHER_CODE}');`,
    { expectFailure: true }
  );
  asUser(
    INVITEE,
    `insert into public.referral_attributions (inviter_id, invitee_id, code)
     values ('${INVITEE}', '${OTHER}', '${CODE}');`,
    { expectFailure: true }
  );
});

test("[rls] a client cannot UPDATE or DELETE an attribution", () => {
  claim(INVITEE, CODE);
  /*
    No UPDATE/DELETE policy exists, and Postgres answers a policy-less mutation by
    affecting ZERO rows rather than raising — so absence of an error proves nothing.
    The row itself is the assertion.
  */
  asUser(INVITEE, `update public.referral_attributions set state = 'rewarded' where invitee_id = '${INVITEE}';`);
  asUser(INVITEE, `delete from public.referral_attributions where invitee_id = '${INVITEE}';`);
  assert.equal(
    psql(`select state from public.referral_attributions where invitee_id = '${INVITEE}';`),
    "attributed",
    "a client must not be able to promote itself to rewarded"
  );
});

test("[rls] the invitee sees their own attribution; the inviter sees no rows", () => {
  claim(INVITEE, CODE);
  assert.equal(asUser(INVITEE, `select count(*) from public.referral_attributions;`), "1");
  // The inviter deliberately has NO select policy: a row carries invitee_id, and a
  // counter is not worth handing over the user ids of everyone who accepted.
  assert.equal(asUser(INVITER, `select count(*) from public.referral_attributions;`), "0");
  assert.equal(asUser(OTHER, `select count(*) from public.referral_attributions;`), "0");
});

test("[rls] an inviter reads their own code and nobody else's", () => {
  assert.equal(asUser(INVITER, `select code from public.referral_codes;`), CODE);
  assert.equal(asUser(INVITEE, `select count(*) from public.referral_codes;`), "0");
});

test("[rls] anon is locked out of both tables", () => {
  for (const table of ["referral_codes", "referral_attributions"]) {
    psql(tx(`set local role anon; select count(*) from public.${table};`), { expectFailure: true });
  }
});

test("[grants] a signed-in client cannot execute the privileged functions", () => {
  asUser(INVITEE, `select public.claim_referral('${INVITEE}', '${CODE}');`, { expectFailure: true });
  asUser(INVITEE, `select public.referral_inviter_summary('${INVITER}');`, { expectFailure: true });
});

/* ------------------------------------------------------------- no rewards */

test("[safety] PR3a never touches time_grants", () => {
  claim(INVITEE, CODE);
  psql(`select public.referral_inviter_summary('${INVITER}');`);
  assert.equal(psql(`select count(*) from public.time_grants;`), "0", "PR3a must not grant bonus time");
});

test("[summary] inviter counts are aggregates with no invitee identity in them", () => {
  claim(INVITEE, CODE);
  const row = psql(`select attributed_count || '|' || qualified_count || '|' || rewarded_count
                      from public.referral_inviter_summary('${INVITER}');`);
  assert.equal(row, "1|0|0");
  assert.ok(!row.includes(INVITEE), "the summary must not carry invitee ids");
});

/* ======================================================================== */
/*  PR3b — the claim layer, against real Postgres                           */
/*                                                                          */
/*  NO SECRET IS INJECTED HERE, and none is needed. This harness speaks to   */
/*  Postgres over `docker exec psql`; it never loads the JavaScript service, */
/*  so REFERRAL_IP_HASH_SECRET has nothing to key. What the database is      */
/*  responsible for is STORING a hash it is handed and never seeing an       */
/*  address — proven below with a literal digest. That the digest is the     */
/*  right one, is stable, and is derived from the secret is proven in        */
/*  tests/referrals.test.js, where the module is loaded for real. Splitting  */
/*  it this way is what keeps the production secret contract intact: no      */
/*  test-only fallback, no weakened default, nothing to forget to remove.    */
/* ======================================================================== */

/** A stand-in for what referralIpHash.js produces: 64 hex characters. */
const IP_HASH = "b".repeat(64);
const OTHER_IP_HASH = "c".repeat(64);

/** claim_referral with an ip hash. Returns "t|-" / "f|<reason>" like `claim`. */
const claimWithIp = (invitee, code, ipHash) =>
  psql(
    `select (case when ok then 't' else 'f' end) || '|' || coalesce(reason, '-')
       from public.claim_referral('${invitee}', '${code}', ${ipHash === null ? "null" : `'${ipHash}'`});`
  );

/** Backdate an attribution so the 30-day window has demonstrably closed. */
const ageAttribution = (invitee, interval) =>
  psql(
    `update public.referral_attributions
        set attributed_at = now() - interval '${interval}'
      where invitee_id = '${invitee}';`
  );

/**
 * The EXACT statement expireAttributionIfElapsed issues, as service_role.
 *
 * Written out rather than imported because this harness has no PostgREST to run
 * the service through. The unit suite asserts the payload and the filters the
 * JavaScript sends; this asserts what those filters DO to real rows.
 */
const lazyExpire = (invitee) =>
  psql(
    `update public.referral_attributions
        set state = 'expired', rejected_reason = 'attribution_window_elapsed'
      where invitee_id = '${invitee}' and state = 'attributed';
     select state || '|' || coalesce(rejected_reason, '-')
       from public.referral_attributions where invitee_id = '${invitee}';`
  );

/* --------------------------------------------------------------- ip hash */

test("[ip] a supplied hash is stored verbatim on the attribution", () => {
  assert.equal(claimWithIp(INVITEE, CODE, IP_HASH), "t|-");
  assert.equal(psql(`select ip_hash from public.referral_attributions where invitee_id = '${INVITEE}';`), IP_HASH);
});

test("[ip] no hash stores NULL — not an empty string, which would compare equal", () => {
  assert.equal(claimWithIp(INVITEE, CODE, null), "t|-");
  assert.equal(
    psql(`select coalesce(ip_hash, 'IS-NULL') from public.referral_attributions where invitee_id = '${INVITEE}';`),
    "IS-NULL"
  );
});

test("[ip] two invitees behind ONE address both record it — same IP is never a block", () => {
  // A soft signal, deliberately: carrier-grade NAT, offices and student halls put
  // thousands of unrelated people behind one address. This is for a human to look
  // at in PR3d, not for the claim path to act on.
  assert.equal(claimWithIp(INVITEE, CODE, IP_HASH), "t|-");
  assert.equal(claimWithIp(OTHER, CODE, IP_HASH), "t|-");
  assert.equal(
    psql(`select count(*) from public.referral_attributions where ip_hash = '${IP_HASH}';`),
    "2",
    "both claims must succeed and both hashes must be recorded"
  );
});

test("[ip] a different address is stored as a different hash", () => {
  claimWithIp(INVITEE, CODE, IP_HASH);
  claimWithIp(OTHER, CODE, OTHER_IP_HASH);
  assert.equal(psql(`select count(distinct ip_hash) from public.referral_attributions;`), "2");
});

test("[ip] no RAW address is anywhere in the table", () => {
  claimWithIp(INVITEE, CODE, IP_HASH);
  /*
    A column-blind sweep rather than a check of ip_hash alone: the point is that no
    dotted quad reached ANY column, including `code` and `rejected_reason`, whatever
    a future caller passes.
  */
  const dotted = psql(
    `select count(*) from public.referral_attributions
      where (inviter_id::text || invitee_id::text || code || coalesce(ip_hash,'') || coalesce(rejected_reason,''))
            ~ '[0-9]{1,3}([.][0-9]{1,3}){3}';`
  );
  assert.equal(dotted, "0", "an IPv4 address must never be persisted");
});

test("[ip] the hash is unreachable to every user but the row's own invitee", () => {
  claimWithIp(INVITEE, CODE, IP_HASH);
  // RLS lets the invitee SELECT their row — the API is what strips ip_hash from the
  // payload, and tests/referrals.test.js pins that. What matters here is that no
  // OTHER user, inviter included, can reach it at all.
  assert.equal(asUser(OTHER, `select count(*) from public.referral_attributions where ip_hash = '${IP_HASH}';`), "0");
  assert.equal(asUser(INVITER, `select count(*) from public.referral_attributions;`), "0");
});

/* ------------------------------------------------------- lazy transition */

test("[expiry] the lazy transition moves attributed -> expired and records why", () => {
  claim(INVITEE, CODE);
  ageAttribution(INVITEE, "31 days");
  assert.equal(lazyExpire(INVITEE), "expired|attribution_window_elapsed");
});

test("[expiry] the transition is not a delete — the row survives as evidence", () => {
  claim(INVITEE, CODE);
  ageAttribution(INVITEE, "31 days");
  lazyExpire(INVITEE);
  assert.equal(psql(`select count(*) from public.referral_attributions where invitee_id = '${INVITEE}';`), "1");
  // attributed_at is the single source of truth for the window and must survive the
  // transition intact, or the expiry becomes unauditable and unrecomputable.
  assert.equal(
    psql(`select (attributed_at < now() - interval '30 days')::text
            from public.referral_attributions where invitee_id = '${INVITEE}';`),
    "true"
  );
});

test("[expiry] the CAS predicate protects rows PR3c has already advanced", () => {
  claim(INVITEE, CODE);
  ageAttribution(INVITEE, "45 days");
  // Simulate PR3c having qualified this invitee while the window was still open.
  psql(`update public.referral_attributions set state = 'qualified', qualified_at = now()
          where invitee_id = '${INVITEE}';`);
  assert.equal(lazyExpire(INVITEE), "qualified|-", "state = 'attributed' in the UPDATE is the whole guard");
});

test("[expiry] the transition is idempotent — running it twice changes nothing", () => {
  claim(INVITEE, CODE);
  ageAttribution(INVITEE, "31 days");
  assert.equal(lazyExpire(INVITEE), "expired|attribution_window_elapsed");
  assert.equal(lazyExpire(INVITEE), "expired|attribution_window_elapsed");
  assert.equal(psql(`select count(*) from public.referral_attributions;`), "1");
});

test("[expiry] a CLIENT cannot perform the transition, in either direction", () => {
  claim(INVITEE, CODE);
  ageAttribution(INVITEE, "31 days");
  /*
    No UPDATE policy exists, and Postgres answers a policy-less mutation by
    affecting zero rows rather than raising — so a missing error proves nothing and
    the row itself is the assertion. Both directions matter: a client must not be
    able to expire anyone, nor to un-expire themselves.
  */
  asUser(INVITEE, `update public.referral_attributions set state = 'expired' where invitee_id = '${INVITEE}';`);
  assert.equal(psql(`select state from public.referral_attributions where invitee_id = '${INVITEE}';`), "attributed");

  lazyExpire(INVITEE);
  asUser(INVITEE, `update public.referral_attributions set state = 'attributed' where invitee_id = '${INVITEE}';`);
  assert.equal(psql(`select state from public.referral_attributions where invitee_id = '${INVITEE}';`), "expired");
});

/* -------------------------------------------------- expired is permanent */

test("[expiry] an EXPIRED attribution cannot be reassigned to another inviter", () => {
  claim(INVITEE, CODE);
  ageAttribution(INVITEE, "45 days");
  lazyExpire(INVITEE);

  assert.equal(claim(INVITEE, OTHER_CODE), "f|already_attributed", "expiry is not a second chance");
  assert.equal(psql(`select count(*) from public.referral_attributions where invitee_id = '${INVITEE}';`), "1");
  assert.equal(
    psql(`select inviter_id from public.referral_attributions where invitee_id = '${INVITEE}';`),
    INVITER,
    "UNIQUE(invitee_id) makes attribution permanent — the inviter never changes"
  );
});

test("[expiry] re-claiming the SAME code on an expired row creates nothing new", () => {
  claim(INVITEE, CODE);
  ageAttribution(INVITEE, "45 days");
  lazyExpire(INVITEE);

  /*
    The RPC converges and reports success: it answers "who invited whom", and that
    answer is still correct for an expired row. Turning that success into a 410 is
    the JavaScript layer's job — one clock, one comparison — and is pinned in
    tests/referrals.test.js. What the DATABASE must guarantee is that no second row
    appears and the state is not silently walked back to attributed.
  */
  assert.equal(claim(INVITEE, CODE), "t|-");
  assert.equal(psql(`select count(*) from public.referral_attributions;`), "1");
  assert.equal(psql(`select state from public.referral_attributions where invitee_id = '${INVITEE}';`), "expired");
});

test("[expiry] an expired row still blocks a fresh INSERT — UNIQUE outlives the state", () => {
  claim(INVITEE, CODE);
  ageAttribution(INVITEE, "45 days");
  lazyExpire(INVITEE);
  psql(
    `insert into public.referral_attributions (inviter_id, invitee_id, code)
     values ('${OTHER}', '${INVITEE}', '${OTHER_CODE}');`,
    { expectFailure: true }
  );
});

/* ------------------------------------------------------------ no rewards */

test("[safety] PR3b grants nothing — time_grants stays empty across every path", () => {
  claimWithIp(INVITEE, CODE, IP_HASH);
  claimWithIp(OTHER, OTHER_CODE, OTHER_IP_HASH);
  claim(INVITEE, OTHER_CODE);
  ageAttribution(INVITEE, "45 days");
  lazyExpire(INVITEE);
  claim(INVITEE, CODE);
  psql(`select public.referral_inviter_summary('${INVITER}');`);
  assert.equal(psql(`select count(*) from public.time_grants;`), "0", "reward issuance is PR3c, not PR3b");
});

test("[safety] no attribution reaches a PR3c state by any route PR3b can take", () => {
  claimWithIp(INVITEE, CODE, IP_HASH);
  ageAttribution(INVITEE, "45 days");
  lazyExpire(INVITEE);
  assert.equal(
    psql(`select count(*) from public.referral_attributions
            where state in ('qualified', 'rewarded', 'reversed');`),
    "0",
    "attributed -> expired is the only transition PR3b owns"
  );
});
