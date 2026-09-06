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

import { resolveMarketFamily } from "./metaLearning/marketFamily.js";
import { parseOuPickAnywhere } from "./cardMarketSettlement.js";
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
  const text = String(type || "").trim();
  if (!side || line == null) return text;
  // formatLineLabel is lossless: a real 10.25 asian line stays "10.25" in the
  // stored snapshot instead of the nonexistent "10.3" toFixed(1) produced.
  const canonical = `${side === "over" ? "Over" : "Under"} ${formatLineLabel(line)}`;
  // A shots label keeps its statistic prefix ("SOT Over 7.5" / "Shots Under 29.5").
  // Both land in the same `market` family; the prefix is the only thing that says
  // WHICH statistic the leg settles against, so dropping it would make the stored
  // row ungradeable (shotsStatisticFor in the settlement module reads it back).
  const prefix = shotsStatisticPrefix(text);
  return prefix ? `${prefix} ${canonical}` : canonical;
}

/**
 * The statistic prefix of a shots label, as the value layer wrote it, or null.
 * valueMarkets.js#pushLineSelections is the single producer: "Shots " for total
 * shots, "SOT " for shots on target; corners and goals carry no prefix.
 */
function shotsStatisticPrefix(label) {
  const m = String(label || "").match(/^(SOT|Shots)\s+(?:Over|Under)\s/i);
  return m ? m[1] : null;
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
      // Prefix-tolerant on purpose: shots market types are "SOT Over 7.5" /
      // "Shots Under 29.5", which the ^-anchored goals parser rejects — every
      // shots leg was stored with side=null and could never settle (T2 audit).
      const side = parseOuPickAnywhere(market?.type)?.side ?? null;
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
/**
 * Choose `variant` legs from a ranked pool, preferring fixtures not already used.
 *
 * THE SECOND DEDUP INVARIANT. `diversifyGlobalCandidates` already guarantees one
 * leg per fixture WITHIN a ticket. This adds the across-tickets rule: a fixture
 * that a previous variant already used should not return on the next one while
 * other equally qualified fixtures remain.
 *
 * QUALITY IS NEVER TRADED FOR VARIETY. Both `fresh` and `reused` are drawn from
 * the SAME pool, which has already passed every gate — the odds floor, the
 * probability floor, settleable families, identity, tradable, the divergence
 * ceiling. Nothing is promoted, no threshold moves, and a candidate that failed
 * a gate cannot enter here just because it would have been novel. The ordering
 * of priorities is: valid, then qualified, then diverse, then minimal reuse.
 *
 * MINIMAL REUSE. When the unused remainder cannot fill the ticket, exactly
 * `variant - fresh.length` previously-used legs are taken — the fewest that make
 * a valid ticket — and they are taken in the pool's existing rank order rather
 * than by any new preference. With A B C used and D E F free, a 5 is D E F plus
 * two reused, never the three used ones plus two new.
 *
 * DETERMINISTIC. `fresh` and `reused` are stable partitions of an already
 * deterministic ranking, so the same input yields the same ticket. Nothing here
 * is random and nothing consults a clock.
 *
 * @param {GlobalCandidate[]} pool ranked, already one-leg-per-fixture
 * @param {number} variant how many legs the ticket needs
 * @param {Set<number>} excluded fixture ids used by previously built tickets
 * @returns {{selections: GlobalCandidate[], reusedFixtureIds: number[]}|null}
 */
export function selectVariantLegs(pool, variant, excluded) {
  const used = excluded instanceof Set ? excluded : new Set(excluded || []);

  const fresh = [];
  const reused = [];
  for (const candidate of pool) (used.has(candidate.fixtureId) ? reused : fresh).push(candidate);

  // Not buildable even with every leg available: the caller reports the existing
  // thin-pool answer rather than padding or downgrading.
  if (fresh.length + reused.length < variant) return null;

  const take = fresh.slice(0, variant);
  const reusedTaken = take.length < variant ? reused.slice(0, variant - take.length) : [];
  const chosen = [...take, ...reusedTaken];

  /*
    Emitted in the pool's own rank order. Position is cosmetic — totalOdds and
    the ticket probability are products and averageConfidence is a mean, so none
    of them can move — but keeping stored selections rank-ordered means this
    change is invisible to every existing reader.
  */
  const rank = new Map(pool.map((candidate, index) => [candidate, index]));
  chosen.sort((a, b) => rank.get(a) - rank.get(b));

  return { selections: chosen, reusedFixtureIds: reusedTaken.map((c) => c.fixtureId) };
}

/**
 * Build the 3 / 5 / 8 variants from one safe pool.
 *
 * A variant with fewer SAFE selections than it needs is NOT built and NOT
 * padded — an 8-fold assembled from six good selections and two sub-floor
 * fillers is a worse product than no 8-fold. "Varianta 8 indisponibilă" is the
 * honest answer, and the rejection counters say exactly why the pool is thin.
 *
 * `excludeFixtureIds` carries the fixtures earlier tickets already used, so a
 * later variant prefers new matches. It is passed IN rather than discovered
 * here because this function is pure: the caller owns the scope the exclusion
 * belongs to (one user's day, or the product's day) and this owns the rule.
 *
 * @param {{ rows: object[], leagueIds: number[], now: number,
 *           excludeFixtureIds?: Set<number>|number[] }} options
 * @param {number[]} [variants]
 */
export function buildGlobalSpecialBets(options, variants = GLOBAL_SPECIAL_BET_VARIANTS) {
  const collected = collectGlobalCandidates(options);
  const pool = diversifyGlobalCandidates(rankGlobalCandidates(collected.candidates));

  /*
    Accumulates ACROSS the variants of this call as well, so a caller that asks
    for [3, 5, 8] in one go gets three disjoint tickets — the same rule the
    persisted-exclusion callers get across separate requests. One implementation
    covers both, which is what stops the two drifting.
  */
  const used = new Set(
    options?.excludeFixtureIds instanceof Set
      ? options.excludeFixtureIds
      : options?.excludeFixtureIds || []
  );

  const bets = {};
  const unavailable = [];
  const reusedByVariant = {};

  for (const variant of variants) {
    const chosen = selectVariantLegs(pool, variant, used);
    if (!chosen) {
      unavailable.push({ variant, available: pool.length, required: variant });
      continue;
    }
    bets[variant] = toBet(variant, chosen.selections);
    reusedByVariant[variant] = chosen.reusedFixtureIds;
    for (const candidate of chosen.selections) used.add(candidate.fixtureId);
  }

  return { ...collected, pool, bets, unavailable, reusedByVariant };
}

// ── System tickets ─────────────────────────────────────────────────────────
//
// A system ticket is the SAME product as a combo, priced differently: five
// selections out of which any k must win. Everything above this line is shared
// — the candidate pool, all twelve gates, one-leg-per-fixture, the league band.
// Only the ORDER in which the safe pool is consumed differs, and it differs on
// purpose: a combo is the safest COMBINATION, a system is the best VALUE among
// legs that already passed every safety gate.
//
// This IS reachable from production, for USER tickets. Migration 052 shipped
// the schema and refused to store a system (`system_not_enabled`); 053 removed
// that gate once settlement could grade k-of-n, and POST /api/special-bets now
// accepts `bet_kind: "system"`. There is still no GLOBAL system: both
// generateGlobalTicket and the admin route refuse any kind but combo.

/** Five selections, always. The k varies; the ticket size does not. */
export const SYSTEM_SELECTION_COUNT = 5;

/** The three products, sharing one list of five. */
export const SYSTEM_K_VALUES = [3, 4, 5];

/**
 * Expected value of one selection, as a fraction of the stake.
 *
 *     ev = probability × odds − 1
 *
 * Raw against the offered price: no de-vigging, no margin removal, no
 * calibration. `probability` is the model's P(full win) exactly as the payload
 * carries it and `odds` is the snapshot price — neither is recomputed here.
 * A 0.60 chance at 2.00 returns 0.20: twenty percent of the stake, in
 * expectation.
 *
 * Returns null rather than 0 when either input is unusable. Every candidate
 * that reaches ranking has already passed the data-completeness gate, so null
 * cannot occur in the production path; it exists so a caller that hands over
 * something else gets an absence instead of a fake break-even.
 *
 * @param {{ probability: number, odds: number }} candidate
 * @returns {number|null}
 */
export function selectionExpectedValue(candidate) {
  // finiteOrNull, not Number(): `Number(null)` is 0 and `Number.isFinite(0)` is
  // true, so a Number()-first guard turns a missing probability into a real
  // -1.00 EV — an absence wearing the costume of the worst possible value. The
  // rule already has one implementation in this module; this uses it.
  const p = finiteOrNull(candidate?.probability);
  const o = finiteOrNull(candidate?.odds);
  if (p === null || o === null) return null;
  return p * o - 1;
}

/**
 * EV quantised to nine decimals, as an integer.
 *
 * Comparing raw floats with a tolerance breaks transitivity — a < b, b < c and
 * a == c can all hold at once, and Array.sort with an intransitive comparator
 * is free to produce anything. Quantising first gives "practically equal" a
 * meaning that IS transitive: two candidates tie when they land in the same
 * 1e-9 bucket. Nine decimals is far below any price or probability resolution
 * the product carries, so it only ever collapses float noise.
 */
function evBucket(candidate) {
  const ev = selectionExpectedValue(candidate);
  return ev === null ? Number.NEGATIVE_INFINITY : Math.round(ev * 1e9);
}

/**
 * Rank by EV, descending — the System order.
 *
 * SEPARATE FROM rankGlobalCandidates BY DESIGN. Combo stays probability-first
 * and is not touched by anything here; the two functions never call each other
 * and share no state, so a change to the System order cannot move a combo leg.
 *
 * This is NOT the pre-#69 ranking. That one sorted on `valueScore × dataQuality`
 * — a composite of EV, edge, Kelly and confidence — and it let a 68%@5.00 leg
 * outrank an 82%@1.40 one. Two things stop that here: the ranking is EV alone,
 * with valueScore playing no part whatsoever, and it runs AFTER the twelve
 * gates, so PROB_FLOOR (p >= 0.60) and MAX_MODEL_EDGE (p × o <= 2.0) have
 * already removed the long-priced legs that ranking could otherwise reward. The
 * edge ceiling in particular is what bounds EV: p × o <= 2.0 means ev <= 1.0 by
 * construction, and no gate is relaxed to widen the pool.
 *
 * Tie-breaks, in order, all deterministic and all reproducible from the payload:
 *   1. EV bucket, descending      — the product rule
 *   2. probability, descending    — at equal value, take the likelier leg
 *   3. confidence, descending     — then the better-evidenced fixture
 *   4. dataQuality, descending    — then the better-evidenced model input
 *   5. fixtureId, ascending       — a total order, so the result never depends
 *                                   on the order rows arrived from the database
 *
 * No clock, no randomness, no input order. Same pool in, same list out.
 *
 * @param {GlobalCandidate[]} candidates
 * @returns {GlobalCandidate[]}
 */
export function rankSystemCandidates(candidates) {
  return [...candidates].sort(
    (a, b) =>
      evBucket(b) - evBucket(a) ||
      b.probability - a.probability ||
      b.confidence - a.confidence ||
      b.dataQuality - a.dataQuality ||
      a.fixtureId - b.fixtureId
  );
}

/**
 * P(at least k of these selections win) — the Poisson-binomial tail.
 *
 * THE PRODUCT OF THE PROBABILITIES IS THE WRONG ANSWER for k < n, and not
 * approximately: Πp is P(ALL win), which is P(X >= n). A 3/5 wins in any of the
 * 26 outcome patterns with three or more winners; Πp counts one of them. Five
 * legs at 0.70 give Πp = 0.168 against P(X>=3) = 0.837 — a five-fold
 * understatement that would make the safest product look like the riskiest.
 *
 * Exact, by convolution, because n is 5: no normal approximation, no Poisson
 * approximation, and no assumption that the probabilities are equal.
 *
 *     dp[0] = 1
 *     for each p:  dp'[j] = dp[j-1]·p + dp[j]·(1-p)
 *     answer = sum of dp[k..n]
 *
 * Independence is assumed, exactly as the combo's Πp assumes it. One leg per
 * fixture removes the dominant correlation; residual same-league and
 * same-family correlation is knowingly unmodelled, which is why every surface
 * showing this number carries the disclaimer.
 *
 * @param {Array<number|null|undefined>} probabilities each in (0, 1]
 * @param {number} k
 * @returns {number|null} null for any input that is not a usable ticket
 */
export function systemTicketProbability(probabilities, k) {
  if (!Array.isArray(probabilities) || probabilities.length === 0) return null;
  const n = probabilities.length;
  if (!Number.isInteger(k) || k < 1 || k > n) return null;

  const ps = [];
  for (const raw of probabilities) {
    // A missing probability is not a zero-chance leg, it is an unanswerable
    // question — so the whole ticket has no probability rather than a wrong one.
    const p = finiteOrNull(raw);
    if (p === null || p <= 0 || p > 1) return null;
    ps.push(p);
  }

  let dp = [1];
  for (const p of ps) {
    const next = new Array(dp.length + 1).fill(0);
    for (let j = 0; j < dp.length; j += 1) {
      next[j] += dp[j] * (1 - p);
      next[j + 1] += dp[j] * p;
    }
    dp = next;
  }

  // The distribution must still be a distribution. Drifting mass would mean the
  // convolution is wrong, and a silently wrong probability is worse than none.
  const mass = dp.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(mass) || Math.abs(mass - 1) > 1e-9) return null;

  let tail = 0;
  for (let j = k; j < dp.length; j += 1) tail += dp[j];
  // Float noise can push a tail a hair past 1 or below 0; the answer is a
  // probability, so it is clamped to being one.
  return Math.min(1, Math.max(0, tail));
}

