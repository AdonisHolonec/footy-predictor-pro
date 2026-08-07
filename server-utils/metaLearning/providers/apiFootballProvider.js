/**
 * Provider adapter: API-Football's /predictions -> normalized selections.
 *
 * READ-ONLY over prediction_benchmarks rows the existing sweep already wrote. Makes no
 * upstream call and re-normalizes nothing: `consensus` (BenchmarkConsensusResult) and
 * `api_prediction` (afb-v1) are consumed as stored.
 *
 * Two things this unlocks that nothing currently reads:
 *   1. `consensus.perFamilyBreakdown` — the provider's opinion on families OTHER than
 *      the one our published pick happened to use. The sweep stores these and then only
 *      ever compares the single primary family, discarding real signal.
 *   2. Provider ABSTENTIONS — a 33/33/33 percent triple with a null winner is
 *      API-Football's "no data" sentinel (already detected in classify1x2()). Counting
 *      those as an opinion would flatter its coverage; counting the rate itself is a
 *      genuine provider-quality metric.
 */

import { PROVIDER_KEYS } from "../metaLearningConfig.js";
import { resolveLine } from "../marketFamily.js";

function toNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** apiPick.source -> signal quality. 1 = structural upstream field, 2 = derived by us,
 * 3 = parsed from free-text `advice`, whose grammar is explicitly not contractually
 * stable and which is excluded from dominance verdicts by default. */
const SOURCE_QUALITY = { winner: 1, under_over: 1, percent: 2, advice: 3 };

/**
 * True when the provider had no opinion for this fixture. Covers both the explicit
 * "no comparable pick" case and the 33/33/33 no-data sentinel.
 */
export function isAbstention(row) {
  const inferred = row?.consensus?.apiPick?.inferredPick ?? null;
  if (inferred) return false;

  const percents = row?.api_prediction?.winPercent || {};
  const values = [percents.home, percents.draw, percents.away].map(toNumber).filter((v) => v != null);
  if (values.length === 3) {
    const max = Math.max(...values);
    const ties = values.filter((v) => v === max).length;
    if (ties > 1) return true; // no strict maximum => sentinel, not a lean
  }
  return true;
}

/** Team ids, recovered from the stored raw response so analytics never re-fetches /fixtures. */
export function extractTeamIds(row) {
  const teams = row?.api_raw?.teams || row?.api_prediction?.raw?.teams || null;
  const homeTeamId = toNumber(teams?.home?.id);
  const awayTeamId = toNumber(teams?.away?.id);
  return {
    homeTeamId: homeTeamId != null && homeTeamId > 0 ? homeTeamId : null,
    awayTeamId: awayTeamId != null && awayTeamId > 0 ? awayTeamId : null
  };
}

/** Formats a breakdown side into a pick string gradeable by evaluateTopPick(). */
function formatSide(family, side, line) {
  if (!side) return null;
  if (family === "ou") {
    if (line == null) return null;
    return `${String(side).toLowerCase() === "under" ? "Under" : "Over"} ${line}`;
  }
  return String(side).toUpperCase();
}

/**
 * @param {object} row prediction_benchmarks row
 * @param {{ modelVersion?: string }} opts
 * @returns {object[]} normalized selection descriptors. `result: null` means "this layer
 *   must grade it" (secondary families were never graded by the sweep).
 */
export function extractSelections(row, opts = {}) {
  if (!row) return [];
  const fixtureId = toNumber(row.fixture_id);
  if (fixtureId == null || fixtureId <= 0) return [];

  const consensus = row.consensus || {};
  const apiPick = consensus.apiPick || {};
  const modelVersion = String(opts.modelVersion || row.model_version || "");
  const kickoffAt = row.kickoff_at || null;
  const out = [];

  const primaryFamily = apiPick.family || null;
  const primaryPick = apiPick.inferredPick || null;

  if (primaryFamily && primaryPick) {
    out.push({
      providerKey: PROVIDER_KEYS.apiFootball,
      fixtureId,
      modelVersion,
      marketFamily: primaryFamily,
      selection: String(primaryPick),
      line: resolveLine(primaryPick),
      isPrimary: true,
      statedConfidence: toNumber(apiPick.confidencePct),
      signalSource: apiPick.source || null,
      signalQuality: SOURCE_QUALITY[apiPick.source] ?? 2,
      // The sweep already graded the primary pick with evaluateTopPick().
      result: row.api_result === "win" ? "win" : row.api_result === "loss" ? "loss" : "pending",
      kickoffAt,
      settledAt: row.settled_at || null,
      sourceRow: { table: "prediction_benchmarks", source: apiPick.source ?? null }
    });
  }

  // Secondary family opinions. Skipped when lineMismatch is set (an O/U line we cannot
  // line up) and when the family duplicates the primary one.
  const breakdown = consensus.perFamilyBreakdown || {};
  for (const [family, entry] of Object.entries(breakdown)) {
    if (!entry || family === primaryFamily) continue;
    if (entry.lineMismatch) continue;
    const line = family === "ou" ? toNumber(row.api_prediction?.underOver?.replace?.(/[+-]/, "")) : null;
    const selection = formatSide(family, entry.apiSide, line);
    if (!selection) continue;

    out.push({
      providerKey: PROVIDER_KEYS.apiFootball,
      fixtureId,
      modelVersion,
      marketFamily: family,
      selection,
      line: resolveLine(selection),
      isPrimary: false,
      // winPercent only maps onto 1X2; every other family's confidence is genuinely
      // unknown and must stay null rather than borrow the 1X2 number.
      statedConfidence: null,
      signalSource: "per_family_breakdown",
      signalQuality: 2,
      result: null, // never graded by the sweep — the projector grades it
      kickoffAt,
      settledAt: null,
      sourceRow: { table: "prediction_benchmarks", source: "perFamilyBreakdown" }
    });
  }

  return out;
}

export default { extractSelections, isAbstention, extractTeamIds };
