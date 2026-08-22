import { useState } from "react";
import type { CardMarketValidations, PredictionRow } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import { relativeDayLabel } from "../../utils/relativeDay";
import StatusBadge from "../../design-system/StatusBadge";
import { isFixtureInPlay } from "../../utils/appUtils";
import { formatBookOdd, recommendedOdd } from "../../utils/marketPicks";
import { formatRecommendedPick } from "../../utils/formatRecommendation";
import { isSettledOutcome, resolveCardMarketOutcome, type MarketOutcome } from "../../utils/cardMarketOutcome";
import { formatLiveMinute, isFinalStatus } from "../matchCard/derivations";
import MarketFamilyIcon from "../icons/MarketFamilyIcon";

/**
 * MatchListRow — the consumer list unit for Home and Matches (UX-A).
 *
 * LIST = scan + selection. One row answers three questions and nothing else:
 * what is the prediction, how confident is the model, what is the price. Every
 * other fact about the fixture (momentum, win-probability, markets, rationale,
 * referee, weather, internals) lives behind the row, in Match Detail.
 *
 * ONE structure for pre-match, live and settled. Only the data in two slots
 * changes — the time slot (kickoff · minute · FT) and the centre slot (vs ·
 * score) — never the grammar, padding, type scale or component identity.
 *
 * Semantic order, identical at every width:
 *   TIME/MINUTE → HOME BADGE + TEAM → VS/SCORE → TEAM + AWAY BADGE
 *   → PREDICTION → CONFIDENCE → ODDS → DETAILS
 * On mobile the decision trio wraps to a second line under the teams; on `sm+`
 * the block becomes `display: contents` and its three children take their own
 * grid columns, so the DOM — and therefore the accessible order — is the same.
 *
 * Colour semantics (UX-0 / PR #141 conventions): accent = the prediction, and
 * only the prediction; the live token marks the minute; success/danger appear
 * only on a settled outcome, through StatusBadge. Nothing here is red or green
 * before settlement.
 */

type Props = {
  row: PredictionRow;
  /** History settlement for this fixture; falls back to the row's own validations. */
  marketValidations?: CardMarketValidations | null;
  watched?: boolean;
  /** Absent = no favourite control (the row never grows a dead slot). */
  onToggleWatch?: () => void;
  onOpen: () => void;
};

/** Crest sizes: 22 px mobile, 24 px desktop — the same for every state. */
const BADGE_CLASS = "h-[22px] w-[22px] shrink-0 sm:h-6 sm:w-6";

/**
 * A team crest that never leaves a hole: when the feed has no logo, or the
 * image fails to load, the slot keeps its exact size and shows the team's
 * initial on the muted surface — the same footprint, so names stay aligned.
 */
