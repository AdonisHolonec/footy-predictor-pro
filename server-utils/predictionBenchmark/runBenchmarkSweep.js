/**
 * Orchestrates the out-of-band benchmark sweep: reads already-persisted
 * predictions_history rows (written by the existing Stage10Persistence.js,
 * minutes/hours earlier), fetches each fixture's API-Football prediction,
 * builds the deterministic BenchmarkConsensus, and persists the result.
 *
 * Runs entirely outside /api/predict's call stack — triggered only by the
 * cron endpoint (api/cron/predictionBenchmarkSweep.js). Never imports
 * server-utils/PredictionEngine, confidence, value, or any pipeline stage.
 * One bad fixture never aborts the sweep (per-fixture try/catch); a small
 * per-run budget keeps this from ever contending with apiBudgetCircuit.js's
 * daily cap.
 */

import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { MODEL_VERSION } from "../modelConstants.js";
import { isFinalStatus, evaluateTopPick } from "../predictionsHistory.js";
import { fetchApiFootballPrediction } from "./fetchApiFootballPrediction.js";
import { buildBenchmarkConsensus } from "./BenchmarkConsensus.js";
import { persistPredictionBenchmarks } from "./persistPredictionBenchmarks.js";
import { BENCHMARK_SCHEMA_VERSION } from "./normalizeApiFootballPrediction.js";

const HISTORY_TABLE = "predictions_history";
const BENCHMARK_TABLE = "prediction_benchmarks";

const SWEEP_WINDOW_DAYS = Math.max(1, Math.min(Number(process.env.PREDICTION_BENCHMARK_SWEEP_WINDOW_DAYS || 7), 14));
const SWEEP_BUDGET = Math.max(1, Math.min(Number(process.env.PREDICTION_BENCHMARK_SWEEP_BUDGET || 120), 200));

/**
 * The candidate query must over-fetch. Supabase applies `.limit()` BEFORE the
 * already-benchmarked filter below, so capping candidates at SWEEP_BUDGET meant a
 * window whose newest rows were all benchmarked produced zero fetches, while older
 * unbenchmarked rows stayed permanently unreachable — the budget acted as a scan cap,
 * not a fetch cap. Scan a multiple of the budget, then cap actual upstream fetches at
 * SWEEP_BUDGET, so PREDICTION_BENCHMARK_SWEEP_BUDGET means "max upstream fetches per
 * run" as its name implies. Raising the budget only increases accrual with this fix.
 */
const CANDIDATE_SCAN_MULTIPLIER = Math.max(
  1,
  Math.min(Number(process.env.PREDICTION_BENCHMARK_SCAN_MULTIPLIER || 6), 20)
);
const FIXTURE_TEAMS_TTL_SEC = 86400; // team ids for a given fixture never change — cache generously

/** Resolves {homeTeamId, awayTeamId} for a fixture via the same cached /fixtures
 * lookup used elsewhere (see server-utils/fixtureHalftimeGoals.js) — this data
 * isn't stored on predictions_history, so it's fetched fresh, cached, and
 * counted against the same daily API budget as everything else. */
async function resolveFixtureTeams(fixtureId, getWithCache) {
  try {
    const req = await getWithCache("/fixtures", { id: fixtureId }, FIXTURE_TEAMS_TTL_SEC);
    if (!req.ok) return { homeTeamId: null, awayTeamId: null };
    const teams = req.data?.response?.[0]?.teams;
    const homeTeamId = Number.isFinite(Number(teams?.home?.id)) ? Number(teams.home.id) : null;
    const awayTeamId = Number.isFinite(Number(teams?.away?.id)) ? Number(teams.away.id) : null;
    return { homeTeamId, awayTeamId };
  } catch {
    return { homeTeamId: null, awayTeamId: null };
  }
}

function resolveResult(pick, status, score) {
  if (!pick) return "pending";
  if (!isFinalStatus(status)) return "pending";
  const hit = evaluateTopPick(pick, score);
  if (hit === true) return "win";
  if (hit === false) return "loss";
  return "pending";
}

/**
 * @param {{ getWithCache: Function }} deps
 * @returns {Promise<{ ok: boolean, scanned: number, fetched: number, persisted: number, errors: number, skipped?: string }>}
 */
