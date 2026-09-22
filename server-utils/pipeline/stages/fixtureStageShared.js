/**
 * Shared helpers for per-fixture stages (no Stage*.js imports).
 */
import { buildValueEngine } from "../../value/ValueEngine.js";
import { buildConfidenceEngine } from "../../confidence/ConfidenceEngine.js";
import { MODEL_VERSION } from "../../modelConstants.js";
import { beginFixture } from "../PipelineContext.js";

/**
 * Extract venue from API-Football fixture payload for weather / display.
 * API-Football rarely includes lat/lon on fixtures — city (+ league country) is the usual path.
 * @param {object} fx
 * @returns {{ name?: string, city?: string, country?: string, lat?: number, lon?: number } | undefined}
 */
export function extractVenueFromFixture(fx) {
  const v = fx?.fixture?.venue || fx?.venue;
  if (!v || typeof v !== "object") return undefined;
  const name = typeof v.name === "string" && v.name.trim() ? v.name.trim() : undefined;
  const city = typeof v.city === "string" && v.city.trim() ? v.city.trim() : undefined;
  const countryRaw = fx?.league?.country || fx?.country;
  const country =
    typeof countryRaw === "string" && countryRaw.trim() && countryRaw.trim().toLowerCase() !== "world"
      ? countryRaw.trim()
      : undefined;
  const latRaw = v.lat ?? v.latitude;
  const lonRaw = v.lon ?? v.longitude ?? v.lng;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  const out = {};
  if (name) out.name = name;
  if (city) out.city = city;
  if (country) out.country = country;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    out.lat = lat;
    out.lon = lon;
  }
  return Object.keys(out).length ? out : undefined;
}

export function initFixtureWorkingState(f) {
  Object.assign(f, {
    method: "none",
    lambdaHome: undefined,
    lambdaAway: undefined,
    luckStats: null,
    strengthMeta: null,
    modularScores: null,
    contextEngine: null,
    contextSnapshot: null,
    xgLambdasForSources: null,
    formHomeStr: null,
    formAwayStr: null,
    confidenceCtx: null,
    engineCtx: null,
    hStats: null,
    aStats: null,
    hMulti: null,
    aMulti: null,
    fhFractionsHome: null,
    fhFractionsAway: null,
    calc: null,
    p: null,
    pRaw: null,
    monteCarlo: null,
    cornersBlock: null,
    shotsOnTargetBlock: null,
    shotsTotalBlock: null,
    cardsBlock: null,
    debugMeta: null,
    rollingHome: null,
    rollingAway: null,
    liveRollingApplied: false,
    xgModelMeta: null,
    firstHalfProbs: null,
    firstHalfMeta: null,
    valueDetected: false,
    valueType: "",
    finalEv: 0,
    finalKelly: 0,
    stakingCompact: "",
    stakingBreakdown: undefined,
    reasonCodes: [],
    valueEngine: null,
    silentSkip: false,
    row: null,
    aborted: false
  });
  return f;
}

/**
 * The one insufficientData row shape every abort path emits (fixture processing
 * error, no team/standings data, unsupported national competition). Keeping it in
 * one place means the UI, Stage10 (which skips insufficient rows) and settlement
 * see identical structure regardless of which gate produced the row.
 *
 * @param {object} identity fixture identity fields (id, leagueId, league, logos, teams,
 *   fixtureTeamIds, kickoff, status, score, referee, venue)
 * @param {{ reason: string, method: string, reasonCodes?: string[], extra?: object }} opts
 *   `extra` is spread onto the row for context only some gates carry
 *   (teamContext, leagueStandings, competition).
 */
export function buildInsufficientDataRow(identity, { reason, method, reasonCodes = [method], extra = {} }) {
  return {
    ...identity,
    insufficientData: true,
    insufficientReason: reason,
    ...extra,
    probs: {
      p1: 0, pX: 0, p2: 0, pGG: 0, pO25: 0, pU35: 0, pO15: 0,
      pDC1X: 0, pDC12: 0, pDCX2: 0, pU15: 0, pNGG: 0, pU25: 0
    },
    recommended: { pick: "", confidence: 0 },
    predictions: { oneXtwo: "", gg: "", over25: "", correctScore: "" },
    valueBet: { detected: false, type: "", ev: 0, kelly: 0, stakePlan: "", reasons: [...reasonCodes] },
    valueEngine: buildValueEngine([]),
    confidenceEngine: buildConfidenceEngine({ refereeName: identity.referee || undefined }),
    modelMeta: {
      method,
      dataQuality: 0,
      modelVersion: MODEL_VERSION,
      reasonCodes: [...reasonCodes]
    },
    modelVersion: MODEL_VERSION,
    evaluation: { track: "none" }
  };
}

export function buildFixtureErrorRow(f, league) {
  return buildInsufficientDataRow({
    id: f.fixtureId,
    leagueId: Number(league.lId),
    league: f.fx.league?.name || "Unknown",
    logos: { league: f.fx.league?.logo, home: f.fx.teams?.home?.logo, away: f.fx.teams?.away?.logo },
    teams: { home: f.homeName, away: f.awayName },
    fixtureTeamIds:
      f.homeIdStr && f.awayIdStr
        ? { home: Number(f.homeIdStr) || undefined, away: Number(f.awayIdStr) || undefined }
        : undefined,
    kickoff: f.fx.fixture?.date,
    status: f.fx.fixture?.status?.short,
    score: {
      home: typeof f.fx.goals?.home === "number" ? f.fx.goals.home : null,
      away: typeof f.fx.goals?.away === "number" ? f.fx.goals.away : null
    },
    referee: f.refereeName || undefined,
    venue: f.venue || undefined
  }, { reason: "fixture_processing_error", method: "fixture_processing_error" });
}

export { beginFixture };
