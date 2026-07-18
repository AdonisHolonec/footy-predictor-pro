import {
  PerformanceUserBreakdown,
  PerformanceUserLeagueBreakdown
} from "../types";
import type { PerfAdminSnapshot } from "../types/index";

export async function loadPerfAdmin(accessToken: string): Promise<PerfAdminSnapshot> {
  const res = await fetch("/api/history?performance=1&days=30", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const json = (await res.json()) as {
    ok?: boolean;
    byUser?: PerformanceUserBreakdown[];
    byUserLeague?: PerformanceUserLeagueBreakdown[];
  };
  if (!json?.ok) {
    throw new Error("Nu am putut încărca performance admin.");
  }
  return {
    byUser: Array.isArray(json.byUser) ? json.byUser : [],
    byUserLeague: Array.isArray(json.byUserLeague) ? json.byUserLeague : []
  };
}
