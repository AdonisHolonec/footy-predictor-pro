import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchLiveEvent, MatchLiveEventType, MatchScore, MomentumRawStats, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Tooltip from "../../design-system/Tooltip";
import CollapsiblePanel from "../../design-system/CollapsiblePanel";

type Momentum = NonNullable<PredictionRow["momentum"]>;

type HistoryPoint = { minute: number; homeMomentum: number; awayMomentum: number };
export type TimelineEvent = {
  minute: number;
  extra?: number | null;
  team: "home" | "away";
  kind: MatchLiveEventType;
  player?: string | null;
  assist?: string | null;
};
type EventFilter = "all" | "goal" | "card" | "substitution" | "var";
type WhyChip = { label: string; value: string; detail: string };

type Props = {
  fixtureId: number;
  status: string;
  score?: MatchScore;
  momentum: Momentum;
  homeTeam: string;
  awayTeam: string;
  /** Real match events from /fixtures/events — when present, these are used instead of the score/card-diff inference below. */
  liveEvents?: MatchLiveEvent[];
  /** match.recommended.pick — the prediction already computed elsewhere in MatchModal; never derived from momentum. */
  recommendedPick: string;
  /** Pre-formatted confidence string (e.g. "72%" or a locked/category label) — mirrors the header's own confidence gating so this widget never invents its own. */
  confidenceLabel: string;
  /** Real AI-generated one-sentence narration from the server (opt-in) — takes priority over the local deterministic sentence when present; null/absent is a normal, expected state, not an error. */
  momentumNarrative?: string | null;
  /** UX-D: the Live layer renders events, stats and the story as their own disclosures; false hides the nested panel here so nothing is stated twice. */
  detailsPanel?: boolean;
};

export function eventIcon(kind: MatchLiveEventType): string {
  switch (kind) {
    case "goal":
    case "penalty":
    case "ownGoal":
      return "⚽";
    case "penaltyMissed":
      return "❌";
    case "yellow":
      return "🟨";
    case "red":
      return "🟥";
    case "substitution":
      return "🔁";
    case "var":
      return "📺";
    default:
      return "•";
  }
}

export function eventLabel(t: (key: string) => string, kind: MatchLiveEventType): string {
  switch (kind) {
    case "goal":
      return t("match.eventGoal");
    case "ownGoal":
      return t("match.eventOwnGoal");
    case "penalty":
      return t("match.eventPenalty");
    case "penaltyMissed":
      return t("match.eventPenaltyMissed");
    case "yellow":
      return t("match.eventYellow");
    case "red":
      return t("match.eventRed");
    case "substitution":
      return t("match.eventSubstitution");
    case "var":
      return t("match.eventVar");
    default:
      return "";
  }
}

function eventGroup(kind: MatchLiveEventType): Exclude<EventFilter, "all"> {
  if (kind === "yellow" || kind === "red") return "card";
  if (kind === "substitution") return "substitution";
  if (kind === "var") return "var";
  return "goal";
}

/** "45'" or, when extra time is known, "45+2'". */
export function formatMinute(minute: number, extra?: number | null): string {
  return extra ? `${minute}+${extra}'` : `${minute}'`;
}

/**
 * One interval of the transparent momentum timeline. Pure presentation mapping —
 * classification reuses the exact ±10pp threshold MomentumEngine already applies
 * for `dominantTeam` (diff > 10 → home, < -10 → away, otherwise balanced), so the
 * strip never invents a dominance rule of its own.
 */
export type MomentumSegment = {
  /** Minute the interval starts at (previous point's minute, 0 for the first). */
  fromMinute: number;
  /** Minute the interval ends at (this point's minute). */
  toMinute: number;
  side: "home" | "away" | "neutral";
  /** 0..1 dominance magnitude — drives opacity within the team colour, never the hue. */
  magnitude: number;
  homeMomentum: number;
  awayMomentum: number;
};

/** Same threshold as MomentumEngine's dominantTeam — see server-utils/momentum/MomentumEngine.js. */
const DOMINANCE_THRESHOLD_PP = 10;

export function buildTimelineSegments(history: HistoryPoint[]): MomentumSegment[] {
  const segments: MomentumSegment[] = [];
  let from = 0;
  for (const pt of history) {
    const diff = pt.homeMomentum - pt.awayMomentum;
    segments.push({
      fromMinute: from,
      toMinute: pt.minute,
      side: diff > DOMINANCE_THRESHOLD_PP ? "home" : diff < -DOMINANCE_THRESHOLD_PP ? "away" : "neutral",
      magnitude: Math.min(1, Math.abs(diff) / 100),
      homeMomentum: pt.homeMomentum,
      awayMomentum: pt.awayMomentum
    });
    from = pt.minute;
  }
  return segments;
}

/**
 * Threat level for one interval — PRESENTATION ONLY.
 *
 * The bar's DIRECTION and its `magnitude` both come from buildTimelineSegments above,
 * which classifies with MomentumEngine's own +/-10pp rule. Nothing here re-derives
 * dominance or touches the momentum numbers; this maps an existing magnitude onto one
 * of three heights so the chart is readable without reading digits.
 *
 * The low boundary is not a new number: DOMINANCE_THRESHOLD_PP (10pp) is already the
 * point at which the engine stops calling an interval balanced, so anything at or below
 * it is the shortest bar. The medium/high split at 30pp is the one purely visual choice
 * in this file — three tiers need two cuts, and the engine only supplies one.
 */
