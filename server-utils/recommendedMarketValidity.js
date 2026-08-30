/**
 * Recommendation-market validity — ANALYTICS ELIGIBILITY ONLY.
 *
 * Two truths about a historical row must never be conflated:
 *
 *   settlement validity      "the declared market was graded correctly"
 *                            Shots Over 10.5 with 25 total shots IS a win, and
 *                            `validation` says so. That grade is correct and is
 *                            never touched by anything in this module.
 *
 *   recommendation validity  "this recommendation is a real market position"
 *                            The Aug-2026 audit found 69 Total Shots rows whose
 *                            bookmaker board was quoted at a shots-on-target
 *                            scale (e.g. 10.5 on a λ_total 26.9 fixture). They
 *                            settled correctly and won 66/66 — a certainty sold
 *                            as a 92%-confidence pick, which inflated every
 *                            recommendation aggregate that counted them.
 *
 * This module answers only the second question, and its answer feeds only
 * performance analytics. It classifies; it never regrades, rewrites or deletes.
 *
 * The predicate is NOT a second market-identity algorithm: it delegates to
 * `isScaleGuardedKind`, `isLineOnModelScale` and `isContestableLine` — the very
 * functions the live candidate guard (PR #214) applies, in the same
 * either-fires-refuses combination — so candidate generation, persistence,
 * backfill and analytics can never drift apart. Widening validity to another
 * family is a change to `SCALE_GUARDED_KINDS`, not a change here.
 *
 * One asymmetry is deliberate and cannot be removed: the guard runs on a live
 * candidate and refuses it; this runs on a persisted row and only labels it.
 * Nothing here re-grades, rewrites or deletes anything.
 */

import {
  isContestableLine,
  isLineOnModelScale,
  isScaleGuardedKind,
  priceLineFromBlock
} from "./pipeline/decision/repriceCandidateLine.js";

/**
 * The only invalidity reason this PR defines. New categories need their own
 * evidence and their own PR — an unrecognised reason must never be invented
 * here just to make a row disappear from a chart.
 */
export const RECOMMENDED_MARKET_INVALID_REASONS = Object.freeze({
  LINE_OFF_MODEL_SCALE: "line_off_model_scale"
});

/** Persisted recommendation family -> the discovery kind that produced it. */
const FAMILY_TO_KIND = Object.freeze({
  Shots: "shots_total",
  "Shots on Target": "shots_on_target",
  Corners: "corners",
  Cards: "generic"
});

/** Persisted recommendation family -> the `probs` block that prices it. */
const FAMILY_TO_BLOCK = Object.freeze({
  Shots: "shotsTotal",
  "Shots on Target": "shotsOnTarget",
  Corners: "corners",
  Cards: "cards"
});

