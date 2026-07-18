-- Extend privilege guard so clients cannot forge Stripe identity columns.

create or replace function public.protect_profiles_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  db_role text := coalesce(current_setting('role', true), '');
begin
  if jwt_role = 'service_role' or db_role = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_blocked is distinct from old.is_blocked
     or new.tier is distinct from old.tier
     or new.subscription_expires_at is distinct from old.subscription_expires_at
     or new.premium_trial_activated_at is distinct from old.premium_trial_activated_at
     or new.ultra_trial_activated_at is distinct from old.ultra_trial_activated_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
  then
    raise exception 'profiles privilege columns are immutable for clients';
  end if;

  return new;
end;
$$;
