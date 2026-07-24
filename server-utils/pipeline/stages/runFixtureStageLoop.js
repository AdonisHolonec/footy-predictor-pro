/**
 * League × fixture loop driver — calls Stage02…09 per fixture.
 * Not a stage; owned by PredictorV3 orchestrator.
 */

import { getLeagueParams, getLeagueProfile } from "../../modelConstants.js";
import { loadTeamMarketRolling } from "../../teamMarketRolling.js";
import { loadLeagueElo } from "../../teamElo.js";
import { logError } from "../../observability/logger.js";
import {
  resolveLeagueSeasonFromFixtures,
  loadStandingsMapWithSeasonFallback,
  buildLeagueStandingsTable,
  isUefaClubCompetition
} from "../predictHelpers.js";
import { beginFixture, resetFixture } from "../PipelineContext.js";
import {
  initFixtureWorkingState,
  buildFixtureErrorRow,
  extractVenueFromFixture
} from "./fixtureStageShared.js";
import * as Stage02FeatureCollection from "./Stage02FeatureCollection.js";
import * as Stage03LambdaGeneration from "./Stage03LambdaGeneration.js";
import * as Stage04ProbabilityGeneration from "./Stage04ProbabilityGeneration.js";
import * as Stage05Simulation from "./Stage05Simulation.js";
import * as Stage06Calibration from "./Stage06Calibration.js";
import * as Stage07ModelFusion from "./Stage07ModelFusion.js";
import * as Stage08Decision from "./Stage08Decision.js";
import * as Stage09Explainability from "./Stage09Explainability.js";

export const FIXTURE_STAGES = [
  Stage02FeatureCollection,
  Stage03LambdaGeneration,
  Stage04ProbabilityGeneration,
  Stage05Simulation,
  Stage06Calibration,
  Stage07ModelFusion,
  Stage08Decision,
  Stage09Explainability
];

/**
 * @param {object} context
 */
export async function runFixtureStageLoop(context) {
  if (context.halted) return context;

  const leagueIds = context.leagueIds;
  const season = context.season;
  const effectiveLimit = context.effectiveLimit;
  const allFixtures = context.allFixtures || [];
  const out = context.out || (context.out = []);
  const contextSnapshots = context.contextSnapshots || (context.contextSnapshots = []);

  for (const lId of leagueIds) {
    if (out.length >= effectiveLimit) break;
    const leagueFixtures = allFixtures.filter((f) => String(f.league?.id) === String(lId));
    if (leagueFixtures.length === 0) continue;

    const leagueParams = getLeagueParams(lId);
    const leagueProfile = getLeagueProfile(lId);
    // Prefer season stamped on fixtures (UEFA cups / calendar mismatches vs inferSeason(date)).
    const leagueSeason = resolveLeagueSeasonFromFixtures(leagueFixtures, season);
    // Warm league caches once (Elo + market rolling) before the per-fixture Stage02–09 loop.
    const [marketRollingMap] = await Promise.all([
      loadTeamMarketRolling(Number(lId), Number(leagueSeason)).catch(() => new Map()),
      loadLeagueElo(lId).catch(() => new Map())
    ]);

    const fillTeamIds = isUefaClubCompetition(lId)
      ? [
          ...new Set(
            leagueFixtures
              .flatMap((fx) => [fx?.teams?.home?.id, fx?.teams?.away?.id])
              .filter((id) => id != null && id !== "")
              .map((id) => String(id))
          )
        ]
      : [];
    const {
      standingsRows,
      standingsMap,
      prevSeasonUsed: standingsPrevSeason
    } = await loadStandingsMapWithSeasonFallback(lId, leagueSeason, 86400, { fillTeamIds });
    const leagueStandings = buildLeagueStandingsTable(standingsRows);

    context.league = {
      lId,
      leagueSeason,
      leagueParams,
      leagueProfile,
      marketRollingMap,
      standingsMap,
      leagueStandings,
      standingsRows,
      standingsPrevSeason,
      leagueFixtures
    };

    for (const fx of leagueFixtures) {
      if (out.length >= effectiveLimit) break;

      const fixtureId = fx.fixture?.id;
      if (context.allowedFixtureIds instanceof Set) {
        const sid = fixtureId == null ? "" : String(fixtureId);
        if (!sid || !context.allowedFixtureIds.has(sid)) continue;
      }
      const homeName = fx.teams?.home?.name || "Home";
      const awayName = fx.teams?.away?.name || "Away";
      const homeIdStr = fx.teams?.home?.id ? String(fx.teams.home.id) : null;
      const awayIdStr = fx.teams?.away?.id ? String(fx.teams.away.id) : null;
      let refereeName = "";
      try {
        const r = fx.fixture?.referee;
        if (r) {
          if (typeof r === "string") refereeName = r;
          else refereeName = r?.name || r?.full_name || r?.last_name || "";
        }
      } catch {
        refereeName = "";
      }

      const venue = extractVenueFromFixture(fx);
      const f = beginFixture(context, {
        fixtureId,
        fx,
        homeName,
        awayName,
        homeIdStr,
        awayIdStr,
        refereeName,
        venue
      });
      initFixtureWorkingState(f);

      try {
        for (const stage of FIXTURE_STAGES) {
          await stage.run(context);
          if (context.fixture?.aborted) break;
        }
        if (context.fixture?.silentSkip) {
          // legacy: !calc → no row
        } else if (context.fixture?.row) {
          out.push(context.fixture.row);
          // Kept out of `row` deliberately — it must never ride along in the
          // public predict response or get spread into raw_payload; Stage10
          // persists it to its own table instead.
          if (context.fixture.contextSnapshot) contextSnapshots.push(context.fixture.contextSnapshot);
        }
      } catch (fixtureError) {
        logError("predict.fixture_failed", {
          fixtureId,
          error: fixtureError?.message || String(fixtureError)
        });
        out.push(buildFixtureErrorRow(f, context.league));
      } finally {
        resetFixture(context);
      }
    }
  }

  context.out = out;
  return context;
}

export default { runFixtureStageLoop, FIXTURE_STAGES };
