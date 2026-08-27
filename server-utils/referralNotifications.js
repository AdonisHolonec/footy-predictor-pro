import { REFERRAL_REWARD_DAYS } from "./referralRewards.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * "Which referral bonuses has this user not been told about yet?"
 *
 * THE SERVER DECIDES EVERYTHING HERE. The client sends no user id, no grant id and
 * no name; it receives a list it can render and nothing more. That boundary is the
 * whole security model of this feature: the caller is taken from the verified
 * session, every query is scoped to that id, and the only identity that ever
 * crosses the wire is a display name the named user chose to publish.
 *
 * WHY A GRANT AND NOT A TIER CHANGE. A user can already be Ultra when a referral
 * pays out, and a tier transition can happen for reasons that have nothing to do
 * with referrals (a purchase, a trial, an admin grant). `time_grants` rows with a
 * referral source are the only evidence that a REFERRAL reward actually arrived,
 * and `grant.id` is the only stable identity for "this reward, once".
 */

/** Only these two sources are referral rewards. `admin_grant` and friends are not. */
const REFERRAL_SOURCES = ["referral_inviter", "referral_invitee"];

/**
 * Enough for any realistic backlog while bounding the query and the toast queue.
 * A user returning after months of referrals sees the most recent ones; the
 * ReferralCard remains the complete, permanent record either way.
 */
const MAX_PENDING = 20;

/**
 * Names longer than this are truncated with an ellipsis rather than allowed to
 * stretch the toast. Matches the column's own 40-character ceiling, so this only
 * ever fires for data written before the constraint existed.
 */
const MAX_NAME = 40;

/**
 * C0 controls and DEL — anything that could restructure the rendered line.
 *
 * A code-point scan rather than a regex: a character class of literal control
 * characters trips no-control-regex, and the escape-sequence spelling is the kind
 * of thing that silently rots back into literal bytes when a file is rewritten.
 */
function hasControlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Defence in depth for the one string that crosses between two users.
 *
 * The database constraint already rejects emails, control characters and
 * over-long values, and React escapes on render. This runs anyway, because the
 * cost of being wrong here is leaking one user's identity to another: a value
 * that fails any check is dropped and the notification falls back to its
 * name-less wording rather than rendering something unexpected.
 */
export function sanitizeDisplayName(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  // An address that somehow reached the column is not a display name.
  if (value.includes("@")) return null;
  if (hasControlChars(value)) return null;
  if (value.length < 2) return null;
  return value.length > MAX_NAME ? `${value.slice(0, MAX_NAME - 1)}…` : value;
}

/**
 * The unacknowledged referral bonuses for one user, newest first.
 *
 * QUERY COUNT IS FIXED AT FOUR, whatever the number of grants: the grants, the
 * ones already acknowledged, the attributions they reference, and the invitees'
 * profiles. There is deliberately no per-grant lookup — a user with ten pending
 * rewards costs exactly what a user with one costs.
 *
 * Never throws. A notification is the least important thing on the page; if any
 * part of this fails the caller gets an empty list and the app carries on.
 */
