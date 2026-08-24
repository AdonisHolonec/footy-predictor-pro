import type { MatchLiveEvent, MomentumHistoryPoint, MomentumRawStats } from "../types";

/**
 * MATCH FLOW — turning live readings into "how the match went", without inventing any of it.
 *
 * Three layers, deliberately separate (see LiveLayer):
 *   EVENTS      facts with a real minute, complete from 0'  (/fixtures/events)
 *   MOMENTUM    a DERIVED signal: who had the initiative, when, how strongly  (this file)
 *   LIVE STATS  the current cumulative numbers  (/fixtures/statistics)
 *
 * The one thing upstream gives us per minute is the EVENT list. Statistics are cumulative
 * only — API-Football exposes no per-minute momentum feed — so the momentum series can
 * only cover minutes this client actually observed. Minutes it did not observe stay empty.
 */

/**
 * Mirror of DEFAULT_MOMENTUM_WEIGHTS in server-utils/momentum/MomentumEngine.js.
 * `src/` never imports `server-utils/`; matchFlow.guard.test.ts asserts this copy still
 * equals the engine's, so the two cannot drift apart silently.
 */
export const MOMENTUM_WEIGHTS = Object.freeze({
  possession: 0.2,
  shotsTotal: 0.15,
  shotsOnTarget: 0.25,
  corners: 0.15,
  yellowCards: -0.1,
  redCards: -0.3
});

/**
 * The stats a per-interval delta is meaningful on: monotonic counters, where
 * `next - previous` is literally "what this team did between the two readings".
 *
 * Possession is deliberately absent. It is a running ratio over the whole match, not a
 * counter, so the difference between two possession readings is not the possession of
 * the interval between them — using it would smuggle cumulative bias back into a signal
 * whose entire purpose is to be free of it.
 */
export const INTERVAL_STAT_KEYS = [
  "shotsTotal",
  "shotsOnTarget",
  "corners",
  "yellowCards",
  "redCards"
] as const;

/** The subset that represents attacking threat — what the bar's HEIGHT reports. */
const THREAT_STAT_KEYS: readonly string[] = ["shotsTotal", "shotsOnTarget", "corners"];

/**
 * Weighted score of one clearly dangerous interval — a shot on target, another shot and a
 * corner: 0.25 + 0.15 + 0.15. Not a tuning knob: it is spelled out of the engine weights
 * so "full-height bar" means one concrete, nameable passage of play.
 */
export const INTENSITY_REFERENCE =
  MOMENTUM_WEIGHTS.shotsOnTarget + MOMENTUM_WEIGHTS.shotsTotal + MOMENTUM_WEIGHTS.corners;

/** Same threshold as MomentumEngine's dominantTeam — see server-utils/momentum/MomentumEngine.js. */
export const DOMINANCE_THRESHOLD_PP = 10;

