# RELIABILITY-006 — Batched Predict History Persistence

Date: 2026-09-11. Branch `fix/reliability-006-batched-history-persistence` (worktree `scratchpad\wt-r006`), based on `origin/main` `684f86ab`. **Implemented and verified locally. Not committed, pushed or deployed.**

## 1. The failure being fixed (from the read-only audit)
- On **2026-09-11 at 13:24:16Z**, a Predict returned HTTP 200, but its history refresh was lost.
- `upsertPredictionsHistory` sent **46 existing rows in ONE upsert**, about 8–9 MB of JSON (each row carries `raw_payload` of 157–268 KB, plus about 15 KB of `hydration_payload` and 2 KB of `ticket_candidates`).
- Postgres cancelled the statement with **SQLSTATE 57014** (statement timeout) about 18.8 s after the request started. End to end, the write took 21.9 s.
- The same shape at 42 rows had succeeded two minutes earlier, in 5.96 s.
- There was no lock contention or table bloat. The `authenticator` role has an 8 s `statement_timeout`, and `service_role` has none of its own.
- The existing rows kept their previous version, and 0 rows were updated.
- RELIABILITY-005 was not involved.
- The audit classified this as a **RECURRING HISTORY WRITE PERFORMANCE PROBLEM**.

## 2. Change
`server-utils/predictionsHistory.js`:
- `PREDICT_HISTORY_WRITE_BATCH = 10`, a fixed constant.
- `writeHistoryInBatches()` writes sequential batches using `rows.slice`. The slices share the row objects, so no payload is copied.
- `upsertPredictionsHistory` keeps its **single** existence `SELECT`, its final and stale guards, and its order: new rows are inserted first, then existing rows are upserted on `fixture_id`. Both phases are now batched.
- The return shape and the thrown error are unchanged.

**Why 10.**
- Rows are about 190 KB, so a batch is about 1.9 MB per statement.
- At the observed healthy rate (about 0.14 s per row) a batch should take about 1.4 s.
- At the failed run's rate (at least about 0.41 s per row) it should take about 4.1 s. That's roughly half the probable 8 s limit.
- These are starting values, not a proven optimum.
- History sync uses 25 (`api/history.js`), which at the worst observed rate would be about 10 s, so it's too large for the Predict path.
- It's a constant rather than an env var: one number, and easy to tune later.

## 3. Persistence ordering (unchanged, now pinned by a test)
History batches (insert, then update) → `prediction_snapshots`, only after **all** batches succeed → feature importance → context snapshots → `user_prediction_fixtures` ownership link → `history_sync_log`.

The ownership link has a foreign key to `predictions_history`, so it never runs before, or without, the history write.

## 4. Failure semantics (unchanged contract)
- The first failed batch **stops the remaining batches** and rethrows the **original** database error.
- Stage10's existing catch runs as before: it logs `[predict persist] <message>`, sets `X-Persist-Warning: predictions_history_upsert_failed`, and still returns **HTTP 200** with the computed predictions.
- It also still skips feature importance, context snapshots, the ownership link and the sync-log row.
- **Not atomic.** Batches written before the failure stay written.
  - This is replay-safe: a later Predict sees those rows as existing and upserts them on `fixture_id`, with no second insert.
  - If a *new-row* insert batch succeeds and a later batch fails, those new fixtures have history rows but no ownership link until a later successful Predict links them. That's the same exposure as before, when the single upsert failed after the single insert.
- **No retries were added.**

## 5. Observability (existing conventions)
- **On failure:** a new `predict.history_persist_failed` warning. Fields: `phase` (insert or update), `batchSize`, `batches`, `batchesCompleted`, `failedBatchIndex`, `failedBatchRows`, `failedFixtureIds`, `rowsAttempted`, `rowsPersisted`, **`partial`**, `durationMs`, `errorCode` (for example 57014), and `error` (clipped to 200 characters). No payload is logged.
- **On success:** the existing `historyPersist` line gains `batchSize`, `batches` and `durationMs`.

## 6. Tests
- **`tests/predictHistoryBatching.test.js`** (13 cases, the real function with a scripted client, under `test:d9b`):
  - batch size;
  - fewer than one batch, exactly one batch, several batches, and a remainder;
  - the failed production shape (46 existing rows become [10,10,10,10,6], keyed on `fixture_id`);
  - the mixed 7-new + 42-existing shape, with one existence query;
  - a failing update batch and a failing insert batch (stop, original error, no snapshots);
  - no duplicates, with final rows still protected;
  - replay safety;
  - success telemetry, and partial versus complete failure telemetry with no payload.
- **`tests/stage10PersistenceOrdering.test.js`** (2 cases, under `test:ownership`): the order history → feature importance → context → link → sync log, and a history failure that runs *only* the history write, keeps the warning and still returns the predictions.
- **`tests/d9bPromotedColumns.test.js [12]`**, deliberately updated. It asserted exactly **one** history write for 20 rows, which pinned the unbatched behaviour. It now asserts `ceil(20/10)` bounded writes that cover every row exactly once, each still carrying the promoted columns. The D9b guarantee (bulk writes, never one per fixture) is preserved.

## 7. Validation (local, on the patched tree; the baseline tree equals `684f86ab`)

| Check | Baseline | Patch |
|---|---|---|
| ESLint `--max-warnings 0` / typecheck ×2 / `validate:pkg` | PASS | PASS |
| Node tests | 2656 / 0 | **2671 / 0** (+15) |
| Vitest | 1882 / 1883 | **1882 / 1883** (the pre-existing `primitives.guard.test.ts`) |
| `test:d9b` / `test:ownership` | — | 36/36 · 12/12 |
| ECC review | — | no correctness defect |

## 8. Remaining risks and follow-ups (not in this change)
- **Partial persistence** is possible, as described in §4. It's repairable by replay but not atomic.
- **Database load varies.** The failed run was about 3× slower per row than a comparable run minutes earlier, for reasons that are still unknown. At 10 rows per batch there's roughly a 2× margin at that rate. A much slower database could still time out a single batch.
- **Payload growth.** `raw_payload` of 160–270 KB per row is the real cost driver. If it grows, re-check the batch size.
- **`prediction_snapshots`** is still one unchunked insert. It took 8.5 s for 49 rows in production, and its errors are swallowed. It's the next write-path candidate, separate from snapshot idempotency.
- **Duplicate batching helper.** `api/history.js` has its own `upsertHistoryChunked`. A shared helper could replace both later; `/api/history` was out of scope here.
- **The effective statement limit** (about 8 s, via `authenticator`) is inferred, not confirmed.
