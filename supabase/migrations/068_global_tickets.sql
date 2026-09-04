-- 068: teach special_bets to hold a GLOBAL bet, without making one generatable yet.
--
-- Today every row in this table is one user's ticket, built from that user's
-- favourite leagues. 043's own header says so: "the best selections ACROSS the
-- fixtures of a user's favourite leagues". A Global Bet is a different thing —
-- one ticket, built by an admin from the whole eligible prediction set, shown to
-- everyone — and the current schema cannot express it at all:
--
--   user_id      NOT NULL        → an unowned bet is impossible
--   league_ids   NOT NULL        → a bet that is not league-scoped is impossible
--   identity idx (user_id, …)    → identity is defined per user
--
-- So the distinction goes in the schema rather than in application code, for the
-- same reason 043 put idempotency in the database: a rule that lives only in
-- JavaScript is a rule a second caller can skip.
--
--   USER    bet_type='USER'    user_id NOT NULL  league scope required
--   GLOBAL  bet_type='GLOBAL'  user_id NULL      league scope not applicable
--
-- FOUNDATION ONLY, exactly like 052. The schema accepts a GLOBAL row; nothing
-- writes one. There is no INSERT policy, no RPC and no application path — those
-- arrive in the next increment. Every existing row becomes 'USER' through the
-- column defaults, which is precisely what it already was: no backfill, no
-- UPDATE, no reinterpretation of anyone's data.
--
-- VISIBILITY IS NOT STATUS. `published_at` is added rather than folding drafts
-- into `status`, because `status` means settlement (pending/won/lost/void) and a
-- draft is not a settlement state. Overloading it would make "unpublished" and
-- "ungraded" the same value, and settlement would have to guess which was meant.
--
--   published_at IS NULL      draft   — admin/service only
--   published_at IS NOT NULL  visible — every authenticated user

alter table public.special_bets
  add column if not exists bet_type text not null default 'USER';

alter table public.special_bets
  add column if not exists bet_source text not null default 'USER_PREDICTIONS';

alter table public.special_bets
  add column if not exists published_at timestamptz;

comment on column public.special_bets.bet_type is
  'USER = one user''s ticket, built from their leagues. GLOBAL = one admin-built ticket over the whole eligible prediction set, shown to everyone. Existing rows default to USER.';
comment on column public.special_bets.bet_source is
  'Which prediction set the snapshot was built from. USER_PREDICTIONS follows the user''s league scope; ADMIN_PREDICTIONS is admin-wide and carries no user state.';
comment on column public.special_bets.published_at is
  'GLOBAL visibility, not settlement. NULL = draft, admin-only. Non-NULL = readable by authenticated users. Always NULL for USER rows, whose visibility is ownership.';

-- Ownership becomes optional. The FK and its ON DELETE CASCADE are untouched:
-- dropping NOT NULL does not weaken referential integrity, and a USER row still
-- disappears with its owner.
alter table public.special_bets
  alter column user_id drop not null;

alter table public.special_bets
  alter column league_ids drop not null;

alter table public.special_bets
  alter column league_scope drop not null;

-- The old unconditional rule is replaced, not merely relaxed: "every bet has at
-- least one league" is still true of every USER bet, and is false by definition
-- of a GLOBAL one.
alter table public.special_bets
  drop constraint if exists special_bets_leagues_present;

alter table public.special_bets
  add constraint special_bets_type_allowed check (bet_type in ('USER', 'GLOBAL'));

alter table public.special_bets
  add constraint special_bets_source_allowed check (bet_source in ('USER_PREDICTIONS', 'ADMIN_PREDICTIONS'));

-- Type, owner, source and league scope are ONE fact, so they are constrained as
-- one. A GLOBAL row carrying a user_id, or a USER row without an owner, is not a
-- row with an odd field — it is a row whose audience cannot be determined, and
-- the read policies below must never have to guess.
--
-- Written as a CASE for the same reason 052 was: the obvious
--   (bet_type='USER' and …) or (bet_type='GLOBAL' and …)
-- does not reject a row whose bet_type is neither, and special_bets_type_allowed
-- being a separate constraint is no defence — constraints are not ordered, and a
-- future edit could drop it. The ELSE false branch is what closes that.
alter table public.special_bets
  add constraint special_bets_identity_coherent check (
    case bet_type
      when 'USER' then
        user_id is not null
        and bet_source = 'USER_PREDICTIONS'
        and league_ids is not null
        and array_length(league_ids, 1) >= 1
        and league_scope is not null
      when 'GLOBAL' then
        user_id is null
        and bet_source = 'ADMIN_PREDICTIONS'
      else false
    end
  );

-- Separate from the coherence rule above on purpose: this is the visibility
-- axis, not the ownership axis, and it must be droppable on its own if
-- publishing semantics ever change. A USER bet has no publish step — it is
-- visible to its owner the moment it exists — so a timestamp there would be a
-- value nothing reads and every future author would have to reason about.
alter table public.special_bets
  add constraint special_bets_published_only_global check (
    bet_type = 'GLOBAL' or published_at is null
  );

