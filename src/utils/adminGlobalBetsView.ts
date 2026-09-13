import { statusTone } from "./globalSpecialBetView";
import type { GlobalSpecialBetStatus } from "../types/globalSpecialBet";

/**
 * Presentation helpers for Admin → Betting → Global Bets.
 *
 * Strictly display-only, and deliberately free of React so the arithmetic below
 * is testable without a DOM. NOTHING HERE GRADES ANYTHING. A ticket is won
 * because `special_bets.status` says `won` — the settlement engine's answer,
 * written by `globalSpecialBetSettlement.js` — and this file only counts and
 * labels that answer. Recomputing a result from legs, scores or dates here would
 * create a second settlement authority free to disagree with the first.
 *
 * ── THE DISTINCTION THIS FILE EXISTS TO PROTECT ──────────────────────────────
 * Two independent properties of a ticket were previously collapsed into one
 * word, "Combo 3":
 *
 *   variant     HOW MANY LEGS. A smallint with `check (variant in (3,5,8))`,
 *               and `create_global_ticket` refuses a payload whose selection
 *               count differs from it (043_global_special_bets.sql). External
 *               betting vocabulary calls these a treble, a five-fold, an
 *               eight-fold — never a "cota".
 *   total_odds  WHAT IT PAYS. A separate `numeric(10,3) check (total_odds > 1)`
 *               column, snapshotted at generation and never rewritten.
 *
 * A ticket with eight legs at short prices and one with three legs at long
 * prices are the same "Combo"-ish size and wildly different products. So the
 * odds bucket is derived from `total_odds` ONLY, and the leg count keeps its own
 * separate wording. Neither is renamed into the other.
 *
 * ── EXCLUSIVE LABEL, CUMULATIVE COUNTERS ─────────────────────────────────────
 * The thresholds nest: 16.08 clears 2+, 4+ and 8+. Those two facts need
 * different treatments and get them:
 *
 *   on a card   ONE label, the highest bucket reached (`oddsBucket`), so a
 *               single ticket can never look like three.
 *   in the KPI  cumulative counts, because "how many 2+ winners" genuinely means
 *               "including the 8+ ones". The UI labels them as cumulative; they
 *               are not a partition and must never be summed.
 */

const TIMEZONE = "Europe/Bucharest";

/* ────────────────────────────── settlement status ───────────────────────── */

/**
 * The settlement words, in the admin surface's language.
 *
 * Hard-coded Romanian rather than i18n keys because no panel under
 * `src/components/panels/` mounts a translation provider — the admin app is
 * single-language by construction, and `statusLabelKey()` (which returns
 * `gsb.*` keys for the consumer surface) has nothing to resolve them with here.
 * The vocabulary is deliberately identical to `src/i18n/ro.ts`'s `gsb.status*`.
 */
export const TICKET_STATUS_LABEL: Record<GlobalSpecialBetStatus, string> = {
  pending: "În așteptare",
  won: "Câștigat",
  lost: "Pierdut",
  void: "Anulat"
};

/**
 * A stored status, or null when the row says something we do not model.
 *
 * NULL RATHER THAN A DEFAULT. Coercing an unrecognised value to "pending" would
 * be a guess, and coercing it to anything else could invent a win; a caller that
 * gets null renders "—" and tells the truth. The cast is safe because the guard
 * has already excluded every other string.
 */
export function resolveSettlementStatus(raw: unknown): GlobalSpecialBetStatus | null {
  return raw === "pending" || raw === "won" || raw === "lost" || raw === "void"
    ? (raw as GlobalSpecialBetStatus)
    : null;
}

/** Label + tone for one settlement status, or null when there is nothing to attest. */
export function describeSettlement(
  raw: unknown
): { status: GlobalSpecialBetStatus; label: string; tone: "success" | "danger" | "warning" | "neutral" } | null {
  const status = resolveSettlementStatus(raw);
  if (!status) return null;
  // Tone comes from the consumer module rather than a second map here: one
  // vocabulary, one colour scheme, and no way for the two surfaces to drift.
  return { status, label: TICKET_STATUS_LABEL[status], tone: statusTone(status) };
}

