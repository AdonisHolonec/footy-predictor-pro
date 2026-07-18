/** Shared types for the modular prediction engine. */

export interface ModuleScore {
  score: number;
  detail?: Record<string, unknown>;
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
  standings: number;
  h2h: number;
  referee: number;
  restDays: number;
  recentMatches: number;
  poissonCorrelation: number;
  modularBlend: number;
}
