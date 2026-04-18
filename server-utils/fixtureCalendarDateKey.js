/**
 * YYYY-MM-DD calendar date in Europe/Bucharest for grouping /fixtures?date= calls.
 * Avoids UTC midnight shifting vs API-Football day buckets used elsewhere in the app (RO).
 */
export function calendarDateKeyEuropeBucharest(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bucharest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  } catch {
    return null;
  }
}
