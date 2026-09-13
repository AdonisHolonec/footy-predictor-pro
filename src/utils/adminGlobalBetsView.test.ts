import { describe, expect, it } from "vitest";
import {
  describeLifecycle,
  describeSettlement,
  oddsBucket,
  oddsBucketLabel,
  resolveSettlementStatus,
  startOfMonthKey,
  startOfWeekKey,
  summarizeWonGlobalTickets,
  type KpiTicket
} from "./adminGlobalBetsView";

/**
 * Admin → Global Bets presentation arithmetic.
 *
 * The two things this file exists to pin down are the two that were actually
 * wrong or absent: a category derived from the PRICE rather than the leg count,
 * and a "won" counter that means settlement rather than "the day is over".
 *
 * Clocks are always explicit. Every window assertion passes a fixed instant, and
 * several of them sit in the hours where Bucharest and UTC disagree about what
 * day it is — a test that used the runner's own clock would pass in one timezone
 * and fail in another, which is the bug it is supposed to be guarding.
 */

/* Wed 16 Sep 2026, 12:00 in Bucharest. Week began Mon 14 Sep. */
const WEDNESDAY = Date.parse("2026-09-16T09:00:00Z");
/* Sun 13 Sep 2026 in Bucharest — the week that began Mon 7 Sep. */
const SUNDAY = Date.parse("2026-09-13T12:00:00Z");
/* 21:30 UTC on Sun 13 Sep is already Mon 14 Sep in Bucharest (UTC+3). */
const SUNDAY_LATE_UTC = Date.parse("2026-09-13T21:30:00Z");

const ticket = (o: Partial<KpiTicket> = {}): KpiTicket => ({
  id: "t-1",
  betDate: "2026-09-16",
  status: "won",
  totalOdds: 3.2,
  ...o
});

describe("settlement status vocabulary", () => {
  it("accepts exactly the four statuses the schema allows", () => {
    expect(resolveSettlementStatus("pending")).toBe("pending");
    expect(resolveSettlementStatus("won")).toBe("won");
    expect(resolveSettlementStatus("lost")).toBe("lost");
    expect(resolveSettlementStatus("void")).toBe("void");
  });

  it("refuses to model a status it does not recognise, rather than defaulting", () => {
    // The dangerous failure is a fabricated result, so this asserts null for a
    // plausible-looking value as well as for junk.
    for (const raw of ["settled", "closed", "WON", "", null, undefined, 1, {}]) {
      expect(resolveSettlementStatus(raw)).toBeNull();
    }
  });

  it("labels a won ticket as won and a lost one as lost, with distinct tones", () => {
    expect(describeSettlement("won")).toEqual({ status: "won", label: "Câștigat", tone: "success" });
    expect(describeSettlement("lost")).toEqual({ status: "lost", label: "Pierdut", tone: "danger" });
    expect(describeSettlement("pending")).toEqual({ status: "pending", label: "În așteptare", tone: "warning" });
    expect(describeSettlement("void")).toEqual({ status: "void", label: "Anulat", tone: "neutral" });
  });

  it("returns nothing to render when the status is unknown", () => {
    expect(describeSettlement("something_else")).toBeNull();
  });
});

describe("lifecycle is not settlement", () => {
  it("reports a settled ticket as closed without claiming it won", () => {
    const lifecycle = describeLifecycle({ publishedAt: "2026-09-16T06:00:00Z", settledAt: "2026-09-16T21:00:00Z" });
    expect(lifecycle.label).toBe("Închis");
    expect(lifecycle.label).not.toBe("Câștigat");
  });

  it("separates draft from published", () => {
    expect(describeLifecycle({ publishedAt: null, settledAt: null }).label).toBe("Draft");
    expect(describeLifecycle({ publishedAt: "2026-09-16T06:00:00Z", settledAt: null }).label).toBe("Publicat");
  });

  it("a closed-but-unsettled ticket is never labelled won", () => {
    // settled_at set, status still pending: the lifecycle says closed, and the
    // settlement slot must report pending rather than inheriting a win.
    expect(describeLifecycle({ publishedAt: "x", settledAt: "y" }).label).toBe("Închis");
    expect(describeSettlement("pending")?.status).toBe("pending");
  });
});

