import {
  deriveHistoryListColumnsWithDiagnostics,
  IMMUTABLE_COLUMNS,
  MUTABLE_COLUMNS
} from "../historyListColumns.js";

/**
 * One-off backfill for the derived list columns: the seven from migration 055
 * and the four recommendation-metadata scalars from 056.
 *
 * `raw_payload` REMAINS AUTHORITATIVE. These columns are a cache that exists so
 * the History list can be answered without touching the JSONB document — the
 * measured difference on 452 production rows was 10,941 buffers / 1,822 ms with
 * `raw_payload->key` versus 411 buffers / 0.917 ms without it.
 *
 * Nothing reads these columns yet. This backfill seeds them; the dual-write and
 * the read cutover are separate changes.
 *
 * ── Why batched, and why keyset ───────────────────────────────────────────────
 * A single unbounded UPDATE would detoast every row in one statement — exactly
 * the operation whose statement_timeout this whole effort exists to remove. So
 * the work is chunked by `fixture_id` (the primary key) using keyset pagination:
 * each batch is independently executable, resumable from `--after`, and cannot
 * loop, because the cursor is strictly greater than the last id seen. OFFSET is
 * deliberately not used — it re-scans a growing prefix on every page.
 *
 * ── Why UPDATE and not upsert ─────────────────────────────────────────────────
 * PostgREST can only bulk-write through upsert, and an upsert whose conflict
 * target misses would INSERT a half-empty row into predictions_history — a row
 * that would then show up in the History list. Per-row UPDATE ... WHERE
 * fixture_id = ? cannot do that. For a one-off over a few thousand rows the
 * extra round trips are worth the impossibility of inventing a fixture.
 */

/**
 * Only the payload keys the promoted columns derive from — never the whole
 * document. Same `alias:raw_payload->key` form as AGGREGATE_STATS_SELECT.
 */
export const BACKFILL_SELECT = [
  "fixture_id",
  "recommended_odd",
  // 056. No new payload projection is needed: `src_recommended` already carries
  // the whole `recommended` object, so family/period/scope/bookLine come out of
  // the projection this backfill has always taken. The COLUMNS are selected
  // because the immutable reconciliation below reads the stored value first.
  "recommended_family",
  "recommended_period",
  "recommended_scope",
  "recommended_book_line",
  "logo_home",
  "logo_away",
  "card_market_validations",
  "card_markets",
  "corners_total",
  "shots_on_target_total",
  /*
    057. shots_total / cards_total / cards_points / first_half_goals need NO new
    payload projection: `src_market_results` already carries the whole
    marketResults object, so all four come out of the projection this backfill has
    always taken. Only the first-half predicate needs a new one, and it takes the
    sub-key rather than `probs`, which is one of the largest blocks in the document.
  */
  "shots_total",
  "cards_total",
  "cards_points",
  "first_half_goals",
  "has_first_half_probs",
  "src_recommended:raw_payload->recommended",
  "src_logos:raw_payload->logos",
  "src_card_market_validations:raw_payload->cardMarketValidations",
  "src_card_markets:raw_payload->cardMarkets",
  "src_market_results:raw_payload->marketResults",
  "src_probs_first_half:raw_payload->probs->firstHalf"
].join(", ");

/**
 * The parsing rules live in ../historyListColumns.js so the live writers and this
 * backfill cannot drift apart. What stays HERE is the reconciliation that is
 * backfill-only: deciding whether a derived value should replace what is already
 * in the column.
 */
export { IMMUTABLE_COLUMNS, MUTABLE_COLUMNS };