/*
  IDENTITY / UNIQUENESS.

  `special_bets_identity_idx` — as 052 left it, over
  (user_id, bet_date, variant, league_scope, bet_kind, coalesce(system_k, 0)) —
  IS DELIBERATELY UNTOUCHED. It is the reason a double tap, a retry or two racing
  devices cannot produce two tickets, and create_global_special_bet names those
  exact expressions as its ON CONFLICT target. Rebuilding it as a partial index
  would break that: Postgres can only infer an arbiter from a partial index when
  the statement repeats its WHERE clause, and the RPC's ON CONFLICT has none. The
  RPC would fail with "no unique or exclusion constraint matching the ON CONFLICT
  specification" on every single call. So USER idempotency is preserved by
  leaving it alone, not by reproducing it.

  That index cannot constrain GLOBAL rows — user_id and league_scope are NULL
  there, and NULLs are distinct in a unique index — so GLOBAL gets its own,
  keyed on what actually identifies an admin ticket: no user, no league scope,
  therefore a day plus a shape.

  `coalesce(system_k, 0)` rather than the bare column, for precisely the reason
  052 spells out one file over: a combo's system_k is NULL, and a bare nullable
  column would make every GLOBAL combo look unique. That failure is silent — no
  error, just duplicate tickets — which is why it is asserted rather than
  assumed.
*/
create unique index if not exists special_bets_global_identity_idx
  on public.special_bets (bet_date, variant, bet_kind, (coalesce(system_k, 0)))
  where bet_type = 'GLOBAL';

-- The GLOBAL list is "newest first, all of them" — it has no user to key on, so
-- special_bets_user_date_idx cannot serve it.
create index if not exists special_bets_global_date_idx
  on public.special_bets (bet_date desc)
  where bet_type = 'GLOBAL';

/*
  RLS.

  The existing policies are `auth.uid() = user_id`. A GLOBAL row has user_id
  NULL, and `auth.uid() = NULL` is NULL rather than true, so a GLOBAL row matches
  NO existing policy and is invisible to everyone — including through the
  selections join. Publishing therefore needs its own policy; it cannot be
  inherited.

  Policies are permissive and OR together, so after this migration an
  authenticated user sees: their own USER bets (unchanged) OR any PUBLISHED
  GLOBAL bet. A draft matches neither.

  `to authenticated` is explicit. The owner policies rely on auth.uid() being
  NULL for anon, which is self-limiting; a bet_type predicate is not, so without
  the role restriction a published GLOBAL bet would be readable by anyone holding
  the anon key.

  There is still no INSERT or UPDATE policy on either table, for either type.
  Writes remain reachable only through the service role, which bypasses RLS —
  that is also how admin reads and manages drafts, so no draft policy is needed
  or wanted here. Adding one would be the only way a user could see a draft.
*/
drop policy if exists "authenticated_read_published_global_special_bets" on public.special_bets;
create policy "authenticated_read_published_global_special_bets"
on public.special_bets
for select
to authenticated
using (bet_type = 'GLOBAL' and published_at is not null);

drop policy if exists "authenticated_read_published_global_selections" on public.special_bet_selections;
create policy "authenticated_read_published_global_selections"
on public.special_bet_selections
for select
to authenticated
using (
  exists (
    select 1
    from public.special_bets b
    where b.id = special_bet_selections.special_bet_id
      and b.bet_type = 'GLOBAL'
      and b.published_at is not null
  )
);

/*
  ROLLBACK.

  Reversible ONLY while no GLOBAL row exists. Restoring `user_id NOT NULL` fails
  against a GLOBAL row by construction, so a rollback after any admin ticket has
  been generated must delete those rows first — a deliberate data decision, not
  something to fold into a down-migration:

    drop policy if exists "authenticated_read_published_global_selections" on public.special_bet_selections;
    drop policy if exists "authenticated_read_published_global_special_bets" on public.special_bets;
    drop index if exists public.special_bets_global_date_idx;
    drop index if exists public.special_bets_global_identity_idx;
    -- special_bets_identity_idx is NOT recreated here: it was never dropped.
    alter table public.special_bets drop constraint if exists special_bets_published_only_global;
    alter table public.special_bets drop constraint if exists special_bets_identity_coherent;
    alter table public.special_bets drop constraint if exists special_bets_source_allowed;
    alter table public.special_bets drop constraint if exists special_bets_type_allowed;
    alter table public.special_bets add constraint special_bets_leagues_present
      check (array_length(league_ids, 1) >= 1);
    alter table public.special_bets alter column league_scope set not null;
    alter table public.special_bets alter column league_ids set not null;
    alter table public.special_bets alter column user_id set not null;   -- fails if any GLOBAL row remains
    alter table public.special_bets drop column if exists published_at;
    alter table public.special_bets drop column if exists bet_source;
    alter table public.special_bets drop column if exists bet_type;

  DEPLOY ORDER. Safe ahead of any application code: nothing writes bet_type, so
  every insert keeps taking the USER default, and create_global_special_bet —
  which still rejects a NULL p_user_id and NULL p_league_ids — remains the only
  write path in existence.
*/
