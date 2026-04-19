export type Usage = { date: string; count: number; limit: number };

export type League = {
  id: number;
  name: string;
  country: string;
  matches: number;
  logo?: string;
};

export type Odds = { home: number; draw: number; away: number; bookmaker?: string };
export type ValueBet = {
  detected: boolean;
  type: string;
  ev?: number;
  kelly?: number;
  stakePlan?: string;
  ensemble?: {
    baseKelly: number;
    confidenceBoost: number;
    volatilityPenalty: number;
    evBoost: number;
  };
  reasons?: string[];
};

export type Probs = {
  p1: number;
  pX: number;
  p2: number;
  pGG: number;
  pO25: number;
  pU35: number;
  pO15: number;
  /** Șansă dublă 1 sau X (model). */
  pDC1X?: number;
  /** Șansă dublă 1 sau 2. */
  pDC12?: number;
  /** Șansă dublă X sau 2. */
  pDCX2?: number;
  /** Sub 1.5 goluri (complement față de peste 1.5). */
  pU15?: number;
  /** Fără ambele marchează (complement GG). */
  pNGG?: number;
  /** Sub 2.5 goluri (complement peste 2.5). */
  pU25?: number;
};

/** Clasament + mini-formă (API standings / teams statistics). */
export type TeamStandingsFormSnapshot = {
  teamId?: number;
  rank: number | null;
  points: number | null;
  played: number | null;
  /** Ultimele caractere W/D/L din API (ex. "WDLWD"). */
  form: string | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  goalsDiff?: number | null;
};

export type MatchTeamContext = {
  home?: TeamStandingsFormSnapshot | null;
  away?: TeamStandingsFormSnapshot | null;
};

/** Rând din clasament (ligă) pentru afișare în modal. */
export type LeagueStandingEntry = {
  rank: number | null;
  teamId: number;
  teamName: string;
  logo?: string;
  played: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalsDiff: number | null;
  form: string | null;
};

export type MatchScore = { home: number | null; away: number | null };

export type PredictionRow = {
  id: number;
  leagueId: number;
  league: string;
  teams: { home: string; away: string };
  /** ID-uri echipe (pentru evidențiere în clasament). */
  fixtureTeamIds?: { home?: number; away?: number };
  logos?: { league?: string; home?: string; away?: string };
  kickoff: string;
  status: string;
  score?: MatchScore;
  referee?: string;
  lambdas?: { home: number; away: number };
  luckStats?: { hG: number; hXG: number; aG: number; aXG: number; intensityNote?: string };
  /** Clasament + formă din API (nu afectează λ dacă lipsește). */
  teamContext?: MatchTeamContext;
  /** Clasament complet ligă (aceeași listă pe fiecare meci din ligă). */
  leagueStandings?: LeagueStandingEntry[];
  probs: Probs;
  odds?: Odds & { bookmakersUsed?: number };
  valueBet?: ValueBet;
  predictions: { oneXtwo: string; gg: string; over25: string; cards?: string; correctScore: string };
  recommended: { pick: string; confidence: number };
  insufficientData?: boolean;
  insufficientReason?: string;
  modelVersion?: string;
  evaluation?: {
    recommendedTrack?: string;
    valueBetTrack?: string;
    modelProbs1x2Pct?: { p1: number; pX: number; p2: number };
    recommended1x2?: string;
    modelVersion?: string;
    marketBlendWeight?: number;
  };
  modelMeta?: {
    method?: string;
    probsModel?: string;
    dataQuality?: number;
    leagueMultiplier?: number;
    driftPenalty?: number;
    cooldownCap?: number;
    stakeBucket?: string;
    stakeCap?: number;
    reasonCodes?: string[];
    modelVersion?: string;
    gridMax?: number;
    massCaptured?: number;
  };
};

export type HistoryEntry = PredictionRow & {
  savedAt: string;
  validation: "pending" | "win" | "loss";
};

export type HistoryStats = {
  wins: number;
  losses: number;
  settled: number;
  winRate: number;
};

/** Per-league settled/pending counts (global or scoped). */
export type PerformanceLeagueBreakdown = {
  leagueId: number;
  leagueName: string;
  wins: number;
  losses: number;
  pending: number;
  settled: number;
  winRate: number;
};

export type PerformanceUserBreakdown = {
  userId: string;
  /** Filled by `/api/history?performance=1` (auth email). */
  email?: string | null;
  wins: number;
  losses: number;
  pending: number;
  settled: number;
  winRate: number;
};

export type PerformanceUserLeagueBreakdown = PerformanceLeagueBreakdown & {
  userId: string;
  email?: string | null;
};

export type DayResponse = {
  ok: boolean;
  date: string;
  totalFixtures: number;
  leagues: League[];
  usage: Usage;
};

export type XGData = {
  homeXG: number;
  awayXG: number;
};

export type BacktestKpi = {
  date: string;
  settled: number;
  hitRate: number;
  roi: number;
  drawdown: number;
  pnlUnits: number;
};

export type RiskAlert = {
  id: "drawdown" | "drift" | "low_data_quality" | string;
  level: "high" | "medium" | "low";
  message: string;
  value: number;
};

export type User = {
  id: string;
  email: string;
  role: "user" | "admin";
  favoriteLeagues: number[];
  isBlocked?: boolean;
  onboardingCompleted?: boolean;
  notificationPrefs?: {
    safe: boolean;
    value: boolean;
    email: boolean;
  };
  /** ISO timestamp when user consented to email notifications (GDPR). */
  emailNotificationsConsentedAt?: string | null;
};
