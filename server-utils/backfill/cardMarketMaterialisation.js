import { attachCardMarketsToPayload } from "../cardMarketSettlement.js";
import { deriveMutableHistoryListColumns } from "../historyListColumns.js";

/**
 * Historical repair for the rows that predate creation-time card markets.
 *
 * 324 of 810 production rows carry no `raw_payload.cardMarkets`. They are a
 * single clean cohort — kickoffs 2026-04-10 to 2026-05-22, every one saved
 * before commit cbac70d9 put attachCardMarketsToPayload on the creation path,
 * and not one row after it. Settlement cannot repair them: every scan in
 * handleHistorySync is gated on `kickoff_at >= now - days` with days capped at
 * 120, so 64 are already past the horizon and the rest leave it daily.
 *
 * Today the List still counts their goals/corners/shots markets, because
 * resolveCardMarketValidations re-derives picks from `probs` at read time —
 * the behaviour cbac70d9 introduced deliberately ("Count FocusCard markets in
 * the success-rate counter"). Once the read cutover stops shipping `probs`,
 * that derivation has nothing to run on and 318 settled results vanish from the
 * user's counter: 2014 settled becomes 1696, and the win rate RISES from
 * 72.0953% to 72.7005%, which is precisely the kind of change that does not
 * look like a bug. This backfill makes the stored document say what the read
 * path has been computing all along, so the cutover is lossless.
 *
 * ── Why this is a SEPARATE module from historyListColumns.js ─────────────────
 * That backfill is column-only and must stay that way: `raw_payload` is
 * authoritative and it never writes it. This one is the first in the programme
 * allowed to modify the document. Folding the two together would quietly hand
 * payload-write powers to a job that has no business having them.
 *
 * ── The one rule ─────────────────────────────────────────────────────────────
 * The promoted columns are derived from the EXACT enriched payload being
 * persisted, in the same statement. They can never describe a document that was
 * not written, because they are read out of it.
 *
 * ── Which keys this actually touches ─────────────────────────────────────────
 * attachCardMarketsToPayload has three assignment targets: cardMarkets,
 * cardMarketValidations and marketResults. Measured over all 324 eligible
 * production rows, a full before/after diff of every top-level key showed
 * exactly two changing — cardMarkets and cardMarketValidations, 324/324.
 * `marketResults` was absent before AND after on all 324, because its guard
 * only fires when some total is non-null and this cohort has none. The third
 * path is unreachable here; the check in planRowMaterialisation enforces that
 * rather than trusting it.
 */

/** Only what the derivation reads, plus the document that must be persisted whole. */
export const MATERIALISATION_SELECT = [
  "fixture_id",
  "match_status",
  "score_home",
  "score_away",
  "card_markets",
  "card_market_validations",
  // The whole document, deliberately. The write must preserve every unrelated
  // key byte-for-byte, and PostgREST has no partial-document update — a
  // jsonb_set would mean a new RPC. Reading it is the cost of not inventing one.
  "raw_payload"
].join(", ");

/** The two columns this backfill owns. Nothing else may be written. */
export const MATERIALISED_COLUMNS = Object.freeze(["card_markets", "card_market_validations"]);

/** Keys attachCardMarketsToPayload is permitted to change. A third means refuse. */
export const EXPECTED_CHANGED_KEYS = Object.freeze(["cardMarkets", "cardMarketValidations"]);

const isObject = (value) => value !== null && value !== undefined && typeof value === "object";
const jsonEqual = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

/**
 * A row is eligible only when BOTH promoted columns are absent.
 *
 * Not "cardMarkets is missing from the payload": the columns are what the read
 * cutover will read, and a row whose columns are already populated has been
 * repaired — by this job, by a settlement pass, or by a creation write that
 * landed while the walk was running. Any of those outrank a historical repair.
 */
export function isEligible(row) {
  return isObject(row?.card_markets) === false && isObject(row?.card_market_validations) === false;
}

/**
 * Plan one row without writing anything.
 *
 * @returns {{ update: object|null, skipped: string|null, error: string|null,
 *   changedKeys: string[], picks: object|null, validations: object|null }}
 */