/** "Shots Over 10.5" / "Under 12.5" -> 10.5 / 12.5. Line only, no grading. */
function lineFromPick(pick) {
  const m = String(pick || "")
    .toLowerCase()
    .match(/\b(?:over|under|peste|sub)\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Which side of the line the recommendation took, or null when unstated. */
function sideFromPick(pick) {
  const p = String(pick || "").toLowerCase();
  if (/\b(?:under|sub)\s*\d/.test(p)) return "under";
  if (/\b(?:over|peste)\s*\d/.test(p)) return "over";
  return null;
}

/**
 * Classify one recommendation.
 *
 * @param {{ family?: string|null, bookLine?: number|null, pick?: string|null,
 *   probs?: Record<string, object>|null }} source
 * @returns {{ valid: boolean, reason: string|null }} `valid:true` unless the
 *   recommendation is provably off its own model's scale. Anything the
 *   predicate cannot evaluate — an unguarded family, a block without usable
 *   lambdas, an unparseable line — is VALID: a row is only ever excluded from
 *   analytics on positive evidence, never on absent evidence.
 */
export function classifyRecommendedMarket(source) {
  const family = source?.family ?? null;
  const kind = FAMILY_TO_KIND[String(family)] ?? null;
  if (!isScaleGuardedKind(kind)) return { valid: true, reason: null };

  const block = source?.probs?.[FAMILY_TO_BLOCK[String(family)]] ?? null;
  /*
    `Number(null)` is 0, not NaN — so a legacy row with a NULL
    recommended_book_line would be read as "line 0" and condemned as maximally
    off-scale. Absent means absent: fall through to the pick text instead.
  */
  const rawLine = source?.bookLine;
  const numericLine =
    rawLine === null || rawLine === undefined || rawLine === "" ? Number.NaN : Number(rawLine);
  const line = Number.isFinite(numericLine) ? numericLine : lineFromPick(source?.pick);
  if (!Number.isFinite(line)) return { valid: true, reason: null };

  // The live guard's own two invariants, in the same order and with the same
  // semantics as repriceCandidateLine:
  //
  //   isLineOnModelScale   the line-to-lambda ratio (returns true when the
  //                        ratio cannot be formed — no positive evidence)
  //   isContestableLine    the 1% probability-mass floor
  //
  // Both are required, because the guard refuses a candidate when EITHER fires.
  // Applying only the ratio here would let a row classify valid that the live
  // pipeline would refuse to produce. Measured against every persisted Total
  // Shots recommendation, the mass rule adds 0 rows to the ratio rule's 69 —
  // it changes no historical verdict, it removes a way for the two definitions
  // to drift.
  if (!isLineOnModelScale(block, line)) {
    return { valid: false, reason: RECOMMENDED_MARKET_INVALID_REASONS.LINE_OFF_MODEL_SCALE };
  }
  const side = sideFromPick(source?.pick);
  if (side) {
    const priced = priceLineFromBlock(block, side, line);
    // A block that cannot price the line is again absent evidence, not proof.
    if (priced && !isContestableLine(priced.asian)) {
      return { valid: false, reason: RECOMMENDED_MARKET_INVALID_REASONS.LINE_OFF_MODEL_SCALE };
    }
  }
  return { valid: true, reason: null };
}

/**
 * Classify from a persisted `predictions_history` row (or the projection the
 * backfill selects). Deterministic and side-effect free: the same row always
 * yields the same verdict, which is what makes the backfill idempotent.
 *
 * @param {object|null|undefined} row
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function classifyRecommendedMarketFromRow(row) {
  const source = row && typeof row === "object" ? row : {};
  const payload =
    source.raw_payload && typeof source.raw_payload === "object" ? source.raw_payload : {};
  return classifyRecommendedMarket({
    family: source.recommended_family ?? payload.recommended?.family ?? null,
    bookLine: source.recommended_book_line ?? payload.recommended?.bookLine ?? null,
    pick: source.recommended_pick ?? payload.recommended?.pick ?? null,
    // The backfill selects `probs` as a narrow JSON sub-path; a full payload
    // carries the same shape, so both callers land here unchanged.
    probs: source.probs ?? payload.probs ?? null
  });
}

/**
 * READ SIDE — is this row's RECOMMENDED slot excluded from performance stats?
 *
 * Only an explicit `false` excludes. NULL is "not classified" (every row
 * predating the backfill) and MUST keep counting, so the migration changes no
 * published number until the backfill has actually run. Accepts a DB row
 * (`recommended_market_valid`) or a mapped client entry
 * (`recommendedMarketValid`) because `aggregateCardMarketStats` is documented
 * to take either.
 *
 * @param {object|null|undefined} rowOrEntry
 * @returns {boolean}
 */
export function isRecommendedSlotExcluded(rowOrEntry) {
  if (!rowOrEntry || typeof rowOrEntry !== "object") return false;
  return (
    rowOrEntry.recommended_market_valid === false ||
    rowOrEntry.recommendedMarketValid === false
  );
}

export default classifyRecommendedMarket;
