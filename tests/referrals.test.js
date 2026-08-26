import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATTRIBUTION_WINDOW_DAYS,
  ATTRIBUTION_WINDOW_MS,
  CLAIM_REASONS,
  EXPIRY_AUDIT_REASON,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  attributionExpiresAt,
  claimReferral,
  expireAttributionIfElapsed,
  generateReferralCode,
  getOrCreateReferralCode,
  getReferralStatus,
  isAttributionExpired
} from "../server-utils/referrals.js";
import {
  MIN_SECRET_LENGTH,
  REFERRAL_IP_HASH_SECRET_ENV,
  assertReferralIpHashSecret,
  hashClientIp,
  ipHashesMatch,
  normalizeIp,
  readRequestIp,
  resolveClaimIpHash
} from "../server-utils/referralIpHash.js";
import { handleReferralApi } from "../server-utils/referralApi.js";

/**
 * PR3a unit layer — the JavaScript half of referral attribution.
 *
 * WHAT IS DELIBERATELY NOT HERE: email normalisation and the self-referral rules.
 * Those live in SQL (`referral_normalize_email`, `claim_referral`) precisely so
 * there is ONE implementation, and they are proven against real Postgres in
 * tests/integration/referrals.db.test.js — including the exact-email, normalized,
 * Gmail +tag, Gmail dot and Stripe-customer cases. Asserting them again against a
 * fake here would only test the fake. What IS tested below is that this layer maps
 * the database's answer faithfully and never invents one.
 *
 * PR3b adds the claim layer: IP hashing, the 30-day window's boundary, the lazy
 * attributed -> expired transition and the sanitised endpoint shapes. Three PR3a
 * assertions move with it and are marked [PR3b] where they do — the `p_ip_hash`
 * null placeholder, the day-30 boundary, and "the stored state stays attributed".
 */

const DAY = 24 * 60 * 60 * 1000;

/** Minimal PostgREST-shaped fake. Records every call so shape can be asserted. */
function fakeSupabase({ rows = {}, rpc = {}, insertResults = [], updateResult = { error: null } } = {}) {
  const calls = [];
  const rpcCalls = [];
  const inserts = [...insertResults];
  return {
    calls,
    rpcCalls,
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const handler = rpc[name];
      if (!handler) return Promise.resolve({ data: null, error: { message: `no rpc ${name}` } });
      return Promise.resolve(typeof handler === "function" ? handler(args) : handler);
    },
    from(table) {
      const q = { table, op: "select", filters: [] };
      calls.push(q);
      const chain = {
        select() {
          return chain;
        },
        eq(c, v) {
          q.filters.push([c, v]);
          return chain;
        },
        is(c, v) {
          q.filters.push([c, v]);
          return chain;
        },
        update(payload) {
          q.op = "update";
          q.payload = payload;
          const upd = {
            eq(c, v) {
              q.filters.push([c, v]);
              return upd;
            },
            // PostgREST's builder is thenable; the lazy-expiry UPDATE awaits the
            // chain directly rather than calling a terminal method.
            then(resolve) {
              return Promise.resolve(updateResult).then(resolve);
            }
          };
          return upd;
        },
        insert(payload) {
          q.op = "insert";
          q.payload = payload;
          const next = inserts.shift();
          return {
            select: () => ({ maybeSingle: () => Promise.resolve(next ?? { data: payload, error: null }) })
          };
        },
        maybeSingle() {
          const value = rows[table];
          const resolved = typeof value === "function" ? value(q) : value;
          return Promise.resolve(resolved ?? { data: null, error: null });
        }
      };
      return chain;
    }
  };
}

/* ------------------------------------------------------- code generation */

test("[code] generated codes are exactly 10 chars from the declared alphabet", () => {
  assert.equal(REFERRAL_CODE_LENGTH, 10);
  for (let i = 0; i < 500; i += 1) {
    const code = generateReferralCode();
    assert.equal(code.length, 10, `wrong length: ${code}`);
    for (const ch of code) {
      assert.ok(REFERRAL_CODE_ALPHABET.includes(ch), `char ${ch} outside alphabet in ${code}`);
    }
  }
});

test("[code] the alphabet excludes the characters people misread", () => {
  // Crockford base32: no I/L/O/U. A code is read off a screen and typed on a phone.
  for (const ch of ["I", "L", "O", "U"]) {
    assert.ok(!REFERRAL_CODE_ALPHABET.includes(ch), `${ch} must not be in the alphabet`);
  }
  assert.equal(REFERRAL_CODE_ALPHABET.length, 32);
  assert.equal(new Set(REFERRAL_CODE_ALPHABET).size, 32, "alphabet must have no duplicates");
});

test("[code] codes are not derived from anything predictable", () => {
  // 500 draws with zero repeats is not proof of a CSPRNG, but a code derived from
  // a timestamp or a counter fails it immediately.
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) seen.add(generateReferralCode());
  assert.equal(seen.size, 500, "generated codes repeated");
});

/* ------------------------------------------------ getOrCreateReferralCode */

test("[getOrCreate] an existing ACTIVE code is returned, and nothing is inserted", async () => {
  const supabase = fakeSupabase({ rows: { referral_codes: { data: { code: "ABCD234567" }, error: null } } });
  const out = await getOrCreateReferralCode("user-1", { supabase });
  assert.deepEqual(out, { code: "ABCD234567", created: false });
  assert.equal(supabase.calls.filter((c) => c.op === "insert").length, 0, "must not insert when a code exists");
});

