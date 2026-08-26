/**
 * Ownership link between an authenticated user and the fixtures they received
 * predictions for. Single source of truth for every write to
 * `user_prediction_fixtures` — never upsert that table anywhere else.
 *
 * Invariant enforced here: **if a user receives predictions, ownership must exist.**
 * `/api/history?mine=1` reads through `predictions_history_for_user`, which INNER JOINs
 * this table; a missing link makes an existing `predictions_history` row invisible to
 * its owner and unrecoverable after logout / reconnect / device switch.
 *
 * Both producers must call this:
 *  - Stage10Persistence — live pipeline, after `predictions_history` is written.
 *  - Stage01DataCollection — DB-cache short-circuits, before `halt(…, 200, items)`.
 *    Those rows already exist in `predictions_history` (they were just read from it),
 *    so the FK to `predictions_history.fixture_id` is satisfied by construction.
 *
 * Never throws and never blocks a response: a failed link is recoverable, a lost
 * prediction response is not.
 *
 * PR3c HOOKS REFERRAL QUALIFICATION HERE, and here only.
 *
 * This is the one place both producers meet, so one hook covers the live pipeline
 * and the DB-cache short-circuits without a second call site to keep in sync. It is
 * also the correct MOMENT: this function runs after `predictions_history` has
 * persisted (Stage10) or after the rows were read back from it (Stage01), so an
 * ownership row means the invitee durably received predictions. Hooking a click, a
 * 200, or the pre-persistence attempt counter would reward a Predict that never
 * landed — `rollback_predict_increment` in migration 012 exists because that counter
 * moves before persistence and has to be walked back when persistence fails.
 *
 * The qualification attempt inherits this function's contract exactly: it cannot
 * throw and it cannot delay a decision the response depends on.
 */

import { attemptQualificationForUser } from "./referralRewards.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const OWNERSHIP_TABLE = "user_prediction_fixtures";

/**
 * Idempotent ownership upsert. Safe to call repeatedly for the same
 * (user, fixture) pair — duplicate Predict clicks, multi-device logins and
 * DB-cache replays all collapse onto the `(user_id, fixture_id)` primary key.
 *
 * @param {string | null | undefined} userId Authenticated user id (null for cron/internal runs).
 * @param {Array<number | string | null | undefined>} fixtureIds Fixture ids the caller is about to return.
 * @returns {Promise<{ ok: boolean, linked: number, reason?: string, error?: string }>}
 */
export async function linkUserPredictionFixtures(userId, fixtureIds) {
  if (!userId) return { ok: true, linked: 0, reason: "no_user" };

  const uniqueIds = [
    ...new Set(
      (Array.isArray(fixtureIds) ? fixtureIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  ];
  if (uniqueIds.length === 0) return { ok: true, linked: 0, reason: "no_fixtures" };

  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, linked: 0, error: "supabase_unavailable" };

  const rows = uniqueIds.map((fixtureId) => ({ user_id: userId, fixture_id: fixtureId }));
  const { error } = await supabase.from(OWNERSHIP_TABLE).upsert(rows, {
    onConflict: "user_id,fixture_id",
    ignoreDuplicates: true
  });
  if (error) {
    console.error("[user_prediction_fixtures]", error?.message || error);
    return { ok: false, linked: 0, error: error?.message || String(error) };
  }

  /*
    Post-persistence referral qualification (PR3c). Only reached once ownership is
    durably written, so the qualifying Predict this may reward is one that actually
    landed.

    Awaited rather than fired and forgotten: an unawaited promise on a serverless
    function can be killed when the response returns, which would drop the reward
    silently and leave the user waiting on a retry that only fires if they Predict
    again. It costs one indexed probe on `referral_attributions.invitee_id` for a
    user who was never referred, which is almost all of them.

    `attemptQualificationForUser` already swallows every database failure, so this
    try/catch is not for those. It is for a CONTRACT VIOLATION — a TypeError, a bad
    import, a refactor that lets something escape — because "Predict must never fail
    because of a referral" is too important to rest on another module keeping a
    promise. The guarantee is structural here, not conventional.
  */
  try {
    await attemptQualificationForUser(userId);
  } catch (referralError) {
    console.error("[referral] hook_escaped_contract", referralError?.message || referralError);
  }

  return { ok: true, linked: rows.length };
}

export default { linkUserPredictionFixtures };
