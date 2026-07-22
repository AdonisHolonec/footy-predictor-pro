/**
 * Persist / load League Profile recalibration overlays.
 * Durable store: Supabase table. Fallback: process memory (no file persistence —
 * this data is fully recomputed daily by the cron job, non-critical to survive a restart).
 */

import { getSupabaseAdmin } from "../supabaseAdmin.js";

let memoryOverlays = new Map(); // `${modelVersion}::${leagueId}` -> overlay
let cache = { loadedAt: 0, byLeague: null, modelVersion: null };

const CACHE_TTL_MS = 60_000;

function cacheKey(modelVersion, leagueId) {
  return `${modelVersion}::${leagueId}`;
}

function mapOverlayRow(row) {
  return {
    leagueId: Number(row.league_id ?? row.leagueId),
    modelVersion: row.model_version || row.modelVersion,
    values: {
      overFrequency: row.over_frequency ?? row.values?.overFrequency ?? null,
      bttsRate: row.btts_rate ?? row.values?.bttsRate ?? null,
      drawFrequency: row.draw_frequency ?? row.values?.drawFrequency ?? null,
      goalFrequency: row.goal_frequency ?? row.values?.goalFrequency ?? null,
      homeAdvantage: row.home_advantage ?? row.values?.homeAdvantage ?? null
    },
    sampleSize: row.sample_size ?? row.sampleSize ?? 0,
    metrics: row.metrics_json || row.metrics || {},
    fittedAt: row.fitted_at || row.fittedAt || null,
    active: row.active !== false
  };
}

export function invalidateLeagueProfileOverlayCache() {
  cache = { loadedAt: 0, byLeague: null, modelVersion: null };
}

/**
 * Load active overlays for a model version into a leagueId→overlay map.
 */
export async function loadActiveLeagueOverlays(modelVersion) {
  const now = Date.now();
  const mv = String(modelVersion || "default");
  if (cache.byLeague && cache.modelVersion === mv && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.byLeague;
  }

  const byLeague = new Map();

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("league_profile_overlays")
        .select("*")
        .eq("model_version", mv)
        .eq("active", true);
      if (!error && Array.isArray(data)) {
        for (const row of data) {
          const overlay = mapOverlayRow(row);
          byLeague.set(overlay.leagueId, overlay);
        }
        cache = { loadedAt: now, byLeague, modelVersion: mv };
        return byLeague;
      }
    } catch {
      /* table may not exist yet */
    }
  }

  // Memory fallback
  for (const [key, row] of memoryOverlays.entries()) {
    if (key.startsWith(`${mv}::`) && row.active !== false) {
      byLeague.set(row.leagueId, row);
    }
  }

  cache = { loadedAt: now, byLeague, modelVersion: mv };
  return byLeague;
}

/**
 * Deactivate previous active overlay for this league, insert new active row.
 */
export async function saveLeagueProfileOverlay({ leagueId, modelVersion, values, sampleSize, metrics }) {
  const mv = String(modelVersion || "default");
  const lid = Number(leagueId);
  const payload = {
    league_id: lid,
    model_version: mv,
    over_frequency: values?.overFrequency ?? null,
    btts_rate: values?.bttsRate ?? null,
    draw_frequency: values?.drawFrequency ?? null,
    goal_frequency: values?.goalFrequency ?? null,
    home_advantage: values?.homeAdvantage ?? null,
    sample_size: sampleSize || 0,
    metrics_json: metrics || {},
    active: true,
    fitted_at: new Date().toISOString()
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      await supabase
        .from("league_profile_overlays")
        .update({ active: false })
        .eq("model_version", mv)
        .eq("league_id", lid)
        .eq("active", true);

      const { data, error } = await supabase
        .from("league_profile_overlays")
        .insert(payload)
        .select("*")
        .single();
      if (!error && data) {
        invalidateLeagueProfileOverlayCache();
        return { ok: true, overlay: mapOverlayRow(data), store: "supabase" };
      }
    } catch {
      /* fall through */
    }
  }

  const mapped = mapOverlayRow(payload);
  memoryOverlays.set(cacheKey(mv, lid), mapped);
  invalidateLeagueProfileOverlayCache();
  return { ok: true, overlay: mapped, store: "memory" };
}

export default {
  invalidateLeagueProfileOverlayCache,
  loadActiveLeagueOverlays,
  saveLeagueProfileOverlay
};