test("[getOrCreate] a first-time inviter gets a new code inserted", async () => {
  const supabase = fakeSupabase({
    rows: { referral_codes: { data: null, error: null } },
    insertResults: [{ data: { code: "NEWCODE234" }, error: null }]
  });
  const out = await getOrCreateReferralCode("user-1", { supabase, generateCode: () => "NEWCODE234" });
  assert.deepEqual(out, { code: "NEWCODE234", created: true });
});

test("[getOrCreate] a DISABLED code is never revived — a replacement is issued", async () => {
  /*
    The active-code read filters `disabled_at is null`, so a user whose only row is
    disabled reads as having none. Reviving it would undo the one lever available
    against a leaked code.
  */
  const supabase = fakeSupabase({
    rows: { referral_codes: { data: null, error: null } },
    insertResults: [{ data: { code: "REPLACED22" }, error: null }]
  });
  const out = await getOrCreateReferralCode("user-1", { supabase, generateCode: () => "REPLACED22" });
  assert.equal(out.code, "REPLACED22");
  assert.equal(out.created, true);

  const read = supabase.calls.find((c) => c.op === "select");
  assert.deepEqual(read.filters, [["user_id", "user-1"], ["disabled_at", null]], "must filter to active codes only");
  const insert = supabase.calls.find((c) => c.op === "insert");
  assert.equal(insert.payload.code, "REPLACED22");
  assert.equal(insert.payload.user_id, "user-1");
});

test("[collision] a duplicate code retries with a fresh one instead of failing", async () => {
  const supabase = fakeSupabase({
    rows: { referral_codes: { data: null, error: null } },
    insertResults: [
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { code: "SECOND2345" }, error: null }
    ]
  });
  let n = 0;
  const out = await getOrCreateReferralCode("user-1", {
    supabase,
    generateCode: () => (n++ === 0 ? "FIRST12345" : "SECOND2345")
  });
  assert.deepEqual(out, { code: "SECOND2345", created: true });
  assert.equal(n, 2, "must have generated a second code");
});

test("[collision] a non-unique-violation error is surfaced, not retried away", async () => {
  const supabase = fakeSupabase({
    rows: { referral_codes: { data: null, error: null } },
    insertResults: [{ data: null, error: { code: "42501", message: "permission denied" } }]
  });
  await assert.rejects(
    () => getOrCreateReferralCode("user-1", { supabase, generateCode: () => "X" }),
    /permission denied/
  );
});

test("[getOrCreate] refuses an empty user id rather than allocating an orphan code", async () => {
  await assert.rejects(() => getOrCreateReferralCode("", { supabase: fakeSupabase() }), /userId is required/);
});

/* --------------------------------------------------------- claimReferral */

function claimRpc(result) {
  return { rpc: { claim_referral: () => ({ data: [result], error: null }) } };
}

test("[claim] a valid claim returns the attribution", async () => {
  const supabase = fakeSupabase(
    claimRpc({
      ok: true,
      reason: null,
      attribution_id: "attr-1",
      inviter_id: "inviter-1",
      code: "ABCD234567",
      state: "attributed",
      attributed_at: "2026-08-27T10:00:00.000Z"
    })
  );
  const out = await claimReferral({ userId: "invitee-1", code: "abcd234567" }, { supabase });
  assert.equal(out.ok, true);
  assert.equal(out.attribution.state, "attributed");
  assert.equal(out.attribution.id, "attr-1");
});

test("[claim] the invitee id comes from the caller, and no inviter can be forged", async () => {
  const supabase = fakeSupabase(
    claimRpc({ ok: true, attribution_id: "a", inviter_id: "i", code: "C", state: "attributed", attributed_at: null })
  );
  await claimReferral({ userId: "invitee-1", code: "CODE", inviterId: "forged" }, { supabase });
  const args = supabase.rpcCalls[0].args;
  assert.equal(args.p_invitee_id, "invitee-1");
  assert.deepEqual(Object.keys(args).sort(), ["p_code", "p_invitee_id", "p_ip_hash"]);
  assert.ok(!("p_inviter_id" in args), "the RPC must have no inviter parameter to forge");
});

test("[claim][PR3b] a pre-hashed ip reaches the RPC; a RAW address is refused", async () => {
  // PR3a asserted p_ip_hash was always null, with "until a stable secret exists" as
  // the reason. REFERRAL_IP_HASH_SECRET is that secret, so the placeholder becomes
  // the real contract: this layer stores a digest and CANNOT be handed an address.
  const digest = "a".repeat(64);
  const supabase = fakeSupabase(
    claimRpc({ ok: true, attribution_id: "a", inviter_id: "i", code: "C", state: "attributed", attributed_at: null })
  );
  await claimReferral({ userId: "invitee-1", code: "CODE", ipHash: digest }, { supabase });
  assert.equal(supabase.rpcCalls[0].args.p_ip_hash, digest);

  await assert.rejects(
    () => claimReferral({ userId: "invitee-1", code: "CODE", ipHash: "203.0.113.9" }, { supabase: fakeSupabase() }),
    /never a raw address/,
    "a raw address must fail loudly rather than be written into ip_hash"
  );
});

