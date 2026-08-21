import { useMemo } from "react";
import type { PredictionRow } from "../../types";
import type { TranslateFn } from "../../i18n/types";
import CollapsiblePanel from "../../design-system/CollapsiblePanel";
import LiveWinProbabilityStrip from "../ux/LiveWinProbabilityStrip";
import MatchMomentumTimeline, {
  StatRow,
  buildMatchStory,
  eventIcon,
  eventLabel,
  formatMinute,
  statLabel,
  type TimelineEvent
} from "../ux/MatchMomentumTimeline";
import { isFixtureInPlay } from "../../utils/appUtils";

type Props = {
  match: PredictionRow;
  tr: TranslateFn;
  /** Existing predicate (useMatchModalModel): score strip visibility. Unchanged here. */
  hasLiveScore: boolean;
  /** Pre-formatted confidence string the timeline shows — mirrors the Decision block's gating. */
  confidenceLabel: string;
  recommendedPick: string;
};

/** How many recent events the summary previews; the full stream is one disclosure away. */
const RECENT_EVENTS = 2;

/**
 * The Live layer of Match Detail (UX-D) — "monitor what is happening now",
 * in five levels, progressively disclosed:
 *
 *   1. STATUS     — minute · score (also in the header), momentum direction
 *   2. LIVE LEAN  — the existing win-probability strip, compact, visible
 *   3. MOMENTUM   — MatchMomentumTimeline (PR #141), collapsed
 *   4. EVENTS     — the real event stream, collapsed; the summary previews the last two
 *   5. LIVE STATS — possession · shots · on target · corners · cards, collapsed
 *   +  STORY      — the existing deterministic narration, collapsed, after events
 *
 * Predicates are the existing ones and are not re-derived: the strip follows
 * `hasLiveScore`; Momentum, events and stats follow `isFixtureInPlay`. A level
 * whose data is absent is simply not rendered — no "n/a", no waiting copy.
 */
