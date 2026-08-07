/**
 * Meta Recommendation Layer — decision contract (S6).
 *
 * Phase 7 of docs/META_LEARNING_BENCHMARK_INTELLIGENCE.md specifies a dormant advice
 * function and argues its own value plainly: "the schema and decision contract exist
 * before the data does, so nothing has to be rewritten later". This file is that contract
 * and nothing more.
 *
 * It carries type declarations only. A `.d.ts` would have been the tidier home, but this
 * project sets `skipLibCheck`, which silently exempts declaration files from checking — a
 * contract nothing verifies is a comment. As a .ts it is checked; as a module under
 * server-utils, which Node runs as plain ESM, it still cannot be imported at runtime.
 *
 * Every type below is transcribed from something that already exists:
 *   - the action union and decision rules  → Phase 7 §7.1–7.3
 *   - MetaFixtureContext                   → buildFixtureContext(), MetaContextBuilder.js
 *   - MetaSegmentVerdict                   → meta_pairwise_verdicts, migration 040
 * Nothing here was invented to be general. Where the design has not decided something, the
 * type says so rather than guessing a shape.
 *
 * NOT WIRED. PredictorV3 alone owns the user-facing recommendation. A conforming
 * implementation is exercised by tests and, later, an admin simulation view — never by
 * /api/predict.
 */

/**
 * Deferring is the default and, per §7.3, will be the honest answer for the large majority
 * of fixtures until a second broad-coverage provider exists. An implementation that usually
 * has an opinion is overfitting.
 */
export type MetaAdviceAction =
  | "use_predictor_v3"
  | "use_provider"
  | "consensus_only"
  | "no_bet"
  | "defer";

/** Verdict vocabulary of meta_pairwise_verdicts. `insufficient_data` is a real verdict. */
export type MetaVerdictLabel =
  | "a_dominant"
  | "a_leaning"
  | "inconclusive"
  | "b_leaning"
  | "b_dominant"
  | "insufficient_data";

/** Only `walk_forward_oos` verdicts may ever be labelled *_dominant (migration 040). */
export type MetaFoldScheme = "walk_forward_oos" | "in_sample";

/**
 * One row of the context projection, snake_case because it is persisted as such. Reproduced
 * from buildFixtureContext(); it is the join key between a fixture and a segment verdict.
 */
export interface MetaFixtureContext {
  fixture_id: number;
  model_version: string;
  context_version: string;

  league_id: number | null;
  league_name: string | null;
  league_tier: string | null;
  league_quality: string | null;

  home_team_id: number | null;
  away_team_id: number | null;

  kickoff_at: string | null;
  season_phase: string | null;
  days_since_season_start: number | null;

  odds_home: number | null;
  odds_draw: number | null;
  odds_away: number | null;
  closing_odds_home: number | null;
  closing_odds_draw: number | null;
  closing_odds_away: number | null;

  favourite_side: "home" | "away" | "none" | null;
  favourite_implied_prob: number | null;
  favouritism_class: string | null;
  /** Null, not false, when the pick is not a 1X2 bet at all. */
  pick_is_favourite: boolean | null;
  odds_band: string | null;

  market_move_pct: number | null;
  market_move_class: string | null;

  match_status: string | null;
  score_home: number | null;
  score_away: number | null;
  settled: boolean;

  computed_at: string;
}

/** What each provider actually selected for the fixture under advice. */
export interface MetaProviderSelection {
  providerKey: string;
  pick: string | null;
  marketFamily: string;
  confidence: number | null;
  odd: number | null;
  /**
   * Whether the price was observed or reconstructed. Counterfactual pricing must never be
   * read as real provider ROI, which is why provenance travels with the number.
   */
  pricedFrom: "observed" | "counterfactual" | null;
}

/** A head-to-head verdict for the segment this fixture falls into. */
export interface MetaSegmentVerdict {
  providerAKey: string;
  providerBKey: string;
  modelVersion: string;

  segmentKind: string;
  segmentKey: string;
  marketFamily: string;
  windowDays: number;
  windowEnd: string;

  nPaired: number;
  discordantN: number;

  hitRateDelta: number | null;
  roiDelta: number | null;

  pValue: number | null;
  /** Benjamini-Hochberg adjusted. Rules key off q, never off p. */
  qValue: number | null;
  effectSize: number | null;
  dominanceScore: number | null;

  verdict: MetaVerdictLabel;
  foldScheme: MetaFoldScheme;
  computedAt: string;
  /** Stable identity so advice can cite exactly which verdicts it used. */
  verdictId: number | string;
}

/** Per-provider calibration for the segment, used by the `no_bet` rule. */
export interface MetaCalibrationSnapshot {
  providerKey: string;
  segmentKey: string;
  /** Expected calibration error. Higher is worse. */
  ece: number | null;
  n: number;
}

/** Drift state gates advice: an actively drifting segment is forced to defer. */
export interface MetaDriftState {
  segmentKey: string;
  level: "none" | "warning" | "critical";
  detectedAt: string | null;
}

/**
 * Thresholds the decision rules read. Named after the rule that consumes each, and left
 * required so a caller cannot silently inherit a default that the rules depend on.
 */
export interface MetaAdviceConfig {
  /** §7.1 rule 4: a dominant verdict needs this many discordant pairs. */
  minDiscordantN: number;
  /** §7.1 rule 4: BH-adjusted significance ceiling. */
  maxQValue: number;
  /** §7.1 rule 2: above this ECE a provider counts as poorly calibrated. */
  maxEce: number;
  /** §7.2: verdicts older than this are treated as absent. */
  verdictStalenessDays: number;
  /** §7.2: minimum interval before advice may flip provider again. */
  flipHysteresisDays: number;
}

export interface MetaAdviceInput {
  context: MetaFixtureContext;
  selections: MetaProviderSelection[];
  verdicts: MetaSegmentVerdict[];
  calibration: MetaCalibrationSnapshot[];
  config: MetaAdviceConfig;
  /** Absent when drift has never been computed for the segment. */
  drift?: MetaDriftState | null;
  /** The previous advice for this segment, required to honour flip hysteresis. */
  previous?: Pick<MetaAdvice, "action" | "providerKey" | "decidedAt"> | null;
}

/**
 * Why a rule was forced rather than reached. A guardrail is not an error: `drift_critical`
 * and `verdict_stale` both produce a legitimate `defer`.
 */
export type MetaGuardrailReason =
  | "drift_critical"
  | "verdict_stale"
  | "flip_hysteresis"
  | "insufficient_data"
  | "in_sample_only";

export interface MetaGuardrail {
  reason: MetaGuardrailReason;
  /** Human-readable, and safe to show in an admin simulation view. */
  detail: string;
}

export interface MetaAdvice {
  action: MetaAdviceAction;
  /** Set only for `use_provider`; null for every other action. */
  providerKey: string | null;
  /** Confidence in the ADVICE, not in the underlying pick. Null when deferring. */
  confidence: number | null;
  /** Ordered, first entry being the rule that matched. */
  rationale: string[];
  guardrails: MetaGuardrail[];
  /** Ids of every verdict consulted, so any advice is fully auditable after the fact. */
  evidence: {
    verdictIds: Array<number | string>;
    segmentKey: string;
    contextVersion: string;
  };
  decidedAt: string;
}

/**
 * Pure. No I/O, no side effects, never called by the prediction path.
 *
 * Rules are ordered and first match wins (§7.1): defer, no_bet, consensus_only,
 * use_provider, use_predictor_v3.
 */
export type ResolveMetaAdvice = (input: MetaAdviceInput) => MetaAdvice;
