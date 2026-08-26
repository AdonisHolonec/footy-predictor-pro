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
  /** Bookmaker odds when available (history ROI / display). */
  odd?: number;
  ev?: number;
  kelly?: number;
  stakePlan?: string;
  ensemble?: EnsembleStakeBreakdown;
  reasons?: string[];
};

/** Value Betting Engine payload (predicted probability × bookmaker odds). */
export type ValueEngine = {
  type?: string;
  family?: string;
  probability?: number;
  odds?: number;
  expectedValue?: number;
  kellyPct?: number;
  valueScore?: number;
  positiveEV?: boolean;
  negativeEV?: boolean;
  signal?: "positive" | "neutral" | "negative";
  recommendable?: boolean;
  edge?: number;
  fairOdds?: number;
  impliedProb?: number;
  explanation?: string[];
  detected?: boolean;
  highlighted?: boolean;
  /** Best recommendable (+EV) market across supported families. */
  bestMarket?: {
    type?: string;
    family?: string;
    expectedValue?: number;
    kellyPct?: number;
    valueScore?: number;
    odds?: number;
    probability?: number;
    signal?: "positive" | "neutral" | "negative";
    recommendable?: boolean;
    positiveEV?: boolean;
    negativeEV?: boolean;
    line?: number | null;
  } | null;
  markets?: Array<{
    type?: string;
    family?: string;
    expectedValue?: number;
    kellyPct?: number;
    valueScore?: number;
    signal?: "positive" | "neutral" | "negative";
    recommendable?: boolean;
    negativeEV?: boolean;
    positiveEV?: boolean;
    bestMarket?: boolean;
    odds?: number;
    probability?: number;
    line?: number | null;
  }>;
  positiveMarkets?: Array<{
    type?: string;
    family?: string;
    expectedValue?: number;
    kellyPct?: number;
    valueScore?: number;
    bestMarket?: boolean;
  }>;
  negativeMarkets?: Array<{
    type?: string;
    family?: string;
    expectedValue?: number;
  }>;
  rejectedNegativeCount?: number;
  positiveEvCount?: number;
  negativeEvCount?: number;
  familiesSupported?: string[];
  familiesPresent?: string[];
  rule?: string;
};

/** Exact match-distribution payload, computed directly from the score PMF (no sampling). */
export type MonteCarloHistogramBin = {
  goals?: number;
  label?: string;
  pct: number;
};

export type MonteCarloGoalSide = {
  mean: number;
  median: number;
  p05: number;
  p95: number;
  histogram: MonteCarloHistogramBin[];
};

