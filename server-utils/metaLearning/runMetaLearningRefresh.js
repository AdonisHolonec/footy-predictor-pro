/**
 * Meta-learning ETL orchestrator (Sprint 1).
 *
 * The ONLY module in this layer that touches Supabase. Reads already-persisted rows from
 * predictions_history + prediction_benchmarks, runs the pure projectors, and rewrites the
 * derived meta_* tables. Never writes to predictions_history or prediction_benchmarks;
 * never imports PredictorV3 / PredictionEngine / pipeline / confidence / value; never
 * makes an upstream API call, so it cannot contend with apiBudgetCircuit.js.
 *
 * Idempotent by construction: the derived tables are rewritten for the refresh window on
 * every run (delete-then-insert, scoped to window + model_version), so there is no
 * incremental state that can silently rot and a full rebuild is always one run away. The
 * tables are small — thousands of rows — which is what makes that affordable.
 */

import { getSupabaseAdmin } from "../supabaseAdmin.js";
import { MODEL_VERSION } from "../modelConstants.js";
import { CONTEXT_VERSION, ETL, PROVIDER_KEYS } from "./metaLearningConfig.js";
import { projectMetaRows } from "./MetaSelectionProjector.js";
import { computeDataHealth } from "./MetaDataHealth.js";
import { selectWithPayloadPaths, rehydratePayloadPathRows } from "../history/payloadProjection.js";

const HISTORY_TABLE = "predictions_history";
const BENCHMARK_TABLE = "prediction_benchmarks";
const CONTEXT_TABLE = "meta_fixture_context";
const SELECTIONS_TABLE = "meta_provider_selections";
const PROVIDERS_TABLE = "meta_providers";
const RUNS_TABLE = "meta_learning_runs";

/**
 * Egress: the ETL read the full raw_payload column for up to ETL.rowLimit rows
 * over a 365-day window — the single largest recurring PostgREST response in
 * the codebase — while the whole meta layer dereferences exactly five payload
 * fields: MetaContextBuilder reads recommended.odd, MetaSelectionProjector and
 * predictorV3Provider read recommended.family, valueEngine.bestMarket,
 * valueBet.type and valueBet.odds. The select now carries those five paths and
 * rehydratePayloadPathRows() rebuilds row.raw_payload, so the projectors are
 * untouched — input projection only, no algorithm/sample/target change. Rule
 * from history/payloadProjection.js: a new `payload.<key>` read MUST add its
 * path here. Exported so tests can pin spec against consumers.
 */
export const META_HISTORY_PAYLOAD_PATHS = Object.freeze({
  recOdd: Object.freeze(["recommended", "odd"]),
  recFamily: Object.freeze(["recommended", "family"]),
  veBestMarket: Object.freeze(["valueEngine", "bestMarket"]),
  vbType: Object.freeze(["valueBet", "type"]),
  vbOdds: Object.freeze(["valueBet", "odds"])
});

const HISTORY_COLUMNS = selectWithPayloadPaths(
  [
    "fixture_id",
    "league_id",
    "league_name",
    "kickoff_at",
    "recommended_pick",
    "recommended_confidence",
    "odds_home",
    "odds_draw",
    "odds_away",
    "closing_odds_home",
    "closing_odds_draw",
    "closing_odds_away",
    "match_status",
    "score_home",
    "score_away",
    "validation",
    "model_version",
    "updated_at"
  ].join(", "),
  META_HISTORY_PAYLOAD_PATHS
);

const BENCHMARK_COLUMNS = [
  "fixture_id",
  "league_id",
  "kickoff_at",
  "model_version",
  "our_family",
  "api_prediction",
  "api_raw",
  "consensus",
  "agree",
  "confidence_delta",
  "api_result",
  "settled_at"
].join(", ");

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** key -> id, plus the reverse map the health module needs. */
async function loadProviderRegistry(supabase) {
  const { data, error } = await supabase.from(PROVIDERS_TABLE).select("id, key").eq("active", true);
  if (error) throw new Error(`meta_providers unavailable: ${error.message}`);

  const providerIdByKey = new Map();
  const providerKeyById = new Map();
  for (const row of data || []) {
    providerIdByKey.set(row.key, row.id);
    providerKeyById.set(row.id, row.key);
  }

  for (const required of [PROVIDER_KEYS.predictorV3, PROVIDER_KEYS.apiFootball]) {
    if (!providerIdByKey.has(required)) {
      throw new Error(`meta_providers is missing the '${required}' row — apply migration 040.`);
    }
  }
  return { providerIdByKey, providerKeyById };
}

async function replaceRows(supabase, table, rows, { cutoffIso, modelVersion }) {
  const del = await supabase
    .from(table)
    .delete()
    .eq("model_version", modelVersion)
    .gte("kickoff_at", cutoffIso);
  if (del.error) throw new Error(`${table} delete failed: ${del.error.message}`);

  let inserted = 0;
  for (const batch of chunk(rows, ETL.upsertChunkSize)) {
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    inserted += batch.length;
  }
  return inserted;
}

/**
 * @param {{ modelVersion?: string, windowDays?: number, dryRun?: boolean }} options
 */
