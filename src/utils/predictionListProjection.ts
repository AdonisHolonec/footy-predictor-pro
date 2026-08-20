import type { PredictionRow } from "../types";

/**
 * What a prediction row needs to be when it is PERSISTED, as opposed to when it
 * is held in memory.
 *
 * The dashboard stores every prediction it receives into localStorage verbatim.
 * Measured on real production rows: 244,969 B each, of which valueEngine is
 * 85.3% and `valueEngine.markets` alone is 44.8%. One Predict at limit=50 is
 * ~11.7 MB against a per-origin localStorage budget of roughly 5 MB, and
 * `useLocalStorageState` discards the resulting write error, so the key silently
 * freezes at whatever last fit.
 *
 * That is not a hypothesis. Observed in a real browser: `footy.user.predictionMap`
 * listed 23 fixture ids for the signed-in user while `footy.user.predictionsByUser`
 * held 4 rows — and those 4 were exactly indices 0..3 of the map's insertion
 * order. Both keys are written from the same two call sites with the same data;
 * the small one kept accepting writes and the large one stopped.
 *
 * THIS IS A STORAGE PROJECTION, NOT A STATE PROJECTION. It is applied when the
 * value is serialised, so the in-memory object keeps every field. The match
 * modal, SpecialBetSection and specialBet.ts all read the live `preds` array and
 * are unaffected within a session; only what survives a reload is narrowed, and
 * the full document comes back from hydration or the by-fixture detail route.
 *
 * Applied to 184 real rows: 244,969 -> 12,955 B/row, a 94.7% reduction, which
 * puts a 50-fixture Predict at ~0.62 MB.
 */

/**
 * Every field a restored row must still be able to answer for.
 *
 * Traced, not guessed:
 *   MatchCard              teams, logos, league, kickoff, status, score,
 *                          recommended, probs, confidenceEngine, explanation,
 *                          featureImportance, teamContext, valueBet, valueEngine
 *   HomeSection/Matches    id, cardMarketValidations
 *   useDerivedPredictions  kickoff, status, recommended, valueBet, valueEngine,
 *                          insufficientData, predictions.marketTiers
 *   deriveNotifications    id, kickoff, league, teams, probs, savedAt,
 *                          validation, valueBet, momentum
 *   specialBet.ts          recommended, marketOdds, probs, predictions.cards,
 *                          status, score, confidenceEngine.liveAdjustment,
 *                          cardMarketValidations, marketResults, valueEngine.markets
 *   helpers.ts             insufficientData, modelVersion, probs, recommended,
 *                          predictions
 *
 * `probs` and `modelVersion` are load-bearing beyond rendering: hasLegacyPredictionShape
 * reads probs.corners / probs.shotsOnTarget for paid tiers and modelVersion for free.
 * Dropping either would make every restored row look stale and re-arm the rehydrate
 * that produced it.
 */
export const PREDICTION_STORAGE_FIELDS = Object.freeze([
  "id",
  "leagueId",
  "league",
  "teams",
  "logos",
  "kickoff",
  "status",
  "score",
  "validation",
  "savedAt",
  "modelVersion",
  "insufficientData",
  "insufficientReason",
  "recommended",
  "probs",
  "predictions",
  "cardMarkets",
  "cardMarketValidations",
  "marketResults",
  "marketOdds",
  "confidenceEngine",
  "explanation",
  "featureImportance",
  "teamContext",
  "momentum",
  "valueBet",
  "referee"
] as const);

/**
 * The valueEngine fields anything actually reads. `markets` is handled
 * separately — see below.
 */
export const VALUE_ENGINE_STORAGE_FIELDS = Object.freeze([
  "expectedValue",
  "edge",
  "signal",
  "detected",
  "recommendable",
  "negativeEV",
  "positiveEV",
  "kellyPct",
  "valueScore",
  "type",
  "family",
  "bestMarket",
  "positiveEvCount",
  "negativeEvCount",
  "familiesSupported",
  "familiesPresent",
  "rule",
  "highlighted",
  "explanation"
] as const);

/** specialBet.ts finds its cards quote by this shape, and takes only the first match. */
const CARD_MARKET = /card|booking|cartona/i;

type LooseRow = Record<string, unknown>;

function projectValueEngine(engine: LooseRow): LooseRow {
  const out: LooseRow = {};
  for (const field of VALUE_ENGINE_STORAGE_FIELDS) {
    if (field in engine) out[field] = engine[field];
  }
  /*
    specialBet.ts reads valueEngine.markets in exactly one place and keeps the
    FIRST market whose type/family looks like cards. Storing that one object
    instead of the whole evaluated set is the single biggest saving here:
    ~108 KB of markets per row collapses to well under a kilobyte, and the cards
    leg on the card still renders from storage.
  */
  const markets = engine.markets;
  if (Array.isArray(markets)) {
    const cards = markets.find((m) => {
      const entry = m as LooseRow | null;
      return CARD_MARKET.test(`${entry?.type ?? ""} ${entry?.family ?? ""}`);
    });
    if (cards) out.markets = [cards];
  }
  return out;
}

/**
 * A copy of `row` carrying only what a restored session needs.
 *
 * Never mutates: the same object is live in `preds` and in React state, and
 * deleting keys in place would strip the running UI rather than the stored copy.
 *
 * @param row A full prediction row.
 * @returns The narrowed row destined for localStorage.
 */
export function projectPredictionForStorage(row: PredictionRow): PredictionRow {
  if (!row || typeof row !== "object") return row;
  const source = row as unknown as LooseRow;
  const out: LooseRow = {};
  for (const field of PREDICTION_STORAGE_FIELDS) {
    if (field in source) out[field] = source[field];
  }
  const engine = source.valueEngine;
  if (engine && typeof engine === "object" && !Array.isArray(engine)) {
    out.valueEngine = projectValueEngine(engine as LooseRow);
  }
  return out as unknown as PredictionRow;
}

/** Serializer for `footy.lastPreds` — a bare array of rows. */
export function projectPredictionRowsForStorage(rows: PredictionRow[]): PredictionRow[] {
  return Array.isArray(rows) ? rows.map(projectPredictionForStorage) : rows;
}

/** Serializer for `footy.user.predictionsByUser` — rows keyed by user id. */
export function projectPredictionsByUserForStorage(
  byUser: Record<string, PredictionRow[]>
): Record<string, PredictionRow[]> {
  if (!byUser || typeof byUser !== "object") return byUser;
  const out: Record<string, PredictionRow[]> = {};
  for (const [userId, rows] of Object.entries(byUser)) {
    out[userId] = projectPredictionRowsForStorage(rows);
  }
  return out;
}
