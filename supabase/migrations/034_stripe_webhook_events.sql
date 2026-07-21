-- Stripe webhook idempotency ledger. Stripe redelivers events on timeout/retry;
-- without a ledger, a duplicate delivery could reprocess the same event twice.
-- applySubscriptionToProfile() is a stateless upsert (sets absolute subscription
-- state from the Stripe object each time), so double-delivery was already
-- self-correcting -- this closes the gap properly rather than relying on that
-- as the only safeguard, and stops a slow/retried handler run from doing
-- duplicate Stripe API calls (subscriptions.retrieve) for the same event.

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
drop policy if exists "service_only_stripe_webhook_events" on public.stripe_webhook_events;
create policy "service_only_stripe_webhook_events"
on public.stripe_webhook_events
for all
using (false);