export async function runMetaLearningRefresh(options = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, skipped: "no_supabase" };

  const modelVersion = String(options.modelVersion || process.env.META_MODEL_VERSION || MODEL_VERSION);
  const windowDays = Math.max(1, Math.min(Number(options.windowDays) || ETL.windowDays, 1460));
  const dryRun = Boolean(options.dryRun);
  const startedAt = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const config = { modelVersion, windowDays, contextVersion: CONTEXT_VERSION, dryRun };

  try {
    const { providerIdByKey, providerKeyById } = await loadProviderRegistry(supabase);

    const historyReq = await supabase
      .from(HISTORY_TABLE)
      .select(HISTORY_COLUMNS)
      .gte("kickoff_at", cutoffIso)
      .not("recommended_pick", "is", null)
      .order("kickoff_at", { ascending: false })
      .limit(ETL.rowLimit);
    if (historyReq.error) throw new Error(`${HISTORY_TABLE} read failed: ${historyReq.error.message}`);

    const benchmarkReq = await supabase
      .from(BENCHMARK_TABLE)
      .select(BENCHMARK_COLUMNS)
      .gte("kickoff_at", cutoffIso)
      .order("kickoff_at", { ascending: false })
      .limit(ETL.rowLimit);
    if (benchmarkReq.error) throw new Error(`${BENCHMARK_TABLE} read failed: ${benchmarkReq.error.message}`);

    const historyRows = rehydratePayloadPathRows(historyReq.data, META_HISTORY_PAYLOAD_PATHS);
    const benchmarkRows = benchmarkReq.data || [];

    const { contexts, selections, diagnostics } = projectMetaRows({
      historyRows,
      benchmarkRows,
      modelVersion,
      providerIdByKey
    });

    let contextsWritten = 0;
    let selectionsWritten = 0;
    if (!dryRun) {
      contextsWritten = await replaceRows(supabase, CONTEXT_TABLE, contexts, { cutoffIso, modelVersion });
      selectionsWritten = await replaceRows(supabase, SELECTIONS_TABLE, selections, {
        cutoffIso,
        modelVersion
      });
    }

    const health = computeDataHealth({
      selections,
      contexts,
      windowDays,
      providerKeyById,
      projectorDiagnostics: diagnostics,
      benchmarkRowCount: benchmarkRows.length,
      agreeNullCount: benchmarkRows.filter((r) => r.agree == null).length
    });

    const summary = {
      historyRows: historyRows.length,
      benchmarkRows: benchmarkRows.length,
      contexts: contexts.length,
      selections: selections.length,
      contextsWritten,
      selectionsWritten,
      diagnostics,
      health
    };

    const finishedAt = new Date().toISOString();
    if (!dryRun) {
      await supabase
        .from(RUNS_TABLE)
        .insert({
          mode: "refresh",
          started_at: startedAt,
          finished_at: finishedAt,
          ok: true,
          config_json: config,
          summary_json: summary
        })
        .then(
          () => null,
          () => null // the journal must never be able to fail the run
        );
    }

    return { ok: true, startedAt, finishedAt, config, ...summary };
  } catch (error) {
    const message = error?.message || "meta learning refresh failed";
    await supabase
      .from(RUNS_TABLE)
      .insert({
        mode: "refresh",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        ok: false,
        config_json: config,
        error: message
      })
      .then(
        () => null,
        () => null
      );
    return { ok: false, startedAt, config, error: message };
  }
}

/**
 * Read-side for the admin Data Health view: recomputes the health bundle from the
 * PERSISTED meta_* rows, so the panel reflects what the last refresh actually stored
 * rather than silently re-deriving from source on every page load.
 */
export async function loadMetaDataHealth({ days = 90, modelVersion } = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "Supabase client unavailable" };

  const windowDays = Math.max(1, Math.min(Number(days) || 90, 1460));
  const version = String(modelVersion || process.env.META_MODEL_VERSION || MODEL_VERSION);
  const cutoffIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { providerKeyById } = await loadProviderRegistry(supabase);

    const selectionsReq = await supabase
      .from(SELECTIONS_TABLE)
      .select(
        "fixture_id, provider_id, market_family, selection, is_primary, signal_quality, priced_from, result, kickoff_at"
      )
      .eq("model_version", version)
      .gte("kickoff_at", cutoffIso)
      .limit(ETL.rowLimit);
    if (selectionsReq.error) throw new Error(selectionsReq.error.message);

    const contextsReq = await supabase
      .from(CONTEXT_TABLE)
      .select("fixture_id", { count: "exact", head: true })
      .eq("model_version", version)
      .gte("kickoff_at", cutoffIso);

    const benchmarkReq = await supabase
      .from(BENCHMARK_TABLE)
      .select("agree")
      .gte("kickoff_at", cutoffIso)
      .limit(ETL.rowLimit);

    const lastRunReq = await supabase
      .from(RUNS_TABLE)
      .select("started_at, finished_at, ok, summary_json, error")
      .order("started_at", { ascending: false })
      .limit(1);

    const benchmarkRows = benchmarkReq.data || [];
    const lastRun = lastRunReq.data?.[0] || null;

    const health = computeDataHealth({
      selections: selectionsReq.data || [],
      contexts: new Array(contextsReq.count || 0),
      windowDays,
      providerKeyById,
      projectorDiagnostics: lastRun?.summary_json?.diagnostics || {},
      benchmarkRowCount: benchmarkRows.length,
      agreeNullCount: benchmarkRows.filter((r) => r.agree == null).length
    });

    return {
      ok: true,
      days: windowDays,
      modelVersion: version,
      contextVersion: CONTEXT_VERSION,
      lastRun: lastRun
        ? {
            startedAt: lastRun.started_at,
            finishedAt: lastRun.finished_at,
            ok: lastRun.ok,
            error: lastRun.error ?? null
          }
        : null,
      health
    };
  } catch (error) {
    return { ok: false, error: error?.message || "meta data health failed" };
  }
}

export default { runMetaLearningRefresh, loadMetaDataHealth };
