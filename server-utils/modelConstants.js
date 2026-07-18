/**
 * Model constants + league params façade.
 * Per-league behaviour comes from League Profiles (configurable JSON) — not hardcoded here.
 */

import {
  resolveLeagueParams,
  getLeagueProfileSnapshot,
  listConfiguredLeagueIds
} from "./leagueProfiles/LeagueProfile.js";

/** Semantic version for calibration / A-B analysis (override via PREDICT_MODEL_VERSION). */
export const MODEL_VERSION = process.env.PREDICT_MODEL_VERSION || "v3-dc-bp-shin-2026-04";

/**
 * Canonical tracked league ids (from leagueProfiles.config.json).
 * Keep UI `ELITE_LEAGUES` aligned when adding competitions.
 */
export const TOP_LEAGUE_IDS = listConfiguredLeagueIds();

/** Snapshot of league params for a competition (profiles applied automatically). */
export function getLeagueParams(leagueId) {
  return resolveLeagueParams(leagueId);
}

/** Rate-only profile snapshot for API / UI / ML. */
export function getLeagueProfile(leagueId) {
  return getLeagueProfileSnapshot(leagueId);
}

export function getLeagueConfidenceMultiplier(leagueId) {
  return getLeagueParams(leagueId).confidenceMultiplier;
}

export function getLeagueStakeCap(leagueId) {
  return getLeagueParams(leagueId).stakeCap;
}

/**
 * Blend weight: env override > league profile > method heuristic.
 */
export function getModelMarketBlendWeight(method, leagueId = null) {
  const raw = process.env.MODEL_MARKET_BLEND_WEIGHT;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0.35, Math.min(0.92, n));
  }
  const base = getLeagueParams(leagueId).blendWeight;
  let adjusted = base;
  if (method === "strength-ratings" || method === "advanced-teamstats" || method === "modular-engine") {
    adjusted = base + 0.05;
  } else if (method === "standings") {
    adjusted = base - 0.08;
  }
  return Math.max(0.35, Math.min(0.9, adjusted));
}
