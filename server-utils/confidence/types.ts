/** Shared types for the independent Confidence Engine. */

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
  homeAdv?: number;
  awayAdv?: number;
}

export interface ConfidenceRecentMatch {
  goalsFor?: number;
  goalsAgainst?: number;
  date?: string;
}

export interface ConfidenceLineup {
  confirmed?: boolean;
  formation?: string;
  missingKeyPlayers?: number;
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
  homeRecentMatches?: ConfidenceRecentMatch[] | null;
  awayRecentMatches?: ConfidenceRecentMatch[] | null;
  refereeName?: string | null;
  refereeStats?: ConfidenceRefereeStats | null;
  injuriesHome?: number | null;
  injuriesAway?: number | null;
  injuries?: Array<{ teamId?: number | string }> | null;
  homeLineup?: ConfidenceLineup | null;
  awayLineup?: ConfidenceLineup | null;
  lineupsConfirmed?: boolean | null;
  bookmakersUsed?: number | null;
  shinZ?: number | null;
  hasOdds?: boolean;
  dataQuality?: number | null;
  homePlayed?: number | null;
  awayPlayed?: number | null;
  recommendedPick?: string | null;
  pick?: string | null;
  pickProb?: number | null;
  recommendedPickProb?: number | null;
}

export interface ConfidenceScores {
  attack: number;
  defense: number;
  form: number;
  recentMatches: number;
  standings: number;
  referee: number;
  injuries: number;
  lineups: number;
  restDays: number;
  homeAdvantage: number;
  oddsConsensus: number;
  h2h: number;
}

export type ConfidenceCategory = "Very High" | "High" | "Medium" | "Low" | "Very Low";

export type ConfidenceAvailability = Record<keyof ConfidenceScores, boolean>;

export interface ConfidenceEngineResult {
  /** Alias of overall (0–100). */
  confidence: number;
  overall: number;
  category: ConfidenceCategory;
  scores: ConfidenceScores;
  available: ConfidenceAvailability;
  weights: ConfidenceScores;
  explanation: string[];
  /** Single-paragraph summary. */
  why?: string;
  /** Recommendation-specific WHY lines. */
  recommendationWhy?: string[];
}
