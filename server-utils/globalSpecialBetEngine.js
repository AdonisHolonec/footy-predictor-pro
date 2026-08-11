/**
 * Global Special Bet — candidate pool, ranking and diversification.
 *
 * Distinct product from the per-match "Special Bet · Top signals"
 * (src/utils/specialBet.ts), which stays exactly as it is: that one combines
 * markets WITHIN one fixture, this one combines the best selections ACROSS the
 * fixtures of a user's favourite leagues.
 *
 * Server-side ONLY, and deliberately so. The server reconstructs the candidate
 * pool from the canonical `predictions_history.raw_payload` and never trusts a
 * client-supplied selection, so a browser copy of this engine would be a second
 * opinion with no authority — the exact shape of the Admin/Mobile divergence
 * this product already had to fix once.
 *
 * Pure and deterministic by construction — no clock, no I/O. `now` is an
 * argument so the same inputs always produce the same bet, which is what makes
 * an immutable snapshot meaningful.
 *
 * One pool feeds every variant: 3, 5 and 8 are slices of the SAME ranked and
 * diversified list, never three separate algorithms.
 */

import { parseOverUnder, resolveMarketFamily } from "./metaLearning/marketFamily.js";

/** A selection must be worth including at all — below this it is not a bet, it is a formality. */
export const MIN_SELECTION_ODD = 1.25;

/**
 * Families the server can actually settle today, as `resolveMarketFamily`
 * names them.
 *
 * A bet is only as good as its ability to resolve: a leg the settlement layer
 * cannot grade leaves the whole accumulator pending forever. `cards` and
 * `correct_score` have no official total in the system (`marketResults` carries
 * corners, shots on target and first-half goals, nothing else), and
 * `ou_other`/`other` are unclassified by construction — so none of them may
 * enter the pool.
 *
 * Applied during collection, before ranking and before any variant is sliced,
 * so an unsettleable market can never reach a bet.
 */
export const SETTLEABLE_MARKET_FAMILIES = new Set(["ou", "corners", "shots", "1x2", "dc", "btts"]);

export const GLOBAL_SPECIAL_BET_VARIANTS = [3, 5, 8];

/**
 * How much ranking strength league spread is allowed to cost.
 *
 * A candidate from a not-yet-used league is preferred only while it scores at
 * least this fraction of the best remaining candidate. Spread is a preference,
 * never a reason to carry a weak selection, and never a reason to fail to build
 * a bet — a policy knob, deliberately not part of the score itself.
 */
export const LEAGUE_SPREAD_TOLERANCE = 0.85;

/**
 * @typedef {object} GlobalCandidate
 * @property {number} fixtureId
 * @property {number} leagueId
 * @property {string} kickoff
 * @property {string} fixtureLabel   Home – Away, so a stored snapshot stays readable
 * @property {string} market         resolveMarketFamily() output
 * @property {string} selection      settled exactly as written, e.g. "Over 7.5"
 * @property {"over"|"under"|null} side
 * @property {number|null} line
 * @property {number} odds
 * @property {number} confidence
 * @property {number} valueScore
 * @property {number} dataQuality
 * @property {number} score          valueScore × dataQuality
 */

/** Why a market never made it into the pool. Counted, never silently dropped. */
function emptyRejections() {
  return {
    leagueNotSelected: 0,
    alreadyStarted: 0,
    insufficientData: 0,
    notRecommendable: 0,
    oddBelowMinimum: 0,
    missingData: 0,
    marketNotSettleable: 0
  };
}

/**
 * Missing means missing. `Number(null)` is 0 and `Number("")` is 0, so a plain
 * Number()/isFinite() check silently turns an absent odd or value score into a
 * real-looking zero — which is precisely the "missing data as fallback" this
 * product must never do.
 */
function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The selection label a market settles under. Built from the market's own
 * side/line rather than re-parsed from prose, so the snapshot carries the same
 * shape the settlement layer compares against.
 */
