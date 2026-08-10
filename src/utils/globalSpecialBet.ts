import type { PredictionRow } from "../types";
import { resolveMarketFamilyKey, type MarketFamilyKey } from "./formatRecommendation";
import { parseOuSide } from "./marketPicks";

/**
 * Global Special Bet — candidate pool, ranking and diversification.
 *
 * Distinct product from the per-match "Special Bet · Top signals"
 * (`specialBet.ts`), which stays exactly as it is: that one combines markets
 * WITHIN one fixture, this one combines the best selections ACROSS the fixtures
 * of a user's favourite leagues.
 *
 * Pure and deterministic by construction — no clock, no I/O, no React. `now` is
 * an argument so the same inputs always produce the same bet, which is what
 * makes an immutable snapshot meaningful.
 *
 * One pool feeds every variant: 3, 5 and 8 are slices of the SAME ranked and
 * diversified list, never three separate algorithms.
 */

/** A selection must be worth including at all — below this it is not a bet, it is a formality. */
export const MIN_SELECTION_ODD = 1.25;

export const GLOBAL_SPECIAL_BET_VARIANTS = [3, 5, 8] as const;
export type GlobalSpecialBetVariant = (typeof GLOBAL_SPECIAL_BET_VARIANTS)[number];

/**
 * How much ranking strength league spread is allowed to cost.
 *
 * A candidate from a not-yet-used league is preferred only while it scores at
 * least this fraction of the best remaining candidate. Spread is a preference,
 * never a reason to carry a weak selection, and never a reason to fail to build
 * a bet — a policy knob, deliberately not part of the score itself.
 */
export const LEAGUE_SPREAD_TOLERANCE = 0.85;

export type GlobalCandidate = {
  fixtureId: number;
  leagueId: number;
  kickoff: string;
  /** Home vs Away, for display and for making a snapshot readable later. */
  fixtureLabel: string;
  market: MarketFamilyKey;
  /** Human selection exactly as it will be settled, e.g. "Over 7.5". */
  selection: string;
  side: "over" | "under" | null;
  line: number | null;
  odds: number;
  confidence: number;
  valueScore: number;
  dataQuality: number;
  /** valueScore × dataQuality — see rankGlobalCandidates. */
  score: number;
};

/** Why a market never made it into the pool. Counted, never silently dropped. */
export type CandidateRejectionReason =
  | "leagueNotSelected"
  | "alreadyStarted"
  | "insufficientData"
  | "notRecommendable"
  | "oddBelowMinimum"
  | "missingData";

export type CandidateRejections = Record<CandidateRejectionReason, number>;

export type CollectCandidatesResult = {
  candidates: GlobalCandidate[];
  /** Markets examined across every row — the denominator for the rejection counts. */
  examined: number;
  rejected: CandidateRejections;
};

function emptyRejections(): CandidateRejections {
  return {
    leagueNotSelected: 0,
    alreadyStarted: 0,
    insufficientData: 0,
    notRecommendable: 0,
    oddBelowMinimum: 0,
    missingData: 0
  };
}

/**
 * Missing means missing. `Number(null)` is 0 and `Number("")` is 0, so a plain
 * Number()/isFinite() check silently turns an absent odd or value score into a
 * real-looking zero — which is precisely the "missing data as fallback" this
 * product must never do.
 */
function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The selection label a market settles under. Built from the market's own
 * side/line rather than re-parsed from prose, so the snapshot carries the same
 * shape the settlement layer compares against.
 */
function buildSelectionLabel(
  type: string,
  side: "over" | "under" | null,
  line: number | null
): string {
  if (side && line != null) return `${side === "over" ? "Over" : "Under"} ${line.toFixed(1)}`;
  return String(type || "").trim();
}

export type CollectCandidatesOptions = {
  rows: PredictionRow[];
  /** The user's favourite leagues. An empty list yields an empty pool — never "all". */
  leagueIds: number[];
  /** Reference instant; only fixtures kicking off after it can be bet on. */
  now: number;
};

