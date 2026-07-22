/**
 * League Profiles — configurable competition behaviour.
 * All numeric values come from leagueProfiles.config.json (or env overrides).
 * Application code must not hardcode per-league rates.
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getRuntimeLeagueOverlay } from "./leagueProfileOverlayRuntime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, "leagueProfiles.config.json");

const PROFILE_RATE_KEYS = [
  "goalFrequency",
  "drawFrequency",
  "cards",
  "corners",
  "homeAdvantage",
  "bttsRate",
  "overFrequency",
  "possessionTendency"
];

let cached = { loadedAt: 0, config: null };

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function loadJsonFile(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

/**
 * Load config: LEAGUE_PROFILES_JSON > LEAGUE_PROFILES_PATH > bundled JSON.
 */
export function loadLeagueProfilesConfig(force = false) {
  const now = Date.now();
  if (!force && cached.config && now - cached.loadedAt < 30_000) return cached.config;

  let config = null;
  const inline = typeof process !== "undefined" ? process.env?.LEAGUE_PROFILES_JSON : undefined;
  if (inline && String(inline).trim()) {
    config = JSON.parse(inline);
  } else {
    const path =
      (typeof process !== "undefined" && process.env?.LEAGUE_PROFILES_PATH) || DEFAULT_CONFIG_PATH;
    if (!existsSync(path)) {
      throw new Error(`League profiles config missing at ${path}`);
    }
    config = loadJsonFile(path);
  }

  if (!config?.default || !config?.leagues) {
    throw new Error("League profiles config must include default + leagues");
  }

  cached = { loadedAt: now, config };
  return config;
}

export function invalidateLeagueProfilesCache() {
  cached = { loadedAt: 0, config: null };
}

function mergeProfile(base, overlay) {
  return { ...base, ...(overlay || {}) };
}

/**
 * Resolve raw profile rates for a league id (config only, no derivation).
 */
export function getLeagueProfile(leagueId) {
  const config = loadLeagueProfilesConfig();
  const id = Number(leagueId);
  const key = Number.isFinite(id) ? String(id) : null;
  const specific = key && config.leagues[key] ? config.leagues[key] : null;
  const profile = mergeProfile(config.default, specific);

  // Recalibration overlay (fitted nightly from settled results, server-utils/leagueProfiles/
  // computeLeagueProfileRecalibration.js) — blends toward the static baseline above within a
  // hard max-delta budget. Read from the already-warmed process-local cache only; never
  // touches Supabase here. The env override below still wins as the manual escape hatch.
  const overlay = key ? getRuntimeLeagueOverlay(id) : null;
  if (overlay?.values) {
    const baseDelta = clamp(num(process.env?.LEAGUE_PROFILE_OVERLAY_MAX_DELTA, 0.06) ?? 0.06, 0, 0.25);
    for (const field of ["overFrequency", "bttsRate", "drawFrequency", "homeAdvantage"]) {
      const ov = num(overlay.values[field], null);
      const staticValue = num(profile[field], null);
      if (ov != null && staticValue != null) {
        profile[field] = clamp(ov, staticValue - baseDelta, staticValue + baseDelta);
      }
    }
    const ovGoal = num(overlay.values.goalFrequency, null);
    const staticGoal = num(profile.goalFrequency, null);
    if (ovGoal != null && staticGoal != null) {
      const goalDelta = baseDelta * staticGoal;
      profile.goalFrequency = clamp(ovGoal, staticGoal - goalDelta, staticGoal + goalDelta);
    }
  }

  // Optional per-league env overlay: LEAGUE_PROFILE_39_JSON='{"homeAdvantage":1.1}'
  if (key && typeof process !== "undefined") {
    const envKey = `LEAGUE_PROFILE_${key}_JSON`;
    const raw = process.env?.[envKey];
    if (raw && String(raw).trim()) {
      try {
        Object.assign(profile, JSON.parse(raw));
      } catch {
        /* ignore bad overlay */
      }
    }
  }

  return {
    ...profile,
    leagueId: Number.isFinite(id) ? id : null,
    profileKey: profile.key || (specific ? specific.key : "default"),
    configVersion: config.version || "lp-v1",
    fromCatalog: Boolean(specific)
  };
}

/**
 * Derive Dixon–Coles ρ from draw frequency (config-driven, not hardcoded per league).
 * Higher drawFrequency → more negative ρ.
 */
export function rhoFromDrawFrequency(drawFrequency) {
  const d = clamp(num(drawFrequency, 0.26) ?? 0.26, 0.12, 0.4);
  // Anchor: ~0.25 draws → ρ ≈ -0.11
  return clamp(-0.05 - (d - 0.22) * 0.55, -0.22, -0.04);
}

/**
 * Split total goal frequency into home/away team averages using home advantage + possession tendency.
 */
export function splitGoalAverages(profile) {
  const total = Math.max(1.6, num(profile.goalFrequency, 2.76) ?? 2.76);
  const homeAdv = clamp(num(profile.homeAdvantage, 1.07) ?? 1.07, 0.95, 1.25);
  const poss = clamp(num(profile.possessionTendency, 0.51) ?? 0.51, 0.4, 0.65);
  // Share of goals for home side
  const homeShare = clamp(0.5 + (homeAdv - 1) * 0.9 + (poss - 0.5) * 0.35, 0.48, 0.62);
  const leagueAvgHome = (total * homeShare);
  const leagueAvgAway = total - leagueAvgHome;
  const leagueAvg = total / 2;
  return { leagueAvg, leagueAvgHome, leagueAvgAway, goalsPerMatch: total };
}