export function planRowMaterialisation(row) {
  const empty = { update: null, skipped: null, error: null, changedKeys: [], picks: null, validations: null };

  if (isEligible(row) === false) {
    return { ...empty, skipped: "already-materialised" };
  }

  const payload = isObject(row?.raw_payload) ? row.raw_payload : null;
  if (payload === null) {
    return { ...empty, error: "raw_payload is absent or not an object" };
  }

  // A deep copy, so a bug in the derivation cannot mutate the object we compare
  // against. attachCardMarketsToPayload spreads only one level.
  const working = JSON.parse(JSON.stringify(payload));
  const pristine = JSON.parse(JSON.stringify(payload));

  const status = row.match_status || working.status || "";
  const score = {
    home: row.score_home !== null && row.score_home !== undefined
      ? row.score_home
      : (isObject(working.score) && working.score.home !== undefined ? working.score.home : null),
    away: row.score_away !== null && row.score_away !== undefined
      ? row.score_away
      : (isObject(working.score) && working.score.away !== undefined ? working.score.away : null)
  };

  let enriched;
  try {
    // THE authoritative writer. No rule about picks, families, lines or
    // settlement is restated here — this backfill has no opinion of its own.
    // marketTotals is deliberately omitted: there is no provider call in a
    // historical repair, so totals can only come from the payload itself,
    // which is exactly what the function already falls back to.
    enriched = attachCardMarketsToPayload(working, { status, score });
  } catch (cause) {
    return { ...empty, error: `derivation threw: ${cause?.message || String(cause)}` };
  }

  if (isObject(enriched) === false) {
    return { ...empty, error: "derivation returned a non-object" };
  }

  const keys = new Set([...Object.keys(pristine), ...Object.keys(enriched)]);
  const changedKeys = [];
  for (const key of keys) {
    if (jsonEqual(pristine[key], enriched[key]) === false) changedKeys.push(key);
  }
  const unexpected = changedKeys.filter((key) => EXPECTED_CHANGED_KEYS.includes(key) === false);
  if (unexpected.length > 0) {
    // Refuse rather than quietly widen the blast radius. A historical repair
    // that starts rewriting marketResults — or anything else — is a different
    // change and needs its own audit.
    return { ...empty, error: `derivation changed unexpected keys: ${unexpected.join(", ")}` };
  }

  if (isObject(enriched.cardMarkets) === false) {
    return { ...empty, error: "derivation produced no cardMarkets" };
  }

  /*
    The columns are read back OUT of the object being persisted, through the
    same shared parser the live writers use — not re-derived from the source.
    Only the two this backfill owns are taken: corners_total and
    shots_on_target_total belong to the settlement writers and to Phase 2, and
    a historical repair has no business moving them.
  */
  const columns = deriveMutableHistoryListColumns(enriched);
  const update = {
    raw_payload: enriched,
    card_markets: columns.card_markets,
    card_market_validations: columns.card_market_validations
  };

  return {
    update,
    skipped: null,
    error: null,
    changedKeys,
    picks: enriched.cardMarkets,
    validations: enriched.cardMarketValidations
  };
}

function emptyStats() {
  return {
    scanned: 0,
    eligible: 0,
    changed: 0,
    alreadyMaterialised: 0,
    sourceMissing: 0,
    derivationFailed: 0,
    writeFailed: 0,
    batches: 0,
    lastFixtureId: null,
    elapsedMs: 0,
    picks: { recommended: 0, goals: 0, corners: 0, shots: 0 },
    outcomes: { win: 0, loss: 0, pending: 0, push: 0, half_win: 0, half_loss: 0, none: 0 },
    failures: []
  };
}

const MARKET_KEYS = ["recommended", "goals", "corners", "shots"];

/**
 * Keyset walk over the eligible rows. `apply: false` plans without writing.
 *
 * Batches are small (50 by default) because each row carries a whole payload —
 * a 200-row page here is roughly 26 MB in flight, versus a few hundred KB for
 * the column backfill.
 */
export async function runMaterialisation({
  supabase,
  batchSize = 50,
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
      .select(MATERIALISATION_SELECT)
      // The eligibility predicate is in the QUERY as well as the per-row guard,
      // so a page never carries rows this job has no business reading.
      .is("card_markets", null)
      .is("card_market_validations", null)
      .gt("fixture_id", cursor)
      .order("fixture_id", { ascending: true })
      .limit(batchSize);
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned += 1;
      const { update, skipped, error: planError, picks, validations } = planRowMaterialisation(row);

      if (skipped === "already-materialised") {
        stats.alreadyMaterialised += 1;
        continue;
      }
      if (planError !== null) {
        if (/raw_payload is absent/.test(planError)) stats.sourceMissing += 1;
        else stats.derivationFailed += 1;
        stats.failures.push({ fixtureId: row.fixture_id, stage: "derive", reason: planError });
        continue;
      }
      stats.eligible += 1;

      if (apply) {
        /*
          Per-row UPDATE, never upsert: PostgREST can only bulk-write through
          upsert, and an upsert whose conflict target missed would INSERT a
          half-built fixture into predictions_history.

          The eligibility predicate is repeated in the WHERE clause. That is
          what makes this safe against production: if a settlement or creation
          write populated the row between the SELECT and here, the filter no
          longer matches, zero rows are touched, and this job cannot clobber a
          value that is newer than the one it planned.
        */
        const { data: written, error: writeError } = await supabase
          .from(table)
          .update(update)
          .eq("fixture_id", row.fixture_id)
          .is("card_markets", null)
          .is("card_market_validations", null)
          .select("fixture_id");
        if (writeError) {
          stats.writeFailed += 1;
          stats.failures.push({ fixtureId: row.fixture_id, stage: "write", reason: writeError.message || String(writeError) });
          continue;
        }
        if (Array.isArray(written) && written.length === 0) {
          // The row was repaired by someone else mid-walk. Correct outcome.
          stats.alreadyMaterialised += 1;
          stats.eligible -= 1;
          continue;
        }
      }

      stats.changed += 1;
      for (const key of MARKET_KEYS) {
        if (picks && picks[key]) stats.picks[key] += 1;
        const outcome = validations ? validations[key] : null;
        if (outcome === null || outcome === undefined) stats.outcomes.none += 1;
        else if (stats.outcomes[outcome] !== undefined) stats.outcomes[outcome] += 1;
      }
    }

    // Strictly increasing, so the walk terminates even if a page comes back
    // short or the eligibility filter shrinks the set underneath it.
    cursor = Number(rows[rows.length - 1].fixture_id);
    stats.lastFixtureId = cursor;
    stats.batches += 1;
    if (onBatch) onBatch({ ...stats });
    if (rows.length < batchSize) break;
  }

  stats.elapsedMs = now() - started;
  return stats;
}