function buildSelectionLabel(type, side, line) {
  if (side && line != null) return `${side === "over" ? "Over" : "Under"} ${line.toFixed(1)}`;
  return String(type || "").trim();
}

/**
 * Every eligible selection across the given fixtures, with hard filters applied
 * and every rejection counted.
 *
 * Nothing is invented and nothing falls back: a market missing odds, confidence,
 * value score or data quality is rejected, not defaulted. A high-confidence
 * market that fails the odds floor is rejected too — confidence never buys an
 * exemption.
 *
 * @param {{ rows: object[], leagueIds: number[], now: number }} options
 * @returns {{ candidates: GlobalCandidate[], examined: number, rejected: Record<string, number> }}
 */
export function collectGlobalCandidates({ rows, leagueIds, now }) {
  const allowedLeagues = new Set((leagueIds || []).map((id) => Number(id)));
  const rejected = emptyRejections();
  const candidates = [];
  let examined = 0;

  for (const row of rows || []) {
    const markets = row?.valueEngine?.markets || [];
    const leagueId = Number(row?.leagueId);
    const fixtureId = Number(row?.id);
    const kickoffMs = row?.kickoff ? new Date(row.kickoff).getTime() : Number.NaN;

    // Row-level gates are counted once per market so the numbers add up against
    // `examined` — a row rejected wholesale still explains every market it held.
    const marketCount = markets.length;

    if (!allowedLeagues.has(leagueId)) {
      examined += marketCount;
      rejected.leagueNotSelected += marketCount;
      continue;
    }
    if (!Number.isFinite(kickoffMs) || kickoffMs <= now) {
      examined += marketCount;
      rejected.alreadyStarted += marketCount;
      continue;
    }
    if (row?.insufficientData) {
      examined += marketCount;
      rejected.insufficientData += marketCount;
      continue;
    }

    const confidence = finiteOrNull(row?.recommended?.confidence);
    const dataQuality = finiteOrNull(row?.modelMeta?.dataQuality);

    for (const market of markets) {
      examined += 1;

      if (market?.recommendable !== true) {
        rejected.notRecommendable += 1;
        continue;
      }

      const odds = finiteOrNull(market?.odds);
      const valueScore = finiteOrNull(market?.valueScore);
      const line = finiteOrNull(market?.line);
      const side = parseOverUnder(market?.type)?.side ?? null;
      const selection = buildSelectionLabel(market?.type, side, line);

      // Missing inputs are disqualifying, not defaultable. Confidence and data
      // quality come from the row, odds and value score from the market.
      if (
        confidence === null ||
        dataQuality === null ||
        odds === null ||
        valueScore === null ||
        !Number.isFinite(fixtureId) ||
        !selection
      ) {
        rejected.missingData += 1;
        continue;
      }

      // The odds floor is checked on its own, after data completeness, so a
      // short-priced favourite is reported as "too short" rather than "missing".
      if (odds < MIN_SELECTION_ODD) {
        rejected.oddBelowMinimum += 1;
        continue;
      }

      // A market we cannot settle must never reach ranking, let alone a bet.
      const family = resolveMarketFamily(market?.type, market?.family);
      if (!SETTLEABLE_MARKET_FAMILIES.has(family)) {
        rejected.marketNotSettleable += 1;
        continue;
      }

      candidates.push({
        fixtureId,
        leagueId,
        kickoff: String(row.kickoff),
        fixtureLabel: `${row.teams?.home ?? "?"} – ${row.teams?.away ?? "?"}`,
        market: family,
        selection,
        side,
        line,
        odds,
        confidence,
        valueScore,
        dataQuality,
        score: valueScore * dataQuality
      });
    }
  }

  return { candidates, examined, rejected };
}

