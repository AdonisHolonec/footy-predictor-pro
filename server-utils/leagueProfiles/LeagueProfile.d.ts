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

export declare function loadLeagueProfilesConfig(...args: any[]): any;
export declare function invalidateLeagueProfilesCache(...args: any[]): any;
export declare function getLeagueProfile(...args: any[]): LeagueProfile;
export declare function getLeagueProfileSnapshot(...args: any[]): any;
export declare function resolveLeagueParams(...args: any[]): any;
export declare function profileToLeagueParams(...args: any[]): any;
export declare function rhoFromDrawFrequency(...args: any[]): number;
export declare function splitGoalAverages(...args: any[]): any;
export declare function listConfiguredLeagueIds(...args: any[]): any;
export declare function applyLeagueMarketPriors(...args: any[]): any;
export declare const PROFILE_RATE_KEYS: readonly string[];
