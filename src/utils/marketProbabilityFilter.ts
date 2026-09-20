import type { PredictionRow } from "../types";
import type { MarketFamilyKey } from "./formatRecommendation";
import { goalsOddForLine, matchingMarketOdd } from "./marketPicks";

/**
 * Market probability filter — rank the match list by ONE market's chance.
 *
 * This reads probabilities the model already produced. It computes nothing: no
 * complement, no blend, no re-pricing. Each market maps to exactly one field of
 * `row.probs`, and a row that does not carry that field is LEFT OUT rather than
 * ranked at zero — "the model gave this 0%" and "the model said nothing" are
 * different facts, and only the first one belongs in a ranking.
 *
 * THE METRIC IS THE MARKET'S PROBABILITY, and three lookalikes are not it:
 *  - `recommended.confidence` is confidence in the RECOMMENDED pick, whatever
 *    market that is (it is what the "Top picks" segment sorts by);
 *  - `predictions.marketTiers.gg.prob` is the probability of the WINNING side,
 *    `max(p, 100 - p)`, so it would float "confidently NGG" to the top of GG;
 *  - `valueBet.ev` / `valueEngine.*` are value, not chance.
 */

export const MARKET_FILTERS = ["all", "gg", "o15ft", "o25ft", "o15fh"] as const;
export type MarketFilter = (typeof MARKET_FILTERS)[number];
/** A real market — everything except the "all" passthrough. */
export type MarketKey = Exclude<MarketFilter, "all">;

export function isMarketKey(value: MarketFilter): value is MarketKey {
  return value !== "all";
}

/**
 * Where each market's probability lives.
 *
 * `o15ft` and `o15fh` read a field with the SAME NAME (`pO15`) from two
 * different containers — full time on `probs`, first half on `probs.firstHalf`.
 * The container is the only thing telling them apart, so it is spelled out here
 * and nowhere else.
 */
const READERS: Record<MarketKey, (row: PredictionRow) => unknown> = {
  gg: (row) => row.probs?.pGG,
  o15ft: (row) => row.probs?.pO15,
  o25ft: (row) => row.probs?.pO25,
  o15fh: (row) => row.probs?.firstHalf?.pO15
};

/** The icon family each market reads as, so the row keeps its existing vocabulary. */
export const MARKET_FAMILY: Record<MarketKey, MarketFamilyKey> = {
  gg: "BTTS",
  o15ft: "GOALS",
  o25ft: "GOALS",
  o15fh: "GOALS"
};

/**
 * Normalise one stored value to a percentage in [0, 100], or null.
 *
 * THE SCALE IS NOT GUESSED. Every producer writes percentage points
 * (`clamp(x * 100, 0, 100)` in server-utils/math.js) and every other reader in
 * this app assumes them (`100 - p`, `p >= 50`). A "looks like a fraction, so
 * multiply by 100" heuristic would be wrong in the one place it fires: 0.7 is a
 * perfectly ordinary first-half Over 1.5, and it means 0.7%, not 70%. So a value
 * is taken as the percentage it says it is, and anything outside [0, 100] is
 * treated as corrupt and dropped rather than rescaled into plausibility.
 *
 * Null, undefined, "", booleans and objects are MISSING, never zero —
 * `Number(null)` is 0, which is exactly the bug this guards against. A real 0
 * and a real 100 are valid and kept.
 */
export function toPercent(value: unknown): number | null {
  let n: unknown = value;
  if (typeof n === "string") {
    if (n.trim() === "") return null;
    n = Number(n);
  }
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

/** The selected market's probability for this row, in percent, or null when absent. */
export function marketProbability(row: PredictionRow | null | undefined, market: MarketKey): number | null {
  if (!row) return null;
  return toPercent(READERS[market](row));
}

/**
 * The bookmaker price for the SAME side the probability describes, or null.
 *
 * Shown beside the probability because the row's usual odd belongs to the
 * recommended pick — leaving it next to "GG 92%" would price a different bet.
 * Only the existing quote helpers are used, and only for the exact side: a GG
 * price is never inferred from an NGG quote, nor an Over from an Under.
 */
export function marketOdd(row: PredictionRow, market: MarketKey): number | null {
  if (market === "o15ft") return goalsOddForLine(row, 1.5, "over");
  if (market === "o25ft") return goalsOddForLine(row, 2.5, "over");
  if (market === "o15fh") return matchingMarketOdd(row.marketOdds?.firstHalfGoals, "over", 1.5);
  const quote = row.marketOdds?.btts;
  if (!quote || quote.tradable === false) return null;
  // `odd` prices the quote's own `pick`, which can be NGG.
  if (String(quote.pick || "").trim().toLowerCase() !== "gg") return null;
  const odd = Number(quote.odd);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

function kickoffMs(row: PredictionRow): number {
  const ms = new Date(row.kickoff).getTime();
  // An unparseable kickoff sorts last instead of poisoning the comparison with NaN.
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/**
 * Rows that carry the market, highest probability first.
 *
 * "all" returns the SAME array it was given — not a copy — so the unfiltered
 * list keeps its order and its identity, and nothing downstream re-renders.
 *
 * Ties are broken by kickoff (earliest first) and then fixture id, so the order
 * is a pure function of the data: no dependence on input order, engine sort
 * stability, or anything random. A fixture that appears twice is ranked once —
 * its first occurrence — because two rows with one id would also collide as
 * React keys.
 *
 * Each probability is read once, up front; the comparator only compares numbers.
 */
export function rankByMarketProbability(rows: PredictionRow[], market: MarketFilter): PredictionRow[] {
  if (!isMarketKey(market)) return rows;
  const seen = new Set<number>();
  const ranked: { row: PredictionRow; probability: number; kickoff: number; id: number }[] = [];
  for (const row of rows) {
    const probability = marketProbability(row, market);
    if (probability === null) continue;
    const id = Number(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    ranked.push({ row, probability, kickoff: kickoffMs(row), id });
  }
  ranked.sort((a, b) => b.probability - a.probability || a.kickoff - b.kickoff || a.id - b.id);
  return ranked.map((entry) => entry.row);
}
