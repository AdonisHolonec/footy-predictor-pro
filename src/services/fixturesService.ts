import { DayResponse, League } from "../types";
import { isoToday, normalizeSelectedDates } from "../utils/appUtils";

export async function fetchDaysAggregation(
  dates: string[],
  fallbackDate: string
): Promise<DayResponse> {
  const effectiveDates = normalizeSelectedDates(dates.length ? dates : [fallbackDate]);
  const responses = await Promise.all(
    effectiveDates.map(async (d) => {
      const r = await fetch(`/api/fixtures?date=${d}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Eroare API");
      return j as DayResponse;
    })
  );

  const leaguesMap = new Map<number, League>();
  for (const resp of responses) {
    for (const lg of resp.leagues || []) {
      const existing = leaguesMap.get(lg.id);
      if (existing) {
        existing.matches += lg.matches;
        if (!existing.logo && lg.logo) existing.logo = lg.logo;
      } else {
        leaguesMap.set(lg.id, { ...lg });
      }
    }
  }

  return {
    ok: true,
    date: effectiveDates.join(", "),
    totalFixtures: responses.reduce((sum, resp) => sum + (resp.totalFixtures || 0), 0),
    leagues: Array.from(leaguesMap.values()),
    usage: responses[responses.length - 1]?.usage || { date: isoToday(), count: 0, limit: 100 }
  };
}
