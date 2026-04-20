/**
 * Top 10 ligi suportate oficial. Trebuie să rămână sincronizat cu
 * `TOP_LEAGUE_IDS` din `server-utils/modelConstants.js`.
 *
 * Ordinea e cea folosită la sortarea implicită în UI (core → UEFA → naţionale).
 */
export const ELITE_LEAGUES: number[] = [
  39,   // Premier League
  140,  // La Liga
  135,  // Serie A
  78,   // Bundesliga
  61,   // Ligue 1
  2,    // UEFA Champions League
  3,    // UEFA Europa League
  848,  // UEFA Conference League
  88,   // Eredivisie
  283   // SuperLiga România
];

export type FilterMode = "ALL" | "VALUE" | "SAFE" | "LOW";
export type SortBy = "TIME" | "CONFIDENCE" | "VALUE";
