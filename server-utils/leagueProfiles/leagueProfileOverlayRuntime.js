/**
 * Process-local active league-profile overlays for the sync getLeagueProfile() reader.
 * Populated by predict (Stage01DataCollection) / cron via refreshLeagueProfileOverlays().
 *
 * Deliberately does NOT import MODEL_VERSION from modelConstants.js: modelConstants.js
 * imports getLeagueProfile from LeagueProfile.js, and LeagueProfile.js reads this
 * module's runtime cache — importing MODEL_VERSION here would cycle back through
 * LeagueProfile.js. Callers pass modelVersion explicitly instead.
 */

import { loadActiveLeagueOverlays, invalidateLeagueProfileOverlayCache } from "./leagueProfileOverlayStore.js";

let runtime = { modelVersion: null, byLeague: new Map(), loadedAt: 0 };

function overlaysEnabled() {
  if (typeof process === "undefined") return true;
  const raw = process.env?.LEAGUE_PROFILE_OVERLAY_ENABLED;
  if (raw === undefined || raw === "") return true;
  return !["0", "false", "off", "no"].includes(String(raw).toLowerCase());
}

export function getRuntimeLeagueOverlay(leagueId) {
  if (!overlaysEnabled()) return null;
  const id = Number(leagueId);
  if (!Number.isFinite(id)) return null;
  return runtime.byLeague.get(id) || null;
}

export function setRuntimeLeagueOverlays(byLeague, modelVersion = null) {
  runtime = {
    modelVersion: modelVersion || runtime.modelVersion,
    byLeague: byLeague || new Map(),
    loadedAt: Date.now()
  };
}

export async function refreshLeagueProfileOverlays(modelVersion) {
  if (!overlaysEnabled()) {
    setRuntimeLeagueOverlays(new Map(), modelVersion);
    return new Map();
  }
  const byLeague = await loadActiveLeagueOverlays(modelVersion);
  setRuntimeLeagueOverlays(byLeague, modelVersion);
  return byLeague;
}

export function clearRuntimeLeagueOverlays() {
  invalidateLeagueProfileOverlayCache();
  setRuntimeLeagueOverlays(new Map(), null);
}
