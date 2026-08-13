/**
 * Global Special Bet — candidate pool, safety gates, ranking and diversification.
 *
 * PRODUCT CONTRACT (approved Aug 2026): GSB is a BEST-CHANCE accumulator, not a
 * best-value one. It builds the 3/5/8 ticket with the highest realistic chance
 * of winning as a whole:
 *
 *     safety gates → probability DESC → diversity constraint → slice 3/5/8
 *
 * The probability used is `valueEngine.markets[].probability` — P(full win),
 * the exact semantics Recommended ranks by. valueScore / EV / Kelly / edge are
 * carried as metadata for audit but NEVER influence selection: the previous
 * `valueScore × dataQuality` ranking let a 68%@5.00 Double Chance outrank an
 * 82%@1.40 leg purely on commercial saturation, which contradicted the product.
 * Best Value keeps EV optimisation; Recommended keeps single-pick argmax(P);
 * GSB is the best safe COMBINATION of P(full win) legs.
 *
 * Distinct product from the per-match "Special Bet · Top signals"
 * (src/utils/specialBet.ts), which stays exactly as it is.
 *
 * Server-side ONLY, pure and deterministic — no clock, no I/O. `now` is an
 * argument so the same inputs always produce the same bet, which is what makes
 * an immutable snapshot meaningful.
 *
 * One pool feeds every variant: 3, 5 and 8 are slices of the SAME ranked and
 * diversified list, never three separate algorithms. A variant the safe pool
 * cannot fill is UNAVAILABLE — never padded with legs below the safety floor.
 */

import { parseOverUnder, resolveMarketFamily } from "./metaLearning/marketFamily.js";
import { formatLineLabel } from "./marketIdentity.js";
import { isQuarterLine } from "./asianTotals.js";

/** A selection must be worth including at all — below this it is not a bet, it is a formality. */
export const MIN_SELECTION_ODD = 1.25;

/**
 * Minimum P(full win) for a GSB leg.
 *
 * Evidence (Aug 2026 read-only audit): the legs that killed real tickets had
 * P = 0.44–0.52; every production pool examined still built all three variants
 * at this floor with 4× headroom. The floor does not pick the ticket — the
 * probability sort does — it guarantees no leg below it can ever be used to
 * fill a variant on a thin day. Strictly above Recommended's 50% bar on
 * purpose: an accumulator multiplies its legs' fragility. Re-evaluate against
 * settled tickets once the sample grows.
 */
export const PROB_FLOOR = 0.6;

/**
 * Maximum model-vs-market divergence, expressed as p × odds (the same "edge"
 * ValueEngine computes). Above 2.0 the model claims at least twice the market
 * consensus — on liquid markets that is far more likely a degenerate model
 * probability than genuine value. Evidence: every settled GSB leg with
 * edge > 2.0 lost (DC 1X @2.90 p=0.71, Corners U6.5 @4.69 p=0.99); no winner
 * exceeded it. This is also the gate that keeps probability-first ranking
 * safe: a degenerate p=0.99 would otherwise SORT FIRST. Together with
 * PROB_FLOOR it implies an effective odds ceiling of 2.0/0.6 ≈ 3.33, which is
 * why no separate MAX_ODDS exists (approved decision).
 */
export const MAX_MODEL_EDGE = 2.0;

/**
 * League spread is a CONSTRAINT band, not a commercial reward: a candidate
 * from a not-yet-used league may be preferred only while its probability is
 * within this many percentage points of the best remaining candidate. A 55%
 * leg can never jump an 82% one for the sake of variety. 3pp is empirically
 * costless on production pools (0–10pp produced identical tickets) and keeps
 * the invariant tight.
 */
export const LEAGUE_SPREAD_MAX_PP = 3;

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
 * @typedef {object} GlobalCandidate
 * @property {number} fixtureId
 * @property {number} leagueId
 * @property {string} kickoff
 * @property {string|null} fixtureLabel  Home – Away, so a stored snapshot stays readable
 * @property {string|null} leagueName    the league as it read when the bet was built
 * @property {string} market         resolveMarketFamily() output
 * @property {string} selection      settled exactly as written, e.g. "Over 7.5"
 * @property {"over"|"under"|null} side
 * @property {number|null} line
 * @property {number} probability    P(full win), 0–1 — the ONLY ranking signal
 * @property {number} odds
 * @property {number} confidence     fixture-level metadata; never ranks
 * @property {number} valueScore     audit metadata; never ranks
 * @property {number} dataQuality    audit metadata; never ranks
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
    marketNotSettleable: 0,
    quarterLineUnsupported: 0,
    identityUnknown: 0,
    notTradable: 0,
    probabilityBelowFloor: 0,
    modelMarketDivergence: 0
  };
}

