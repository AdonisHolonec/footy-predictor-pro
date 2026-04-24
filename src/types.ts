export type Usage = { date: string; count: number; limit: number };
export type UserTier = "free" | "premium" | "ultra";

export type League = {
  id: number;
  name: string;
  country: string;
  matches: number;
  logo?: string;
};

export type Odds = {
  home: number;
  draw: number;
  away: number;
  bookmaker?: string;
  bookmakersUsed?: number;
  /** Metodă eliminare marjă: "shin" (long-shot bias corectat) sau "proportional" (fallback). */
  marginMethod?: "shin" | "proportional";
  /** Factor Shin z ∈ [0, ~0.1] = fracţia estimată de insider trading. */
  shinZ?: number;
};

export type EnsembleStakeBreakdown = {
  baseKelly: number;
  adjustment?: number;
  confScore?: number;
  evScore?: number;
  dqScore?: number;
  gapPenalty?: number;
  volPenalty?: number;
  /** Legacy (v2 ensemble). */
  confidenceBoost?: number;
  volatilityPenalty?: number;
  evBoost?: number;
};

export type ValueBet = {
  detected: boolean;
  type: string;
  ev?: number;
  kelly?: number;
  stakePlan?: string;
  ensemble?: EnsembleStakeBreakdown;
  reasons?: string[];
};

/**
 * Probabilităţi Poisson pe piaţă cu linii Over/Under (ex: cornere, şuturi).
 * Cheile din `total`/`home`/`away` folosesc format "oX_Y" pentru linia X.Y (ex: "o8_5" = Over 8.5).
 */
export type PoissonMarketProbs = {
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  expectedTotal: number;
  mostProbableTotal: number;
  mostProbableHome: number;
  mostProbableAway: number;
  /** Over X.5 total (ex. { o8_5: 62.3, o9_5: 48.1 } cu procentaje). */
  total: Record<string, number>;
  home: Record<string, number>;
  away: Record<string, number>;
  sampleHome?: number;
  sampleAway?: number;
  usedFallback?: boolean;
  leagueBaseline?: number;
};

/** Probabilităţi prima repriză (min 0-45), derivate din acelaşi model cu λ scalate. */
export type FirstHalfProbs = {
  p1: number;
  pX: number;
  p2: number;
  pGG: number;
  /** Peste 0.5 goluri FH (probabilitate macă un gol să cadă în prima repriză). */
  pO05: number;
  pO15: number;
  pO25: number;
  bestScore: string;
  bestScoreProb: number;
};

