import { randomInt } from "node:crypto";

import { REFERRAL_INVITER_CAP, REFERRAL_REWARD_DAYS } from "./referralRewards.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * Referral codes and attribution. PR3a: who invited whom, and nothing else.
 *
 * THIS MODULE CANNOT GRANT ANYTHING. It does not import timeGrants.js, does not
 * touch public.time_grants, and has no path to a reward. Qualification (verified
 * email + first successful Predict) and the two 5-day ULTRA grants are PR3c.
 *
 * WHERE THE RULES LIVE. Attribution is one RPC — `claim_referral` in migration 062.
 * Code resolution, the four self-referral blocks and the insert happen inside a
 * single statement against the data they compare, so they cannot drift from each
 * other or be skipped by a caller that forgot one. This module is the thin layer
 * above it: it generates codes, calls the RPC, and shapes the answer. The same
 * division PR1 used for grant_bonus_days, for the same reason.
 *
 * EMAIL NORMALISATION IS NOT HERE. It is `referral_normalize_email` in SQL, and
 * only there. A JavaScript twin would be a second implementation of one rule —
 * precisely the duplication PR2a and PR2b existed to remove.
 *
 * IP HASHING NOW HAPPENS, in referralIpHash.js, keyed to REFERRAL_IP_HASH_SECRET.
 * PR3a left `ip_hash` NULL because a useful signal must be both unguessable and
 * stable, and no dedicated secret existed to be both at once. PR3b adds that
 * secret; the reasoning and the refusal to reuse CRON_SECRET live in that module.
 * The hash is written and never read back to a user, and the raw address is never
 * stored or logged.
 *
 * THIS MODULE STILL CANNOT REWARD ANYTHING. The only state transition PR3b adds is
 * attributed -> expired.
 */

/**
 * Crockford-style base32: no I, L, O or U. Removes the 1/I and 0/O confusions from
 * a code people read off a screen and type into a phone, and drops the vowel that
 * makes accidental words.
 */
export const REFERRAL_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REFERRAL_CODE_LENGTH = 10;
export const ATTRIBUTION_WINDOW_DAYS = 30;
export const ATTRIBUTION_WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const REFERRAL_STATES = Object.freeze([
  "attributed",
  "qualified",
  "rewarded",
  "rejected",
  "expired",
  "reversed"
]);

/** Stable strings the API maps to status codes. Never prose. */
export const CLAIM_REASONS = Object.freeze({
  MISSING_CODE: "missing_code",
  INVALID_CODE: "invalid_code",
  DISABLED_CODE: "disabled_code",
  ALREADY_ATTRIBUTED: "already_attributed",
  SELF_SAME_ACCOUNT: "self_referral_same_account",
  SELF_SAME_EMAIL: "self_referral_same_email",
  SELF_NORMALIZED_EMAIL: "self_referral_normalized_email",
  SELF_SAME_STRIPE: "self_referral_same_stripe_customer",
  /*
    PR3b. Produced by THIS layer, not by claim_referral: the RPC's job is to decide
    who invited whom, and it answers that correctly for an expired row too. Whether
    the 30-day window has elapsed is a question about the clock, and the clock is
    read once, here, so a caller cannot get a different answer by asking differently.
  */
  EXPIRED: "attribution_expired"
});

/**
 * Written to `rejected_reason` when the lazy transition fires.
 *
 * That column is the terminal-reason column — `expired` is a terminal state, and
 * reusing it beats a migration for a second one. Without it the row records THAT it
 * expired but not that a request observed it expiring, and "was this flipped by the
 * window or by a human?" becomes unanswerable. Stable string, never prose: PR3d
 * filters on it.
 */
export const EXPIRY_AUDIT_REASON = "attribution_window_elapsed";

const MAX_CODE_ATTEMPTS = 5;

function client(deps) {
  const supabase = deps?.supabase || getSupabaseAdmin();
  if (!supabase) throw new Error("referrals: Supabase admin client unavailable");
  return supabase;
}

function requireUserId(userId) {
  const id = String(userId ?? "").trim();
  if (!id) throw new Error("referrals: userId is required");
  return id;
}

/**
 * A referral code from a CSPRNG.
 *
 * `randomInt` is rejection-sampled by Node, so the distribution is uniform — a
 * `randomBytes()[i] % 32` would bias the first 8 symbols and shrink the effective
 * space. Nothing here reads the user id, the email, the clock or a counter: a code
 * derived from any of those is a code an attacker can compute.
 *
 * @param {() => number} [pick] injected only so tests can force a collision.
 */
