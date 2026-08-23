-- 058: Persist per-market sample counters on team_market_rolling (Cards C1).
--
-- WHY. `aggregateRollingForTeam` already counts, per team, how many matches carried a
-- REAL value for each statistic family (samples_by_market: corners / cards / cards_home /
-- cards_away / sot / shots_total). Until now that object was stripped at upsert because
-- it had no column, so a reloaded row knew only `matches_sampled` — the MAXIMUM across
-- families. Corners and shots can borrow that number safely (the provider ships them for
-- nearly every covered fixture); cards cannot (a fixture can carry corners and no
-- discipline data), so `marketSampleCount` deliberately fails closed to 0 for cards when
-- the counter is absent. Consequence: every persisted cards_*_avg fell below
-- MIN_MARKET_SAMPLES and `deriveMarketLambdas("cards")` always returned insufficient_data.
-- The averages were written and never usable.
--
-- WHAT. One additive, nullable jsonb column carrying exactly that object. No existing
-- column changes meaning; `matches_sampled` is untouched and still what non-cards families
-- fall back to when the counter is null (rows written before the next rebuild).
--
-- NULL means "counter not recorded", never "zero matches". Readers must not coerce it.
--
-- Rollback:
--   alter table public.team_market_rolling drop column if exists samples_by_market;

alter table public.team_market_rolling
  add column if not exists samples_by_market jsonb;

comment on column public.team_market_rolling.samples_by_market is
  'Per-family count of matches with a REAL observed value: {corners, cards, cards_home, cards_away, sot, shots_total}. Written by persistTeamMarketRolling. NULL = not recorded (pre-058 row), never zero. Cards λ trusts cards_*_avg only when this counter clears MIN_MARKET_SAMPLES.';
