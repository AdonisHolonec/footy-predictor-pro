-- Extend history_sync_log with predict persistence telemetry.
-- Kept nullable for backward compatibility with existing /api/history sync inserts.

alter table if exists public.history_sync_log
  add column if not exists persist_inserted integer,
  add column if not exists persist_updated integer,
  add column if not exists persist_skipped_final integer,
  add column if not exists persist_skipped_stale integer,
  add column if not exists persist_skipped_prekickoff integer;

comment on column public.history_sync_log.persist_inserted is 'Rows inserted in predictions_history during /api/predict persist.';
comment on column public.history_sync_log.persist_updated is 'Rows updated in predictions_history during /api/predict persist.';
comment on column public.history_sync_log.persist_skipped_final is 'Persist rows skipped because fixture was already final.';
comment on column public.history_sync_log.persist_skipped_stale is 'Persist rows skipped because existing row was newer.';
comment on column public.history_sync_log.persist_skipped_prekickoff is 'Persist rows skipped by pre-kickoff guard.';
