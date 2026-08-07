/**
 * One-off backfill: recreate `user_prediction_fixtures` rows lost to the DB-cache
 * short-circuit (Stage01DataCollection halted before Stage10Persistence, so predictions
 * were returned to the user with no ownership written).
 *
 * DRY-RUN BY DEFAULT. Pass --apply to write.
 *
 *   npm run backfill:ownership -- --days=30
 *   npm run backfill:ownership -- --days=30 --user=<uuid>
 *   npm run backfill:ownership -- --days=30 --apply
 *
 * ── How a day is reconstructed ─────────────────────────────────────────────────
 * `user_daily_warm_predict_usage(user_id, usage_day, predict_count)` is written on
 * BOTH paths, so it is the authoritative record of "this user ran Predict that day".
 * A day with predict_count > 0 and zero ownership rows is a day the cache served them.
 * Candidate fixtures = `predictions_history` rows whose kickoff falls in that UTC day
 * and whose league is one the user follows — the same window `readDbOnlyPredictions`
 * used (`${date}T00:00:00.000Z`…`T23:59:59.999Z`, league-filtered, kickoff ascending).
 *
 * ── Known imprecision (read the dry run before applying) ───────────────────────
 * This is a reconstruction, not a replay. Three inputs were never recorded:
 *   1. `profiles.favorite_leagues` is CURRENT, not what was selected that day. A user
 *      who has since changed leagues gets over- or under-linked.
 *   2. The per-request `limit` is unknown; we cap at the user's tier daily limit, which
 *      is an upper bound — fewer rows may actually have been shown.
 *   3. Predict can target a date other than the usage day; those days stay under-linked.
 * Over-linking gives a user history (and win/loss stats) for matches they may not have
 * been shown. Under-linking leaves some days still missing. Inspect the dry-run plan.
 *
 * Safety: never deletes, never touches days that already have ownership, and writes
 * only through the shared idempotent helper — re-running creates no duplicates.
 */

import { getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import { linkUserPredictionFixtures } from "../server-utils/linkUserPredictionFixtures.js";
import { resolveEffectiveTierFromProfile, tierDailyLimit } from "../server-utils/accessTier.js";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 120;
const FALLBACK_CAP = 200;

function parseArgs(argv) {
  const args = { days: DEFAULT_DAYS, user: null, apply: false };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "apply") args.apply = true;
    else if (key === "days") args.days = Math.max(1, Math.min(Number(value) || DEFAULT_DAYS, MAX_DAYS));
    else if (key === "user") args.user = String(value || "").trim() || null;
  }
  return args;
}

