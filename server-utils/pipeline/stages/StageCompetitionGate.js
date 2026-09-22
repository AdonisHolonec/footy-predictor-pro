/**
 * StageCompetitionGate — first per-fixture stage, runs BEFORE Stage02 data collection.
 *
 * Classifies the fixture's competition by stable provider league id and, when it is an
 * unsupported national-team competition, emits the existing insufficientData row with
 * reason UNSUPPORTED_NATIONAL_COMPETITION and aborts the fixture. No factor module,
 * λ, probability, recommendation or persistence code runs for that fixture; Stage10
 * already skips insufficient rows, so nothing reaches predictions_history or the
 * calibration / stacker training pools.
 *
 * Supported (club) competitions pass through with the context untouched.
 * Never calls other stages.
 */

import { resolveFixtureGate, buildGatedFixtureRow } from "../competitionGate.js";

export const STAGE_ID = "StageCompetitionGate";
export const STAGE_DESCRIPTION =
  "Competition eligibility: unsupported national-team competitions abort with insufficientData.";

export async function run(context) {
  if (context.halted || context.fixture?.aborted) return context;
  const f = context.fixture;
  const league = context.league;
  if (!f || !league) return context;

  const { gated, classification } = resolveFixtureGate(f.fx, league.lId);
  f.competition = classification;

  if (!context.stageMarks) context.stageMarks = {};
  if (!gated) {
    context.stageMarks[STAGE_ID] = { status: "ok", at: Date.now() };
    return context;
  }

  f.row = buildGatedFixtureRow(f, league, classification);
  f.aborted = true;
  context.stageMarks[STAGE_ID] = { status: "unsupported_national_competition", at: Date.now() };
  return context;
}

export default { STAGE_ID, STAGE_DESCRIPTION, run };
