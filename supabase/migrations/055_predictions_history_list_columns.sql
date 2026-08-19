-- 055: give the History LIST somewhere to read from that is not raw_payload.
--
-- Measured in production, same table, same 452 rows, same kickoff_at predicate,
-- same index, same plan shape — the ONLY difference is JSON extraction:
--
--   with raw_payload->'key'   Buffers: shared hit=10941   1822.232 ms
--   scalar columns only       Buffers: shared hit=411        0.917 ms
--
-- ~23 extra buffers per row, which is the ~261 KB payload being fetched out of
-- TOAST and decompressed just to read a scoreline and a badge. `raw_payload->key`
-- narrows what crosses the wire, not what Postgres has to read, so the light
-- projection added in the view=list work could not remove this cost — only
-- moving the fields out of the document can.
--
-- These seven are the entire set the list path still needs from the document,
-- traced through HistorySection, filterByMinDisplayOdds (which gates on
-- recommended.odd) and aggregateCardMarketStats. Everything else the list reads
-- is already a real column and has been since 001.
--
-- Deliberately NOT promoted: probs and marketOdds. They are read only by
-- deriveCardMarketPicks, which resolveCardMarketValidations calls solely when
-- cardMarkets is missing; once card_markets is populated that path stops being
-- reachable from the list.
--
-- raw_payload REMAINS AUTHORITATIVE. These are derived cache columns. Nothing
-- reads them yet — the dual-write and the read cutover are separate changes, so
-- this migration is inert on deploy and a plain DROP COLUMN to revert.
--
-- NO BACKFILL HERE, and that is the one place this departs from 036, which
-- promoted referee_name and backfilled it inline. 036 copied one small text
-- field; this would have to detoast every row across seven fields in a single
-- unchunked statement that Supabase runs during deploy — precisely the
-- operation whose statement_timeout this work exists to remove. The backfill
-- ships separately so it can be chunked, scheduled, and watched.

alter table if exists public.predictions_history
  add column if not exists recommended_odd numeric,
  add column if not exists logo_home text,
  add column if not exists logo_away text,
  add column if not exists card_market_validations jsonb,
  add column if not exists card_markets jsonb,
  add column if not exists corners_total integer,
  add column if not exists shots_on_target_total integer;

-- No indexes: every one of these is projected by the list, never filtered or
-- ordered on. The predicates stay kickoff_at (predictions_history_kickoff_idx)
-- and fixture_id (the primary key). Indexing them would cost write throughput
-- on every settlement pass and buy nothing.
--
-- No NOT NULL: legacy rows genuinely predate parts of the payload, and a
-- fixture with no bookmaker quote or no logos is a real, valid row.

comment on column public.predictions_history.recommended_odd is
  'Cache of raw_payload->recommended->>odd. Read by the min-display-odds gate. Immutable after creation; raw_payload is authoritative.';

comment on column public.predictions_history.logo_home is
  'Cache of raw_payload->logos->>home. Rendered by the History list. Immutable after creation; raw_payload is authoritative.';

comment on column public.predictions_history.logo_away is
  'Cache of raw_payload->logos->>away. Rendered by the History list. Immutable after creation; raw_payload is authoritative.';

comment on column public.predictions_history.card_market_validations is
  'Cache of raw_payload->cardMarketValidations. Per-market settlement outcomes. CHANGES DURING SETTLEMENT — every writer that updates the payload key must update this column too; raw_payload is authoritative.';

comment on column public.predictions_history.card_markets is
  'Cache of raw_payload->cardMarkets. Derived per-market picks. CHANGES DURING SETTLEMENT — every writer that updates the payload key must update this column too; raw_payload is authoritative.';

comment on column public.predictions_history.corners_total is
  'Cache of raw_payload->marketResults->>cornersTotal. CHANGES DURING SETTLEMENT when fixture statistics arrive; raw_payload is authoritative.';

comment on column public.predictions_history.shots_on_target_total is
  'Cache of raw_payload->marketResults->>shotsOnTargetTotal. CHANGES DURING SETTLEMENT when fixture statistics arrive; raw_payload is authoritative.';

-- Rollback, safe for as long as nothing reads these columns:
--
--   alter table public.predictions_history
--     drop column if exists recommended_odd,
--     drop column if exists logo_home,
--     drop column if exists logo_away,
--     drop column if exists card_market_validations,
--     drop column if exists card_markets,
--     drop column if exists corners_total,
--     drop column if exists shots_on_target_total;
--
-- After the read cutover it is not: the list would lose its source. Revert the
-- reader first, then the columns.
