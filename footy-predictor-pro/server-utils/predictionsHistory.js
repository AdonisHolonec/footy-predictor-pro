import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { MODEL_VERSION } from "./modelConstants.js";

const FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);
const HISTORY_TABLE = "predictions_history";
const SNAPSHOTS_TABLE = "prediction_snapshots";

function asNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function normalizePick(pick) { return String(pick || "").trim().toLowerCase(); }
export function isFinalStatus(status) { return FINAL_STATUSES.has(String(status || "").toUpperCase()); }

export function evaluateTopPick(pick, score) {
  if (!pick || !score) return null;
  if (score.home === null || score.away === null) return null;
  const home = Number(score.home); const away = Number(score.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const total = home + away; const normalized = normalizePick(pick);
  if (normalized === "1") return home > away;
  if (normalized === "2") return away > home;
  if (normalized === "x") return home === away;
  if (normalized === "gg") return home > 0 && away > 0;
  if (normalized === "ngg") return home === 0 || away === 0;
  const overMatch = normalized.match(/peste\s*(\d+(?:[.,]\d+)?)/);
  if (overMatch) return total > Number(overMatch[1].replace(",", "."));
  const underMatch = normalized.match(/sub\s*(\d+(?:[.,]\d+)?)/);
  if (underMatch) return total < Number(underMatch[1].replace(",", "."));
  return null;
}

export function validationFromMatch(status, pick, score) {
  if (!isFinalStatus(status)) return "pending";
  const result = evaluateTopPick(pick, score);
  if (result === null) return "pending";
  return result ? "win" : "loss";
}

function mapPredictionToDbRow(prediction) {
  const kickoffAt = prediction.kickoff || null;
  const status = prediction.status || null;
  const scoreHome = asNum(prediction.score?.home);
  const scoreAway = asNum(prediction.score?.away);
  const score = { home: scoreHome, away: scoreAway };
  const recommendedPick = prediction.recommended?.pick || null;
  const recommendedConfidence = asNum(prediction.recommended?.confidence);
  const generatedAt = new Date().toISOString();
  const modelVer = prediction.modelVersion || MODEL_VERSION;
  const vbType = prediction.valueBet?.type ? String(prediction.valueBet.type).trim().toUpperCase() : "";
  const valueBetPick = ["1", "X", "2"].includes(vbType) ? vbType : null;
  const valueBetValidation = valueBetPick
    ? isFinalStatus(status)
      ? validationFromMatch(status, valueBetPick, score)
      : "pending"
    : null;

  const payloadWithMeta = {
    ...prediction,
    historyMeta: { generatedAt, source: "api/predict", schemaVersion: 2 },
    modelVersion: modelVer,
    value_bet_validation: valueBetValidation,
    evaluation: prediction.evaluation || null
  };

  return {
    fixture_id: prediction.id,
    league_id: asNum(prediction.leagueId),
    league_name: prediction.league || null,
    home_team: prediction.teams?.home || null,
    away_team: prediction.teams?.away || null,
    kickoff_at: kickoffAt,
    recommended_pick: recommendedPick,
    recommended_confidence: recommendedConfidence,
    odds_home: asNum(prediction.odds?.home),
    odds_draw: asNum(prediction.odds?.draw),
    odds_away: asNum(prediction.odds?.away),
    bookmaker: prediction.odds?.bookmaker || null,
    luck_hg: asNum(prediction.luckStats?.hG),
    luck_hxg: asNum(prediction.luckStats?.hXG),
    luck_ag: asNum(prediction.luckStats?.aG),
    luck_axg: asNum(prediction.luckStats?.aXG),
    match_status: status,
    score_home: scoreHome,
    score_away: scoreAway,
    validation: validationFromMatch(status, recommendedPick, score),
    value_bet_validation: valueBetValidation,
    model_version: modelVer,
    reason_codes: Array.isArray(prediction?.auditLog?.reasonCodes) ? prediction.auditLog.reasonCodes : null,
    top_features: Array.isArray(prediction?.auditLog?.topFeatures) ? prediction.auditLog.topFeatures : null,
    saved_at: generatedAt,
    updated_at: generatedAt,
    raw_payload: payloadWithMeta
  };
}

export async function insertPredictionSnapshots(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) return { count: 0 };
  const supabase = getSupabaseAdmin();
  if (!supabase) return { count: 0 };
  const now = new Date().toISOString();
  const rows = predictions.map((p) => ({
    fixture_id: Number(p.id),
    model_version: p.modelVersion || MODEL_VERSION,
    generated_at: now,
    league_id: asNum(p.leagueId),
    kickoff_at: p.kickoff || null,
    raw_payload: {
      ...p,
      snapshotAt: now
    }
  }));
  const { error } = await supabase.from(SNAPSHOTS_TABLE).insert(rows);
  if (error) {
    console.error("[prediction_snapshots]", error.message);
  }
  return { count: rows.length };
}

