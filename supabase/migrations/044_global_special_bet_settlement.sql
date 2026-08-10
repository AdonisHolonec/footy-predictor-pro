-- 044: settled odds for Global Special Bet.
--
-- `total_odds` stays exactly what it has always been: the price promised when
-- the bet was generated. It is never rewritten — rewriting it would erase what
-- the user was actually offered.
--
-- `settled_total_odds` is what the bet resolved at, which differs from the
-- original only when a leg voids (a void contributes 1.00). Convention:
--   won     -> product of the surviving legs, voids counted as 1.00
--   void    -> 1.000 (every leg voided)
--   lost    -> NULL, because there is no payout to express
--   pending -> NULL, because there is no answer yet
--
-- Additive: an existing row keeps NULL until settlement touches it, and nothing
-- reads this column before then.

alter table public.special_bets
  add column if not exists settled_total_odds numeric(10, 3);

comment on column public.special_bets.settled_total_odds is
  'Odds the bet resolved at (voids count as 1.00). NULL while pending and for lost bets. total_odds remains the original snapshot and is never rewritten.';

-- Settlement scans by status; the partial index keeps that scan proportional to
-- the work left rather than to the whole table.
create index if not exists special_bets_pending_settlement_idx
  on public.special_bets (bet_date desc)
  where status = 'pending';