/**
 * Missing means missing. `Number(null)` is 0 and `Number("")` is 0, so a plain
 * Number()/isFinite() check silently turns an absent odd or probability into a
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
  // formatLineLabel is lossless: a real 10.25 asian line stays "10.25" in the
  // stored snapshot instead of the nonexistent "10.3" toFixed(1) produced.
  if (side && line != null) return `${side === "over" ? "Over" : "Under"} ${formatLineLabel(line)}`;
  return String(type || "").trim();
}

/** A name we actually have, or null. Never the empty string a caller must retest. */
function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

/**
 * The readable fixture name carried into the snapshot, or null when it is not
 * fully known.
 *
 * Both halves are required, the same rule buildFixtureLabelIndex() applies on
 * the client: half a fixture ("Arsenal – ?") reads like data, whereas null lets
 * the UI fall back to the fixture id and say honestly that it does not know.
 */
function buildFixtureLabel(teams) {
  const home = textOrNull(teams?.home);
  const away = textOrNull(teams?.away);
  return home && away ? `${home} – ${away}` : null;
}

/**
 * Market Identity Contract (#63): a GSB leg must be able to attest WHAT it is
 * a bet on. `unknown` is an explicit "we could not tell"; null/absent is a
 * legacy payload from before the contract. Both are unverifiable, so both are
 * rejected — the approved rule is known-or-out, never guessed.
 */
function hasKnownIdentity(market) {
  for (const field of [market?.betType, market?.period, market?.scope]) {
    if (field == null || field === "unknown") return false;
  }
  return true;
}

/**
 * Every eligible selection across the given fixtures, with the full SAFETY
 * CONTRACT applied and every rejection counted:
 *
 *   recommendable AND data complete AND odds >= MIN_SELECTION_ODD
 *   AND settleable family AND no quarter line
 *   AND identity known (betType/period/scope) AND tradable
 *   AND probability >= PROB_FLOOR AND probability × odds <= MAX_MODEL_EDGE
 *
 * Nothing is invented and nothing falls back: a market missing odds,
 * probability, confidence, value score or data quality is rejected, not
 * defaulted. A high-confidence market that fails any gate is rejected too —
 * confidence never buys an exemption, and neither does EV.
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
      const probability = finiteOrNull(market?.probability);
      const line = finiteOrNull(market?.line);
      const side = parseOverUnder(market?.type)?.side ?? null;
      const selection = buildSelectionLabel(market?.type, side, line);

      // Missing inputs are disqualifying, not defaultable. Probability must be
      // a real chance in (0, 1] — a zero or an out-of-range value is not a
      // probability, it is a data defect.
      if (
        confidence === null ||
        dataQuality === null ||
        odds === null ||
        valueScore === null ||
        probability === null ||
        probability <= 0 ||
        probability > 1 ||
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
      // The family set is the structural gate; `settleable: false` on the
      // market itself is the evaluation-level one — either alone rejects.
      const family = resolveMarketFamily(market?.type, market?.family);
      if (!SETTLEABLE_MARKET_FAMILIES.has(family) || market?.settleable === false) {
        rejected.marketNotSettleable += 1;
        continue;
      }

      // Quarter lines settle as half_win / half_loss, which the selection
      // status CHECK (pending/won/lost/void) cannot represent. Until the schema
      // can carry half outcomes per leg, a quarter-line leg is refused here —
      // an explicit limitation, never an approximation to a full win or loss.
      // (Integer lines are fine: their push maps to the existing VOID = 1.00.)
      if (isQuarterLine(line)) {
        rejected.quarterLineUnsupported += 1;
        continue;
      }

      if (!hasKnownIdentity(market)) {
        rejected.identityUnknown += 1;
        continue;
      }

      // Tradable is REQUIRED, exactly as Recommended and Best Value require it.
      // Strict === true: an absent flag is a legacy payload that cannot attest
      // the line is actually offered, so it is rejected, not assumed.
      if (market?.tradable !== true) {
        rejected.notTradable += 1;
        continue;
      }

      if (probability < PROB_FLOOR) {
        rejected.probabilityBelowFloor += 1;
        continue;
      }

      // Sanity gate against degenerate model probabilities: p=0.99 against a
      // 4.69 market would otherwise sort FIRST in a probability-first pool.
      if (probability * odds > MAX_MODEL_EDGE) {
        rejected.modelMarketDivergence += 1;
        continue;
      }

      candidates.push({
        fixtureId,
        leagueId,
        kickoff: String(row.kickoff),
        fixtureLabel: buildFixtureLabel(row.teams),
        leagueName: textOrNull(row.league),
        market: family,
        selection,
        side,
        line,
        probability,
        odds,
        confidence,
        valueScore,
        dataQuality
      });
    }
  }

  return { candidates, examined, rejected };
}

/**
 * Rank by P(full win), descending. Nothing commercial participates: not
 * valueScore, not EV, not Kelly, not edge. Odds appear only as the FIRST
 * tie-break at exactly equal probability — and ascending, because when the
 * model cannot separate two legs, the one the market prices shorter is the one
 * the market agrees with more. Odds can therefore never promote a lower
 * probability over a higher one. fixtureId closes the order so ranking is
 * total and reproducible rather than dependent on input order.
 *
 * @param {GlobalCandidate[]} candidates
 * @returns {GlobalCandidate[]}
 */
