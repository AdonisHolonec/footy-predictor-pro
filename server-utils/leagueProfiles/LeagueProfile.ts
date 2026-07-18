/** Typed mirror of LeagueProfile.js */

export interface LeagueProfileRates {
  goalFrequency: number;
  drawFrequency: number;
  cards: number;
  corners: number;
  homeAdvantage: number;
  bttsRate: number;
  overFrequency: number;
  possessionTendency: number;
}

export interface LeagueProfile extends LeagueProfileRates {
  key?: string;
  name: string;
  blendWeight?: number;
  confidenceMultiplier?: number;
  stakeCap?: number;
  sotAvgTotal?: number;
  shotsAvgTotal?: number;
  leagueId?: number | null;
  profileKey?: string;
  configVersion?: string;
  fromCatalog?: boolean;
}

export {
  loadLeagueProfilesConfig,
  invalidateLeagueProfilesCache,
  getLeagueProfile,
  getLeagueProfileSnapshot,
  resolveLeagueParams,
  profileToLeagueParams,
  rhoFromDrawFrequency,
  splitGoalAverages,
  listConfiguredLeagueIds,
  applyLeagueMarketPriors,
  PROFILE_RATE_KEYS
} from "./LeagueProfile.js";
