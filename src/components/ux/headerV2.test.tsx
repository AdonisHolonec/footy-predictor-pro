import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import PlanHeaderStrip, { resolveAccessEnd } from "./PlanHeaderStrip";
import PredictCta from "./PredictCta";
import type { UserTier } from "../../types";

/**
 * Header V2: the plan card must say how much time you have, the referral offer
 * must never be cut, and the Predict CTA must say what it does.
 *
 * Those three were the reported problems, so each block asserts the fix rather
 * than the styling around it. The truncation tests check WHICH element carries
 * the clamp, because that is the thing that decides whether "+5 zile Ultra"
 * survives — a width assertion would pass while the text was still cut.
 */

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const iso = (ms: number) => new Date(NOW + ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function plan(over: Partial<React.ComponentProps<typeof PlanHeaderStrip>> = {}) {
  render(
    <LocaleProvider>
      <PlanHeaderStrip
        tier={"free" as UserTier}
        requestedTier={"free" as UserTier}
        hasActiveBonus={false}
        bonusUntil={null}
        onOpenReferral={() => {}}
        now={NOW}
        {...over}
      />
    </LocaleProvider>
  );
}

const detail = () => screen.getByTestId("plan-detail").textContent ?? "";
const time = () => screen.getByTestId("plan-time").textContent ?? "";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("which grant the countdown reports", () => {
  it("returns null when nothing is running — a free plan has no expiry to show", () => {
    expect(resolveAccessEnd({ hasActiveBonus: false, now: NOW })).toBeNull();
  });

  it("ignores an instant that has already passed", () => {
    // subscription_expires_at outlives a lapsed plan; counting it down would
    // promise time the user does not have.
    expect(resolveAccessEnd({ hasActiveBonus: false, subscriptionUntil: iso(-DAY), now: NOW })).toBeNull();
  });

  it("ignores a bonus instant when the server says the bonus is not active", () => {
    expect(resolveAccessEnd({ hasActiveBonus: false, bonusUntil: iso(5 * DAY), now: NOW })).toBeNull();
  });

  it("reports the LAST grant to expire, because that is when access really ends", () => {
    const end = resolveAccessEnd({
      hasActiveBonus: true,
      bonusUntil: iso(2 * DAY),
      trialUntil: iso(HOUR),
      subscriptionUntil: iso(9 * DAY),
      now: NOW
    });
    expect(end).toBe(NOW + 9 * DAY);
  });
});

describe("the plan card shows time, not just a plan", () => {
  it("shows a paying Premium user their subscription time — the case that showed nothing before", () => {
    plan({ tier: "premium", requestedTier: "premium", subscriptionUntil: iso(23 * HOUR + 14 * 60_000) });
    // Tier and time, which is the whole contract. The tier is the card's first
    // line; the second is the clock. "Abonament activ" is gone from it on
    // purpose — the ACTIV badge beside it already says exactly that, and the
    // duplicate cost ~85px that the brand needed to stay readable.
    expect(screen.getByTestId("plan-card").textContent ?? "").toMatch(/premium/i);
    expect(time()).toBe("23h 14m");
    expect(detail()).not.toMatch(/abonament/i);
  });

  it("shows Ultra subscription time", () => {
    plan({ tier: "ultra", requestedTier: "ultra", subscriptionUntil: iso(11 * DAY + 3 * HOUR + 49 * 60_000) });
    expect(time()).toBe("11z 3h 49m");
  });

  it("shows trial time when the trial is what grants the tier", () => {
    plan({ tier: "ultra", requestedTier: "free", trialUntil: iso(6 * HOUR) });
    expect(time()).toBe("6h 0m");
  });

  it("falls back to predictions left for a free plan, which has no expiry", () => {
    plan({ tier: "free", requestedTier: "free", quota: { used: 1, limit: 3 } });
    expect(time()).toMatch(/^2\b/);
  });

  it("never invents a time when there is none and no quota is known", () => {
    plan({ tier: "free", requestedTier: "free", quota: { used: 0, limit: null } });
    expect(screen.queryByTestId("plan-time")).toBeNull();
    expect(detail()).toMatch(/gratuit|free/i);
  });
});

describe("bonus states keep both the reason and the clock", () => {
  const bonusProps = { hasActiveBonus: true, bonusUntil: iso(11 * DAY + 3 * HOUR + 49 * 60_000) };

  it("free on bonus Ultra reads Ultra, says why, and still shows the time", () => {
    plan({ tier: "ultra", requestedTier: "free", ...bonusProps });
    expect(screen.getByTestId("plan-card").getAttribute("data-tier")).toBe("ultra");
    expect(detail()).toMatch(/bonus/i);
    expect(time()).toBe("11z 3h 49m");
  });

  it("premium on bonus Ultra explains it is Premium + bonus, with the time", () => {
    plan({ tier: "ultra", requestedTier: "premium", ...bonusProps });
    expect(detail()).toMatch(/premium/i);
    expect(time()).toBe("11z 3h 49m");
  });

  it("prefers the later of bonus and subscription, so time never shrinks on a bonus", () => {
    plan({ tier: "ultra", requestedTier: "premium", ...bonusProps, subscriptionUntil: iso(30 * DAY) });
    expect(time()).toBe("30z 0h 0m");
  });
});

describe("each tier keeps its own colour, and never colour alone", () => {
  for (const [tier, hue] of [
    ["free", "amber"],
    ["premium", "emerald"],
    ["ultra", "sky"]
  ] as const) {
    it(`${tier} is ${hue} AND spells the tier out in text`, () => {
      cleanup();
      plan({ tier, requestedTier: tier, subscriptionUntil: tier === "free" ? null : iso(DAY) });
      const card = screen.getByTestId("plan-card");
      expect(card.className).toContain(hue);
      expect(card.textContent ?? "").toMatch(new RegExp(tier, "i"));
    });
  }
});

describe("the corner badges", () => {
  it("marks an actually-running plan ACTIVE, and says nothing when nothing runs", () => {
    plan({ tier: "ultra", requestedTier: "ultra", subscriptionUntil: iso(DAY) });
    expect(screen.getByTestId("badge-active").textContent).toMatch(/activ/i);
    cleanup();
    // A free plan with no grant is not "active" in the sense the badge means,
    // and a badge that is always lit says nothing at all.
    plan({ tier: "free", requestedTier: "free", quota: { used: 1, limit: 3 } });
    expect(screen.queryByTestId("badge-active")).toBeNull();
  });

  it("marks the invite FREE, because costing nothing is the pitch", () => {
    plan();
    expect(screen.getByTestId("badge-free").textContent).toMatch(/gratis|free/i);
  });

  it("is absolutely positioned, so it cannot push the card or grow the bar", () => {
    // The layout guarantee: a corner tag that participates in flow would widen
    // the card and, in a 56px bar, that is a header-height bug waiting.
    plan({ tier: "ultra", requestedTier: "ultra", subscriptionUntil: iso(DAY) });
    for (const id of ["badge-active", "badge-free"]) {
      expect(screen.getByTestId(id).className).toContain("absolute");
    }
    // Its anchor must be the card, or "absolute" would resolve somewhere else.
    expect(screen.getByTestId("plan-card").className).toContain("relative");
    expect(screen.getByTestId("referral-cta").className).toContain("relative");
  });

  it("is decorative, so it is hidden from assistive technology", () => {
    // "Activ" restates the card's own words and "Gratis" restates the offer —
    // announcing either again would read the card twice.
    plan({ tier: "ultra", requestedTier: "ultra", subscriptionUntil: iso(DAY) });
    expect(screen.getByTestId("badge-active").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("badge-free").getAttribute("aria-hidden")).toBe("true");
  });

  it("steps aside during a notice, which is the card's own announcement", () => {
    plan({
      bonus: { grantId: "g1", role: "invitee", days: 5, inviteeName: null, grantedAt: new Date(NOW).toISOString() }
    });
    expect(screen.queryByTestId("badge-active")).toBeNull();
    expect(screen.queryByTestId("badge-free")).toBeNull();
  });
});

describe("each card centres its own content", () => {
  it("centres the plan and referral cards, not top-aligns them", () => {
    plan({ tier: "ultra", requestedTier: "ultra", subscriptionUntil: iso(DAY) });
    for (const id of ["plan-card", "referral-cta"]) {
      const el = screen.getByTestId(id);
      expect(el.className).toContain("items-center");
      expect(el.className).toContain("justify-center");
    }
  });
});

describe("the referral offer is never the thing that gets cut", () => {
  it("does not clamp the fixed offer — truncating it would sell nothing", () => {
    plan();
    const el = screen.getByTestId("referral-detail");
    expect(el.textContent).toMatch(/\+5 zile Ultra/i);
    // The clamp is what decides this, so assert its absence, not a width.
    expect(el.className).not.toContain("truncate");
    expect(el.className).not.toMatch(/max-w-/);
  });

  const notice = (over: Record<string, unknown> = {}) => ({
    grantId: "g1",
    role: "inviter" as const,
    days: 5,
    inviteeName: "Alexandra-Ioana Constantinescu-Popescu",
    grantedAt: new Date(NOW).toISOString(),
    ...over
  });

  it("clamps the joiner's name, which is unbounded and unknowable", () => {
    plan({ bonus: notice() });
    const name = screen.getByTestId("referral-name");
    expect(name.className).toContain("truncate");
    expect(name.className).toMatch(/max-w-/);
  });

  it("leaves the fixed words beside a name unclamped, so only the name loses characters", () => {
    // The bug: one interpolated string meant the clamp bounding an unknowable
    // name also cut "s-a alăturat", which is the product's own copy.
    plan({ bonus: notice() });
    const fixed = screen.getByTestId("referral-fixed");
    expect(fixed.textContent).toMatch(/s-a alăturat/i);
    expect(fixed.className).not.toContain("truncate");
    expect(fixed.className).not.toMatch(/max-w-/);
    expect(fixed.className).toContain("shrink-0");
  });

  it("never clamps an entirely fixed invitee notification", () => {
    plan({ bonus: notice({ role: "invitee", inviteeName: null }) });
    const el = screen.getByTestId("referral-detail");
    expect(el.textContent).toMatch(/invitație acceptată/i);
    expect(el.className).not.toContain("truncate");
    expect(el.className).not.toMatch(/max-w-/);
    // No name element at all — there is nothing dynamic here to shorten.
    expect(screen.queryByTestId("referral-name")).toBeNull();
  });

  it("never clamps the anonymous joiner message, which is also entirely fixed", () => {
    plan({ bonus: notice({ inviteeName: null }) });
    const el = screen.getByTestId("referral-detail");
    expect(el.textContent).toMatch(/cineva s-a alăturat/i);
    expect(el.className).not.toContain("truncate");
    expect(screen.queryByTestId("referral-name")).toBeNull();
  });

  it("keeps the FELICITĂRI! title unclamped in every notice shape", () => {
    for (const b of [notice(), notice({ inviteeName: null }), notice({ role: "invitee", inviteeName: null })]) {
      cleanup();
      plan({ bonus: b });
      const title = screen.getByTestId("referral-cta").querySelector("span");
      expect(title?.textContent).toMatch(/felicitări/i);
      expect(title?.className).not.toContain("truncate");
    }
  });

  it("still announces the whole sentence once, name included", () => {
    // The card may shorten a name; the screen reader must not get a fragment.
    plan({ bonus: notice() });
    const live = document.querySelector("[role='status']");
    expect(live?.textContent).toContain("Alexandra-Ioana Constantinescu-Popescu");
    expect(live?.textContent).toMatch(/s-a alăturat/i);
  });

  it("keeps the plan card unclamped too, so ULTRA and its time cannot be cut", () => {
    plan({ tier: "ultra", requestedTier: "ultra", subscriptionUntil: iso(11 * DAY) });
    expect(screen.getByTestId("plan-detail").className).not.toContain("truncate");
  });
});

function cta(over: Partial<React.ComponentProps<typeof PredictCta>> = {}) {
  const onPredict = vi.fn();
  render(
    <LocaleProvider>
      <PredictCta onPredict={onPredict} hint="Generează predicții pentru zilele selectate" {...over} />
    </LocaleProvider>
  );
  return { onPredict, el: screen.getByTestId("predict-cta") as HTMLButtonElement };
}

describe("the Predict CTA says what it does", () => {
  it("spells out the action, not an icon or a 'GO'", () => {
    const { el } = cta();
    // Letters are split for the shimmer, so read the assembled text.
    expect((el.textContent ?? "").toLowerCase()).toContain("generează");
    expect((el.textContent ?? "").toLowerCase()).toContain("predicții");
  });

  it("is a real button that calls the existing handler", () => {
    const { el, onPredict } = cta();
    expect(el.tagName).toBe("BUTTON");
    fireEvent.click(el);
    expect(onPredict).toHaveBeenCalledTimes(1);
  });

  it("keeps an accessible name even though the animated letters are hidden", () => {
    const { el } = cta();
    expect(el.getAttribute("aria-label")).toBe("Generează predicții pentru zilele selectate");
    // Label in Name: the accessible name opens with the visible label.
    expect(el.getAttribute("aria-label")?.toLowerCase()).toContain("generează predicții");
    expect(el.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("is keyboard reachable and shows a focus ring", () => {
    const { el } = cta();
    el.focus();
    expect(document.activeElement).toBe(el);
    expect(el.className).toMatch(/focus-visible:outline/);
  });

  it("does not fire while busy, and says so", () => {
    const { el, onPredict } = cta({ busy: true });
    expect(el.disabled).toBe(true);
    expect(el.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(el);
    expect(onPredict).not.toHaveBeenCalled();
  });

  it("does not fire while disabled", () => {
    const { el, onPredict } = cta({ disabled: true });
    expect(el.disabled).toBe(true);
    fireEvent.click(el);
    expect(onPredict).not.toHaveBeenCalled();
  });

  it("keeps a 44px pointer target", () => {
    expect(cta().el.className).toContain("touch-target");
  });

  it("animates per letter, which is what the shimmer needs", () => {
    const { el } = cta();
    const letters = el.querySelectorAll(".fp-predict-letter");
    expect(letters.length).toBeGreaterThan(5);
    // Staggered, or the whole word would flash at once.
    const delays = Array.from(letters).map((l) => (l as HTMLElement).style.animationDelay);
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it("stacks its two words, which is what made it compact enough to share the bar", () => {
    // On one line this ran ~190px and squeezed the brand down to "F…".
    const { el } = cta();
    const stack = el.querySelector("[aria-hidden='true']");
    expect(stack?.className).toContain("flex-col");
    expect(stack?.className).toContain("items-center");
    // Two rows, one per word — not one row that happens to wrap.
    expect(stack?.children.length).toBe(2);
  });

  it("carries no Uiverse black — the face is the brand accent", () => {
    const { el } = cta();
    expect(el.className).toContain("fp-predict");
    expect(el.className).not.toMatch(/bg-(black|gray|neutral|zinc)/);
    expect(el.getAttribute("style") ?? "").not.toMatch(/#101010/i);
  });
});
