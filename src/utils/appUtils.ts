import { useEffect, useState } from "react";
import type { HistoryEntry, PredictionRow } from "../types";

export function normalizeSelectedDates(dates: string[]): string[] {
  const uniq = Array.from(new Set(dates.filter(Boolean)));
  return uniq.sort().slice(0, 3);
}

/** Today's date as YYYY-MM-DD in the user's local timezone (matches date inputs and daily caps). */
export function isoToday(): string {
  return localCalendarDateKey();
}

/** YYYY-MM-DD in the user's local timezone (used for daily Warm/Predict caps). */
export function localCalendarDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function inferSeason(dateISO: string): number {
  const [y, m] = dateISO.split("-").map(Number);
  if (!y || !m) return new Date().getFullYear() - 1;
  return m >= 7 ? y : y - 1;
}

export function useLocalStorageState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // ignore storage errors
    }
  }, [key, v]);

  return [v, setV] as const;
}

export function hashColor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const r = (h >>> 16) & 255;
  const g = (h >>> 8) & 255;
  const b = h & 255;
  return `rgb(${Math.floor(80 + (r / 255) * 150)}, ${Math.floor(80 + (g / 255) * 150)}, ${Math.floor(80 + (b / 255) * 150)})`;
}

/** API-Football `fixture.status.short` values where kickoff has occurred and the match is not finished. */
const IN_PLAY_STATUSES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT", "SUSP", "VAR", "1ST", "2ND"]);

export function isFixtureInPlay(status?: string): boolean {
  const s = String(status ?? "")
    .trim()
    .toUpperCase();
  return IN_PLAY_STATUSES.has(s);
}

export async function dominantColorFromImage(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 200) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
        if (n < 10) return resolve(null);
        resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * After `/api/history` sync, merge server `status` + `score` into cached prediction rows
 * so cards show final pick results without re-running Predict.
 */
export function mergePredsWithHistory(preds: PredictionRow[], history: HistoryEntry[]): PredictionRow[] {
  if (!preds?.length || !history?.length) return preds;
  const byId = new Map(history.map((h) => [String(h.id), h]));
  let touched = false;
  const out = preds.map((p) => {
    const h = byId.get(String(p.id));
    if (!h) return p;
    const st = String(h.status ?? "").trim();
    const nextStatus = st || p.status;
    const nh = h.score?.home;
    const na = h.score?.away;
    const oh = p.score?.home;
    const oa = p.score?.away;
    const nhN = Number(nh);
    const naN = Number(na);
    const hasServerScore = Number.isFinite(nhN) && Number.isFinite(naN);
    const nextScore = hasServerScore ? { home: nhN, away: naN } : p.score;
    if (nextStatus === p.status && nextScore?.home === oh && nextScore?.away === oa) return p;
    touched = true;
    return { ...p, status: nextStatus, score: nextScore };
  });
  return touched ? out : preds;
}

export type HistoryLossDay = {
  day: string;
  losses: number;
  wins: number;
  settled: number;
  pending: number;
};

function historyDayKey(row: HistoryEntry): string {
  const kickoff = String(row.kickoff || "").slice(0, 10);
  if (kickoff) return kickoff;
  const savedAt = String(row.savedAt || "").slice(0, 10);
  if (savedAt) return savedAt;
  return "unknown";
}

export function buildHistoryLossDays(rows: HistoryEntry[]): HistoryLossDay[] {
  const map = new Map<string, HistoryLossDay>();
  for (const row of rows || []) {
    const day = historyDayKey(row);
    if (!map.has(day)) {
      map.set(day, { day, losses: 0, wins: 0, settled: 0, pending: 0 });
    }
    const cur = map.get(day)!;
    if (row.validation === "loss") cur.losses += 1;
    else if (row.validation === "win") cur.wins += 1;
    else cur.pending += 1;
  }
  for (const d of map.values()) d.settled = d.wins + d.losses;
  return Array.from(map.values());
}

export function filterHistoryByWorstLossDays(rows: HistoryEntry[], excludeDays: number): { filtered: HistoryEntry[]; excludedDays: HistoryLossDay[] } {
  const safeExclude = Math.max(0, Math.min(Number(excludeDays) || 0, 7));
  if (!rows?.length || safeExclude <= 0) return { filtered: rows || [], excludedDays: [] };

  const ranked = buildHistoryLossDays(rows)
    .filter((d) => d.losses > 0)
    .sort((a, b) => {
      if (b.losses !== a.losses) return b.losses - a.losses;
      if (b.settled !== a.settled) return b.settled - a.settled;
      return String(b.day).localeCompare(String(a.day));
    })
    .slice(0, safeExclude);
  if (!ranked.length) return { filtered: rows, excludedDays: [] };

  const excludedSet = new Set(ranked.map((d) => d.day));
  const filtered = rows.filter((row) => !excludedSet.has(historyDayKey(row)));
  return { filtered, excludedDays: ranked };
}