test("[claim][PR3b] no ip hash at all is stored as NULL, not as a hash of nothing", async () => {
  const supabase = fakeSupabase(
    claimRpc({ ok: true, attribution_id: "a", inviter_id: "i", code: "C", state: "attributed", attributed_at: null })
  );
  await claimReferral({ userId: "invitee-1", code: "CODE" }, { supabase });
  assert.equal(supabase.rpcCalls[0].args.p_ip_hash, null);
});

for (const reason of Object.values(CLAIM_REASONS)) {
  test(`[claim] surfaces "${reason}" from the database verbatim`, async () => {
    const supabase = fakeSupabase(claimRpc({ ok: false, reason }));
    const out = await claimReferral({ userId: "invitee-1", code: "CODE" }, { supabase });
    assert.deepEqual(out, { ok: false, reason });
  });
}

test("[claim] refuses an empty user id", async () => {
  await assert.rejects(
    () => claimReferral({ userId: "", code: "C" }, { supabase: fakeSupabase() }),
    /userId is required/
  );
});

/* ---------------------------------------------------------------- window */

test(`[window] the qualification window is ${ATTRIBUTION_WINDOW_DAYS} days`, () => {
  assert.equal(ATTRIBUTION_WINDOW_DAYS, 30);
  const now = Date.parse("2026-09-30T00:00:00.000Z");
  assert.equal(isAttributionExpired(new Date(now - 29 * DAY).toISOString(), now), false, "day 29 is open");
  assert.equal(isAttributionExpired(new Date(now - 31 * DAY).toISOString(), now), true, "day 31 is closed");
});

test("[window][PR3b] the window is HALF-OPEN — the boundary instant is EXPIRED", () => {
  /*
    PR3a used `>` and pinned "day 30 exactly is open", which made the real window 30
    days plus one millisecond. PR3b fixes the comparison to `>=`. Asserted on all
    three sides of the boundary so the direction cannot silently flip back.
  */
  const start = Date.parse("2026-08-31T00:00:00.000Z");
  const at = new Date(start).toISOString();
  assert.equal(isAttributionExpired(at, start + ATTRIBUTION_WINDOW_MS - 1), false, "one tick before: open");
  assert.equal(isAttributionExpired(at, start + ATTRIBUTION_WINDOW_MS), true, "exactly at expiry: closed");
  assert.equal(isAttributionExpired(at, start + ATTRIBUTION_WINDOW_MS + 1), true, "one tick after: closed");
});

test("[window][PR3b] expiresAt is DERIVED from attributed_at, never stored", () => {
  const at = "2026-08-31T00:00:00.000Z";
  assert.equal(attributionExpiresAt(at), "2026-09-30T00:00:00.000Z");
  assert.equal(Date.parse(attributionExpiresAt(at)) - Date.parse(at), ATTRIBUTION_WINDOW_MS);
  // Unreadable input yields null, not the string "Invalid Date" in an API payload.
  assert.equal(attributionExpiresAt(null), null);
  assert.equal(attributionExpiresAt("not-a-date"), null);
});

test("[window] an unparseable timestamp is not treated as expired", () => {
  // Failing open here is deliberate: expiry denies a reward, and a clock or parse
  // problem must not silently deny one.
  assert.equal(isAttributionExpired("not-a-date"), false);
  assert.equal(isAttributionExpired(null), false);
});

/* ---------------------------------------------------------------- status */

function statusSupabase(attribution) {
  return fakeSupabase({
    rows: {
      referral_codes: { data: { code: "ABCD234567" }, error: null },
      referral_attributions: { data: attribution, error: null }
    },
    rpc: {
      referral_inviter_summary: () => ({
        data: [{ attributed_count: 3, qualified_count: 2, rewarded_count: 1 }],
        error: null
      })
    }
  });
}

test("[status] reports inviter counts and the caller's own attribution", async () => {
  const now = Date.parse("2026-09-01T00:00:00.000Z");
  const supabase = statusSupabase({
    state: "attributed",
    attributed_at: "2026-08-27T10:00:00.000Z",
    qualified_at: null,
    rewarded_at: null
  });
  const out = await getReferralStatus("user-1", { supabase, now });
  assert.equal(out.code, "ABCD234567");
  assert.deepEqual(out.inviter, { attributed: 3, qualified: 2, rewarded: 1 });
  assert.equal(out.invitee.state, "attributed");
  assert.equal(out.invitee.expired, false);
});

test("[status][PR3b] expiry stays DERIVED, and the read lazily materialises it", async () => {
  /*
    PR3a asserted the stored state stayed 'attributed' because nothing wrote it.
    PR3b adds the LAZY transition: the window is still computed from attributed_at
    (no cron, no expires_at column), and the read writes down what it concluded.
  */
  const now = Date.parse("2026-10-15T00:00:00.000Z");
  const supabase = statusSupabase({
    state: "attributed",
    attributed_at: "2026-08-27T10:00:00.000Z",
    qualified_at: null,
    rewarded_at: null
  });
  const out = await getReferralStatus("user-1", { supabase, now });
  assert.equal(out.invitee.expired, true, "past 30 days");
  assert.equal(out.invitee.state, "expired", "the reported state follows the window");

  const write = supabase.calls.find((c) => c.op === "update");
  assert.ok(write, "the transition must be persisted so it is auditable");
  assert.equal(write.table, "referral_attributions");
  assert.equal(write.payload.state, "expired");
  assert.equal(write.payload.rejected_reason, EXPIRY_AUDIT_REASON, "auditable: why it moved");
  // Compare-and-swap: a row PR3c already qualified must not be dragged to expired.
  assert.ok(
    write.filters.some(([c, v]) => c === "state" && v === "attributed"),
    "the UPDATE must be conditional on the row still being 'attributed'"
  );
});

