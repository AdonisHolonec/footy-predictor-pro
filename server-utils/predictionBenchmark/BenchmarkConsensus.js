/**
 * BenchmarkConsensus — deterministic, pure comparison between our own
 * finalized recommendation (PredictorV3's Stage08 output, read-only) and a
 * normalized ApiFootballBenchmarkPrediction. No randomness, no I/O, no
 * dependency on server-utils/PredictionEngine / confidence / value / any
 * pipeline stage.
 *
 * Deliberately named distinctly from
 * server-utils/pipeline/modelFusion/resolveMarketConsensus.js (bookmaker-odds
 * consensus fed INTO PredictorV3's fusion stage) — this module compares two
 * already-finished, independent recommendations AFTER the fact.
 *
 * Our pick's family is classified with the existing tipMarketFamily() from
 * server-utils/backtest/TipEvent.js (server-side; the client-only
 * resolveMarketFamilyKey in src/utils/formatRecommendation.ts can't be
 * imported here without a build step) — not reinvented.
 */

import { tipMarketFamily } from "../backtest/TipEvent.js";

export const BENCHMARK_CONSENSUS_SCHEMA_VERSION = "benchmark-consensus-v1";

const OU_LINE_EPSILON = 1e-6;

function normalizeOurSide(pick) {
  const p = String(pick || "").trim().toLowerCase();
  if (!p) return null;
  if (["1", "x", "2", "1x", "12", "x2", "gg", "ngg"].includes(p)) return { side: p, line: null };
  const over = p.match(/^(?:peste|over)\s*(\d+(?:[.,]\d+)?)/);
  if (over) return { side: "over", line: Number(over[1].replace(",", ".")) };
  const under = p.match(/^(?:sub|under)\s*(\d+(?:[.,]\d+)?)/);
  if (under) return { side: "under", line: Number(under[1].replace(",", ".")) };
  return null;
}

/** API-Football's under_over is a signed line string, e.g. "+2.5" / "-2.5" — a
 * leading "+" is documented (see docs/PREDICTION_BENCHMARK_RESEARCH.md) as an
 * Over lean, "-" as an Under lean. [VERIFY] against a live response. */
