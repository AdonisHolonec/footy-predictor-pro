-- 066: analytics eligibility for the RECOMMENDED pick, kept strictly apart from
-- its settlement.
--
-- WHY (Aug-2026 historical contamination audit, measured on a 1,047-row snapshot):
--
-- Between 2026-08-27T18:13:54Z and 2026-08-29T19:46:31Z the candidate pipeline
-- accepted bookmaker "Total Shots" boards quoted at a shots-on-target scale —
-- e.g. Over 10.5 on a fixture whose model expected 26.9 total shots. 69 such
-- rows persisted. They were SETTLED CORRECTLY against the declared family
-- (Shots Over 10.5 with 25 total shots is a win, and `validation` says so), and
-- they won 66 of 66 settled with zero losses. A certainty sold at a median 1.42
-- price is not a market position, so counting them inflated every recommendation
-- aggregate:
--
--   recommended success rate   70.65% -> 68.51%   (validation column, RPC below)
--   headline 4-slot win rate   73.19% -> 72.59%
--   user-facing ROI            -4.03% -> -10.24%
--   backtest tip-track ROI     -3.99% -> -10.20%
--
-- PRs #213/#214 stopped new malformed rows (0 generated after either deploy).
-- This migration addresses only the history they left behind.
--
-- WHAT THIS IS NOT:
--
-- It does NOT re-grade anything. `validation`, its check constraint from 049
-- ('pending','win','loss','push','half_win','half_loss'), `card_market_validations`,
-- `card_markets` and `raw_payload` are all untouched, here and by the backfill.
-- Invalidity is NOT encoded as a loss, a push, a deletion or a fake settlement
-- state — those would falsify a grade that is correct. The historical row stays
-- immutable evidence of what the system stored and showed.
--
-- NULLABILITY IS THE POINT:
--
--   TRUE   classified valid — counts in performance analytics
--   FALSE  classified invalid — excluded from RECOMMENDED-slot analytics only
--   NULL   not yet classified (every row predating the backfill)
--
-- There is deliberately NO DEFAULT. Every consumer filters `IS NOT FALSE`, so a
-- NULL row keeps counting exactly as it does today: applying this migration
-- alone moves no published number. Only the separate, chunked backfill does,
-- and only for rows it has positively classified. A DEFAULT TRUE would instead
-- assert a classification that was never computed.
--
-- The other three slots of an affected fixture (goals / corners / shots) remain
-- fully countable — the flag describes the recommendation, not the fixture.
--
-- NO INDEX, deliberately. The obvious candidate — a partial index on the FALSE
-- rows — cannot serve a single consumer: Postgres uses a partial index only when
-- the query predicate implies the index predicate, and every read here is
-- `IS NOT FALSE`, which does not imply `IS FALSE`. It would be a few pages that
-- nothing plans against. The reads are also never selective on this column: they
-- are full-window aggregates that already scan the row set. An index earns its
-- place when a query needs it; this one would exist only to look thorough.
--
-- NO CHECK on recommended_market_invalid_reason, for migration 060's reason,
-- which applies unchanged: a rejected value fails the entire bulk upsert and
-- takes Predict persistence down with it. The legal set is frozen in JS
-- (RECOMMENDED_MARKET_INVALID_REASONS) and written from that constant alone, so
-- the constraint would guard against a code path that cannot produce a bad value
-- while adding a way for a future reason to break writes before its migration
-- lands. Analytics reads the boolean; the reason is diagnostic text.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS and CREATE OR REPLACE
-- FUNCTION (which preserves the existing grants). No data is written, no row is
-- deleted, nothing is rewritten. Rollback is a code revert: until consumers
-- ship, an unpopulated column is indistinguishable from today.

alter table public.predictions_history
  add column if not exists recommended_market_valid boolean,
  add column if not exists recommended_market_invalid_reason text;

comment on column public.predictions_history.recommended_market_valid is
  'ANALYTICS ELIGIBILITY of the recommended pick — never its settlement. TRUE = counts in performance stats; FALSE = the recommendation was not a real market position (see recommended_market_invalid_reason) and its RECOMMENDED slot is excluded from success rate / ROI; NULL = not yet classified, and still counts. Settlement lives in `validation` and is never changed by this column.';

comment on column public.predictions_history.recommended_market_invalid_reason is
  'Why recommended_market_valid is FALSE. Currently the single value ''line_off_model_scale'': the bookmaker line sat below 0.60 x the model lambda_total for the recommendation''s own market (the PR #214 guard predicate). NULL whenever recommended_market_valid is TRUE or NULL.';

-- The per-user/per-league counter is the one aggregate whose ONLY outcome is the
-- recommended pick (one row = one outcome), so an invalid recommendation is
-- excluded from the row entirely here. Aggregates that count four market slots
-- per fixture must instead drop the recommended slot alone; that lives in JS.
--
-- Body is migration 011's, unchanged except for the `is not false` guards.
create or replace function public.performance_counter_by_user_league (p_days integer default 30)
returns table (
  user_id uuid,
  league_id integer,
  league_name text,
  wins bigint,
  losses bigint,
  pending bigint,
  settled bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.user_id,
    coalesce(h.league_id, 0)::integer as league_id,
    coalesce(h.league_name, '')::text as league_name,
    count(*) filter (where h.validation = 'win' and h.recommended_market_valid is not false)::bigint as wins,
    count(*) filter (where h.validation = 'loss' and h.recommended_market_valid is not false)::bigint as losses,
    count(*) filter (where h.validation = 'pending' and h.recommended_market_valid is not false)::bigint as pending,
    count(*) filter (where h.validation in ('win', 'loss') and h.recommended_market_valid is not false)::bigint as settled
  from public.user_prediction_fixtures u
  inner join public.predictions_history h on h.fixture_id = u.fixture_id
  where h.kickoff_at >= (timezone('utc', now()) - (greatest(1, least(coalesce(p_days, 30), 120))) * interval '1 day')
  group by u.user_id, h.league_id, h.league_name;
$$;

revoke all on function public.performance_counter_by_user_league (integer) from public;
grant execute on function public.performance_counter_by_user_league (integer) to service_role;
