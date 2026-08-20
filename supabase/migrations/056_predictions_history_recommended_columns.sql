-- 056: the four recommendation-metadata fields the History LIST still reads
-- out of raw_payload, promoted to real columns.
--
-- 055 promoted the seven fields the list needed at the time and deliberately
-- stopped there. The Phase 4F read-cutover audit then measured what a
-- zero-JSONB list row would actually render, and these four are the entire
-- remainder — every other field the list touches is already a real column.
--
-- Measured on all 810 production rows, rebuilding the list row from columns
-- only and re-running formatRecommendedPick against the current output:
--
--   with these four            0 label differences
--   without them             163 label differences
--
-- The failure is not cosmetic. Dropping `family` re-routes the pick through
-- formatRecommendedPick's goals-line heuristic, and fixture 1490376 — a real
-- production row — renders "SOT Over 9.5 · FT" as "Over 9.5 Corners". A
-- Shots-on-Target recommendation displayed as Corners is the same class of bug
-- resolveRecommendedValidation was written to stop on the settlement side.
--
-- Source, and current population out of 810 rows:
--
--   recommended_family     raw_payload->recommended->>family      293
--   recommended_period     raw_payload->recommended->>period      163
--   recommended_scope      raw_payload->recommended->>scope       163
--   recommended_book_line  raw_payload->recommended->bookLine     147
--
-- IMMUTABLE, unlike the four settlement columns 055 added. `recommended` is
-- written once at creation and no settlement path touches it:
-- attachCardMarketsToPayload never writes it, and W3/W5/closingOddsCapture all
-- persist `{...raw}`, carrying it forward unchanged. So these are maintained by
-- the creation writer alone, and deriveMutableHistoryListColumns cannot return
-- them — the restriction is structural, not a convention.
--
-- raw_payload REMAINS AUTHORITATIVE. These are derived cache columns for the
-- transition. Nothing reads them yet: the read cutover is a separate change, so
-- this migration is inert on deploy and a plain DROP COLUMN to revert.
--
-- NO BACKFILL HERE, for the same reason as 055 — seeding these means detoasting
-- every row, which is precisely the operation whose statement_timeout this work
-- exists to remove. The existing scripts/backfill-history-list-columns.mjs is
-- extended to cover them so the seeding stays chunked, resumable and watched.

alter table if exists public.predictions_history
  add column if not exists recommended_family text,
  add column if not exists recommended_period text,
  add column if not exists recommended_scope text,
  add column if not exists recommended_book_line numeric;

-- No indexes: like 055's seven, every one of these is projected by the list and
-- never filtered or ordered on. The predicates stay kickoff_at and fixture_id.
--
-- No NOT NULL, and no default: absence is a real state. 517 rows predate
-- `family`, 647 predate the Market Identity Contract that introduced
-- period/scope, and 663 recommendations are not over/under shaped and so have
-- no line at all. A default would turn "this row has no period" into a claim
-- that it is a full-match bet.
--
-- numeric, NOT integer, for the book line. Production carries quarter lines —
-- 6.75 and 8.25 are both live values — alongside 145 half lines and 2 integer
-- lines. An integer column would silently round a real Asian quarter line onto
-- a line the bookmaker never offered, and formatLineLabel exists specifically
-- because 10.25 must never render as "10.3". Unconstrained numeric, matching
-- recommended_odd, so no precision decision is baked in here either.

comment on column public.predictions_history.recommended_family is
  'Cache of raw_payload->recommended->>family. Market family of the recommended pick; drives the History label and the icon. Immutable after creation; raw_payload is authoritative.';

comment on column public.predictions_history.recommended_period is
  'Cache of raw_payload->recommended->>period. Market Identity Contract period descriptor (full_match / first_half / ...), rendered as the compact FT/FH/SH/ET suffix. Immutable after creation; raw_payload is authoritative.';

comment on column public.predictions_history.recommended_scope is
  'Cache of raw_payload->recommended->>scope. Market Identity Contract scope descriptor (match / home / away). Immutable after creation; raw_payload is authoritative.';

comment on column public.predictions_history.recommended_book_line is
  'Cache of raw_payload->recommended->bookLine. The bookmaker line the recommendation was priced at; numeric because quarter lines (6.75, 8.25) are real. Immutable after creation; raw_payload is authoritative.';

-- Rollback, safe for as long as nothing reads these columns:
--
--   alter table public.predictions_history
--     drop column if exists recommended_family,
--     drop column if exists recommended_period,
--     drop column if exists recommended_scope,
--     drop column if exists recommended_book_line;
--
-- After the read cutover it is not: the list would lose its source. Revert the
-- reader first, then the columns.