describe("odds buckets are priced, not counted", () => {
  it("places a ticket by its total odds, with no access to a leg count", () => {
    // The function takes one argument and it is the price. A three-leg ticket at
    // 9.50 and an eight-leg ticket at 9.50 are both 8+.
    expect(oddsBucket(9.5)).toBe("cota8");
    expect(oddsBucketLabel(9.5)).toBe("Cota 8+");
  });

  it("treats each threshold as inclusive at its exact value", () => {
    expect(oddsBucket(2)).toBe("cota2");
    expect(oddsBucket(4)).toBe("cota4");
    expect(oddsBucket(8)).toBe("cota8");
  });

  it("does not promote a value just below a threshold", () => {
    expect(oddsBucket(1.99)).toBeNull();
    expect(oddsBucket(3.99)).toBe("cota2");
    expect(oddsBucket(7.99)).toBe("cota4");
  });

  it("gives one exclusive label per ticket, the highest reached", () => {
    // 10.50 clears all three thresholds; the CARD still shows exactly one word.
    expect(oddsBucket(10.5)).toBe("cota8");
    expect(oddsBucketLabel(10.5)).toBe("Cota 8+");
  });

  it("refuses to invent a bucket from a missing price", () => {
    // Number(null) is 0 and Number("") is 0 — both would compare as real numbers.
    for (const raw of [null, undefined, "", "abc", NaN]) {
      expect(oddsBucket(raw)).toBeNull();
      expect(oddsBucketLabel(raw)).toBeNull();
    }
  });
});

describe("week and month boundaries", () => {
  it("starts the week on Monday", () => {
    expect(startOfWeekKey(WEDNESDAY)).toBe("2026-09-14");
  });

  it("keeps Sunday in the week that began the previous Monday", () => {
    // A Sunday-based week would answer 2026-09-13 here.
    expect(startOfWeekKey(SUNDAY)).toBe("2026-09-07");
  });

  it("uses Europe/Bucharest, not UTC", () => {
    // 21:30 UTC Sunday is already Monday in Bucharest, so the week has rolled.
    expect(startOfWeekKey(SUNDAY_LATE_UTC)).toBe("2026-09-14");
    expect(startOfWeekKey(SUNDAY)).toBe("2026-09-07");
  });

  it("starts the month on the first", () => {
    expect(startOfMonthKey(WEDNESDAY)).toBe("2026-09-01");
  });
});

describe("won-ticket counters", () => {
  it("counts a won ticket dated this week in both windows", () => {
    const kpi = summarizeWonGlobalTickets(
      [ticket({ betDate: "2026-09-15" }), ticket({ id: "old", betDate: "2026-08-01", status: "lost" })],
      WEDNESDAY
    );
    expect(kpi.week.count).toBe(1);
    expect(kpi.month.count).toBe(1);
  });

  it("counts a won ticket earlier this month in the month only", () => {
    const kpi = summarizeWonGlobalTickets(
      [ticket({ id: "a", betDate: "2026-09-03" }), ticket({ id: "floor", betDate: "2026-07-01", status: "lost" })],
      WEDNESDAY
    );
    expect(kpi.week.count).toBe(0);
    expect(kpi.month.count).toBe(1);
  });

  it("excludes a won ticket from a previous month", () => {
    const kpi = summarizeWonGlobalTickets(
      [ticket({ id: "a", betDate: "2026-08-30" }), ticket({ id: "b", betDate: "2026-07-04" })],
      WEDNESDAY
    );
    expect(kpi.week.count).toBe(0);
    expect(kpi.month.count).toBe(0);
  });

  it("excludes lost, pending, void and unknown statuses", () => {
    const kpi = summarizeWonGlobalTickets(
      [
        ticket({ id: "l", status: "lost" }),
        ticket({ id: "p", status: "pending" }),
        ticket({ id: "v", status: "void" }),
        ticket({ id: "x", status: "settled" }),
        ticket({ id: "c", status: "closed" })
      ],
      WEDNESDAY
    );
    expect(kpi.week.count).toBe(0);
    expect(kpi.month.count).toBe(0);
  });

  it("never counts one ticket twice", () => {
    const duplicated = [ticket({ id: "same" }), ticket({ id: "same" }), ticket({ id: "same" })];
    const kpi = summarizeWonGlobalTickets(duplicated, WEDNESDAY);
    expect(kpi.week.count).toBe(1);
    expect(kpi.month.count).toBe(1);
  });

  it("counts on bet_date, so a ticket is never attributed to the day it was graded", () => {
    // Dated last month; it would only land in "this week" if a settlement
    // timestamp were used instead.
    const kpi = summarizeWonGlobalTickets([ticket({ betDate: "2026-08-11" })], WEDNESDAY);
    expect(kpi.week.count).toBe(0);
  });
});

