-- Stripe billing identity on profiles (service role updates via webhooks).

alter table if exists public.profiles
  add column if not exists stripe_customer_id text null,
  add column if not exists stripe_subscription_id text null;

create unique index if not exists profiles_stripe_customer_id_uidx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists profiles_stripe_subscription_id_idx
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on column public.profiles.stripe_customer_id is 'Stripe Customer id; set by billing API / webhook.';
comment on column public.profiles.stripe_subscription_id is 'Active Stripe Subscription id; cleared on cancel.';
