import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DaySelector from "./DaySelector";
import { addIsoDay, buildTierDates } from "../../pages/userDashboard/helpers";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";

/**
 * The day strip below the consumer bar. Presentation only: it must emit exactly
 * what the date input it replaced emitted — one ISO date through onChange.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`(${esc(E[ns][key])}|${esc(R[ns][key])})`);

afterEach(cleanup);

const TODAY = "2026-09-11";
const days = () => Array.from(document.querySelectorAll<HTMLButtonElement>("[data-day]"));
const day = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)!;

function renderStrip(value = TODAY, onChange = vi.fn()) {
  const utils = render(<DaySelector value={value} today={TODAY} onChange={onChange} />);
  return { ...utils, onChange };
}

describe("DaySelector · days", () => {
  it("renders a seven-day window anchored on today, in date order", () => {
    renderStrip();
    expect(days().map((b) => b.dataset.day)).toEqual([
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14"
    ]);
  });

  it("marks exactly the selected day as pressed, and today as the current date", () => {
    renderStrip("2026-09-12");
    expect(days().filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.day)).toEqual([
      "2026-09-12"
    ]);
    expect(day(TODAY).getAttribute("aria-current")).toBe("date");
    expect(day("2026-09-12").getAttribute("aria-current")).toBeNull();
  });

  it("shows the weekday and the day of the month on every day", () => {
    renderStrip();
    for (const b of days()) {
      const [weekday, dayOfMonth] = Array.from(b.querySelectorAll("span")).map((s) => s.textContent || "");
      expect(weekday.length).toBeGreaterThan(0);
      expect(dayOfMonth).toBe(String(Number(b.dataset.day!.slice(8))));
    }
  });

  it("names every day with its full date, and today as today", () => {
    renderStrip();
    expect(day("2026-09-12").getAttribute("aria-label")).toMatch(/12/);
    expect(day("2026-09-12").getAttribute("aria-label")).toMatch(/2026/);
    expect(day(TODAY).getAttribute("aria-label")).toMatch(either("list", "dayToday"));
  });
});

describe("DaySelector · selection", () => {
  it("emits the chosen ISO date, once, and nothing for the day already selected", () => {
    const { onChange } = renderStrip();
    fireEvent.click(day("2026-09-13"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-09-13");
    fireEvent.click(day(TODAY));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("never moves the row when a day inside the window is chosen (no layout shift)", () => {
    const { rerender } = renderStrip(TODAY);
    const before = days().map((b) => b.dataset.day);
    rerender(<DaySelector value="2026-09-14" today={TODAY} onChange={() => {}} />);
    expect(days().map((b) => b.dataset.day)).toEqual(before);
    expect(day("2026-09-14").getAttribute("aria-pressed")).toBe("true");
  });

  it("re-anchors on a date outside the window, keeping it selected", () => {
    renderStrip("2026-10-01");
    expect(days()[3].dataset.day).toBe("2026-10-01");
    expect(days()[3].getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps any other date reachable through the labelled calendar input", () => {
    const { onChange } = renderStrip();
    const input = screen.getByLabelText(either("shell", "otherDate")) as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe(TODAY);
    fireEvent.change(input, { target: { value: "2026-12-24" } });
    expect(onChange).toHaveBeenCalledWith("2026-12-24");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("DaySelector · today indicator and window anchoring", () => {
  it("marks today with a visible marker on today's day only", () => {
    renderStrip("2026-09-12");
    const markers = document.querySelectorAll("[data-today-marker]");
    expect(markers).toHaveLength(1);
    expect(day(TODAY).contains(markers[0])).toBe(true);
  });

  it("shows no today marker or current-date state when today is outside a re-anchored window", () => {
    renderStrip("2026-10-01");
    expect(document.querySelectorAll("[data-today-marker]")).toHaveLength(0);
    expect(days().some((b) => b.getAttribute("aria-current") === "date")).toBe(false);
  });

  it("centres a re-anchored window on the far date, and its days use the same handler", () => {
    const { onChange } = renderStrip("2026-10-01");
    expect(days().map((b) => b.dataset.day)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04"
    ]);
    fireEvent.click(day("2026-10-03"));
    expect(onChange).toHaveBeenCalledWith("2026-10-03");
  });

  it("anchors back on today once the browsed date is within three days of it", () => {
    const { rerender } = renderStrip("2026-10-01");
    rerender(<DaySelector value="2026-09-14" today={TODAY} onChange={() => {}} />);
    expect(days()[3].dataset.day).toBe(TODAY);
    expect(day("2026-09-14").getAttribute("aria-pressed")).toBe("true");
  });

  it("crosses month and year boundaries with real calendar dates", () => {
    render(<DaySelector value="2026-12-30" today="2026-12-30" onChange={() => {}} />);
    expect(days().map((b) => b.dataset.day)).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02"
    ]);
  });

  it("calls the handler it was given with exactly one argument: the ISO date", () => {
    const { onChange } = renderStrip();
    fireEvent.click(day("2026-09-10"));
    expect(onChange.mock.calls).toEqual([["2026-09-10"]]);
  });
});

describe("DaySelector · explicit Today", () => {
  it("offers Today when the week has re-anchored away from it, and it emits today's ISO date", () => {
    const { onChange } = renderStrip("2026-10-01");
    const today = document.querySelector<HTMLButtonElement>("[data-day-today]");
    expect(today).toBeTruthy();
    expect(today!.textContent).toMatch(either("list", "dayToday"));
    fireEvent.click(today!);
    expect(onChange).toHaveBeenCalledWith(TODAY);
  });

  it("adds no extra Today control while today is in the visible week", () => {
    renderStrip("2026-09-12");
    expect(document.querySelector("[data-day-today]")).toBeNull();
  });
});

describe("DaySelector · accessibility and structure", () => {
  it("is a labelled group of real buttons", () => {
    renderStrip();
    expect(screen.getByRole("group", { name: either("shell", "chooseDay") })).toBeTruthy();
    for (const b of days()) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
      expect(b.className).toMatch(/focus-visible:outline/);
    }
  });

  it("is one tab stop; arrow keys, Home and End move focus between days", () => {
    renderStrip("2026-09-12");
    expect(days().filter((b) => b.tabIndex === 0).map((b) => b.dataset.day)).toEqual(["2026-09-12"]);

    day("2026-09-12").focus();
    fireEvent.keyDown(day("2026-09-12"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(day("2026-09-13"));
    fireEvent.keyDown(day("2026-09-13"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(day("2026-09-12"));
    fireEvent.keyDown(day("2026-09-12"), { key: "Home" });
    expect(document.activeElement).toBe(days()[0]);
    fireEvent.keyDown(days()[0], { key: "End" });
    expect(document.activeElement).toBe(days()[6]);
  });

  it("gives every day the same fixed box whatever its state, in one scrollable row", () => {
    renderStrip("2026-09-12");
    const size = (b: HTMLElement) => b.className.split(/\s+/).filter((c) => /^(sm:)?[hw]-/.test(c)).sort().join(" ");
    const sizes = new Set(days().map(size));
    expect(sizes.size).toBe(1);
    expect([...sizes][0]).toMatch(/w-12/);
    const scroller = screen.getByRole("group", { name: either("shell", "chooseDay") });
    expect(scroller.className).toMatch(/overflow-x-auto/);
    expect(scroller.className).toMatch(/touch-pan-x/);
    expect(scroller.className).not.toMatch(/flex-wrap/);
  });

  it("respects reduced motion on the selected-state transition", () => {
    renderStrip();
    for (const b of days()) expect(b.className).toMatch(/motion-reduce:transition-none/);
  });
});

/**
 * Plan entitlements. The window itself comes from `buildTierDates`, the rule the
 * app already owns (tierPredictWindowDays: free 1, premium 2, ultra 3), so these
 * tests move with the product instead of restating a copy of it.
 *
 * Three ideas stay separate here: BROWSING a past day, SELECTING a future day,
 * and GENERATING predictions. Only the middle one is what a plan gates.
 */
