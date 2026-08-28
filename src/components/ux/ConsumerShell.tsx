import type { ReactNode } from "react";
import PredictCta from "./PredictCta";
import type { PredictAction } from "./predictState";
import Tooltip from "../../design-system/Tooltip";
import { useLocale } from "../../context/LocaleContext";
import { DESKTOP_SECONDARY_NAV_ITEMS, PRIMARY_NAV_ITEMS, type AppNavView } from "./appNav";
import { NavIcon } from "./navIcons";

type Props = {
  activeNav: AppNavView;
  onNavigate: (view: AppNavView) => void;
  date: string;
  onDateChange: (date: string) => void;
  /** Generate new predictions (quota). The one action that stays in the chrome. */
  /**
   * The shared Predict contract, built by the page. The shell renders it and
   * never recomputes it — see predictState.ts.
   */
  predictAction?: PredictAction;
  /** In-play fixtures right now — a count badge on Matches, never a destination. */
  liveCount?: number;
  /**
   * Permanent status/action content for the chrome — the plan card and referral
   * CTA. A SLOT rather than props, so the shell keeps knowing nothing about
   * entitlement: the dashboard already holds that state and renders it here.
   */
  statusSlot?: ReactNode;
  children: ReactNode;
};

/**
 * Consumer chrome (UX-B).
 *
 * One sticky bar, ≤ 56 px: brand · browsed date · Predict, plus — on desktop —
 * the five primary destinations and the subordinate Tickets entry. The bottom
 * bar on mobile carries the SAME five destinations in the same order, icon +
 * label, 44 px+ targets. Language, tier and the secondary account controls
 * moved to Account; search, leagues, refresh and the date range moved to
 * Matches, where the list they act on lives.
 *
 * Today · Matches · Results · Performance · Account — one name per concept,
 * the same on both bars. Live is a segment of Matches, shown here only as a
 * count. The command palette is a shortcut, never the way in.
 */
