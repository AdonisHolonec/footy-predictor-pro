/**
 * raw_payload paths the backtest readers actually dereference — egress control.
 *
 * Five api/backtest.js reads (analytics, snapshot, public-track fallback, clv,
 * walk-forward-tip) selected the full `raw_payload` column: ~320 KB/row wired
 * out of PostgREST while their consumers read a few hundred bytes of it. The
 * organization's exceeded quota is egress, and 97.6–99.6% of measured egress is
 * PostgREST responses, so the fix is the wire, not the query plan.
 *
 * These specs were built by exhaustively enumerating every `payload.*` access in
 * the consumers — nothing here is speculative, and nothing the consumers read
 * is missing:
 *
 * ANALYTICS_PAYLOAD_PATHS  (extractBetEvent / buildBacktestReport path)
 *   BacktestAnalytics.js  payload.valueBet.{type,prob,odds,odd,kellyPct,kelly,
 *                           ev,expectedValue,confidence}      -> valueBet block
 *                         payload.valueEngine.{bestMarket,odds,type,
 *                           expectedValue,confidencePct}      -> five paths,
 *                           NEVER the block: valueEngine is 267.7 KB (87.96% of
 *                           the row) and its bulk is the markets arrays no
 *                           analytics consumer reads
 *                         payload.evaluation.{modelProbs,calibratedProbs}
 *                                                             -> evaluation block (~0.8 KB)
 *                         payload.recommended.confidence      -> recommended block
 *   closingOddsResolve.js payload.{closingOdds,oddsClosing,marketOdds.closing}
 *
 * TIP_PAYLOAD_PATHS  (resolvePublishedTip / extractTipEvents path)
 *   TipEvent.js           payload.{recommended,probs,score,confidence,kickoffAt}
 *                         payload.modelMeta.modelVersion      -> one path, not
 *                           the ~9.6 KB modelMeta block
 *   closingOddsResolve.js payload.{closingOdds,oddsClosing,marketOdds.closing}
 *
 * isRecommendedSlotExcluded() reads only the promoted recommended_market_valid
 * column, and resolveBetOutcome() reads only promoted columns — neither needs a
 * path here.
 *
 * THE RULE (from history/payloadProjection.js, verbatim): a consumer that
 * starts reading a new `payload.<key>` MUST add that path here, or it will
 * silently read `undefined` instead of data.
 */

export const ANALYTICS_PAYLOAD_PATHS = Object.freeze({
  valueBet: Object.freeze(["valueBet"]),
  veBestMarket: Object.freeze(["valueEngine", "bestMarket"]),
  veOdds: Object.freeze(["valueEngine", "odds"]),
  veType: Object.freeze(["valueEngine", "type"]),
  veExpectedValue: Object.freeze(["valueEngine", "expectedValue"]),
  veConfidencePct: Object.freeze(["valueEngine", "confidencePct"]),
  evaluation: Object.freeze(["evaluation"]),
  recommended: Object.freeze(["recommended"]),
  closingOdds: Object.freeze(["closingOdds"]),
  oddsClosing: Object.freeze(["oddsClosing"]),
  moClosing: Object.freeze(["marketOdds", "closing"])
});

export const TIP_PAYLOAD_PATHS = Object.freeze({
  recommended: Object.freeze(["recommended"]),
  probs: Object.freeze(["probs"]),
  score: Object.freeze(["score"]),
  confidence: Object.freeze(["confidence"]),
  kickoffAt: Object.freeze(["kickoffAt"]),
  mmModelVersion: Object.freeze(["modelMeta", "modelVersion"]),
  closingOdds: Object.freeze(["closingOdds"]),
  oddsClosing: Object.freeze(["oddsClosing"]),
  moClosing: Object.freeze(["marketOdds", "closing"])
});

export default { ANALYTICS_PAYLOAD_PATHS, TIP_PAYLOAD_PATHS };
