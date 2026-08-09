import type { HistoryEntry, PredictionRow } from "../types";
import { deriveLiveWinProbability } from "./liveWinProbability";

export type NotificationKind = "kickoff" | "value" | "momentum" | "liveSwing" | "settled";

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
  /** "up"/"down" for "momentum" items. */
  trend?: "up" | "down";
  /** "liveSwing" items: which 1X2 outcome moved most vs kickoff, and by how many signed pp. */
  swingOutcome?: "home" | "draw" | "away";
  swingPp?: number;
  at: string;
};

const UPCOMING_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Below this momentum confidence, live stats are too thin to alert on. */
const MOMENTUM_ALERT_MIN_CONFIDENCE = 50;
/** A live 1X2 shift below this (pp vs kickoff) is drift, not a swing worth alerting on. */
const LIVE_SWING_MIN_DELTA_PP = 15;

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

  // Current-state list (like value): auto-clears once trend returns to "stable" —
  // not an append-only event log.
  const momentum: NotificationItem[] = predictions
    .filter(
      (row) =>
        row.momentum &&
        row.momentum.trend !== "stable" &&
        row.momentum.confidence >= MOMENTUM_ALERT_MIN_CONFIDENCE
    )
    .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
    .map((row) => ({
      id: `momentum-${row.id}-${row.momentum!.trend}`,
      kind: "momentum" as const,
      fixtureId: Number(row.id),
      teams: row.teams,
      league: row.league,
      kickoff: row.kickoff,
      trend: row.momentum!.trend as "up" | "down",
      at: row.kickoff
    }));

  // Current-state list like value/momentum: derived fresh from the live rows each
  // poll, auto-clears when the swing drops back under the floor. The id encodes
  // outcome+direction (not magnitude) so a growing swing doesn't re-ring every poll.
  const liveSwing: NotificationItem[] = predictions
    .flatMap((row) => {
      const live = deriveLiveWinProbability(row);
      if (!live || !row.probs) return [];
      const deltas: Array<{ outcome: NonNullable<NotificationItem["swingOutcome"]>; delta: number }> = [
        { outcome: "home" as const, delta: live.p1 - row.probs.p1 },
        { outcome: "draw" as const, delta: live.pX - row.probs.pX },
        { outcome: "away" as const, delta: live.p2 - row.probs.p2 }
      ].filter((d) => Number.isFinite(d.delta));
      const biggest = [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
      if (!biggest || Math.abs(biggest.delta) < LIVE_SWING_MIN_DELTA_PP) return [];
      return [{ row, biggest }];
    })
    .sort((a, b) => Math.abs(b.biggest.delta) - Math.abs(a.biggest.delta))
    .map(({ row, biggest }) => ({
      id: `liveswing-${row.id}-${biggest.outcome}-${biggest.delta > 0 ? "up" : "down"}`,
      kind: "liveSwing" as const,
      fixtureId: Number(row.id),
      teams: row.teams,
      league: row.league,
      kickoff: row.kickoff,
      swingOutcome: biggest.outcome,
      swingPp: biggest.delta,
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

  return [...upcoming, ...liveSwing, ...value, ...momentum, ...settled];
}