/** C(n, k), exact for the sizes this product uses. */
function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

/**
 * One system ticket over an already-chosen list of selections.
 *
 * `totalOdds` IS DELIBERATELY ABSENT. Π odds is the payout of ONE combination —
 * the all-five one. A 3/5 that wins pays the product of its three winning legs,
 * summed over every winning combination, divided by the C(5,3) stakes it was
 * placed with. Publishing Π odds as the ticket's odds would overstate a 3/5
 * payout by roughly the odds of the two legs that lost. `productOdds` below
 * carries the number under a name that says what it is, so the audit trail
 * keeps it without any surface mistaking it for a payout; it coincides with the
 * payout only when k = n.
 *
 * `estimatedTicketProbability` keeps the combo's field name because it keeps the
 * combo's MEANING — P(this ticket wins). What changes is that the right formula
 * is now available: P(X >= k) rather than Π p, which is only correct at k = n.
 * The combo path is untouched and still computes its own Π p directly.
 *
 * @param {number} systemK
 * @param {GlobalCandidate[]} selections
 */
function toSystemBet(systemK, selections) {
  const averageConfidence = selections.reduce((acc, s) => acc + s.confidence, 0) / selections.length;
  const productOdds = selections.reduce((acc, s) => acc * s.odds, 1);
  const ticketProbability = systemTicketProbability(
    selections.map((s) => s.probability),
    systemK
  );
  return {
    // `variant` keeps its one meaning across both kinds: how many selections the
    // ticket holds. The k lives in its own field, exactly as migration 052 stores it.
    variant: SYSTEM_SELECTION_COUNT,
    betKind: "system",
    systemK,
    // Own array per ticket: identical content, no shared reference a consumer
    // could mutate and corrupt the other two tickets through.
    selections: [...selections],
    combinationCount: combinations(SYSTEM_SELECTION_COUNT, systemK),
    averageConfidence: Number(averageConfidence.toFixed(2)),
    productOdds: Number(productOdds.toFixed(3)),
    // Four decimals, the precision special_bets.ticket_probability carries.
    // Null stays null: an unanswerable probability is never rounded into 0.0000.
    estimatedTicketProbability: ticketProbability === null ? null : Number(ticketProbability.toFixed(4))
  };
}