export default function ConsumerShell({
  activeNav,
  onNavigate,
  date,
  onDateChange,
  predictAction,
  liveCount = 0,
  statusSlot,
  children
}: Props) {
  const { t } = useLocale();

  const railBtn =
    "flex h-9 items-center gap-1.5 rounded-[var(--fp-radius-sm)] px-2.5 text-xs font-semibold transition-colors hover-fine:bg-[var(--fp-accent-muted)] hover-fine:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]";

  const desktopNav = (
    <nav className="hidden items-center gap-0.5 lg:flex" aria-label={t("nav.primary")}>
      {PRIMARY_NAV_ITEMS.map((item) => {
        const label = t(item.labelKey);
        const isActive = activeNav === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? "page" : undefined}
            data-nav={item.id}
            className={`${railBtn} ${
              isActive ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]" : "text-[var(--fp-text-muted)]"
            }`}
          >
            <NavIcon id={item.id} />
            <span>{label}</span>
            {item.id === "matches" && liveCount > 0 && (
              <span
                className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--fp-live)] px-1 font-mono text-[10px] font-bold leading-none text-white"
                aria-label={t("nav.liveCount", { n: liveCount })}
              >
                {liveCount}
              </span>
            )}
          </button>
        );
      })}
      <span aria-hidden className="mx-1 h-5 w-px bg-[var(--fp-border)]" />
      {DESKTOP_SECONDARY_NAV_ITEMS.map((item) => {
        const label = t(item.labelKey);
        const isActive = activeNav === item.id;
        return (
          <Tooltip key={item.id} label={label} align="end">
            <button
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              data-nav={item.id}
              data-nav-rank="secondary"
              className={`${railBtn} px-2 ${isActive ? "text-[var(--fp-accent)]" : "text-[var(--fp-text-faint)]"}`}
            >
              <NavIcon id={item.id} />
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[var(--fp-bg)] text-[var(--fp-text)]">
      <header className="sticky top-0 z-40 border-b border-[var(--fp-border)] bg-fp-bg-card/95 shadow-fp-sm backdrop-blur-md">
        <div
          data-testid="context-bar"
          /* gap kept in step with PlanHeaderStrip's: see the note there. */
          /*
            gap-1.5 below sm, not gap-2. At 390 the sum of every zone's
            min-content width came to ~395px against 366px of usable row, and
            the referral card paid for it by overflowing its own wrapper into
            this gap — 3.5px clear of the Predict button, no overlap, but only
            by accident. Six pixels of gap is the cheapest lever the priority
            order allows: it costs no fixed copy, no brand characters and no
            type size, and the spec names padding before typography.
          */
          className="mx-auto flex h-14 max-w-[var(--fp-container)] items-center gap-1.5 px-3 sm:gap-2.5 sm:px-6 lg:px-8"
        >
          {/*
            BRAND OVER DATE, one stacked column.

            Side by side these two ate roughly a third of the bar, which is why the
            plan and referral cards had to spill onto a second row. Stacked, they
            occupy the same 56px of height and about half the width, and the whole
            header fits on one line again.
          */}
          {/*
            min-w-[6.5rem], not min-w-0.

            min-w-0 let this column shrink to nothing, which made the BRAND the
            first thing the row sacrificed — "F…" — while a dynamic invitee name
            beside it kept a fixed width. The stated priority is the reverse:
            brand first, dynamic name last. The floor is the width the wordmark
            actually needs, so the truncate below is a backstop now rather than
            the row's normal behaviour, and the referral card yields instead.
          */}
          <div className="flex min-w-[6.5rem] shrink flex-col justify-center gap-0.5 overflow-hidden">
            <button
              type="button"
              onClick={() => onNavigate("home")}
              title={t("nav.today")}
              className="min-w-0 truncate text-left font-display text-sm font-bold leading-none tracking-tight text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] sm:text-base"
              aria-label={t("shell.brandAria")}
            >
              Footy<span className="text-[var(--fp-accent)]">Predictor</span>
            </button>
            <label className="sr-only" htmlFor="consumer-date">
              {t("shell.date")}
            </label>
            <input
              id="consumer-date"
              type="date"
              title={t("shell.selectDate")}
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              /*
                NO touch-target HERE, deliberately. It was added and then removed
                after probing: the brand column is 54px tall with this input
                flush to its bottom edge, so a 44px expansion is clipped by the
                column's overflow-hidden above and by the 56px bar below —
                elementFromPoint returned the brand span at the top of the
                intended area and <main> at the bottom. The class would have
                claimed a target it cannot deliver.

                A real 44px date control needs the brand out of this column or a
                taller bar; both are design decisions, not a class. The honest
                number today is 28px, and it is recorded in DESIGN.md.
              */
              className="h-6 w-full min-w-0 max-w-[6.6rem] rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-1 text-[10px] font-medium leading-none text-[var(--fp-text)] sm:h-7 sm:max-w-[7.2rem] sm:text-xs"
            />
          </div>

          {desktopNav}

          {/* The cards sit on the same line now — the stacked brand/date made room. */}
          {/*
            shrink-0: the cards size themselves to their own content and must
            not be squeezed past it — letting this wrapper shrink slid the
            referral card underneath Predict at 390px. The brand column, which
            is min-w-0 and truncates, absorbs a narrow viewport instead.
          */}
          {/*
            min-w-0 so the squeeze can REACH the strip. Everything inside it that
            must not be cut carries shrink-0 of its own, so the only thing this
            actually lets compress is the dynamic name.
          */}
          {statusSlot ? <div className="ml-auto flex min-w-0 shrink items-center">{statusSlot}</div> : null}

          <div className={`${statusSlot ? "" : "ml-auto "}flex shrink-0 items-center gap-1.5 sm:gap-2`}>
            {/*
              The wrapper's own tooltip is state-aware too. PredictCta fixes its
              `title`, but this Tooltip renders a second, visible bubble from its
              own label — leaving it as the idle hint meant a blocked button
              still displayed "Generează predicții pentru zilele selectate" on
              hover. Both strings now name the same state.
            */}
            {predictAction ? (
              <Tooltip
                /*
                  Busy first, matching predictState's own precedence — the
                  bubble used to test `disabled` first, so on the run that spent
                  the last prediction it said "you're out" while the button, its
                  title and its accessible name all said "generating".
                */
                label={predictAction.hint}
                align="end"
              >
                <span className="inline-flex">
                  {/*
                    PredictCta, not design-system/Button: this one control carries
                    a layered animated treatment that would be wrong on the fifty
                    other Buttons in the app. It owns no logic — the handler, the
                    busy flag and the quota rules all still live above it.
                  */}
                  {/*
                    The whole action, not five strings describing it. The five
                    props this used to take were re-composed inside PredictCta
                    into a name and a tooltip that predictState.ts had already
                    resolved — and the `??` fallbacks beside them were dead the
                    moment this block was wrapped in `predictAction ? …`, while
                    still reading as though the contract might be missing.
                  */}
                  <PredictCta action={predictAction} />
                </span>
              </Tooltip>
            ) : null}
          </div>
        </div>

      </header>

      <main className="mx-auto max-w-[var(--fp-container)] px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-5 lg:px-8 lg:pb-5">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--fp-border)] bg-fp-bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label={t("nav.primary")}
      >
        {PRIMARY_NAV_ITEMS.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              data-nav={item.id}
              className="relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-semibold transition-colors duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
              aria-current={isActive ? "page" : undefined}
            >
              <span
                className={`relative flex items-center justify-center rounded-[var(--fp-radius-sm)] px-3.5 py-1 transition-colors duration-[var(--fp-ease)] ${
                  isActive ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]" : "text-[var(--fp-text-muted)]"
                }`}
              >
                <NavIcon id={item.id} />
                {item.id === "matches" && liveCount > 0 && (
                  <span
                    className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--fp-live)] px-0.5 font-mono text-[10px] font-bold leading-none text-white"
                    aria-label={t("nav.liveCount", { n: liveCount })}
                  >
                    {liveCount}
                  </span>
                )}
              </span>
              <span className={isActive ? "text-[var(--fp-accent)]" : "text-[var(--fp-text-muted)]"}>
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
