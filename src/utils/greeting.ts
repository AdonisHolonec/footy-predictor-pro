import { NIGHT_OWL_MESSAGES, LIVE_CONTEXT_MESSAGES, translate, type Locale } from "../i18n";

/**
 * Contextual Greeting Engine
 * --------------------------
 * Single source of truth for every greeting shown in the app. A greeting is
 * decided by walking an ordered list of providers (`GREETING_PROVIDERS`) and
 * returning the first one that matches. Adding a future greeting type
 * (birthday, subscription anniversary, holiday, competition final, ...) is a
 * matter of writing one more provider function and inserting it into that
 * list at the right priority — no existing provider, and no calling
 * component, needs to change.
 */

export type GreetingType = "special" | "live" | "night" | "morning" | "day" | "evening";

export type GreetingResult = {
  text: string;
  type: GreetingType;
};

/**
 * 05:00–11:59 morning, 12:00–17:59 day, 18:00–22:59 evening, 23:00–04:59 night.
 * Boundaries are hour-only so minutes never cross a bucket edge.
 */
export function getGreetingType(date: Date = new Date()): "morning" | "day" | "evening" | "night" {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "day";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function withCount(message: string, count: number): string {
  return message.replace(/\{count\}/g, String(count));
}

// ---- Shuffle-bag randomization -------------------------------------------
// Every message in a pool is dealt exactly once (in random order) before any
// message repeats — the same principle Spotify's "shuffle" uses, rather than
// picking with Math.random() each time (which can repeat a message often).
// State is a small array of remaining indices, persisted in sessionStorage so
// the sequence survives a page refresh within the same tab; when a bag is
// exhausted, it is reshuffled and guarded so its first draw never matches the
// immediately preceding message.

type ShuffleBagState = { bag: number[]; last: number | null };

function readShuffleBagState(key: string): ShuffleBagState | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShuffleBagState>;
    if (!Array.isArray(parsed.bag)) return null;
    return { bag: parsed.bag, last: typeof parsed.last === "number" ? parsed.last : null };
  } catch {
    return null;
  }
}

function writeShuffleBagState(key: string, state: ShuffleBagState): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* sessionStorage unavailable (SSR, privacy mode) — selection still works, just unpersisted */
  }
}

