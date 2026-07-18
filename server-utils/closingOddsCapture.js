/**
 * Capture near-kickoff consensus odds into predictions_history for CLV.
 * Writes closing_odds_* columns + raw_payload.closingOdds; never mutates opening odds_*.
 */

import { evaluateApiBudget } from "./apiBudgetCircuit.js";
import {
  consensusBttsOdds,
  consensusDoubleChanceOdds,
  consensusMatchWinnerOdds,
  consensusOverUnderOddsAtLine
} from "./marketOdds.js";
import { getOddsForFixture } from "./oddsPrefetch.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const HISTORY_TABLE = "predictions_history";
const CANCELLED = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

function asOdd(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 1 ? Number(x.toFixed(3)) : null;
}

function lineKey(prefix, line) {
  const s = String(line).replace(",", ".");
  return `${prefix}${s.replace(".", "")}`;
}

/**
 * Build a closingOdds blob from one /odds response (1X2 + DC + BTTS + O/U 1.5/2.5/3.5).
 */
export function buildClosingOddsBlob(oddsApiResponse, capturedAt = new Date().toISOString()) {
  const mw = consensusMatchWinnerOdds(oddsApiResponse);
  if (!mw) return null;

  const btts = consensusBttsOdds(oddsApiResponse);
  const dc = consensusDoubleChanceOdds(oddsApiResponse);
  const ou15 = consensusOverUnderOddsAtLine(oddsApiResponse, ["Goals Over/Under"], 1.5);
  const ou25 = consensusOverUnderOddsAtLine(oddsApiResponse, ["Goals Over/Under"], 2.5);
  const ou35 = consensusOverUnderOddsAtLine(oddsApiResponse, ["Goals Over/Under"], 3.5);

  const blob = {
    home: asOdd(mw.home),
    draw: asOdd(mw.draw),
    away: asOdd(mw.away),
    bookmakersUsed: mw.bookmakersUsed || 0,
    capturedAt,
    source: "api-football/odds"
  };

  if (btts?.yes) blob.gg = asOdd(btts.yes);
  if (btts?.no) blob.ngg = asOdd(btts.no);
  if (dc?.homeDraw) blob.dc1x = asOdd(dc.homeDraw);
  if (dc?.homeAway) blob.dc12 = asOdd(dc.homeAway);
  if (dc?.drawAway) blob.dcx2 = asOdd(dc.drawAway);
  if (ou15?.over) blob[lineKey("over", 1.5)] = asOdd(ou15.over);
  if (ou15?.under) blob[lineKey("under", 1.5)] = asOdd(ou15.under);
  if (ou25?.over) blob[lineKey("over", 2.5)] = asOdd(ou25.over);
  if (ou25?.under) blob[lineKey("under", 2.5)] = asOdd(ou25.under);
  if (ou35?.over) blob[lineKey("over", 3.5)] = asOdd(ou35.over);
  if (ou35?.under) blob[lineKey("under", 3.5)] = asOdd(ou35.under);

  if (!blob.home || !blob.draw || !blob.away) return null;
  return blob;
}

function alreadyCaptured(row) {
  if (row.closing_odds_captured_at) return true;
  const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const c = payload.closingOdds || payload.oddsClosing;
  return Boolean(c && (c.home || c.capturedAt));
}

/**
 * @param {object} options
 * @param {number} [options.hoursBefore=3] — capture window before kickoff
 * @param {number} [options.hoursAfter=2] — allow shortly after kickoff (still useful close)
 * @param {number} [options.limit=40] — max fixtures / upstream odds calls
 * @param {number} [options.ttlSeconds=120] — short TTL so warm-day cache is not reused
 */
export async function captureClosingOdds(options = {}) {
  const hoursBefore = Math.max(0.25, Math.min(Number(options.hoursBefore ?? options.hours ?? 3), 12));
  const hoursAfter = Math.max(0, Math.min(Number(options.hoursAfter ?? 2), 6));
  const limit = Math.max(1, Math.min(Number(options.limit || 40), 80));
  const ttlSeconds = Math.max(60, Math.min(Number(options.ttlSeconds || 120), 600));

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false, error: "Supabase unavailable", scanned: 0, updated: 0, skipped: 0, upstreamCalls: 0 };
  }

  const budget = await evaluateApiBudget().catch(() => null);
  if (budget?.hardStop) {
    return {
      ok: true,
      skippedBudget: true,
      mode: budget.mode,
      scanned: 0,
      updated: 0,
      skipped: 0,
      upstreamCalls: 0
    };
  }

  const now = Date.now();
  const fromIso = new Date(now - hoursAfter * 3600 * 1000).toISOString();
  const toIso = new Date(now + hoursBefore * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from(HISTORY_TABLE)
    .select(
      "fixture_id, kickoff_at, match_status, closing_odds_captured_at, closing_odds_home, raw_payload"
    )
    .gte("kickoff_at", fromIso)
    .lte("kickoff_at", toIso)
    .order("kickoff_at", { ascending: true })
    .limit(Math.min(limit * 3, 200));

  if (error) {
    return { ok: false, error: error.message, scanned: 0, updated: 0, skipped: 0, upstreamCalls: 0 };
  }

  const candidates = (rows || []).filter((row) => {
    if (alreadyCaptured(row)) return false;
    const st = String(row.match_status || "").toUpperCase();
    if (CANCELLED.has(st)) return false;
    return true;
  }).slice(0, limit);

  let updated = 0;
  let skipped = (rows || []).length - candidates.length;
  let upstreamCalls = 0;
  const capturedAt = new Date().toISOString();

  for (const row of candidates) {
    const fixtureId = Number(row.fixture_id);
    if (!Number.isFinite(fixtureId)) {
      skipped += 1;
      continue;
    }

    const oddsReq = await getOddsForFixture(fixtureId, null, ttlSeconds);
    if (!oddsReq.fromCache && !oddsReq.fromBatch) upstreamCalls += 1;
    if (!oddsReq.ok) {
      skipped += 1;
      continue;
    }

    const blob = buildClosingOddsBlob(oddsReq.data, capturedAt);
    if (!blob) {
      skipped += 1;
      continue;
    }

    const prev = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
    const nextPayload = {
      ...prev,
      closingOdds: blob,
      oddsClosing: { home: blob.home, draw: blob.draw, away: blob.away, capturedAt }
    };

    const { error: upErr } = await supabase
      .from(HISTORY_TABLE)
      .update({
        closing_odds_home: blob.home,
        closing_odds_draw: blob.draw,
        closing_odds_away: blob.away,
        closing_odds_captured_at: capturedAt,
        raw_payload: nextPayload,
        updated_at: capturedAt
      })
      .eq("fixture_id", fixtureId);

    if (upErr) {
      skipped += 1;
      continue;
    }
    updated += 1;
  }

  return {
    ok: true,
    scanned: (rows || []).length,
    candidates: candidates.length,
    updated,
    skipped,
    upstreamCalls,
    window: { from: fromIso, to: toIso, hoursBefore, hoursAfter }
  };
}
