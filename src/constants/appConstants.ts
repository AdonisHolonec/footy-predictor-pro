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

export const ELITE_LEAGUE_META: Array<{ id: number; name: string; country: string }> = [
  { id: 39, name: "Premier League", country: "England" },
  { id: 140, name: "La Liga", country: "Spain" },
  { id: 135, name: "Serie A", country: "Italy" },
  { id: 78, name: "Bundesliga", country: "Germany" },
  { id: 61, name: "Ligue 1", country: "France" },
  { id: 2, name: "UEFA Champions League", country: "Europe" },
  { id: 3, name: "UEFA Europa League", country: "Europe" },
  { id: 848, name: "UEFA Conference League", country: "Europe" },
  { id: 88, name: "Eredivisie", country: "Netherlands" },
  { id: 283, name: "SuperLiga", country: "Romania" }
];

export type FilterMode = "ALL" | "VALUE" | "SAFE" | "LOW";
export type SortBy = "TIME" | "CONFIDENCE" | "VALUE";