function shuffledIndices(size: number): number[] {
  const indices = Array.from({ length: size }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function drawFromShuffleBag(poolSize: number, storageKey: string): number {
  if (poolSize <= 1) return 0;

  const state = readShuffleBagState(storageKey);
  let bag = state?.bag ?? [];
  const last = state?.last ?? null;

  if (bag.length === 0) {
    bag = shuffledIndices(poolSize);
    if (bag.length > 1 && bag[0] === last) {
      [bag[0], bag[1]] = [bag[1], bag[0]];
    }
  }

  const [next, ...rest] = bag;
  writeShuffleBagState(storageKey, { bag: rest, last: next });
  return next;
}

function pickFromPool(pool: string[], storageKey: string): string {
  if (pool.length === 0) return "";
  return pool[drawFromShuffleBag(pool.length, storageKey)];
}

// ---- Engine context & providers ------------------------------------------

export type GreetingContext = {
  locale: Locale;
  date: Date;
  liveCount: number;
  hasLiveMatches: boolean;
  hasLiveChampionsLeague: boolean;
  hasLiveEuropaLeague: boolean;
};

type GreetingProvider = (ctx: GreetingContext) => GreetingResult | null;

/** Many-live-matches threshold for the "big football night" message. Tunable. */
const MANY_LIVE_MATCHES_THRESHOLD = 8;

/**
 * Priority 1 — special events (future: birthday, subscription anniversary,
 * holiday, competition final, first login of the day, ...). No such data
 * source exists yet, so this always defers; wiring one in later is additive.
 */
const specialEventsProvider: GreetingProvider = () => null;

/**
 * Priority 2 — live football context: many concurrent live matches, a live
 * Champions/Europa League fixture, or a football weekend. All derived from
 * state already available to the caller (no API calls). Ordered from most to
 * least specific signal.
 */
const liveFootballProvider: GreetingProvider = (ctx) => {
  const pool = LIVE_CONTEXT_MESSAGES[ctx.locale] ?? LIVE_CONTEXT_MESSAGES.ro;

  if (ctx.hasLiveMatches && ctx.liveCount >= MANY_LIVE_MATCHES_THRESHOLD) {
    const text = withCount(pickFromPool(pool.manyLive, `${ctx.locale}:live:manyLive`), ctx.liveCount);
    return { text, type: "live" };
  }
  if (ctx.hasLiveChampionsLeague) {
    return { text: pickFromPool(pool.championsLeague, `${ctx.locale}:live:ucl`), type: "live" };
  }
  if (ctx.hasLiveEuropaLeague) {
    return { text: pickFromPool(pool.europaLeague, `${ctx.locale}:live:uel`), type: "live" };
  }
  // Weekend flavor only enhances the day/evening greeting — mornings keep
  // their dedicated wake-up greeting and nights keep the night-owl provider
  // below, so the weekend signal (the weakest of the four here) never
  // displaces those more tailored moments.
  const timeType = getGreetingType(ctx.date);
  if (isWeekend(ctx.date) && (timeType === "day" || timeType === "evening")) {
    return { text: pickFromPool(pool.weekend, `${ctx.locale}:live:weekend`), type: "live" };
  }
  return null;
};

/** Priority 3 — night owl (23:00–04:59), split by whether live matches exist. */
const nightOwlProvider: GreetingProvider = (ctx) => {
  if (getGreetingType(ctx.date) !== "night") return null;
  const pool = NIGHT_OWL_MESSAGES[ctx.locale] ?? NIGHT_OWL_MESSAGES.ro;
  const bucket = ctx.hasLiveMatches ? "live" : "idle";
  const raw = pickFromPool(pool[bucket], `${ctx.locale}:night:${bucket}`);
  return { text: withCount(raw, ctx.liveCount), type: "night" };
};

/** Priority 4 — base time-of-day greeting. Always matches (final fallback). */
const timeOfDayProvider: GreetingProvider = (ctx) => {
  const type = getGreetingType(ctx.date);
  const key = type === "morning" ? "dash.goodMorning" : type === "day" ? "dash.goodDay" : "dash.goodEvening";
  return { text: translate(ctx.locale, key), type };
};

const GREETING_PROVIDERS: GreetingProvider[] = [
  specialEventsProvider,
  liveFootballProvider,
  nightOwlProvider,
  timeOfDayProvider
];

export type GetGreetingParams = {
  locale: Locale;
  hasLiveMatches: boolean;
  liveCount?: number;
  hasLiveChampionsLeague?: boolean;
  hasLiveEuropaLeague?: boolean;
  date?: Date;
};

/**
 * Single entry point for every greeting in the app. Builds a context from
 * already-available state, runs it through the provider pipeline in priority
 * order, and returns the first match's `{ text, type }`.
 */
export function getGreeting(params: GetGreetingParams): GreetingResult {
  const ctx: GreetingContext = {
    locale: params.locale,
    date: params.date ?? new Date(),
    liveCount: params.liveCount ?? 0,
    hasLiveMatches: params.hasLiveMatches,
    hasLiveChampionsLeague: params.hasLiveChampionsLeague ?? false,
    hasLiveEuropaLeague: params.hasLiveEuropaLeague ?? false
  };

  for (const provider of GREETING_PROVIDERS) {
    const result = provider(ctx);
    if (result) return result;
  }

  // Unreachable — timeOfDayProvider always matches. Kept only for type-safety.
  return { text: translate(ctx.locale, "dash.goodMorning"), type: "morning" };
}
