/**
 * Card market picks (recommended / goals / corners / shots) for history settlement
 * and success-rate counters. Mirrors src/utils/marketPicks.ts derivation.
 *
 * Kept separate from predictionsHistory.js to avoid circular imports; duplicates
 * only the small grade helpers needed here. marketIdentity.js is a leaf module
 * (no imports), so pulling the lossless line formatter from it stays cycle-free.
 */

import { formatLineLabel } from "./marketIdentity.js";
import { settleOuAsian } from "./asianTotals.js";

const FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);
const MARKET_KEYS = ["recommended", "goals", "corners", "shots"];

function isFinalStatus(status) {
  return FINAL_STATUSES.has(String(status || "").toUpperCase());
}

function normalizePick(pick) {
  return String(pick || "").trim().toLowerCase();
}

function evaluateTopPick(pick, score) {
  if (!pick || !score) return null;
  if (score.home === null || score.away === null) return null;
  const home = Number(score.home);
  const away = Number(score.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const total = home + away;
  const normalized = normalizePick(pick);
  if (normalized === "1") return home > away;
  if (normalized === "2") return away > home;
  if (normalized === "x") return home === away;
  if (normalized === "1x") return home >= away;
  if (normalized === "12") return home !== away;
  if (normalized === "x2") return away >= home;
  if (normalized === "gg") return home > 0 && away > 0;
  if (normalized === "ngg") return home === 0 || away === 0;
  const overMatch = normalized.match(/^(?:peste|over)\s*(\d+(?:[.,]\d+)?)/);
  if (overMatch) return total > Number(overMatch[1].replace(",", "."));
  const underMatch = normalized.match(/^(?:sub|under)\s*(\d+(?:[.,]\d+)?)/);
  if (underMatch) return total < Number(underMatch[1].replace(",", "."));
  return null;
}

function validationFromMatch(status, pick, score) {
  if (!isFinalStatus(status)) return "pending";
  const result = evaluateTopPick(pick, score);
  if (result === null) return "pending";
  return result ? "win" : "loss";
}

// Goals Over/Under lines this codebase ever offers as a recommendation (buildValueCandidates
// only ever builds 1.5/2.5/3.5 goals lines). Any other O/U-shaped line can only be Corners —
// Cards has no settlement totals tracked yet.
const GOALS_OU_LINES = new Set([1.5, 2.5, 3.5]);

/**
 * Market-aware grading for a `recommended` pick — the fix for the P0 settlement bug: a
 * Corners pick like "Over 7.5" is string-identical in shape to a goals pick and was being
 * silently graded against goals scored instead of corners won.
 *
 * Prefers the explicit `family` persisted on the row (recommended.family, added alongside
 * this fix) when present. Falls back to a deterministic line check for older rows that
 * predate it: a goals-shaped line is always exactly 1.5/2.5/3.5 in this codebase, so any
 * other O/U line can only be Corners.
 *
 * @param {{ pick: string, family?: string|null, status: string,
 *   score: { home: number|null, away: number|null },
 *   marketTotals?: { cornersTotal?: number|null } }} params
 * @returns {"win"|"loss"|"pending"|"push"|"half_win"|"half_loss"} Asian
 *   outcomes appear only on totals families (Corners / Shots / SOT) at
 *   integer/quarter lines; 1X2-shaped picks keep the win/loss/pending set.
 */
export function resolveRecommendedValidation({ pick, family, status, score, marketTotals }) {
  if (!isFinalStatus(status)) return "pending";
  if (family === "Cards") return "pending"; // no cards totals tracked yet

  // Total shots grades against the match's combined shot count. Like SOT below, it must
  // never fall through to the goals path: "Shots Over 22.5" graded against goals scored
  // would settle as a loss on essentially every fixture. Absent data stays pending —
  // a missing total is not zero.
  if (family === "Shots") {
    const shotsOu = parseOuPickAnywhere(pick);
    if (!shotsOu) return "pending";
    const shotsTotal = marketTotals?.shotsTotal;
    if (shotsTotal == null) return "pending";
    return settleOuValidation(shotsOu.side, shotsOu.line, shotsTotal) ?? "pending";
  }

  // Shots on target does have a tracked total, so it grades against that — never goals.
  // Its label is prefixed ("SOT Over 8.5"), which the ^-anchored goals parser
  // deliberately rejects, so side/line are read with the prefix-tolerant parser.
  if (family === "Shots on Target") {
    const sotOu = parseOuPickAnywhere(pick);
    if (!sotOu) return "pending";
    const sotTotal = marketTotals?.shotsOnTargetTotal;
    if (sotTotal == null) return "pending";
    return settleOuValidation(sotOu.side, sotOu.line, sotTotal) ?? "pending";
  }

  const ou = parseGoalsOuPick(pick);

  const isCorners = family === "Corners" || (!family && ou != null && !GOALS_OU_LINES.has(ou.line));

  if (isCorners) {
    if (!ou) return "pending";
    const total = marketTotals?.cornersTotal;
    if (total == null) return "pending";
    return settleOuValidation(ou.side, ou.line, total) ?? "pending";
  }

  return validationFromMatch(status, pick, score);
}

function parseLineThreshold(key) {
  const m = String(key || "").match(/^o(\d+)_(\d+)$/);
  if (!m) return null;
  return Number(`${m[1]}.${m[2]}`);
}

function deriveBestOverUnderPick(totalLines) {
  if (!totalLines || typeof totalLines !== "object") return null;
  let best = null;
  for (const [key, raw] of Object.entries(totalLines)) {
    const line = parseLineThreshold(key);
    const pOver = Number(raw);
    if (line == null || !Number.isFinite(pOver)) continue;
    const over = { line, side: "over", probability: pOver };
    const under = { line, side: "under", probability: 100 - pOver };
    const current = over.probability >= under.probability ? over : under;
    if (!best || current.probability > best.probability) best = current;
  }
  return best;
}

/** Snap model O/U pick to book line when a usable quote is within maxLineDelta. */
function deriveAlignedOuPick(totalLines, quote, maxLineDelta = 1.5) {
  const best = deriveBestOverUnderPick(totalLines);
  if (!best) return null;
  const odd = Number(quote?.odd);
  const qLine = Number(quote?.line);
  if (!Number.isFinite(odd) || odd <= 1 || !Number.isFinite(qLine)) return best;
  if (Math.abs(qLine - best.line) > maxLineDelta + 1e-9) return best;
  const qPick = String(quote?.pick || "").toLowerCase();
  const side = qPick.includes("under") ? "under" : qPick.includes("over") ? "over" : best.side;
  const [a, b] = Number(qLine).toFixed(1).split(".");
  const pOver = Number(totalLines?.[`o${a}_${b}`]);
  if (Number.isFinite(pOver)) {
    return { line: qLine, side, probability: side === "over" ? pOver : 100 - pOver };
  }
  return { line: qLine, side, probability: best.probability };
}

/**
 * Side/line from a prefixed Over/Under label ("SOT Over 8.5", "Shots Under 22.5").
 * Deliberately separate from parseGoalsOuPick, whose `^` anchor is what stops a prefixed
 * label being mistaken for a goals pick — only callers that already know the market from
 * `family` may use this looser parse.
 */
function parseOuPickAnywhere(pick) {
  const m = String(pick || "")
    .trim()
    .toLowerCase()
    .match(/\b(peste|over|sub|under)\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const line = Number(m[2].replace(",", "."));
  if (!Number.isFinite(line)) return null;
  return { side: m[1] === "peste" || m[1] === "over" ? "over" : "under", line };
}

function parseGoalsOuPick(pick) {
  const n = String(pick || "").trim().toLowerCase();
  if (!n) return null;
  const over = n.match(/^(?:peste|over)\s*(\d+(?:[.,]\d+)?)/);
  if (over) {
    const line = Number(over[1].replace(",", "."));
    return Number.isFinite(line) ? { side: "over", line } : null;
  }
  const under = n.match(/^(?:sub|under)\s*(\d+(?:[.,]\d+)?)/);
  if (under) {
    const line = Number(under[1].replace(",", "."));
    return Number.isFinite(line) ? { side: "under", line } : null;
  }
  return null;
}

function deriveBestGoalsPick(row, exclude = null) {
  const p = row?.probs;
  if (!p) return null;
  const candidates = [
    { line: 1.5, side: "over", probability: Number(p.pO15) },
    { line: 1.5, side: "under", probability: Number(p.pU15 ?? 100 - Number(p.pO15)) },
    { line: 2.5, side: "over", probability: Number(p.pO25) },
    { line: 2.5, side: "under", probability: Number(p.pU25 ?? 100 - Number(p.pO25)) },
    {
      line: 3.5,
      side: "over",
      probability: Number.isFinite(Number(p.pU35)) ? 100 - Number(p.pU35) : NaN
    },
    { line: 3.5, side: "under", probability: Number(p.pU35) }
  ]
    .filter((c) => Number.isFinite(c.probability) && c.probability > 0)
    .filter((c) => {
      if (!exclude) return true;
      return !(c.side === exclude.side && Math.abs(c.line - exclude.line) < 1e-6);
    })
    .sort((a, b) => b.probability - a.probability);

  return candidates[0] || null;
}

function ouPickLabel(side, line) {
  // Lossless: 10.25 stays "10.25" (toFixed(1) rendered the nonexistent "10.3").
  return `${side} ${formatLineLabel(line)}`;
}

/**
 * Settle over/under vs an observed total (corners, shots, goals) with full
 * Asian semantics — THE single O/U outcome evaluator (asianTotals.js) applied
 * behind the same absent-total guard every settlement path shares.
 *
 * Returns null when the observed total is UNKNOWN, so callers can hold the
 * market pending instead of grading it.
 *
 * The absent check has to happen before Number(): `Number(null)` and
 * `Number("")` are both 0, so a fixture whose corners statistic never arrived
 * used to be graded as if it had finished with zero corners — turning "Over 7.5"
 * into a confident LOSS built from data that does not exist. A real zero is
 * still a real result and settles normally; the distinction is between "no
 * corners" and "no answer".
 *
 * @returns {"win"|"loss"|"push"|"half_win"|"half_loss"|null}
 */
export function settleOuValidation(side, line, actualTotal) {
  if (actualTotal === null || actualTotal === undefined || actualTotal === "") return null;
  const total = Number(actualTotal);
  const thr = Number(line);
  if (!Number.isFinite(total) || !Number.isFinite(thr)) return null;
  return settleOuAsian(side, thr, total);
}

/**
 * Legacy boolean view of settleOuValidation, kept for consumers that can only
 * express win/loss (backtest validation). Push and half outcomes return null —
 * "not a boolean answer" — instead of being coerced into a loss, which was the
 * pre-Asian bug on integer lines. Half lines behave exactly as before.
 */
export function evaluateOuLine(side, line, actualTotal) {
  const outcome = settleOuValidation(side, line, actualTotal);
  if (outcome === "win") return true;
  if (outcome === "loss") return false;
  return null;
}

/** @returns {"pending"|"win"|"loss"|"push"|"half_win"|"half_loss"} */
export function validationFromOu(status, side, line, actualTotal) {
  if (!isFinalStatus(status)) return "pending";
  const outcome = settleOuValidation(side, line, actualTotal);
  return outcome ?? "pending";
}

/**
 * Derive card market picks from a prediction / raw_payload row.
 * Locked markets (missing probs) are omitted (null) and do not count.
 */
export function deriveCardMarketPicks(prediction) {
  const row = prediction && typeof prediction === "object" ? prediction : {};
  const recommendedPick = String(row.recommended?.pick || "").trim() || null;
  const recommendedFamily = row.recommended?.family || null;

  // If recommended is already goals O/U, card goals row uses the next-best line.
  const goalsBest = deriveBestGoalsPick(row, parseGoalsOuPick(recommendedPick));
  const goals = goalsBest
    ? {
        pick: ouPickLabel(goalsBest.side, goalsBest.line),
        side: goalsBest.side,
        line: goalsBest.line,
        probability: goalsBest.probability
      }
    : null;

  const cornersBest = row.probs?.corners
    ? deriveAlignedOuPick(row.probs.corners.total, row.marketOdds?.corners)
    : null;
  const corners = cornersBest
    ? {
        pick: ouPickLabel(cornersBest.side, cornersBest.line),
        side: cornersBest.side,
        line: cornersBest.line,
        probability: cornersBest.probability
      }
    : null;

  const shotsBest = row.probs?.shotsOnTarget
    ? deriveAlignedOuPick(row.probs.shotsOnTarget.total, row.marketOdds?.shotsOnTarget)
    : null;
  const shots = shotsBest
    ? {
        pick: ouPickLabel(shotsBest.side, shotsBest.line),
        side: shotsBest.side,
        line: shotsBest.line,
        probability: shotsBest.probability
      }
    : null;

  return {
    recommended: recommendedPick ? { pick: recommendedPick, family: recommendedFamily } : null,
    goals,
    corners,
    shots
  };
}

/**
 * @param {object} opts
 * @param {string} opts.status
 * @param {{ home: number|null, away: number|null }} opts.score
 * @param {ReturnType<typeof deriveCardMarketPicks>} opts.picks
 * @param {{ cornersTotal?: number|null, shotsOnTargetTotal?: number|null,
 *   shotsTotal?: number|null, cardsTotal?: number|null, cardsPoints?: number|null }}
 *   [opts.marketTotals] cardsTotal/cardsPoints are carried for persistence only — no
 *   market grades against them yet (Cards short-circuits to "pending" above).
 */
export function settleCardMarkets({ status, score, picks, marketTotals = {} }) {
  const out = {
    recommended: null,
    goals: null,
    corners: null,
    shots: null
  };

  if (picks?.recommended?.pick) {
    out.recommended = resolveRecommendedValidation({
      pick: picks.recommended.pick,
      family: picks.recommended.family,
      status,
      score,
      marketTotals
    });
  }

  if (picks?.goals?.side && picks.goals.line != null) {
    const goalsTotal =
      score?.home != null && score?.away != null ? Number(score.home) + Number(score.away) : null;
    out.goals = validationFromOu(status, picks.goals.side, picks.goals.line, goalsTotal);
  }

  if (picks?.corners?.side && picks.corners.line != null) {
    out.corners = validationFromOu(
      status,
      picks.corners.side,
      picks.corners.line,
      marketTotals.cornersTotal
    );
  }

  if (picks?.shots?.side && picks.shots.line != null) {
    out.shots = validationFromOu(
      status,
      picks.shots.side,
      picks.shots.line,
      marketTotals.shotsOnTargetTotal
    );
  }

  return out;
}

/** Attach picks + validations onto a prediction payload (mutates copy). */
export function attachCardMarketsToPayload(prediction, { status, score, marketTotals } = {}) {
  const base = prediction && typeof prediction === "object" ? { ...prediction } : {};
  const existingPicks =
    base.cardMarkets && typeof base.cardMarkets === "object" ? base.cardMarkets : null;
  const picks = existingPicks || deriveCardMarketPicks(base);
  const st = status ?? base.status;
  const sc = score ?? {
    home: base.score?.home ?? null,
    away: base.score?.away ?? null
  };
  const totals = {
    cornersTotal: marketTotals?.cornersTotal ?? base.marketResults?.cornersTotal ?? null,
    shotsOnTargetTotal:
      marketTotals?.shotsOnTargetTotal ?? base.marketResults?.shotsOnTargetTotal ?? null,
    // Combined match shots — settles a Recommended from the Shots family. Distinct from
    // shotsOnTargetTotal: the two markets are graded against their own totals.
    shotsTotal: marketTotals?.shotsTotal ?? base.marketResults?.shotsTotal ?? null,
    // Observed card totals. RECORDED, NOT GRADED AGAINST: resolveRecommendedValidation
    // still returns "pending" for the Cards family and SETTLEABLE_VALUE_FAMILIES.Cards
    // stays false, so no selection's outcome depends on these yet. They are captured now
    // because the observed total is the prerequisite for the settlement, the rolling
    // averages and the backtest that come later — and it is only readable from the
    // statistics payload, which is cheapest to take while it is already in hand.
    cardsTotal: marketTotals?.cardsTotal ?? base.marketResults?.cardsTotal ?? null,
    cardsPoints: marketTotals?.cardsPoints ?? base.marketResults?.cardsPoints ?? null,
    firstHalfGoals: marketTotals?.firstHalfGoals ?? base.marketResults?.firstHalfGoals ?? null
  };
  const validations = settleCardMarkets({ status: st, score: sc, picks, marketTotals: totals });
  base.cardMarkets = picks;
  base.cardMarketValidations = validations;
  if (
    totals.cornersTotal != null ||
    totals.shotsOnTargetTotal != null ||
    totals.shotsTotal != null ||
    totals.cardsTotal != null ||
    totals.cardsPoints != null ||
    totals.firstHalfGoals != null
  ) {
    base.marketResults = {
      ...(base.marketResults && typeof base.marketResults === "object" ? base.marketResults : {}),
      ...totals
    };
  }
  return base;
}

export function listCardMarketOutcomes(validations) {
  if (!validations || typeof validations !== "object") return [];
  return MARKET_KEYS.map((k) => validations[k]).filter(
    (v) => v === "win" || v === "loss" || v === "pending"
  );
}

export function tallyCardMarketValidations(validations) {
  let wins = 0;
  let losses = 0;
  let pending = 0;
  for (const v of listCardMarketOutcomes(validations)) {
    if (v === "win") wins += 1;
    else if (v === "loss") losses += 1;
    else if (v === "pending") pending += 1;
  }
  return { wins, losses, pending };
}

/**
 * Resolve validations for a DB history row or HistoryEntry-like object.
 * Prefers stored cardMarketValidations; otherwise derives + settles from payload.
 */
export function resolveCardMarketValidations(rowOrEntry) {
  const payload =
    rowOrEntry?.raw_payload && typeof rowOrEntry.raw_payload === "object"
      ? rowOrEntry.raw_payload
      : rowOrEntry && typeof rowOrEntry === "object"
        ? rowOrEntry
        : {};

  const status = rowOrEntry?.match_status || rowOrEntry?.status || payload.status || "";
  const score = {
    home:
      rowOrEntry?.score_home != null
        ? rowOrEntry.score_home
        : rowOrEntry?.score?.home != null
          ? rowOrEntry.score.home
          : payload.score?.home ?? null,
    away:
      rowOrEntry?.score_away != null
        ? rowOrEntry.score_away
        : rowOrEntry?.score?.away != null
          ? rowOrEntry.score.away
          : payload.score?.away ?? null
  };

  const stored = payload.cardMarketValidations;
  const hasStored =
    stored &&
    typeof stored === "object" &&
    MARKET_KEYS.some((k) => stored[k] === "win" || stored[k] === "loss" || stored[k] === "pending");

  if (hasStored) {
    // Re-settle markets still pending when the match is final / totals arrive.
    const picks = payload.cardMarkets || deriveCardMarketPicks(payload);
    const totals = {
      cornersTotal: payload.marketResults?.cornersTotal ?? null,
      shotsOnTargetTotal: payload.marketResults?.shotsOnTargetTotal ?? null
    };
    const fresh = settleCardMarkets({ status, score, picks, marketTotals: totals });
    const keepOrFresh = (prev, next) =>
      prev === "win" || prev === "loss" ? prev : next ?? prev ?? null;
    return {
      recommended: keepOrFresh(stored.recommended, fresh.recommended),
      goals: keepOrFresh(stored.goals, fresh.goals),
      corners: keepOrFresh(stored.corners, fresh.corners),
      shots: keepOrFresh(stored.shots, fresh.shots)
    };
  }

  // Legacy rows: at least count recommended via column/payload validation.
  const picks = deriveCardMarketPicks({
    ...payload,
    recommended: payload.recommended || {
      pick: rowOrEntry?.recommended_pick || payload.recommended?.pick || ""
    }
  });
  const totals = {
    cornersTotal: payload.marketResults?.cornersTotal ?? null,
    shotsOnTargetTotal: payload.marketResults?.shotsOnTargetTotal ?? null
  };
  const settled = settleCardMarkets({ status, score, picks, marketTotals: totals });

  // If we couldn't derive goals/corners/shots, fall back to single recommended validation.
  if (!picks.goals && !picks.corners && !picks.shots) {
    const legacy =
      rowOrEntry?.validation ||
      payload.validation ||
      (picks.recommended
        ? resolveRecommendedValidation({
            pick: picks.recommended.pick,
            family: picks.recommended.family,
            status,
            score,
            marketTotals: totals
          })
        : null);
    if (legacy === "win" || legacy === "loss" || legacy === "pending") {
      return { recommended: legacy, goals: null, corners: null, shots: null };
    }
  }

  return settled;
}

/** Aggregate wins/losses across card markets for a list of history DB rows or entries. */
export function aggregateCardMarketStats(rows) {
  let wins = 0;
  let losses = 0;
  for (const row of rows || []) {
    const vals = resolveCardMarketValidations(row);
    const t = tallyCardMarketValidations(vals);
    wins += t.wins;
    losses += t.losses;
  }
  const settled = wins + losses;
  const winRate = settled ? (wins / settled) * 100 : 0;
  return { wins, losses, settled, winRate };
}

/** True when corners/shots still need fixture statistics to grade. */
export function needsMarketTotalsForSettlement(validations, picks) {
  if (!picks) return false;
  if (picks.corners && (validations?.corners === "pending" || validations?.corners == null)) {
    return true;
  }
  if (picks.shots && (validations?.shots === "pending" || validations?.shots == null)) {
    return true;
  }
  return false;
}
