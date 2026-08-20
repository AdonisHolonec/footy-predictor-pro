import { useEffect, useRef, useState } from "react";
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

/**
 * Kickoff → calendar day in Europe/Bucharest — matches how the server buckets fixtures
 * for a requested `date` (server-utils/fixtureCalendarDateKey.js). Using the device's own
 * timezone here (instead of this fixed zone) made evening-kickoff fixtures in timezones
 * behind Bucharest (e.g. MLS/USA) roll into the next calendar day locally, so they'd fail
 * the selected-date check and disappear even though the server returned them correctly.
 */
export function kickoffLocalDateKey(kickoff?: string | null): string {
  if (!kickoff) return "";
  const d = new Date(kickoff);
  if (!Number.isFinite(d.getTime())) return String(kickoff).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

/** Merge prediction rows by fixture id — never drop prior dates when a new batch arrives. */
export function mergePredictionRows(existing: PredictionRow[], incoming: PredictionRow[]): PredictionRow[] {
  const map = new Map<number, PredictionRow>();
  for (const row of existing || []) {
    const id = Number(row?.id);
    if (Number.isFinite(id)) map.set(id, row);
  }
  for (const row of incoming || []) {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, row);
      continue;
    }
    // Deep-merge probs/marketOdds so full history rows restore corners/shots over free-masked cache.
    map.set(id, {
      ...prev,
      ...row,
      probs:
        prev.probs || row.probs
          ? ({ ...(prev.probs || {}), ...(row.probs || {}) } as PredictionRow["probs"])
          : row.probs,
      recommended:
        prev.recommended || row.recommended
          ? ({
              pick: "",
              confidence: 0,
              ...(prev.recommended || {}),
              ...(row.recommended || {})
            } as PredictionRow["recommended"])
          : row.recommended,
      marketOdds:
        prev.marketOdds || row.marketOdds
          ? ({ ...(prev.marketOdds || {}), ...(row.marketOdds || {}) } as PredictionRow["marketOdds"])
          : row.marketOdds
    });
  }
  return Array.from(map.values());
}

export function inferSeason(dateISO: string): number {
  const [y, m] = dateISO.split("-").map(Number);
  if (!y || !m) return new Date().getFullYear() - 1;
  return m >= 7 ? y : y - 1;
}

/**
 * @param toStored Narrows the value on its way to disk WITHOUT narrowing state.
 *   The prediction caches store rows that are ~245 KB each and blow the origin
 *   budget long before the user has a full slate; everything else stores a date
 *   or a handful of ids and passes nothing here. Applying it at serialization
 *   rather than in `setV` is the whole point: the live object keeps every field,
 *   so the modal and the card readers are untouched within a session, and only
 *   what survives a reload is narrowed.
 */
export function useLocalStorageState<T>(key: string, initial: T, toStored?: (value: T) => T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  // A ref, so a caller passing an inline lambda does not re-write storage every render.
  const toStoredRef = useRef(toStored);
  toStoredRef.current = toStored;

  useEffect(() => {
    try {
      const project = toStoredRef.current;
      localStorage.setItem(key, JSON.stringify(project ? project(v) : v));
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
    const rawHome = h.score?.home;
    const rawAway = h.score?.away;
    const oh = p.score?.home;
    const oa = p.score?.away;
    // 0-0 is a real score, so presence is decided by an explicit null check, never
    // by truthiness — and never by Number() alone either, since Number(null) is 0
    // and would turn "no score recorded" into a goalless draw.
    const hasServerScore =
      rawHome != null &&
      rawAway != null &&
      Number.isFinite(Number(rawHome)) &&
      Number.isFinite(Number(rawAway));
    // History knows the goals; it does NOT know the minute, stoppage time or the
    // halftime split for a match still in play — those are live-poll state. Taking
    // only home/away and keeping the rest is what stops a live row from silently
    // losing `score.minute`, which the momentum timeline needs to advance.
    const nextScore = hasServerScore
      ? { ...(p.score || {}), home: Number(rawHome), away: Number(rawAway) }
      : p.score;
    const nextValidations = h.cardMarketValidations ?? p.cardMarketValidations ?? null;
    const nextReferee = String(h.referee || "").trim() || p.referee;
    const nextMarketResults = h.marketResults
      ? { ...(p.marketResults || {}), ...h.marketResults }
      : p.marketResults;
    const sameValidations =
      JSON.stringify(nextValidations || null) === JSON.stringify(p.cardMarketValidations || null);
    const sameMarketResults =
      JSON.stringify(nextMarketResults || null) === JSON.stringify(p.marketResults || null);
    if (
      nextStatus === p.status &&
      nextScore?.home === oh &&
      nextScore?.away === oa &&
      sameValidations &&
      sameMarketResults &&
      nextReferee === p.referee
    ) {
      return p;
    }
    touched = true;
    return {
      ...p,
      status: nextStatus,
      score: nextScore,
      referee: nextReferee,
      cardMarketValidations: nextValidations,
      marketResults: nextMarketResults
    };
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
    const stored = row.cardMarketValidations;
    const outcomes: Array<"pending" | "win" | "loss"> = [];
    if (stored && typeof stored === "object") {
      for (const key of ["recommended", "goals", "corners", "shots"] as const) {
        const v = stored[key];
        if (v === "win" || v === "loss" || v === "pending") outcomes.push(v);
      }
    }
    if (!outcomes.length && (row.validation === "win" || row.validation === "loss" || row.validation === "pending")) {
      outcomes.push(row.validation);
    }
    for (const v of outcomes) {
      if (v === "loss") cur.losses += 1;
      else if (v === "win") cur.wins += 1;
      else cur.pending += 1;
    }
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