export function generateReferralCode(pick = () => randomInt(0, REFERRAL_CODE_ALPHABET.length)) {
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    out += REFERRAL_CODE_ALPHABET[pick() % REFERRAL_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * When this attribution's window closes. DERIVED, never stored.
 *
 * There is no `expires_at` column on purpose: two columns describing one moment
 * drift the first time a backfill touches one of them, and `attributed_at` is
 * already the answer. Returns null rather than an "Invalid Date" string so the API
 * omits the field instead of shipping garbage to a UI.
 */
export function attributionExpiresAt(attributedAt) {
  if (!attributedAt) return null;
  const started = new Date(attributedAt).getTime();
  if (!Number.isFinite(started)) return null;
  return new Date(started + ATTRIBUTION_WINDOW_MS).toISOString();
}

/**
 * Is this attribution past its 30-day qualification window?
 *
 * HALF-OPEN INTERVAL: the window is [attributed_at, attributed_at + 30d). The
 * boundary instant itself is EXPIRED — `>=`, not `>`. PR3a shipped `>` and a test
 * pinning "day 30 exactly is open", which quietly made the window 30 days plus one
 * tick; PR3b's spec fixes the semantics at "at/after expiry -> EXPIRED", and both
 * the comparison and that test move together. The practical difference is a single
 * millisecond, but a boundary that is only correct on one side of a comparison is
 * the kind of thing PR3c's qualification would inherit and disagree about.
 *
 * Fails OPEN on anything unreadable. Expiry is what DENIES a reward, so a null or
 * malformed timestamp must never be the reason someone loses one — and `null` is
 * the dangerous input here: `new Date(null)` is the epoch, which is finite, so a
 * `Number.isFinite` check alone would silently report "expired since 1970".
 */
export function isAttributionExpired(attributedAt, now = Date.now()) {
  if (!attributedAt) return false;
  const started = new Date(attributedAt).getTime();
  if (!Number.isFinite(started)) return false;
  return now - started >= ATTRIBUTION_WINDOW_MS;
}

/**
 * Materialise attributed -> expired, once the window has closed.
 *
 * LAZY, because the alternative is a cron: a nightly sweep that must run forever to
 * keep a derived fact honest, and that disagrees with the row every night it misses.
 * The truth stays derived from `attributed_at`; this only writes down what a reader
 * already computed, so PR3d's admin views and PR3c's queries can filter on `state`
 * without every one of them re-deriving the window.
 *
 * COMPARE-AND-SWAP, not read-then-write. The `state = 'attributed'` filter is part
 * of the UPDATE, so a row PR3c qualified or rewarded in the meantime is untouched
 * even if this call was reading a stale copy of it. Nothing here can produce
 * `qualified`, `rewarded` or `reversed`, and nothing here deletes: the row is
 * evidence, and an expired referral that is later disputed needs to still exist.
 *
 * NEVER THROWS. A failed audit write must not fail the request that noticed it —
 * the caller's answer is computed from `attributed_at` either way, so a lost UPDATE
 * costs a bookkeeping row and nothing else. It is logged, not swallowed silently.
 */
export async function expireAttributionIfElapsed(inviteeId, attribution, deps = {}) {
  if (!attribution || attribution.state !== "attributed") return false;
  const now = deps.now ?? Date.now();
  if (!isAttributionExpired(attribution.attributed_at, now)) return false;

  try {
    const { error } = await client(deps)
      .from("referral_attributions")
      .update({ state: "expired", rejected_reason: EXPIRY_AUDIT_REASON })
      .eq("invitee_id", requireUserId(inviteeId))
      .eq("state", "attributed");
    if (error) throw new Error(error.message || "update failed");
    return true;
  } catch (err) {
    console.error("[referrals] lazy_expiry_write_failed", err?.message || err);
    return false;
  }
}

/**
 * The inviter's active code, creating one on first ask.
 *
 * A DISABLED code is never revived. Disabling is how a leaked or abused code is
 * retired, so returning it would undo the only lever there is; instead the old row
 * stays for audit and a fresh code is inserted alongside it. The partial unique
 * index in 062 permits exactly that: many disabled rows, at most one active.
 */
export async function getOrCreateReferralCode(userId, deps = {}) {
  const id = requireUserId(userId);
  const supabase = client(deps);
  const makeCode = deps.generateCode || generateReferralCode;

  const { data: active, error: readError } = await supabase
    .from("referral_codes")
    .select("code, created_at")
    .eq("user_id", id)
    .is("disabled_at", null)
    .maybeSingle();
  if (readError) throw new Error(readError.message || "referrals: code read failed");
  if (active?.code) return { code: active.code, created: false };

  /*
    Collisions are astronomically unlikely but the retry is not optional: the
    alternative is a 500 on a birthday-problem event, and `code` is UNIQUE, so the
    database — not a pre-flight SELECT — decides. A read-then-write here would race
    two simultaneous first-visits into one duplicate-key failure anyway.
  */
  let lastError = null;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = makeCode();
    const { data, error } = await supabase
      .from("referral_codes")
      .insert({ user_id: id, code })
      .select("code")
      .maybeSingle();

    if (!error && data?.code) return { code: data.code, created: true };
    if (error?.code !== "23505") throw new Error(error?.message || "referrals: code insert failed");

    lastError = error;
    /*
      23505 is ambiguous: either the CODE collided (retry with a new one) or this
      user raced themselves into a second active code (re-read and use the winner).
      Distinguished by re-reading rather than by parsing the constraint name.
    */
    const { data: raced } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("user_id", id)
      .is("disabled_at", null)
      .maybeSingle();
    if (raced?.code) return { code: raced.code, created: false };
  }

  throw new Error(lastError?.message || "referrals: could not allocate a unique code");
}

/**
 * Attribute the authenticated invitee to the owner of `code`.
 *
 * `userId` MUST come from a verified session. The caller never supplies an inviter:
 * the RPC resolves one from the code, so the worst a hostile client can do is name
 * a code that already exists — which is what a referral link is.
 *
 * `ipHash` is ALREADY HASHED by the caller. This function never sees a raw address:
 * hashing lives in referralIpHash.js next to the secret, so there is exactly one
 * place that can touch a raw IP and it is not this one. A raw-looking value passed
 * here is refused rather than stored, because a column that sometimes holds an
 * address is a column that leaks one.
 *
 * EXPIRY IS DECIDED HERE, NOT IN SQL. `claim_referral` converges a repeat claim on
 * the existing row and reports success — correct, because the inviter genuinely is
 * that inviter. Whether the 30-day window is still open is a separate question, and
 * answering it in JavaScript keeps ONE clock: the same `isAttributionExpired` the
 * status endpoint and PR3c's qualification will call.
 */
export async function claimReferral({ userId, code, ipHash = null } = {}, deps = {}) {
  const inviteeId = requireUserId(userId);
  const supabase = client(deps);
  const now = deps.now ?? Date.now();

  /*
    A raw address reaching this argument is a caller bug, and the safe failure is a
    loud one. Storing it would silently defeat the entire point of the hash, and
    dropping it silently would leave a NULL that looks like "no IP available".
  */
  const hash = ipHash == null ? null : String(ipHash);
  if (hash !== null && !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("referrals: ipHash must be a hex sha256 digest, never a raw address");
  }

  const { data, error } = await supabase.rpc("claim_referral", {
    p_invitee_id: inviteeId,
    p_code: String(code ?? "").trim(),
    p_ip_hash: hash
  });
  if (error) throw new Error(error.message || "referrals: claim failed");

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("referrals: claim returned no result");
  if (!row.ok) return { ok: false, reason: row.reason || CLAIM_REASONS.INVALID_CODE };

  /*
    A repeat claim on a window that has already closed. The row is NOT reassigned and
    NOT replaced — UNIQUE(invitee_id) makes attribution permanent by design, so the
    honest answer is "this one expired", not a second chance. A first-time claim
    cannot reach this branch: its attributed_at is now.
  */
  if (isAttributionExpired(row.attributed_at, now)) {
    await expireAttributionIfElapsed(
      inviteeId,
      { state: row.state, attributed_at: row.attributed_at },
      { ...deps, supabase, now }
    );
    return { ok: false, reason: CLAIM_REASONS.EXPIRED, attributedAt: row.attributed_at };
  }

  return {
    ok: true,
    attribution: {
      id: row.attribution_id,
      inviterId: row.inviter_id,
      code: row.code,
      state: row.state,
      attributedAt: row.attributed_at,
      expiresAt: attributionExpiresAt(row.attributed_at)
    }
  };
}

/**
 * What this user can be told about their own referrals.
 *
 * Two halves that never mix: as an INVITER they get counts and their code; as an
 * INVITEE they get whether they were attributed and whether the window is still
 * open. `inviterId` is never included — knowing you were referred is the user's
 * business, knowing by which internal uuid is not.
 */
export async function getReferralStatus(userId, deps = {}) {
  const id = requireUserId(userId);
  const supabase = client(deps);
  const now = deps.now ?? Date.now();

  const { data: codeRow, error: codeError } = await supabase
    .from("referral_codes")
    .select("code")
    .eq("user_id", id)
    .is("disabled_at", null)
    .maybeSingle();
  if (codeError) throw new Error(codeError.message || "referrals: status code read failed");

  /*
    INVITER COUNTS COME FROM THE TABLE, NOT FROM referral_inviter_summary.

    That function (migration 062) counts `state = 'rewarded'`, which is the wrong
    question for a capped inviter: PR3c marks a capped referral REWARDED — the
    invitee was paid — while leaving `inviter_rewarded_at` null because the inviter
    earned nothing. Counting by state would tell someone at the cap that they had
    eleven successful referrals and imply 55 days, when they earned ten and 50.

    `inviter_rewarded_at is not null and state <> 'reversed'` is the same predicate
    reward_referral itself uses for the cap, so the number shown to a user and the
    number the cap enforces can never disagree. 062 is production and untouched; its
    summary function is simply no longer the source for this.

    Three HEAD counts rather than one fetch-and-tally: each is an indexed count that
    transfers no rows, and `referral_attributions_inviter_rewarded_idx` (063) covers
    the one that matters.
  */
  const countBy = async (apply) => {
    let query = supabase.from("referral_attributions").select("*", { count: "exact", head: true }).eq("inviter_id", id);
    query = apply(query);
    const { count, error } = await query;
    if (error) throw new Error(error.message || "referrals: inviter count failed");
    return Number(count) || 0;
  };

  const [successful, attributedCount, qualifiedCount] = await Promise.all([
    countBy((q) => q.not("inviter_rewarded_at", "is", null).neq("state", "reversed")),
    countBy((q) => q.eq("state", "attributed")),
    countBy((q) => q.eq("state", "qualified"))
  ]);

  const { data: mine, error: mineError } = await supabase
    .from("referral_attributions")
    .select("state, attributed_at, qualified_at, rewarded_at")
    .eq("invitee_id", id)
    .maybeSingle();
  if (mineError) throw new Error(mineError.message || "referrals: attribution read failed");

  /*
    Reading status is where the lazy transition fires. `expired` below stays DERIVED
    from attributed_at — the single source of truth, and the reason there is no
    expires_at column and no cron — and the write only records what this read already
    concluded. Reporting the state as expired does NOT depend on that write landing:
    the reported state is patched locally, so a failed audit UPDATE can never show a
    user "attributed" for a window that closed weeks ago.
  */
  const expired = mine ? isAttributionExpired(mine.attributed_at, now) : false;
  if (expired) {
    await expireAttributionIfElapsed(id, mine, { ...deps, supabase, now });
  }
  const state = expired && mine.state === "attributed" ? "expired" : mine?.state;

  return {
    // Named rather than left to `code !== null` at every call site: PR3d renders an
    // invite panel off this, and a boolean the server owns is one fewer place for a
    // UI to decide what "has a code" means.
    hasReferralCode: Boolean(codeRow?.code),
    code: codeRow?.code ?? null,
    inviter: {
      attributed: attributedCount,
      qualified: qualifiedCount,
      /*
        `rewarded` is kept for shape compatibility but now carries the SAME corrected
        number as `successful`. There is no reading of "rewarded referrals" an
        inviter cares about other than the ones that actually paid them.
      */
      rewarded: successful,
      successful,
      /*
        Derived, never stored. Both mirror migration 063's constants through
        referralRewards.js, so a change to the reward size or the cap moves the
        displayed number with it.
      */
      earnedDays: successful * REFERRAL_REWARD_DAYS,
      capRemaining: Math.max(0, REFERRAL_INVITER_CAP - successful),
      cap: REFERRAL_INVITER_CAP
    },
    invitee: mine
      ? {
          state,
          attributedAt: mine.attributed_at,
          expiresAt: attributionExpiresAt(mine.attributed_at),
          qualifiedAt: mine.qualified_at,
          rewardedAt: mine.rewarded_at,
          expired
        }
      : null
  };
}

export default {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  ATTRIBUTION_WINDOW_DAYS,
  REFERRAL_STATES,
  CLAIM_REASONS,
  EXPIRY_AUDIT_REASON,
  generateReferralCode,
  attributionExpiresAt,
  isAttributionExpired,
  expireAttributionIfElapsed,
  getOrCreateReferralCode,
  claimReferral,
  getReferralStatus
};