export type ThreatLevel = "low" | "medium" | "high";

/** 30pp of separation — the visual cut between "on top" and "camped in their half". */
const HIGH_THREAT_PP = 30;

export function threatLevel(segment: Pick<MomentumSegment, "side" | "magnitude">): ThreatLevel {
  if (segment.side === "neutral") return "low";
  const pp = segment.magnitude * 100;
  if (pp <= DOMINANCE_THRESHOLD_PP) return "low";
  if (pp <= HIGH_THREAT_PP) return "medium";
  return "high";
}

/** Share of the half-height a bar fills, per tier. Neutral keeps a visible stub so a
 *  balanced passage reads as "measured and quiet", never as "no data". */
export const THREAT_HEIGHT_PCT: Record<ThreatLevel, number> = { low: 34, medium: 66, high: 100 };

/** Half-height share of the symmetric stub a balanced interval draws on both sides of
 *  the axis — present enough to say "we observed this minute", quiet enough not to be
 *  mistaken for either team having the ball. */
export const NEUTRAL_STUB_PCT = 12;

/**
 * Brightness ladder. COLOUR ONLY — it changes no height, position or classification.
 *
 * The reference reads dominance twice: once by direction, and once by brightness, with
 * the dominant spell in full-strength colour and every other passage dimmed to a muted
 * olive/grey. Highlighting only the newest bar left the dominant period carried by its
 * background band alone, so the chart lost the second reading.
 */
export const BAR_OPACITY = Object.freeze({
  /** The live moment still wins outright — it must never tie with older bars. */
  current: 1,
  /** Inside the engine-classified dominant run. */
  dominant: 0.94,
  /** Ordinary history: present, clearly subordinate. */
  history: 0.42,
  /** A balanced interval — quietest of all, and symmetric about the axis. */
  neutral: 0.3
});

export type DominantPeriod = { fromMinute: number; toMinute: number; side: "home" | "away" };

/**
 * The longest unbroken run of intervals already classified to the CURRENTLY dominant
 * team. This is grouping, not new logic: every `side` was decided by
 * buildTimelineSegments, and `dominantTeam` comes from the engine. Returns null when the
 * match is balanced or no run exists, so the annotation simply does not render.
 */
export function findDominantPeriod(
  segments: MomentumSegment[],
  dominantTeam: Momentum["dominantTeam"]
): DominantPeriod | null {
  if (dominantTeam !== "home" && dominantTeam !== "away") return null;
  let best: DominantPeriod | null = null;
  let run: DominantPeriod | null = null;
  for (const seg of segments) {
    if (seg.side === dominantTeam) {
      run = run
        ? { ...run, toMinute: seg.toMinute }
        : { fromMinute: seg.fromMinute, toMinute: seg.toMinute, side: dominantTeam };
      const span = run.toMinute - run.fromMinute;
      if (!best || span > best.toMinute - best.fromMinute) best = run;
    } else {
      run = null;
    }
  }
  // A single zero-length point is a blip, not a period.
  return best && best.toMinute > best.fromMinute ? best : null;
}

const EVENT_FILTERS: Array<{ id: EventFilter; labelKey: string }> = [
  { id: "all", labelKey: "match.filterAll" },
  { id: "goal", labelKey: "match.filterGoals" },
  { id: "card", labelKey: "match.filterCards" },
  { id: "substitution", labelKey: "match.filterSubs" },
  { id: "var", labelKey: "match.filterVar" }
];

const MAX_HISTORY_POINTS = 160;
/** Marker within this % of an edge gets its tooltip re-aligned so it doesn't clip off the card. */
const EDGE_ALIGN_PCT = 15;
/** Feed auto-scroll only kicks in when the user is already this close to the latest row. */
const STICK_TO_BOTTOM_PX = 24;
/** Compact "moments" strip in the default view shows only the most recent events — full history lives in the detail panel. */
const RECENT_MOMENTS_COUNT = 3;

export function statLabel(t: (key: string) => string, kind: keyof MomentumRawStats): string {
  switch (kind) {
    case "possession":
      return t("match.momentumPossession");
    case "shotsTotal":
      return t("match.momentumShots");
    case "shotsOnTarget":
      return t("match.momentumShotsOnTarget");
    case "corners":
      return t("match.momentumCorners");
    default:
      return "";
  }
}

/**
 * Highest-weighted stats in MomentumEngine first (shotsOnTarget .25, possession .2, corners/shotsTotal
 * .15 — see server-utils/momentum/MomentumEngine.js) — the "why" chips are whichever of these are
 * actually available for both sides, in that priority order, capped at two so they stay a glance, not a table.
 */
const WHY_CHIP_PRIORITY: Array<keyof MomentumRawStats> = ["shotsOnTarget", "possession", "corners", "shotsTotal"];