/**
 * Where a ticket sits in its release lifecycle — NOT what it returned.
 *
 * Kept as its own function next to `describeSettlement` precisely because the
 * old panel conflated them: it rendered "Închis" (settled_at is set) in the slot
 * where an operator reads a result, so a LOST ticket and a WON one were the same
 * word. Both are shown now, and neither stands in for the other.
 */
export function describeLifecycle(ticket: {
  publishedAt?: string | null;
  settledAt?: string | null;
}): { label: string; tone: "success" | "warning" | "neutral" } {
  if (ticket.settledAt) return { label: "Închis", tone: "neutral" };
  if (ticket.publishedAt) return { label: "Publicat", tone: "success" };
  return { label: "Draft", tone: "warning" };
}

/* ──────────────────────────────── odds buckets ──────────────────────────── */

export type OddsBucketId = "cota2" | "cota4" | "cota8";

/** Descending, so the first match is the highest bucket a ticket reaches. */
export const ODDS_BUCKETS: readonly { id: OddsBucketId; min: number; label: string }[] = [
  { id: "cota8", min: 8, label: "Cota 8+" },
  { id: "cota4", min: 4, label: "Cota 4+" },
  { id: "cota2", min: 2, label: "Cota 2+" }
] as const;

/** Ascending, the order the cumulative KPI breakdown is read in. */
export const ODDS_BUCKETS_ASCENDING: readonly { id: OddsBucketId; min: number; label: string }[] = [
  ODDS_BUCKETS[2],
  ODDS_BUCKETS[1],
  ODDS_BUCKETS[0]
];

/**
 * The single bucket a ticket is labelled with: the highest threshold it clears.
 *
 * `Number(null)` is 0 and `Number("")` is 0, so an absent price would compare as
 * a real number against 2.00 and miss every bucket for the right reason purely
 * by accident. The explicit checks make "no odds" a stated case instead of a
 * coincidence — the same `Number(null) === 0` trap that produced line-0 rows in
 * the corners audit.
 *
 * Below 2.00 returns null rather than a fourth bucket: the schema only promises
 * `total_odds > 1`, and a 1.40 ticket is genuinely outside the vocabulary the
 * product sells rather than at the bottom of it.
 */
export function oddsBucket(totalOdds: unknown): OddsBucketId | null {
  if (totalOdds == null || totalOdds === "") return null;
  const odds = Number(totalOdds);
  if (!Number.isFinite(odds)) return null;
  for (const bucket of ODDS_BUCKETS) {
    if (odds >= bucket.min) return bucket.id;
  }
  return null;
}

/** The card's category word, or null when the price cannot place it. */
export function oddsBucketLabel(totalOdds: unknown): string | null {
  const id = oddsBucket(totalOdds);
  if (!id) return null;
  const bucket = ODDS_BUCKETS.find((b) => b.id === id);
  return bucket ? bucket.label : null;
}

/* ──────────────────────────────── KPI windows ───────────────────────────── */

/**
 * Today's calendar key in Europe/Bucharest.
 *
 * The SAME zone the server uses to choose `bet_date` (`defaultBetDate()` in
 * globalTicketAdminApi.js). Using the operator's own timezone would put a
 * Bucharest-dated ticket in the wrong week for an admin sitting anywhere west of
 * it, and the counter would disagree with the list directly beneath it.
 */
export function bucharestDateKey(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(nowMs));
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** ISO weekday in Bucharest: Monday is 1. */
function bucharestWeekday(nowMs: number): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(new Date(nowMs));
  return WEEKDAY_INDEX[short] || 1;
}

/**
 * Shift a YYYY-MM-DD key by whole days.
 *
 * Done in UTC on purpose. A local-time `setDate()` crosses the March and October
 * DST boundaries at 23:00 or 01:00 and can land on the same date twice or skip
 * one; UTC has no such discontinuity, and the key never carries a time to lose.
 */