/**
 * Is this a shape the System product actually offers?
 *
 * THE PRODUCT CONTRACT IS EXACTLY FIVE SELECTIONS, of which 3, 4 or 5 must win.
 * Nothing else. The settlement engine is deliberately more general — it grades
 * any k-of-n it is handed, and it has to be, because refusing a row it could
 * settle would leave that row pending forever. This function is the other end:
 * the gate a ticket must pass BEFORE it is created, so a shape outside the
 * product never reaches the database in the first place.
 *
 * Returns a verdict rather than throwing. An out-of-contract shape is an
 * ordinary answer to an ordinary question — the caller decides whether it is a
 * refusal to the user, a skipped ticket, or a logged defect — and exceptions
 * would force every caller to wrap a try/catch to ask it.
 *
 * The two rejection reasons for k are different failures and are kept apart:
 *   invalid_k      it is not an integer at all — missing, fractional, a string,
 *                  NaN. There is no k here to consider.
 *   unsupported_k  it IS an integer, just not one this product sells: 0, -1, 2,
 *                  6. A k the schema might even accept (system_k >= 2), but the
 *                  product does not.
 *
 * Selection count is checked first: a 3-selection ticket asking for 3 winners is
 * wrong because of its size, and reporting "unsupported k" there would send the
 * caller after the wrong field.
 *
 * @param {{ selections?: unknown[], systemK?: unknown }} [shape]
 * @returns {{ valid: boolean, reason: null|"invalid_selection_count"|"invalid_k"|"unsupported_k",
 *             selectionCount: number, requiredSelectionCount: number,
 *             systemK: number|null, supportedK: number[], combinationCount: number|null }}
 */
