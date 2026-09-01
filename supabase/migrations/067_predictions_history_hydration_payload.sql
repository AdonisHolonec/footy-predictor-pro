-- 067: give prediction HYDRATION somewhere to read from that is not raw_payload.
--
-- The last full-payload transport left in the product. `/api/history` with
-- `mine=1` and `view=prediction-list` feeds usePredictionsCache
-- .rehydratePredictionsFromHistory() -> setPreds, and it currently reads the
-- whole document: readPredictionsForHydration() calls
-- readPredictionsHistoryForUser() (RPC, no `.select()`) and narrows the result
-- in JavaScript AFTER transport. The response is small; the READ is not.
--
-- The same distinction 055 measured, on the same table:
--
--   with raw_payload->'key'   Buffers: shared hit=10941   1822.232 ms
--   scalar columns only       Buffers: shared hit=411        0.917 ms
--
-- `raw_payload->key` narrows what crosses the wire, not what Postgres has to
-- read. Only moving the fields out of the document removes the detoast.
--
-- WHY ONE JSONB COLUMN AND NOT TEN SCALARS: the fields hydration needs are
-- nested objects — predictions, marketOdds, confidenceEngine, teamContext,
-- valueEngine — which have no scalar form. 055 already established jsonb
-- promotion on this table with card_markets / card_market_validations, and this
-- follows it. Measured on 184 real production rows, the projection this column
-- stores is 244,969 -> 12,955 B/row (94.7% smaller), so the read goes from
-- detoasting ~245 KB per row to ~13 KB.
--
-- IMMUTABLE BY CONSTRUCTION. predictionsHistory.js:309 defines what may change
-- after creation:
--
--   LIVE_RESULT_FIELDS = status, score, marketResults, cardMarketValidations,
--                        momentum, evaluation, elapsed
--
-- and every one of those that hydration reads ALREADY has its own column
-- (match_status, score_home/away, corners_total/shots_on_target_total,
-- card_market_validations) — except `momentum`, which is deliberately NOT
-- stored here. A column written once at creation needs no settlement writer to
-- maintain it, so the settlement paths are untouched by this work. `momentum`
-- is the one known gap and is left to the read cutover to resolve, because
-- carrying a live-updated field in an immutable column would be a lie.
--
-- raw_payload REMAINS AUTHORITATIVE. This is a derived cache column. Nothing
-- reads it — the read cutover is a separate change — so this migration is inert
-- on deploy and a plain DROP COLUMN to revert.
--
-- NO BACKFILL HERE, for exactly 055's reason: building this column for existing
-- rows means detoasting every one of them, which is the operation whose
-- statement_timeout this work exists to remove. It cannot run as an unchunked
-- statement during deploy. The backfill ships separately so it can be chunked,
-- scheduled and watched.

alter table if exists public.predictions_history
  add column if not exists hydration_payload jsonb;

-- No index, and no constraint. This column is projected by the hydration read
-- and never filtered, ordered or joined on — indexing it would cost write
-- throughput on every prediction for no read benefit. Same reasoning as 055's
-- seven and 059's six.

comment on column public.predictions_history.hydration_payload is
  'Derived cache: the immutable subset of the prediction-board contract (server-utils/hydrationPayloadColumn.js). raw_payload stays authoritative. Written at creation only; never by settlement. Excludes momentum, which is live-updated.';
