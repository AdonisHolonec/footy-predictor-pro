import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MatchListRow from "./MatchListRow";
import { LocaleProvider } from "../../context/LocaleContext";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import { relativeDay, relativeDayLabel, relativeDayOffset } from "../../utils/relativeDay";
import type { PredictionRow } from "../../types";

/**
 * Day context in the match list.
 *
 * Every row says WHICH day it is, from the same Date the kickoff time is
 * printed from. Narrow screens stack it above the time inside the slot's
 * existing two-row height; from `sm` it sits inline — "Astăzi · 14:30" — on
 * the row's single line. Presentational only: order, grouping and the
 * minute / FT states are untouched, and the day is spoken exactly once.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;

/** "Now" is a Tuesday afternoon; all kickoffs are placed relative to it in LOCAL time. */
const NOW = new Date(2026, 7, 25, 14, 0, 0); // 2026-08-25 14:00 local

function at(dayOffset: number, hour: number, minute = 0): Date {
  return new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + dayOffset, hour, minute, 0);
}

function row(overrides: Record<string, unknown> = {}): PredictionRow {
  return {
    id: 1,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Hull City", away: "Manchester United" },
    kickoff: at(0, 16, 30).toISOString(),
    status: "NS",
    logos: { home: "https://img/a.png", away: "https://img/b.png" },
    probs: { p1: 0.5, pX: 0.25, p2: 0.25 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 78, odd: 1.85 },
    ...overrides
  } as unknown as PredictionRow;
}

function renderRow(r: PredictionRow, locale?: "ro" | "en") {
  const ui = (
    <ul>
      <MatchListRow row={r} onOpen={() => {}} onToggleWatch={() => {}} />
    </ul>
  );
  const { container } = render(locale ? <LocaleProvider>{ui}</LocaleProvider> : ui);
  const li = container.querySelector("li")!;
  const slot = (name: string) => li.querySelector(`[data-slot="${name}"]`) as HTMLElement | null;
  return { li, slot, button: li.querySelector("button")! };
}

const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const t = (key: string) => {
  const [ns, k] = key.split(".");
  return E[ns][k];
};
/** The rendered row resolves its own locale (RO by default); accept either language's string. */
const either = (key: string) => new RegExp(`^(${E.list[key]}|${R.list[key]})$`);
const DAY = { today: "dayToday", tomorrow: "dayTomorrow", after: "dayAfterTomorrow" } as const;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("relativeDay — the date source", () => {
  it("4/5/6/7. today, tomorrow, day after tomorrow, then the absolute short date", () => {
    expect(relativeDay(at(0, 23, 59), NOW)?.kind).toBe("today");
    expect(relativeDay(at(1, 0, 0), NOW)?.kind).toBe("tomorrow");
    expect(relativeDay(at(2, 9, 0), NOW)?.kind).toBe("dayAfterTomorrow");
    expect(relativeDay(at(3, 9, 0), NOW)).toEqual({ kind: "absolute", offsetDays: 3 });
    expect(relativeDay(at(-1, 9, 0), NOW)).toEqual({ kind: "absolute", offsetDays: -1 });
    expect(relativeDayLabel(at(3, 9, 0), t, NOW)).toBe(at(3, 9, 0).toLocaleDateString([], { day: "numeric", month: "short" }));
  });

  it("14. timezone/day boundary: minutes apart across local midnight are different days; the same local day is one day", () => {
    const lateTonight = at(0, 23, 30);
    const justAfterMidnight = at(1, 0, 30);
    expect(relativeDayOffset(lateTonight, NOW)).toBe(0);
    expect(relativeDayOffset(justAfterMidnight, NOW)).toBe(1);
    // A kickoff earlier today is still "today", not "yesterday".
    expect(relativeDayOffset(at(0, 0, 5), NOW)).toBe(0);
    // Both the label and the printed time are derived from the SAME Date object.
    const k = new Date(row().kickoff);
    expect(relativeDayLabel(k, t, NOW)).toBe(E.list.dayToday);
    expect(time(k)).toBe(time(new Date(row().kickoff)));
  });

  it("an unparseable kickoff yields no label", () => {
    expect(relativeDay(new Date("nope"), NOW)).toBeNull();
    expect(relativeDayLabel(new Date("nope"), t, NOW)).toBe("");
  });
});