export type MonteCarloResult = {
  version?: string;
  lambdas?: { home: number; away: number };
  model?: {
    method?: string;
    correlation?: number;
    rho?: number;
    gridMax?: number;
  };
  probabilityDistribution: {
    p1: number;
    pX: number;
    p2: number;
    pGG: number;
    pNGG?: number;
    pO05?: number;
    pO15?: number;
    pO25: number;
    pU25?: number;
    pU35?: number;
  };
  expectedGoalsDistribution: {
    home: MonteCarloGoalSide;
    away: MonteCarloGoalSide;
    total: MonteCarloGoalSide;
  };
  scoreDistribution: Array<{ score: string; pct: number }>;
  mostLikelyScores: Array<{ score: string; pct: number }>;
  goalDistribution: MonteCarloHistogramBin[];
  /** Percentile range of the goals distribution itself (real spread, not sampling noise). */
  range: {
    level: number;
    homeGoals: { low: number; high: number };
    awayGoals: { low: number; high: number };
    totalGoals: { low: number; high: number };
  };
  histogram?: {
    totalGoals: MonteCarloHistogramBin[];
    homeGoals: MonteCarloHistogramBin[];
    awayGoals: MonteCarloHistogramBin[];
    scores: MonteCarloHistogramBin[];
  };
  summary?: {
    mostLikelyScore?: string | null;
    mostLikelyScorePct?: number;
    expectedGoalsHome?: number;
    expectedGoalsAway?: number;
    expectedGoalsTotal?: number;
    totalGoalsRange?: { low: number; high: number };
  };
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
  /** Cartonaşe (puncte ponderate: roşu×2 + galben; derivate din rolling stats team_market_rolling). */
  cards?: PoissonMarketProbs;
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

export type MatchScore = {
  home: number | null;
  away: number | null;
  halftime?: { home: number; away: number } | null;
  minute?: number | null;
  /** Stoppage-time minutes (e.g. 2 for "45+2'") — null/absent means no added time is being played. */
  extra?: number | null;
};

export type MarketOddQuote = {
  pick: string;
  line?: number | null;
  /** Consensus odd for the stored `pick` side (over or under). */
  odd: number | null;
  /** Raw consensus sides when available (goals O/U). */
  over?: number | null;
  under?: number | null;
  bookmaker?: string | null;
  bookmakersUsed?: number;
  /** When odd comes from a fallback market (total shots / team SOT). */
  oddSource?: "sot" | "shots_total" | "team_home" | "team_away" | string | null;
  /** The model's original line, before the bookmaker's own line was resolved. */
  requestedLine?: number | null;
  /** The line the bookmaker actually quotes. Equals `line` whenever tradable. */
  bookLine?: number | null;
  /** True when the bookmaker quotes exactly the line the model asked for. */
  lineExact?: boolean | null;
  /** The line `probabilityPct` was computed at. Equals `bookLine` whenever tradable. */
  probabilityLine?: number | null;
  /** Model probability at `probabilityLine`, in percentage points. */
  probabilityPct?: number | null;
  /**
   * The server's tradability verdict. `false` means no bookmaker price exists for a line
   * this model can price — render "—" and never substitute a nearby line's odd.
   */
  tradable?: boolean;
  /** How the probability was obtained when the line moved. */
  repriced?: "ladder" | "analytic" | false;
  /** Why the selection is not tradable, when it isn't. */
  untradableReason?: string | null;
  /** Market Identity Contract (additive): what this quote is a price for. */
  period?: string | null;
  scope?: string | null;
};

/** Single data-backed reason for a pick (from PredictionExplanation). */
export type PredictionReason = {
  code: string;
  label: string;
  value?: number | null;
  unit?: string | null;
  polarity?: "positive" | "negative" | "neutral" | "support";
  source: string;
  meta?: Record<string, unknown>;
};

/** Explainable prediction block — reasons only from real finite inputs. */
export type PredictionExplanation = {
  pick: string;
  confidence: number | null;
  reasons: PredictionReason[];
  formHome?: string | null;
  formAway?: string | null;
  expectedGoals?: number | null;
  reasoning?: string[];
};

export type FeatureImportanceItem = {
  key: string;
  label: string;
  contribution: number;
  activation?: number;
  prior?: number;
};

/** Feature Importance Engine — contribution chart + ML storage. */
export type FeatureImportance = {
  schemaVersion?: string;
  contributions: Record<string, number>;
  items: FeatureImportanceItem[];
  total?: number;
  topFeatures?: string[];
  method?: string;
};

export type PredictionContributionItem = {
  key: string;
  label: string;
  /** Signed effect on the pick probability, in percentage points. */
  contribution: number;
  direction: "positive" | "negative" | "neutral";
  /** |contribution| normalized to the largest driver (0–100), for bar width. */
  share?: number;
};

/** Prediction Contributions Engine — signed per-module attribution for one pick. */
export type PredictionContributions = {
  schemaVersion?: string;
  method?: string;
  pick?: string | null;
  outcome?: "1" | "X" | "2" | string;
  /** Independent Confidence Engine overall (0–100). */
  confidence?: number | null;
  /** Recommended pick probability (0–100). */
  pickProbability?: number | null;
  /** Sum of all signed contributions (pp). */
  net?: number;
  contributions: Record<string, number>;
  items: PredictionContributionItem[];
  topDrivers?: string[];
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

/** Stadium / kickoff location — used for weather lookup (Open-Meteo). */
export type MatchVenue = {
  name?: string;
  city?: string;
  /** Country name from API-Football league (helps geocode weather). */
  country?: string;
  lat?: number;
  lon?: number;
};

/**
 * Settlement of one selection. Beyond pending/win/loss, Asian O/U lines settle
 * as: push (integer line, actual == line, stake returned), half_win /
 * half_loss (quarter lines, half the stake settles, half pushes).
 */
export type SettlementOutcome = "pending" | "win" | "loss" | "push" | "half_win" | "half_loss";

/** Settled outcomes for FocusCard markets (recommended / goals / corners / shots). */
export type CardMarketValidations = {
  recommended?: SettlementOutcome | null;
  goals?: SettlementOutcome | null;
  corners?: SettlementOutcome | null;
  shots?: SettlementOutcome | null;
  /** C3: client-derived from marketResults.cardsTotal; the server does not persist this key yet. */
  cards?: SettlementOutcome | null;
};

export type MomentumRawStats = {
  possession: number | null;
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  corners: number | null;
  yellowCards: number | null;
  redCards: number | null;
};

/**
 * One observed momentum reading at a match minute. `raw` is the cumulative statistics
 * snapshot the reading came from: the difference between two consecutive snapshots is
 * what actually happened in between, which is how the match-flow series gets a per-interval
 * signal out of counters that are otherwise only ever totals (see utils/matchFlow.ts).
 */
export type MomentumHistoryPoint = {
  minute: number;
  homeMomentum: number;
  awayMomentum: number;
  raw?: { home: MomentumRawStats; away: MomentumRawStats };
};

export type MatchLiveEventType =
  | "goal"
  | "ownGoal"
  | "penalty"
  | "penaltyMissed"
  | "yellow"
  | "red"
  | "substitution"
  | "var";

export type MatchLiveEvent = {
  minute: number;
  extra?: number | null;
  team: "home" | "away";
  type: MatchLiveEventType;
  player?: string | null;
  assist?: string | null;
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
  /** Diagnostics only: the persisted provider status when `status` was demoted at the
      read boundary for being stale (see demoteStaleLiveStatus). Absent otherwise. */
  rawStatus?: string;
  score?: MatchScore;
  /** Live momentum snapshot (Sprint 1 foundation) — null/absent when unavailable; never a placeholder. */
  momentum?: {
    homeMomentum: number;
    awayMomentum: number;
    dominantTeam: "home" | "away" | "balanced";
    trend: "up" | "down" | "stable";
    confidence: number;
    /** Raw per-team inputs behind the composite score — absent fields mean that stat wasn't reported. */
    raw?: { home: MomentumRawStats; away: MomentumRawStats };
    /**
     * Client-side sample history, one point per distinct minute observed by the live poll
     * (useLiveFixtureScorePoll). The server is stateless and never sends this; it is what
     * the momentum timeline draws, so the series exists from the first poll after page load
     * rather than from the moment Match Detail was opened.
     */
    history?: MomentumHistoryPoint[];
  } | null;
  /** Real match events from /fixtures/events (in-play only) — absent/empty means the timeline falls back to inference. */
  liveEvents?: MatchLiveEvent[];
  /** Real AI-generated one-sentence narration of the current state (opt-in, server-side) — null/absent falls back to the deterministic buildMatchStory() sentence on the client. */
  momentumNarrative?: string | null;
  /** Merged from history when available — drives WIN/LOSS on the card. */
  cardMarketValidations?: CardMarketValidations | null;
  referee?: string;
  /** Venue from API-Football fixture (coords/city for weather). */
  venue?: MatchVenue;
  lambdas?: { home: number; away: number };
  luckStats?: { hG: number; hXG: number; aG: number; aXG: number; intensityNote?: string };
  /** Clasament + formă din API (nu afectează λ dacă lipsește). */
  teamContext?: MatchTeamContext;
  /** Clasament complet ligă (aceeași listă pe fiecare meci din ligă). */
  leagueStandings?: LeagueStandingEntry[];
  probs: Probs;
  odds?: Odds & { bookmakersUsed?: number };
  valueBet?: ValueBet;
  /**
   * Independent Confidence Engine block. Computed separately from λ/Poisson/pick selection —
   * it never influences `recommended.confidence` or any prediction math. Purely explanatory
   * "how much reliable context did we have for this match" scoring per dimension.
   */
  /**
   * Independent Confidence Engine — context reliability only.
   * Never influences λ / Poisson / recommended.confidence.
   */
  confidenceEngine?: {
    /** 0–100 overall (alias of overall). */
    confidence?: number;
    overall: number;
    category?: "Very High" | "High" | "Medium" | "Low" | "Very Low";
    scores: {
      attack: number;
      defense: number;
      form: number;
      recentMatches?: number;
      standings: number;
      referee: number;
      injuries: number;
      lineups?: number;
      restDays: number;
      homeAdvantage?: number;
      oddsConsensus: number;
      h2h: number;
      /** @deprecated kept for older persisted rows */
      teamStatistics?: number;
    };
    available?: Record<string, boolean>;
    weights?: Record<string, number>;
    explanation?: string[];
    why?: string;
    recommendationWhy?: string[];
    /**
     * Live-only, additive display signal derived from Momentum (Sprint 2) — never
     * mutates `overall`/`confidence`/`scores` above. Only computed for "1"/"2" picks
     * (no clean home/away mapping for draw/O-U/GG). Null/absent outside live play.
     */
    liveAdjustment?: {
      /** -5..+5, capped. */
      delta: number;
      reason: "aligned" | "contradicted" | "neutral";
    } | null;
  };
  /**
   * Value Betting Engine — EV / Kelly / Value Score from predicted probability × odds.
   * Never recommends negative EV (`recommendable` is always false when `negativeEV`).
   */
  valueEngine?: ValueEngine;
  /** Data-backed pick explanation (attack/defense/xG/form/odds…). */
  explanation?: PredictionExplanation;
  /** Per-feature contribution % (sums to 100) — Feature Importance Engine. */
  featureImportance?: FeatureImportance;
  /** Signed per-module contribution (pp) toward this pick — Prediction Contributions Engine. */
  predictionContributions?: PredictionContributions;
  /** Configurable league behaviour profile applied to this prediction. */
  leagueProfile?: {
    leagueId: number | null;
    key: string;
    name: string;
    configVersion?: string;
    fromCatalog?: boolean;
    rates: {
      goalFrequency?: number | null;
      drawFrequency?: number | null;
      cards?: number | null;
      corners?: number | null;
      homeAdvantage?: number | null;
      bttsRate?: number | null;
      overFrequency?: number | null;
      possessionTendency?: number | null;
    };
  };
  /** Monte Carlo simulation (default 10k) from bivariate Poisson + Dixon–Coles. */
  monteCarlo?: MonteCarloResult;
  /** Prediction Laboratory — radar / comparison / evolution diagnostics. */
  predictionLaboratory?: {
    version: string;
    updatedAt: string;
    available: boolean;
    scores?: Record<string, number> | null;
    radar?: Array<{ metric: string; key: string; value: number }>;
    comparison?: {
      homeName: string;
      awayName: string;
      drawOdd: number | null;
      rows: Array<{
        metric: string;
        home: number | null;
        away: number | null;
        homeDisplay: string;
        awayDisplay: string;
        edge: number | null;
      }>;
    } | null;
    evolution?: Array<{ stage: string; p1: number; pX: number; p2: number }>;
    bookmaker?: {
      modelPct: number | null;
      impliedPct: number | null;
      differencePp: number | null;
      score: number;
    } | null;
    metrics?: Array<{ key: string; label: string; value: number | null; display?: string; unit: string }>;
  };
  marketOdds?: {
    goals15?: MarketOddQuote;
    goals25?: MarketOddQuote;
    goals35?: MarketOddQuote;
    btts?: MarketOddQuote;
    corners?: MarketOddQuote;
    shotsOnTarget?: MarketOddQuote;
    shotsTotal?: MarketOddQuote;
    firstHalfGoals?: MarketOddQuote;
    doubleChance?: {
      homeDraw?: number | null;
      homeAway?: number | null;
      drawAway?: number | null;
      bookmaker?: string | null;
      bookmakersUsed?: number;
    };
    cards?: MarketOddQuote & { over?: number | null; under?: number | null };
  };
  /** Post-match totals (corners / shots / cards) — used to settle FocusCard markets client-side. */
  marketResults?: {
    cornersTotal?: number | null;
    shotsOnTargetTotal?: number | null;
    shotsTotal?: number | null;
    /** Raw card count (yellow + red) — the unit every Cards line settles against. NULL = not observed, never 0. */
    cardsTotal?: number | null;
    /** Weighted convention (red×2 + yellow). Recorded only; no market settles against it. */
    cardsPoints?: number | null;
    firstHalfGoals?: number | null;
  };
  /** Referee discipline context (C3) — supporting statistic only, not a model input. Null when under-sampled. */
  refereeCards?: { avgCards: number; sampleSize: number; unit: "cardsTotal" } | null;
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
    /** Authoritative market family the pick came from (1X2 / Double Chance / BTTS / Over/Under / Corners / Cards / Correct Score) — see selectRecommendation.js. Absent on rows persisted before this field existed. */
    family?: string | null;
    confidence: number | null;
    confidenceCategory?: string | null;
    odd?: number | null;
    oddSource?: string | null;
    bookmakersUsed?: number;
    /** Line contract (additive, see Stage09Explainability). Absent on older rows. */
    line?: number | null;
    bookLine?: number | null;
    lineExact?: boolean | null;
    probabilityLine?: number | null;
    tradable?: boolean;
    repriced?: "ladder" | "analytic" | false;
    /**
     * Market Identity Contract (additive): the period and scope the pick is a bet
     * on ("full_match" / "first_half" / "second_half", "match" / "home" / "away").
     * The UI renders these verbatim — it never re-guesses them from the label.
     * Absent on rows persisted before the contract existed.
     */
    period?: string | null;
    scope?: string | null;
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
      goalFrequency?: number;
      drawFrequency?: number;
      bttsRate?: number;
      overFrequency?: number;
      corners?: number;
      cards?: number;
      possessionTendency?: number;
      profileKey?: string;
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
    /**
     * Internal-only debug metadata (Sprint 2 observability). Only present when
     * PREDICT_DEBUG_METADATA=1 server-side, and stripped for every tier in
     * accessTier.js — normal users (FREE/PREMIUM/ULTRA) never receive this field.
     */
    debug?: {
      motivation: {
        active: boolean;
        source: string | null;
        multiplierHome: number | null;
        multiplierAway: number | null;
        competitionKeywordHome: string | null;
        competitionKeywordAway: string | null;
      };
      cleanSheet: {
        blendApplied: boolean;
        empiricalBttsRate: number | null;
      };
    };
  };
};

export type HistoryEntry = PredictionRow & {
  savedAt: string;
  validation: SettlementOutcome;
  /**
   * Set only by the light `?view=list` mapper, which is column-based and does
   * not ship `probs`. They answer the one question the pending counter asked
   * that object: does this fixture have a corners / shots market at all.
   * Undefined on the full (`fixtureId=N`, hydration) shape, where `probs` is
   * present and should be used instead.
   */
  hasCornersMarket?: boolean;
  hasShotsMarket?: boolean;
};

export type HistoryStats = {
  wins: number;
  losses: number;
  /** Full wins + full losses — the main win-rate denominator. Pushes and half
   * outcomes are tracked separately and never folded into it. */
  settled: number;
  winRate: number;
  pushes: number;
  halfWins: number;
  halfLosses: number;
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

/** Single calendar day's settled accuracy — powers the "last 7 days" table on the home dashboard. */
export type DayAccuracyRow = HistoryStats & {
  /** YYYY-MM-DD, Europe/Bucharest (matches kickoffLocalDateKey bucketing). */
  date: string;
};

/** Settled counts for a market family (1X2 / Over-Under / BTTS) on the home dashboard. */
export type MarketBreakdownRow = {
  market: "oneXTwo" | "overUnder" | "btts";
  wins: number;
  losses: number;
  pending: number;
  settled: number;
  winRate: number;
};

export type DayResponse = {
  ok: boolean;
  date: string;
  totalFixtures: number;
  leagues: League[];
  usage: Usage;
  tierStatus?: {
    /** EFFECTIVE tier — bonus and trials already applied. Feature gates read this. */
    tier: UserTier;
    /** UNDERLYING requested/paid tier, independent of any bonus. Subscription UI reads this. */
    requestedTier?: UserTier;
    subscriptionExpiresAt?: string | null;
    /** PAID-only: an active bonus never makes a user look subscribed. */
    hasActiveSubscription?: boolean;
    /** End of the active ULTRA bonus window, or null. */
    bonusUntil?: string | null;
    hasActiveBonus?: boolean;
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
    cardsTotal?: number | null;
    cardsPoints?: number | null;
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
  wins?: number;
  losses?: number;
  yield?: number;
  profit?: number;
  loss?: number;
  totalStake?: number;
  expectedValue?: number;
};

export type BacktestFilters = {
  period: "7d" | "30d" | "season" | string;
  days?: number | null;
  leagueId?: number | null;
  competition?: string | null;
  market?: string;
  side?: "all" | "home" | "away" | "draw";
  minConfidence?: number | null;
  maxConfidence?: number | null;
  minOdds?: number | null;
  maxOdds?: number | null;
  requirePositiveEv?: boolean;
};

export type BacktestMetrics = {
  settled: number;
  wins: number;
  losses: number;
  hitRate: number;
  roi: number;
  yield: number;
  profit: number;
  loss: number;
  pnlUnits: number;
  totalStake: number;
  averageOdds: number;
  averageConfidence: number;
  expectedValue: number;
  maxDrawdown: number;
  winningStreak: number;
  losingStreak: number;
  /** Professional quant metrics. */
  logLoss?: number | null;
  brier?: number | null;
  kellyGrowthPct?: number;
  kellyFinalBankroll?: number;
  kellyMaxDrawdownPct?: number;
  growthGeoMeanPct?: number;
  sharpe?: number;
  sharpeAnnualized?: number;
  avgReturn?: number;
  returnStd?: number;
  clv?: number | null;
  clvAvailable?: boolean;
  clvCount?: number;
  clvBeatRate?: number | null;
};

export type BacktestBetRow = {
  fixtureId?: number | null;
  kickoffAt?: string | null;
  leagueId?: number;
  leagueName?: string;
  homeTeam?: string;
  awayTeam?: string;
  market?: string;
  side?: string;
  odd?: number;
  stake?: number;
  confidence?: number | null;
  ev?: number | null;
  won?: boolean;
  pnl?: number;
};

export type DashboardBundle = {
  predictionAccuracy: number;
  hitRate?: number;
  roi: number;
  yield: number;
  averageOdds?: number;
  expectedValue?: number;
  settled?: number;
  dailyProfit: number;
  weeklyProfit: number;
  monthlyProfit: number;
  leaguePerformance: Array<{ key: string; settled: number; hitRate: number; roi: number; pnl: number }>;
  marketPerformance: Array<{ key: string; settled: number; hitRate: number; roi: number; pnl: number }>;
  confidenceDistribution: Array<{ bucket: string; count: number; hitRate: number }>;
  /** Share of predictions by market / pick family. */
  predictionDistribution?: Array<{ key: string; count: number; pct: number }>;
  accuracyByLeague: Array<{ key: string; hitRate: number; settled: number }>;
  accuracyByMarket: Array<{ key: string; hitRate: number; settled: number }>;
  bestLeagues: Array<{ key: string; settled: number; hitRate: number; roi: number; pnl: number }>;
  worstLeagues: Array<{ key: string; settled: number; hitRate: number; roi: number; pnl: number }>;
  bestMarkets?: Array<{ key: string; settled: number; hitRate: number; roi: number; pnl: number }>;
  worstMarkets?: Array<{ key: string; settled: number; hitRate: number; roi: number; pnl: number }>;
  heatmap: {
    leagues: string[];
    markets: string[];
    cells: Array<{ league: string; market: string; settled: number; hitRate: number | null; pnl: number }>;
  };
  radar: Array<{ metric: string; value: number }>;
  profitLine: Array<{ date: string; equity: number; pnl: number; hitRate: number }>;
};

export type ModelLabResult = {
  id: string;
  name: string;
  sources: string[];
  modifiers: string[];
  samples: number;
  bets: number;
  accuracy: number;
  roi: number;
  yield: number;
  logLoss: number | null;
  brier: number | null;
  expectedValue: number;
};

export type ModelLabBundle = {
  ok: boolean;
  schemaVersion?: string;
  generatedAt?: string;
  days?: number;
  totalSettled: number;
  models: ModelLabResult[];
  best?: { id: string; name: string; roi: number } | null;
  metrics?: string[];
};

export type ModelSelectionWindow = {
  key: string;
  days: number;
  weight: number;
  totalSettled: number;
  winner?: { id: string; name: string; composite: number } | null;
};

export type ModelSelectionBundle = {
  ok: boolean;
  ran?: boolean;
  active?: { id: string; name: string; promotedAt?: string | null; compositeScore?: number | null } | null;
  selected?: { id: string; name: string; reason?: string };
  totalSettled?: number;
  windows?: ModelSelectionWindow[];
  ranking?: Array<{ id: string; name: string; compositeScore: number | null; coverage: number }>;
  promoted?: { id: string; name: string; promotedAt?: string; compositeScore?: number | null };
};

export type CacheHitStats = {
  date?: string;
  hits: number;
  misses: number;
  inflightJoins?: number;
  hitRatio: number | null;
  processHitRatio?: number | null;
  updatedAt?: string | null;
};

export type LatencyChannelStats = {
  count: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  maxMs: number;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type OpsAlert = {
  id: string;
  level: "high" | "medium" | string;
  message: string;
  value?: number;
};

/** Healthy/Warning/Critical, rolled up from the alert rules that name each subsystem (S5). */
export type SubsystemStatus = "healthy" | "warning" | "critical";

/**
 * Thresholds the server derives from its alert rules and publishes so the dashboard reads a
 * figure the same way alerting does. Env overrides are already applied — the browser cannot
 * see them otherwise. Values may be null if a rule ever drops the band they read.
 */
export type AlertThresholds = {
  settlementPendingWarn: number | null;
  settlementPendingCritical: number | null;
  settlementStaleMinutes: number | null;
  snapshotStaleMinutes: number | null;
  benchmarkBacklogWatch: number | null;
  predictionFailuresWatch: number | null;
};

export type DailyOpsReport = {
  date: string;
  status: string;
  severity: string;
  usage?: { count: number; limit: number; remaining?: number; pct?: number };
  cache?: { hits: number; misses: number; hitRatio: number | null };
  performance?: {
    predictionP95: number | null;
    apiP95: number | null;
    cacheP95: number | null;
    predictionAvg?: number;
    apiAvg?: number;
  };
  failures?: { prediction: number; api: number; cache: number };
  alertCount?: number;
  alerts?: Array<{ id: string; level: string; message: string }>;
  subsystems?: Record<string, SubsystemStatus>;
  memoryMb?: number;
  generatedAt?: string;
};

/**
 * Prediction delivery counters (S2), derived from response headers rather than pipeline
 * instrumentation — PredictorV3 is not touched to produce these.
 */
export type PredictionHealth = {
  generatedToday: number;
  servedLive: number;
  servedFromCache: number;
  cacheServedPct: number | null;
  /** Live requests run the fixture loop, so this is generation time, not user-facing latency. */
  avgGenerationMs: number | null;
  p95GenerationMs: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgCachedLatencyMs: number | null;
  failures: number;
  /** A prediction shown to the user that never reached the database. Any occurrence matters. */
  persistFailures: { history: number; ownership: number };
  upstreamFallbacks: number;
};

/** Settlement sync health (S1), read from the KV run stream written by each sync. */
export type SettlementHealth = {
  ok: boolean;
  lastRunAt: string | null;
  ageMinutes: number | null;
  runs: number;
  totals: {
    finishedScanned: number;
    recommendedSettled: number;
    missingTotals: number;
    skippedByBudget: number;
  };
  pendingTrend?: Array<{ at: string; stillPending: number }>;
  /** Finished fixtures whose recommended pick still has no win/loss verdict. */
  recommendedStillPending: number;
};

/** Benchmark sweep health (S1). A backlog means accrual is budget-bound, not stopped. */
export type BenchmarkHealth = {
  ok: boolean;
  lastRunAt: string | null;
  ageMinutes: number | null;
  runs: number;
  totals: { fetched: number; persisted: number; errors: number };
  backlog: number;
  coveragePct: number | null;
};

/**
 * EV of the pick we actually recommend, in percent (migration 042). Median leads because
 * the distribution has a heavy right tail; a median just under zero is what a calibrated
 * model looks like against a price carrying the bookmaker's margin.
 */
export type OpsRecommendedEv = {
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  mean: number | null;
  negativePct: number | null;
  unit: "percent";
};

/** EV of the best-value market — a DIFFERENT bet from the recommended pick. */
export type OpsValueMarketEv = {
  n: number;
  median: number | null;
  p75: number | null;
  max: number | null;
  /** Rows meaning "no value found", not a zero edge. */
  zeroRows: number;
  above100Rows: number;
  detected: number;
  differsFromRecommended: number;
  describesRecommendedPick: false;
  unit: "percent";
};

/** Sections land as `{}` when their RPC degrades, so every field is optional. */
export type OpsPredictionAggregate = {
  windowDays?: number;
  total?: number;
  avgConfidence?: number | null;
  avgOdds?: number | null;
  recommendedEv?: OpsRecommendedEv | null;
  valueMarketEv?: OpsValueMarketEv | null;
  byFamily?: Array<{ family: string; count: number }>;
  /** Picks without a persisted family fall back to line heuristics when grading. */
  unknownFamilyPct?: number | null;
  topLeagues?: Array<{ leagueId: number; league: string; count: number }>;
};

export type OpsSettlementAggregate = {
  windowDays?: number;
  rows?: number;
  finished?: number;
  settled?: number;
  pending?: number;
  recommendedPending?: number;
  settlementSuccessPct?: number | null;
  avgSettlementMinutes?: number | null;
  oldestPendingAt?: string | null;
};

export type OpsBusinessMetrics = {
  windowDays?: number;
  users?: number;
  /** Proxied by warm/predict usage: "ran the engine", not "opened the app". */
  activeUsers?: number;
  activeDays?: number;
  predictRuns?: number;
  warmRuns?: number;
  tierDistribution?: Array<{ tier: string; count: number }>;
  topFavoriteLeagues?: Array<{ leagueId: number; count: number }>;
};

export type OpsCronJob = {
  lastRanAt: string | null;
  ageMinutes: number | null;
  ok: boolean;
  scanned?: number;
  updated?: number;
  error?: string | null;
};

export type OpsCronHealth = {
  ok?: boolean;
  jobs?: Record<string, OpsCronJob>;
  staleJobs?: string[];
  failingJobs?: string[];
};

export type OpsNotificationHealth = {
  ok?: boolean;
  windowDays?: number;
  total?: number;
  byStatus?: Record<string, number>;
  byType?: Record<string, number>;
  errorPct?: number | null;
  successPct?: number | null;
  lastDispatchAt?: string | null;
  error?: string;
};

/** Newest row of `ops_health_snapshots`, written by the daily cron (S3). */
export type OpsHealthSnapshot = {
  capturedAt: string;
  ageMinutes: number | null;
  windowDays: number;
  prediction: OpsPredictionAggregate;
  settlement: OpsSettlementAggregate;
  business: OpsBusinessMetrics;
  notifications: OpsNotificationHealth;
  cron: OpsCronHealth;
};

export type HealthDashboardBundle = {
  ok: boolean;
  status: "healthy" | "degraded" | "critical" | string;
  severity: "none" | "medium" | "high" | string;
  generatedAt: string;
  checks: {
    kv: { ok: boolean; latencyMs?: number; error?: string };
    supabase: { ok: boolean; latencyMs?: number; error?: string };
    upstreamConfigured: boolean;
  };
  process: {
    uptimeSec: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number };
    cpu: { userUs: number; systemUs: number } | null;
    node?: string;
  };
  usage: { count: number; limit: number; remaining: number; pct: number; updatedAt?: string | null };
  cache: CacheHitStats;
  performance: {
    predictionLatency: LatencyChannelStats;
    apiLatency: LatencyChannelStats;
    cacheLatency: LatencyChannelStats;
    fixturesLatency: LatencyChannelStats;
  };
  failures: { prediction: number; api: number; cache: number };
  /** S2 — how predictions were delivered today. */
  predictionHealth?: PredictionHealth;
  /** S1 — settlement and benchmark sync streams. */
  settlementHealth?: SettlementHealth;
  benchmarkHealth?: BenchmarkHealth;
  /** S3 — slow-moving aggregates from the daily cron; null until the first snapshot runs. */
  snapshot?: OpsHealthSnapshot | null;
  alerts: OpsAlert[];
  /** S5 — per-subsystem rollup of the same rule evaluation that produced `alerts`. */
  subsystems?: Record<string, SubsystemStatus>;
  /** S5 — effective alert thresholds, so the dashboard and the alerting agree on a figure. */
  thresholds?: Partial<AlertThresholds>;
  history?: Array<{
    date: string;
    failures: { prediction: number; api: number; cache: number };
    routes: {
      predict: LatencyChannelStats;
      fixtures: LatencyChannelStats;
      api: LatencyChannelStats;
      cache: LatencyChannelStats;
    };
  }>;
  dailyReport?: DailyOpsReport | null;
  recentReports?: DailyOpsReport[];
  metrics?: {
    date: string;
    updatedAt: string | null;
    failures: { prediction: number; api: number; cache: number };
    routes: {
      predict: LatencyChannelStats;
      fixtures: LatencyChannelStats;
      api: LatencyChannelStats;
      cache: LatencyChannelStats;
      lambdaPredictionEngine: LatencyChannelStats;
      lambdaStrengthRatings: LatencyChannelStats;
      lambdaStandings: LatencyChannelStats;
      lambdaPartialStats: LatencyChannelStats;
      lambdaUefaFallback: LatencyChannelStats;
      lambdaInsufficientData: LatencyChannelStats;
    };
  };
};

export type BacktestAnalyticsResponse = {
  ok: boolean;
  cutoff?: string;
  filters?: BacktestFilters;
  metrics?: BacktestMetrics;
  dashboard?: DashboardBundle;
  facets?: {
    leagues: Array<{ id: number; name: string }>;
    competitions: string[];
    markets: string[];
  };
  totalsUnfiltered?: { settled: number; filtered: number };
  series?: {
    equity: Array<{ i: number; date: string; equity: number; pnl: number; drawdown: number }>;
    kelly?: Array<{ i: number; date: string; bankroll: number }>;
    returnsHistogram?: Array<{ bucket: string; count: number }>;
    daily: Array<{ date: string; pnl: number; equity: number; settled: number; hitRate: number }>;
    byMarket: Array<{ key: string; settled: number; hitRate: number; roi: number; pnl: number }>;
    byLeague: Array<{ key: string; settled: number; hitRate: number; roi: number; pnl: number }>;
    bySide: Array<{ key: string; settled: number; hitRate: number; roi: number; pnl: number }>;
  };
  bets?: BacktestBetRow[];
  error?: string;
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
      estimatedCalls?: number;
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
      estimatedCalls?: number;
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
      estimatedCallsTotal?: number;
      avgEstimatedCallsPerRun?: number | null;
      hoursSinceLastRun?: number | null;
      hoursSinceLastSuccess?: number | null;
      runs24h?: number;
      successRate24h?: number | null;
      updated24h?: number;
      scanned24h?: number;
      estimatedCalls24h?: number;
      callsBudgetWarn24h?: number;
      callsBudgetCritical24h?: number;
      callsBudgetLevel?: "ok" | "warn" | "critical" | string;
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
      estimatedCalls?: number;
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
  /**
   * The user's OWN plan — the requested/paid tier, never the effective one.
   * For what the user can actually do right now (bonus and trials applied),
   * read `userTier` from useAuth(), which carries the server's answer.
   */
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
