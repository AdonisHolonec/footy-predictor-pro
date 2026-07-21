/**
 * Published tip (Stage08 recommended / pOut) extraction for CLV + walk-forward.
 */

import { evaluateTopPick } from "../predictionsHistory.js";
import { selectionClosingOdd } from "./BacktestAnalytics.js";
import { computeClvPct } from "./ClvReport.js";
import { logLossBinary, brierBinary } from "../probabilityMetrics.js";

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n > 1.5 ? n / 100 : n));
}

/** Map tip label → probability from pOut / probs. */
export function tipProbabilityFromProbs(pick, probs = {}) {
  const p = String(pick || "").trim().toLowerCase();
  if (!p) return null;
  if (p === "1") return clamp01(probs.p1);
  if (p === "x") return clamp01(probs.pX);
  if (p === "2") return clamp01(probs.p2);
  if (p === "gg") return clamp01(probs.pGG);
  if (p === "ngg") return clamp01(probs.pNGG ?? (Number.isFinite(Number(probs.pGG)) ? 100 - Number(probs.pGG) : null));
  if (p === "1x") return clamp01(probs.pDC1X ?? (Number(probs.p1) || 0) + (Number(probs.pX) || 0));
  if (p === "12") return clamp01(probs.pDC12 ?? (Number(probs.p1) || 0) + (Number(probs.p2) || 0));
  if (p === "x2") return clamp01(probs.pDCX2 ?? (Number(probs.pX) || 0) + (Number(probs.p2) || 0));

  const over = p.match(/^(?:peste|over)\s*(1[.,]5|2[.,]5|3[.,]5)$/);
  if (over) {
    const line = over[1].replace(",", ".");
    if (line === "1.5") return clamp01(probs.pO15);
    if (line === "2.5") return clamp01(probs.pO25);
    if (line === "3.5") return clamp01(probs.pO35 ?? (Number.isFinite(Number(probs.pU35)) ? 100 - Number(probs.pU35) : null));
  }
  const under = p.match(/^(?:sub|under)\s*(1[.,]5|2[.,]5|3[.,]5)$/);
  if (under) {
    const line = under[1].replace(",", ".");
    if (line === "1.5") return clamp01(probs.pU15 ?? (Number.isFinite(Number(probs.pO15)) ? 100 - Number(probs.pO15) : null));
    if (line === "2.5") return clamp01(probs.pU25 ?? (Number.isFinite(Number(probs.pO25)) ? 100 - Number(probs.pO25) : null));
    if (line === "3.5") return clamp01(probs.pU35);
  }
  return null;
}

/**
 * Resolve the Stage08 published tip from a predictions_history row.
 * @returns {object|null}
 */
export function resolvePublishedTip(row) {
  if (!row) return null;
  const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const pick = String(row.recommended_pick || payload.recommended?.pick || "").trim();
  if (!pick) return null;

  const odd =
    Number(row.recommended_odd) ||
    Number(payload.recommended?.odd) ||
    null;
  const confidence = Number(
    row.recommended_confidence ?? payload.recommended?.confidence ?? payload.confidence
  );
  const probs = payload.probs && typeof payload.probs === "object" ? payload.probs : {};
  let prob = tipProbabilityFromProbs(pick, probs);
  if (prob == null && Number.isFinite(confidence)) prob = clamp01(confidence);

  const score =
    row.score_home != null && row.score_away != null
      ? { home: row.score_home, away: row.score_away }
      : payload.score || null;

  let won = null;
  if (row.validation === "win") won = true;
  else if (row.validation === "loss") won = false;
  else if (score) {
    const hit = evaluateTopPick(pick, score);
    if (hit === true) won = true;
    else if (hit === false) won = false;
  }

  const closingOdd = selectionClosingOdd(payload, row, pick);
  const clvPct = computeClvPct(odd, closingOdd);
  const y = won === true ? 1 : won === false ? 0 : null;

  return {
    pick,
    market: tipMarketFamily(pick),
    odd: Number.isFinite(odd) && odd > 1 ? odd : null,
    closingOdd,
    clvPct,
    confidence: Number.isFinite(confidence) ? confidence : null,
    prob,
    won,
    y,
    logLoss: y != null && prob != null ? logLossBinary(prob, y) : null,
    brier: y != null && prob != null ? brierBinary(prob, y) : null,
    unitReturn:
      won === true && Number.isFinite(odd) && odd > 1
        ? odd - 1
        : won === false
          ? -1
          : null,
    leagueId: row.league_id ?? null,
    modelVersion: row.model_version ?? payload.modelMeta?.modelVersion ?? null,
    kickoffAt: row.kickoff_at || payload.kickoffAt || null,
    fixtureId: row.fixture_id ?? null,
    settled: won != null
  };
}

export function tipMarketFamily(pick) {
  const p = String(pick || "").trim().toLowerCase();
  if (p === "1" || p === "x" || p === "2") return "1x2";
  if (p === "gg" || p === "ngg") return "btts";
  if (p === "1x" || p === "12" || p === "x2") return "dc";
  if (/^(?:peste|over|sub|under)\s*/.test(p)) return "ou";
  return "other";
}

/** Build tip events from history rows (drops unresolved). */
export function extractTipEvents(rows, { requireSettled = true } = {}) {
  const out = [];
  for (const row of rows || []) {
    const tip = resolvePublishedTip(row);
    if (!tip) continue;
    if (requireSettled && !tip.settled) continue;
    out.push(tip);
  }
  return out;
}
