import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchLiveEvent, MatchLiveEventType, MatchScore, MomentumRawStats, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Tooltip from "../../design-system/Tooltip";
import CollapsiblePanel from "../../design-system/CollapsiblePanel";

type Momentum = NonNullable<PredictionRow["momentum"]>;

type HistoryPoint = { minute: number; homeMomentum: number; awayMomentum: number };
type TimelineEvent = {
  minute: number;
  extra?: number | null;
  team: "home" | "away";
  kind: MatchLiveEventType;
  player?: string | null;
  assist?: string | null;
};
type EventFilter = "all" | "goal" | "card" | "substitution" | "var";
type WhyChip = { label: string; value: string };

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
};

function eventIcon(kind: MatchLiveEventType): string {
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

function eventLabel(t: (key: string) => string, kind: MatchLiveEventType): string {
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
function formatMinute(minute: number, extra?: number | null): string {
  return extra ? `${minute}+${extra}'` : `${minute}'`;
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

function statLabel(t: (key: string) => string, kind: keyof MomentumRawStats): string {
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

function deriveWhyChips(t: (key: string) => string, raw?: { home: MomentumRawStats; away: MomentumRawStats }): WhyChip[] {
  if (!raw) return [];
  const chips: WhyChip[] = [];
  for (const kind of WHY_CHIP_PRIORITY) {
    if (chips.length >= 2) break;
    const home = raw.home[kind];
    const away = raw.away[kind];
    if (home == null || away == null) continue;
    chips.push({
      label: statLabel(t, kind),
      value: kind === "possession" ? `${Math.round(home)}%` : `${home}–${away}`
    });
  }
  return chips;
}

/**
 * Deterministic, rule-based "Match Story" — every observation is a direct read of
 * already-computed live data (no AI, no extra requests). Rules are evaluated in a
 * fixed priority order and capped at 3; a rule only fires when its own threshold is
 * clearly met, so a quiet match legitimately yields zero observations.
 */
function buildMatchStory(
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

function StatRow({
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
      <span className="shrink-0 px-1 text-center text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
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

export default function MatchMomentumTimeline({
  fixtureId,
  status,
  score,
  momentum,
  homeTeam,
  awayTeam,
  liveEvents,
  recommendedPick,
  confidenceLabel
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
      ? "border-[var(--fp-accent)]/30 bg-[var(--fp-accent)]/10 text-[var(--fp-accent)]"
      : momentum.dominantTeam === "away"
        ? "border-[var(--fp-danger)]/30 bg-[var(--fp-danger)]/10 text-[var(--fp-danger)]"
        : "border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)]";

  // The single highest-priority observation becomes the headline sentence; a quiet match
  // (zero rules fired) falls back to an explicit neutral statement rather than showing nothing.
  const anchorText = matchStory[0] ?? t("match.momentumNeutral");
  const whyChips = deriveWhyChips(t, raw);
  const recentMoments = displayEvents.slice(-RECENT_MOMENTS_COUNT);

  return (
    <>
      <div className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]/50 p-3.5 shadow-[var(--fp-shadow-sm)] sm:p-4">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)] sm:text-[11px]">
          {t("card.momentum")}
        </p>

        <div className="mb-2.5 flex items-center justify-center gap-4 text-[9px] font-semibold uppercase tracking-wide text-[var(--fp-text-muted)] sm:text-[10px]">
          <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--fp-accent)]" />
            <span className="truncate">{homeTeam}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{awayTeam}</span>
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--fp-danger)]" />
          </span>
        </div>

        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--fp-border)]"
          role="img"
          aria-label={`${homeTeam} ${Math.round(momentum.homeMomentum)} – ${Math.round(momentum.awayMomentum)} ${awayTeam}`}
        >
          <div
            className="absolute inset-y-0 left-0 bg-[var(--fp-accent)] transition-[width] duration-500"
            style={{ width: `${momentum.homeMomentum}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-[var(--fp-danger)] transition-[width] duration-500"
            style={{ width: `${momentum.awayMomentum}%` }}
          />
        </div>

        <p className="mt-3 text-[13px] font-bold leading-snug text-[var(--fp-text)] sm:text-sm">{anchorText}</p>

        {whyChips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {whyChips.map((chip) => (
              <span
                key={chip.label}
                className="rounded-full border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2.5 py-1 font-mono text-[10px] font-semibold text-[var(--fp-text-muted)]"
              >
                {chip.label} {chip.value}
              </span>
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
                    <span className="font-mono text-[8px] font-semibold text-[var(--fp-text-muted)]">{minuteLabel}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-[var(--fp-border)] pt-3">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)] sm:text-[10px]">
              {t("match.momentumNext")}
            </p>
            <p className="truncate text-[13px] font-bold text-[var(--fp-text)] sm:text-sm">{recommendedPick}</p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--fp-accent)]/30 bg-[var(--fp-accent)]/10 px-2.5 py-1 font-mono text-[11px] font-bold text-[var(--fp-accent)]">
            {confidenceLabel}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <CollapsiblePanel title={t("match.momentumDetails")} compact>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide sm:text-[10px] ${dominantBadgeClass}`}
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

          <div className="relative h-24 w-full overflow-hidden rounded-[var(--fp-radius-sm)] sm:h-28">
            <div className="absolute inset-x-0 top-0 h-1/2 bg-[var(--fp-accent)]/[0.04]" />
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[var(--fp-danger)]/[0.04]" />
            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--fp-border)]" />
            <div className="flex h-full w-full items-stretch gap-px">
              {history.map((pt, i) => {
                const homeUp = pt.homeMomentum >= pt.awayMomentum;
                const magnitude = Math.abs(pt.homeMomentum - pt.awayMomentum) / 100;
                const barLabel = `${pt.minute}' · ${homeTeam} ${Math.round(pt.homeMomentum)} – ${Math.round(pt.awayMomentum)} ${awayTeam}`;
                return (
                  <div key={`${pt.minute}-${i}`} title={barLabel} className="flex flex-1 flex-col justify-center">
                    {homeUp ? (
                      <>
                        <div
                          className="w-full self-end rounded-t-[1px] bg-[var(--fp-accent)] transition-opacity duration-150 hover:opacity-80"
                          style={{ height: `${Math.max(4, magnitude * 100)}%` }}
                        />
                        <div className="w-full flex-1" />
                      </>
                    ) : (
                      <>
                        <div className="w-full flex-1" />
                        <div
                          className="w-full rounded-b-[1px] bg-[var(--fp-danger)] transition-opacity duration-150 hover:opacity-80"
                          style={{ height: `${Math.max(4, magnitude * 100)}%` }}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative mt-1.5 h-3 w-full">
            {ticks.map((m) => (
              <span
                key={m}
                className="absolute -translate-x-1/2 font-mono text-[8px] text-[var(--fp-text-muted)] sm:text-[9px]"
                style={{ left: xPct(m) }}
              >
                {m}'
              </span>
            ))}
            <span className="absolute right-0 font-mono text-[8px] text-[var(--fp-text-muted)] sm:text-[9px]">
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
                  <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
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
                    className="animate-card-in flex items-center gap-2 rounded-[var(--fp-radius-sm)] px-1.5 py-1.5 text-[11px] even:bg-[var(--fp-border)]/15 sm:text-xs"
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
      </div>
    </>
  );
}
