/**
 * One-off backfill for the seven derived list columns added by migration 055.
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
 * Only the payload keys the seven columns derive from — never the whole
 * document. Same `alias:raw_payload->key` form as AGGREGATE_STATS_SELECT.
 */
export const BACKFILL_SELECT = [
  "fixture_id",
  "recommended_odd",
  "logo_home",
  "logo_away",
  "card_market_validations",
  "card_markets",
  "corners_total",
  "shots_on_target_total",
  "src_recommended:raw_payload->recommended",
  "src_logos:raw_payload->logos",
  "src_card_market_validations:raw_payload->cardMarketValidations",
  "src_card_markets:raw_payload->cardMarkets",
  "src_market_results:raw_payload->marketResults"
].join(", ");

/** Migration 042's guard, applied to the same source it was written for. */
const NUMERIC_GUARD = /^[0-9]+(\.[0-9]+)?$/;
/** Strict: a total is a whole number of corners or shots, never 9.5. */
const INTEGER_GUARD = /^-?[0-9]+$/;

/** Fields that cannot change after the prediction was written. */
export const IMMUTABLE_COLUMNS = Object.freeze(["recommended_odd", "logo_home", "logo_away"]);
/** Fields settlement rewrites as results arrive. */
export const MUTABLE_COLUMNS = Object.freeze([
  "card_market_validations",
  "card_markets",
  "corners_total",
  "shots_on_target_total"
]);

/**
 * A value that is present but does not satisfy its guard is REPORTED, never
 * coerced. Returning `{ ok: false }` keeps a bad row from failing its batch
 * while still surfacing it in the diagnostics.
 */
export function parseGuardedNumber(value, guard) {
  if (value === null || value === undefined) return { ok: true, value: null, present: false };
  if (typeof value === "object") return { ok: false, value: null, present: true };
  const text = String(value).trim();
  if (text === "") return { ok: true, value: null, present: false };
  if (!guard.test(text)) return { ok: false, value: null, present: true };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { ok: false, value: null, present: true };
  return { ok: true, value: parsed, present: true };
}

/** Empty string is absence, not a value. */
function parseText(value) {
  if (value === null || value === undefined) return { value: null, present: false };
  if (typeof value !== "string") return { value: null, present: false };
  const trimmed = value.trim();
  if (trimmed === "") return { value: null, present: false };
  return { value: trimmed, present: true };
}

/** JSON null is absence; only a real object is a value. */
function parseJson(value) {
  if (value === null || value === undefined) return { value: null, present: false };
  if (typeof value !== "object") return { value: null, present: false };
  return { value, present: true };
}

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
  const diagnostics = {
    missingSource: 0,
    numericRejected: 0,
    integerRejected: 0,
    rejectedColumns: []
  };
  const desired = {};

  const odd = parseGuardedNumber(row.src_recommended?.odd, NUMERIC_GUARD);
  if (!odd.ok) {
    diagnostics.numericRejected += 1;
    diagnostics.rejectedColumns.push("recommended_odd");
  }
  if (!odd.present) diagnostics.missingSource += 1;
  desired.recommended_odd = row.recommended_odd ?? odd.value;

  const logoHome = parseText(row.src_logos?.home);
  if (!logoHome.present) diagnostics.missingSource += 1;
  desired.logo_home = row.logo_home ?? logoHome.value;

  const logoAway = parseText(row.src_logos?.away);
  if (!logoAway.present) diagnostics.missingSource += 1;
  desired.logo_away = row.logo_away ?? logoAway.value;

  const cmv = parseJson(row.src_card_market_validations);
  if (!cmv.present) diagnostics.missingSource += 1;
  desired.card_market_validations = cmv.value ?? row.card_market_validations ?? null;

  const cm = parseJson(row.src_card_markets);
  if (!cm.present) diagnostics.missingSource += 1;
  desired.card_markets = cm.value ?? row.card_markets ?? null;

  const corners = parseGuardedNumber(row.src_market_results?.cornersTotal, INTEGER_GUARD);
  if (!corners.ok) {
    diagnostics.integerRejected += 1;
    diagnostics.rejectedColumns.push("corners_total");
  }
  if (!corners.present) diagnostics.missingSource += 1;
  desired.corners_total = corners.value ?? row.corners_total ?? null;

  const shots = parseGuardedNumber(row.src_market_results?.shotsOnTargetTotal, INTEGER_GUARD);
  if (!shots.ok) {
    diagnostics.integerRejected += 1;
    diagnostics.rejectedColumns.push("shots_on_target_total");
  }
  if (!shots.present) diagnostics.missingSource += 1;
  desired.shots_on_target_total = shots.value ?? row.shots_on_target_total ?? null;

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
      logo_home: 0,
      logo_away: 0,
      card_market_validations: 0,
      card_markets: 0,
      corners_total: 0,
      shots_on_target_total: 0
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
