import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { useLocale } from "../../context/LocaleContext";
import { isoToday } from "../../utils/appUtils";
import { addIsoDay } from "../../pages/userDashboard/helpers";

type Props = {
  /** The browsed date, ISO `YYYY-MM-DD` — the same value the date input used to hold. */
  value: string;
  /** Same contract as the input it replaces: called with the new ISO date only. */
  onChange: (iso: string) => void;
  /** Test seam; defaults to the device's local calendar day. */
  today?: string;
};

/** Days shown either side of the anchor: a week in one row. */
const SPAN = 3;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayNumber(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Parsed at local midnight, as HomeSection does, so a date key never shifts a day across time zones. */
function localDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function CalendarIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}

/**
 * The day strip directly below the consumer bar.
 *
 * PRESENTATION ONLY. It emits exactly what the old `<input type="date">` did —
 * one ISO date through `onChange` — so the page's handler (setDate →
 * setSelectedDates → fetchDays) and every request it makes are unchanged.
 *
 * The window is anchored on TODAY, not on the selection: choosing a day inside
 * it never moves the row, so nothing shifts under the pointer. Only a date
 * outside the window (reachable through the calendar control) re-anchors it.
 *
 * One tab stop (the selected day) with arrow keys between days, like a
 * toolbar; the calendar control after it keeps every other date reachable.
 */
export default function DaySelector({ value, onChange, today = isoToday() }: Props) {
  const { t, locale } = useLocale();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const valid = ISO.test(value);
  const anchor = valid && Math.abs(dayNumber(value) - dayNumber(today)) > SPAN ? value : today;

  const days = useMemo(() => {
    const tag = locale === "ro" ? "ro-RO" : "en-US";
    const weekday = new Intl.DateTimeFormat(tag, { weekday: "short" });
    const full = new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return Array.from({ length: SPAN * 2 + 1 }, (_, i) => {
      const iso = addIsoDay(anchor, i - SPAN);
      const date = localDate(iso);
      return { iso, weekday: weekday.format(date), dayOfMonth: date.getDate(), fullLabel: full.format(date) };
    });
  }, [anchor, locale]);

  const selectedIndex = days.findIndex((d) => d.iso === value);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : days.findIndex((d) => d.iso === today);

  // Keep the selected day in view on narrow screens. Horizontal scroll of the
  // strip only — never scrollIntoView, which would also move the page.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const el = selectedIndex >= 0 ? buttonsRef.current[selectedIndex] : null;
    if (!scroller || !el || typeof scroller.scrollTo !== "function") return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ left: el.offsetLeft - (scroller.clientWidth - el.offsetWidth) / 2, behavior: reduce ? "auto" : "smooth" });
  }, [selectedIndex, anchor]);

  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = days.length - 1;
    const target =
      event.key === "ArrowRight"
        ? Math.min(index + 1, last)
        : event.key === "ArrowLeft"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    buttonsRef.current[target]?.focus();
  };

  // A transparent native input over the icon: tapping it opens the platform
  // picker on touch devices; on desktop browsers that only open it from their
  // own indicator, showPicker() does it (it throws where unsupported or without
  // a user gesture — the native input behaviour is then what remains).
  const openPicker = (event: MouseEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void };
    try {
      input.showPicker?.();
    } catch {
      /* unsupported: the focused native input still accepts a typed date */
    }
  };

  return (
    <div className="mx-auto max-w-[var(--fp-container)] px-4 pt-3 sm:px-6 lg:px-8" data-testid="day-selector">
      <div className="flex items-center gap-1 rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-0.5 shadow-fp-sm">
        {/* "Today" stays an explicit choice when the week has re-anchored away from it. */}
        {!days.some((d) => d.iso === today) ? (
          <>
            <button
              type="button"
              data-day-today
              onClick={() => onChange(today)}
              className="ml-0.5 flex h-[3.25rem] shrink-0 items-center rounded-[var(--fp-radius)] px-3 text-xs font-semibold text-[var(--fp-accent)] transition-colors duration-[var(--fp-ease)] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] hover-fine:bg-[var(--fp-accent-muted)]"
            >
              {t("list.dayToday")}
            </button>
            <span aria-hidden className="h-8 w-px shrink-0 bg-[var(--fp-border)]" />
          </>
        ) : null}
        <div
          ref={scrollerRef}
          role="group"
          aria-label={t("shell.chooseDay")}
          className="scrollbar-none relative min-w-0 flex-1 touch-pan-x snap-x overflow-x-auto overscroll-x-contain"
        >
          <div className="mx-auto flex w-max gap-1 p-1">
            {days.map((day, i) => {
              const selected = i === selectedIndex;
              const isToday = day.iso === today;
              return (
                <button
                  key={day.iso}
                  ref={(el) => {
                    buttonsRef.current[i] = el;
                  }}
                  type="button"
                  data-day={day.iso}
                  aria-pressed={selected}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={isToday ? `${day.fullLabel} · ${t("list.dayToday")}` : day.fullLabel}
                  tabIndex={i === tabbableIndex ? 0 : -1}
                  onKeyDown={(event) => onDayKeyDown(event, i)}
                  onClick={() => {
                    if (day.iso !== value) onChange(day.iso);
                  }}
                  className={`flex h-[3.25rem] w-12 shrink-0 snap-center flex-col items-center justify-center gap-1 rounded-[var(--fp-radius)] transition-colors duration-[var(--fp-ease)] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] sm:w-14 ${
                    selected
                      ? "bg-[var(--fp-accent)] text-white shadow-fp-sm"
                      : "text-[var(--fp-text-muted)] hover-fine:bg-[var(--fp-bg-muted)] hover-fine:text-[var(--fp-text)]"
                  }`}
                >
                  <span aria-hidden className="text-[11px] font-medium capitalize leading-none">
                    {day.weekday}
                  </span>
                  <span
                    aria-hidden
                    className={`font-display text-lg font-bold leading-none tabular-nums ${selected ? "" : "text-[var(--fp-text)]"}`}
                  >
                    {day.dayOfMonth}
                  </span>
                  {/* Today's marker keeps its footprint on every day, so no day is taller than another. */}
                  <span
                    aria-hidden
                    data-today-marker={isToday || undefined}
                    className={`h-1 w-1 rounded-full ${isToday ? (selected ? "bg-white" : "bg-[var(--fp-accent)]") : "bg-transparent"}`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <span aria-hidden className="h-8 w-px shrink-0 bg-[var(--fp-border)]" />

        <div className="relative mr-0.5 flex h-[3.25rem] w-11 shrink-0 items-center justify-center rounded-[var(--fp-radius)] text-[var(--fp-text-muted)] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--fp-accent)] hover-fine:bg-[var(--fp-bg-muted)] hover-fine:text-[var(--fp-text)]">
          <CalendarIcon />
          <input
            type="date"
            aria-label={t("shell.otherDate")}
            title={t("shell.selectDate")}
            value={valid ? value : ""}
            onChange={(event) => {
              const next = event.target.value;
              if (next && next !== value) onChange(next);
            }}
            onClick={openPicker}
            onKeyDown={(event) => {
              if (event.key === "Enter") openPicker(event);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
      </div>
    </div>
  );
}
