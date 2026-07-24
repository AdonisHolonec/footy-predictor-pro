-- 036: Promote referee name to a top-level, indexed column so historical
-- referee statistics (avgGoals/homeWinBias, computed from our own settled
-- fixtures — no external API calls) can be looked up cheaply at predict time
-- instead of scanning raw_payload JSONB. Backward compatible: nullable,
-- existing rows backfilled from the payload they already have.

alter table if exists public.predictions_history
  add column if not exists referee_name text;

update public.predictions_history
set referee_name = raw_payload->>'referee'
where referee_name is null
  and raw_payload->>'referee' is not null;

create index if not exists predictions_history_referee_name_idx
  on public.predictions_history (referee_name)
  where referee_name is not null;
