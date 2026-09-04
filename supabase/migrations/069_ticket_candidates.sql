-- 069: the ticket-generation projection column.
--
-- 068 taught special_bets to HOLD a GLOBAL bet. Nothing can create one yet, by
-- design. This migration supplies the first half of what was missing: a source
-- a candidate query can read without touching raw_payload. The RPC that writes
-- a GLOBAL bet, and the loader that reads this column, arrive in the next
-- increment.
--
-- ── WHY A NEW COLUMN AND NOT hydration_payload ───────────────────────────────
-- collectGlobalCandidates() reads valueEngine.markets, modelMeta.dataQuality,
-- insufficientData, recommended.confidence and teams. hydration_payload carries
-- ONE market — its narrowing rule keeps "the FIRST entry of markets that looks
-- like a cards market" — and no modelMeta at all. A query fed from it would see
-- one cards market per fixture and then reject every one, because a null
-- dataQuality sends each market to rejected.missingData. Measured on 150
-- production fixtures: 188 markets per fixture, of which hydration keeps 1.
--
-- raw_payload is the thing being avoided. At ~303 KB a row, an unscoped 500-row
-- candidate query is ~151 MB in one statement — the shape that produced the
-- 57014 statement timeouts.
--
-- Measured for THIS column on the same 150 fixtures: p50 6.9 KB, avg 10.1 KB,
-- p95 28.3 KB, max 32.1 KB. A 500-row query is ~5.1 MB, smaller than the same
-- query over hydration_payload (~6.9 MB) and 30x below raw.
--
-- ── THE ONE RULE THAT MOVES TO WRITE TIME ────────────────────────────────────
-- `recommendable === true`, and nothing else. It removes 92.7% of markets
-- (23,025 of 24,833 measured) and it is a flag the model already computed, not
-- a comparison against a tunable constant. Odds floor, probability floor, model
-- edge, settleable families, quarter lines, tradable, identity, kickoff,
-- ranking and diversification all stay at read time, over the complete market
-- objects stored here.
--
-- That is what makes a threshold change a config edit rather than a backfill. A
-- projection storing the winning candidate instead would be 301 B rather than
-- ~10 KB, but raising MIN_SELECTION_ODD to 1.60 made 103 of 115 stored winners
-- wrong and 2.00 made all 115 wrong, because probability-first ranking
-- systematically picks the shortest-priced leg. Verified: 665/665 identical
-- candidates against the raw path, and identical pools under six simulated rule
-- changes.
--
-- NO DEFAULT, NULL ALLOWED. Existing rows stay NULL until a backfill runs, and
-- the future loader will SKIP a NULL row rather than fall back to raw_payload.
-- A fallback would quietly reintroduce the exact egress pattern this removes.
--
-- NO INDEX YET, deliberately. The query this column exists for does not exist
-- until the loader ships, so any index now would be a guess at its shape. It
-- belongs with the reader that justifies it, in the same increment, where its
-- predicate can be written against a real query plan rather than an intention.

alter table public.predictions_history
  add column if not exists ticket_candidates jsonb;

comment on column public.predictions_history.ticket_candidates is
  'Ticket-generation projection: the complete valueEngine.markets entries with recommendable = true, plus dataQuality, insufficientData, confidence, teams, and the examined/notRecommendable counts of the discarded population. ONLY the recommendable gate is applied here; every other eligibility rule stays at read time. NULL means not yet backfilled — readers skip the row, they never fall back to raw_payload.';

/*
  ROLLBACK.

    alter table public.predictions_history drop column if exists ticket_candidates;

  Safe at any time. Nothing reads this column in this increment, and the reader
  that arrives next treats absence as "no candidates" rather than an error, so a
  rollback degrades the GLOBAL pool to empty rather than breaking a path.

  DEPLOY ORDER. Safe ahead of any reader: the live writer begins populating it
  for newly predicted fixtures immediately, existing rows stay NULL until a
  backfill, and no query selects it yet. The settlement writers build partial
  updates and never mention this column, so `INSERT ... ON CONFLICT DO UPDATE`
  leaves it untouched once written — the same immutability hydration_payload
  relies on.
*/