/**
 * Map a League Profile → legacy leagueParams shape used by predict / engines.
 */
export function profileToLeagueParams(profile) {
  const { leagueAvg, leagueAvgHome, leagueAvgAway, goalsPerMatch } = splitGoalAverages(profile);
  const homeAdv = clamp(num(profile.homeAdvantage, 1.07) ?? 1.07, 0.95, 1.25);
  const awayAdv = clamp(2 - homeAdv + (0.5 - (num(profile.possessionTendency, 0.51) ?? 0.51)) * 0.04, 0.88, 1.05);
  const rho = rhoFromDrawFrequency(profile.drawFrequency);

  return {
    name: profile.name || "Unknown",
    leagueId: profile.leagueId,
    profileKey: profile.profileKey,
    configVersion: profile.configVersion,
    fromCatalog: profile.fromCatalog,
    // Legacy predict fields
    leagueAvg,
    leagueAvgHome,
    leagueAvgAway,
    homeAdv,
    awayAdv,
    rho,
    blendWeight: clamp(num(profile.blendWeight, 0.6) ?? 0.6, 0.35, 0.92),
    confidenceMultiplier: clamp(num(profile.confidenceMultiplier, 0.88) ?? 0.88, 0.75, 1.05),
    stakeCap: clamp(num(profile.stakeCap, 1.9) ?? 1.9, 0.5, 5),
    cornersAvgTotal: Math.max(6, num(profile.corners, 10) ?? 10),
    sotAvgTotal: Math.max(5, num(profile.sotAvgTotal, 8.6) ?? 8.6),
    shotsAvgTotal: Math.max(12, num(profile.shotsAvgTotal, null) ?? (num(profile.sotAvgTotal, 8.6) ?? 8.6) * 2.3),
    cardsAvgTotal: Math.max(2, num(profile.cards, 4.2) ?? 4.2),
    // Profile rates (for markets / explanation / ML)
    goalFrequency: goalsPerMatch,
    drawFrequency: clamp(num(profile.drawFrequency, 0.26) ?? 0.26, 0.1, 0.45),
    bttsRate: clamp(num(profile.bttsRate, 0.5) ?? 0.5, 0.25, 0.75),
    overFrequency: clamp(num(profile.overFrequency, 0.52) ?? 0.52, 0.25, 0.8),
    possessionTendency: clamp(num(profile.possessionTendency, 0.51) ?? 0.51, 0.4, 0.65),
    cards: Math.max(2, num(profile.cards, 4.2) ?? 4.2),
    corners: Math.max(6, num(profile.corners, 10) ?? 10)
  };
}

/** Public resolver used by modelConstants / predict. */
export function resolveLeagueParams(leagueId) {
  const profile = getLeagueProfile(leagueId);
  return profileToLeagueParams(profile);
}

/** Compact profile snapshot for API / UI (rates only). */
export function getLeagueProfileSnapshot(leagueId) {
  const p = getLeagueProfile(leagueId);
  const rates = {};
  for (const k of PROFILE_RATE_KEYS) rates[k] = num(p[k]);
  return {
    leagueId: p.leagueId,
    key: p.profileKey,
    name: p.name,
    configVersion: p.configVersion,
    fromCatalog: p.fromCatalog,
    rates
  };
}

export function listConfiguredLeagueIds() {
  const config = loadLeagueProfilesConfig();
  return Object.keys(config.leagues || {})
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/**
 * Soft-blend O/U and BTTS probs toward league profile rates.
 * Weight from LEAGUE_PROFILE_MARKET_BLEND (default 0.12). Does not invent rates.
 */
export function applyLeagueMarketPriors(probs, leagueParams, blendWeight = null) {
  if (!probs || !leagueParams) return probs;
  const envW =
    typeof process !== "undefined" && process.env?.LEAGUE_PROFILE_MARKET_BLEND !== undefined
      ? Number(process.env.LEAGUE_PROFILE_MARKET_BLEND)
      : null;
  const w = clamp(num(blendWeight, num(envW, 0.12)) ?? 0.12, 0, 0.35);
  if (w <= 0) return probs;

  const out = { ...probs };
  const overPrior = (num(leagueParams.overFrequency, null) ?? 0.52) * 100;
  const bttsPrior = (num(leagueParams.bttsRate, null) ?? 0.5) * 100;
  const drawPrior = (num(leagueParams.drawFrequency, null) ?? 0.26) * 100;

  if (Number.isFinite(out.pO25)) {
    out.pO25 = clampPct((1 - w) * out.pO25 + w * overPrior);
    out.pU25 = clampPct(100 - out.pO25);
  }
  if (Number.isFinite(out.pGG)) {
    out.pGG = clampPct((1 - w) * out.pGG + w * bttsPrior);
    out.pNGG = clampPct(100 - out.pGG);
  }
  // Mild draw prior on 1X2 (keeps sum ≈ 100)
  if (Number.isFinite(out.p1) && Number.isFinite(out.pX) && Number.isFinite(out.p2)) {
    const drawW = w * 0.5;
    const pX2 = (1 - drawW) * out.pX + drawW * drawPrior;
    const rest = 100 - pX2;
    const side = out.p1 + out.p2;
    if (side > 0) {
      out.pX = clampPct(pX2);
      out.p1 = clampPct((out.p1 / side) * rest);
      out.p2 = clampPct((out.p2 / side) * rest);
    }
  }
  return out;
}

function clampPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}

export { PROFILE_RATE_KEYS, DEFAULT_CONFIG_PATH };
