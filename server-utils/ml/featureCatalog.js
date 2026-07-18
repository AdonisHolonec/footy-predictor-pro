/**
 * Feature catalog for ML readiness.
 * AVAILABLE = extractable today from predict/history payloads.
 * MISSING = desirable for future models (documented, not yet collected).
 *
 * Schema version bumps when names/meanings change incompatibly.
 */

export const FEATURE_SCHEMA_VERSION = "fs-v1";

/** Features currently extractable (online stacker + extended history fields). */
export const AVAILABLE_FEATURES = Object.freeze([
  // --- Current multinomial stacker (mlStacker.extractStackerFeatures) ---
  { name: "poisson_log_ratio_1X", group: "model", dtype: "float", source: "evaluation.rawPoissonProbs1x2Pct" },
  { name: "poisson_log_ratio_2X", group: "model", dtype: "float", source: "evaluation.rawPoissonProbs1x2Pct" },
  { name: "market_log_ratio_1X", group: "market", dtype: "float", source: "odds → Shin implied" },
  { name: "market_log_ratio_2X", group: "market", dtype: "float", source: "odds → Shin implied" },
  { name: "market_available", group: "market", dtype: "binary", source: "odds present" },
  { name: "elo_spread_norm", group: "elo", dtype: "float", source: "team_elo / modelMeta.elo" },
  { name: "data_quality_centered", group: "quality", dtype: "float", source: "modelMeta.dataQuality" },
  { name: "log_home_adv", group: "league", dtype: "float", source: "leagueParams.homeAdv" },
  { name: "rho", group: "league", dtype: "float", source: "leagueParams.rho / Dixon-Coles" },

  // --- Extended features from history / raw_payload (extractable, not yet in stacker) ---
  { name: "p1", group: "model", dtype: "float", source: "probs.p1 or evaluation.modelProbs1x2Pct.p1" },
  { name: "pX", group: "model", dtype: "float", source: "probs.pX" },
  { name: "p2", group: "model", dtype: "float", source: "probs.p2" },
  { name: "pO25", group: "model", dtype: "float", source: "probs.pO25" },
  { name: "pGG", group: "model", dtype: "float", source: "probs.pGG" },
  { name: "lambda_home", group: "model", dtype: "float", source: "lambdas.home" },
  { name: "lambda_away", group: "model", dtype: "float", source: "lambdas.away" },
  { name: "odds_home", group: "market", dtype: "float", source: "odds.home / odds_home column" },
  { name: "odds_draw", group: "market", dtype: "float", source: "odds.draw" },
  { name: "odds_away", group: "market", dtype: "float", source: "odds.away" },
  { name: "recommended_confidence", group: "model", dtype: "float", source: "recommended.confidence" },
  { name: "value_ev", group: "value", dtype: "float", source: "valueBet.ev / valueEngine.expectedValue" },
  { name: "value_kelly", group: "value", dtype: "float", source: "valueBet.kelly" },
  { name: "value_detected", group: "value", dtype: "binary", source: "valueBet.detected" },
  { name: "confidence_engine_overall", group: "context", dtype: "float", source: "confidenceEngine.overall" },
  { name: "league_id", group: "meta", dtype: "categorical", source: "leagueId" },
  { name: "kickoff_hour_utc", group: "meta", dtype: "int", source: "kickoff_at" },
  { name: "kickoff_dow", group: "meta", dtype: "int", source: "kickoff_at (0=Sun)" },
  { name: "calibration_applied", group: "pipeline", dtype: "binary", source: "modelMeta.calibrationApplied" },
  { name: "stacker_applied", group: "pipeline", dtype: "binary", source: "modelMeta.stackerApplied" }
]);

/** Features we want for stronger models but do not reliably store yet. */
export const MISSING_FEATURES = Object.freeze([
  { name: "h2h_goals_avg", group: "h2h", reason: "H2H fixtures not fetched / not persisted in raw_payload" },
  { name: "h2h_home_win_rate", group: "h2h", reason: "same" },
  { name: "injuries_home_count", group: "injuries", reason: "/injuries API not called" },
  { name: "injuries_away_count", group: "injuries", reason: "same" },
  { name: "rest_days_home", group: "schedule", reason: "RestDays module exists but dates rarely persisted" },
  { name: "rest_days_away", group: "schedule", reason: "same" },
  { name: "referee_avg_cards", group: "referee", reason: "referee stats optional / sparse" },
  { name: "referee_avg_goals", group: "referee", reason: "same" },
  { name: "form_pts_home_5", group: "form", reason: "form string present; numeric W/D/L pts not stored as feature" },
  { name: "form_pts_away_5", group: "form", reason: "same" },
  { name: "xg_rolling_home", group: "xg", reason: "synthetic/luck xG only; shot-based xG rolling incomplete" },
  { name: "xg_rolling_away", group: "xg", reason: "same" },
  { name: "corners_lambda_total", group: "markets", reason: "present on some rows; not guaranteed" },
  { name: "lineup_confirmed", group: "lineups", reason: "lineups API unused" },
  { name: "weather_temp_c", group: "context", reason: "no weather source" },
  { name: "closing_odds_home", group: "market", reason: "only consensus at predict time; no closing line store" },
  { name: "odds_movement_home", group: "market", reason: "no odds timeline" },
  { name: "travel_km_away", group: "schedule", reason: "no geodata" },
  { name: "table_rank_home", group: "standings", reason: "standings in payload sometimes; not normalized feature" },
  { name: "table_rank_away", group: "standings", reason: "same" }
]);

export function availableFeatureNames() {
  return AVAILABLE_FEATURES.map((f) => f.name);
}

export function missingFeatureNames() {
  return MISSING_FEATURES.map((f) => f.name);
}