function deriveWhyChips(
  t: (key: string) => string,
  homeTeam: string,
  awayTeam: string,
  raw?: { home: MomentumRawStats; away: MomentumRawStats }
): WhyChip[] {
  if (!raw) return [];
  const chips: WhyChip[] = [];
  for (const kind of WHY_CHIP_PRIORITY) {
    if (chips.length >= 2) break;
    const home = raw.home[kind];
    const away = raw.away[kind];
    if (home == null || away == null) continue;
    const label = statLabel(t, kind);
    const value = kind === "possession" ? `${Math.round(home)}%` : `${home}–${away}`;
    const detail =
      kind === "possession"
        ? `${homeTeam} ${Math.round(home)}% – ${Math.round(away)}% ${awayTeam} · ${label}`
        : `${homeTeam} ${home} – ${away} ${awayTeam} · ${label}`;
    chips.push({ label, value, detail });
  }
  return chips;
}

/**
 * Deterministic, rule-based "Match Story" — every observation is a direct read of
 * already-computed live data (no AI, no extra requests). Rules are evaluated in a
 * fixed priority order and capped at 3; a rule only fires when its own threshold is
 * clearly met, so a quiet match legitimately yields zero observations.
 */
export function buildMatchStory(
  t: (key: string, params?: Record<string, string | number>) => string,
  momentum: Momentum,
  displayEvents: TimelineEvent[],
  homeTeam: string,
  awayTeam: string
): string[] {
  const observations: string[] = [];
  const raw = momentum.raw;

  const redCardHappened = displayEvents.some((ev) => ev.kind === "red");
  if (redCardHappened && momentum.trend !== "stable") {
    observations.push(t("match.storyRedCardShift"));
  }

  const subCount = displayEvents.filter((ev) => ev.kind === "substitution").length;
  if (subCount >= 2 && momentum.trend !== "stable") {
    observations.push(t("match.storySubsOpened"));
  }

  if (raw) {
    const possHome = raw.home.possession;
    const possAway = raw.away.possession;
    const sotHome = raw.home.shotsOnTarget;
    const sotAway = raw.away.shotsOnTarget;
    const possessionBalanced = possHome != null && possAway != null && Math.abs(possHome - possAway) <= 10;
    const sotGap = sotHome != null && sotAway != null ? Math.abs(sotHome - sotAway) : null;

    if (sotGap != null && sotGap >= 2) {
      const leadingTeam = sotHome! > sotAway! ? homeTeam : awayTeam;
      observations.push(
        possessionBalanced
          ? t("match.storyBalancedShots", { team: leadingTeam })
          : t("match.storyDangerousChances", { team: leadingTeam })
      );
    }
  }

  if (momentum.dominantTeam !== "balanced" && momentum.confidence >= 50) {
    const team = momentum.dominantTeam === "home" ? homeTeam : awayTeam;
    observations.push(t("match.storyDominance", { team }));
  }

  return observations.slice(0, 3);
}

export function StatRow({
  label,
  home,
  away,
  suffix = ""
}: {
  label: string;
  home: number | null;
  away: number | null;
  suffix?: string;
}) {
  if (home == null && away == null) return null;
  const h = home ?? 0;
  const a = away ?? 0;
  const total = h + a;
  const homeShare = total > 0 ? h / total : 0.5;
  return (
    <div className="flex items-center gap-2 text-[11px] sm:text-xs">
      <span className="w-8 shrink-0 text-right font-mono font-semibold tabular-nums text-[var(--fp-accent)]">
        {home != null ? `${home}${suffix}` : "—"}
      </span>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--fp-border)]">
        <div
          className="h-full origin-left bg-[var(--fp-accent)] transition-transform duration-500"
          style={{ transform: `scaleX(${homeShare})`, width: "100%" }}
        />
      </div>
      <span className="shrink-0 px-1 text-center text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
        {label}
      </span>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--fp-border)]">
        <div
          className="ml-auto h-full origin-right bg-[var(--fp-danger)] transition-transform duration-500"
          style={{ transform: `scaleX(${1 - homeShare})`, width: "100%" }}
        />
      </div>
      <span className="w-8 shrink-0 font-mono font-semibold tabular-nums text-[var(--fp-danger)]">
        {away != null ? `${away}${suffix}` : "—"}
      </span>
    </div>
  );
}

