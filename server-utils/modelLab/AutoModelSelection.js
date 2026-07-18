/**
 * Auto Model Selection — every model competes over 30/90/365-day windows and the
 * best one is promoted automatically (persisted to KV). No manual switching.
 *
 * Composite score per window (min-max normalized across models in that window):
 *   score = 0.50·ROI + 0.20·Accuracy + 0.20·(−LogLoss) + 0.10·Sharpe
 * Windows are weighted (recency + stability): 30d 0.20, 90d 0.35, 365d 0.45.
 * Models below the sample floor in a window are ignored for that window.
 *
 * Promotion is safe-by-default: if no model clears the floor, the selector keeps
 * "E" (everything enabled) — identical to current production behavior.
 */

import { createClient } from "@vercel/kv";
import { runModelLab, MODEL_REGISTRY } from "./ModelLab.js";
import { actual1x2FromScore } from "../probabilityMetrics.js";

const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.Database_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.Database_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

const ACTIVE_KEY = "footy_active_model";
const DEFAULT_MODEL_ID = "E";

const WINDOWS = [
  { key: "30d", days: 30, weight: 0.2 },
  { key: "90d", days: 90, weight: 0.35 },
  { key: "365d", days: 365, weight: 0.45 }
];

function envNum(key, fallback) {
  const n = Number(process.env?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function minSamples() {
  return Math.max(5, envNum("MODEL_SELECT_MIN_SAMPLES", 20));
}

function sliceRowsByDays(rows, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return (rows || []).filter((r) => {
    const t = r.kickoff_at ? new Date(r.kickoff_at).getTime() : NaN;
    return Number.isFinite(t) && t >= cutoff;
  });
}

function normalize(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return values.map(() => 0.5);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max - min < 1e-9) return values.map(() => 0.5);
  return values.map((v) => (Number.isFinite(v) ? (v - min) / (max - min) : 0));
}

/** Per-window composite scores for all models. */
function scoreWindow(models) {
  const floor = minSamples();
  const eligible = models.filter((m) => m.samples >= floor);
  const roiN = normalize(models.map((m) => m.roi));
  const accN = normalize(models.map((m) => m.accuracy));
  const logN = normalize(models.map((m) => (m.logLoss == null ? NaN : -m.logLoss)));
  const shpN = normalize(models.map((m) => (m.expectedValue ?? 0)));
  return models.map((m, i) => {
    const composite = 0.5 * roiN[i] + 0.2 * accN[i] + 0.2 * logN[i] + 0.1 * shpN[i];
    return {
      id: m.id,
      name: m.name,
      samples: m.samples,
      accuracy: m.accuracy,
      roi: m.roi,
      logLoss: m.logLoss,
      brier: m.brier,
      expectedValue: m.expectedValue,
      eligible: m.samples >= floor,
      composite: eligible.length ? Number(composite.toFixed(4)) : 0
    };
  });
}

/**
 * Run the full competition and return the winner + breakdown (does not persist).
 * @param {Array<object>} rows predictions_history rows (max 365d)
 */
export function runAutoSelection(rows) {
  const settledRows = (rows || []).filter((r) => actual1x2FromScore(r.score_home, r.score_away) != null);

  const windows = WINDOWS.map((w) => {
    const lab = runModelLab(sliceRowsByDays(settledRows, w.days));
    const scored = scoreWindow(lab.models);
    const eligible = scored.filter((s) => s.eligible);
    const winner = [...eligible].sort((a, b) => b.composite - a.composite)[0] || null;
    return { key: w.key, days: w.days, weight: w.weight, totalSettled: lab.totalSettled, models: scored, winner };
  });

  // Aggregate composite across windows (weighted); require at least one eligible window.
  const agg = new Map();
  for (const m of MODEL_REGISTRY) agg.set(m.id, { id: m.id, name: m.name, score: 0, weightSum: 0, windows: {} });
  for (const w of windows) {
    for (const s of w.models) {
      if (!s.eligible) continue;
      const a = agg.get(s.id);
      if (!a) continue;
      a.score += s.composite * w.weight;
      a.weightSum += w.weight;
      a.windows[w.key] = { composite: s.composite, roi: s.roi, accuracy: s.accuracy, samples: s.samples };
    }
  }

  const ranking = [...agg.values()]
    .map((a) => ({
      id: a.id,
      name: a.name,
      compositeScore: a.weightSum > 0 ? Number((a.score / a.weightSum).toFixed(4)) : null,
      coverage: Number(a.weightSum.toFixed(2)),
      windows: a.windows
    }))
    .filter((a) => a.compositeScore != null)
    .sort((a, b) => b.compositeScore - a.compositeScore);

  const winner = ranking[0] || null;
  const selectedId = winner ? winner.id : DEFAULT_MODEL_ID;

  return {
    schemaVersion: "modelselect-v1",
    evaluatedAt: new Date().toISOString(),
    totalSettled: settledRows.length,
    windows,
    ranking,
    selected: {
      id: selectedId,
      name: (MODEL_REGISTRY.find((m) => m.id === selectedId) || {}).name || selectedId,
      reason: winner ? "highest_weighted_composite" : "insufficient_data_default"
    }
  };
}

export async function getActiveModel() {
  try {
    const row = await kv.get(ACTIVE_KEY);
    if (row && typeof row === "object" && row.id) return row;
  } catch {
    /* fall through */
  }
  return { id: DEFAULT_MODEL_ID, name: "Everything enabled", reason: "default", promotedAt: null };
}

export async function getActiveModelId() {
  const envOverride = String(process.env.ACTIVE_MODEL_ID || "").toUpperCase().trim();
  if (envOverride) return envOverride;
  const active = await getActiveModel();
  return active?.id || DEFAULT_MODEL_ID;
}

/** Persist the promotion result (idempotent write of the current best model). */
export async function promoteActiveModel(selection) {
  const record = {
    id: selection?.selected?.id || DEFAULT_MODEL_ID,
    name: selection?.selected?.name || "Everything enabled",
    reason: selection?.selected?.reason || "auto",
    promotedAt: new Date().toISOString(),
    compositeScore: selection?.ranking?.[0]?.compositeScore ?? null,
    windowWinners: (selection?.windows || []).map((w) => ({ window: w.key, id: w.winner?.id || null })),
    totalSettled: selection?.totalSettled ?? 0
  };
  try {
    await kv.set(ACTIVE_KEY, record);
  } catch {
    /* non-fatal — selection still returned to caller */
  }
  return record;
}

/** Run + promote in one call (used by cron / API run). */
export async function runAndPromote(rows) {
  const selection = runAutoSelection(rows);
  const promoted = await promoteActiveModel(selection);
  return { ...selection, promoted };
}

export const AutoModelSelection = {
  runAutoSelection,
  runAndPromote,
  getActiveModel,
  getActiveModelId,
  promoteActiveModel,
  WINDOWS,
  DEFAULT_MODEL_ID
};
export default AutoModelSelection;
