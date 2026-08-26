import { getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * Referral qualification and reward. PR3c — the first reward-producing module.
 *
 * DELIBERATELY THIN. Every rule that matters lives in migration 063:
 * `qualify_referral` decides eligibility against auth.users and
 * user_prediction_fixtures, and `reward_referral` performs both grants, the
 * lifetime cap and the state change inside ONE transaction. This layer finds an
 * attribution id, calls those two functions in order, and shapes the answer.
 *
 * The division is not stylistic. Two grants plus a cap plus a state transition are
 * only atomic inside a transaction, and JavaScript cannot hold one across two
 * PostgREST calls. Re-deciding any of it here would create a second implementation
 * of a rule whose whole value is that there is exactly one — the same reason PR3a
 * put email normalisation in SQL and PR2a/PR2b spent two PRs removing duplicates.
 *
 * THIS MODULE NEVER INSERTS time_grants. It never imports timeGrants.js either: the
 * grants are issued by `grant_bonus_days` from inside `reward_referral`, so they
 * share that transaction. A JS-side grant could not be rolled back by it.
 *
 * THE PREDICT PATH MUST NOT BREAK. `attemptQualificationForUser` is called from
 * linkUserPredictionFixtures.js, on the response path of /api/predict. It cannot
 * throw, and it returns a result object rather than signalling by exception. A lost
 * prediction response is unrecoverable; a deferred reward is not — the next Predict,
 * the next status read, or an admin retry all converge on the same durable facts.
 */

/** Lifetime cap on rewards an INVITER can earn. Mirrors v_cap in migration 063. */
export const REFERRAL_INVITER_CAP = 10;

/** Campaign tag written into grant metadata. Mirrors 'v1' in migration 063. */
export const REFERRAL_CAMPAIGN = "v1";

/**
 * Reasons `qualify_referral` returns that are NOT failures.
 *
 * A retried Predict hook re-runs qualification for an attribution that is already
 * qualified or already rewarded, and that is the system working. Treating them as
 * errors would fill the logs with alarm on the happy path and make a real failure
 * unfindable.
 */
export const BENIGN_QUALIFY_REASONS = Object.freeze(["already_qualified", "already_rewarded"]);

/**
 * Reasons that mean "not yet", as opposed to "never".
 *
 * Kept apart from terminal reasons so observability can distinguish a referral
 * still waiting on the user from one that can never pay — the second is worth
 * looking at, the first is the normal state of every open referral.
 */
export const PENDING_QUALIFY_REASONS = Object.freeze(["email_unverified", "no_qualifying_predict"]);

function client(deps) {
  const supabase = deps?.supabase || getSupabaseAdmin();
  if (!supabase) throw new Error("referralRewards: Supabase admin client unavailable");
  return supabase;
}

function requireId(value, field) {
  const id = String(value ?? "").trim();
  if (!id) throw new Error(`referralRewards: ${field} is required`);
  return id;
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Structured, PII-free.
 *
 * User ids are internal uuids and are safe to log; an email address, an IP, a token
 * or a request body is not, and none of them is available to this module anyway —
 * which is the point of it never receiving them.
 */
function log(event, fields) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);
  console.log(`[referral] ${event} ${parts.join(" ")}`.trim());
}

/**
 * Mark one attribution qualified, if it is eligible right now.
 *
 * Writes no grant. Throws only on transport failure — an ineligible referral comes
 * back as `{ ok: false, reason }` because "the invitee has not confirmed their email
 * yet" is the expected state of most open referrals, not an exception.
 */
export async function qualifyReferral(attributionId, deps = {}) {
  const id = requireId(attributionId, "attributionId");
  const { data, error } = await client(deps).rpc("qualify_referral", { p_attribution_id: id });
  if (error) throw new Error(error.message || "referralRewards: qualify failed");

  const row = firstRow(data);
  if (!row) throw new Error("referralRewards: qualify returned no result");
  return {
    ok: Boolean(row.ok),
    reason: row.reason ?? null,
    qualifiedAt: row.qualified_at ?? null
  };
}

/**
 * Pay one qualified attribution. Atomic in the database; this only reports.
 *
 * `inviterCapped` is a normal outcome, not an error: the invitee is still paid, and
 * the inviter simply has no earning left. See U2.
 */
