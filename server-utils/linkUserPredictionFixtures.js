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
 */

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

  return { ok: true, linked: rows.length };
}

export default { linkUserPredictionFixtures };
