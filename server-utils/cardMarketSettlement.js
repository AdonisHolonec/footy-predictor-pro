/**
 * Card market picks (recommended / goals / corners / shots) for history settlement
 * and success-rate counters. Mirrors src/utils/marketPicks.ts derivation.
 *
 * Kept separate from predictionsHistory.js to avoid circular imports; duplicates
 * only the small grade helpers needed here.
 */

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
  return `${side} ${Number(line).toFixed(1)}`;
}

/** Evaluate over/under vs an observed total (corners, shots, goals). */
export function evaluateOuLine(side, line, actualTotal) {
  const total = Number(actualTotal);
  const thr = Number(line);
  if (!Number.isFinite(total) || !Number.isFinite(thr)) return null;
  if (side === "over") return total > thr;
  if (side === "under") return total < thr;
  return null;
}

export function validationFromOu(status, side, line, actualTotal) {
  if (!isFinalStatus(status)) return "pending";
  const hit = evaluateOuLine(side, line, actualTotal);
  if (hit === null) return "pending";
  return hit ? "win" : "loss";
}

/**
 * Derive card market picks from a prediction / raw_payload row.
 * Locked markets (missing probs) are omitted (null) and do not count.
 */
export function deriveCardMarketPicks(prediction) {
  const row = prediction && typeof prediction === "object" ? prediction : {};
  const recommendedPick = String(row.recommended?.pick || "").trim() || null;

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

  const cornersBest = row.probs?.corners ? deriveBestOverUnderPick(row.probs.corners.total) : null;
  const corners = cornersBest
    ? {
        pick: ouPickLabel(cornersBest.side, cornersBest.line),
        side: cornersBest.side,
        line: cornersBest.line,
        probability: cornersBest.probability
      }
    : null;

  const shotsBest = row.probs?.shotsOnTarget
    ? deriveBestOverUnderPick(row.probs.shotsOnTarget.total)
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
    recommended: recommendedPick ? { pick: recommendedPick } : null,
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
 * @param {{ cornersTotal?: number|null, shotsOnTargetTotal?: number|null }} [opts.marketTotals]
 */
export function settleCardMarkets({ status, score, picks, marketTotals = {} }) {
  const out = {
    recommended: null,
    goals: null,
    corners: null,
    shots: null
  };

  if (picks?.recommended?.pick) {
    out.recommended = validationFromMatch(status, picks.recommended.pick, score);
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
      marketTotals?.shotsOnTargetTotal ?? base.marketResults?.shotsOnTargetTotal ?? null
  };
  const validations = settleCardMarkets({ status: st, score: sc, picks, marketTotals: totals });
  base.cardMarkets = picks;
  base.cardMarketValidations = validations;
  if (totals.cornersTotal != null || totals.shotsOnTargetTotal != null) {
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
      (picks.recommended ? validationFromMatch(status, picks.recommended.pick, score) : null);
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
