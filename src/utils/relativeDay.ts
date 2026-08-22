import { localCalendarDateKey } from "./appUtils";

/**
 * Day context for a kickoff, relative to "now", in the device's local calendar —
 * the same calendar the displayed kickoff time (`toLocaleTimeString`) lives in,
 * so the day label and the time can never disagree about which day it is.
 *
 * Presentational only: nothing here sorts, groups or filters fixtures.
 */
export type RelativeDay =
  | { kind: "today" | "tomorrow" | "dayAfterTomorrow"; offsetDays: number }
  | { kind: "absolute"; offsetDays: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days from `now` to `kickoff` in local time (negative for the past). */
export function relativeDayOffset(kickoff: Date, now: Date = new Date()): number | null {
  if (!Number.isFinite(kickoff.getTime()) || !Number.isFinite(now.getTime())) return null;
  // Compare calendar dates, not instants: 23:30 → 00:30 is one day apart however
  // few minutes separate them, and DST never shifts a date key.
  const a = Date.UTC(...dateParts(localCalendarDateKey(kickoff)));
  const b = Date.UTC(...dateParts(localCalendarDateKey(now)));
  return Math.round((a - b) / MS_PER_DAY);
}

function dateParts(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m - 1, d];
}

export function relativeDay(kickoff: Date, now: Date = new Date()): RelativeDay | null {
  const offsetDays = relativeDayOffset(kickoff, now);
  if (offsetDays === null) return null;
  if (offsetDays === 0) return { kind: "today", offsetDays };
  if (offsetDays === 1) return { kind: "tomorrow", offsetDays };
  if (offsetDays === 2) return { kind: "dayAfterTomorrow", offsetDays };
  return { kind: "absolute", offsetDays };
}

/**
 * The label the list shows: Today / Tomorrow / Day after tomorrow from i18n,
 * otherwise the short local date (e.g. "25 Aug"). Empty for an unparseable kickoff.
 */
export function relativeDayLabel(kickoff: Date, t: (key: string) => string, now: Date = new Date()): string {
  const day = relativeDay(kickoff, now);
  if (!day) return "";
  if (day.kind === "today") return t("list.dayToday");
  if (day.kind === "tomorrow") return t("list.dayTomorrow");
  if (day.kind === "dayAfterTomorrow") return t("list.dayAfterTomorrow");
  return kickoff.toLocaleDateString([], { day: "numeric", month: "short" });
}