test("[status] never returns an inviter id to the caller", async () => {
  const supabase = statusSupabase({ state: "attributed", attributed_at: "2026-08-27T10:00:00.000Z" });
  const out = await getReferralStatus("user-1", { supabase });
  assert.ok(!JSON.stringify(out).includes("inviter_id"), "raw inviter_id must not leak");
  assert.ok(!("inviterId" in out.invitee), "invitee must not learn who referred them");
});

test("[status] a user with no attribution reports null rather than a fabricated one", async () => {
  const supabase = statusSupabase(null);
  const out = await getReferralStatus("user-1", { supabase });
  assert.equal(out.invitee, null);
});

/* ------------------------------------------------------------------- API */

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

test("[api] an unauthenticated request is refused before any referral work", async () => {
  const res = mockRes();
  await handleReferralApi({ query: { view: "code" }, method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test("[api] auth is checked before the view is dispatched", async () => {
  // A token-less probe must not be able to enumerate which views exist.
  for (const view of ["nope", "claim", "status"]) {
    const res = mockRes();
    await handleReferralApi({ query: { view }, method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 401, `view=${view} leaked before auth`);
  }
});

/* ======================================================================== */
/*  PR3b — the claim layer                                                  */
/* ======================================================================== */

/* ------------------------------------------------------------ ip hashing */

const SECRET = "pr3b-referral-ip-secret-0123456789";

/** Set the secret for one assertion and always put the environment back. */
function withSecret(value, fn) {
  const previous = process.env[REFERRAL_IP_HASH_SECRET_ENV];
  if (value === undefined) delete process.env[REFERRAL_IP_HASH_SECRET_ENV];
  else process.env[REFERRAL_IP_HASH_SECRET_ENV] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[REFERRAL_IP_HASH_SECRET_ENV];
    else process.env[REFERRAL_IP_HASH_SECRET_ENV] = previous;
  }
}

test("[ip] REFERRAL_IP_HASH_SECRET is REQUIRED, and a placeholder is not a secret", () => {
  withSecret(undefined, () => {
    const out = assertReferralIpHashSecret();
    assert.equal(out.ok, false);
    assert.match(out.error, /REFERRAL_IP_HASH_SECRET/);
  });
  // Short keys are refused: HMAC accepts them happily, which is exactly the
  // problem — a guessable key silently degrades to the enumerable hash the
  // module exists to avoid.
  withSecret("short", () => assert.equal(assertReferralIpHashSecret().ok, false));
  withSecret("x".repeat(MIN_SECRET_LENGTH), () => assert.equal(assertReferralIpHashSecret().ok, true));
});

test("[ip] the error text names the variable and never echoes its value", () => {
  withSecret("tiny", () => {
    const { error } = assertReferralIpHashSecret();
    assert.ok(!error.includes("tiny"), "an error string reaches log aggregators");
  });
});

test("[ip] the same address always hashes to the same value", () => {
  withSecret(SECRET, () => {
    assert.equal(hashClientIp("203.0.113.9"), hashClientIp("203.0.113.9"));
    // Stability across representations is the whole point: two sign-ups an hour
    // apart must compare equal even if one socket happened to be dual-stack.
    assert.equal(hashClientIp("203.0.113.9"), hashClientIp("::ffff:203.0.113.9"));
    assert.equal(hashClientIp("203.0.113.9"), hashClientIp("203.0.113.9:51999"));
    assert.equal(hashClientIp("2001:DB8::1"), hashClientIp("[2001:db8::1]:443"));
  });
});

test("[ip] a different address hashes differently", () => {
  withSecret(SECRET, () => {
    assert.notEqual(hashClientIp("203.0.113.9"), hashClientIp("203.0.113.10"));
    assert.notEqual(hashClientIp("203.0.113.9"), hashClientIp("2001:db8::1"));
  });
});

test("[ip] a different secret changes every hash", () => {
  const a = withSecret(SECRET, () => hashClientIp("203.0.113.9"));
  const b = withSecret(SECRET + "-rotated", () => hashClientIp("203.0.113.9"));
  assert.notEqual(a, b, "rotation must void the signal, not silently preserve it");
});

test("[ip] the RAW address never appears in, or is recoverable from, the hash", () => {
  withSecret(SECRET, () => {
    const ip = "203.0.113.9";
    const hash = hashClientIp(ip);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!hash.includes(ip));
    assert.ok(!Buffer.from(hash, "hex").toString("latin1").includes(ip));
  });
});

test("[ip] no address yields NULL, never a hash of the empty string", () => {
  withSecret(SECRET, () => {
    // A constant standing in for "unknown" would make every address-less request
    // collide with every other and read as a fraud ring in review.
    assert.equal(hashClientIp(null), null);
    assert.equal(hashClientIp(""), null);
    assert.equal(hashClientIp("unknown"), null);
  });
});

test("[ip] the address comes from the proxy headers, in the project's own order", () => {
  assert.equal(readRequestIp({ headers: { "x-forwarded-for": "203.0.113.9, 70.0.0.1" } }), "203.0.113.9");
  assert.equal(readRequestIp({ headers: { "x-real-ip": "198.51.100.4" } }), "198.51.100.4");
  assert.equal(
    readRequestIp({ headers: { "x-forwarded-for": "203.0.113.9" }, socket: { remoteAddress: "10.0.0.1" } }),
    "203.0.113.9",
    "x-forwarded-for wins, exactly as the rate limiter resolves it"
  );
});

test("[ip] a client-supplied ip field is ignored — a chosen hash is worse than none", () => {
  const req = { headers: { "x-forwarded-for": "203.0.113.9" }, body: { ip: "1.2.3.4", ipHash: "deadbeef" } };
  withSecret(SECRET, () => {
    assert.equal(resolveClaimIpHash(req).ipHash, hashClientIp("203.0.113.9"));
  });
});

test("[ip] normalisation collapses only what is genuinely the same host", () => {
  assert.equal(normalizeIp("  203.0.113.9  "), "203.0.113.9");
  assert.equal(normalizeIp("unknown"), null);
  assert.equal(normalizeIp(""), null);
  // A bare IPv6 address is nothing but colons and must survive intact.
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
});

test("[ip] hash comparison is constant-time and length-safe", () => {
  withSecret(SECRET, () => {
    const h = hashClientIp("203.0.113.9");
    assert.equal(ipHashesMatch(h, h), true);
    assert.equal(ipHashesMatch(h, hashClientIp("203.0.113.10")), false);
    // timingSafeEqual throws on unequal buffers; the guard must decide first.
    assert.equal(ipHashesMatch(h, "abc"), false);
    assert.equal(ipHashesMatch(null, h), false);
    assert.equal(ipHashesMatch("", ""), false);
  });
});

test("[ip] outside production a missing secret degrades, and SAYS it degraded", () => {
  withSecret(undefined, () => {
    const out = resolveClaimIpHash({ headers: { "x-forwarded-for": "203.0.113.9" } });
    assert.equal(out.ok, true);
    assert.equal(out.ipHash, null);
    assert.equal(out.skipped, true, "it must not pretend to have hashed");
  });
});

test("[ip] in PRODUCTION a missing secret FAILS the claim rather than writing NULL", () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    withSecret(undefined, () => {
      const out = resolveClaimIpHash({ headers: { "x-forwarded-for": "203.0.113.9" } });
      assert.equal(out.ok, false, "a silently empty fraud column is the worst option");
      assert.match(out.error, /REFERRAL_IP_HASH_SECRET/);
    });
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});

/* ------------------------------------------------------- expiry on claim */

/** A claim RPC that converges on an attribution made `ageMs` ago. */
function agedClaim(ageMs, now, state = "attributed") {
  return fakeSupabase(
    claimRpc({
      ok: true,
      reason: null,
      attribution_id: "attr-1",
      inviter_id: "inviter-1",
      code: "ABCD234567",
      state,
      attributed_at: new Date(now - ageMs).toISOString()
    })
  );
}

test("[claim][PR3b] a claim INSIDE the window succeeds and reports when it closes", async () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  const supabase = agedClaim(29 * DAY, now);
  const out = await claimReferral({ userId: "invitee-1", code: "CODE" }, { supabase, now });
  assert.equal(out.ok, true);
  assert.equal(out.attribution.state, "attributed");
  assert.equal(out.attribution.expiresAt, new Date(now - 29 * DAY + ATTRIBUTION_WINDOW_MS).toISOString());
});

test("[claim][PR3b] a claim AT the boundary is expired, not accepted", async () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  const supabase = agedClaim(ATTRIBUTION_WINDOW_MS, now);
  const out = await claimReferral({ userId: "invitee-1", code: "CODE" }, { supabase, now });
  assert.equal(out.ok, false);
  assert.equal(out.reason, CLAIM_REASONS.EXPIRED);
});

