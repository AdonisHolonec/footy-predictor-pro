/**
 * The one place the server answers "what tier is this user, right now".
 *
 * WHY THIS EXISTS: five call sites each hand-rolled their own profile SELECT and
 * then called resolveEffectiveTierFromProfile on it — two of them (api/fixtures
 * tierStatus and its per-date branch) with a byte-identical six-column query and
 * a byte-identical legacy-column fallback. Entitlement now has a second input,
 * the bonus window, and copying that decision five more times is how the tier
 * rule drifts between the paths that gate access and the paths that display it.
 *
 * WHY A QUERY AND NOT profiles.bonus_until: the ledger is the source of truth and
 * a denormalised column is a second one. Measured, the extra read is a single
 * indexed point lookup covered by time_grants_active_by_user_idx
 * (user_id, effective_until desc) WHERE revoked_at is null — against a request
 * that already loads a profile, reads KV counters and runs the pipeline. The
 * cache can be added later without breaking anything; a wrong ULTRA cannot be
 * taken back.
 *
 * `resolveEffectiveTierFromProfile` stays PURE. This module is the only async
 * layer: it fetches the two inputs and hands them over.
 */

import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { resolveEffectiveTierFromProfile } from "./accessTier.js";

/** Exactly the columns the tier rule reads — never `select("*")`. */
export const ENTITLEMENT_PROFILE_COLUMNS =
  "role, tier, subscription_expires_at, premium_trial_activated_at, ultra_trial_activated_at, created_at";

function client(deps) {
  const supabase = deps?.supabase || getSupabaseAdmin();
  if (!supabase) throw new Error("entitlement: Supabase admin client unavailable");
  return supabase;
}

/**
 * The profile row the tier rule needs.
 *
 * Keeps the legacy fallback both fixtures branches carried: a database that
 * predates migration 016 has no `tier` / `subscription_expires_at`, and the
 * handler degraded to a free profile rather than 500ing. Preserved verbatim so
 * this refactor cannot change behaviour on an un-migrated database.
 *
 * @returns {Promise<object|null>} null when the user has no profile row
 */
export async function loadEntitlementProfile(userId, deps = {}) {
  const supabase = client(deps);
  const { data, error } = await supabase
    .from("profiles")
    .select(ENTITLEMENT_PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (!error) return data ?? null;

  const msg = String(error.message || "").toLowerCase();
  const missingTierCols = msg.includes("column") && (msg.includes("tier") || msg.includes("subscription_expires_at"));
  // PostgREST hands back a plain {message,code,...}, not an Error. Rethrowing it
  // raw loses the stack and defeats `instanceof Error` for every caller, so wrap
  // it while keeping the message the handlers already surface.
  if (!missingTierCols) throw new Error(error.message || "entitlement: profile read failed");

  const { data: legacy, error: legacyError } = await supabase
    .from("profiles")
    .select("created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (legacyError) throw new Error(legacyError.message || "entitlement: legacy profile read failed");
  return { role: "user", tier: "free", created_at: legacy?.created_at };
}

/**
 * End of the user's active ULTRA bonus window, or null.
 *
 * Direct indexed SELECT rather than the `active_bonus_until` RPC: same single
 * round-trip, no SECURITY DEFINER invocation per request, and the ordering makes
 * the index the plan. `gt.now()` is STRICTLY greater — a window ending exactly
 * now is over, which is what `resolveEffectiveTierFromProfile` also assumes.
 *
 * A read failure returns null rather than throwing: losing the bonus lookup must
 * degrade a user to their paid tier, never deny them the access they pay for.
 */
export async function loadActiveBonusUntil(userId, deps = {}) {
  const { data, error } = await client(deps)
    .from("time_grants")
    .select("effective_until")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("effective_until", "now()")
    .order("effective_until", { ascending: false })
    .limit(1);
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.effective_until ?? null;
}

/**
 * Profile + bonus window + the resolved tier, in one call and two queries.
 *
 * Pass `deps.profile` when the caller already loaded a profile for its own
 * reasons (api/billing needs stripe_subscription_id, which is none of this
 * module's business) — the profile query is then skipped and only the bonus
 * lookup runs. That is what keeps "unrelated profile data" separate from
 * entitlement data without paying for a second profile round-trip.
 *
 * @returns {Promise<{profile: object|null, bonusUntil: string|null,
 *                    hasActiveBonus: boolean, tierInfo: object|null}>}
 */
export async function loadEntitlement(userId, deps = {}) {
  const id = String(userId ?? "").trim();
  if (!id) throw new Error("entitlement: userId is required");

  const profile = deps.profile !== undefined ? deps.profile : await loadEntitlementProfile(id, deps);
  if (!profile) return { profile: null, bonusUntil: null, hasActiveBonus: false, tierInfo: null };

  const bonusUntil = await loadActiveBonusUntil(id, deps);
  const tierInfo = resolveEffectiveTierFromProfile(profile, bonusUntil);
  return { profile, bonusUntil, hasActiveBonus: tierInfo.hasActiveBonus, tierInfo };
}

export default { ENTITLEMENT_PROFILE_COLUMNS, loadEntitlementProfile, loadActiveBonusUntil, loadEntitlement };
