-- Monetization tiers + trial windows
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS premium_trial_activated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ultra_trial_activated_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_tier_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_tier_check
      CHECK (tier IN ('free', 'premium', 'ultra'));
  END IF;
END $$;
