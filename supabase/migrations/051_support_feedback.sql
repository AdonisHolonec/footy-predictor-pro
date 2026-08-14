-- 051: support tickets, their conversation, and product feedback.
--
-- Three tables, not four. A support ticket needs a thread and a lifecycle; a
-- piece of feedback is written once and read by us. Forcing feedback into the
-- ticket model would give every row exactly one message and a status nobody
-- ever moves.
--
-- A prediction report is NOT a fourth table either: it is a ticket with
-- category 'prediction' (or 'gsb') and the fixture identifiers in `context`.
-- Same inbox, same statuses, same replies.
--
-- NO EMAIL COLUMN, DELIBERATELY. `profiles` has never carried one — an address
-- lives in auth.users and is reachable only through the service role. Copying it
-- next to user-submitted text would put it behind RLS written by hand rather
-- than behind Supabase's own auth schema, and a support table is exactly the
-- kind of thing that later grows an admin export.
--
-- Migration 047's event trigger enables RLS on every new table automatically, so
-- these three are closed the moment they exist. The policies below are still
-- written out explicitly: relying on an implicit deny-all leaves no record of
-- what was intended to be reachable.

-- ---------------------------------------------------------------- tickets ---

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  category text not null check (
    category in ('general', 'prediction', 'gsb', 'technical', 'billing', 'account', 'other')
  ),
  subject text not null check (length(btrim(subject)) between 1 and 200),
  status text not null default 'open' check (
    status in ('open', 'in_progress', 'waiting_user', 'resolved', 'closed')
  ),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  contact_requested boolean not null default false,
  -- Whatever the UI knew when the ticket was opened: fixtureId, leagueId,
  -- market, recommendation — or the special-bet identifiers. jsonb because the
  -- shape differs per category and must not force a migration to grow.
  context jsonb,
  page_route text check (page_route is null or length(page_route) <= 200),
  app_version text check (app_version is null or length(app_version) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_created_idx
  on public.support_tickets (user_id, created_at desc);

-- The admin inbox reads by status, newest first (increment 4).
create index if not exists support_tickets_status_created_idx
  on public.support_tickets (status, created_at desc);

comment on table public.support_tickets is
  'User-submitted support requests. Prediction and Special Bet reports are tickets with category prediction/gsb and the identifiers in context.';
comment on column public.support_tickets.context is
  'Client-supplied contextual metadata (fixtureId, leagueId, market, specialBetId...). User-owned data — never treat as trusted server metadata.';

-- --------------------------------------------------------------- messages ---

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_role text not null check (author_role in ('user', 'admin')),
  body text not null check (length(btrim(body)) between 1 and 5000),
  is_internal_note boolean not null default false,
  created_at timestamptz not null default now(),
  -- An internal note is a note between admins. A user-authored one is a
  -- contradiction, and the check makes it unrepresentable rather than merely
  -- unreachable through the current API.
  constraint support_messages_internal_note_is_admin
    check (is_internal_note = false or author_role = 'admin')
);

create index if not exists support_messages_ticket_created_idx
  on public.support_messages (ticket_id, created_at);

comment on table public.support_messages is
  'Append-only conversation on a ticket. Internal notes are admin-only and never exposed to the ticket owner.';

-- --------------------------------------------------------------- feedback ---

create table if not exists public.feedback_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  category text not null check (
    category in ('feature', 'ux', 'prediction', 'gsb', 'performance', 'other')
  ),
  message text not null check (length(btrim(message)) between 1 and 5000),
  rating smallint check (rating is null or rating between 1 and 5),
  -- NPS-shaped: 0-10, where the question is "how likely are you to recommend".
  would_recommend smallint check (would_recommend is null or would_recommend between 0 and 10),
  contact_requested boolean not null default false,
  context jsonb,
  created_at timestamptz not null default now()
);

create index if not exists feedback_entries_user_created_idx
  on public.feedback_entries (user_id, created_at desc);

create index if not exists feedback_entries_category_created_idx
  on public.feedback_entries (category, created_at desc);

comment on table public.feedback_entries is
  'Product feedback. Write-once from the user; no conversation and no status — see support_tickets for anything that needs a reply.';

-- ------------------------------------------------------------- updated_at ---

-- Per-table, matching set_profiles_updated_at / set_predictions_history_updated_at.
-- This project has no generic helper and the 033-era hardening requires an
-- explicit search_path on every function, so a new one is written rather than an
-- existing trigger being repointed.
create or replace function public.set_support_tickets_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_support_tickets_updated_at on public.support_tickets;
create trigger trg_support_tickets_updated_at
before update on public.support_tickets
for each row execute function public.set_support_tickets_updated_at();

-- -------------------------------------------------------------------- RLS ---

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.feedback_entries enable row level security;

-- Tickets: the owner reads and opens. No UPDATE policy and no DELETE policy at
-- all, so status, priority and history are not the user's to rewrite — the
-- absence is the enforcement, exactly as special_bets does it in 043.
drop policy if exists "users_read_own_support_tickets" on public.support_tickets;
create policy "users_read_own_support_tickets"
on public.support_tickets
for select
using (auth.uid() = user_id);

drop policy if exists "users_open_own_support_tickets" on public.support_tickets;
create policy "users_open_own_support_tickets"
on public.support_tickets
for insert
with check (auth.uid() = user_id);

-- Messages: visible only on a ticket you own, and only if they are not internal
-- notes. The note filter lives in the policy rather than in the query so a
-- forgotten `.eq("is_internal_note", false)` in some future handler cannot leak
-- one.
drop policy if exists "users_read_own_support_messages" on public.support_messages;
create policy "users_read_own_support_messages"
on public.support_messages
for select
using (
  is_internal_note = false
  and exists (
    select 1
    from public.support_tickets t
    where t.id = support_messages.ticket_id
      and t.user_id = auth.uid()
  )
);

-- Replies: on your own ticket, as yourself, never as an internal note. All three
-- conditions are in WITH CHECK, so a crafted insert cannot claim to be an admin.
drop policy if exists "users_reply_to_own_support_tickets" on public.support_messages;
create policy "users_reply_to_own_support_tickets"
on public.support_messages
for insert
with check (
  author_role = 'user'
  and is_internal_note = false
  and exists (
    select 1
    from public.support_tickets t
    where t.id = support_messages.ticket_id
      and t.user_id = auth.uid()
  )
);

-- Feedback: write once, read your own. No UPDATE/DELETE — nothing in this
-- product lets a user edit submitted content, and feedback is no exception.
drop policy if exists "users_read_own_feedback" on public.feedback_entries;
create policy "users_read_own_feedback"
on public.feedback_entries
for select
using (auth.uid() = user_id);

drop policy if exists "users_submit_own_feedback" on public.feedback_entries;
create policy "users_submit_own_feedback"
on public.feedback_entries
for insert
with check (auth.uid() = user_id);

-- ----------------------------------------------------------------- grants ---

-- 045 already grants these role-wide in `public`; repeating them for the three
-- new tables keeps the migration readable on its own and is a no-op where 045
-- has run. RLS is the gate, not the grant.
grant select on public.support_tickets, public.support_messages, public.feedback_entries to anon;
grant select, insert, update, delete
  on public.support_tickets, public.support_messages, public.feedback_entries
  to authenticated;
grant all privileges
  on public.support_tickets, public.support_messages, public.feedback_entries
  to service_role;

-- The trigger function is called by the trigger, never by a client. 032/046
-- established that execute is granted one function at a time and never to
-- PUBLIC; a trigger function needs no grant at all beyond the owner's.
revoke all on function public.set_support_tickets_updated_at() from public;