/** UTC day bounds, mirroring readDbOnlyPredictions in Stage01DataCollection.js. */
function utcDayBounds(usageDay) {
  const day = String(usageDay).slice(0, 10);
  return { from: `${day}T00:00:00.000Z`, to: `${day}T23:59:59.999Z` };
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error("Supabase nu este configurat (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
    process.exitCode = 1;
    return;
  }

  const sinceDay = new Date(Date.now() - args.days * 86_400_000).toISOString().slice(0, 10);
  console.log(`mode        : ${args.apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  console.log(`window      : ${sinceDay} → today (${args.days} days)`);
  console.log(`user filter : ${args.user || "all users"}`);
  console.log("");

  // 1. Days on which each user was active.
  // NOTE: `predict_count` alone is the wrong filter. commitWarmPredictIncrement(…, "predict")
  // runs at Stage01 *after* the DB-cache branches have already returned, so on exactly the
  // affected days predict_count stays 0. `warm_count` is incremented by /api/warm, a separate
  // endpoint the dashboard calls immediately before Predict (warmAndPredict), and it is not
  // behind the short-circuit — so warm_count is the surviving trace of a cache-served day.
  let usageQuery = supabase
    .from("user_daily_warm_predict_usage")
    .select("user_id, usage_day, predict_count, warm_count")
    .gte("usage_day", sinceDay)
    .or("predict_count.gt.0,warm_count.gt.0")
    .order("usage_day", { ascending: true })
    .limit(10_000);
  if (args.user) usageQuery = usageQuery.eq("user_id", args.user);
  const { data: usageRows, error: usageErr } = await usageQuery;
  if (usageErr) throw usageErr;
  if (!usageRows?.length) {
    console.log("Nicio zi cu Predict în fereastra selectată — nimic de reconstruit.");
    return;
  }

  // 2. Ownership that already exists — those days worked, leave them alone.
  const userIds = [...new Set(usageRows.map((r) => String(r.user_id)))];
  const { data: linkRows, error: linkErr } = await supabase
    .from("user_prediction_fixtures")
    .select("user_id, fixture_id, first_predicted_at")
    .in("user_id", userIds)
    .limit(100_000);
  if (linkErr) throw linkErr;
  const ownedDays = new Set();
  const ownedPairs = new Set();
  for (const row of linkRows || []) {
    ownedDays.add(`${row.user_id}|${String(row.first_predicted_at).slice(0, 10)}`);
    ownedPairs.add(`${row.user_id}|${Number(row.fixture_id)}`);
  }

  // 3. Tier + followed leagues per user.
  const { data: profileRows, error: profileErr } = await supabase
    .from("profiles")
    .select(
      "user_id, role, tier, favorite_leagues, subscription_expires_at, premium_trial_activated_at, ultra_trial_activated_at, created_at"
    )
    .in("user_id", userIds);
  if (profileErr) throw profileErr;
  const profileById = new Map((profileRows || []).map((p) => [String(p.user_id), p]));

  const plan = [];
  let skippedOwned = 0;
  let skippedNoLeagues = 0;
  let skippedNoCandidates = 0;

  for (const usage of usageRows) {
    const userId = String(usage.user_id);
    const day = String(usage.usage_day).slice(0, 10);
    if (ownedDays.has(`${userId}|${day}`)) {
      skippedOwned += 1;
      continue;
    }

    const profile = profileById.get(userId);
    const leagues = (profile?.favorite_leagues || []).map(Number).filter(Number.isFinite);
    if (!leagues.length) {
      skippedNoLeagues += 1;
      continue;
    }

    const dailyLimit = tierDailyLimit(resolveEffectiveTierFromProfile(profile).effectiveTier);
    const cap = Number.isFinite(dailyLimit) ? dailyLimit : FALLBACK_CAP;
    const { from, to } = utcDayBounds(day);

    const { data: candidates, error: candErr } = await supabase
      .from("predictions_history")
      .select("fixture_id")
      .gte("kickoff_at", from)
      .lte("kickoff_at", to)
      .in("league_id", leagues)
      .order("kickoff_at", { ascending: true })
      .limit(cap);
    if (candErr) throw candErr;

    const fixtureIds = (candidates || [])
      .map((row) => Number(row.fixture_id))
      .filter((id) => Number.isFinite(id) && !ownedPairs.has(`${userId}|${id}`));
    if (!fixtureIds.length) {
      skippedNoCandidates += 1;
      continue;
    }

    plan.push({
      userId,
      day,
      activity: `p${usage.predict_count ?? 0}/w${usage.warm_count ?? 0}`,
      cap,
      fixtureIds
    });
  }

  if (!plan.length) {
    console.log("Nimic de reconstruit: fiecare zi cu Predict are deja ownership.");
    console.log(
      `  deja acoperite: ${skippedOwned} · fără ligi favorite: ${skippedNoLeagues} · fără candidați: ${skippedNoCandidates}`
    );
    return;
  }

  console.log("plan (user · day · predict/warm counts · tier cap → fixtures to link):");
  for (const item of plan) {
    console.log(
      `  ${item.userId.slice(0, 8)}…  ${item.day}  ${item.activity}  cap=${item.cap}  → ${item.fixtureIds.length}`
    );
  }
  const total = plan.reduce((sum, item) => sum + item.fixtureIds.length, 0);
  console.log("");
  console.log(`days to backfill : ${plan.length}`);
  console.log(`rows to link     : ${total}`);
  console.log(
    `skipped          : ${skippedOwned} already owned · ${skippedNoLeagues} no favourite leagues · ${skippedNoCandidates} no candidates`
  );

  if (!args.apply) {
    console.log("");
    console.log("DRY RUN — nothing written. Re-run with --apply to write these rows.");
    return;
  }

  let linked = 0;
  let failed = 0;
  for (const item of plan) {
    const result = await linkUserPredictionFixtures(item.userId, item.fixtureIds);
    if (result.ok) {
      linked += result.linked;
    } else {
      failed += 1;
      console.error(`  FAILED ${item.userId.slice(0, 8)}… ${item.day}: ${result.error}`);
    }
  }
  console.log("");
  console.log(`APPLIED — linked ${linked} row(s) across ${plan.length - failed} day(s); ${failed} day(s) failed.`);
}

main().catch((error) => {
  console.error("[backfill-prediction-ownership]", error?.message || error);
  process.exitCode = 1;
});