/**
 * Integritate predicţii: ignorăm fixture-urile al căror kickoff a trecut deja sau sunt
 * în statut live/final. Asta protejează `predictions_history.raw_payload` de a fi rescris
 * cu features post-hoc (ar introduce time-leakage în backtest).
 */
function isPreKickoff(prediction) {
  const status = String(prediction?.status || "").toUpperCase();
  if (status && !["NS", "TBD", "PST", "CANC", "SUSP", "AWD"].includes(status)) return false;
  const ko = prediction?.kickoff ? new Date(prediction.kickoff).getTime() : NaN;
  if (!Number.isFinite(ko)) return true; // fără kickoff cunoscut, permitem salvarea
  return ko > Date.now();
}

export async function upsertPredictionsHistory(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) return { count: 0, skipped: 0 };
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase client is not available.");

  const eligible = predictions.filter(isPreKickoff);
  const skipped = predictions.length - eligible.length;
  if (eligible.length === 0) return { count: 0, skipped };

  const rows = eligible.map(mapPredictionToDbRow);
  const { error } = await supabase.from(HISTORY_TABLE).upsert(rows, { onConflict: "fixture_id" });
  if (error) throw error;
  await insertPredictionSnapshots(eligible);
  return { count: rows.length, skipped };
}

export function mapDbRowToHistoryEntry(row) {
  const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  return {
    ...payload,
    id: row.fixture_id,
    leagueId: row.league_id ?? payload.leagueId,
    league: row.league_name ?? payload.league ?? "Unknown",
    teams: payload.teams || { home: row.home_team || "Home", away: row.away_team || "Away" },
    kickoff: payload.kickoff || row.kickoff_at,
    status: row.match_status || payload.status || "",
    score: { home: row.score_home, away: row.score_away },
    recommended: payload.recommended || { pick: row.recommended_pick || "", confidence: row.recommended_confidence || 0 },
    savedAt: row.saved_at,
    validation: row.validation,
    modelVersion: row.model_version ?? payload.modelVersion
  };
}

export async function readPredictionsHistory(days = 30, limit = 500) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase client is not available.");
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 120));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from(HISTORY_TABLE).select("*").gte("kickoff_at", cutoff).order("kickoff_at", { ascending: false }).limit(safeLimit);
  if (error) throw error;
  const rows = data || [];
  const items = rows.map(mapDbRowToHistoryEntry);
  const wins = rows.filter((r) => r.validation === "win").length;
  const losses = rows.filter((r) => r.validation === "loss").length;
  const settled = wins + losses;
  const winRate = settled ? (wins / settled) * 100 : 0;
  return { items, stats: { wins, losses, settled, winRate } };
}

/**
 * Win/loss aggregates for marketing / login stats without exposing predictions (only `validation` column).
 */
export async function readPredictionsHistoryAggregateStats(days = 30, limit = 500) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase client is not available.");
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 120));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select("validation")
    .gte("kickoff_at", cutoff)
    .order("kickoff_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  const rows = data || [];
  const wins = rows.filter((r) => r.validation === "win").length;
  const losses = rows.filter((r) => r.validation === "loss").length;
  const settled = wins + losses;
  const winRate = settled ? (wins / settled) * 100 : 0;
  return { stats: { wins, losses, settled, winRate } };
}

/** Rows from predictions_history joined via user_prediction_fixtures (service role RPC). */
export async function readPredictionsHistoryForUser(userId, days = 30, limit = 500) {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase client is not available.");
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 120));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const { data, error } = await supabase.rpc("predictions_history_for_user", {
    p_user_id: userId,
    p_days: safeDays,
    p_limit: safeLimit
  });
  if (error) throw error;
  const rows = data || [];
  const items = rows.map(mapDbRowToHistoryEntry);
  const wins = rows.filter((r) => r.validation === "win").length;
  const losses = rows.filter((r) => r.validation === "loss").length;
  const settled = wins + losses;
  const winRate = settled ? (wins / settled) * 100 : 0;
  return { items, stats: { wins, losses, settled, winRate } };
}
