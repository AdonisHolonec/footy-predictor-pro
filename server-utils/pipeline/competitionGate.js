/**
 * National-competition safety gate — row builders shared by the fixture stage and by
 * the DB-served Predict paths in Stage01.
 *
 * The gate is an eligibility decision, not a model: it never touches λ, probabilities,
 * calibration, fusion or recommendations. A gated fixture yields the SAME
 * insufficientData row shape Stage03 already emits, with an explicit reason, so
 * every downstream consumer (Stage10 skips insufficient rows, the UI renders the
 * insufficient card, settlement ignores rows without a pick) behaves as it already does.
 */

import {
  classifyCompetition,
  classifyFixtureCompetition,
  isGatedCompetition,
  NATIONAL_GATE_METHOD
} from "../competition/competitionCatalog.js";
import { buildInsufficientDataRow } from "./stages/fixtureStageShared.js";

/** The fields the gate row carries from a classification — nothing internal. */
function competitionSummary(classification) {
  return {
    entityType: classification.entityType,
    competitionType: classification.competitionType,
    supported: classification.supported,
    reason: classification.reason
  };
}

function gateOptions(classification) {
  return {
    reason: classification.reason,
    method: NATIONAL_GATE_METHOD,
    reasonCodes: [NATIONAL_GATE_METHOD],
    extra: { competition: competitionSummary(classification) }
  };
}

/**
 * Decide for a raw provider fixture inside the fixture loop.
 * @returns {{ gated: boolean, classification: object }}
 */
export function resolveFixtureGate(fx, fallbackLeagueId = null) {
  const classification = classifyFixtureCompetition(fx, fallbackLeagueId);
  return { gated: isGatedCompetition(classification), classification };
}

/** Decide for a league id alone (used to skip league-level warm loads). */
export function resolveLeagueGate(leagueId) {
  const classification = classifyCompetition({ leagueId });
  return { gated: isGatedCompetition(classification), classification };
}

/**
 * Insufficient row for a fixture the loop is about to process (Stage02 not yet run).
 * `f` is the PipelineContext fixture bag from beginFixture(); `league` is context.league.
 */
export function buildGatedFixtureRow(f, league, classification) {
  const fx = f.fx || {};
  return buildInsufficientDataRow(
    {
      id: f.fixtureId,
      leagueId: Number(league?.lId ?? fx.league?.id),
      league: fx.league?.name || "Unknown",
      logos: { league: fx.league?.logo, home: fx.teams?.home?.logo, away: fx.teams?.away?.logo },
      teams: { home: f.homeName, away: f.awayName },
      fixtureTeamIds:
        f.homeIdStr && f.awayIdStr
          ? { home: Number(f.homeIdStr) || undefined, away: Number(f.awayIdStr) || undefined }
          : undefined,
      kickoff: fx.fixture?.date,
      status: fx.fixture?.status?.short,
      score: {
        home: typeof fx.goals?.home === "number" ? fx.goals.home : null,
        away: typeof fx.goals?.away === "number" ? fx.goals.away : null
      },
      referee: f.refereeName || undefined,
      venue: f.venue || undefined
    },
    gateOptions(classification)
  );
}

/**
 * Rows already persisted before the gate existed (the DB-only and paid DB-cache paths
 * in Stage01 read predictions_history directly). A persisted row for a gated
 * competition is replaced by the same insufficient shape, so the gate cannot be
 * bypassed by a cache hit. Supported competitions come back untouched, same reference.
 *
 * @param {object} entry output of mapDbRowToHistoryEntry()
 */
export function gateHistoryEntry(entry) {
  const classification = classifyCompetition({ leagueId: entry?.leagueId });
  if (!isGatedCompetition(classification)) return entry;
  return buildInsufficientDataRow(
    {
      id: entry.id,
      leagueId: Number(entry.leagueId),
      league: entry.league || "Unknown",
      logos: entry.logos || {},
      teams: entry.teams || { home: "Home", away: "Away" },
      fixtureTeamIds: entry.fixtureTeamIds,
      kickoff: entry.kickoff,
      status: entry.status,
      score: entry.score || { home: null, away: null },
      referee: entry.referee || undefined,
      venue: entry.venue || undefined
    },
    gateOptions(classification)
  );
}

export default { resolveFixtureGate, resolveLeagueGate, buildGatedFixtureRow, gateHistoryEntry };