describe("counters state their own coverage", () => {
  it("is complete when the list reaches back past the window start", () => {
    const kpi = summarizeWonGlobalTickets(
      [ticket({ id: "a", betDate: "2026-09-16" }), ticket({ id: "b", betDate: "2026-08-20", status: "lost" })],
      WEDNESDAY
    );
    expect(kpi.week.complete).toBe(true);
    expect(kpi.month.complete).toBe(true);
  });

  it("is incomplete when the page stops inside the window", () => {
    // Oldest row is 15 Sep: the month began on the 1st, so rows may be missing.
    const kpi = summarizeWonGlobalTickets([ticket({ id: "a", betDate: "2026-09-15" })], WEDNESDAY);
    expect(kpi.week.complete).toBe(false);
    expect(kpi.month.complete).toBe(false);
    expect(kpi.month.since).toBe("2026-09-01");
  });

  it("treats an empty list as an exact zero, not an unknown", () => {
    const kpi = summarizeWonGlobalTickets([], WEDNESDAY);
    expect(kpi.month.count).toBe(0);
    expect(kpi.month.complete).toBe(true);
  });

  it("extends coverage using every row, including the ones it does not count", () => {
    // A single PENDING row from before the month start proves the page reaches
    // back far enough, even though it contributes no count.
    const kpi = summarizeWonGlobalTickets(
      [ticket({ id: "w", betDate: "2026-09-16" }), ticket({ id: "old", betDate: "2026-08-01", status: "pending" })],
      WEDNESDAY
    );
    expect(kpi.month.count).toBe(1);
    expect(kpi.month.complete).toBe(true);
  });
});

describe("cumulative odds breakdown", () => {
  const counts = (kpi: ReturnType<typeof summarizeWonGlobalTickets>) =>
    Object.fromEntries(kpi.monthByOddsThreshold.map((b) => [b.id, b.count]));

  it("counts a long-priced winner in every threshold it clears", () => {
    const kpi = summarizeWonGlobalTickets([ticket({ totalOdds: 10 })], WEDNESDAY);
    expect(counts(kpi)).toEqual({ cota2: 1, cota4: 1, cota8: 1 });
  });

  it("counts a mid-priced winner in 2+ and 4+ but not 8+", () => {
    const kpi = summarizeWonGlobalTickets([ticket({ totalOdds: 4 })], WEDNESDAY);
    expect(counts(kpi)).toEqual({ cota2: 1, cota4: 1, cota8: 0 });
  });

  it("leaves a winner priced under 2.00 out of every bucket", () => {
    const kpi = summarizeWonGlobalTickets([ticket({ totalOdds: 1.8 })], WEDNESDAY);
    expect(counts(kpi)).toEqual({ cota2: 0, cota4: 0, cota8: 0 });
    // Still a win — it is only the price breakdown that cannot place it.
    expect(kpi.month.count).toBe(1);
  });

  it("reads low-to-high, so the widest threshold comes first", () => {
    const kpi = summarizeWonGlobalTickets([], WEDNESDAY);
    expect(kpi.monthByOddsThreshold.map((b) => b.label)).toEqual(["Cota 2+", "Cota 4+", "Cota 8+"]);
  });

  it("aggregates a realistic month without double-counting a ticket", () => {
    const kpi = summarizeWonGlobalTickets(
      [
        ticket({ id: "a", totalOdds: 16.08 }),
        ticket({ id: "b", totalOdds: 5.2 }),
        ticket({ id: "c", totalOdds: 2.4 }),
        ticket({ id: "d", totalOdds: 9.9, status: "lost" }),
        ticket({ id: "e", betDate: "2026-07-02", totalOdds: 12 })
      ],
      WEDNESDAY
    );
    expect(kpi.month.count).toBe(3);
    expect(counts(kpi)).toEqual({ cota2: 3, cota4: 2, cota8: 1 });
  });
});
