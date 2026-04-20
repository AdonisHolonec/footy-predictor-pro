/**
 * Offline isotonic calibration fitter.
 *
 * Rulează: `npm run fit:calibration` (sau `node --env-file=.env.local scripts/fitCalibration.js`)
 *
 * Input: `predictions_history` rows cu validation ∈ {win, loss} şi match_status final.
 * Output: upsert în `calibration_maps` per (league_id, model_version, outcome).
 *
 * Filozofie:
 * - Scoatem p_raw (probabilitatea 1X2 a modelului înainte de blend cu piaţa) din `raw_payload.evaluation.modelProbs1x2Pct`.
 *   Dacă lipseşte, folosim `raw_payload.probs.{p1,pX,p2}` (blended — mai puţin curat, dar utilizabil).
 * - Outcome real derivat din score_home/score_away.
 * - Brier înainte/după salvat în metrics_json pentru audit vizibil în observatory.
 */
import { createClient } from "@supabase/supabase-js";
import { fitIsotonicPav, applyIsotonicMap } from "../server-utils/isotonicCalibration.js";
import { actual1x2FromScore, brier1x2 } from "../server-utils/probabilityMetrics.js";
import { MODEL_VERSION } from "../server-utils/modelConstants.js";

const MIN_SAMPLES_PER_LEAGUE = Math.max(40, Number(process.env.CALIBRATION_MIN_SAMPLES || 150));
const WINDOW_DAYS = Math.max(30, Math.min(Number(process.env.CALIBRATION_WINDOW_DAYS || 180), 720));
const FALLBACK_GLOBAL = true;

function extractRawTriple(payload) {
  const ev = payload?.evaluation?.modelProbs1x2Pct;
  if (ev && Number.isFinite(ev.p1) && Number.isFinite(ev.pX) && Number.isFinite(ev.p2)) {
    const s = ev.p1 + ev.pX + ev.p2;
    if (s > 0) return { p1: ev.p1 / s, pX: ev.pX / s, p2: ev.p2 / s };
  }
  const pr = payload?.probs;
  if (pr && Number.isFinite(pr.p1) && Number.isFinite(pr.pX) && Number.isFinite(pr.p2)) {
    const s = pr.p1 + pr.pX + pr.p2;
    if (s > 0) return { p1: pr.p1 / s, pX: pr.pX / s, p2: pr.p2 / s };
  }
  return null;
}

function collect(rows) {
  const out = { "1": [], X: [], "2": [] };
  for (const row of rows) {
    const actual = actual1x2FromScore(row.score_home, row.score_away);
    if (!actual) continue;
    const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const triple = extractRawTriple(payload);
    if (!triple) continue;
    out["1"].push({ x: triple.p1, y: actual === "1" ? 1 : 0 });
    out["X"].push({ x: triple.pX, y: actual === "X" ? 1 : 0 });
    out["2"].push({ x: triple.p2, y: actual === "2" ? 1 : 0 });
  }
  return out;
}

function brierForSamples(samples, fitted) {
  if (!samples.length) return null;
  let raw = 0;
  let cal = 0;
  for (const s of samples) {
    raw += (s.x - s.y) ** 2;
    const c = applyIsotonicMap(s.x, fitted.xPoints, fitted.yPoints);
    cal += (c - s.y) ** 2;
  }
  return { raw: raw / samples.length, calibrated: cal / samples.length };
}

async function upsertMap(supabase, { league_id, model_version, outcome, fitted, samples }) {
  if (!fitted || !fitted.xPoints.length) return { skipped: true };
  const brier = brierForSamples(samples, fitted);
  const payload = {
    league_id,
    model_version,
    outcome,
    x_points: fitted.xPoints,
    y_points: fitted.yPoints,
    sample_size: samples.length,
    brier_raw: brier ? Number(brier.raw.toFixed(5)) : null,
    brier_calibrated: brier ? Number(brier.calibrated.toFixed(5)) : null,
    fitted_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from("calibration_maps")
    .upsert(payload, { onConflict: "league_id,model_version,outcome" });
  if (error) throw error;
  return { ok: true, brier };
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const modelVersion = process.env.CALIBRATION_MODEL_VERSION || MODEL_VERSION;

  console.log(`Calibration fit :: model_version=${modelVersion} window=${WINDOW_DAYS}d min=${MIN_SAMPLES_PER_LEAGUE}`);

  const { data, error } = await supabase
    .from("predictions_history")
    .select("league_id, score_home, score_away, match_status, raw_payload")
    .gte("kickoff_at", cutoff)
    .in("match_status", ["FT", "AET", "PEN"])
    .limit(15000);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data || []).filter((r) => r.score_home != null && r.score_away != null);
  console.log(`Rows available: ${rows.length}`);

  const byLeague = new Map();
  for (const r of rows) {
    const id = Number(r.league_id);
    if (!Number.isFinite(id)) continue;
    if (!byLeague.has(id)) byLeague.set(id, []);
    byLeague.get(id).push(r);
  }

  const summary = [];
  for (const [leagueId, lrows] of byLeague.entries()) {
    if (lrows.length < MIN_SAMPLES_PER_LEAGUE) {
      summary.push({ leagueId, skipped: true, reason: `n=${lrows.length} < ${MIN_SAMPLES_PER_LEAGUE}` });
      continue;
    }
    const groups = collect(lrows);
    const outcomes = ["1", "X", "2"];
    for (const outcome of outcomes) {
      const samples = groups[outcome];
      if (samples.length < MIN_SAMPLES_PER_LEAGUE) continue;
      const fitted = fitIsotonicPav(samples);
      const result = await upsertMap(supabase, {
        league_id: leagueId,
        model_version: modelVersion,
        outcome,
        fitted,
        samples
      });
      summary.push({ leagueId, outcome, n: samples.length, ...result });
    }
  }

  if (FALLBACK_GLOBAL) {
    const globalGroups = collect(rows);
    for (const outcome of ["1", "X", "2"]) {
      const samples = globalGroups[outcome];
      if (samples.length < MIN_SAMPLES_PER_LEAGUE) continue;
      const fitted = fitIsotonicPav(samples);
      const result = await upsertMap(supabase, {
        league_id: -1, // convenţie: -1 = global fallback (NULL nu e unique în upsert cu onConflict)
        model_version: modelVersion,
        outcome,
        fitted,
        samples
      });
      summary.push({ leagueId: "GLOBAL", outcome, n: samples.length, ...result });
    }
  }

  console.log("=== Calibration summary ===");
  for (const row of summary) {
    if (row.skipped) {
      console.log(`  L${row.leagueId} · skip · ${row.reason}`);
    } else {
      const brier = row.brier
        ? ` brier raw=${row.brier.raw.toFixed(4)} cal=${row.brier.calibrated.toFixed(4)}`
        : "";
      console.log(`  L${row.leagueId} · ${row.outcome} · n=${row.n}${brier}`);
    }
  }
  console.log("Done.");
}

run().catch((err) => {
  console.error("fitCalibration crashed:", err?.message || err);
  process.exit(1);
});
