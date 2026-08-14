/**
 * Referee statistics from our own settled predictions — zero API-Football calls.
 *
 * Card counts now have a source: settlement records the observed match total as
 * raw_payload.marketResults.cardsTotal, so a referee's card profile can be aggregated
 * from the same history rows that already yield avgGoals. It is returned under `cards`,
 * NOT in the legacy `avgCards` field — see the note on that field below.
 */

import { getSupabaseAdmin } from "../supabaseAdmin.js";

const FINAL_STATUSES = ["FT", "AET", "PEN"];
const HOME_WIN_BASELINE = 0.45;

function envInt(name, fallback) {
  const n = Number(typeof process !== "undefined" ? process.env?.[name] : undefined);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Existing referee-history threshold. Reused for cards as-is; NOT revalidated for them. */
export function refereeMinSamples(override) {
  return Math.max(1, Number(override) || envInt("REFEREE_STATS_MIN_SAMPLES", 3));
}

/**
 * A card total that actually came from an observation.
 *
 * PostgREST returns `->>` selections as text, and an absent JSON key comes back as null.
 * The `== null` check therefore has to precede Number(), for the same reason it does in
 * fixtureCardTotals.js: `Number(null) === 0` is finite, and a fixture whose card total was
 * never recorded would otherwise enter a referee's average as a real 0-card match.
 *
 * @returns {number|null}
 */
function observedTotal(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function median(sortedAsc) {
  if (!sortedAsc.length) return null;
  const mid = sortedAsc.length / 2;
  return sortedAsc.length % 2
    ? sortedAsc[Math.floor(mid)]
    : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

const round3 = (n) => (n == null ? null : Number(n.toFixed(3)));

/**
 * Aggregate a referee's card observations. Pure — no I/O — so the statistic can be tested
 * directly and reused by callers other than the history query.
 *
 * UNIT: cardsTotal (raw yellow + red), the same unit the team rolling averages use.
 * `cardsPointsAvg` carries the weighted red*2+yellow convention over the SAME observations,
 * as metadata for the unit comparison that comes later — it never feeds avgCards.
 *
 * A row whose cardsTotal is absent is UNKNOWN: counted in `unknownCount`, excluded from
 * every average. A recorded 0 is a real card-free match and is included.
 *
 * `avgCards` is deliberately null below the existing sample threshold: a two-match mean
 * describes two matches, it does not estimate a referee. `sampleSize`, `minCards`,
 * `maxCards` and `medianCards` are reported regardless, so how much evidence exists per
 * referee can be inspected empirically before any threshold is argued for.
 *
 * @param {Array<{cardsTotal?: unknown, cardsPoints?: unknown}>} rows
 * @param {{ minSamples?: number }} [opts]
 */
export function aggregateRefereeCards(rows, opts = {}) {
  const minSamples = refereeMinSamples(opts.minSamples);
  const totals = [];
  const points = [];
  let unknownCount = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const total = observedTotal(row?.cardsTotal);
    if (total == null) {
      unknownCount += 1;
      continue;
    }
    totals.push(total);
    // Points ride along only when the same observation carried them; a missing points
    // value never removes the match from the cardsTotal sample.
    const pts = observedTotal(row?.cardsPoints);
    if (pts != null) points.push(pts);
  }

  const sampleSize = totals.length;
  const sufficient = sampleSize >= minSamples;
  const sorted = [...totals].sort((a, b) => a - b);
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  return {
    avgCards: sufficient ? round3(mean(totals)) : null,
    sampleSize,
    unknownCount,
    minCards: sorted.length ? sorted[0] : null,
    maxCards: sorted.length ? sorted[sorted.length - 1] : null,
    medianCards: round3(median(sorted)),
    // Metadata only, for the count-vs-points question. Never an input to avgCards.
    cardsPointsAvg: sufficient && points.length ? round3(mean(points)) : null,
    cardsPointsSampleSize: points.length,
    sufficient,
    minSamplesRequired: minSamples,
    unit: "cardsTotal",
    source: "predictions_history.marketResults.cardsTotal"
  };
}

/**
 * @param {string} refereeName
 * @param {{ excludeFixtureId?: number|string, minSamples?: number }} [opts]
 * @returns {Promise<{avgGoals:number, avgCards:null, homeWinBias:number, sampleSize:number,
 *   source:string, cards:ReturnType<typeof aggregateRefereeCards>}|null>}
 */
export async function computeRefereeStatsFromHistory(refereeName, opts = {}) {
  const name = String(refereeName || "").trim();
  // No referee identity → no statistic. A blank name must never be aggregated into a
  // phantom "unnamed referee" profile shared by every fixture that lacks an appointment.
  if (!name) return null;

  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const minSamples = refereeMinSamples(opts.minSamples);

  try {
    let query = supabase
      .from("predictions_history")
      // Card totals are pulled as JSON paths rather than whole raw_payload rows: the
      // payload is ~134KB at the median, so selecting it for 200 rows would move ~27MB
      // to compute two averages.
      .select(
        "fixture_id, score_home, score_away, " +
          "cardsTotal:raw_payload->marketResults->>cardsTotal, " +
          "cardsPoints:raw_payload->marketResults->>cardsPoints"
      )
      .eq("referee_name", name)
      .in("match_status", FINAL_STATUSES)
      .not("score_home", "is", null)
      .not("score_away", "is", null)
      .limit(200);

    if (opts.excludeFixtureId != null) {
      query = query.neq("fixture_id", Number(opts.excludeFixtureId));
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data) || data.length < minSamples) return null;

    let goalsSum = 0;
    let homeWins = 0;
    let decided = 0;
    for (const row of data) {
      const h = Number(row.score_home);
      const a = Number(row.score_away);
      if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
      goalsSum += h + a;
      if (h !== a) {
        decided += 1;
        if (h > a) homeWins += 1;
      }
    }

    const sampleSize = data.length;
    const avgGoals = goalsSum / sampleSize;
    const homeWinRate = decided > 0 ? homeWins / decided : HOME_WIN_BASELINE;

    return {
      avgGoals: Number(avgGoals.toFixed(3)),
      // Still null, deliberately. RefereeEngine and RefereeContext both branch on this
      // field, so filling it here would move cardsBoost off the goals fallback and switch
      // on RefereeContext's pace term — a change to live probabilities. The measured
      // statistic lives in `cards` below; wiring it into the engines is a separate step.
      avgCards: null,
      homeWinBias: Number((homeWinRate - HOME_WIN_BASELINE).toFixed(3)),
      sampleSize,
      source: "internal_history",
      cards: aggregateRefereeCards(data, { minSamples })
    };
  } catch {
    return null;
  }
}

export default { computeRefereeStatsFromHistory, aggregateRefereeCards, refereeMinSamples };