test("[claim][PR3b] re-claiming an EXPIRED attribution expires it lazily, and never reassigns", async () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  const supabase = agedClaim(45 * DAY, now);
  const out = await claimReferral({ userId: "invitee-1", code: "CODE" }, { supabase, now });
  assert.equal(out.ok, false);
  assert.equal(out.reason, CLAIM_REASONS.EXPIRED);

  const write = supabase.calls.find((c) => c.op === "update");
  assert.equal(write.payload.state, "expired");
  assert.equal(write.payload.rejected_reason, EXPIRY_AUDIT_REASON);
  // The row is evidence. Nothing may delete it or insert a replacement, because
  // UNIQUE(invitee_id) makes attribution permanent by design.
  assert.ok(!supabase.calls.some((c) => c.op === "insert"), "no second attribution may be created");
});

test("[claim][PR3b] a DIFFERENT inviter is refused on an expired row — no reassignment", async () => {
  // The RPC decides this: the row exists, so it answers already_attributed whether
  // or not the window closed. Reassignment is not reachable from this layer at all.
  const supabase = fakeSupabase(claimRpc({ ok: false, reason: CLAIM_REASONS.ALREADY_ATTRIBUTED }));
  const out = await claimReferral({ userId: "invitee-1", code: "OTHERCODE" }, { supabase });
  assert.deepEqual(out, { ok: false, reason: CLAIM_REASONS.ALREADY_ATTRIBUTED });
  assert.ok(!supabase.calls.some((c) => c.op === "insert" || c.op === "update"));
});