export async function listPendingReferralBonuses(userId, { supabase } = {}) {
  const db = supabase || getSupabaseAdmin();
  if (!db || !userId) return [];

  try {
    // 1 — the user's own referral grants. Revoked grants are excluded: a reversed
    //     referral must never be announced as a reward.
    const { data: grants, error: grantsError } = await db
      .from("time_grants")
      .select("id, source, days, reference_id, created_at")
      .eq("user_id", userId)
      .in("source", REFERRAL_SOURCES)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_PENDING);
    if (grantsError || !Array.isArray(grants) || grants.length === 0) return [];

    // 2 — which of those has the user already been shown, on any device?
    const ids = grants.map((g) => g.id);
    const { data: seen, error: seenError } = await db
      .from("referral_grant_notifications")
      .select("grant_id")
      .eq("user_id", userId)
      .in("grant_id", ids);
    if (seenError) return [];
    const acknowledged = new Set((seen || []).map((row) => row.grant_id));

    const pending = grants.filter((g) => !acknowledged.has(g.id));
    if (pending.length === 0) return [];

    // 3 + 4 — resolve invitee names, but ONLY for inviter grants. An invitee is
    //         never told who invited them, so their rows need no lookup at all.
    const inviterRefs = pending
      .filter((g) => g.source === "referral_inviter")
      .map((g) => String(g.reference_id || ""))
      .filter(Boolean);

    const nameByAttribution = new Map();
    if (inviterRefs.length > 0) {
      const { data: attributions } = await db
        .from("referral_attributions")
        .select("id, invitee_id")
        .in("id", inviterRefs);

      const inviteeIds = [...new Set((attributions || []).map((a) => a.invitee_id).filter(Boolean))];
      const nameByUser = new Map();
      if (inviteeIds.length > 0) {
        const { data: profiles } = await db
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", inviteeIds);
        for (const p of profiles || []) {
          const safe = sanitizeDisplayName(p.display_name);
          if (safe) nameByUser.set(p.user_id, safe);
        }
      }
      for (const a of attributions || []) {
        // `?? null` and not `undefined`: a missing name is an explicit "render the
        // wording without a name", not an absent field the client has to guess at.
        nameByAttribution.set(a.id, nameByUser.get(a.invitee_id) ?? null);
      }
    }

    /*
      The payload is built by allow-list, never by spreading the row. A grant
      carries `user_id`, `reference_id`, `idempotency_key` and free-form
      `metadata`; none of that is the client's business, and spreading would ship
      all of it the first time someone adds a column.
    */
    return pending.map((g) => ({
      grantId: g.id,
      role: g.source === "referral_inviter" ? "inviter" : "invitee",
      days: Number(g.days) || REFERRAL_REWARD_DAYS,
      inviteeName: g.source === "referral_inviter" ? nameByAttribution.get(String(g.reference_id)) ?? null : null,
      grantedAt: g.created_at
    }));
  } catch (err) {
    console.error("[referral] bonus_notifications_failed", err?.message || err);
    return [];
  }
}

/**
 * Record that these grants have been announced.
 *
 * OWNERSHIP IS RE-VERIFIED, NOT TRUSTED. The client sends grant ids back, so this
 * re-reads them scoped to the caller before writing: an id belonging to somebody
 * else is silently dropped rather than acknowledged, which would otherwise let
 * one account suppress another's notification.
 *
 * A repeated acknowledgement is a no-op rather than an error — the primary key
 * makes the second insert a conflict, which is what lets the client retry freely.
 */
export async function acknowledgeReferralBonuses(userId, grantIds, { supabase } = {}) {
  const db = supabase || getSupabaseAdmin();
  const ids = [...new Set((Array.isArray(grantIds) ? grantIds : []).map((v) => String(v || "")).filter(Boolean))].slice(
    0,
    MAX_PENDING
  );
  if (!db || !userId || ids.length === 0) return { acknowledged: 0 };

  try {
    const { data: owned, error } = await db
      .from("time_grants")
      .select("id")
      .eq("user_id", userId)
      .in("source", REFERRAL_SOURCES)
      .in("id", ids);
    if (error || !Array.isArray(owned) || owned.length === 0) return { acknowledged: 0 };

    const rows = owned.map((g) => ({ grant_id: g.id, user_id: userId }));
    const { error: insertError } = await db
      .from("referral_grant_notifications")
      .upsert(rows, { onConflict: "grant_id", ignoreDuplicates: true });
    if (insertError) return { acknowledged: 0 };
    return { acknowledged: rows.length };
  } catch (err) {
    console.error("[referral] bonus_ack_failed", err?.message || err);
    return { acknowledged: 0 };
  }
}

export default { listPendingReferralBonuses, acknowledgeReferralBonuses, sanitizeDisplayName };
