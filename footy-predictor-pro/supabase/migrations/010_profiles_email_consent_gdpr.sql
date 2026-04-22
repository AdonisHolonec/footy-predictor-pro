-- GDPR: record when the user explicitly consented to email notifications.

alter table public.profiles
  add column if not exists notify_email_consent_at timestamptz null;

comment on column public.profiles.notify_email_consent_at is 'When the user acknowledged privacy terms for email alerts (GDPR audit).';
