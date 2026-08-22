/**
 * The single definition of how the promoted list columns are derived from
 * `raw_payload` — the seven from migration 055, the four from 056 and the
 * five from 057.
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

/**
 * Written once at creation; no settlement path can change them.
 *
 * The four `recommended_*` entries added by migration 056 belong here for the
 * same reason `recommended_odd` does: attachCardMarketsToPayload never touches
 * `recommended`, and every settlement writer persists `{...raw}`, so the value
 * is carried forward rather than recomputed. Listing them here is what keeps
 * them out of deriveMutableHistoryListColumns — the exclusion is structural.
 */
export const IMMUTABLE_COLUMNS = Object.freeze([
  "recommended_odd",
  "recommended_family",
  "recommended_period",
  "recommended_scope",
  "recommended_book_line",
  "logo_home",
  "logo_away",
  /*
    Migration 057. `probs` is written once at creation and no settlement path
    touches it, so this belongs with the other write-once columns: putting it
    here is what makes deriveMutableHistoryListColumns structurally unable to
    return it.
  */
  "has_first_half_probs"
]);
/** Rewritten by settlement as results arrive. */
export const MUTABLE_COLUMNS = Object.freeze([
  "card_market_validations",
  "card_markets",
  "corners_total",
  "shots_on_target_total",
  /*
    Migration 057. Settlement fills these as /fixtures/statistics arrives, the
    same lifecycle as corners_total above. They are what let scan 3 settle
    Shots and Cards without reading the document.
  */
  "shots_total",
  "cards_total",
  "cards_points",
  "first_half_goals"
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
  /*
    Market Identity Contract metadata, read verbatim.

    parseText, not a normalizer: `family` is matched against a fixed set by
    normalizeServerFamily on the client and `period`/`scope` are contract
    descriptors, so the only safe transformation is trimming. Nothing here may
    infer family from the pick text or period from the market type — that
    inference already exists client-side as the LEGACY fallback for rows that
    predate the contract, and writing a guess into a column would make a legacy
    row indistinguishable from one the server actually classified.

    bookLine goes through NUMERIC_GUARD, the same guard as the odd, because a
    line is a positive number and 6.75 / 8.25 are real production values. It is
    deliberately NOT INTEGER_GUARD: a quarter line is not a whole number, and
    rounding one would name a line the bookmaker never offered.
  */
  const family = note(parseText(p.recommended?.family));
  const period = note(parseText(p.recommended?.period));
  const scope = note(parseText(p.recommended?.scope));
  const bookLine = noteGuard(
    parseGuardedNumber(p.recommended?.bookLine, NUMERIC_GUARD),
    "recommended_book_line",
    "numericRejected"
  );
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
  /*
    Migration 057's four totals, through the SAME INTEGER_GUARD as corners above.
    An observed total is always a whole count — a LINE may be 3.5 or 6.75, an
    observation never is — so a non-integer here is rejected to null and counted,
    never rounded into a number the provider did not report.

    cards_total is the raw count (yellow + red); cards_points is the weighted
    convention (red*2 + yellow) from migration 038. Both are carried because they
    are not interchangeable, and only cards_total is graded against.
  */
  const shotsTotal = noteGuard(
    parseGuardedNumber(p.marketResults?.shotsTotal, INTEGER_GUARD),
    "shots_total",
    "integerRejected"
  );
  const cardsTotal = noteGuard(
    parseGuardedNumber(p.marketResults?.cardsTotal, INTEGER_GUARD),
    "cards_total",
    "integerRejected"
  );
  const cardsPoints = noteGuard(
    parseGuardedNumber(p.marketResults?.cardsPoints, INTEGER_GUARD),
    "cards_points",
    "integerRejected"
  );
  const firstHalfGoals = noteGuard(
    parseGuardedNumber(p.marketResults?.firstHalfGoals, INTEGER_GUARD),
    "first_half_goals",
    "integerRejected"
  );
  /*
    A PREDICATE, not data. Settlement reads this path only as
    `Boolean(raw.probs?.firstHalf)`, so the boolean is the whole of what it needs
    and promoting the block would re-import the JSONB 057 exists to avoid.

    Absence is null, not false — the module-wide rule that every absent source
    derives to null, which is also what lets the backfill treat an all-null
    derivation as "nothing to write" instead of writing a row of falses. The
    consumer asks `has_first_half_probs === true`, so null reads as "no first-half
    block" without the column ever having to claim it knows that for certain.
  */
  const hasFirstHalf = note(parseJson(p.probs?.firstHalf));

  return {
    columns: {
      recommended_odd: odd.value,
      recommended_family: family.value,
      recommended_period: period.value,
      recommended_scope: scope.value,
      recommended_book_line: bookLine.value,
      logo_home: logoHome.value,
      logo_away: logoAway.value,
      card_market_validations: cmv.value,
      card_markets: cm.value,
      corners_total: corners.value,
      shots_on_target_total: shots.value,
      shots_total: shotsTotal.value,
      cards_total: cardsTotal.value,
      cards_points: cardsPoints.value,
      first_half_goals: firstHalfGoals.value,
      has_first_half_probs: hasFirstHalf.present ? true : null
    },
    diagnostics
  };
}

/** All sixteen columns. Every key is always present; absent sources are null. */
export function deriveHistoryListColumns(payload) {
  return deriveHistoryListColumnsWithDiagnostics(payload).columns;
}

/**
 * Only the eight columns settlement may change.
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