function TeamBadge({ src, team }: { src?: string; team: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        data-team-badge="image"
        onError={() => setBroken(true)}
        className={`${BADGE_CLASS} object-contain`}
      />
    );
  }
  return (
    <span
      aria-hidden
      data-team-badge="fallback"
      className={`${BADGE_CLASS} inline-flex items-center justify-center rounded-full bg-[var(--fp-bg-muted)] text-[10px] font-bold leading-none text-[var(--fp-text-muted)]`}
    >
      {team.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function settlementTone(outcome: MarketOutcome): "success" | "danger" | "neutral" {
  if (outcome === "win" || outcome === "half_win") return "success";
  if (outcome === "loss" || outcome === "half_loss") return "danger";
  return "neutral";
}

export default function MatchListRow({ row, marketValidations = null, watched = false, onToggleWatch, onOpen }: Props) {
  const { t } = useLocale();

  const live = isFixtureInPlay(row.status);
  const finished = isFinalStatus(row.status);
  const hasScore =
    (live || finished) && Number.isFinite(Number(row.score?.home)) && Number.isFinite(Number(row.score?.away));

  const kickoff = new Date(row.kickoff);
  const kickoffLabel = Number.isFinite(kickoff.getTime())
    ? kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";
  const minuteLabel = live ? formatLiveMinute(row.score?.minute, row.score?.extra) : null;
  // The time slot: minute while in play, "FT" once final, kickoff otherwise.
  const timeLabel = live ? (minuteLabel ?? t("card.live")) : finished ? t("list.fullTimeShort") : kickoffLabel;
  // Day context from the SAME Date the time above is formatted from — Today /
  // Tomorrow / Day after tomorrow, else the short date. PRE-MATCH rows only:
  // gated by the row's own live / final semantics (the same predicates that
  // choose the time slot), never by the kickoff date. A live match is today by
  // definition and a finished one has no upcoming day to announce, so both keep
  // their existing "● 72'" / "FT" slot and accessible name untouched.
  // Stacked above the time on narrow screens, inline ("Astăzi · 14:30") from `sm`.
  const dayLabel = live || finished ? "" : relativeDayLabel(kickoff, t);

  const pick = formatRecommendedPick(row.recommended?.pick, row.recommended?.family, t, row.recommended);
  const conf = Number(row.recommended?.confidence);
  const hasExactConfidence = Number.isFinite(conf);
  const confidenceLabel = hasExactConfidence
    ? `${Math.round(conf)}%`
    : row.recommended?.confidenceCategory
      ? String(row.recommended.confidenceCategory)
      : "—";
  const odd = recommendedOdd(row);
  const oddLabel = formatBookOdd(odd, t("card.noBookOdd"));

  const outcome = resolveCardMarketOutcome("recommended", row, marketValidations ?? row.cardMarketValidations ?? null);
  const settled = isSettledOutcome(outcome);
  const outcomeLabel =
    outcome === "win" || outcome === "half_win"
      ? t("history.win")
      : outcome === "loss" || outcome === "half_loss"
        ? t("history.loss")
        : outcome === "push"
          ? t("history.outcomePush")
          : "";

  const scoreLabel = hasScore ? `${row.score?.home}–${row.score?.away}` : t("common.vs");
  const stateLabel = live ? t("card.live") : settled ? outcomeLabel : "";
  // The day is spoken once, here: the visible spans below sit inside a button
  // whose aria-label replaces its content, so nothing is read twice.
  const whenLabel = live ? `${timeLabel} ${scoreLabel}` : finished ? `${t("list.fullTimeShort")} ${scoreLabel}` : kickoffLabel;
  const accessibleName = [
    `${row.teams.home} ${t("common.vs")} ${row.teams.away}`,
    dayLabel ? `${dayLabel}, ${whenLabel}` : whenLabel,
    `${t("card.topPick")} ${pick.ariaLabel}`,
    `${t("match.confidence")} ${confidenceLabel}`,
    `${t("match.odds")} ${oddLabel}`,
    stateLabel
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      className="flex items-stretch gap-1 border-b border-[var(--fp-border)] last:border-b-0"
      data-match-row={live ? "live" : finished ? "final" : "upcoming"}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={accessibleName}
        className="group grid min-w-0 flex-1 grid-cols-[3.5rem_minmax(0,1fr)_1rem] items-center gap-x-2 gap-y-1 px-2 py-2.5 text-left transition-colors hover-fine:bg-[var(--fp-bg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fp-accent)] sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(7.5rem,auto)_2.75rem_minmax(3rem,auto)_1rem] sm:gap-x-3 sm:px-3 sm:py-3.5"
      >
        {/* DAY + TIME / MINUTE / FT — one slot, three states, one type scale.
            Narrow: the day stacks above the time inside the two-row height the
            slot already spans. From `sm`: "Astăzi · 14:30" on the row's single
            line — no extra row, no extra height. */}
        <span
          data-slot="time"
          className={`col-start-1 row-start-1 row-span-2 flex flex-col items-center justify-center gap-y-0.5 whitespace-nowrap font-mono text-[11px] font-semibold leading-none tabular-nums sm:row-span-1 sm:flex-row sm:justify-start sm:gap-x-1 sm:gap-y-0 sm:text-xs ${
            live ? "text-[var(--fp-live)]" : "text-[var(--fp-text-muted)]"
          }`}
        >
          {dayLabel && (
            <>
              <span
                data-slot="day"
                className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--fp-text-faint)]"
              >
                {dayLabel}
              </span>
              <span aria-hidden data-slot="day-separator" className="hidden text-[var(--fp-text-faint)] sm:inline">
                ·
              </span>
            </>
          )}
          <span data-slot="time-value" className="flex items-center gap-1">
            {live && (
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--fp-live)] motion-safe:animate-pulse" />
            )}
            {timeLabel}
          </span>
        </span>

        {/* TEAMS: badge + name · vs/score · name + badge. Names truncate; crests never do. */}
        <span
          data-slot="teams"
          className="col-start-2 row-start-1 grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-x-1.5 text-[13px] font-semibold leading-tight text-[var(--fp-text)] sm:text-sm lg:grid-cols-[auto_minmax(0,14rem)_auto_minmax(0,14rem)_auto] lg:justify-start"
        >
          <TeamBadge src={row.logos?.home} team={row.teams.home} />
          <span className="truncate" data-slot="home">
            {row.teams.home}
          </span>
          <span
            data-slot="score"
            className={`px-1 font-mono tabular-nums ${
              hasScore
                ? `text-[13px] font-bold sm:text-sm ${live ? "text-[var(--fp-live)]" : "text-[var(--fp-text)]"}`
                : "text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-faint)]"
            }`}
          >
            {scoreLabel}
          </span>
          <span className="truncate text-right" data-slot="away">
            {row.teams.away}
          </span>
          <TeamBadge src={row.logos?.away} team={row.teams.away} />
        </span>

        {/* DECISION: prediction → confidence → odds. One line under the teams on
            mobile; its own three columns on sm+ via display:contents. */}
        <span data-slot="decision" className="col-start-2 row-start-2 flex min-w-0 items-center gap-3 sm:contents">
          <span
            data-slot="prediction"
            className={`flex min-w-0 items-center gap-1 truncate text-[13px] font-bold sm:text-sm ${
              settled ? "text-[var(--fp-text)]" : "text-[var(--fp-accent)]"
            }`}
            title={pick.ariaLabel}
          >
            <MarketFamilyIcon familyKey={pick.familyKey} className="shrink-0 opacity-80" />
            <span className="truncate">{pick.label}</span>
          </span>
          <span
            data-slot="confidence"
            className="shrink-0 font-mono text-xs font-semibold tabular-nums text-[var(--fp-text)] sm:text-right sm:text-[13px]"
          >
            {confidenceLabel}
          </span>
          <span
            data-slot="odds"
            className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-[var(--fp-text-muted)] sm:justify-end sm:text-[13px]"
          >
            {oddLabel}
            {settled && outcomeLabel ? (
              <StatusBadge status={outcome ?? undefined} tone={settlementTone(outcome)} label={outcomeLabel} />
            ) : null}
          </span>
        </span>

        {/* DETAILS affordance: a chevron, not a sentence. */}
        <span
          data-slot="details"
          aria-hidden
          className="col-start-3 row-start-1 row-span-2 justify-self-end text-base leading-none text-[var(--fp-text-faint)] transition-colors group-hover:text-[var(--fp-text-muted)] sm:col-start-6 sm:row-span-1"
        >
          ›
        </span>
      </button>

      {onToggleWatch && (
        <button
          type="button"
          onClick={onToggleWatch}
          /* Sibling of the row button, never inside it: a 44×44 control that
             cannot open the match, and a row that cannot toggle the favourite. */
          /* UX-I: hidden below `sm` - on narrow screens the favourite lives in
             Match Detail's recommendation card, and the row reclaims the column. */
          className="my-auto hidden h-11 w-11 shrink-0 items-center justify-center text-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fp-accent)] sm:flex"
          title={watched ? t("card.removeFavorite") : t("card.addFavorite")}
          aria-label={watched ? t("card.removeFavorite") : t("card.addFavorite")}
          aria-pressed={watched}
        >
          <span aria-hidden className={watched ? "text-[var(--fp-warning)]" : "text-[var(--fp-text-faint)]"}>
            ★
          </span>
        </button>
      )}
    </li>
  );
}