function parseUnderOver(underOver) {
  if (!underOver) return null;
  const m = String(underOver).trim().match(/^([+-])?\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const line = Number(m[2]);
  if (!Number.isFinite(line)) return null;
  const side = m[1] === "-" ? "under" : "over";
  return { side, line };
}

const ADVICE_PATTERNS = [
  { family: "btts", side: "gg", re: /both teams to score|btts.*yes|gg\b/i },
  { family: "btts", side: "ngg", re: /btts.*no|no goal/i },
  { family: "1x2", side: "x", re: /\bdraw\b/i },
  { family: "dc", side: "1x", re: /double chance\s*:?\s*1x|1\s*or\s*x/i },
  { family: "dc", side: "x2", re: /double chance\s*:?\s*x2|x\s*or\s*2/i },
  { family: "dc", side: "12", re: /double chance\s*:?\s*12|1\s*or\s*2/i }
];

/** Best-effort, low-confidence secondary signal only — advice grammar is not
 * contractually stable (see research doc). Never used when a structural
 * signal for the same family is already available. */
function classifyFromAdvice(advice) {
  if (!advice) return null;
  for (const { family, side, re } of ADVICE_PATTERNS) {
    if (re.test(advice)) return { family, side, line: null, source: "advice" };
  }
  return null;
}

function classify1x2(apiPrediction, fixtureTeams) {
  const winnerId = apiPrediction?.winner?.teamId;
  const homeId = fixtureTeams?.homeTeamId;
  const awayId = fixtureTeams?.awayTeamId;
  if (winnerId != null && (winnerId === homeId || winnerId === awayId)) {
    const side = winnerId === homeId ? "1" : "2";
    const confidencePct = side === "1" ? apiPrediction?.winPercent?.home : apiPrediction?.winPercent?.away;
    return { family: "1x2", side, line: null, source: "winner", confidencePct: confidencePct ?? null };
  }
  const { home, draw, away } = apiPrediction?.winPercent || {};
  if (home != null || draw != null || away != null) {
    const entries = [
      ["1", home],
      ["x", draw],
      ["2", away]
    ].filter(([, v]) => Number.isFinite(v));
    if (entries.length) {
      const [side, pct] = entries.reduce((max, cur) => (cur[1] > max[1] ? cur : max));
      return { family: "1x2", side, line: null, source: "percent", confidencePct: pct };
    }
  }
  return null;
}

function classifyOu(apiPrediction) {
  const parsed = parseUnderOver(apiPrediction?.underOver);
  if (parsed) return { family: "ou", ...parsed, source: "under_over", confidencePct: null };
  return null;
}

/**
 * @param {object} apiPrediction  ApiFootballBenchmarkPrediction (from normalizeApiFootballPrediction)
 * @param {{ homeTeamId: number|null, awayTeamId: number|null }} fixtureTeams
 * @returns {Record<string, {family:string, side:string, line:number|null, source:string, confidencePct:number|null}>}
 */
function classifyApiPredictionByFamily(apiPrediction, fixtureTeams) {
  const out = {};
  const oneXTwo = classify1x2(apiPrediction, fixtureTeams);
  if (oneXTwo) out["1x2"] = oneXTwo;
  const ou = classifyOu(apiPrediction);
  if (ou) out.ou = ou;
  const fromAdvice = classifyFromAdvice(apiPrediction?.advice);
  if (fromAdvice && !out[fromAdvice.family]) {
    out[fromAdvice.family] = { ...fromAdvice, confidencePct: null };
  }
  return out;
}

/** Formats an inferred API-Football side/line into a pick string gradeable by
 * predictionsHistory.js#evaluateTopPick (e.g. "Over 2.5"), so the sweep
 * orchestrator can settle the API side the same way we settle our own pick. */
function formatGradeablePick(entry) {
  if (!entry) return null;
  if (entry.family === "ou" && entry.line != null) {
    return `${entry.side === "under" ? "Under" : "Over"} ${entry.line}`;
  }
  return entry.side;
}

function compareWithinFamily(family, ourSide, apiEntry) {
  if (!apiEntry || ourSide == null) return { agree: null, lineMismatch: false };
  if (family === "ou") {
    const sameLine = apiEntry.line != null && Math.abs(apiEntry.line - ourSide.line) < OU_LINE_EPSILON;
    if (!sameLine) return { agree: null, lineMismatch: true };
    return { agree: ourSide.side === apiEntry.side, lineMismatch: false };
  }
  return { agree: ourSide.side === apiEntry.side, lineMismatch: false };
}

/**
 * @param {{ pick: string, family?: string|null, confidence?: number|null }} ourRecommendation
 * @param {object} apiPrediction  ApiFootballBenchmarkPrediction, or null/undefined when unavailable
 * @param {{ homeTeamId: number|null, awayTeamId: number|null }} fixtureTeams
 * @returns {object} BenchmarkConsensusResult
 */
export function buildBenchmarkConsensus(ourRecommendation, apiPrediction, fixtureTeams = {}) {
  const ourFamily = tipMarketFamily(ourRecommendation?.pick);
  const ourSide = normalizeOurSide(ourRecommendation?.pick);
  const ourConfidence = Number.isFinite(Number(ourRecommendation?.confidence))
    ? Number(ourRecommendation.confidence)
    : null;

  const result = {
    fixtureId: apiPrediction?.fixtureId ?? null,
    computedAt: new Date().toISOString(),
    ourPick: { pick: ourRecommendation?.pick ?? null, family: ourFamily, confidence: ourConfidence },
    apiPick: { inferredPick: null, family: null, confidencePct: null, source: null },
    familyComparable: false,
    agree: null,
    confidenceDelta: null,
    recommendationDelta: { sameSide: null, ourSide: ourSide?.side ?? null, apiSide: null },
    perFamilyBreakdown: { "1x2": null, ou: null, btts: null, dc: null },
    schemaVersion: BENCHMARK_CONSENSUS_SCHEMA_VERSION
  };

  if (!apiPrediction) return result;

  const byFamily = classifyApiPredictionByFamily(apiPrediction, fixtureTeams);

  for (const family of Object.keys(result.perFamilyBreakdown)) {
    const entry = byFamily[family];
    if (!entry) continue;
    const isOurFamily = family === ourFamily;
    const comparison = isOurFamily ? compareWithinFamily(family, ourSide, entry) : { agree: null, lineMismatch: false };
    result.perFamilyBreakdown[family] = {
      agree: isOurFamily ? comparison.agree : null,
      ourSide: isOurFamily ? ourSide?.side ?? null : null,
      apiSide: entry.side,
      lineMismatch: comparison.lineMismatch
    };
  }

  const primary = byFamily[ourFamily] || null;
  if (primary) {
    result.apiPick = {
      inferredPick: formatGradeablePick(primary),
      family: primary.family,
      confidencePct: primary.confidencePct ?? null,
      source: primary.source
    };
    const comparison = compareWithinFamily(ourFamily, ourSide, primary);
    result.familyComparable = ourSide != null && !comparison.lineMismatch;
    result.agree = result.familyComparable ? comparison.agree : null;
    result.recommendationDelta = {
      sameSide: result.familyComparable ? comparison.agree : null,
      ourSide: ourSide?.side ?? null,
      apiSide: primary.side
    };
  }

  if (ourConfidence != null && result.apiPick.confidencePct != null) {
    result.confidenceDelta = Number((ourConfidence - result.apiPick.confidencePct).toFixed(2));
  }

  return result;
}

export default { buildBenchmarkConsensus };
