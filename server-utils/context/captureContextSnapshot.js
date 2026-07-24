/**
 * Assembles the context-capture snapshot persisted alongside each
 * prediction, so future backtests can replay real Context Engine inputs
 * instead of reconstructing them from the display payload. Pure/in-memory —
 * every field here is data moduleInputs.collectModuleInputs() already fetched
 * for the live prediction, plus referee stats computed from our own history;
 * no extra network calls happen here.
 */

export const CONTEXT_SNAPSHOT_SCHEMA_VERSION = "ctx-snapshot-v1";

/**
 * @param {object} p
 * @param {number|string} p.fixtureId
 * @param {number|string} p.leagueId
 * @param {string} [p.kickoff]
 * @param {string} [p.refereeName]
 * @param {string} p.modelVersion
 * @param {object} [p.moduleInputs] - output of collectModuleInputs()
 * @param {object|null} [p.refereeStats] - output of computeRefereeStatsFromHistory()
 */
export function buildContextSnapshot({
  fixtureId,
  leagueId,
  kickoff,
  refereeName,
  modelVersion,
  moduleInputs = {},
  refereeStats = null
}) {
  return {
    schemaVersion: CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    fixtureId,
    leagueId,
    kickoff: kickoff || null,
    modelVersion: modelVersion || null,
    refereeName: refereeName || null,
    injuries: moduleInputs?.injuries || null,
    homeLineup: moduleInputs?.homeLineup || null,
    awayLineup: moduleInputs?.awayLineup || null,
    homeRecentMatches: moduleInputs?.homeRecentMatches || null,
    awayRecentMatches: moduleInputs?.awayRecentMatches || null,
    homeLastMatchDate: moduleInputs?.homeLastMatchDate || null,
    awayLastMatchDate: moduleInputs?.awayLastMatchDate || null,
    weather: moduleInputs?.weather || null,
    refereeStats: refereeStats || null,
    capturedAt: new Date().toISOString()
  };
}

export default { CONTEXT_SNAPSHOT_SCHEMA_VERSION, buildContextSnapshot };