export async function runBenchmarkSweep({ getWithCache }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, scanned: 0, fetched: 0, persisted: 0, errors: 0, skipped: "no_supabase" };

  const cutoffIso = new Date(Date.now() - SWEEP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error: candidatesError } = await supabase
    .from(HISTORY_TABLE)
    .select(
      "fixture_id, league_id, kickoff_at, recommended_pick, recommended_confidence, match_status, score_home, score_away, validation, raw_payload"
    )
    .gte("kickoff_at", cutoffIso)
    .not("recommended_pick", "is", null)
    .order("kickoff_at", { ascending: false })
    .limit(SWEEP_BUDGET * CANDIDATE_SCAN_MULTIPLIER);

  if (candidatesError) {
    return { ok: false, scanned: 0, fetched: 0, persisted: 0, errors: 1, error: candidatesError.message };
  }
  const rows = candidates || [];
  if (rows.length === 0) return { ok: true, scanned: 0, fetched: 0, persisted: 0, errors: 0 };

  // Scoped by the same kickoff window rather than by an `.in(fixture_id, [...])` list:
  // every benchmark row for a candidate carries that candidate's kickoff_at, so the
  // window is an exact superset of the ids we care about — and it keeps the query string
  // bounded now that the candidate scan can reach several hundred rows.
  const { data: existing } = await supabase
    .from(BENCHMARK_TABLE)
    .select("fixture_id")
    .eq("model_version", MODEL_VERSION)
    // Must match what persistPredictionBenchmarks actually writes (afb-v1).
    // The previous "benchmark-v1" literal never matched a stored row, so the
    // already-benchmarked skip was a no-op and every sweep re-fetched the whole
    // window — roughly 3x the necessary upstream calls at the default 3-day window.
    .eq("schema_version", BENCHMARK_SCHEMA_VERSION)
    .gte("kickoff_at", cutoffIso)
    .limit(20000);
  const alreadyBenchmarked = new Set((existing || []).map((r) => Number(r.fixture_id)));

  // Budget is enforced here, on fetches — not on the scan above.
  const unbenchmarked = rows.filter((r) => !alreadyBenchmarked.has(Number(r.fixture_id)));
  const pending = unbenchmarked.slice(0, SWEEP_BUDGET);

  let fetched = 0;
  let errors = 0;
  const toPersist = [];

  for (const row of pending) {
    try {
      const fixtureId = Number(row.fixture_id);
      const apiReq = await fetchApiFootballPrediction(fixtureId, getWithCache);
      if (!apiReq.ok || !apiReq.prediction) continue;
      fetched += 1;

      const fixtureTeams = await resolveFixtureTeams(fixtureId, getWithCache);
      const ourOdd = Number(row.raw_payload?.recommended?.odd) || null;
      const ourFamily = row.raw_payload?.recommended?.family || null;
      const ourRecommendation = {
        pick: row.recommended_pick,
        confidence: Number(row.recommended_confidence),
        family: ourFamily
      };

      const consensus = buildBenchmarkConsensus(ourRecommendation, apiReq.prediction, fixtureTeams);
      const score = { home: row.score_home, away: row.score_away };

      toPersist.push({
        fixtureId,
        leagueId: row.league_id,
        kickoffAt: row.kickoff_at,
        modelVersion: MODEL_VERSION,
        schemaVersion: BENCHMARK_SCHEMA_VERSION,
        ourPick: row.recommended_pick,
        ourFamily: consensus.ourPick.family,
        ourConfidence: row.recommended_confidence,
        ourOdd,
        apiPrediction: apiReq.prediction,
        apiRaw: apiReq.prediction?.raw ?? null,
        consensus,
        scoreHome: row.score_home,
        scoreAway: row.score_away,
        ourResult: row.validation === "win" || row.validation === "loss" ? row.validation : "pending",
        apiResult: resolveResult(consensus.apiPick.inferredPick, row.match_status, score),
        settledAt: isFinalStatus(row.match_status) ? new Date().toISOString() : null
      });
    } catch {
      errors += 1;
      // one bad fixture never aborts the sweep
    }
  }

  let persisted = 0;
  if (toPersist.length > 0) {
    const persistResult = await persistPredictionBenchmarks(toPersist);
    persisted = persistResult.upserted;
  }

  return {
    ok: true,
    scanned: rows.length,
    unbenchmarked: unbenchmarked.length,
    attempted: pending.length,
    fetched,
    persisted,
    errors,
    budget: SWEEP_BUDGET,
    windowDays: SWEEP_WINDOW_DAYS,
    // > 0 means the window holds more unbenchmarked fixtures than one run can fetch —
    // accrual is budget-bound, which is the number the meta-learning Data Health panel
    // uses to project days-to-minimum-support.
    backlog: Math.max(0, unbenchmarked.length - pending.length)
  };
}

export default { runBenchmarkSweep };