test("[claim][PR3b] a duplicate claim naming the SAME inviter converges idempotently", async () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  const first = await claimReferral({ userId: "invitee-1", code: "CODE" }, { supabase: agedClaim(0, now), now });
  const second = await claimReferral({ userId: "invitee-1", code: "code" }, { supabase: agedClaim(1000, now), now });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.attribution.id, second.attribution.id, "the same row, not a second one");
});

/* -------------------------------------------------- lazy transition unit */

test("[expiry] only 'attributed' rows move, and only once the window has closed", async () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  const fresh = { state: "attributed", attributed_at: new Date(now - DAY).toISOString() };
  const stale = { state: "attributed", attributed_at: new Date(now - 45 * DAY).toISOString() };

  let supabase = fakeSupabase();
  assert.equal(await expireAttributionIfElapsed("u", fresh, { supabase, now }), false, "still open");
  assert.equal(supabase.calls.length, 0, "an open window must not write at all");

  supabase = fakeSupabase();
  assert.equal(await expireAttributionIfElapsed("u", stale, { supabase, now }), true);

  // qualified / rewarded / reversed are PR3c's states. PR3b may not touch them.
  for (const state of ["qualified", "rewarded", "reversed", "expired", "rejected"]) {
    supabase = fakeSupabase();
    const row = { state, attributed_at: stale.attributed_at };
    assert.equal(await expireAttributionIfElapsed("u", row, { supabase, now }), false, state);
    assert.equal(supabase.calls.length, 0, state + " must not be dragged to expired");
  }
});

test("[expiry] a failed audit write is logged, not thrown at the caller", async () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  const supabase = fakeSupabase({ updateResult: { error: { message: "connection reset" } } });
  const row = { state: "attributed", attributed_at: new Date(now - 45 * DAY).toISOString() };
  // The caller's answer is derived from attributed_at either way, so a lost
  // bookkeeping row must never fail the request that noticed it.
  assert.equal(await expireAttributionIfElapsed("u", row, { supabase, now }), false);
});

test("[expiry] a failed audit write still reports the state as expired to the user", async () => {
  const now = Date.parse("2026-10-15T00:00:00.000Z");
  const supabase = fakeSupabase({
    rows: {
      referral_codes: { data: { code: "ABCD234567" }, error: null },
      referral_attributions: {
        data: { state: "attributed", attributed_at: "2026-08-27T10:00:00.000Z" },
        error: null
      }
    },
    rpc: { referral_inviter_summary: () => ({ data: [{}], error: null }) },
    updateResult: { error: { message: "connection reset" } }
  });
  const out = await getReferralStatus("user-1", { supabase, now });
  assert.equal(out.invitee.state, "expired", "never show 'attributed' for a window that closed");
  assert.equal(out.invitee.expired, true);
});

/* --------------------------------------------------------- status shape */

test("[status][PR3b] reports hasReferralCode and the derived expiresAt", async () => {
  const now = Date.parse("2026-09-01T00:00:00.000Z");
  const supabase = statusSupabase({
    state: "attributed",
    attributed_at: "2026-08-27T10:00:00.000Z",
    qualified_at: null,
    rewarded_at: null
  });
  const out = await getReferralStatus("user-1", { supabase, now });
  assert.equal(out.hasReferralCode, true);
  assert.equal(out.invitee.expiresAt, "2026-09-26T10:00:00.000Z");
  assert.equal(out.invitee.qualifiedAt, null);
  assert.equal(out.invitee.rewardedAt, null);
});

test("[status][PR3b] hasReferralCode is false when the caller has never invited", async () => {
  const supabase = fakeSupabase({
    rows: { referral_codes: { data: null, error: null }, referral_attributions: { data: null, error: null } },
    rpc: { referral_inviter_summary: () => ({ data: [{}], error: null }) }
  });
  const out = await getReferralStatus("user-1", { supabase });
  assert.equal(out.hasReferralCode, false);
  assert.equal(out.code, null);
});

test("[status][PR3b] leaks no identity, no ip hash and no internal id", async () => {
  const now = Date.parse("2026-10-15T00:00:00.000Z");
  const supabase = statusSupabase({
    state: "attributed",
    attributed_at: "2026-08-27T10:00:00.000Z",
    qualified_at: null,
    rewarded_at: null
  });
  const payload = JSON.stringify(await getReferralStatus("user-1", { supabase, now }));
  for (const forbidden of ["inviter_id", "inviterId", "invitee_id", "inviteeId", "ip_hash", "ipHash", "stripe"]) {
    assert.ok(!payload.includes(forbidden), forbidden + " must never reach the client");
  }
});

/* ------------------------------------------------------------ API layer */

let apiLoads = 0;

/**
 * The endpoints with a verified session already established.
 *
 * getRequester() reaches Supabase, which no unit test may do, so the module is
 * loaded with its dependencies mocked. This is the only way to assert the HTTP
 * contract — statuses, sanitisation, identity provenance — without a network.
 */