export type MomentumSegment = {
  /** Minute the interval starts at (the previous reading's minute; == toMinute for the first). */
  fromMinute: number;
  /** Minute the interval ends at (this reading's minute). */
  toMinute: number;
  side: "home" | "away" | "neutral";
  /** 0..1 dominance imbalance for this interval. */
  magnitude: number;
  homeMomentum: number;
  awayMomentum: number;
  /**
   * 0..1 volume of attacking threat inside the interval, relative to INTENSITY_REFERENCE.
   * Present only when both endpoints carried raw stats — i.e. only when we actually know
   * what happened in the interval rather than what the totals looked like at its end.
   */
  intensity?: number;
  /** true when the interval came from a delta of two readings, false for a lone snapshot. */
  fromDelta?: boolean;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A reading is usable only when every number that becomes geometry is finite. */
export function isFinitePoint(pt: MomentumHistoryPoint | null | undefined): pt is MomentumHistoryPoint {
  return pt != null && isNum(pt.minute) && isNum(pt.homeMomentum) && isNum(pt.awayMomentum);
}

/**
 * Chronological union of two sample lists, one point per minute (the earlier list wins a
 * tie). Invalid points are dropped here so NaN/Infinity never reach the chart.
 */
export function mergeHistoryPoints(
  primary: MomentumHistoryPoint[] | undefined,
  secondary: MomentumHistoryPoint[]
): MomentumHistoryPoint[] {
  const byMinute = new Map<number, MomentumHistoryPoint>();
  for (const pt of [...(primary ?? []), ...secondary]) {
    if (!isFinitePoint(pt) || byMinute.has(pt.minute)) continue;
    byMinute.set(pt.minute, pt);
  }
  return Array.from(byMinute.values()).sort((a, b) => a.minute - b.minute);
}

/** Counter growth between two readings. Never negative: upstream sometimes revises a total down. */
function growth(prev: MomentumRawStats | undefined, next: MomentumRawStats | undefined, key: keyof MomentumRawStats) {
  const a = prev?.[key];
  const b = next?.[key];
  if (!isNum(a) || !isNum(b)) return null;
  return Math.max(0, b - a);
}

type SideScores = { home: number; away: number; threat: number; observed: boolean };

/**
 * What each side did between two readings, scored with the engine's own weights.
 * `observed` is false when neither side had a single readable counter — an interval we
 * cannot describe, which must render as "nothing known", not as "nothing happened".
 */
export function scoreInterval(
  prev: MomentumHistoryPoint | undefined,
  next: MomentumHistoryPoint | undefined
): SideScores {
  let home = 0;
  let away = 0;
  let threat = 0;
  let observed = false;
  for (const key of INTERVAL_STAT_KEYS) {
    const dHome = growth(prev?.raw?.home, next?.raw?.home, key);
    const dAway = growth(prev?.raw?.away, next?.raw?.away, key);
    if (dHome == null && dAway == null) continue;
    observed = true;
    const w = MOMENTUM_WEIGHTS[key];
    home += (dHome ?? 0) * w;
    away += (dAway ?? 0) * w;
    if (THREAT_STAT_KEYS.includes(key)) {
      threat += ((dHome ?? 0) + (dAway ?? 0)) * w;
    }
  }
  // Same clamp the engine applies per team: card penalties dim a side, never invert it.
  return { home: Math.max(0, home), away: Math.max(0, away), threat: Math.max(0, threat), observed };
}

function classify(homeMomentum: number, awayMomentum: number) {
  const diff = homeMomentum - awayMomentum;
  return {
    side: (diff > DOMINANCE_THRESHOLD_PP ? "home" : diff < -DOMINANCE_THRESHOLD_PP ? "away" : "neutral") as
      | "home"
      | "away"
      | "neutral",
    magnitude: Math.min(1, Math.abs(diff) / 100)
  };
}

/**
 * The momentum series.
 *
 * Each interval runs from the PREVIOUS reading to this one and is scored from the GROWTH
 * of the counters across it — not from the totals standing at its end. That distinction is
 * the whole point: a side leading 14–4 on shots leads every cumulative snapshot, so a
 * snapshot-driven chart paints the entire match in one colour and claims a dominance the
 * data never showed. Deltas let the initiative change hands the way it does on the pitch.
 *
 * The first reading has no predecessor, so it stays a point (fromMinute === toMinute):
 * one sample at 63' says nothing about how the first hour was distributed.
 *
 * Rows recorded before raw stats were kept (or an interval where upstream reported no
 * counters) fall back to the cumulative snapshot, flagged `fromDelta: false`.
 */
export function buildMatchFlowSegments(history: MomentumHistoryPoint[]): MomentumSegment[] {
  const points = history.filter(isFinitePoint);
  const segments: MomentumSegment[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const pt = points[i];
    const prev = i > 0 ? points[i - 1] : undefined;
    const delta = prev ? scoreInterval(prev, pt) : { home: 0, away: 0, threat: 0, observed: false };

    if (prev && delta.observed) {
      const total = delta.home + delta.away;
      // No countable action at all: a genuinely quiet interval, level by construction.
      const homeMomentum = total > 0 ? Math.round((delta.home / total) * 100) : 50;
      const awayMomentum = 100 - homeMomentum;
      segments.push({
        fromMinute: prev.minute,
        toMinute: pt.minute,
        ...classify(homeMomentum, awayMomentum),
        homeMomentum,
        awayMomentum,
        intensity: Math.min(1, delta.threat / INTENSITY_REFERENCE),
        fromDelta: true
      });
      continue;
    }

    segments.push({
      fromMinute: prev ? prev.minute : pt.minute,
      toMinute: pt.minute,
      ...classify(pt.homeMomentum, pt.awayMomentum),
      homeMomentum: pt.homeMomentum,
      awayMomentum: pt.awayMomentum,
      fromDelta: false
    });
  }
  return segments;
}

export type ThreatLevel = "low" | "medium" | "high";

/** 30pp of separation — the visual cut between "on top" and "camped in their half". */
const HIGH_THREAT_PP = 30;

/**
 * Bar height tier.
 *
 * When the interval was observed as a delta, height reports its THREAT VOLUME: a passage
 * with no shot and no corner sits on the axis however lopsided its ratio was, which is
 * what "quiet" should look like. Thirds of INTENSITY_REFERENCE give the two cuts.
 *
 * Snapshot-only intervals have no volume to report, so they keep the original imbalance
 * ladder (the engine's own 10pp line, plus a 30pp cut for the top tier).
 */
export function threatLevel(
  segment: Pick<MomentumSegment, "side" | "magnitude"> & { intensity?: number }
): ThreatLevel {
  if (isNum(segment.intensity)) {
    if (segment.intensity <= 1 / 3) return "low";
    if (segment.intensity <= 2 / 3) return "medium";
    return "high";
  }
  if (segment.side === "neutral") return "low";
  const pp = segment.magnitude * 100;
  if (pp <= DOMINANCE_THRESHOLD_PP) return "low";
  if (pp <= HIGH_THREAT_PP) return "medium";
  return "high";
}

export type DominantPeriod = { fromMinute: number; toMinute: number; side: "home" | "away" };

/** A spell has to be sustained to be called one — a single interval is a moment, not a period. */
export const MIN_DOMINANT_SEGMENTS = 2;

/**
 * The longest unbroken run of intervals belonging to one side, taken from the series
 * itself rather than from whoever happens to lead right now. A run has to span at least
 * MIN_DOMINANT_SEGMENTS intervals and cover real minutes, so a lone blip is never
 * promoted into "they dominated that spell".
 */
export function findDominantPeriod(segments: MomentumSegment[]): DominantPeriod | null {
  let best: { period: DominantPeriod; count: number } | null = null;
  let run: { period: DominantPeriod; count: number } | null = null;
  for (const seg of segments) {
    if (seg.side === "home" || seg.side === "away") {
      run =
        run && run.period.side === seg.side
          ? { period: { ...run.period, toMinute: seg.toMinute }, count: run.count + 1 }
          : { period: { fromMinute: seg.fromMinute, toMinute: seg.toMinute, side: seg.side }, count: 1 };
      const span = run.period.toMinute - run.period.fromMinute;
      const bestSpan = best ? best.period.toMinute - best.period.fromMinute : -1;
      if (run.count >= MIN_DOMINANT_SEGMENTS && span > bestSpan) best = run;
    } else {
      run = null;
    }
  }
  return best && best.period.toMinute > best.period.fromMinute ? best.period : null;
}

/**
 * EVENT MARKERS.
 *
 * Events are facts, not momentum: they are placed on the same time axis so the reader can
 * line "what happened" up against "who was on top", but they never feed the bars. A card
 * is not dominance and a goal is not pressure — see buildMatchFlowSegments, which reads
 * only the statistics counters.
 *
 * Corners are absent by necessity, not by choice: /fixtures/events carries Goal, Card,
 * subst and Var only (mapLiveEventKind in api/fixtures.js), so corners exist purely as a
 * cumulative total with no minute attached. Drawing corner markers would mean inventing
 * their timing.
 */
/**
 * Which half a marker belongs in. Derived from the event's own team and from nothing
 * else — never from its index, its kind, its order, or from whoever the bars favour.
 */
export type EventMarkerSide = "home" | "away" | "neutral";

export type EventMarker = {
  event: MatchLiveEvent;
  /** 0..100 position along the axis. */
  pct: number;
  /** 0-based stacking row WITHIN this marker's own side. */
  lane: number;
  minute: number;
  /** The half this marker is drawn in; see eventSide. */
  side: EventMarkerSide;
};

/**
 * Team ownership of an event.
 *
 * Only the two identities the normalizer emits map to a half. Anything else — a team the
 * fixture does not recognise, a missing field, a payload that did not come through
 * extractLiveEvents — is NEUTRAL. It is deliberately not "home": filing an unattributable
 * event under the home side would make the chart state something the data never said, and
 * `team` is a compile-time union over a value that arrives from an HTTP response, so the
 * runtime check is the only one that actually holds.
 */
export function eventSide(event: { team?: unknown } | null | undefined): EventMarkerSide {
  const team = event?.team;
  return team === "home" || team === "away" ? team : "neutral";
}

/** Roughly one marker's own width at the narrowest supported viewport (16px on a ~324px chart). */
export const MARKER_MIN_GAP_PCT = 5;

/**
 * Markers never stack deeper than this; beyond it they share the last lane. The cap is
 * spent PER SIDE, so three crowded away events and three crowded home events coexist
 * rather than competing for the same three rows.
 */
export const MARKER_MAX_LANES = 3;

/**
 * Places events along the axis, in their own team's half, and stacks the ones that would
 * overlap. Events without a usable minute are dropped rather than parked at 0' — an
 * unknown minute is not minute zero. Order is chronological, so lane assignment is stable
 * between renders.
 *
 * Collision detection is horizontal (time) only, and is run SEPARATELY PER SIDE: two
 * teams acting in the same minute are not in each other's way, because they are not drawn
 * in the same half. Sharing one lane ladder — as this did before — silently let a busy
 * away spell decide where a home marker sat.
 */
export function layoutEventMarkers(
  events: MatchLiveEvent[] | undefined,
  maxMinute: number,
  minGapPct: number = MARKER_MIN_GAP_PCT
): EventMarker[] {
  const span = Math.max(1, maxMinute);
  const usable = (events ?? [])
    .filter((ev) => ev && isNum(ev.minute) && (ev.extra == null || isNum(ev.extra)))
    .map((ev) => ({ ev, minute: ev.minute + (ev.extra || 0) }))
    .sort((a, b) => a.minute - b.minute);

  /** AWAY_EVENT_LANES / HOME_EVENT_LANES / NEUTRAL_EVENT_LANES — one ladder each. */
  const laneLastPct: Record<EventMarkerSide, number[]> = { home: [], away: [], neutral: [] };
  const out: EventMarker[] = [];
  for (const { ev, minute } of usable) {
    const side = eventSide(ev);
    const lanes = laneLastPct[side];
    const pct = Math.min(100, Math.max(0, (minute / span) * 100));
    let lane = 0;
    while (lane < MARKER_MAX_LANES - 1 && lanes[lane] != null && pct - lanes[lane] < minGapPct) {
      lane += 1;
    }
    lanes[lane] = pct;
    out.push({ event: ev, pct, lane, minute, side });
  }
  return out;
}

/** The event kinds actually present, in a stable order — the legend shows these and no others. */
export function eventKindsPresent(markers: EventMarker[]): MatchLiveEvent["type"][] {
  const ORDER: MatchLiveEvent["type"][] = [
    "goal",
    "penalty",
    "ownGoal",
    "penaltyMissed",
    "yellow",
    "red",
    "substitution",
    "var"
  ];
  const present = new Set(markers.map((m) => m.event.type));
  return ORDER.filter((kind) => present.has(kind));
}
