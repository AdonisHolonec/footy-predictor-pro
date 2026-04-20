/** Semantic version for calibration / A-B analysis (override via PREDICT_MODEL_VERSION). */
export const MODEL_VERSION = process.env.PREDICT_MODEL_VERSION || "v3-dc-bp-shin-2026-04";

/**
 * Sursa unică de adevăr pentru ligile pe care le tracăm.
 * Ordine = prioritate (primele 5 sunt core, urmează UEFA comps, restul naţionale).
 *
 * Câmpuri per ligă:
 * - leagueAvg / leagueAvgHome / leagueAvgAway: goluri/echipă/meci
 * - homeAdv / awayAdv: multiplicatori pe λ (1.0 = neutru)
 * - rho: parametrul Dixon-Coles low-score (negativ = draw-heavy)
 * - blendWeight: pondere model vs. piaţă (0..1, mai mare = mai mult model)
 * - confidenceMultiplier: penalty aplicat confidence-ului top pick (ligi mai slabe = mai mic)
 * - stakeCap: plafon stake max pentru liga asta (pp 0-3)
 * - name: etichetă pentru debug / UI
 */
const LEAGUE_PARAMS = {
  // ---- TOP 5 EUROPEAN DOMESTIC ----
  39: {
    name: "Premier League",
    leagueAvg: 1.42, leagueAvgHome: 1.55, leagueAvgAway: 1.29,
    homeAdv: 1.08, awayAdv: 0.96, rho: -0.10, blendWeight: 0.65,
    confidenceMultiplier: 1.00, stakeCap: 3.0
  },
  140: {
    name: "La Liga",
    leagueAvg: 1.32, leagueAvgHome: 1.44, leagueAvgAway: 1.20,
    homeAdv: 1.09, awayAdv: 0.94, rho: -0.14, blendWeight: 0.65,
    confidenceMultiplier: 0.98, stakeCap: 2.8
  },
  135: {
    name: "Serie A",
    leagueAvg: 1.38, leagueAvgHome: 1.50, leagueAvgAway: 1.26,
    homeAdv: 1.07, awayAdv: 0.95, rho: -0.16, blendWeight: 0.63,
    confidenceMultiplier: 0.97, stakeCap: 2.7
  },
  78: {
    name: "Bundesliga",
    leagueAvg: 1.54, leagueAvgHome: 1.67, leagueAvgAway: 1.41,
    homeAdv: 1.05, awayAdv: 0.97, rho: -0.07, blendWeight: 0.62,
    confidenceMultiplier: 0.95, stakeCap: 2.5
  },
  61: {
    name: "Ligue 1",
    leagueAvg: 1.36, leagueAvgHome: 1.48, leagueAvgAway: 1.24,
    homeAdv: 1.08, awayAdv: 0.95, rho: -0.11, blendWeight: 0.63,
    confidenceMultiplier: 0.95, stakeCap: 2.5
  },

  // ---- UEFA COMPETITIONS ----
  2: {
    name: "Champions League",
    // sample mai mic, piaţa are info pe care modelul n-o vede (lineup leaks) → blend scăzut
    leagueAvg: 1.40, leagueAvgHome: 1.48, leagueAvgAway: 1.32,
    homeAdv: 1.04, awayAdv: 0.97, rho: -0.09, blendWeight: 0.50,
    confidenceMultiplier: 0.93, stakeCap: 2.2
  },
  3: {
    name: "Europa League",
    leagueAvg: 1.42, leagueAvgHome: 1.52, leagueAvgAway: 1.32,
    homeAdv: 1.05, awayAdv: 0.97, rho: -0.10, blendWeight: 0.52,
    confidenceMultiplier: 0.93, stakeCap: 2.2
  },
  848: {
    name: "Conference League",
    leagueAvg: 1.48, leagueAvgHome: 1.60, leagueAvgAway: 1.36,
    homeAdv: 1.06, awayAdv: 0.96, rho: -0.09, blendWeight: 0.55,
    confidenceMultiplier: 0.91, stakeCap: 2.1
  },

  // ---- OTHER DOMESTIC ----
  88: {
    name: "Eredivisie",
    leagueAvg: 1.60, leagueAvgHome: 1.75, leagueAvgAway: 1.45,
    homeAdv: 1.08, awayAdv: 0.94, rho: -0.06, blendWeight: 0.60,
    confidenceMultiplier: 0.92, stakeCap: 2.3
  },
  283: {
    name: "SuperLiga România",
    leagueAvg: 1.32, leagueAvgHome: 1.44, leagueAvgAway: 1.20,
    homeAdv: 1.10, awayAdv: 0.93, rho: -0.11, blendWeight: 0.55,
    confidenceMultiplier: 0.90, stakeCap: 2.0
  }
};

const DEFAULT_LEAGUE_PARAMS = {
  name: "Unknown",
  leagueAvg: 1.38,
  leagueAvgHome: 1.50,
  leagueAvgAway: 1.26,
  homeAdv: 1.07,
  awayAdv: 0.95,
  rho: -0.11,
  blendWeight: 0.60,
  confidenceMultiplier: 0.88,
  stakeCap: 1.9
};

/**
 * TOP_LEAGUE_IDS — lista canonică folosită ca fallback în prewarm / cron / warm-predict
 * şi aliniată cu ELITE_LEAGUES din src/constants/appConstants.ts pentru UI.
 */
export const TOP_LEAGUE_IDS = Object.keys(LEAGUE_PARAMS).map(Number);

/** Snapshot al parametrilor pentru o ligă (fallback default dacă nu e cunoscută). */
export function getLeagueParams(leagueId) {
  const id = Number(leagueId);
  const p = Number.isFinite(id) ? LEAGUE_PARAMS[id] : null;
  return { ...DEFAULT_LEAGUE_PARAMS, ...(p || {}), leagueId: Number.isFinite(id) ? id : null };
}

export function getLeagueConfidenceMultiplier(leagueId) {
  return getLeagueParams(leagueId).confidenceMultiplier;
}

export function getLeagueStakeCap(leagueId) {
  return getLeagueParams(leagueId).stakeCap;
}

/**
 * Blend weight learn-to-configure: env override > league-specific > method-heuristic > default.
 * `method` poate modifica blendWeight: advanced/strength-ratings → mai mult la model; standings → mai mult la piaţă.
 */
export function getModelMarketBlendWeight(method, leagueId = null) {
  const raw = process.env.MODEL_MARKET_BLEND_WEIGHT;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0.35, Math.min(0.92, n));
  }
  const base = getLeagueParams(leagueId).blendWeight;
  let adjusted = base;
  if (method === "strength-ratings" || method === "advanced-teamstats") adjusted = base + 0.05;
  else if (method === "standings") adjusted = base - 0.08;
  return Math.max(0.35, Math.min(0.9, adjusted));
}
