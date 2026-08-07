/**
 * Provider adapter: PredictorV3's own published recommendation -> normalized selections.
 *
 * READ-ONLY. Reads an already-persisted predictions_history row. Does NOT import
 * PredictorV3 / server-utils/PredictionEngine / pipeline / confidence / value, and never
 * re-runs or re-grades a prediction — `validation` is the single settlement authority
 * (it routes through resolveRecommendedValidation() and so already handles the
 * card/corner markets that evaluateTopPick() alone cannot grade).
 */

import { PROVIDER_KEYS } from "../metaLearningConfig.js";
import { resolveMarketFamily, resolveLine } from "../marketFamily.js";

function toNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const SIDE_TO_ODDS_COLUMN = { "1": "odds_home", x: "odds_draw", "2": "odds_away" };
const SIDE_TO_CLOSING_COLUMN = {
  "1": "closing_odds_home",
  x: "closing_odds_draw",
  "2": "closing_odds_away"
};

/**
 * Our own price for our own pick. Prefer the quote the recommendation actually carried
 * (`own_quote`); fall back to the recorded 1X2 column for the selected side, and to the
 * ValueEngine quote when the market lines up. Anything else is honestly `unpriced` — a
 * missing price must never become a zero, because a zero silently becomes a -1u loss in
 * every ROI aggregate.
 */
export function resolveOwnPrice(row) {
  const payload = row?.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};

  const recommended = toNumber(payload.recommended?.odd);
  if (recommended != null && recommended > 1) {
    return { pricedOdd: recommended, pricedFrom: "own_quote" };
  }

  const key = String(row?.recommended_pick || "").trim().toLowerCase();
  const column = SIDE_TO_ODDS_COLUMN[key];
  if (column) {
    const fromColumn = toNumber(row[column]);
    if (fromColumn != null && fromColumn > 1) {
      return { pricedOdd: fromColumn, pricedFrom: "our_recorded_1x2" };
    }
  }

  const valueQuote = toNumber(payload.valueEngine?.bestMarket?.odds ?? payload.valueBet?.odds);
  const valueType = String(payload.valueBet?.type || payload.valueEngine?.bestMarket?.type || "")
    .trim()
    .toLowerCase();
  if (valueQuote != null && valueQuote > 1 && valueType && valueType === key) {
    return { pricedOdd: valueQuote, pricedFrom: "our_value_quote" };
  }

  return { pricedOdd: null, pricedFrom: "unpriced" };
}

function resolveClosing(row, pricedOdd) {
  const key = String(row?.recommended_pick || "").trim().toLowerCase();
  const column = SIDE_TO_CLOSING_COLUMN[key];
  if (!column) return { closingOdd: null, clvPct: null };
  const closingOdd = toNumber(row[column]);
  if (closingOdd == null || closingOdd <= 1 || pricedOdd == null || pricedOdd <= 1) {
    return { closingOdd, clvPct: null };
  }
  return { closingOdd, clvPct: Number(((pricedOdd / closingOdd - 1) * 100).toFixed(4)) };
}

/**
 * @param {object} row predictions_history row
 * @param {{ modelVersion: string }} opts
 * @returns {object[]} normalized selection descriptors (provider-agnostic shape)
 */
export function extractSelections(row, opts = {}) {
  if (!row) return [];
  const fixtureId = toNumber(row.fixture_id);
  const pick = row.recommended_pick;
  if (fixtureId == null || fixtureId <= 0 || !pick) return [];

  const declaredFamily = row.raw_payload?.recommended?.family ?? null;
  const family = resolveMarketFamily(pick, declaredFamily);
  const { pricedOdd, pricedFrom } = resolveOwnPrice(row);
  const { closingOdd, clvPct } = resolveClosing(row, pricedOdd);

  const result =
    row.validation === "win" ? "win" : row.validation === "loss" ? "loss" : "pending";
  const pnlUnits =
    result === "win" && pricedOdd != null ? Number((pricedOdd - 1).toFixed(6)) : result === "loss" ? -1 : null;

  return [
    {
      providerKey: PROVIDER_KEYS.predictorV3,
      fixtureId,
      modelVersion: String(opts.modelVersion || row.model_version || ""),
      marketFamily: family,
      selection: String(pick),
      line: resolveLine(pick),
      isPrimary: true,
      statedConfidence: toNumber(row.recommended_confidence),
      signalSource: "stage08",
      signalQuality: 1,
      pricedOdd,
      pricedFrom,
      closingOdd,
      clvPct,
      result,
      pnlUnits,
      kickoffAt: row.kickoff_at || null,
      settledAt: result === "pending" ? null : row.updated_at || null,
      sourceRow: { table: "predictions_history", validation: row.validation ?? null }
    }
  ];
}

export default { extractSelections, resolveOwnPrice };