function sameJson(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Decide what one row needs, without writing anything.
 *
 * Immutable columns use `target ?? source` — a populated value is never
 * replaced. Mutable columns use `source ?? target` — an authoritative non-null
 * payload refreshes the cache, but a missing source never nulls what is there.
 * Both directions are safe to re-run.
 */
export function planRowUpdate(row) {
  // The projected `src_*` aliases ARE the payload sub-objects, so they are folded
  // back into payload shape and run through the one shared derivation.
  const { columns: derived, diagnostics } = deriveHistoryListColumnsWithDiagnostics({
    recommended: row.src_recommended,
    logos: row.src_logos,
    cardMarketValidations: row.src_card_market_validations,
    cardMarkets: row.src_card_markets,
    marketResults: row.src_market_results,
    // Folded back into payload shape so the ONE shared derivation decides the
    // predicate — this file must not re-implement "does a first-half block exist".
    probs: { firstHalf: row.src_probs_first_half }
  });

  // Backfill-only reconciliation. Immutable columns keep whatever is already
  // stored; mutable columns follow the authoritative payload but are never
  // nulled by a source that simply is not there. This is NOT how live writes
  // behave — see ../historyListColumns.js.
  const desired = {};
  for (const key of IMMUTABLE_COLUMNS) desired[key] = row[key] ?? derived[key];
  for (const key of MUTABLE_COLUMNS) desired[key] = derived[key] ?? row[key] ?? null;

  // Only columns whose value actually moves are written, so a second run is a
  // no-op rather than a table-wide rewrite that would churn updated_at.
  const update = {};
  for (const key of [...IMMUTABLE_COLUMNS, ...MUTABLE_COLUMNS]) {
    const next = desired[key];
    const current = row[key] ?? null;
    const changed =
      key === "card_market_validations" || key === "card_markets"
        ? !sameJson(current, next ?? null)
        : current !== (next ?? null);
    if (changed && next !== null && next !== undefined) update[key] = next;
  }

  return { update: Object.keys(update).length ? update : null, diagnostics };
}

function emptyStats() {
  return {
    scanned: 0,
    changed: 0,
    skipped: 0,
    missingSource: 0,
    numericRejected: 0,
    integerRejected: 0,
    batches: 0,
    lastFixtureId: null,
    failed: 0,
    populated: {
      recommended_odd: 0,
      recommended_family: 0,
      recommended_period: 0,
      recommended_scope: 0,
      recommended_book_line: 0,
      logo_home: 0,
      logo_away: 0,
      card_market_validations: 0,
      card_markets: 0,
      corners_total: 0,
      shots_on_target_total: 0,
      shots_total: 0,
      cards_total: 0,
      cards_points: 0,
      first_half_goals: 0,
      has_first_half_probs: 0
    },
    elapsedMs: 0
  };
}

/**
 * Keyset walk over the table. `apply: false` plans without writing.
 *
 * `now` is injected so the elapsed figure is testable; `supabase` is injected so
 * the whole loop runs against fakes, the same shape supportApi.js uses.
 */
export async function runBackfill({
  supabase,
  batchSize = 200,
  apply = false,
  after = 0,
  maxBatches = Infinity,
  table = "predictions_history",
  now = () => Date.now(),
  onBatch = null
} = {}) {
  if (!supabase) throw new Error("supabase client is required");
  const started = now();
  const stats = emptyStats();
  let cursor = Number(after) || 0;

  while (stats.batches < maxBatches) {
    const { data, error } = await supabase
      .from(table)
      .select(BACKFILL_SELECT)
      .gt("fixture_id", cursor)
      .order("fixture_id", { ascending: true })
      .limit(batchSize);
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned += 1;
      const { update, diagnostics } = planRowUpdate(row);
      stats.missingSource += diagnostics.missingSource;
      stats.numericRejected += diagnostics.numericRejected;
      stats.integerRejected += diagnostics.integerRejected;

      if (!update) {
        stats.skipped += 1;
        continue;
      }
      if (apply) {
        // Per-row UPDATE: it can modify an existing fixture and nothing else.
        const { error: upErr } = await supabase.from(table).update(update).eq("fixture_id", row.fixture_id);
        if (upErr) {
          stats.failed += 1;
          continue;
        }
      }
      stats.changed += 1;
      for (const key of Object.keys(update)) stats.populated[key] += 1;
    }

    // Strictly increasing: the next page starts past the highest id seen, so the
    // walk terminates even if a batch comes back short.
    cursor = Number(rows[rows.length - 1].fixture_id);
    stats.lastFixtureId = cursor;
    stats.batches += 1;
    if (onBatch) onBatch({ ...stats });
    if (rows.length < batchSize) break;
  }

  stats.elapsedMs = now() - started;
  return stats;
}
