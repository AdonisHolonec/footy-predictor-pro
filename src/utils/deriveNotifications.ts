import type { HistoryEntry, PredictionRow } from "../types";

export type NotificationKind = "kickoff" | "value" | "settled";

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  fixtureId: number;
  teams: { home: string; away: string };
  league?: string;
  kickoff?: string;
  /** EV percent for "value" items, hours-to-kickoff for "kickoff" items, win/loss for "settled" items. */
  ev?: number;
  hoursToKickoff?: number;
  validation?: "win" | "loss";
  at: string;
};

const UPCOMING_WINDOW_MS = 2 * 60 * 60 * 1000;

export function deriveNotifications(params: {
  predictions: PredictionRow[];
  history: HistoryEntry[];
  watchlistFixtureIds: number[];
  now?: number;
}): NotificationItem[] {
  const { predictions, history, watchlistFixtureIds, now = Date.now() } = params;
  const watched = new Set(watchlistFixtureIds);

  const upcoming: NotificationItem[] = predictions
    .filter((row) => watched.has(Number(row.id)))
    .map((row) => ({ row, ms: new Date(row.kickoff).getTime() - now }))
    .filter(({ ms }) => Number.isFinite(ms) && ms > 0 && ms <= UPCOMING_WINDOW_MS)
    .sort((a, b) => a.ms - b.ms)
    .map(({ row, ms }) => ({
      id: `kickoff-${row.id}`,
      kind: "kickoff" as const,
      fixtureId: Number(row.id),
      teams: row.teams,
      league: row.league,
      kickoff: row.kickoff,
      hoursToKickoff: ms / (60 * 60 * 1000),
      at: row.kickoff
    }));

  const value: NotificationItem[] = predictions
    .filter((row) => row.valueBet?.detected)
    .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
    .map((row) => ({
      id: `value-${row.id}`,
      kind: "value" as const,
      fixtureId: Number(row.id),
      teams: row.teams,
      league: row.league,
      kickoff: row.kickoff,
      ev: row.valueBet?.ev ?? undefined,
      at: row.kickoff
    }));

  const settled: NotificationItem[] = history
    .filter(
      (row) => watched.has(Number(row.id)) && (row.validation === "win" || row.validation === "loss")
    )
    .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))
    .slice(0, 20)
    .map((row) => ({
      id: `settled-${row.id}`,
      kind: "settled" as const,
      fixtureId: Number(row.id),
      teams: row.teams,
      league: row.league,
      kickoff: row.kickoff,
      validation: row.validation as "win" | "loss",
      at: row.savedAt
    }));

  return [...upcoming, ...value, ...settled];
}
