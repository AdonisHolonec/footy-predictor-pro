-- P0: enable RLS + deny-all on crown-jewel tables.
-- Server access continues via service role (bypasses RLS).

alter table if exists public.predictions_history enable row level security;
drop policy if exists "service_only_predictions_history" on public.predictions_history;
create policy "service_only_predictions_history"
on public.predictions_history
for all
using (false);

alter table if exists public.backtest_snapshots enable row level security;
drop policy if exists "service_only_backtest_snapshots" on public.backtest_snapshots;
create policy "service_only_backtest_snapshots"
on public.backtest_snapshots
for all
using (false);

alter table if exists public.notification_dispatch_log enable row level security;
drop policy if exists "service_only_notification_dispatch_log" on public.notification_dispatch_log;
create policy "service_only_notification_dispatch_log"
on public.notification_dispatch_log
for all
using (false);
