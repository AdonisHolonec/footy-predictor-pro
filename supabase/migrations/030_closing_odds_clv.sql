-- Closing-line store for CLV (audit #26–27).
-- Opening odds remain in odds_*; closing is captured near kickoff and never overwrites them.

alter table public.predictions_history
  add column if not exists closing_odds_home numeric,
  add column if not exists closing_odds_draw numeric,
  add column if not exists closing_odds_away numeric,
  add column if not exists closing_odds_captured_at timestamptz;

create index if not exists predictions_history_closing_capture_idx
  on public.predictions_history (kickoff_at desc)
  where closing_odds_captured_at is null;

alter table public.backtest_snapshots
  add column if not exists avg_clv numeric,
  add column if not exists clv_count integer not null default 0,
  add column if not exists clv_beat_rate numeric;
