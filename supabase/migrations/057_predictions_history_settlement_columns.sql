-- 057: the last five settlement inputs still readable only out of raw_payload,
-- promoted to real columns so the settlement pass can stop detoasting the document.
--
-- WHY NOW (D7 forensics, measured on production):
--
-- The settlement cron runs three sequential scans. Scan 3 — the ONLY pass that can
-- settle Corners / Shots / Shots-on-Target / Cards — selects raw_payload for every
-- FINAL row in the 45-day window (472 rows) in a single statement, at a chunk size
-- of 1000. raw_payload has grown from ~10 KB/row in May to ~353 KB/row in August:
--
--   raw_payload      limit=25    1,643 ms    7,834 KB   200
--   raw_payload      limit=100   2,161 ms   30,964 KB   200
--   raw_payload      limit=250  10,441 ms        0 KB   500  57014 statement timeout
--   promoted columns limit=250     269 ms      158 KB   200
--
-- Scans 1 and 2 (99 and 100 rows) sit under the limit and commit; scan 3 throws,
-- and the single try/catch aborts the whole run. That is why score-derived families
-- settle and totals families do not: 74 FINAL rows sat at validation='pending',
-- every one of them a totals family, with 0/58 pending Corners rows carrying a
-- corners_total against 76/76 settled ones that do.
--
-- 055 and 056 promoted everything the History LIST needed. These five are the
-- remainder that SETTLEMENT needs, and they are the entire remainder: with them,
-- scan 3 reads no JSONB at all.
--
-- Source paths and population, measured on the 120 newest FINAL rows:
--
--   shots_total           raw_payload->marketResults->>shotsTotal        56 (47%)
--   cards_total           raw_payload->marketResults->>cardsTotal        45 (38%)
--   cards_points          raw_payload->marketResults->>cardsPoints       45 (38%)
--   first_half_goals      raw_payload->marketResults->>firstHalfGoals    57 (48%)
--   has_first_half_probs  raw_payload->probs->firstHalf IS NOT NULL     120 (100%)
--
-- (corners_total, already promoted by 055, sits at 57/120 in the same sample — so
-- these population rates are the normal "statistics have arrived" rate, not a gap.)
--
-- NULL vs 0 — THE RULE THAT MATTERS MOST HERE:
--
-- NULL means "not observed". 0 means "observed, and it was zero". They must never
-- be conflated: a fixture with no statistics yet has cards_total NULL, and coercing
-- that to 0 would settle "Cards Under 3.5" as a WIN on a match nobody has counted.
-- Every one of these columns is nullable with no default, and the derivation in
-- server-utils/historyListColumns.js returns null — never 0 — for an absent source.
-- This mirrors the yellow-anchor rule in server-utils/fixtureCardTotals.js, where a
-- half-known match total is discarded rather than half-counted.
--
-- has_first_half_probs is BOOLEAN, not the probs block. Settlement reads that path
-- only as `Boolean(raw.probs?.firstHalf)`, to decide whether a first-half pick
-- exists whose halftime total is still missing. Promoting the block itself would
-- re-import the JSONB this migration exists to avoid; the predicate is the whole
-- of what settlement needs.
--
-- It is TRUE or NULL, never FALSE — the same "absent source derives to null" rule
-- as every other promoted column, which is what lets the backfill treat an
-- all-null derivation as "nothing to write". The consumer tests `=== true`, so a
-- null reads as "no first-half block".
--
-- MUTABILITY, matching the split 055/056 established:
--
--   shots_total, cards_total, cards_points, first_half_goals  MUTABLE
--     Settlement fills them as /fixtures/statistics arrives. They join
--     MUTABLE_COLUMNS and deriveMutableHistoryListColumns returns them.
--
--   has_first_half_probs                                      IMMUTABLE
--     `probs` is written once at creation and no settlement path touches it —
--     attachCardMarketsToPayload never writes it. It joins IMMUTABLE_COLUMNS, so
--     a settlement writer structurally cannot set it.
--
-- INTEGER, not numeric: all four totals are whole counts. Cards are yellow+red;
-- cards_points is red*2+yellow, the weighted convention from migration 038. Both
-- are integers by construction. A market LINE may be 3.5 or 6.75, but an observed
-- total never is.
--
-- raw_payload REMAINS AUTHORITATIVE and is NOT dropped. These are derived cache
-- columns, exactly as 055/056 framed theirs. Reverting is a plain DROP COLUMN.
--
-- NO BACKFILL HERE, for the same reason as 055 and 056: seeding these means
-- detoasting every row, which is the precise operation whose statement_timeout
-- this work exists to remove. The backfill is a separate, chunked, resumable,
-- dry-run-first script (scripts/backfill-settlement-columns.mjs).

alter table public.predictions_history
  add column if not exists shots_total integer,
  add column if not exists cards_total integer,
  add column if not exists cards_points integer,
  add column if not exists first_half_goals integer,
  add column if not exists has_first_half_probs boolean;

comment on column public.predictions_history.shots_total is
  'Total şuturi în meci (ambele echipe), din raw_payload->marketResults->>shotsTotal. NULL = neobservat, 0 = observat zero. Piaţa Shots se decontează faţă de această valoare.';
comment on column public.predictions_history.cards_total is
  'Număr BRUT de cartonaşe în meci (yellow + red), din raw_payload->marketResults->>cardsTotal. NULL = neobservat. Aceasta este unitatea liniilor Cards — vezi cards_points.';
comment on column public.predictions_history.cards_points is
  'Puncte-cartonaş ponderate (red*2 + yellow), din raw_payload->marketResults->>cardsPoints. Înregistrat pentru rolling/backtest; liniile Cards NU se decontează faţă de această coloană.';
comment on column public.predictions_history.first_half_goals is
  'Goluri totale în prima repriză, din raw_payload->marketResults->>firstHalfGoals. NULL = neobservat, 0 = repriză fără goluri.';
comment on column public.predictions_history.has_first_half_probs is
  'TRUE când raw_payload->probs->firstHalf există. Predicat, nu date: settlement îl citeşte doar ca să ştie dacă un pick de primă repriză aşteaptă un total de halftime. IMUTABIL.';