describe("MatchListRow — day context", () => {
  it("1/2. the slot holds day, separator and time: stacked by default, inline from sm", () => {
    const { slot } = renderRow(row());
    const s = slot("time")!;
    expect(s.className).toMatch(/\bflex-col\b/);
    expect(s.className).toMatch(/\bsm:flex-row\b/);
    expect(s.className).toMatch(/\bjustify-center\b/);
    expect(s.className).toMatch(/\bsm:justify-start\b/);
    expect(slot("day")?.textContent).toMatch(either(DAY.today));
    expect(slot("time-value")?.textContent).toBe(time(at(0, 16, 30)));
    // The "·" exists only on the inline layout.
    const sep = slot("day-separator")!;
    expect(sep.textContent).toBe("·");
    expect(sep.className).toMatch(/\bhidden\b/);
    expect(sep.className).toMatch(/\bsm:inline\b/);
    expect(sep.getAttribute("aria-hidden")).toBe("true");
    // Order: day, separator, time.
    expect([...s.children].map((c) => c.getAttribute("data-slot"))).toEqual(["day", "day-separator", "time-value"]);
  });

  it("3/4/5/6/7. every row carries a label; same day → same label; +1 → tomorrow; +2 → day after; later → date", () => {
    const cases: Array<[Date, RegExp]> = [
      [at(0, 14, 30), either(DAY.today)],
      [at(0, 17, 0), either(DAY.today)],
      [at(1, 18, 0), either(DAY.tomorrow)],
      [at(1, 21, 45), either(DAY.tomorrow)],
      [at(2, 18, 15), either(DAY.after)],
      [at(5, 18, 15), new RegExp(`^${at(5, 18, 15).toLocaleDateString([], { day: "numeric", month: "short" })}$`)]
    ];
    for (const [kickoff, expected] of cases) {
      cleanup();
      const { slot } = renderRow(row({ kickoff: kickoff.toISOString() }));
      expect(slot("day")?.textContent, kickoff.toISOString()).toMatch(expected);
      expect(slot("time-value")?.textContent).toBe(time(kickoff));
    }
  });

  it("12/13. live minute and FT are preserved under the day label — never 'day · kickoff · minute'", () => {
    const live = renderRow(row({ status: "2H", score: { home: 1, away: 0, minute: 72 } }));
    expect(live.slot("day")?.textContent).toMatch(either(DAY.today));
    expect(live.slot("time-value")?.textContent).toBe("72'");
    expect(live.slot("time")?.textContent).not.toContain(time(at(0, 16, 30)));
    cleanup();
    const ft = renderRow(row({ status: "FT", score: { home: 2, away: 1 } }));
    expect(ft.slot("day")?.textContent).toMatch(either(DAY.today));
    expect(ft.slot("time-value")?.textContent).toMatch(either("fullTimeShort"));
    expect(ft.slot("time")?.textContent).not.toContain(time(at(0, 16, 30)));
  });

  it("8. chronological order is untouched: rows render in the order given, whatever their day", () => {
    const rows = [at(2, 18, 15), at(0, 14, 30), at(1, 18, 0), at(0, 17, 0)].map((k, i) =>
      row({ id: i + 1, kickoff: k.toISOString(), teams: { home: `H${i}`, away: `A${i}` } })
    );
    const { container } = render(
      <ul>
        {rows.map((r) => (
          <MatchListRow key={r.id} row={r} onOpen={() => {}} onToggleWatch={() => {}} />
        ))}
      </ul>
    );
    const homes = [...container.querySelectorAll("li")].map((li) => li.textContent?.match(/H\d/)?.[0]);
    expect(homes).toEqual(["H0", "H1", "H2", "H3"]);
  });

  it("9/10/11. no extra row or height: the slot spans the existing two mobile rows, one desktop row, nowrap", () => {
    const { slot, button } = renderRow(row());
    const s = slot("time")!;
    expect(s.className).toMatch(/\brow-span-2\b/);
    expect(s.className).toMatch(/\bsm:row-span-1\b/);
    expect(s.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(s.className).toMatch(/\bleading-none\b/);
    // Still a two-row mobile grid and a single-row desktop grid — no third row anywhere.
    expect(button.className).not.toMatch(/row-span-3|grid-rows-3/);
    // The day is not a separate block outside the time slot.
    expect(button.querySelectorAll('[data-slot="day"]')).toHaveLength(1);
    expect(slot("day")!.parentElement).toBe(s);
  });

  it("15. RO and EN labels", () => {
    const ro = renderRow(row({ kickoff: at(1, 18, 0).toISOString() }), "ro");
    expect(ro.slot("day")?.textContent).toMatch(new RegExp(`^(${R.list.dayTomorrow}|${E.list.dayTomorrow})$`));
    for (const key of ["dayToday", "dayTomorrow", "dayAfterTomorrow"]) {
      expect(R.list[key], key).toBeTruthy();
      expect(E.list[key], key).toBeTruthy();
      expect(R.list[key]).not.toBe(E.list[key]);
    }
    expect(R.list.dayToday).toBe("Astăzi");
    expect(R.list.dayTomorrow).toBe("Mâine");
    expect(R.list.dayAfterTomorrow).toBe("Poimâine");
  });

  it("16. the accessible name carries the day exactly once, before the time", () => {
    const { button, slot } = renderRow(row({ kickoff: at(1, 18, 0).toISOString() }));
    const name = button.getAttribute("aria-label") || "";
    const day = slot("day")!.textContent!;
    expect(name.split(day).length - 1).toBe(1);
    expect(name).toContain(`${day}, ${time(at(1, 18, 0))}`);
    // Visible spans are inside the labelled button, so they are not read in addition.
    expect(button.getAttribute("aria-label")).toBeTruthy();
  });

  it("the day label never goes below the 10 px floor the row enforces", () => {
    const src = readFileSync(join(__dirname, "MatchListRow.tsx"), "utf8");
    const daySpan = src.slice(src.indexOf('data-slot="day"'), src.indexOf('data-slot="day-separator"'));
    expect(daySpan).toMatch(/text-\[10px\]/);
    expect(daySpan).not.toMatch(/text-\[[0-9]px\]/);
  });
});
