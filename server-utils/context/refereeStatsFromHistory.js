/**
 * Referee statistics from our own settled predictions — zero API-Football
 * calls. Card counts aren't captured anywhere in this app (would need a
 * per-fixture /fixtures/statistics call per historical match, which isn't
 * quota-safe), so only avgGoals and homeWinBias are derived; avgCards stays
 * null until a card-count data source exists.
 */

import { getSupabaseAdmin } from "../supabaseAdmin.js";

const FINAL_STATUSES = ["FT", "AET", "PEN"];
const HOME_WIN_BASELINE = 0.45;

function envInt(name, fallback) {
  const n = Number(typeof process !== "undefined" ? process.env?.[name] : undefined);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * @param {string} refereeName
 * @param {{ excludeFixtureId?: number|string, minSamples?: number }} [opts]
 * @returns {Promise<{avgGoals:number, avgCards:null, homeWinBias:number, sampleSize:number, source:string}|null>}
 */
export async function computeRefereeStatsFromHistory(refereeName, opts = {}) {
  const name = String(refereeName || "").trim();
  if (!name) return null;

  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const minSamples = Math.max(1, Number(opts.minSamples) || envInt("REFEREE_STATS_MIN_SAMPLES", 3));

  try {
    let query = supabase
      .from("predictions_history")
      .select("fixture_id, score_home, score_away")
      .eq("referee_name", name)
      .in("match_status", FINAL_STATUSES)
      .not("score_home", "is", null)
      .not("score_away", "is", null)
      .limit(200);

    if (opts.excludeFixtureId != null) {
      query = query.neq("fixture_id", Number(opts.excludeFixtureId));
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data) || data.length < minSamples) return null;

    let goalsSum = 0;
    let homeWins = 0;
    let decided = 0;
    for (const row of data) {
      const h = Number(row.score_home);
      const a = Number(row.score_away);
      if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
      goalsSum += h + a;
      if (h !== a) {
        decided += 1;
        if (h > a) homeWins += 1;
      }
    }

    const sampleSize = data.length;
    const avgGoals = goalsSum / sampleSize;
    const homeWinRate = decided > 0 ? homeWins / decided : HOME_WIN_BASELINE;

    return {
      avgGoals: Number(avgGoals.toFixed(3)),
      avgCards: null,
      homeWinBias: Number((homeWinRate - HOME_WIN_BASELINE).toFixed(3)),
      sampleSize,
      source: "internal_history"
    };
  } catch {
    return null;
  }
}

export default { computeRefereeStatsFromHistory };
