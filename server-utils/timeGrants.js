/**
 * Bonus-time ledger service (PR1 foundation).
 *
 * EVERY GRANT IS ULTRA. There is no per-grant tier: the product rule is fixed, so
 * this module never takes a tier argument and `resolveEffectiveTierFromProfile`
 * resolves an active bonus straight to `ultra`.
 *
 * WHAT THIS MODULE MUST NEVER DO — these are the load-bearing constraints:
 *
 *   - never write `profiles.subscription_expires_at`. Stripe owns that column and
 *     `stripeBilling.applySubscription` overwrites it from `current_period_end` on
 *     every webhook, so a bonus written there is destroyed by the next renewal.
 *   - never touch Stripe at all. Bonus time is application entitlement, applied
 *     after Stripe, and is invisible to billing.
 *   - never DELETE a grant. Revocation is a flag so disputes stay auditable.
 *   - never compute stacking in JavaScript. Two concurrent grants would both read
 *     the same base and silently overlap; the SQL function takes a per-user advisory
 *     lock and does it atomically.
 *
 * The heavy lifting lives in migration 061 (`grant_bonus_days`, `revoke_time_grant`,
 * `active_bonus_until`) precisely so that idempotency and stacking are enforced by
 * the database rather than by application sequencing.
 */

import { getSupabaseAdmin } from "./supabaseAdmin.js";

/** Ledger sources. referral_* are reserved — PR1 implements no referral lifecycle. */
export const GRANT_SOURCES = Object.freeze([
  "referral_inviter",
  "referral_invitee",
  "admin_grant",
  "compensation",
  "promo_campaign"
]);

/**
 * The standard campaign / reward duration.
 *
 * Exported as a named constant so campaigns read `STANDARD_BONUS_DAYS` instead of a
 * bare 5, but deliberately NOT baked into `grantBonusDays` — the ledger has to carry
 * admin grants and compensation of arbitrary length, so the service accepts any
 * positive integer and the campaign supplies this value.
 */
export const STANDARD_BONUS_DAYS = 5;

/**
 * Strict on purpose: a NUMBER, not something Number() would coerce.
 *
 * `Number("5")` is a perfectly good 5, which is exactly the problem — silently
 * accepting a string at a grant boundary means `" 5 "` succeeds while `"5 days"`
 * becomes NaN, and the difference between those two is a caller bug that should
 * surface here rather than as a mis-sized entitlement.
 */
function assertPositiveDays(days) {
  if (typeof days !== "number" || !Number.isInteger(days) || days <= 0) {
    throw new Error(`timeGrants: days must be a positive integer, got ${JSON.stringify(days)}`);
  }
  return days;
}

function assertSource(source) {
  const s = String(source || "");
  if (!GRANT_SOURCES.includes(s)) {
    throw new Error(`timeGrants: unknown source ${JSON.stringify(source)}`);
  }
  return s;
}

function assertNonEmpty(value, field) {
  const v = String(value ?? "").trim();
  if (!v) throw new Error(`timeGrants: ${field} is required`);
  return v;
}

function client(deps) {
  const supabase = deps?.supabase || getSupabaseAdmin();
  if (!supabase) throw new Error("timeGrants: Supabase admin client unavailable");
  return supabase;
}

/**
 * End of the user's active ULTRA bonus window, or null when there is none.
 *
 * This is the value `resolveEffectiveTierFromProfile(profile, bonusUntil)` expects.
 * Load it alongside the profile — never inside the entitlement function, which must
 * stay pure and synchronous.
 *
 * @returns {Promise<string|null>} ISO timestamp, or null
 */
export async function getActiveBonusUntil(userId, deps = {}) {
  const id = assertNonEmpty(userId, "userId");
  const { data, error } = await client(deps).rpc("active_bonus_until", { p_user_id: id });
  if (error) throw new Error(`timeGrants: active_bonus_until failed — ${error.message}`);
  return data ?? null;
}

/**
 * Grant N ULTRA bonus days, stacking SEQUENTIALLY and idempotently.
 *
 * Stacking is `max(now, current bonus end) + days`, so a grant issued while an
 * earlier one is still running extends it rather than being swallowed by it:
 * +5 on Aug 26 gives Aug 31, and +5 again on Aug 28 gives Sep 5 (not Aug 31).
 *
 * `idempotencyKey` is enforced by a UNIQUE constraint, not by a read-then-write, so
 * a retried webhook or a double-clicked button cannot produce two grants. A replay
 * returns the ORIGINAL row with `created: false` and re-stacks nothing.
 *
 * @param {{userId: string, days: number, source: string, idempotencyKey: string,
 *          referenceId?: string|null, metadata?: object}} input
 * @returns {Promise<{created: boolean, grant: object}>}
 */
export async function grantBonusDays(input = {}, deps = {}) {
  const userId = assertNonEmpty(input.userId, "userId");
  const days = assertPositiveDays(input.days);
  const source = assertSource(input.source);
  const idempotencyKey = assertNonEmpty(input.idempotencyKey, "idempotencyKey");

  const { data, error } = await client(deps).rpc("grant_bonus_days", {
    p_user_id: userId,
    p_days: days,
    p_source: source,
    p_idempotency_key: idempotencyKey,
    p_reference_id: input.referenceId ?? null,
    p_metadata: input.metadata ?? {}
  });
  if (error) throw new Error(`timeGrants: grant_bonus_days failed — ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("timeGrants: grant_bonus_days returned no row");
  const { created, ...grant } = row;
  return { created: Boolean(created), grant };
}

/**
 * Revoke a grant so it stops contributing to entitlement.
 *
 * Non-destructive by design: the row survives with `days` and `effective_until`
 * untouched, and only `revoked_at` / `revoked_reason` are set. Idempotent — revoking
 * an already-revoked grant returns `revoked: false` and does not overwrite the
 * original timestamp or reason.
 *
 * @param {{grantId: string, reason?: string|null}} input
 * @returns {Promise<{revoked: boolean, grant: object|null}>}
 */
export async function revokeGrant(input = {}, deps = {}) {
  const grantId = assertNonEmpty(input.grantId, "grantId");
  const { data, error } = await client(deps).rpc("revoke_time_grant", {
    p_grant_id: grantId,
    p_reason: input.reason ?? null
  });
  if (error) throw new Error(`timeGrants: revoke_time_grant failed — ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { revoked: false, grant: null };
  const { revoked, ...grant } = row;
  return { revoked: Boolean(revoked), grant };
}

/**
 * Every grant for one user, newest first — support and audit surface.
 * Includes revoked rows on purpose: "why did my bonus stop?" needs them.
 */
export async function listGrants(userId, deps = {}) {
  const id = assertNonEmpty(userId, "userId");
  const { data, error } = await client(deps)
    .from("time_grants")
    .select(
      "id, user_id, source, days, granted_at, effective_until, revoked_at, revoked_reason, reference_id, idempotency_key, metadata, created_at"
    )
    .eq("user_id", id)
    .order("granted_at", { ascending: false });
  if (error) throw new Error(`timeGrants: listGrants failed — ${error.message}`);
  return data || [];
}

export default {
  GRANT_SOURCES,
  STANDARD_BONUS_DAYS,
  getActiveBonusUntil,
  grantBonusDays,
  revokeGrant,
  listGrants
};
