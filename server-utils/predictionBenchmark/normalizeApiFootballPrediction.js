/**
 * Pure mapping: raw API-Football /predictions response[0] item → our internal
 * ApiFootballBenchmarkPrediction schema. No I/O, no upstream calls, no
 * dependency on PredictorV3 / server-utils/PredictionEngine / confidence /
 * value / pipeline modules — see docs/PREDICTION_BENCHMARK_RESEARCH.md for the
 * field-by-field mapping this implements (fields marked [VERIFY] there are
 * treated defensively here: every access is optional-chained, nothing throws
 * on a missing/renamed field).
 */

export const BENCHMARK_SCHEMA_VERSION = "afb-v1";

function parsePercent(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseComparisonSide(block, side) {
  if (!block || typeof block !== "object") return null;
  return parsePercent(block[side]);
}

function normalizeComparison(comparison) {
  const keys = ["form", "att", "def", "poisson_distribution", "h2h", "goals", "total"];
  const out = {};
  for (const key of keys) {
    out[key] = {
      home: parseComparisonSide(comparison?.[key], "home"),
      away: parseComparisonSide(comparison?.[key], "away")
    };
  }
  return out;
}

function normalizeLast5(team) {
  const last5 = team?.last_5;
  if (!last5 || typeof last5 !== "object") return null;
  return {
    form: last5.form ?? null,
    // att/def arrive as percentage strings ("38%"), never plain numbers, so the
    // previous Number() cast produced NaN and silently nulled both on every row.
    // Confirmed against a live /predictions response (fixture 1607560).
    att: parsePercent(last5.att),
    def: parsePercent(last5.def),
    goals: {
      for: {
        average: Number.isFinite(Number(last5.goals?.for?.average)) ? Number(last5.goals.for.average) : null,
        total: Number.isFinite(Number(last5.goals?.for?.total)) ? Number(last5.goals.for.total) : null
      },
      against: {
        average: Number.isFinite(Number(last5.goals?.against?.average)) ? Number(last5.goals.against.average) : null,
        total: Number.isFinite(Number(last5.goals?.against?.total)) ? Number(last5.goals.against.total) : null
      }
    }
  };
}

function normalizeH2h(h2h) {
  if (!Array.isArray(h2h)) return null;
  return h2h.map((item) => ({
    fixtureId: Number.isFinite(Number(item?.fixture?.id)) ? Number(item.fixture.id) : null,
    date: item?.fixture?.date || null,
    homeGoals: Number.isFinite(Number(item?.goals?.home)) ? Number(item.goals.home) : null,
    awayGoals: Number.isFinite(Number(item?.goals?.away)) ? Number(item.goals.away) : null
  }));
}

/**
 * @param {object|null|undefined} rawItem  response[0] from GET /predictions?fixture={id}
 * @param {number|string} fixtureId
 * @returns {object|null}  ApiFootballBenchmarkPrediction, or null when rawItem is empty/unusable
 */
export function normalizeApiFootballPrediction(rawItem, fixtureId) {
  if (!rawItem || typeof rawItem !== "object") return null;
  const id = Number(fixtureId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const predictions = rawItem.predictions || {};
  const comparison = rawItem.comparison || {};
  const teams = rawItem.teams || {};

  return {
    fixtureId: id,
    fetchedAt: new Date().toISOString(),
    schemaVersion: BENCHMARK_SCHEMA_VERSION,

    winner: {
      teamId: Number.isFinite(Number(predictions.winner?.id)) ? Number(predictions.winner.id) : null,
      teamName: predictions.winner?.name || null,
      comment: predictions.winner?.comment || null
    },
    winOrDraw: typeof predictions.win_or_draw === "boolean" ? predictions.win_or_draw : null,
    winPercent: {
      home: parsePercent(predictions.percent?.home),
      draw: parsePercent(predictions.percent?.draw),
      away: parsePercent(predictions.percent?.away)
    },
    advice: predictions.advice || null,
    goalsPrediction: {
      home: predictions.goals?.home ?? null,
      away: predictions.goals?.away ?? null
    },
    underOver: predictions.under_over ?? null,
    comparison: normalizeComparison(comparison),
    teamsForm: {
      home: normalizeLast5(teams.home),
      away: normalizeLast5(teams.away)
    },
    h2h: normalizeH2h(rawItem.h2h),
    raw: rawItem
  };
}

export default { normalizeApiFootballPrediction, BENCHMARK_SCHEMA_VERSION };