/** Animates a displayed integer toward `target` over `durationMs` — jumps straight there under prefers-reduced-motion. */
function useCountUp(target: number | null, durationMs = 500): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const fromRef = useRef<number | null>(target);

  useEffect(() => {
    if (target == null) {
      fromRef.current = null;
      setDisplay(null);
      return;
    }
    const from = fromRef.current ?? target;
    if (from === target) {
      setDisplay(target);
      return;
    }
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setDisplay(Math.round(from + (target - from) * progress));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return display;
}

export default function MatchMomentumTimeline({
  fixtureId,
  status,
  score,
  momentum,
  homeTeam,
  awayTeam,
  liveEvents,
  recommendedPick,
  confidenceLabel,
  momentumNarrative,
  detailsPanel = true
}: Props) {
  const { t } = useLocale();
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [inferredEvents, setInferredEvents] = useState<TimelineEvent[]>([]);
  const [filter, setFilter] = useState<EventFilter>("all");
  const fixtureRef = useRef<number | null>(null);
  const prevRef = useRef<{
    minute: number;
    scoreHome: number | null;
    scoreAway: number | null;
    raw?: { home: MomentumRawStats; away: MomentumRawStats };
  } | null>(null);
  const feedRef = useRef<HTMLUListElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Only a pure "NN%" label gets the count-up treatment — category/locked text (e.g. "Strong", "Locked")
  // cross-fades instead, since there's no number to animate toward.
  const confidenceNumericMatch = /^(\d+)%$/.exec(confidenceLabel);
  const confidenceNumeric = confidenceNumericMatch ? Number(confidenceNumericMatch[1]) : null;
  const animatedConfidence = useCountUp(confidenceNumeric, 500);

  const minute = score?.minute ?? null;
  // Real upstream events (goals/cards/subs/VAR with player names) take priority — the
  // score/card-diff inference below only ever fills in when the API gave us nothing.
  const hasRealEvents = Boolean(liveEvents && liveEvents.length);

  useEffect(() => {
    if (fixtureRef.current !== fixtureId) {
      fixtureRef.current = fixtureId;
      prevRef.current = null;
      setHistory([]);
      setInferredEvents([]);
    }
    if (minute == null) return;

    setHistory((prev) => {
      if (prev.length && prev[prev.length - 1].minute === minute) return prev;
      const next = [...prev, { minute, homeMomentum: momentum.homeMomentum, awayMomentum: momentum.awayMomentum }];
      return next.length > MAX_HISTORY_POINTS ? next.slice(next.length - MAX_HISTORY_POINTS) : next;
    });

    // Real events already carry minute/team/player straight from upstream — skip the
    // inference entirely once they're available, per the fallback-only contract.
    if (!hasRealEvents) {
      const prev = prevRef.current;
      if (prev) {
        const newEvents: TimelineEvent[] = [];
        const scoreHome = score?.home ?? null;
        const scoreAway = score?.away ?? null;
        if (prev.scoreHome != null && scoreHome != null && scoreHome > prev.scoreHome) {
          newEvents.push({ minute, team: "home", kind: "goal" });
        }
        if (prev.scoreAway != null && scoreAway != null && scoreAway > prev.scoreAway) {
          newEvents.push({ minute, team: "away", kind: "goal" });
        }
        const prevRaw = prev.raw;
        const raw = momentum.raw;
        if (prevRaw && raw) {
          (["home", "away"] as const).forEach((side) => {
            const prevSide = prevRaw[side];
            const nextSide = raw[side];
            if (prevSide.yellowCards != null && nextSide.yellowCards != null && nextSide.yellowCards > prevSide.yellowCards) {
              newEvents.push({ minute, team: side, kind: "yellow" });
            }
            if (prevSide.redCards != null && nextSide.redCards != null && nextSide.redCards > prevSide.redCards) {
              newEvents.push({ minute, team: side, kind: "red" });
            }
          });
        }
        if (newEvents.length) {
          setInferredEvents((prevEvents) => {
            const next = [...prevEvents, ...newEvents];
            return next.length > MAX_HISTORY_POINTS ? next.slice(next.length - MAX_HISTORY_POINTS) : next;
          });
        }
      }
    }

    prevRef.current = {
      minute,
      scoreHome: score?.home ?? null,
      scoreAway: score?.away ?? null,
      raw: momentum.raw
    };
  }, [fixtureId, minute, momentum.homeMomentum, momentum.awayMomentum, momentum.raw, score?.home, score?.away, hasRealEvents]);

  const displayEvents: TimelineEvent[] = useMemo(() => {
    if (hasRealEvents) {
      return liveEvents!.map((ev) => ({
        minute: ev.minute,
        extra: ev.extra,
        team: ev.team,
        kind: ev.type,
        player: ev.player,
        assist: ev.assist
      }));
    }
    return inferredEvents;
  }, [hasRealEvents, liveEvents, inferredEvents]);

  const filteredEvents = useMemo(
    () => (filter === "all" ? displayEvents : displayEvents.filter((ev) => eventGroup(ev.kind) === filter)),
    [displayEvents, filter]
  );

  const matchStory = useMemo(
    () => buildMatchStory(t, momentum, displayEvents, homeTeam, awayTeam),
    [t, momentum, displayEvents, homeTeam, awayTeam]
  );

  // Auto-scroll the feed to the newest row, but only when the user hasn't scrolled away —
  // never fight manual scrolling.
  useEffect(() => {
    const el = feedRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [filteredEvents.length]);

  const handleFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < STICK_TO_BOTTOM_PX;
  };

  if (!history.length) return null;

  const maxMinute = Math.max(90, minute ?? 0, ...displayEvents.map((ev) => ev.minute + (ev.extra || 0)));
  const posPct = (m: number) => Math.min(100, Math.max(0, (m / maxMinute) * 100));
  const xPct = (m: number) => `${posPct(m)}%`;
  const ticks = [0, 15, 30, 45, 60, 75, 90].filter((m) => m <= maxMinute);

  const dominantLabel =
    momentum.dominantTeam === "home"
      ? t("match.momentumDominantHome")
      : momentum.dominantTeam === "away"
        ? t("match.momentumDominantAway")
        : t("match.momentumDominantBalanced");

  const raw = momentum.raw;

  const dominantBadgeClass =
    momentum.dominantTeam === "home"
      ? "border-fp-accent/30 bg-fp-accent/10 text-[var(--fp-accent)]"
      : momentum.dominantTeam === "away"
        ? "border-fp-danger/30 bg-fp-danger/10 text-[var(--fp-danger)]"
        : "border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)]";

  // Real AI narration (when the server generated one) leads; the deterministic rule engine is the
  // fallback, not a replacement — it still powers the full "Match Story" list below either way. A
  // quiet match with neither source firing gets an explicit neutral statement, never a blank line.
  const isAiAnchor = Boolean(momentumNarrative);
  const anchorText = momentumNarrative || matchStory[0] || t("match.momentumNeutral");
  const whyChips = deriveWhyChips(t, homeTeam, awayTeam, raw);
  const recentMoments = displayEvents.slice(-RECENT_MOMENTS_COUNT);

  // Transparent segmented timeline — the approved momentum visual. Each segment is one
  // observed interval, coloured by the team identity colour the whole app already uses
  // for Home/Away (--fp-accent / --fp-danger — the same pair as the legend dots, StatRow
  // and every other Home/Away cue); balanced intervals get a discreet neutral treatment.
  const timelineSegments = buildTimelineSegments(history);
  const stripEndMinute = Math.max(maxMinute, 1);

  const dominantPeriod = findDominantPeriod(timelineSegments, momentum.dominantTeam);
  const latestSegment = timelineSegments[timelineSegments.length - 1];
  /*
    ACCESSIBILITY (a11y): the chart encodes meaning in colour AND vertical direction, so
    neither is available to a screen reader or to a colour-blind reader. This sentence
    states the same three facts in words — who is on top, how strong the current threat
    is, and whose the dominant period was — and is the chart element's accessible name.
    Every fragment is i18n; nothing here is hard-coded English.
  */
  const chartSummary = [
    `${t("card.momentum")}: ${dominantLabel}`,
    `${t("match.momentumCurrentThreat")}: ${t(
      `match.momentumThreat${(() => {
        const l = latestSegment ? threatLevel(latestSegment) : "low";
        return `${l[0].toUpperCase()}${l.slice(1)}`;
      })()}`
    )}`,
    dominantPeriod
      ? `${t("match.momentumDominantPeriod")}: ${dominantPeriod.side === "home" ? homeTeam : awayTeam}`
      : null
  ]
    .filter(Boolean)
    .join(". ");

  const segmentTitle = (seg: MomentumSegment) => {
    const range =
      seg.fromMinute === seg.toMinute
        ? formatMinute(seg.toMinute)
        : `${seg.fromMinute}–${seg.toMinute} min`;
    const who =
      seg.side === "home" ? homeTeam : seg.side === "away" ? awayTeam : t("match.momentumDominantBalanced");
    return `${range} · ${who} · ${Math.round(seg.homeMomentum)}–${Math.round(seg.awayMomentum)}`;
  };

  return (
    <>
      {/* Deliberately background-free: the momentum block inherits the match card's own
          surface — no card-in-card, no opaque panel (see the approved transparent design). */}
      <section data-testid="momentum-root" className="bg-transparent">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)] sm:text-[11px]">
            {t("card.momentum")}
          </p>
          {/* Explanatory copy is desktop-only: on a 390px card the chart plus two legends
              is already the whole budget, and a sentence here pushes the graph below the
              fold for the reader who most needs to see it. */}
          <p className="hidden min-w-0 truncate text-[10px] text-[var(--fp-text-muted)] lg:block">
            {t("match.momentumHowToRead")}
          </p>
        </div>

        {/* LEGEND — team identity. Swatches are the same colours the bars use, so the
            key teaches the chart rather than sitting beside it. */}
        <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
          <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[var(--fp-momentum-home)]" />
            <span className="truncate">{homeTeam}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{awayTeam}</span>
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-[var(--fp-border)] bg-[var(--fp-momentum-away)]"
            />
          </span>
        </div>

        {/* GRAPH — one bar per observed interval, mirrored about a central baseline.
            Direction is the interval's own `side`; height is its own `magnitude`. Both
            come from buildTimelineSegments, i.e. from MomentumEngine's numbers. */}
        <div
          data-testid="momentum-chart"
          role="img"
          aria-label={chartSummary}
          className="relative w-full select-none bg-transparent"
        >
          {dominantPeriod && (
            <div
              aria-hidden
              data-testid="momentum-dominant-bracket"
              /*
                A tinted BAND, not a boxed-in rectangle. A full-height dashed border read
                as an empty container in QA and pulled more attention than the bars it was
                meant to annotate; a soft wash plus a single top rule marks the span while
                staying behind the data.
              */
              className="pointer-events-none absolute inset-y-0 z-0 border-t border-[var(--fp-border)]"
              style={{
                /*
                  The fill goes through the -rgb companion token rather than a Tailwind
                  opacity modifier on a var() colour: that combination compiles to
                  nothing in Tailwind 3.4 (the whole class is dropped), which
                  tokens.guard.test.ts enforces across src/.
                */
                background: "rgb(var(--fp-bg-muted-rgb) / 0.55)",
                left: xPct(dominantPeriod.fromMinute),
                width: `${Math.max(0, posPct(dominantPeriod.toMinute) - posPct(dominantPeriod.fromMinute))}%`
              }}
            />
          )}

          <div className="relative z-[1] flex h-[68px] w-full items-stretch gap-px sm:h-[92px]">
            {timelineSegments.map((seg, i) => {
              const level = threatLevel(seg);
              const height = THREAT_HEIGHT_PCT[level];
              const isLatest = i === timelineSegments.length - 1;
              const isNeutral = seg.side === "neutral";
              const isHome = seg.side === "home";
              const inDominant =
                dominantPeriod != null &&
                seg.side === dominantPeriod.side &&
                seg.fromMinute >= dominantPeriod.fromMinute &&
                seg.toMinute <= dominantPeriod.toMinute;
              const barOpacity = isNeutral
                ? BAR_OPACITY.neutral
                : isLatest
                  ? BAR_OPACITY.current
                  : inDominant
                    ? BAR_OPACITY.dominant
                    : BAR_OPACITY.history;
              const colour =
                seg.side === "neutral"
                  ? "var(--fp-text-muted)"
                  : isHome
                    ? "var(--fp-momentum-home)"
                    : "var(--fp-momentum-away)";
              return (
                <div
                  key={`${seg.fromMinute}-${seg.toMinute}-${i}`}
                  data-side={seg.side}
                  data-level={level}
                  data-latest={isLatest || undefined}
                  data-dominant={inDominant || undefined}
                  title={segmentTitle(seg)}
                  className="flex min-w-[2px] flex-col justify-center"
                  style={{ flexGrow: Math.max(1, seg.toMinute - seg.fromMinute), flexBasis: 0 }}
                >
                  {/*
                    A BALANCED interval straddles the axis instead of sitting under it.
                    Below-the-line is the away identity, so rendering a neutral stub there
                    read as "Chelsea had that spell" in QA when the engine had actually
                    called it level. Symmetry is what says "neither".
                  */}
                  {/* Upper half — home grows DOWN toward the baseline. */}
                  <div className="flex h-1/2 flex-col justify-end">
                    {(isHome || isNeutral) && (
                      <span
                        className="block w-full rounded-t-[2px]"
                        style={{
                          height: `${isNeutral ? NEUTRAL_STUB_PCT : height}%`,
                          background: colour,
                          opacity: barOpacity
                        }}
                      />
                    )}
                  </div>
                  {/* Lower half — away grows DOWN away from the baseline. */}
                  <div className="flex h-1/2 flex-col justify-start">
                    {(!isHome || isNeutral) && (
                      <span
                        className="block w-full rounded-b-[2px]"
                        style={{
                          height: `${isNeutral ? NEUTRAL_STUB_PCT : height}%`,
                          background: colour,
                          opacity: barOpacity
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {/* Un-played remainder — keeps minute proportions honest against the ticks. */}
            {stripEndMinute > (history[history.length - 1]?.minute ?? 0) && (
              <div
                aria-hidden
                style={{ flexGrow: stripEndMinute - (history[history.length - 1]?.minute ?? 0), flexBasis: 0 }}
              />
            )}
          </div>

          {/* The baseline itself — drawn over the bars so the mirror axis is unambiguous. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 z-[2] h-px -translate-y-1/2 bg-[var(--fp-border)]"
          />
        </div>

        <div className="relative mt-1 h-3 w-full" aria-hidden>
          {ticks.map((m) => {
            /*
              Edge ticks are clamped INWARD instead of being centred on their minute.
              A centred label at 0% or 100% hangs half its width outside the chart —
              measured at 8.3px past the card edge for the 90' tick at a 390px viewport.
              Only the two end labels move, and only by half their own width, so the
              tick still reads against the position it marks.
            */
            const pct = posPct(m);
            const align =
              pct <= 0 ? "translate-x-0" : pct >= 100 ? "-translate-x-full" : "-translate-x-1/2";
            return (
              <span
                key={m}
                className={`absolute ${align} font-mono text-[10px] text-[var(--fp-text-muted)] sm:text-[10px]`}
                style={{ left: xPct(m) }}
              >
                {m}'
              </span>
            );
          })}
        </div>

        {/* THREAT LEGEND — real bars, not words alone, so height becomes readable.
            DOMINANT PERIOD annotation shares the row and collapses to the team name
            alone on mobile. */}
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-end gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">
            {(["low", "medium", "high"] as const).map((lvl) => (
              <span key={lvl} className="flex items-end gap-1">
                <span
                  aria-hidden
                  className="w-1 rounded-[1px] bg-[var(--fp-text-muted)]"
                  /*
                    A SAMPLE of the bar, deliberately small: it must teach the height
                    ladder without competing with the chart it explains. The ratios match
                    THREAT_HEIGHT_PCT (34/66/100) scaled into a 4-10px band.
                  */
                  style={{
                    height: `${Math.round((THREAT_HEIGHT_PCT[lvl] / 100) * 10)}px`,
                    opacity: 0.4 + THREAT_HEIGHT_PCT[lvl] / 250
                  }}
                />
                <span>{t(`match.momentumThreat${lvl[0].toUpperCase()}${lvl.slice(1)}`)}</span>
              </span>
            ))}
          </div>
          {dominantPeriod && (
            <span
              data-testid="momentum-dominant-label"
              className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]"
            >
              <span className="hidden sm:inline">{t("match.momentumDominantPeriod")} — </span>
              {dominantPeriod.side === "home" ? homeTeam : awayTeam}
            </span>
          )}
        </div>

        <p
          key={anchorText}
          className="mt-3 flex animate-card-in items-start gap-1.5 text-xs font-bold leading-snug text-[var(--fp-text)] motion-reduce:animate-none sm:text-sm"
        >
          <span>{anchorText}</span>
          {isAiAnchor && (
            <span
              title={t("match.momentumInsightBadge")}
              className="mt-0.5 shrink-0 rounded-full border border-fp-accent/30 bg-fp-accent/10 px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-accent)]"
            >
              {t("match.momentumInsightBadge")}
            </span>
          )}
        </p>

        {whyChips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {whyChips.map((chip) => (
              <Tooltip key={chip.label} label={chip.detail}>
                <button
                  type="button"
                  className="rounded-full border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2.5 py-1 font-mono text-[10px] font-semibold text-[var(--fp-text-muted)] transition-colors duration-150 hover:border-fp-accent/40 hover:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
                >
                  {chip.label} {chip.value}
                </button>
              </Tooltip>
            ))}
          </div>
        )}

        {recentMoments.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5">
            {recentMoments.map((ev, i) => {
              const teamName = ev.team === "home" ? homeTeam : awayTeam;
              const label = eventLabel(t, ev.kind);
              const minuteLabel = formatMinute(ev.minute, ev.extra);
              const tooltipLabel = ev.player
                ? ev.assist
                  ? `${teamName} · ${minuteLabel} · ${label} · ${ev.player} (${t("match.eventAssist")}: ${ev.assist})`
                  : `${teamName} · ${minuteLabel} · ${label} · ${ev.player}`
                : `${teamName} · ${minuteLabel} · ${label}`;
              return (
                <Tooltip key={`${ev.minute}-${ev.extra ?? 0}-${ev.kind}-${ev.team}-${ev.player ?? i}`} label={tooltipLabel}>
                  <button
                    type="button"
                    aria-label={tooltipLabel}
                    className="animate-card-in flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-[var(--fp-border)] bg-[var(--fp-bg-card)] transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
                  >
                    <span aria-hidden className="text-sm leading-none">
                      {eventIcon(ev.kind)}
                    </span>
                    <span className="font-mono text-[10px] font-semibold text-[var(--fp-text-muted)]">{minuteLabel}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-[var(--fp-border)] pt-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)] sm:text-[10px]">
              {t("match.momentumNext")}
            </p>
            <p className="truncate text-xs font-bold text-[var(--fp-text)] sm:text-sm">{recommendedPick}</p>
          </div>
          <span
            key={confidenceNumeric != null ? "numeric" : confidenceLabel}
            className={`shrink-0 rounded-full border border-fp-accent/30 bg-fp-accent/10 px-2.5 py-1 font-mono text-[11px] font-bold tabular-nums text-[var(--fp-accent)] ${
              confidenceNumeric == null ? "animate-card-in motion-reduce:animate-none" : ""
            }`}
          >
            {confidenceNumeric != null ? `${animatedConfidence ?? confidenceNumeric}%` : confidenceLabel}
          </span>
        </div>
      </section>

      {detailsPanel && <div className="mt-3">
        <CollapsiblePanel title={t("match.momentumDetails")} compact>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:text-[10px] ${dominantBadgeClass}`}
            >
              {dominantLabel}
            </span>
          </div>

          {displayEvents.length > 0 && (
            <div className="relative mb-1 h-7 w-full">
              {displayEvents.map((ev, i) => {
                const teamName = ev.team === "home" ? homeTeam : awayTeam;
                const label = eventLabel(t, ev.kind);
                const minuteLabel = formatMinute(ev.minute, ev.extra);
                const tooltipLabel = ev.player
                  ? ev.assist
                    ? `${teamName} · ${minuteLabel} · ${label} · ${ev.player} (${t("match.eventAssist")}: ${ev.assist})`
                    : `${teamName} · ${minuteLabel} · ${label} · ${ev.player}`
                  : `${teamName} · ${minuteLabel} · ${label}`;
                const pct = posPct(ev.minute + (ev.extra || 0));
                const align = pct < EDGE_ALIGN_PCT ? "start" : pct > 100 - EDGE_ALIGN_PCT ? "end" : "center";
                return (
                  <div
                    key={`${ev.minute}-${ev.extra ?? 0}-${ev.kind}-${ev.team}-${ev.player ?? i}`}
                    className="absolute top-0 -translate-x-1/2"
                    style={{ left: xPct(ev.minute + (ev.extra || 0)) }}
                  >
                    <Tooltip label={tooltipLabel} align={align}>
                      <button
                        type="button"
                        aria-label={tooltipLabel}
                        className="animate-card-in flex h-7 w-7 items-center justify-center rounded-full text-[11px] leading-none transition-transform duration-150 hover:scale-110 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
                      >
                        {eventIcon(ev.kind)}
                      </button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          )}

          {/* The momentum timeline itself now lives in the main (transparent) view above —
              the detail panel keeps the event axis, stats, story and feed without
              duplicating the chart in a second tinted panel. */}
          <div className="relative mt-1.5 h-3 w-full">
            {ticks.map((m) => (
              <span
                key={m}
                className="absolute -translate-x-1/2 font-mono text-[10px] text-[var(--fp-text-muted)] sm:text-[10px]"
                style={{ left: xPct(m) }}
              >
                {m}'
              </span>
            ))}
            <span className="absolute right-0 font-mono text-[10px] text-[var(--fp-text-muted)] sm:text-[10px]">
              {status === "HT" ? "HT" : status === "FT" ? "FT" : ""}
            </span>
          </div>

          {raw && (
            <div className="mt-4 space-y-2 border-t border-[var(--fp-border)] pt-3">
              <StatRow label={statLabel(t, "possession")} home={raw.home.possession} away={raw.away.possession} suffix="%" />
              <StatRow label={statLabel(t, "shotsTotal")} home={raw.home.shotsTotal} away={raw.away.shotsTotal} />
              <StatRow
                label={statLabel(t, "shotsOnTarget")}
                home={raw.home.shotsOnTarget}
                away={raw.away.shotsOnTarget}
              />
              <StatRow label={statLabel(t, "corners")} home={raw.home.corners} away={raw.away.corners} />
              {(raw.home.yellowCards != null ||
                raw.away.yellowCards != null ||
                raw.home.redCards != null ||
                raw.away.redCards != null) && (
                <div className="flex items-center justify-center gap-3 pt-1 text-[11px] sm:text-xs">
                  <span className="font-mono font-semibold tabular-nums text-[var(--fp-text)]">
                    {raw.home.yellowCards != null && raw.home.yellowCards > 0 ? `🟨${raw.home.yellowCards} ` : ""}
                    {raw.home.redCards != null && raw.home.redCards > 0 ? `🟥${raw.home.redCards}` : ""}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
                    {t("match.momentumCards")}
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-[var(--fp-text)]">
                    {raw.away.yellowCards != null && raw.away.yellowCards > 0 ? `🟨${raw.away.yellowCards} ` : ""}
                    {raw.away.redCards != null && raw.away.redCards > 0 ? `🟥${raw.away.redCards}` : ""}
                  </span>
                </div>
              )}
            </div>
          )}

          {matchStory.length > 0 && (
            <div className="mt-4 border-t border-[var(--fp-border)] pt-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)] sm:text-[11px]">
                {t("match.storyTitle")}
              </p>
              <ul className="space-y-1.5">
                {matchStory.map((line, i) => (
                  <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-[var(--fp-text)] sm:text-xs">
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--fp-accent)]" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {displayEvents.length > 0 && (
            <div className="mt-4 border-t border-[var(--fp-border)] pt-3">
              <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={t("match.filtersLabel")}>
                {EVENT_FILTERS.map(({ id, labelKey }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    className={`h-8 touch-manipulation rounded-md px-3 text-[10px] font-bold uppercase tracking-wide transition-colors duration-150 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                      filter === id
                        ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                        : "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-card)] hover:text-[var(--fp-text)]"
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
              <ul
                ref={feedRef}
                onScroll={handleFeedScroll}
                role="list"
                className="max-h-36 space-y-0.5 overflow-y-auto sm:max-h-44"
              >
                {filteredEvents.map((ev, i) => (
                  <li
                    key={`${ev.minute}-${ev.extra ?? 0}-${ev.kind}-${ev.team}-${ev.player ?? i}`}
                    className="animate-card-in flex items-center gap-2 rounded-[var(--fp-radius-sm)] px-1.5 py-1.5 text-[11px] even:bg-[var(--fp-border)] sm:text-xs"
                  >
                    <span className="w-9 shrink-0 font-mono tabular-nums text-[var(--fp-text-muted)]">
                      {formatMinute(ev.minute, ev.extra)}
                    </span>
                    <span aria-hidden className="shrink-0">
                      {eventIcon(ev.kind)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--fp-text)]">
                      <span className="font-semibold">{ev.team === "home" ? homeTeam : awayTeam}</span>
                      {` · ${eventLabel(t, ev.kind)}`}
                      {ev.player ? ` · ${ev.player}` : ""}
                      {ev.assist ? ` (${t("match.eventAssist")}: ${ev.assist})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CollapsiblePanel>
      </div>}
    </>
  );
}
