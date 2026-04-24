import { useEffect } from "react";
import { localCalendarDateKey } from "../utils/appUtils";

type UseDateRolloverOptions = {
  date: string;
  onRollToDate: (nextDate: string) => void;
  intervalMs?: number;
  storageKeys?: string[];
};

export function useDateRollover(options: UseDateRolloverOptions) {
  const { date, onRollToDate, intervalMs = 60_000, storageKeys = [] } = options;

  useEffect(() => {
    const tm = setInterval(() => {
      const today = localCalendarDateKey();
      if (today !== date) onRollToDate(today);
    }, intervalMs);
    return () => clearInterval(tm);
  }, [date, intervalMs, onRollToDate]);

  useEffect(() => {
    const today = localCalendarDateKey();
    if (today !== date) onRollToDate(today);
  }, [date, onRollToDate]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const today = localCalendarDateKey();
      if (today !== date) onRollToDate(today);
    };
    const onFocus = () => {
      const today = localCalendarDateKey();
      if (today !== date) onRollToDate(today);
    };
    const onStorage = (event: StorageEvent) => {
      if (!storageKeys.length || !storageKeys.includes(String(event.key || ""))) return;
      const next = String(event.newValue || "").slice(0, 10);
      if (!next || next === date) return;
      onRollToDate(next);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [date, onRollToDate, storageKeys]);
}