export function rankGlobalCandidates(candidates) {
  return [...candidates].sort(
    (a, b) =>
      b.probability - a.probability ||
      a.odds - b.odds ||
      a.fixtureId - b.fixtureId
  );
}

/**
 * One selection per fixture (hard), spread across leagues (bounded).
 *
 * The fixture rule is absolute: two selections from the same match are one
 * correlated bet wearing two labels. The league rule is a constraint band, not
 * a reward: a candidate from an unused league is taken ahead of a stronger one
 * only while it is within LEAGUE_SPREAD_MAX_PP percentage points of it, so
 * spread can reorder near-equals but can never drag a meaningfully weaker
 * probability up the ticket and never prevents a bet from being built.
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
  // Float guard: probabilities are round2 payload values, but the subtraction
  // must not turn an exact 3.00pp gap into 3.0000000004pp.
  const tolerance = LEAGUE_SPREAD_MAX_PP / 100 + 1e-9;

  while (remaining.length > 0) {
    const best = remaining[0]; // `remaining` stays in ranked order

    const freshLeagueIndex = remaining.findIndex(
      (c) => !usedLeagues.has(c.leagueId) && best.probability - c.probability <= tolerance
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
  // Π p_i under an EXPLICIT independence assumption. One-leg-per-fixture
  // removes the dominant correlation; residual same-league / same-family
  // correlation across fixtures exists and is knowingly unmodelled, which is
  // why every surface displaying this number carries the disclaimer.
  const estimatedTicketProbability = selections.reduce((acc, s) => acc * s.probability, 1);
  return {
    variant,
    selections,
    totalOdds: Number(totalOdds.toFixed(3)),
    averageConfidence: Number(averageConfidence.toFixed(2)),
    estimatedTicketProbability: Number(estimatedTicketProbability.toFixed(4))
  };
}

/**
 * Build the 3 / 5 / 8 variants from one safe pool.
 *
 * A variant with fewer SAFE selections than it needs is NOT built and NOT
 * padded — an 8-fold assembled from six good selections and two sub-floor
 * fillers is a worse product than no 8-fold. "Varianta 8 indisponibilă" is the
 * honest answer, and the rejection counters say exactly why the pool is thin.
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
  PROB_FLOOR,
  MAX_MODEL_EDGE,
  LEAGUE_SPREAD_MAX_PP,
  GLOBAL_SPECIAL_BET_VARIANTS,
  collectGlobalCandidates,
  rankGlobalCandidates,
  diversifyGlobalCandidates,
  buildGlobalSpecialBets
};