function shiftDateKey(key: string, days: number): string {
  const at = new Date(`${key}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * First day of the current week, Monday-based.
 *
 * Monday because that is the convention of the product's locale (ro-RO, which
 * the panel's `toLocaleString` already uses) and of the ISO week; a Sunday-based
 * week would put the same ticket in a different bucket than the calendar an
 * operator reads.
 */
export function startOfWeekKey(nowMs: number): string {
  return shiftDateKey(bucharestDateKey(nowMs), -(bucharestWeekday(nowMs) - 1));
}

export function startOfMonthKey(nowMs: number): string {
  return `${bucharestDateKey(nowMs).slice(0, 7)}-01`;
}

/* ────────────────────────────────── the KPI ─────────────────────────────── */

export type KpiWindow = {
  count: number;
  /**
   * Whether every ticket in the window was present in the list that was counted.
   *
   * The admin list is a bounded page ordered by `bet_date` descending, so a
   * window is fully covered exactly when the page reaches back PAST its start.
   * When it does not, the count is a floor and the UI says so rather than
   * printing a number that is quietly too small.
   */
  complete: boolean;
  /** The window's first day, for the copy that explains an incomplete count. */
  since: string;
};

export type GlobalBetsKpi = {
  week: KpiWindow;
  month: KpiWindow;
  /** Cumulative — each entry INCLUDES the higher buckets. Never sum these. */
  monthByOddsThreshold: { id: OddsBucketId; label: string; count: number }[];
};

export type KpiTicket = {
  id: string;
  betDate: string;
  status: string;
  totalOdds: number | null;
};

/**
 * Won tickets in the current week and month, plus the cumulative odds breakdown.
 *
 * WON MEANS `status === "won"`, and nothing else. Not "settled", not "closed",
 * not "every leg finished": a lost ticket also has a `settled_at`, and a ticket
 * whose fixtures have all kicked off is not graded until the engine says so.
 *
 * Counted on `bet_date`, not `settled_at`. Two reasons, and the second is the
 * load-bearing one: bet_date is the day the ticket IS (the date on its face),
 * and it is the column the list is ordered by — which is what makes the coverage
 * proof possible at all. Counting a settlement timestamp against a page sorted
 * by match day could miss rows arbitrarily far down the list.
 *
 * Each ticket is counted at most once: the id set makes a duplicated row in the
 * payload a no-op rather than a second win.
 */
export function summarizeWonGlobalTickets(tickets: readonly KpiTicket[], nowMs: number): GlobalBetsKpi {
  const weekStart = startOfWeekKey(nowMs);
  const monthStart = startOfMonthKey(nowMs);

  const seen = new Set<string>();
  let weekCount = 0;
  let monthCount = 0;
  let oldestBetDate: string | null = null;
  const thresholdCounts: Record<OddsBucketId, number> = { cota2: 0, cota4: 0, cota8: 0 };

  for (const ticket of tickets || []) {
    const betDate = typeof ticket?.betDate === "string" ? ticket.betDate : "";
    // Coverage is a property of the PAGE, so every row extends it — including
    // the pending and lost ones the counters skip.
    if (betDate && (oldestBetDate === null || betDate < oldestBetDate)) oldestBetDate = betDate;

    if (!betDate || resolveSettlementStatus(ticket?.status) !== "won") continue;
    const id = String(ticket.id == null ? "" : ticket.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    // Lexicographic comparison is exact for zero-padded YYYY-MM-DD, and avoids
    // parsing a date only to throw the time away again.
    if (betDate >= weekStart) weekCount += 1;
    if (betDate >= monthStart) {
      monthCount += 1;
      const bucket = oddsBucket(ticket.totalOdds);
      // Cumulative: an 8+ winner is also a 4+ winner and a 2+ winner.
      if (bucket === "cota8") {
        thresholdCounts.cota8 += 1;
        thresholdCounts.cota4 += 1;
        thresholdCounts.cota2 += 1;
      } else if (bucket === "cota4") {
        thresholdCounts.cota4 += 1;
        thresholdCounts.cota2 += 1;
      } else if (bucket === "cota2") {
        thresholdCounts.cota2 += 1;
      }
    }
  }

  // An empty list is complete: there were no GLOBAL tickets at all, so zero is
  // exact rather than unknown.
  const covers = (windowStart: string) => oldestBetDate === null || oldestBetDate < windowStart;

  return {
    week: { count: weekCount, complete: covers(weekStart), since: weekStart },
    month: { count: monthCount, complete: covers(monthStart), since: monthStart },
    monthByOddsThreshold: ODDS_BUCKETS_ASCENDING.map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      count: thresholdCounts[bucket.id]
    }))
  };
}
