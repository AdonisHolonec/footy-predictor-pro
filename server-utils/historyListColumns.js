/**
 * The single definition of how the seven promoted list columns are derived from
 * `raw_payload`.
 *
 * `raw_payload` is authoritative; these columns are a cache that lets the
 * History list be answered without touching the JSONB document. Measured on 452
 * production rows: 10,941 buffers / 1,822 ms with `raw_payload->key`, versus 411
 * buffers / 0.917 ms without it.
 *
 * ── The one rule ──────────────────────────────────────────────────────────────
 * A live writer derives its columns from the EXACT payload object it is about to
 * persist — never from the previous database row.
 *
 * That single rule covers every case, because both settlement writers build
 * their payload as `{...raw}` and persist the whole thing. Preservation is
 * therefore already inside the object: if attachCardMarketsToPayload leaves
 * `marketResults` untouched because no new totals arrived, the spread has
 * already carried the old value forward, and deriving from the result reproduces
 * it. A "preserve the previous column" mechanism would be inventing semantics
 * the payload does not have, and would mask the case where the payload really
 * did drop a value.
 *
 * The backfill's `target ?? source` / `source ?? target` reconciliation is a
 * DIFFERENT problem — reconciling history against columns that were never
 * written — and stays in the backfill. It layers on top of this derivation
 * rather than replacing it.
 *
 * Pure: no database, no clock, no I/O.
 */

/** Migration 042's guard, applied to the source it was written for. */
export const NUMERIC_GUARD = /^[0-9]+(\.[0-9]+)?$/;
/** Strict: a total is a whole number of corners or shots, never 9.5. */
export const INTEGER_GUARD = /^-?[0-9]+$/;

/** Written once at creation; no settlement path can change them. */
export const IMMUTABLE_COLUMNS = Object.freeze(["recommended_odd", "logo_home", "logo_away"]);
/** Rewritten by settlement as results arrive. */
export const MUTABLE_COLUMNS = Object.freeze([
  "card_market_validations",
  "card_markets",
  "corners_total",
  "shots_on_target_total"
]);

/**
 * A value that is present but fails its guard is REPORTED, never coerced.
 * `present` distinguishes "the payload had nothing here" from "the payload had
 * something unusable" — the backfill counts those separately.
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
export function parseText(value) {
  if (typeof value !== "string") return { value: null, present: false };
  const trimmed = value.trim();
  if (trimmed === "") return { value: null, present: false };
  return { value: trimmed, present: true };
}

/** JSON null is absence; only a real object is a value. */
export function parseJson(value) {
  if (value === null || value === undefined) return { value: null, present: false };
  if (typeof value !== "object") return { value: null, present: false };
  return { value, present: true };
}

/**
 * Derive all seven columns plus the counters the backfill reports.
 *
 * @param {object|null|undefined} payload the object about to become raw_payload
 */
export function deriveHistoryListColumnsWithDiagnostics(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const diagnostics = { missingSource: 0, numericRejected: 0, integerRejected: 0, rejectedColumns: [] };

  const note = (parsed) => {
    if (!parsed.present) diagnostics.missingSource += 1;
    return parsed;
  };
  const noteGuard = (parsed, column, kind) => {
    if (!parsed.ok) {
      diagnostics[kind] += 1;
      diagnostics.rejectedColumns.push(column);
    }
    return note(parsed);
  };

  const odd = noteGuard(parseGuardedNumber(p.recommended?.odd, NUMERIC_GUARD), "recommended_odd", "numericRejected");
  const logoHome = note(parseText(p.logos?.home));
  const logoAway = note(parseText(p.logos?.away));
  const cmv = note(parseJson(p.cardMarketValidations));
  const cm = note(parseJson(p.cardMarkets));
  const corners = noteGuard(
    parseGuardedNumber(p.marketResults?.cornersTotal, INTEGER_GUARD),
    "corners_total",
    "integerRejected"
  );
  const shots = noteGuard(
    parseGuardedNumber(p.marketResults?.shotsOnTargetTotal, INTEGER_GUARD),
    "shots_on_target_total",
    "integerRejected"
  );

  return {
    columns: {
      recommended_odd: odd.value,
      logo_home: logoHome.value,
      logo_away: logoAway.value,
      card_market_validations: cmv.value,
      card_markets: cm.value,
      corners_total: corners.value,
      shots_on_target_total: shots.value
    },
    diagnostics
  };
}

/** All seven columns. Every key is always present; absent sources are null. */
export function deriveHistoryListColumns(payload) {
  return deriveHistoryListColumnsWithDiagnostics(payload).columns;
}

/**
 * Only the four columns settlement may change.
 *
 * Exists so a settlement writer CANNOT accidentally write an immutable column:
 * the restriction is structural rather than a rule the caller has to remember.
 * recommended/logos are never touched by attachCardMarketsToPayload, so writing
 * them from a settlement payload would at best be a no-op and at worst would
 * hide a regression where the payload really had changed them.
 */
export function deriveMutableHistoryListColumns(payload) {
  const all = deriveHistoryListColumns(payload);
  const out = {};
  for (const key of MUTABLE_COLUMNS) out[key] = all[key];
  return out;
}