/**
 * Every eligible selection across the given fixtures, with hard filters applied
 * and every rejection counted.
 *
 * Nothing is invented and nothing falls back: a market missing odds, confidence,
 * value score or data quality is rejected, not defaulted. A high-confidence
 * market that fails the odds floor is rejected too — confidence never buys an
 * exemption.
 */
export function collectGlobalCandidates({
  rows,
  leagueIds,
  now
}: CollectCandidatesOptions): CollectCandidatesResult {
  const allowedLeagues = new Set(leagueIds.map((id) => Number(id)));
  const rejected = emptyRejections();
  const candidates: GlobalCandidate[] = [];
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
      const side = parseOuSide(String(market?.type || ""));
      const selection = buildSelectionLabel(String(market?.type || ""), side, line);

      // Missing inputs are disqualifying, not defaultable. Confidence and data
      // quality come from the row, odds and value score from the market.
      if (
        confidence == null ||
        dataQuality == null ||
        odds == null ||
        valueScore == null ||
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

      candidates.push({
        fixtureId,
        leagueId,
        kickoff: String(row.kickoff),
        fixtureLabel: `${row.teams?.home ?? "?"} – ${row.teams?.away ?? "?"}`,
        market: resolveMarketFamilyKey(market?.type, market?.family),
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
 * `valueScore` is NOT invented here: `server-utils/value/ValueEngine.js`
 * already blends expected value, edge, Kelly and confidence through configurable
 * weights, and penalises non-positive EV. Re-deriving a second formula would
 * mean maintaining two opinions about the same thing, so this multiplies that
 * existing score by the one dimension it does not contain — how much the model
 * trusts the data behind the fixture (`modelMeta.dataQuality`, 0..1).
 *
 * Ties break by odds, then confidence, then fixtureId, so ordering is total and
 * reproducible rather than dependent on input order.
 */
export function rankGlobalCandidates(candidates: GlobalCandidate[]): GlobalCandidate[] {
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
 */
export function diversifyGlobalCandidates(ranked: GlobalCandidate[]): GlobalCandidate[] {
  const bestPerFixture = new Map<number, GlobalCandidate>();
  for (const candidate of ranked) {
    if (!bestPerFixture.has(candidate.fixtureId)) bestPerFixture.set(candidate.fixtureId, candidate);
  }

  const remaining = [...bestPerFixture.values()];
  const usedLeagues = new Set<number>();
  const ordered: GlobalCandidate[] = [];

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

export type GlobalSpecialBet = {
  variant: GlobalSpecialBetVariant;
  selections: GlobalCandidate[];
  totalOdds: number;
  averageConfidence: number;
};

export type GlobalSpecialBetBuild = {
  /** Built variants, keyed by size. A variant with too few candidates is absent. */
  bets: Partial<Record<GlobalSpecialBetVariant, GlobalSpecialBet>>;
  /** Variants that could not be built, with how many selections were available. */
  unavailable: Array<{ variant: GlobalSpecialBetVariant; available: number; required: number }>;
  /** The diversified pool every variant was sliced from. */
  pool: GlobalCandidate[];
};

function toBet(variant: GlobalSpecialBetVariant, selections: GlobalCandidate[]): GlobalSpecialBet {
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
 * worse product than no 8-fold, and the user asked for it to stay absent.
 */
export function buildGlobalSpecialBets(
  options: CollectCandidatesOptions,
  variants: readonly GlobalSpecialBetVariant[] = GLOBAL_SPECIAL_BET_VARIANTS
): GlobalSpecialBetBuild & CollectCandidatesResult {
  const collected = collectGlobalCandidates(options);
  const pool = diversifyGlobalCandidates(rankGlobalCandidates(collected.candidates));

  const bets: Partial<Record<GlobalSpecialBetVariant, GlobalSpecialBet>> = {};
  const unavailable: GlobalSpecialBetBuild["unavailable"] = [];

  for (const variant of variants) {
    if (pool.length >= variant) {
      bets[variant] = toBet(variant, pool.slice(0, variant));
    } else {
      unavailable.push({ variant, available: pool.length, required: variant });
    }
  }

  return { ...collected, pool, bets, unavailable };
}
