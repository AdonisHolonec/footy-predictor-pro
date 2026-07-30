import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchLiveEvent, MatchLiveEventType, MatchScore, MomentumRawStats, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Tooltip from "../../design-system/Tooltip";

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

type Props = {
  fixtureId: number;
  status: string;
  score?: MatchScore;
  momentum: Momentum;
  homeTeam: string;
  awayTeam: string;
  /** Real match events from /fixtures/events — when present, these are used instead of the score/card-diff inference below. */
  liveEvents?: MatchLiveEvent[];
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
    <div className="flex items-center gap-2 text-[10px] sm:text-[11px]">
      <span className="w-7 shrink-0 text-right font-mono font-semibold tabular-nums text-[var(--fp-text)]">
        {home != null ? `${home}${suffix}` : "—"}
      </span>
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--fp-border)]">
        <div
          className="h-full origin-left bg-[var(--fp-accent)] transition-transform duration-500"
          style={{ transform: `scaleX(${homeShare})`, width: "100%" }}
        />
      </div>
      <span className="shrink-0 px-1 text-center text-[8px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
        {label}
      </span>
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--fp-border)]">
        <div
          className="ml-auto h-full origin-right bg-[var(--fp-danger)] transition-transform duration-500"
          style={{ transform: `scaleX(${1 - homeShare})`, width: "100%" }}
        />
      </div>
      <span className="w-7 shrink-0 font-mono font-semibold tabular-nums text-[var(--fp-text)]">
        {away != null ? `${away}${suffix}` : "—"}
      </span>
    </div>
  );
}

export default function MatchMomentumTimeline({ fixtureId, status, score, momentum, homeTeam, awayTeam, liveEvents }: Props) {
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

  return (
    <>
    <div className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)]/50 p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)] sm:text-[10px]">
          {t("card.momentum")}
        </p>
        <p className="text-[9px] font-semibold text-[var(--fp-text-muted)] sm:text-[10px]">{dominantLabel}</p>
      </div>

      {displayEvents.length > 0 && (
        <div className="relative mb-1 h-5 w-full">
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
                className="absolute -translate-x-1/2"
                style={{ left: xPct(ev.minute + (ev.extra || 0)) }}
              >
                <Tooltip label={tooltipLabel} align={align}>
                  <button
                    type="button"
                    aria-label={tooltipLabel}
                    className="animate-card-in rounded-full text-[10px] leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
                  >
                    {eventIcon(ev.kind)}
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      <div className="relative h-20 w-full sm:h-24">
        <div className="absolute inset-x-0 top-1/2 border-t border-[var(--fp-border)]" />
        <div className="flex h-full w-full items-stretch gap-px">
          {history.map((pt, i) => {
            const homeUp = pt.homeMomentum >= pt.awayMomentum;
            const magnitude = Math.abs(pt.homeMomentum - pt.awayMomentum) / 100;
            return (
              <div key={`${pt.minute}-${i}`} className="flex flex-1 flex-col justify-center">
                {homeUp ? (
                  <>
                    <div
                      className="w-full self-end rounded-t-[1px] bg-[var(--fp-accent)]"
                      style={{ height: `${Math.max(4, magnitude * 100)}%` }}
                    />
                    <div className="w-full flex-1" />
                  </>
                ) : (
                  <>
                    <div className="w-full flex-1" />
                    <div
                      className="w-full rounded-b-[1px] bg-[var(--fp-danger)]"
                      style={{ height: `${Math.max(4, magnitude * 100)}%` }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative mt-1 h-3 w-full">
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
        <div className="mt-3 space-y-1.5 border-t border-[var(--fp-border)] pt-2.5">
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
            <div className="flex items-center justify-center gap-3 pt-0.5 text-[10px] sm:text-[11px]">
              <span className="font-mono font-semibold tabular-nums text-[var(--fp-text)]">
                {raw.home.yellowCards != null && raw.home.yellowCards > 0 ? `🟨${raw.home.yellowCards} ` : ""}
                {raw.home.redCards != null && raw.home.redCards > 0 ? `🟥${raw.home.redCards}` : ""}
              </span>
              <span className="text-[8px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">
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

      {displayEvents.length > 0 && (
        <div className="mt-3 border-t border-[var(--fp-border)] pt-2.5">
          <div className="mb-1.5 flex flex-wrap gap-1" role="group" aria-label={t("match.filtersLabel")}>
            {EVENT_FILTERS.map(({ id, labelKey }) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`h-6 rounded-md px-2 text-[9px] font-bold uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                  filter === id
                    ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                    : "text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
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
            className="max-h-32 space-y-0.5 overflow-y-auto"
          >
            {filteredEvents.map((ev, i) => (
              <li
                key={`${ev.minute}-${ev.extra ?? 0}-${ev.kind}-${ev.team}-${ev.player ?? i}`}
                className="animate-card-in flex items-center gap-2 rounded-[var(--fp-radius-sm)] px-1 py-1 text-[10px] sm:text-[11px]"
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
    </div>

    {matchStory.length > 0 && (
      <div className="mt-3 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 sm:p-4">
        <p className="mb-2 text-[9px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)] sm:text-[10px]">
          {t("match.storyTitle")}
        </p>
        <ul className="space-y-1">
          {matchStory.map((line, i) => (
            <li key={i} className="flex gap-1.5 text-[10px] leading-snug text-[var(--fp-text)] sm:text-[11px]">
              <span aria-hidden>•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
    </>
  );
}
