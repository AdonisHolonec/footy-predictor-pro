import { cleanup, render, screen } from "@testing-library/react";
import { buildPredictAction } from "./predictState";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConsumerShell from "./ConsumerShell";
import { PRIMARY_NAV_ITEMS } from "./appNav";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";

/**
 * The shell owns navigation. UX-B: one ≤56 px context bar; five primary
 * destinations rendered identically in the bottom bar (mobile) and the rail
 * (desktop); Tickets as a subordinate desktop entry; nothing else in the chrome.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const either = (ns: string, key: string) => new RegExp(`^(${E[ns][key]}|${R[ns][key]})$`);

/*
  ConsumerShell no longer takes a bare onPredict — it consumes the shared
  Predict contract, so the header cannot disagree with the other surfaces about
  whether the action is available.
*/
const idlePredict = () =>
  buildPredictAction({
    state: "idle",
    labels: { label: "Generează Predicții", hint: "Generează predicții pentru zilele selectate",
              busy: "Se generează predicțiile…", quotaSpent: "Ai folosit toate predicțiile de azi" },
    run: () => {}
  });

function renderShell(overrides: Record<string, unknown> = {}) {
  const onNavigate = vi.fn();
  render(
    <ConsumerShell activeNav="home" onNavigate={onNavigate} date="2026-08-21" onDateChange={() => {}} {...overrides}>
      <div>content</div>
    </ConsumerShell>
  );
  return { onNavigate };
}

describe("ConsumerShell navigation", () => {
  afterEach(cleanup);

  it("renders the five primary destinations twice — bottom bar and desktop rail — in the same order", () => {
    renderShell();
    const ids = PRIMARY_NAV_ITEMS.map((i) => i.id);
    expect(ids).toEqual(["home", "matches", "history", "statistics", "profile"]);
    for (const id of ids) {
      expect(document.querySelectorAll(`[data-nav="${id}"]:not([data-nav-rank])`)).toHaveLength(2);
    }
  });

  it("labels every primary destination with its product name (Today · Matches · Results · Performance · Account)", () => {
    renderShell();
    for (const key of ["today", "matches", "results", "performance", "account"]) {
      expect(screen.getAllByRole("button", { name: either("nav", key) }).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("navigates from every primary control", () => {
    const { onNavigate } = renderShell();
    for (const item of PRIMARY_NAV_ITEMS) {
      (document.querySelector(`[data-nav="${item.id}"]`) as HTMLButtonElement).click();
      expect(onNavigate).toHaveBeenLastCalledWith(item.id);
    }
  });

  it("marks the active destination for assistive tech on both bars", () => {
    renderShell({ activeNav: "history" });
    const current = document.querySelectorAll('[data-nav="history"][aria-current="page"]');
    expect(current).toHaveLength(2);
  });

  it("offers Tickets only as a secondary desktop entry, never in the bottom bar", () => {
    renderShell();
    const tickets = document.querySelectorAll('[data-nav="tickets"]');
    expect(tickets).toHaveLength(1);
    expect(tickets[0].getAttribute("data-nav-rank")).toBe("secondary");
    expect(tickets[0].closest("nav")?.className).toMatch(/lg:flex/);
  });

  it("has no Live and no Predictions destination anywhere", () => {
    renderShell();
    expect(document.querySelector('[data-nav="live"]')).toBeNull();
    expect(document.querySelector('[data-nav="predictions"]')).toBeNull();
    expect(screen.queryByRole("button", { name: either("nav", "predictions") })).toBeNull();
  });

  it("shows the live count on Matches as a badge, not a tab", () => {
    renderShell({ liveCount: 3 });
    const badges = document.querySelectorAll('[data-nav="matches"] [aria-label]');
    expect(badges.length).toBe(2);
    expect(badges[0].textContent).toBe("3");
  });
});

describe("ConsumerShell chrome", () => {
  afterEach(cleanup);

  it("is a single 56 px context bar: brand, date, Predict — nothing else", () => {
    renderShell({ predictAction: idlePredict() });
    const bar = screen.getByTestId("context-bar");
    const tokens = bar.className.split(/\s+/);
    expect(tokens).toContain("h-14"); // a fixed 56 px, not a min-height that can wrap taller
    expect(tokens).not.toContain("flex-wrap");
    expect(tokens.some((c) => /^min-h-/.test(c))).toBe(false);
    expect(bar.querySelector('input[type="date"]')).toBeTruthy();
    expect(bar.querySelector('input[type="search"]')).toBeNull();
    expect(screen.queryByRole("group", { name: /limb|lang/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /ligi|leagues/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reincarca|Reload|Reîncarcă/i })).toBeNull();
  });

  it("keeps Predict as the critical action with a 44 px pointer target and a dense box", () => {
    renderShell({ predictAction: idlePredict() });
    const predict = screen.getAllByRole("button", { name: either("shell", "predictTip") })[0];
    expect(predict.className).toContain("touch-target");
    expect(predict.className).not.toContain("min-h-[var(--fp-touch)]");
  });

  it("gives every bottom-bar tab at least a 56 px tall, full-width target", () => {
    renderShell();
    const tabs = document.querySelectorAll('nav.lg\\:hidden [data-nav]');
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) {
      expect(tab.className).toMatch(/min-h-\[56px\]/);
      expect(tab.className).toMatch(/\bflex-1\b/);
    }
  });
});