export default function LiveLayer({ match, tr, hasLiveScore, confidenceLabel, recommendedPick }: Props) {
  const inPlay = isFixtureInPlay(match.status);
  const momentum = match.momentum ?? null;
  const raw = momentum?.raw ?? null;
  const events: TimelineEvent[] = useMemo(
    () =>
      (match.liveEvents ?? []).map((ev) => ({
        minute: ev.minute,
        extra: ev.extra,
        team: ev.team,
        kind: ev.type,
        player: ev.player,
        assist: ev.assist
      })),
    [match.liveEvents]
  );
  const recent = events.slice(-RECENT_EVENTS).reverse();
  const story = useMemo(
    () => (momentum ? buildMatchStory(tr, momentum, events, match.teams.home, match.teams.away) : []),
    [tr, momentum, events, match.teams.home, match.teams.away]
  );
  const dominantLabel =
    momentum?.dominantTeam === "home"
      ? match.teams.home
      : momentum?.dominantTeam === "away"
        ? match.teams.away
        : momentum
          ? tr("match.momentumDominantBalanced")
          : null;
  const hasMinute = Number.isFinite(Number(match.score?.minute));
  const minute = hasMinute ? formatMinute(Number(match.score?.minute), match.score?.extra) : "";
  const hasStats = Boolean(raw && Object.values({ ...raw.home, ...raw.away }).some((v) => v != null));

  return (
    <section data-layer="live" aria-labelledby="detail-live-title" className="space-y-2">
      {/* 1 · STATUS — the compact summary, always visible. */}
      <div
        data-slot="live-summary"
        className="rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-fp-sm"
      >
        <h2
          id="detail-live-title"
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fp-live)]"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--fp-live)] motion-safe:animate-pulse" />
          {tr("detail.liveTitle")}
          {inPlay && hasMinute && <span className="font-mono tabular-nums">· {minute}</span>}
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {dominantLabel && (
            <>
              <dt className="text-[var(--fp-text-muted)]">{tr("card.momentum")}</dt>
              <dd data-slot="live-dominant" className="font-semibold text-[var(--fp-text)]">
                {dominantLabel}
              </dd>
            </>
          )}
          {recent.length > 0 && (
            <>
              <dt className="text-[var(--fp-text-muted)]">{tr("detail.liveRecent")}</dt>
              <dd
                data-slot="live-recent"
                className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-sm tabular-nums text-[var(--fp-text)]"
              >
                {recent.map((ev, i) => (
                  <span key={`${ev.minute}-${ev.kind}-${i}`} className="inline-flex items-center gap-1">
                    <span role="img" aria-label={eventLabel(tr, ev.kind)}>
                      {eventIcon(ev.kind)}
                    </span>
                    {formatMinute(ev.minute, ev.extra)}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      </div>

      {/* 2 · LIVE LEAN — the existing strip, its compact density, visible by default. */}
      {hasLiveScore && <LiveWinProbabilityStrip match={match} compact />}

      {/* 3 · MOMENTUM — the single Momentum presentation, collapsed. */}
      {inPlay && momentum && (
        <CollapsiblePanel compact title={tr("card.momentum")} subtitle={dominantLabel ?? undefined}>
          <MatchMomentumTimeline
            fixtureId={Number(match.id)}
            status={match.status}
            score={match.score}
            momentum={momentum}
            homeTeam={match.teams.home}
            awayTeam={match.teams.away}
            liveEvents={match.liveEvents}
            recommendedPick={recommendedPick}
            confidenceLabel={confidenceLabel}
            momentumNarrative={match.momentumNarrative ?? null}
            detailsPanel={false}
          />
        </CollapsiblePanel>
      )}
      {inPlay && !momentum && (
        <p data-slot="momentum-unavailable" className="px-1 text-[11px] text-[var(--fp-text-muted)]">
          {tr("match.momentumUnavailable")}
        </p>
      )}

      {/* 4 · EVENTS — the real stream, collapsed; only when the feed sent any. */}
      {inPlay && events.length > 0 && (
        <CollapsiblePanel
          compact
          title={tr("detail.eventsTitle")}
          subtitle={tr("detail.eventsCount", { n: events.length })}
        >
          <ol data-slot="live-events" className="space-y-1.5 text-sm">
            {[...events].reverse().map((ev, i) => (
              <li key={`${ev.minute}-${ev.kind}-${i}`} className="flex items-center gap-2">
                <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-[var(--fp-text-muted)]">
                  {formatMinute(ev.minute, ev.extra)}
                </span>
                <span role="img" aria-label={eventLabel(tr, ev.kind)}>
                  {eventIcon(ev.kind)}
                </span>
                <span className="min-w-0 truncate text-[var(--fp-text)]">
                  {ev.team === "home" ? match.teams.home : match.teams.away}
                  {ev.player ? ` · ${ev.player}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </CollapsiblePanel>
      )}

      {/* 5 · LIVE STATS — supporting evidence, collapsed; only the metrics that arrived. */}
      {inPlay && raw && hasStats && (
        <CollapsiblePanel compact title={tr("detail.statsTitle")}>
          <div data-slot="live-stats" className="space-y-1.5">
            <StatRow label={statLabel(tr, "possession")} home={raw.home.possession} away={raw.away.possession} suffix="%" />
            <StatRow label={statLabel(tr, "shotsTotal")} home={raw.home.shotsTotal} away={raw.away.shotsTotal} />
            <StatRow label={statLabel(tr, "shotsOnTarget")} home={raw.home.shotsOnTarget} away={raw.away.shotsOnTarget} />
            <StatRow label={statLabel(tr, "corners")} home={raw.home.corners} away={raw.away.corners} />
            <StatRow label={statLabel(tr, "yellowCards")} home={raw.home.yellowCards} away={raw.away.yellowCards} />
            <StatRow label={statLabel(tr, "redCards")} home={raw.home.redCards} away={raw.away.redCards} />
          </div>
        </CollapsiblePanel>
      )}

      {/* + STORY — interpretation, after the raw facts, collapsed. */}
      {inPlay && story.length > 0 && (
        <CollapsiblePanel compact title={tr("match.storyTitle")}>
          <ul data-slot="live-story" className="space-y-1.5">
            {story.map((line, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-[var(--fp-text)]">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--fp-accent)]" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CollapsiblePanel>
      )}
    </section>
  );
}
