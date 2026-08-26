import { randomInt } from "node:crypto";

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
 * IP HASHING IS NOT IMPLEMENTED, DELIBERATELY. `referral_attributions.ip_hash`
 * exists and stays NULL. A useful IP signal must be (a) unguessable, so a leaked
 * hash does not reveal the address, and (b) STABLE, so two accounts an hour apart
 * still compare equal. Unsalted SHA-256 fails (a): IPv4 is 2^32, enumerable in
 * seconds. A per-row salt fails (b): nothing compares. It therefore needs a
 * dedicated, stable secret — and this repo has none. CRON_SECRET and
 * STRIPE_WEBHOOK_SECRET are authentication credentials on their own rotation
 * schedules; keying IP hashes to either means every rotation silently voids the
 * entire signal while the column still looks populated. Rather than invent a
 * secret, PR3a leaves the column null and reports it. See the PR body.
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
  SELF_SAME_STRIPE: "self_referral_same_stripe_customer"
});

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
 * Is this attribution past its 30-day qualification window?
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
  return now - started > ATTRIBUTION_WINDOW_MS;
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
 * `ip` is accepted and currently discarded (see the module header). Kept in the
 * signature so PR3b/PR3c wire a hash in one place once a secret exists, rather than
 * threading a new argument through every call site later.
 */
export async function claimReferral({ userId, code, ip: _ip } = {}, deps = {}) {
  const inviteeId = requireUserId(userId);
  const supabase = client(deps);

  const { data, error } = await supabase.rpc("claim_referral", {
    p_invitee_id: inviteeId,
    p_code: String(code ?? "").trim(),
    p_ip_hash: null
  });
  if (error) throw new Error(error.message || "referrals: claim failed");

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("referrals: claim returned no result");
  if (!row.ok) return { ok: false, reason: row.reason || CLAIM_REASONS.INVALID_CODE };

  return {
    ok: true,
    attribution: {
      id: row.attribution_id,
      inviterId: row.inviter_id,
      code: row.code,
      state: row.state,
      attributedAt: row.attributed_at
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

  const { data: summary, error: summaryError } = await supabase.rpc("referral_inviter_summary", {
    p_user_id: id
  });
  if (summaryError) throw new Error(summaryError.message || "referrals: summary failed");
  const counts = (Array.isArray(summary) ? summary[0] : summary) || {};

  const { data: mine, error: mineError } = await supabase
    .from("referral_attributions")
    .select("state, attributed_at, qualified_at, rewarded_at")
    .eq("invitee_id", id)
    .maybeSingle();
  if (mineError) throw new Error(mineError.message || "referrals: attribution read failed");

  return {
    code: codeRow?.code ?? null,
    inviter: {
      attributed: Number(counts.attributed_count) || 0,
      qualified: Number(counts.qualified_count) || 0,
      rewarded: Number(counts.rewarded_count) || 0
    },
    invitee: mine
      ? {
          state: mine.state,
          attributedAt: mine.attributed_at,
          qualifiedAt: mine.qualified_at,
          rewardedAt: mine.rewarded_at,
          /*
            DERIVED, never stored. `attributed_at` is the single source of truth for
            the window; a stored `expired` state would need a cron to stay honest and
            would disagree with the row the moment that cron missed a night. PR3c's
            qualification refuses on this same computation.
          */
          expired: isAttributionExpired(mine.attributed_at, now)
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
  generateReferralCode,
  isAttributionExpired,
  getOrCreateReferralCode,
  claimReferral,
  getReferralStatus
};