async function loadApiWithSession(user, { claimResult, statusResult, codeResult } = {}) {
  const { mock } = await import("node:test");
  mock.module("../server-utils/authAdmin.js", {
    namedExports: { getRequester: async () => ({ ok: true, user, token: "t" }) }
  });
  mock.module("../server-utils/supabaseAdmin.js", {
    namedExports: {
      assertSupabaseConfigured: () => ({ ok: true }),
      getSupabaseAdmin: () => ({})
    }
  });
  mock.module("../server-utils/anonymousRateLimit.js", {
    namedExports: {
      checkUserRateLimit: async () => ({ ok: true }),
      checkAnonymousRateLimit: async () => ({ ok: true }),
      clientIp: (req) => String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || "unknown"
    }
  });
  const calls = [];
  mock.module("../server-utils/referrals.js", {
    namedExports: {
      CLAIM_REASONS,
      claimReferral: async (input) => {
        calls.push({ fn: "claim", input });
        return claimResult;
      },
      getOrCreateReferralCode: async (id) => {
        calls.push({ fn: "code", input: id });
        return codeResult ?? { code: "ABCD234567", created: false };
      },
      getReferralStatus: async (id) => {
        calls.push({ fn: "status", input: id });
        return statusResult;
      }
    }
  });
  apiLoads += 1;
  const mod = await import("../server-utils/referralApi.js?t=" + apiLoads);
  return { handle: mod.handleReferralApi, calls, reset: () => mock.restoreAll() };
}

const USER = { id: "user-1", email: "invitee@example.test" };

test("[api][PR3b] POST claim returns 200 with a sanitised attribution", async () => {
  const api = await loadApiWithSession(USER, {
    claimResult: {
      ok: true,
      attribution: {
        id: "attr-1",
        inviterId: "inviter-1",
        code: "ABCD234567",
        state: "attributed",
        attributedAt: "2026-08-27T10:00:00.000Z",
        expiresAt: "2026-09-26T10:00:00.000Z"
      }
    }
  });
  try {
    const res = mockRes();
    await api.handle(
      {
        query: { view: "claim" },
        method: "POST",
        headers: { authorization: "Bearer t", "x-forwarded-for": "203.0.113.9" },
        body: { code: "ABCD234567" }
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      ok: true,
      attribution: {
        state: "attributed",
        attributedAt: "2026-08-27T10:00:00.000Z",
        expiresAt: "2026-09-26T10:00:00.000Z"
      }
    });
    const body = JSON.stringify(res.body);
    for (const forbidden of ["inviter-1", "attr-1", "inviterId", "ipHash"]) {
      assert.ok(!body.includes(forbidden), forbidden + " must not be echoed");
    }
  } finally {
    api.reset();
  }
});

test("[api][PR3b] the invitee id comes from the session; a body that names one is ignored", async () => {
  const api = await loadApiWithSession(USER, {
    claimResult: { ok: true, attribution: { state: "attributed", attributedAt: null, expiresAt: null } }
  });
  try {
    await api.handle(
      {
        query: { view: "claim" },
        method: "POST",
        headers: { authorization: "Bearer t", "x-forwarded-for": "203.0.113.9" },
        body: { code: "ABCD234567", inviterId: "forged", inviteeId: "forged", userId: "forged" }
      },
      mockRes()
    );
    const input = api.calls.find((c) => c.fn === "claim").input;
    assert.equal(input.userId, "user-1");
    assert.deepEqual(Object.keys(input).sort(), ["code", "ipHash", "userId"]);
  } finally {
    api.reset();
  }
});

test("[api][PR3b] the claim ip hash is computed from headers, never from the body", async () => {
  const api = await loadApiWithSession(USER, {
    claimResult: { ok: true, attribution: { state: "attributed", attributedAt: null, expiresAt: null } }
  });
  const previous = process.env[REFERRAL_IP_HASH_SECRET_ENV];
  process.env[REFERRAL_IP_HASH_SECRET_ENV] = SECRET;
  try {
    await api.handle(
      {
        query: { view: "claim" },
        method: "POST",
        headers: { authorization: "Bearer t", "x-forwarded-for": "203.0.113.9" },
        body: { code: "C", ipHash: "attacker-chosen", ip: "1.2.3.4" }
      },
      mockRes()
    );
    const input = api.calls.find((c) => c.fn === "claim").input;
    assert.equal(input.ipHash, hashClientIp("203.0.113.9", { secret: SECRET }));
    assert.notEqual(input.ipHash, "attacker-chosen");
  } finally {
    if (previous === undefined) delete process.env[REFERRAL_IP_HASH_SECRET_ENV];
    else process.env[REFERRAL_IP_HASH_SECRET_ENV] = previous;
    api.reset();
  }
});

test("[api][PR3b] every claim refusal maps to its documented status code", async () => {
  const expected = {
    [CLAIM_REASONS.MISSING_CODE]: 400,
    [CLAIM_REASONS.INVALID_CODE]: 404,
    [CLAIM_REASONS.DISABLED_CODE]: 410,
    [CLAIM_REASONS.ALREADY_ATTRIBUTED]: 409,
    [CLAIM_REASONS.SELF_SAME_ACCOUNT]: 403,
    [CLAIM_REASONS.SELF_SAME_EMAIL]: 403,
    [CLAIM_REASONS.SELF_NORMALIZED_EMAIL]: 403,
    [CLAIM_REASONS.SELF_SAME_STRIPE]: 403,
    [CLAIM_REASONS.EXPIRED]: 410
  };
  // Every reason the service can produce must have a mapping — a new one silently
  // falling through to 400 is how a client stops being able to explain itself.
  assert.deepEqual(Object.keys(expected).sort(), Object.values(CLAIM_REASONS).sort());

  for (const [reason, status] of Object.entries(expected)) {
    const api = await loadApiWithSession(USER, { claimResult: { ok: false, reason } });
    try {
      const res = mockRes();
      await api.handle(
        {
          query: { view: "claim" },
          method: "POST",
          headers: { authorization: "Bearer t", "x-forwarded-for": "203.0.113.9" },
          body: { code: "X" }
        },
        res
      );
      assert.equal(res.statusCode, status, reason + " should map to " + status);
      assert.equal(res.body.reason, reason);
      // A refusal says why the CALLER's request failed and nothing about anyone
      // else — no inviter, no email, no hint that some other user exists.
      assert.deepEqual(Object.keys(res.body).sort(), ["ok", "reason"]);
    } finally {
      api.reset();
    }
  }
});

