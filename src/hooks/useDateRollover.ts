import { useEffect, useRef } from "react";
import { localCalendarDateKey } from "../utils/appUtils";

type UseDateRolloverOptions = {
  date: string;
  onRollToDate: (nextDate: string) => void;
  intervalMs?: number;
  storageKeys?: string[];
};

/**
 * Moves the browsed date forward when TODAY ITSELF changes — a tab left open
 * past midnight follows the new day. It never overrides a day the user chose.
 *
 * The previous version compared the browsed date with today on every date
 * change, every minute and on every focus, and "rolled" whenever they differed:
 * picking yesterday in the day strip was undone on the very next render. A
 * rollover is a change of the CALENDAR DAY, not a difference between the
 * browsed date and today.
 *
 *   - first check (mount): a stored day left over from an earlier visit is not
 *     a choice made in this visit, so a new visit starts on today;
 *   - afterwards: roll only when the calendar day has changed since the last
 *     check AND the browsed date was still that previous today — the user was
 *     following "today". A user browsing another day keeps it;
 *   - another tab changing the stored date still syncs this one (storage event).
 */
export function useDateRollover(options: UseDateRolloverOptions) {
  const { date, onRollToDate, intervalMs = 60_000, storageKeys = [] } = options;
  const dateRef = useRef(date);
  dateRef.current = date;
  const rollRef = useRef(onRollToDate);
  rollRef.current = onRollToDate;
  /** The calendar day seen at the previous check; null before the first one. */
  const observedTodayRef = useRef<string | null>(null);

  useEffect(() => {
    const check = () => {
      const today = localCalendarDateKey();
      const observed = observedTodayRef.current;
      observedTodayRef.current = today;
      if (observed === null) {
        if (dateRef.current !== today) rollRef.current(today);
        return;
      }
      if (observed !== today && dateRef.current === observed) rollRef.current(today);
    };
    check();
    const tm = setInterval(check, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(tm);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", check);
    };
  }, [intervalMs]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!storageKeys.length || !storageKeys.includes(String(event.key || ""))) return;
      const next = String(event.newValue || "").slice(0, 10);
      if (!next || next === date) return;
      onRollToDate(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [date, onRollToDate, storageKeys]);
}
