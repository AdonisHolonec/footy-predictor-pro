/**
 * Shared contracts for the modular PredictionEngine.
 * Every module exposes calculate() → ModuleResult.
 */

export interface ModuleResult {
  /** Multiplicative / relative score (typically ~1.0 centered). */
  score: number;
  /** Module self-confidence in [0, 1]. */
  confidence: number;
  /** Opaque diagnostics for audit / UI modularScores. */
  details: Record<string, unknown>;
}

/** Legacy alias kept for summarizeModuleScores / API payload shape. */
export interface ModuleScore {
  score: number;
  confidence?: number;
  detail?: Record<string, unknown>;
  details?: Record<string, unknown>;
  probs?: Record<string, number>;
  bestScore?: string;
  bestScoreProb?: number;
}

export interface TeamStats {
  gfHome: number;
  gaHome: number;
  gfAway: number;
  gaAway: number;
  played?: number;
  playedHome?: number;
  playedAway?: number;
}

export interface LeagueParams {
  leagueAvg?: number;
  leagueAvgGoals?: number;
  leagueAvgHome?: number;
  leagueAvgAway?: number;
  homeAdv?: number;
  awayAdv?: number;
  rho?: number;
}

export interface StandingsRow {
  all?: {
    played?: number;
    points?: number;
    goals?: { for?: number; against?: number };
  };
  team?: { id?: number | string };
  rank?: number;
}

export interface H2HFixture {
  goals?: { home?: number; away?: number };
  teams?: { home?: { id?: number | string }; away?: { id?: number | string } };
}

export interface RefereeStats {
  name?: string;
  avgGoals?: number;
  avgCards?: number;
  matches?: number;
}

export interface RecentMatch {
  goalsFor?: number;
  goalsAgainst?: number;
  date?: string;
}

export interface OddsTriple {
  home?: number;
  draw?: number;
  away?: number;
}

export interface InjuryEntry {
  teamId?: number | string;
  player?: string;
  type?: string;
  reason?: string;
}

export interface LineupInfo {
  confirmed?: boolean;
  formation?: string;
  missingKeyPlayers?: number;
}

export interface WeatherInfo {
  tempC?: number;
  windKmh?: number;
  precipMm?: number;
  condition?: string;
}

export interface PredictionContext {
  hStats: TeamStats;
  aStats: TeamStats;
  formHome?: string;
  formAway?: string;
  hFormMulti?: number;
  aFormMulti?: number;
  leagueParams?: LeagueParams;
  homeStandingsRow?: StandingsRow | null;
  awayStandingsRow?: StandingsRow | null;
  refereeName?: string;
  refereeStats?: RefereeStats | null;
  fixtureId?: number;
  fixtureDate?: string;
  homeTeamId?: number | string;
  awayTeamId?: number | string;
  h2hFixtures?: H2HFixture[];
  homeLastMatchDate?: string | null;
  awayLastMatchDate?: string | null;
  homeRecentMatches?: RecentMatch[];
  awayRecentMatches?: RecentMatch[];
  shrinkageK?: number;
  timeDecay?: number;
  /** Optional market odds (OddsEngine). */
  odds?: OddsTriple | null;
  /** Optional injuries list (InjuriesEngine). */
  injuries?: InjuryEntry[] | null;
  /** Optional lineups (LineupEngine). */
  homeLineup?: LineupInfo | null;
  awayLineup?: LineupInfo | null;
  /** Optional weather (WeatherEngine). */
  weather?: WeatherInfo | null;
  /** Motivation proxies (MotivationEngine). */
  homeMotivation?: number | null;
  awayMotivation?: number | null;
  /** Injected after λ combine for Poisson / xG / recommendation. */
  lambdaHome?: number;
  lambdaAway?: number;
  probs?: Record<string, number>;
}

export interface PredictionEngineResult {
  lambdaHome: number;
  lambdaAway: number;
  moduleScores: Record<string, ModuleScore>;
  method: string;
  probs?: Record<string, number>;
  bestScore?: string;
  bestScoreProb?: number;
  strengthMeta?: Record<string, unknown>;
  poissonMeta?: Record<string, unknown>;
}

export interface PredictionWeights {
  attack: number;
  defense: number;
  form: number;
  homeAdvantage: number;
  awayStrength: number;
  standings: number;
  h2h: number;
  referee: number;
  restDays: number;
  recentMatches: number;
  injuries: number;
  lineup: number;
  odds: number;
  motivation: number;
  weather: number;
  expectedGoals: number;
  poissonCorrelation: number;
  modularBlend: number;
}

export interface EngineModule {
  name: string;
  calculate(ctx: PredictionContext): ModuleResult;
}