export function validateSystemShape({ selections, systemK } = {}) {
  const list = Array.isArray(selections) ? selections : null;
  const selectionCount = list ? list.length : 0;
  const base = {
    selectionCount,
    requiredSelectionCount: SYSTEM_SELECTION_COUNT,
    supportedK: [...SYSTEM_K_VALUES],
    systemK: null,
    combinationCount: null
  };

  if (!list || selectionCount !== SYSTEM_SELECTION_COUNT) {
    return { ...base, valid: false, reason: "invalid_selection_count" };
  }
  if (!Number.isInteger(systemK)) {
    return { ...base, valid: false, reason: "invalid_k" };
  }
  if (!SYSTEM_K_VALUES.includes(systemK)) {
    return { ...base, valid: false, reason: "unsupported_k", systemK };
  }

  return {
    ...base,
    valid: true,
    reason: null,
    systemK,
    combinationCount: combinations(SYSTEM_SELECTION_COUNT, systemK)
  };
}

/**
 * Build ONE System ticket, at the k the caller asked for.
 *
 * ORDER OF OPERATIONS — the same shape buildGlobalSpecialBets uses, with only
 * the ranking swapped:
 *
 *   collect (12 gates) -> rank by EV -> diversify -> select 5 (minus used)
 *
 * Diversification runs AFTER ranking here because that is where it runs for
 * combos today, and this increment reuses `diversifyGlobalCandidates` unchanged
 * rather than inventing a second rule. Feeding it an EV-ordered list keeps both
 * of its guarantees: one selection per fixture (the highest-EV one now, since
 * "first seen" follows the incoming order), and the league band still measured
 * in PROBABILITY percentage points. The band stays probability-based on
 * purpose — it is a safety constraint, not a value one, and its job is to stop
 * variety from dragging a materially weaker leg into the ticket whatever the
 * ranking rewards.
 *
 * ONE INVOCATION IS ONE TICKET. This function used to loop over SYSTEM_K_VALUES
 * and hand back {3: …, 4: …, 5: …}, so a single pool of five legs became three
 * stored tickets. That is not the product: 3/5, 4/5 and 5/5 are three shapes a
 * System ticket CAN take, not three tickets a punter placed. A 3/5 already pays
 * when four or five legs land — it covers those outcomes through its own C(5,3)
 * combinations — so writing a 4/5 and a 5/5 from the same five legs charges
 * three stakes for one opinion.
 *
 * `systemK` is therefore required, and validated before anything is built. It
 * is a product choice and this function refuses to make it: there is no default
 * k, and no rule that reads probability, confidence or odds to pick one.
 *
 * Fewer than five safe candidates means NO system ticket — no padding, no
 * relaxed gate, no duplicated fixture. The refusal carries the pool size and
 * the rejection counters, so the caller can say why the pool was thin. An
 * unsupported k refuses the same way rather than throwing: "3.5 is not a shape
 * we sell" is an ordinary answer to an ordinary question.
 *
 * `excludeFixtureIds` carries the fixtures the user's earlier tickets already
 * used — combos and systems alike, because the exclusion set is scoped to the
 * person and the day rather than to a product. It is passed IN rather than
 * discovered here for the same reason buildGlobalSpecialBets takes it: this
 * function is pure, and the caller owns the scope the exclusion belongs to.
 *
 * @param {{ rows: object[], leagueIds: number[], now: number, systemK: number,
 *           excludeFixtureIds?: Set<number>|number[] }} options
 */