export async function rewardReferral(attributionId, deps = {}) {
  const id = requireId(attributionId, "attributionId");
  const { data, error } = await client(deps).rpc("reward_referral", { p_attribution_id: id });
  if (error) throw new Error(error.message || "referralRewards: reward failed");

  const row = firstRow(data);
  if (!row) throw new Error("referralRewards: reward returned no result");
  return {
    ok: Boolean(row.ok),
    reason: row.reason ?? null,
    inviteeGrantId: row.invitee_grant_id ?? null,
    inviterGrantId: row.inviter_grant_id ?? null,
    inviterCapped: Boolean(row.inviter_capped),
    inviterRewardCount: row.inviter_reward_count ?? null,
    rewardedAt: row.rewarded_at ?? null
  };
}

/**
 * Finish a reward for an attribution that is already qualified.
 *
 * The retry path. A reward transaction that aborted leaves the attribution at
 * `qualified`, which is precisely the "earned but not yet delivered" state PR3d will
 * surface — calling this again completes it, and the grant idempotency keys make a
 * call against an already-rewarded row a no-op.
 */
export async function attemptRewardForAttribution(attributionId, deps = {}) {
  const id = requireId(attributionId, "attributionId");
  try {
    const result = await rewardReferral(id, deps);
    log(result.ok ? "reward_ok" : "reward_refused", {
      attribution_id: id,
      reason: result.reason,
      invitee_grant_id: result.inviteeGrantId,
      inviter_grant_id: result.inviterGrantId,
      inviter_capped: result.inviterCapped,
      cap_count: result.inviterRewardCount
    });
    return result;
  } catch (err) {
    // Left at `qualified` on purpose — retryable, and visible to PR3d as earned
    // but undelivered. Never advanced to `rewarded` on a failure.
    log("reward_failed", { attribution_id: id, error: err?.message || String(err) });
    return { ok: false, reason: "reward_error", error: err?.message || String(err) };
  }
}

/**
 * The whole pipeline for one user: find their attribution, qualify it, pay it.
 *
 * NEVER THROWS. This runs on the /api/predict response path, so every failure mode
 * — no Supabase client, a dead connection, a malformed row — has to end as a
 * returned object. The caller ignores the result.
 *
 * CHEAP ON THE COMMON PATH. The first statement is a single indexed lookup on
 * `referral_attributions.invitee_id` (UNIQUE, so index-backed) against a table that
 * holds at most one row per referred user and nothing at all for everyone else. A
 * user who was never referred costs one index probe and returns.
 */
export async function attemptQualificationForUser(userId, deps = {}) {
  const id = String(userId ?? "").trim();
  if (!id) return { ok: false, reason: "no_user" };

  try {
    const supabase = client(deps);
    const { data: attribution, error } = await supabase
      .from("referral_attributions")
      .select("id, state")
      .eq("invitee_id", id)
      .maybeSingle();
    if (error) throw new Error(error.message || "attribution read failed");

    // The overwhelmingly common case: this user was never referred.
    if (!attribution?.id) return { ok: false, reason: "no_attribution" };

    /*
      Already rewarded, or terminal (expired / rejected / reversed). Returning here
      keeps a repeat Predict from taking row and advisory locks for a decision that
      cannot change.
    */
    if (attribution.state === "rewarded") return { ok: false, reason: "already_rewarded" };
    if (attribution.state !== "attributed" && attribution.state !== "qualified") {
      return { ok: false, reason: attribution.state };
    }

    if (attribution.state === "attributed") {
      const qualified = await qualifyReferral(attribution.id, deps);
      if (!qualified.ok && !BENIGN_QUALIFY_REASONS.includes(qualified.reason)) {
        // Not an error: most referrals sit at email_unverified or
        // no_qualifying_predict until the user does the thing.
        log("qualify_pending", { attribution_id: attribution.id, reason: qualified.reason });
        return { ok: false, reason: qualified.reason };
      }
      log("qualified", { attribution_id: attribution.id, qualified_at: qualified.qualifiedAt });
    }

    // Qualified — either just now, or by an earlier attempt whose reward failed.
    const reward = await attemptRewardForAttribution(attribution.id, deps);
    return { ok: reward.ok, reason: reward.reason, attributionId: attribution.id, reward };
  } catch (err) {
    log("qualification_attempt_failed", { user_scope: "invitee", error: err?.message || String(err) });
    return { ok: false, reason: "qualification_error", error: err?.message || String(err) };
  }
}

export default {
  REFERRAL_INVITER_CAP,
  REFERRAL_CAMPAIGN,
  BENIGN_QUALIFY_REASONS,
  PENDING_QUALIFY_REASONS,
  qualifyReferral,
  rewardReferral,
  attemptRewardForAttribution,
  attemptQualificationForUser
};