/**
 * Rank by `valueScore × dataQuality`.
 *
 * `valueScore` is NOT invented here: server-utils/value/ValueEngine.js already
 * blends expected value, edge, Kelly and confidence through configurable
 * weights, and penalises non-positive EV. Re-deriving a second formula would
 * mean maintaining two opinions about the same thing, so this multiplies that
 * existing score by the one dimension it does not contain — how much the model
 * trusts the data behind the fixture (`modelMeta.dataQuality`, 0..1).
 *
 * Ties break by odds, then confidence, then fixtureId, so ordering is total and
 * reproducible rather than dependent on input order.
 *
 * @param {GlobalCandidate[]} candidates
 * @returns {GlobalCandidate[]}
 */
export function rankGlobalCandidates(candidates) {
  return [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      b.odds - a.odds ||
      b.confidence - a.confidence ||
      a.fixtureId - b.fixtureId
  );
}

/**
 * One selection per fixture (hard), spread across leagues (soft).
 *
 * The fixture rule is absolute: two selections from the same match are one
 * correlated bet wearing two labels. The league rule is a preference — a
 * candidate from an unused league is taken ahead of a stronger one only while
 * it stays within LEAGUE_SPREAD_TOLERANCE of it, so spread never drags a weak
 * selection in and never prevents a bet from being built.
 *
 * @param {GlobalCandidate[]} ranked
 * @returns {GlobalCandidate[]}
 */
export function diversifyGlobalCandidates(ranked) {
  const bestPerFixture = new Map();
  for (const candidate of ranked) {
    if (!bestPerFixture.has(candidate.fixtureId)) bestPerFixture.set(candidate.fixtureId, candidate);
  }

  const remaining = [...bestPerFixture.values()];
  const usedLeagues = new Set();
  const ordered = [];

  while (remaining.length > 0) {
    const best = remaining[0]; // `remaining` stays in ranked order
    const threshold = best.score * LEAGUE_SPREAD_TOLERANCE;

    const freshLeagueIndex = remaining.findIndex(
      (c) => !usedLeagues.has(c.leagueId) && c.score >= threshold
    );
    const pickIndex = freshLeagueIndex >= 0 ? freshLeagueIndex : 0;

    const [picked] = remaining.splice(pickIndex, 1);
    usedLeagues.add(picked.leagueId);
    ordered.push(picked);
  }

  return ordered;
}

function toBet(variant, selections) {
  const totalOdds = selections.reduce((acc, s) => acc * s.odds, 1);
  const averageConfidence = selections.reduce((acc, s) => acc + s.confidence, 0) / selections.length;
  return {
    variant,
    selections,
    totalOdds: Number(totalOdds.toFixed(3)),
    averageConfidence: Number(averageConfidence.toFixed(2))
  };
}

/**
 * Build the 3 / 5 / 8 variants from one pool.
 *
 * A variant with fewer eligible selections than it needs is NOT built and NOT
 * padded — an 8-fold assembled from six good selections and two fillers is a
 * worse product than no 8-fold.
 *
 * @param {{ rows: object[], leagueIds: number[], now: number }} options
 * @param {number[]} [variants]
 */
export function buildGlobalSpecialBets(options, variants = GLOBAL_SPECIAL_BET_VARIANTS) {
  const collected = collectGlobalCandidates(options);
  const pool = diversifyGlobalCandidates(rankGlobalCandidates(collected.candidates));

  const bets = {};
  const unavailable = [];

  for (const variant of variants) {
    if (pool.length >= variant) {
      bets[variant] = toBet(variant, pool.slice(0, variant));
    } else {
      unavailable.push({ variant, available: pool.length, required: variant });
    }
  }

  return { ...collected, pool, bets, unavailable };
}

export default {
  MIN_SELECTION_ODD,
  GLOBAL_SPECIAL_BET_VARIANTS,
  LEAGUE_SPREAD_TOLERANCE,
  collectGlobalCandidates,
  rankGlobalCandidates,
  diversifyGlobalCandidates,
  buildGlobalSpecialBets
};
