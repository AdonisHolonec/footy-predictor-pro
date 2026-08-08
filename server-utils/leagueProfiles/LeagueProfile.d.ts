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

export declare function loadLeagueProfilesConfig(...args: unknown[]): unknown;
export declare function invalidateLeagueProfilesCache(...args: unknown[]): unknown;
export declare function getLeagueProfile(...args: unknown[]): LeagueProfile;
export declare function getLeagueProfileSnapshot(...args: unknown[]): unknown;
export declare function resolveLeagueParams(...args: unknown[]): unknown;
export declare function profileToLeagueParams(...args: unknown[]): unknown;
export declare function rhoFromDrawFrequency(...args: unknown[]): number;
export declare function splitGoalAverages(...args: unknown[]): unknown;
export declare function listConfiguredLeagueIds(...args: unknown[]): unknown;
export declare function applyLeagueMarketPriors(...args: unknown[]): unknown;
export declare const PROFILE_RATE_KEYS: readonly string[];
