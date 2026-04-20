/** Semantic version for calibration / A-B analysis (override via PREDICT_MODEL_VERSION). */
export const MODEL_VERSION = process.env.PREDICT_MODEL_VERSION || "v3-dc-bp-shin-2026-04";

/**
 * Parametri per ligă, calibraţi empiric pe baza sezoanelor 2022-2024 (open data).
 * - leagueAvg: per-side (goluri/echipă/meci), ≈ total/2
 * - leagueAvgHome/Away: split pe venue când datele susţin diferenţa
 * - homeAdv / awayAdv: multiplicatori pe λ
 * - rho: parametrul Dixon-Coles low-score (negativ = draw-heavy)
 * - blendWeight: cât din λ rămâne la model faţă de piaţă (0..1)
 *
 * Ligi incluse: API-Football IDs standard.
 */
const LEAGUE_PARAMS = {
  // Premier League
  39:  { leagueAvg: 1.42, leagueAvgHome: 1.55, leagueAvgAway: 1.29, homeAdv: 1.08, awayAdv: 0.96, rho: -0.10, blendWeight: 0.65 },
  // La Liga
  140: { leagueAvg: 1.32, leagueAvgHome: 1.44, leagueAvgAway: 1.20, homeAdv: 1.09, awayAdv: 0.94, rho: -0.14, blendWeight: 0.65 },
  // Serie A
  135: { leagueAvg: 1.38, leagueAvgHome: 1.50, leagueAvgAway: 1.26, homeAdv: 1.07, awayAdv: 0.95, rho: -0.16, blendWeight: 0.63 },
  // Bundesliga
  78:  { leagueAvg: 1.54, leagueAvgHome: 1.67, leagueAvgAway: 1.41, homeAdv: 1.05, awayAdv: 0.97, rho: -0.07, blendWeight: 0.62 },
  // Ligue 1
  61:  { leagueAvg: 1.36, leagueAvgHome: 1.48, leagueAvgAway: 1.24, homeAdv: 1.08, awayAdv: 0.95, rho: -0.11, blendWeight: 0.63 },
  // Champions League (group+ko) — sample mai mic, piaţa are mai mult info
  2:   { leagueAvg: 1.40, leagueAvgHome: 1.48, leagueAvgAway: 1.32, homeAdv: 1.04, awayAdv: 0.97, rho: -0.09, blendWeight: 0.50 },
  // Europa League
  3:   { leagueAvg: 1.42, leagueAvgHome: 1.52, leagueAvgAway: 1.32, homeAdv: 1.05, awayAdv: 0.97, rho: -0.10, blendWeight: 0.52 },
  // Conference League
  848: { leagueAvg: 1.48, leagueAvgHome: 1.60, leagueAvgAway: 1.36, homeAdv: 1.06, awayAdv: 0.96, rho: -0.09, blendWeight: 0.55 },
  // Eredivisie (scoring)
  88:  { leagueAvg: 1.60, leagueAvgHome: 1.75, leagueAvgAway: 1.45, homeAdv: 1.08, awayAdv: 0.94, rho: -0.06, blendWeight: 0.60 },
  // Primeira Liga
  94:  { leagueAvg: 1.34, leagueAvgHome: 1.48, leagueAvgAway: 1.20, homeAdv: 1.10, awayAdv: 0.93, rho: -0.12, blendWeight: 0.58 },
  // Championship (home advantage ridicat, sample mare)
  40:  { leagueAvg: 1.28, leagueAvgHome: 1.40, leagueAvgAway: 1.16, homeAdv: 1.12, awayAdv: 0.92, rho: -0.10, blendWeight: 0.66 },
  // Süper Lig (Turcia)
  203: { leagueAvg: 1.52, leagueAvgHome: 1.68, leagueAvgAway: 1.36, homeAdv: 1.12, awayAdv: 0.90, rho: -0.08, blendWeight: 0.55 },
  // Liga Portugal 2
  95:  { leagueAvg: 1.24, leagueAvgHome: 1.36, leagueAvgAway: 1.12, homeAdv: 1.10, awayAdv: 0.93, rho: -0.12, blendWeight: 0.55 },
  // Liga Profesionistă România
  283: { leagueAvg: 1.32, leagueAvgHome: 1.44, leagueAvgAway: 1.20, homeAdv: 1.10, awayAdv: 0.93, rho: -0.11, blendWeight: 0.55 }
};

const DEFAULT_LEAGUE_PARAMS = {
  leagueAvg: 1.38,
  leagueAvgHome: 1.50,
  leagueAvgAway: 1.26,
  homeAdv: 1.07,
  awayAdv: 0.95,
  rho: -0.11,
  blendWeight: 0.60
};

/** Snapshot al parametrilor pentru o ligă (fallback default dacă nu e cunoscută). */
export function getLeagueParams(leagueId) {
  const id = Number(leagueId);
  const p = Number.isFinite(id) ? LEAGUE_PARAMS[id] : null;
  return { ...DEFAULT_LEAGUE_PARAMS, ...(p || {}), leagueId: Number.isFinite(id) ? id : null };
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