export type Probs = {
  p1: number;
  pX: number;
  p2: number;
  pGG: number;
  pO25: number;
  pU35: number;
  pO15: number;
  /** Peste 0.5 goluri total (expus pentru pieţe derivate). */
  pO05?: number;
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
  /** Bloc pentru prima repriză (populat când /teams/statistics expune bucketele de minute). */
  firstHalf?: FirstHalfProbs;
  /** Cornere (derivate din rolling stats team_market_rolling). */
  corners?: PoissonMarketProbs;
  /** Şuturi la poartă. */
  shotsOnTarget?: PoissonMarketProbs;
  /** Total şuturi (on + off target). */
  shotsTotal?: PoissonMarketProbs;
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

export type MarketOddQuote = {
  pick: string;
  line?: number | null;
  odd: number | null;
  bookmaker?: string | null;
  bookmakersUsed?: number;
};

/** Nivel de încredere semantic pentru o piaţă, folosit în UI pentru culoare/badge. */
export type MarketTier = "strong" | "lean" | "toss" | "lean_off" | "strong_off";

export type MarketTierInfo = {
  /** Eticheta afişată (ex. "GG", "Sub 2.5", "1", "2-1"). */
  pick: string;
  /** Probabilitatea asociată lui `pick` (în %). */
  prob: number;
  tier: MarketTier;
};

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
  marketOdds?: {
    goals15?: MarketOddQuote;
    goals25?: MarketOddQuote;
    goals35?: MarketOddQuote;
    btts?: MarketOddQuote;
    corners?: MarketOddQuote;
    shotsOnTarget?: MarketOddQuote;
    shotsTotal?: MarketOddQuote;
    firstHalfGoals?: MarketOddQuote;
  };
  predictions: {
    oneXtwo: string;
    gg: string;
    over25: string;
    cards?: string;
    correctScore: string;
    /** Tiered confidence per piaţă, pentru ca UI-ul să marcheze "Nesigur" când probabilitatea e ≈50%. */
    marketTiers?: {
      oneXtwo?: MarketTierInfo;
      gg?: MarketTierInfo;
      over25?: MarketTierInfo;
      correctScore?: MarketTierInfo;
    };
  };
  recommended: {
    pick: string;
    confidence: number | null;
    confidenceCategory?: string | null;
    odd?: number | null;
    oddSource?: string | null;
    bookmakersUsed?: number;
  };
  insufficientData?: boolean;
  insufficientReason?: string;
  modelVersion?: string;
  evaluation?: {
    recommendedTrack?: string;
    valueBetTrack?: string;
    modelProbs1x2Pct?: { p1: number; pX: number; p2: number };
    /** Raw probabilităţi Poisson/DC înainte de calibrare şi stacker. */
    rawPoissonProbs1x2Pct?: { p1: number; pX: number; p2: number };
    /** Probabilităţi după isotonic calibration (dacă aplicată). */
    calibratedProbs1x2Pct?: { p1: number; pX: number; p2: number };
    /** Output stacker ML (dacă aplicat). */
    stackerProbs1x2Pct?: { p1: number; pX: number; p2: number };
    recommended1x2?: string;
    modelVersion?: string;
    marketBlendWeight?: number;
    stackerApplied?: boolean;
    calibrationApplied?: boolean;
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
    /** Parametri specifici ligii (DC rho, home advantage, etc.). */
    leagueParams?: {
      leagueAvg?: number;
      homeAdv?: number;
      awayAdv?: number;
      rho?: number;
      blendWeight?: number;
    };
    strengthMeta?: {
      atkH?: number;
      defH?: number;
      atkA?: number;
      defA?: number;
      homePlayed?: number | null;
      awayPlayed?: number | null;
      shrinkageK?: number;
    };
    /** Cât de mult probabilitatea pick-ului recomandat depăşeşte baseline-ul pieţei (pp). */
    topPickLift?: number;
    /** Alternative considerate (sortate după scorul lift-adjusted, excluzând pick-ul ales). */
    topPickAlternates?: Array<{ pick: string; prob: number; lift: number }>;
    calibrationApplied?: boolean;
    stackerApplied?: boolean;
    stackerSampleSize?: number | null;
    calibrationSampleSize?: number | null;
    elo?: {
      home: number;
      away: number;
      spread: number;
      thin?: boolean;
    };
    eloSpread?: number;
    /** Metadate pentru secţiunea "Prima repriză" (λ FH + scale factors per echipă). */
    firstHalf?: {
      lambdaHome: number;
      lambdaAway: number;
      scaleHome: number;
      scaleAway: number;
      baselineUsed?: boolean;
    };
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
  tierStatus?: {
    tier: UserTier;
    requestedTier?: UserTier;
    subscriptionExpiresAt?: string | null;
    premiumTrialRemainingMs?: number;
    ultraTrialRemainingMs?: number;
    predictCountToday?: number;
    predictLimit?: number | null;
    quotaExempt?: boolean;
  };
};

export type XGData = {
  homeXG: number;
  awayXG: number;
  marketResults?: {
    cornersTotal?: number | null;
    shotsOnTargetTotal?: number | null;
    shotsTotal?: number | null;
    firstHalfGoals?: number | null;
  };
};

export type BacktestKpi = {
  date: string;
  settled: number;
  hitRate: number;
  roi: number;
  drawdown: number;
  pnlUnits: number;
};

/** Bucket de calibrare: câtă încredere a raportat modelul (avgConfidence) vs accuracy empirică. */
export type CalibrationBucket = {
  bucket: string;
  n: number;
  avgConfidence: number;
  accuracy1x2: number;
};

/** `/api/backtest?view=metrics` răspuns. */
export type ModelMetricsResponse = {
  ok: boolean;
  days: number;
  nRows: number;
  nProb: number;
  brier1x2: number | null;
  logLoss1x2: number | null;
  ece1x2: number | null;
  byMethod: Array<{ key: string; n: number; brier: number; logLoss: number }>;
  byLeague: Array<{ key: string; n: number; brier: number; logLoss: number }>;
  byDataQuality: Array<{ key: string; n: number; brier: number; logLoss: number }>;
  byModelVersion: Array<{ key: string; n: number; brier: number; logLoss: number }>;
  calibration1x2: CalibrationBucket[];
};

export type MlAdminStatus = {
  ok: boolean;
  modelVersion?: string;
  calibrationMaps?: number;
  activeStackerWeights?: number;
  eloTeams?: number;
  historySync?: {
    health?: "ok" | "warn" | "fail";
    last?: {
      ranAt?: string | null;
      source?: string | null;
      method?: string | null;
      scanned?: number;
      updated?: number;
      ok?: boolean;
      error?: string | null;
    } | null;
    recent?: Array<{
      ranAt?: string | null;
      source?: string | null;
      method?: string | null;
      ok?: boolean;
      scanned?: number;
      updated?: number;
      error?: string | null;
      persistInserted?: number;
      persistUpdated?: number;
      persistSkippedFinal?: number;
      persistSkippedStale?: number;
      persistSkippedPrekickoff?: number;
    }>;
    summary?: {
      runs?: number;
      failures?: number;
      updatedTotal?: number;
      hoursSinceLastRun?: number | null;
      hoursSinceLastSuccess?: number | null;
      runs24h?: number;
      successRate24h?: number | null;
      updated24h?: number;
      reliability?: "HEALTHY" | "DEGRADED" | "CRITICAL" | string;
    };
    persist?: {
      runs?: number;
      inserted?: number;
      updated?: number;
      skippedFinal?: number;
      skippedStale?: number;
      skippedPrekickoff?: number;
    };
    hint?: {
      level?: "ok" | "warn" | "fail";
      title?: string;
      message?: string;
    };
    alerts?: Array<{
      level?: "warn" | "fail" | "ok";
      code?: string;
      message?: string;
    }>;
    lastSuccessfulRun?: {
      ranAt?: string | null;
      source?: string | null;
      method?: string | null;
      ok?: boolean;
      scanned?: number;
      updated?: number;
      error?: string | null;
      persistInserted?: number;
      persistUpdated?: number;
      persistSkippedFinal?: number;
      persistSkippedStale?: number;
      persistSkippedPrekickoff?: number;
    } | null;
  };
  seasonInfo?: {
    today?: string;
    inferredSeason?: number;
    effectiveSeason?: number;
    overrideActive?: boolean;
  };
  helpers?: { invalidate?: string; trainNow?: string; historySyncNow?: string; scripts?: string[] };
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
  tier: UserTier;
  subscription_expires_at: string | null;
  premium_trial_activated_at: string | null;
  ultra_trial_activated_at: string | null;
  predict_count_today: number;
  notificationPrefs?: {
    safe: boolean;
    value: boolean;
    email: boolean;
  };
  /** ISO timestamp when user consented to email notifications (GDPR). */
  emailNotificationsConsentedAt?: string | null;
};