describe("DaySelector · plan-gated future days", () => {
  const TOMORROW = addIsoDay(TODAY, 1);
  const DAY_AFTER = addIsoDay(TODAY, 2);
  const YESTERDAY = addIsoDay(TODAY, -1);

  function renderForTier(tier: string | undefined) {
    const onChange = vi.fn();
    const onLockedDay = vi.fn();
    render(
      <DaySelector
        value={TODAY}
        today={TODAY}
        onChange={onChange}
        forecastableDates={buildTierDates(TODAY, tier)}
        onLockedDay={onLockedDay}
      />
    );
    const day = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)!;
    return { onChange, onLockedDay, day };
  }

  /** A locked day must refuse the selection AND say why — never silently. */
  function expectLocked(iso: string, tier: string | undefined) {
    const { onChange, onLockedDay, day } = renderForTier(tier);
    const target = day(iso);
    expect(target.dataset.dayLocked, `${iso} should be locked for ${tier}`).toBe("true");
    expect(target.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(target);
    expect(onChange, "a locked day must not move the selection").not.toHaveBeenCalled();
    expect(onLockedDay).toHaveBeenCalledWith(iso);
  }

  function expectSelectable(iso: string, tier: string | undefined) {
    const { onChange, onLockedDay, day } = renderForTier(tier);
    const target = day(iso);
    expect(target.dataset.dayLocked, `${iso} should be selectable for ${tier}`).toBeUndefined();
    fireEvent.click(target);
    expect(onChange).toHaveBeenCalledWith(iso);
    expect(onLockedDay).not.toHaveBeenCalled();
  }

  it("free: tomorrow and the day after are both locked", () => {
    expectLocked(TOMORROW, "free");
    cleanup();
    expectLocked(DAY_AFTER, "free");
  });

  it("premium: tomorrow opens, the day after stays locked", () => {
    expectSelectable(TOMORROW, "premium");
    cleanup();
    expectLocked(DAY_AFTER, "premium");
  });

  it("ultra: both future days open", () => {
    expectSelectable(TOMORROW, "ultra");
    cleanup();
    expectSelectable(DAY_AFTER, "ultra");
  });

  /*
    Historical browsing is NOT a plan feature. A free account keeps every past
    day it could reach before, and today is never locked for anyone — past-day
    Predict is refused separately, inside warmAndPredict.
  */
  it.each(["free", "premium", "ultra"])("%s: today and past days stay reachable", (tier) => {
    expectSelectable(YESTERDAY, tier);
    cleanup();
    const { day } = renderForTier(tier);
    expect(day(TODAY).dataset.dayLocked).toBeUndefined();
  });

  /*
    The calendar input is a SECOND way into the same state. Guarding only the
    day buttons left the lock one tap from being bypassed: the picker sits
    beside the locked days, and a typed or picked date went straight through to
    onChange — no upgrade prompt, no refusal, the browsed day simply moved.
  */
  it("free: the calendar input refuses a locked future date", () => {
    const onChange = vi.fn();
    const onLockedDay = vi.fn();
    render(
      <DaySelector
        value={TODAY}
        today={TODAY}
        onChange={onChange}
        forecastableDates={buildTierDates(TODAY, "free")}
        onLockedDay={onLockedDay}
      />
    );
    const input = screen.getByLabelText(either("shell", "otherDate")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: addIsoDay(TODAY, 40) } });
    expect(onChange, "a locked date typed into the picker must not move the selection").not.toHaveBeenCalled();
    expect(onLockedDay).toHaveBeenCalledWith(addIsoDay(TODAY, 40));
    // The native bound is advertised too, so the picker can grey those days out.
    expect(input.max).toBe(TODAY);
  });

  it("free: the calendar input still reaches a past date", () => {
    const onChange = vi.fn();
    const onLockedDay = vi.fn();
    render(
      <DaySelector
        value={TODAY}
        today={TODAY}
        onChange={onChange}
        forecastableDates={buildTierDates(TODAY, "free")}
        onLockedDay={onLockedDay}
      />
    );
    const input = screen.getByLabelText(either("shell", "otherDate")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: addIsoDay(TODAY, -30) } });
    expect(onChange).toHaveBeenCalledWith(addIsoDay(TODAY, -30));
    expect(onLockedDay).not.toHaveBeenCalled();
  });

  it("premium: the calendar input reaches tomorrow but not the day after", () => {
    const onChange = vi.fn();
    const onLockedDay = vi.fn();
    render(
      <DaySelector
        value={TODAY}
        today={TODAY}
        onChange={onChange}
        forecastableDates={buildTierDates(TODAY, "premium")}
        onLockedDay={onLockedDay}
      />
    );
    const input = screen.getByLabelText(either("shell", "otherDate")) as HTMLInputElement;
    expect(input.max).toBe(TOMORROW);
    fireEvent.change(input, { target: { value: DAY_AFTER } });
    expect(onChange).not.toHaveBeenCalled();
    expect(onLockedDay).toHaveBeenCalledWith(DAY_AFTER);
  });

  it("locks nothing when no plan window is supplied", () => {
    const onChange = vi.fn();
    render(<DaySelector value={TODAY} today={TODAY} onChange={onChange} />);
    const target = document.querySelector<HTMLButtonElement>(`[data-day="${DAY_AFTER}"]`)!;
    expect(target.dataset.dayLocked).toBeUndefined();
    fireEvent.click(target);
    expect(onChange).toHaveBeenCalledWith(DAY_AFTER);
  });
});
