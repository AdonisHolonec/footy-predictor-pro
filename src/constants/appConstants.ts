/** UEFA Champions League league id (API-Football). */
export const CHAMPIONS_LEAGUE_ID = 2;
/** UEFA Europa League league id (API-Football). */
export const EUROPA_LEAGUE_ID = 3;

/**
 * Top leagues supported officially. Keep in sync with
 * `TOP_LEAGUE_IDS` from leagueProfiles.config.json / modelConstants.js.
 *
 * Order = default UI sort (core → UEFA → other).
 */
export const ELITE_LEAGUES: number[] = [
  39, // Premier League
  140, // La Liga
  135, // Serie A
  78, // Bundesliga
  61, // Ligue 1
  CHAMPIONS_LEAGUE_ID,
  EUROPA_LEAGUE_ID,
  848, // UEFA Conference League
  88, // Eredivisie
  283, // SuperLiga România
  253 // MLS
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
  { id: 283, name: "SuperLiga", country: "Romania" },
  { id: 253, name: "MLS", country: "USA" }
];

/**
 * Confidence (%) at or above which a recommendation counts as "high confidence".
 * Shared by the Home shortlist, the Home filter chips and the dashboard's
 * high-confidence toggle so the label, the count and the filter always agree.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 70;

export type FilterMode = "ALL" | "VALUE" | "SAFE" | "LOW";
export type SortBy = "TIME" | "CONFIDENCE" | "VALUE";
