/**
 * Persist / load Auto Calibration weight overlays.
 * Durable store: Supabase tables. Fallback: process memory (+ optional JSON path).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

let memoryOverlays = new Map(); // key → overlay
let memoryRuns = [];
let cache = { loadedAt: 0, byKind: null };

const CACHE_TTL_MS = 60_000;

function cacheKey(modelVersion, kind, scope = "global") {
  return `${modelVersion}::${kind}::${scope}`;
}

function filePath() {
  return typeof process !== "undefined" ? process.env?.AUTO_CALIB_STORE_PATH : null;
}

function loadFileStore() {
  const path = filePath();
  if (!path || !existsSync(path)) return { overlays: [], runs: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { overlays: [], runs: [] };
  }
}

function saveFileStore(store) {
  const path = filePath();
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* ignore fs errors in serverless */
  }
}

export function invalidateAutoCalibrationCache() {
  cache = { loadedAt: 0, byKind: null };
}

/**
 * Load active overlays for a model version into a kind→overlay map.
 */
export async function loadActiveOverlays(modelVersion) {
  const now = Date.now();
  if (cache.byKind && now - cache.loadedAt < CACHE_TTL_MS) return cache.byKind;

  const mv = String(modelVersion || "default");
  const byKind = {};

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("auto_calibration_overlays")
        .select("*")
        .eq("model_version", mv)
        .eq("active", true)
        .eq("scope", "global");
      if (!error && Array.isArray(data)) {
        for (const row of data) {
          byKind[row.kind] = mapOverlayRow(row);
        }
        cache = { loadedAt: now, byKind };
        return byKind;
      }
    } catch {
      /* table may not exist yet */
    }
  }

  // Memory / file fallback
  const file = loadFileStore();
  for (const row of file.overlays || []) {
    if (row.model_version === mv && row.active !== false && (row.scope || "global") === "global") {
      byKind[row.kind] = mapOverlayRow(row);
    }
  }
  for (const [key, row] of memoryOverlays.entries()) {
    if (key.startsWith(`${mv}::`) && row.active !== false) {
      byKind[row.kind] = row;
    }
  }

  cache = { loadedAt: now, byKind };
  return byKind;
}

function mapOverlayRow(row) {
  return {
    kind: row.kind,
    modelVersion: row.model_version || row.modelVersion,
    scope: row.scope || "global",
    weights: row.weights_json || row.weights || {},
    deltas: row.deltas_json || row.deltas || {},
    lockedKeys: row.locked_keys || row.lockedKeys || [],
    metrics: row.metrics_json || row.metrics || {},
    sampleSize: row.sample_size ?? row.sampleSize ?? 0,
    fittedAt: row.fitted_at || row.fittedAt || null,
    active: row.active !== false
  };
}

/**
 * Deactivate previous active overlays of same kind/scope, insert new active row.
 */
export async function saveOverlay({
  modelVersion,
  kind,
  scope = "global",
  weights,
  deltas,
  lockedKeys,
  metrics,
  sampleSize
}) {
  const mv = String(modelVersion || "default");
  const payload = {
    model_version: mv,
    kind,
    scope,
    weights_json: weights || {},
    deltas_json: deltas || {},
    locked_keys: lockedKeys || [],
    metrics_json: metrics || {},
    sample_size: sampleSize || 0,
    active: true,
    fitted_at: new Date().toISOString()
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      await supabase
        .from("auto_calibration_overlays")
        .update({ active: false })
        .eq("model_version", mv)
        .eq("kind", kind)
        .eq("scope", scope)
        .eq("active", true);

      const { data, error } = await supabase.from("auto_calibration_overlays").insert(payload).select("*").single();
      if (!error && data) {
        invalidateAutoCalibrationCache();
        return { ok: true, overlay: mapOverlayRow(data), store: "supabase" };
      }
    } catch {
      /* fall through */
    }
  }

  const mapped = mapOverlayRow(payload);
  memoryOverlays.set(cacheKey(mv, kind, scope), mapped);
  const file = loadFileStore();
  file.overlays = (file.overlays || []).map((o) =>
    o.model_version === mv && o.kind === kind && (o.scope || "global") === scope
      ? { ...o, active: false }
      : o
  );
  file.overlays.push({ ...payload, id: `mem-${Date.now()}` });
  saveFileStore(file);
  invalidateAutoCalibrationCache();
  return { ok: true, overlay: mapped, store: "memory" };
}

export async function saveCalibrationRun(run) {
  const row = {
    model_version: String(run.modelVersion || "default"),
    mode: run.mode || "auto",
    started_at: run.startedAt,
    finished_at: run.finishedAt || new Date().toISOString(),
    ok: Boolean(run.ok),
    config_json: run.config || {},
    summary_json: run.summary || {},
    report_json: run.report || {},
    error: run.error || null
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      const { data, error } = await supabase.from("calibration_runs").insert(row).select("id").single();
      if (!error) return { ok: true, id: data?.id, store: "supabase" };
    } catch {
      /* fall through */
    }
  }

  const id = `run-${Date.now()}`;
  memoryRuns.unshift({ id, ...row });
  memoryRuns = memoryRuns.slice(0, 50);
  const file = loadFileStore();
  file.runs = [{ id, ...row }, ...(file.runs || [])].slice(0, 50);
  saveFileStore(file);
  return { ok: true, id, store: "memory" };
}

export async function listCalibrationRuns({ modelVersion = null, limit = 20 } = {}) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      let q = supabase
        .from("calibration_runs")
        .select("id, model_version, mode, started_at, finished_at, ok, summary_json, error")
        .order("started_at", { ascending: false })
        .limit(lim);
      if (modelVersion) q = q.eq("model_version", String(modelVersion));
      const { data, error } = await q;
      if (!error) return { ok: true, runs: data || [], store: "supabase" };
    } catch {
      /* fall through */
    }
  }
  let runs = memoryRuns.slice();
  const file = loadFileStore();
  if (file.runs?.length) runs = file.runs;
  if (modelVersion) runs = runs.filter((r) => r.model_version === String(modelVersion));
  return { ok: true, runs: runs.slice(0, lim), store: "memory" };
}

export async function getLatestCalibrationReport(modelVersion) {
  const { runs } = await listCalibrationRuns({ modelVersion, limit: 1 });
  const latest = runs?.[0];
  if (!latest) return { ok: false, report: null };
  if (latest.report_json) return { ok: true, report: latest.report_json, run: latest };

  const supabase = getSupabaseAdmin();
  if (supabase && latest.id) {
    try {
      const { data } = await supabase.from("calibration_runs").select("report_json").eq("id", latest.id).maybeSingle();
      if (data?.report_json) return { ok: true, report: data.report_json, run: latest };
    } catch {
      /* ignore */
    }
  }
  return { ok: true, report: latest.summary_json || null, run: latest };
}
