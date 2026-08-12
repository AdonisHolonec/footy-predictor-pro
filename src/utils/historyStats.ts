import type { DayAccuracyRow, HistoryEntry, HistoryStats, MarketBreakdownRow, SettlementOutcome } from "../types";
import { kickoffLocalDateKey } from "./appUtils";

const MARKET_KEYS = ["recommended", "goals", "corners", "shots"] as const;

const KNOWN_OUTCOMES = new Set<SettlementOutcome>([
  "pending",
  "win",
  "loss",
  "push",
  "half_win",
  "half_loss"
]);

function isKnownOutcome(v: unknown): v is SettlementOutcome {
  return typeof v === "string" && KNOWN_OUTCOMES.has(v as SettlementOutcome);
}

/** Per-fixture market outcomes for the success-rate counter (card rows). */
export function listCardMarketOutcomes(entry: HistoryEntry): SettlementOutcome[] {
  const stored = entry.cardMarketValidations;
  if (stored && typeof stored === "object") {
    const out: SettlementOutcome[] = [];
    for (const key of MARKET_KEYS) {
      const v = stored[key];
      if (isKnownOutcome(v)) out.push(v);
    }
    if (out.length) return out;
  }
  // Legacy: one outcome per fixture from recommended validation.
  if (isKnownOutcome(entry.validation)) {
    return [entry.validation];
  }
  return [];
}

/**
 * Asian outcomes stay SEPARATE counters (product decision, Increment B):
 * pushes are stake-returned and never enter the win/loss denominators; half
 * results are neither full wins nor full losses and are reported on their own.
 */
export function tallyEntryCardMarkets(entry: HistoryEntry): {
  wins: number;
  losses: number;
  pushes: number;
  halfWins: number;
  halfLosses: number;
  pending: number;
} {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let halfWins = 0;
  let halfLosses = 0;
  let pending = 0;
  for (const v of listCardMarketOutcomes(entry)) {
    if (v === "win") wins += 1;
    else if (v === "loss") losses += 1;
    else if (v === "push") pushes += 1;
    else if (v === "half_win") halfWins += 1;
    else if (v === "half_loss") halfLosses += 1;
    else pending += 1;
  }
  return { wins, losses, pushes, halfWins, halfLosses, pending };
}

export function historyStatsFromRows(rows: HistoryEntry[]): HistoryStats {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let halfWins = 0;
  let halfLosses = 0;
  for (const row of rows || []) {
    const t = tallyEntryCardMarkets(row);
    wins += t.wins;
    losses += t.losses;
    pushes += t.pushes;
    halfWins += t.halfWins;
    halfLosses += t.halfLosses;
  }
  // Main rate: FULL wins over FULL results only. Push / half outcomes are
  // reported alongside, never blended in.
  const settled = wins + losses;
  return {
    wins,
    losses,
    settled,
    winRate: settled ? (wins / settled) * 100 : 0,
    pushes,
    halfWins,
    halfLosses
  };
}

/** Simple 1u ROI from settled history — display only, no engine change. */
export function computeSimpleRoi(rows: HistoryEntry[]): number | null {
  let stake = 0;
  let pnl = 0;
  for (const h of rows) {
    const v = h.validation;
    if (v !== "win" && v !== "loss" && v !== "push" && v !== "half_win" && v !== "half_loss") continue;
    const odd = Number(h.recommended?.odd ?? h.valueBet?.odd);
    if (!Number.isFinite(odd) || odd <= 1) continue;
    stake += 1;
    // Asian payouts per 1u: win → odd−1 · push → 0 · half_win → (odd−1)/2 ·
    // half_loss → −0.5 · loss → −1 (mirrors asianTotals payoutMultiplier − 1).
    if (v === "win") pnl += odd - 1;
    else if (v === "half_win") pnl += (odd - 1) / 2;
    else if (v === "half_loss") pnl -= 0.5;
    else if (v === "loss") pnl -= 1;
    // push: pnl += 0 — stake returned.
  }
  if (!stake) return null;
  return (pnl / stake) * 100;
}

/** Calendar-day accuracy (Europe/Bucharest, matching kickoff bucketing) for the last N days, oldest first. */
export function computeLastNDaysAccuracy(rows: HistoryEntry[], days: number): DayAccuracyRow[] {
  const byDate = new Map<string, HistoryEntry[]>();
  for (const row of rows || []) {
    const key = kickoffLocalDateKey(row.kickoff);
    if (!key) continue;
    const bucket = byDate.get(key);
    if (bucket) bucket.push(row);
    else byDate.set(key, [row]);
  }
  const out: DayAccuracyRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = kickoffLocalDateKey(new Date(Date.now() - i * 86_400_000).toISOString());
    out.push({ date, ...historyStatsFromRows(byDate.get(date) || []) });
  }
  return out;
}

/** Yesterday's settled accuracy, for the "quick card" on the home dashboard. */
export function computeYesterdayAccuracy(rows: HistoryEntry[]): HistoryStats {
  const yesterday = kickoffLocalDateKey(new Date(Date.now() - 86_400_000).toISOString());
  return historyStatsFromRows((rows || []).filter((row) => kickoffLocalDateKey(row.kickoff) === yesterday));
}

const ONE_X_TWO_PICKS = new Set(["1", "X", "2", "1X", "12", "X2"]);
const BTTS_PICKS = new Set(["GG", "NGG"]);

function classifyRecommendedPick(pick: string | null | undefined): "oneXTwo" | "btts" | "overUnder" | null {
  const p = String(pick || "").trim().toUpperCase();
  if (!p) return null;
  if (ONE_X_TWO_PICKS.has(p)) return "oneXTwo";
  if (BTTS_PICKS.has(p)) return "btts";
  if (/^(OVER|UNDER|PESTE|SUB)\b/.test(p)) return "overUnder";
  return null;
}

/**
 * Breakdown by market family for the "History & Trust" section: 1X2 / BTTS come from the
 * recommended pick's own settlement; Over/Under always comes from the dedicated goals card
 * market (kept distinct from `recommended` upstream so a goals-recommended row doesn't double
 * count the same line — see cardMarketSettlement.js).
 */
export function computeMarketBreakdown(rows: HistoryEntry[]): MarketBreakdownRow[] {
  const tally: Record<"oneXTwo" | "overUnder" | "btts", { wins: number; losses: number; pending: number }> = {
    oneXTwo: { wins: 0, losses: 0, pending: 0 },
    overUnder: { wins: 0, losses: 0, pending: 0 },
    btts: { wins: 0, losses: 0, pending: 0 }
  };

  const add = (market: "oneXTwo" | "overUnder" | "btts", outcome: SettlementOutcome | null | undefined) => {
    // Asian outcomes (push / half_*) are deliberately NOT folded into this
    // breakdown's win/loss columns — the main rate stays full-results-only.
    if (outcome === "win") tally[market].wins += 1;
    else if (outcome === "loss") tally[market].losses += 1;
    else if (outcome === "pending") tally[market].pending += 1;
  };

  for (const row of rows || []) {
    const recommendedClass = classifyRecommendedPick(row.recommended?.pick);
    if (recommendedClass) add(recommendedClass, row.cardMarketValidations?.recommended);
    add("overUnder", row.cardMarketValidations?.goals);
  }

  return (["oneXTwo", "overUnder", "btts"] as const).map((market) => {
    const t = tally[market];
    const settled = t.wins + t.losses;
    return { market, ...t, settled, winRate: settled > 0 ? (t.wins / settled) * 100 : 0 };
  });
}