test("[api][PR3b] GET status returns the sanitised payload", async () => {
  const api = await loadApiWithSession(USER, {
    statusResult: {
      hasReferralCode: true,
      code: "ABCD234567",
      inviter: { attributed: 2, qualified: 0, rewarded: 0 },
      invitee: {
        state: "attributed",
        attributedAt: "2026-08-27T10:00:00.000Z",
        expiresAt: "2026-09-26T10:00:00.000Z",
        qualifiedAt: null,
        rewardedAt: null,
        expired: false
      }
    }
  });
  try {
    const res = mockRes();
    await api.handle({ query: { view: "status" }, method: "GET", headers: { authorization: "Bearer t" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.referral.hasReferralCode, true);
    assert.equal(res.body.referral.invitee.expiresAt, "2026-09-26T10:00:00.000Z");
    assert.equal(api.calls.find((c) => c.fn === "status").input, "user-1", "identity from the session");
  } finally {
    api.reset();
  }
});

test("[api][PR3b] GET and POST code both return the caller's own code", async () => {
  for (const method of ["GET", "POST"]) {
    const api = await loadApiWithSession(USER, { codeResult: { code: "ABCD234567", created: method === "POST" } });
    try {
      const res = mockRes();
      await api.handle({ query: { view: "code" }, method, headers: { authorization: "Bearer t" } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.code, "ABCD234567");
      assert.equal(api.calls.find((c) => c.fn === "code").input, "user-1");
    } finally {
      api.reset();
    }
  }
});

test("[api][PR3b] an unsupported method is refused on every view", async () => {
  const cases = [
    ["code", "DELETE"],
    ["claim", "GET"],
    ["status", "POST"]
  ];
  for (const [view, method] of cases) {
    const api = await loadApiWithSession(USER, {});
    try {
      const res = mockRes();
      await api.handle({ query: { view }, method, headers: { authorization: "Bearer t" } }, res);
      assert.equal(res.statusCode, 405, view + " must refuse " + method);
    } finally {
      api.reset();
    }
  }
});

test("[api][PR3b] status and code reads are NOT rate limited; only claim is", async () => {
  // A claim is the enumeration surface — it reveals whether an arbitrary string is
  // a real code. Reading your own code or status reveals nothing, and throttling a
  // dashboard poll would be a bug rather than a defence.
  const fs = await import("node:fs");
  const source = fs.readFileSync("server-utils/referralApi.js", "utf8");
  const claimFn = source.slice(
    source.indexOf("async function handleClaim"),
    source.indexOf("async function handleStatus")
  );
  assert.ok(claimFn.includes("checkUserRateLimit"), "claim must be limited");
  assert.match(claimFn, /maxPerHour:\s*20/, "20/hour per authenticated user");
  assert.match(claimFn, /namespace:\s*"referral_claim"/, "its own bucket, not a shared one");

  const codeFn = source.slice(source.indexOf("async function handleCode"), source.indexOf("async function handleClaim"));
  const statusFn = source.slice(source.indexOf("async function handleStatus"), source.indexOf("export async function"));
  assert.ok(!codeFn.includes("checkUserRateLimit"), "code must not be limited");
  assert.ok(!statusFn.includes("checkUserRateLimit"), "status must not be limited");
});

/* ------------------------------------------------------------ no rewards */

test("[safety] the referral claim path cannot grant bonus time", async () => {
  const fs = await import("node:fs");
  for (const file of [
    "server-utils/referrals.js",
    "server-utils/referralApi.js",
    "server-utils/referralIpHash.js"
  ]) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(!source.includes("grantBonusDays"), file + " must not reference grantBonusDays");
    // Asserted on the IMPORT, not on any mention: these modules deliberately talk
    // about the ledger in prose to explain why they stay away from it, and a naive
    // substring check would forbid the explanation along with the dependency.
    assert.ok(!/from\s+["'][^"']*timeGrants/.test(source), file + " must not import the grants ledger");
    assert.ok(!/["'`]time_grants["'`]/.test(source), file + " must not name the grants table");
    assert.ok(!/\.rpc\(\s*["']grant_bonus_days/.test(source), file + " must not call the grant RPC");
  }
});

test("[safety] PR3b can produce no state other than expired", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("server-utils/referrals.js", "utf8");
  for (const state of ["qualified", "rewarded", "reversed"]) {
    assert.ok(
      !new RegExp("state:\\s*[\"']" + state + "[\"']").test(source),
      "PR3b must not write state=" + state + " — that is PR3c"
    );
  }
  assert.match(source, /state:\s*"expired"/, "expired is the one transition PR3b owns");
});
