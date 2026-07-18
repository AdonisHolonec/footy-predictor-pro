/** Shared types for the independent Confidence Engine (typed mirror, not imported at runtime). */

export interface ConfidenceTeamStats {
  gfHome?: number;
  gaHome?: number;
  gfAway?: number;
  gaAway?: number;
  played?: number;
  playedHome?: number;
  playedAway?: number;
}

export interface ConfidenceStandingsRow {
  all?: { played?: number; points?: number; goals?: { for?: number; against?: number } };
  played?: number;
  points?: number;
  team?: { id?: number | string };
}

export interface ConfidenceH2HFixture {
  goals?: { home?: number; away?: number };
  teams?: { home?: { id?: number | string }; away?: { id?: number | string } };
}

export interface ConfidenceRefereeStats {
  name?: string;
  avgGoals?: number;
  avgCards?: number;
  matches?: number;
}

export interface ConfidenceLeagueParams {
  leagueAvg?: number;
  leagueAvgGoals?: number;
  leagueAvgHome?: number;
  leagueAvgAway?: number;
}

export interface ConfidenceContext {
  hStats?: ConfidenceTeamStats | null;
  aStats?: ConfidenceTeamStats | null;
  formHome?: string | null;
  formAway?: string | null;
  hFormMulti?: number | null;
  aFormMulti?: number | null;
  leagueParams?: ConfidenceLeagueParams;
  homeStandingsRow?: ConfidenceStandingsRow | null;
  awayStandingsRow?: ConfidenceStandingsRow | null;
  h2hFixtures?: ConfidenceH2HFixture[] | null;
  homeTeamId?: number | string;
  awayTeamId?: number | string;
  restDaysHome?: number | null;
  restDaysAway?: number | null;
  fixtureDate?: string;
  homeLastMatchDate?: string | null;
  awayLastMatchDate?: string | null;
  refereeName?: string | null;
  refereeStats?: ConfidenceRefereeStats | null;
  injuriesHome?: number | null;
  injuriesAway?: number | null;
  bookmakersUsed?: number | null;
  shinZ?: number | null;
  hasOdds?: boolean;
  dataQuality?: number | null;
  homePlayed?: number | null;
  awayPlayed?: number | null;
  modularScores?: Record<string, unknown> | null;
}

export interface ConfidenceScores {
  attack: number;
  defense: number;
  form: number;
  standings: number;
  h2h: number;
  restDays: number;
  referee: number;
  injuries: number;
  oddsConsensus: number;
  teamStatistics: number;
}

export type ConfidenceAvailability = Record<keyof ConfidenceScores, boolean>;

export interface ConfidenceEngineResult {
  overall: number;
  scores: ConfidenceScores;
  available: ConfidenceAvailability;
  weights: ConfidenceScores;
  explanation: string[];
}