export function buildGlobalSystemBets(options) {
  const systemK = options?.systemK;
  // The k is judged BEFORE the pool is collected: an unsupported shape is not
  // worth twelve gates of work, and a caller that omitted the argument should
  // hear about the argument rather than about a thin pool. The placeholder
  // array carries only the count — the real legs are validated again at
  // persistence, against the rows that will actually be written.
  const shape = validateSystemShape({
    selections: new Array(SYSTEM_SELECTION_COUNT).fill(null),
    systemK
  });
  if (!shape.valid) {
    const collected = collectGlobalCandidates(options);
    return {
      ...collected,
      pool: [],
      selections: [],
      systemK: null,
      bet: null,
      reusedFixtureIds: [],
      unavailable: [
        {
          betKind: "system",
          reason: shape.reason,
          requestedK: systemK === undefined ? null : systemK,
          supportedK: shape.supportedK
        }
      ]
    };
  }

  const collected = collectGlobalCandidates(options);
  const pool = diversifyGlobalCandidates(rankSystemCandidates(collected.candidates));

  if (pool.length < SYSTEM_SELECTION_COUNT) {
    return {
      ...collected,
      pool,
      selections: [],
      systemK,
      bet: null,
      reusedFixtureIds: [],
      unavailable: [
        {
          betKind: "system",
          reason: "insufficient_system_candidates",
          available: pool.length,
          required: SYSTEM_SELECTION_COUNT
        }
      ]
    };
  }

  /*
    ACROSS-TICKETS DEDUP, through the combo primitive rather than a second rule.

    `diversifyGlobalCandidates` above already guarantees one leg per fixture
    WITHIN this ticket. This adds the other invariant: a fixture the user's
    earlier tickets already used — combo OR system, the exclusion set does not
    distinguish — is not taken again while equally qualified fresh ones remain.

    selectVariantLegs is reused verbatim because a System needs nothing a combo
    does not. `validateSystemShape` asks only for five legs and a supported k,
    and `systemTicketProbability` is symmetric in its inputs, so no fixture is
    structurally required and the `variant - fresh.length` fallback is right
    here for the same reason it is right there.

    QUALITY IS NOT TRADED FOR VARIETY. `fresh` and `reused` are partitions of
    THIS pool, which has already passed all twelve gates and been ranked by EV.
    Nothing is promoted, no threshold moves, and a candidate that failed a gate
    cannot enter merely because it would have been novel.

    It cannot return null: the guard above already refused a pool below five,
    and selectVariantLegs only fails when the pool cannot fill the ticket.
  */
  const chosen = selectVariantLegs(pool, SYSTEM_SELECTION_COUNT, options?.excludeFixtureIds);
  const selections = chosen.selections;
  return {
    ...collected,
    pool,
    selections,
    systemK,
    bet: toSystemBet(systemK, selections),
    reusedFixtureIds: chosen.reusedFixtureIds,
    unavailable: []
  };
}

export default {
  MIN_SELECTION_ODD,
  PROB_FLOOR,
  MAX_MODEL_EDGE,
  LEAGUE_SPREAD_MAX_PP,
  GLOBAL_SPECIAL_BET_VARIANTS,
  SYSTEM_SELECTION_COUNT,
  SYSTEM_K_VALUES,
  collectGlobalCandidates,
  rankGlobalCandidates,
  diversifyGlobalCandidates,
  buildGlobalSpecialBets,
  selectVariantLegs,
  selectionExpectedValue,
  rankSystemCandidates,
  systemTicketProbability,
  validateSystemShape,
  buildGlobalSystemBets
};
