import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import PlanHeaderStrip, { resolveAccess } from "./PlanHeaderStrip";
import PredictCta from "./PredictCta";
import { buildPredictAction, isPredictBlocked, type PredictState } from "./predictState";
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
  /*
    The countdown and the tier beside it must always describe the SAME grant.
    Shown apart they can contradict each other, and the pairing is a factual
    claim about paid access sitting in permanent chrome.
  */
  const access = (over: Parameters<typeof resolveAccess>[0]) => resolveAccess(over);
  const base = { tier: "free", requestedTier: "free", hasActiveBonus: false, now: NOW } as const;

  it("returns null when nothing is running — a free plan has no expiry to show", () => {
    expect(access({ ...base }).expiresAt).toBeNull();
  });

  it("ignores an instant that has already passed", () => {
    // subscription_expires_at outlives a lapsed plan; counting it down would
    // promise time the user does not have.
    expect(
      access({ ...base, tier: "premium", requestedTier: "premium", subscriptionUntil: iso(-DAY) }).expiresAt
    ).toBeNull();
  });

  it("ignores a bonus instant when the server says the bonus is not active", () => {
    expect(access({ ...base, bonusUntil: iso(5 * DAY) }).expiresAt).toBeNull();
  });

  it("counts the BONUS, not the subscription, when the bonus is why the tier reads Ultra", () => {
    /*
      The regression. A Premium subscriber with 30 days left who accepts a
      5-day Ultra referral used to read "ULTRA · 30z" — the subscription's
      clock under the bonus's tier. Ultra ends in five days.
    */
    const a = access({
      tier: "ultra",
      requestedTier: "premium",
      hasActiveBonus: true,
      bonusUntil: iso(5 * DAY),
      subscriptionUntil: iso(30 * DAY),
      now: NOW
    });
    expect(a.expiresAt).toBe(NOW + 5 * DAY);
    expect(a.source).toBe("bonus");
    expect(a.explainsUpgrade).toBe(true);
    expect(a.reasonKey).toBe("account.header.premiumPlusBonus");
    // and never the subscription's instant
    expect(a.expiresAt).not.toBe(NOW + 30 * DAY);
  });

  it("counts the bonus for a Free user it lifted to Ultra", () => {
    const a = access({
      tier: "ultra",
      requestedTier: "free",
      hasActiveBonus: true,
      bonusUntil: iso(5 * DAY),
      now: NOW
    });
    expect(a.expiresAt).toBe(NOW + 5 * DAY);
    expect(a.source).toBe("bonus");
    expect(a.reasonKey).toBe("account.header.bonusActive");
  });

  it("counts the SUBSCRIPTION for an Ultra subscriber whose bonus adds no tier", () => {
    /*
      The bonus grants Ultra to somebody who already pays for Ultra, so it
      raises nothing and the subscription is what sustains the tier on screen.
    */
    const a = access({
      tier: "ultra",
      requestedTier: "ultra",
      hasActiveBonus: true,
      bonusUntil: iso(5 * DAY),
      subscriptionUntil: iso(30 * DAY),
      now: NOW
    });
    expect(a.expiresAt).toBe(NOW + 30 * DAY);
    expect(a.source).toBe("subscription");
    expect(a.explainsUpgrade).toBe(false);
    expect(a.reasonKey).toBe("account.header.subscriptionActive");
  });

  it("names a TRIAL as a trial, never as a subscription", () => {
    /*
      `source` has four members and the reason branch had three keys, so a
      trial-owned countdown fell through to "Abonament activ": a card reading
      "ULTRA · Abonament activ · 10z" whose clock was a 24h trial and whose
      subscription was Premium — or absent entirely. Same false pairing, one
      grant over.
    */
    const a = access({
      tier: "ultra",
      requestedTier: "premium",
      hasActiveBonus: true,
      bonusUntil: iso(2 * DAY),
      trials: [{ tier: "ultra" as const, until: iso(10 * DAY) }],
      subscriptionUntil: iso(30 * DAY),
      now: NOW
    });
    expect(a.source).toBe("trial");
    expect(a.expiresAt).toBe(NOW + 10 * DAY);
    expect(a.reasonKey).toBe("account.header.trialActive");
    expect(a.reasonKey).not.toBe("account.header.subscriptionActive");
  });

  it("names a trial for a Free user it lifted, with no subscription at all", () => {
    const a = access({
      tier: "ultra",
      requestedTier: "free",
      hasActiveBonus: false,
      trials: [{ tier: "ultra" as const, until: iso(20 * 3600_000) }],
      now: NOW
    });
    expect(a.source).toBe("trial");
    expect(a.reasonKey).toBe("account.header.trialActive");
  });

  it("counts the subscription when there is no bonus at all — Premium", () => {
    const a = access({
      tier: "premium",
      requestedTier: "premium",
      hasActiveBonus: false,
      subscriptionUntil: iso(9 * DAY),
      now: NOW
    });
    expect(a.expiresAt).toBe(NOW + 9 * DAY);
    expect(a.source).toBe("subscription");
  });

  it("counts the subscription when there is no bonus at all — Ultra", () => {
    const a = access({
      tier: "ultra",
      requestedTier: "ultra",
      hasActiveBonus: false,
      subscriptionUntil: iso(12 * DAY),
      now: NOW
    });
    expect(a.expiresAt).toBe(NOW + 12 * DAY);
    expect(a.source).toBe("subscription");
  });

  it("falls back to the subscription once the bonus instant has expired", () => {
    const a = access({
      tier: "premium",
      requestedTier: "premium",
      hasActiveBonus: true,
      bonusUntil: iso(-HOUR),
      subscriptionUntil: iso(30 * DAY),
      now: NOW
    });
    expect(a.expiresAt).toBe(NOW + 30 * DAY);
    expect(a.source).toBe("subscription");
  });

  it("shows nothing rather than the subscription when an upgrade has no known end", () => {
    /*
      hasActiveBonus with no usable bonusUntil. The old resolver answered with
      the subscription's instant, which is the false pairing again; no clock is
      the honest answer.
    */
    const a = access({
      tier: "ultra",
      requestedTier: "premium",
      hasActiveBonus: true,
      bonusUntil: null,
      subscriptionUntil: iso(30 * DAY),
      now: NOW
    });
    expect(a.expiresAt).toBeNull();
    expect(a.reasonKey).toBe("account.header.premiumPlusBonus");
  });

  it("reports no time for an expired subscription with nothing else running", () => {
    const a = access({
      tier: "free",
      requestedTier: "free",
      hasActiveBonus: false,
      subscriptionUntil: iso(-DAY),
      now: NOW
    });
    expect(a.expiresAt).toBeNull();
    expect(a.source).toBe("none");
    expect(a.reasonKey).toBe("account.header.freePlan");
  });
});

describe("a trial's tier and its clock are never separated", () => {
  /*
    useAuth used to hand the header Math.max(premiumTrial, ultraTrial), which
    discards WHICH trial is which. Every case below has two trials running with
    different ends, so a collapsed value would pick the wrong one.
  */
  const t = (tier: UserTier, ms: number) => ({ tier, until: iso(ms) });
  const acc = (over: Parameters<typeof resolveAccess>[0]) => resolveAccess(over);

  it("Premium trial only, on a Premium card", () => {
    const a = acc({ tier: "premium", requestedTier: "free", hasActiveBonus: false,
      trials: [t("premium", 20 * HOUR)], now: NOW });
    expect(a.source).toBe("trial");
    expect(a.expiresAt).toBe(NOW + 20 * HOUR);
    expect(a.reasonKey).toBe("account.header.trialActive");
  });

  it("Ultra trial only, on an Ultra card", () => {
    const a = acc({ tier: "ultra", requestedTier: "free", hasActiveBonus: false,
      trials: [t("ultra", 20 * HOUR)], now: NOW });
    expect(a.expiresAt).toBe(NOW + 20 * HOUR);
  });

  it("BOTH trials, Ultra card: counts the ULTRA trial even though Premium's runs longer", () => {
    // The regression. Collapsed, this rendered 23h under an ULTRA card.
    const a = acc({ tier: "ultra", requestedTier: "free", hasActiveBonus: false,
      trials: [t("premium", 23 * HOUR), t("ultra", 1 * HOUR)], now: NOW });
    expect(a.source).toBe("trial");
    expect(a.expiresAt).toBe(NOW + 1 * HOUR);
    expect(a.expiresAt).not.toBe(NOW + 23 * HOUR);
  });

  it("BOTH trials, Premium card: a Premium trial DOES sustain Premium, and Ultra's outranks it", () => {
    const a = acc({ tier: "premium", requestedTier: "free", hasActiveBonus: false,
      trials: [t("premium", 2 * HOUR), t("ultra", 9 * HOUR)], now: NOW });
    // Ultra outranks Premium, so it can hold a Premium card up too — later wins.
    expect(a.expiresAt).toBe(NOW + 9 * HOUR);
  });

  it("an EXPIRED Premium trial is not counted", () => {
    const a = acc({ tier: "ultra", requestedTier: "free", hasActiveBonus: false,
      trials: [t("premium", -HOUR), t("ultra", 5 * HOUR)], now: NOW });
    expect(a.expiresAt).toBe(NOW + 5 * HOUR);
  });

  it("an EXPIRED Ultra trial leaves no candidate for an Ultra card", () => {
    const a = acc({ tier: "ultra", requestedTier: "free", hasActiveBonus: false,
      trials: [t("premium", 23 * HOUR), t("ultra", -HOUR)], now: NOW });
    // The Premium trial cannot sustain Ultra, so there is no clock — not 23h.
    expect(a.expiresAt).toBeNull();
    expect(a.source).toBe("none");
  });

  it("an active subscription beside a trial: the longer sustaining grant wins", () => {
    const a = acc({ tier: "premium", requestedTier: "premium", hasActiveBonus: false,
      trials: [t("premium", 10 * HOUR)], subscriptionUntil: iso(30 * DAY), now: NOW });
    expect(a.source).toBe("subscription");
    expect(a.expiresAt).toBe(NOW + 30 * DAY);
  });

  it("an active bonus beside a trial, both able to sustain the tier", () => {
    const a = acc({ tier: "ultra", requestedTier: "free", hasActiveBonus: true,
      bonusUntil: iso(5 * DAY), trials: [t("ultra", 2 * HOUR)], now: NOW });
    expect(a.source).toBe("bonus");
    expect(a.expiresAt).toBe(NOW + 5 * DAY);
  });
});

describe("no branch names a grant the user does not have", () => {
  /*
    `source` has four members; the reason branch used to have three keys, so
    anything unaccounted for fell through to "Abonament activ" — asserting a
    subscription for users who have none.
  */
  const acc = (over: Parameters<typeof resolveAccess>[0]) => resolveAccess(over);

  it("a quota-exempt account is not told it has a subscription", () => {
    // The server forces effectiveTier to ULTRA for exempt accounts and sends no
    // grants at all: no bonus, no trial, no subscription instant.
    const a = acc({ tier: "ultra", requestedTier: "free", hasActiveBonus: false, now: NOW });
    expect(a.source).toBe("none");
    expect(a.expiresAt).toBeNull();
    expect(a.reasonKey).toBe("account.header.tierActive");
    expect(a.reasonKey).not.toBe("account.header.subscriptionActive");
  });

  it("an expired Ultra trial beside a live Premium trial is not called a subscription", () => {
    const a = acc({
      tier: "ultra",
      requestedTier: "free",
      hasActiveBonus: false,
      trials: [{ tier: "premium" as const, until: iso(23 * HOUR) }, { tier: "ultra" as const, until: iso(-HOUR) }],
      now: NOW
    });
    // The premium trial cannot sustain Ultra, so there is no clock…
    expect(a.expiresAt).toBeNull();
    // …and the sentence must not invent one either.
    expect(a.reasonKey).toBe("account.header.tierActive");
  });

  it("a real subscriber still reads as a subscriber", () => {
    const a = acc({ tier: "premium", requestedTier: "premium", hasActiveBonus: false,
      subscriptionUntil: iso(30 * DAY), now: NOW });
    expect(a.reasonKey).toBe("account.header.subscriptionActive");
  });

  it("a free plan still reads as a free plan", () => {
    const a = acc({ tier: "free", requestedTier: "free", hasActiveBonus: false, now: NOW });
    expect(a.reasonKey).toBe("account.header.freePlan");
  });
});

describe("L + M — an exhausted quota never costs the user their countdown", () => {
  /*
    A pass once let the spent allowance REPLACE the clock. A Premium subscriber
    then lost their expiry for the rest of any day they used the product — the
    exact failure this card was built to prevent, reintroduced under a new
    trigger. Both facts now coexist.
  */
  const DAY_MS = 86_400_000;

  it("a blocked subscriber sees the allowance AND keeps the subscription clock", () => {
    plan({
      tier: "premium",
      requestedTier: "premium",
      subscriptionUntil: new Date(NOW + 30 * DAY_MS).toISOString(),
      quota: { used: 20, limit: 20, quotaExempt: false }
    });
    const line = detail();
    expect(line).toContain("0 predicții azi");
    expect(line).toContain("30z");
  });

  it("the countdown survives for assistive technology at every width", () => {
    plan({
      tier: "ultra",
      requestedTier: "ultra",
      subscriptionUntil: new Date(NOW + 30 * DAY_MS).toISOString(),
      quota: { used: 50, limit: 50, quotaExempt: false }
    });
    // the spoken form is not behind the sm breakpoint
    expect(detail()).toMatch(/de zile/);
  });

  it("a blocked FREE user shows the allowance and invents no countdown", () => {
    plan({ tier: "free", requestedTier: "free", quota: { used: 5, limit: 5, quotaExempt: false } });
    expect(detail()).toContain("0 predicții azi");
    expect(detail()).not.toMatch(/\dz /);
  });

  it("M — an exempt account shows no quota at all, spent or otherwise", () => {
    plan({ tier: "ultra", requestedTier: "ultra", quota: null,
           subscriptionUntil: new Date(NOW + 30 * DAY_MS).toISOString() });
    expect(detail()).not.toMatch(/predicți/i);
    expect(detail()).toContain("30z");
  });
});

describe("the quota line agrees with the Predict button", () => {
  /*
    An exempt account reached its counters and read "0 predicții azi" beside a
    working Generate button.

    The card no longer infers exemption from being handed `null`: it receives
    the SAME PredictQuota the gate reads and asks the SAME predicate. These
    tests therefore hand it real counters WITH the exemption set, which is the
    case the old hardcoded `quotaExempt: false` got wrong — and which passing
    `quota: null` could never have caught.
  */
  it("free account with quota remaining shows what is left", () => {
    plan({ tier: "free", requestedTier: "free", quota: { used: 2, limit: 5, quotaExempt: false } });
    expect(time()).toBe("3 predicții azi");
  });

  it("free account with one left uses the singular", () => {
    plan({ tier: "free", requestedTier: "free", quota: { used: 4, limit: 5, quotaExempt: false } });
    expect(time()).toBe("1 predicție azi");
  });

  it("free account exhausted reads zero, not a negative", () => {
    plan({ tier: "free", requestedTier: "free", quota: { used: 9, limit: 5, quotaExempt: false } });
    expect(time()).toBe("0 predicții azi");
  });

  it("an exempt account shows NO quota line at all", () => {
    plan({ tier: "ultra", requestedTier: "ultra", quota: null });
    expect(screen.queryByTestId("plan-time")).toBeNull();
    expect(detail()).not.toMatch(/predicți/i);
  });

  it("R — an exempt account AT its counter limit still announces no exhaustion", () => {
    /*
      The drift case. `used >= limit` is true, so the old hardcoded
      `quotaExempt: false` made this card say "0 predicții azi" — beside a
      Predict button that, reading the same numbers WITH the exemption, was
      perfectly enabled. Two neighbours in permanent chrome disagreeing about
      one fact, which is what the shared predicate exists to make impossible.
    */
    plan({
      tier: "ultra",
      requestedTier: "ultra",
      quota: { used: 50, limit: 50, quotaExempt: true }
    });
    expect(detail()).not.toMatch(/predicți/i);
    expect(screen.queryByTestId("plan-time")).toBeNull();
  });

  it("R — an exempt account keeps its countdown rather than yielding it to a quota", () => {
    plan({
      tier: "ultra",
      requestedTier: "ultra",
      subscriptionUntil: new Date(NOW + 30 * DAY).toISOString(),
      quota: { used: 99, limit: 5, quotaExempt: true }
    });
    expect(detail()).toContain("30z");
    expect(detail()).not.toMatch(/predicți/i);
  });

  it("F — the card and the Predict gate answer from ONE predicate", () => {
    /*
      Not a source-text assertion: both sides are computed from the same quota
      and compared. If the card ever re-derives its own rule, one of these
      rows disagrees with isPredictBlocked and this fails.
    */
    const cases = [
      { used: 5, limit: 5, quotaExempt: false },
      { used: 4, limit: 5, quotaExempt: false },
      { used: 5, limit: 5, quotaExempt: true },
      { used: 0, limit: null, quotaExempt: false },
      { used: 9, limit: 5, quotaExempt: true }
    ];
    for (const quota of cases) {
      plan({ tier: "ultra", requestedTier: "ultra", quota });
      const cardSaysBlocked = /0 predicți/.test(detail());
      expect(cardSaysBlocked, `card disagreed with the gate for ${JSON.stringify(quota)}`).toBe(
        isPredictBlocked(quota)
      );
      cleanup();
    }
  });

  it("a Premium subscriber shows time, never a quota line", () => {
    plan({ tier: "premium", requestedTier: "premium", subscriptionUntil: iso(30 * DAY), quota: null });
    expect(time()).toBe("30z 0h 0m");
    expect(detail()).not.toMatch(/predicți/i);
  });

  it("an Ultra subscriber shows time, never a quota line", () => {
    plan({ tier: "ultra", requestedTier: "ultra", subscriptionUntil: iso(12 * DAY), quota: null });
    expect(time()).toBe("12z 0h 0m");
    expect(detail()).not.toMatch(/predicți/i);
  });
});

describe("the rendered card never pairs one grant's tier with another's clock", () => {
  it("renders ~5 days, not ~30, for Premium + Ultra bonus", () => {
    plan({
      tier: "ultra",
      requestedTier: "premium",
      hasActiveBonus: true,
      bonusUntil: iso(5 * DAY),
      subscriptionUntil: iso(30 * DAY)
    });
    expect(screen.getByTestId("plan-card").getAttribute("data-tier")).toBe("ultra");
    expect(time()).toContain("5z");
    expect(time()).not.toContain("30z");
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
    plan({ tier: "ultra", requestedTier: "free", trials: [{ tier: "ultra", until: iso(6 * HOUR) }] });
    expect(time()).toBe("6h 0m");
  });

  it("falls back to predictions left for a free plan, which has no expiry", () => {
    plan({ tier: "free", requestedTier: "free", quota: { used: 1, limit: 3, quotaExempt: false } });
    expect(time()).toMatch(/^2\b/);
  });

  it("never invents a time when there is none and no quota is known", () => {
    plan({ tier: "free", requestedTier: "free", quota: { used: 0, limit: null, quotaExempt: false } });
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

  it("counts the BONUS, not the longer subscription, because the bonus is what makes it Ultra", () => {
    /*
      This used to assert "30z 0h 0m" under the heading "time never shrinks on
      a bonus". That premise was the defect: the longer number belonged to the
      Premium subscription while the card was naming Ultra, so the pair was a
      false claim about paid access. The bonus's clock is the shorter one and
      the honest one.
    */
    plan({ tier: "ultra", requestedTier: "premium", ...bonusProps, subscriptionUntil: iso(30 * DAY) });
    expect(time()).toBe("11z 3h 49m");
    expect(time()).not.toBe("30z 0h 0m");
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
    plan({ tier: "free", requestedTier: "free", quota: { used: 1, limit: 3, quotaExempt: false } });
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

  it("lets the joiner's name — and only it — give up width", () => {
    /*
      No fixed max-width any more. The old `max-w-[2rem]` cut every name to
      about four characters at 390px whether or not the row was short of space,
      while the brand truncated to make room for it. The name now shrinks under
      real flex pressure instead, so it keeps every pixel the fixed copy is not
      using and is still the only thing in the row that can lose characters.
    */
    plan({ bonus: notice() });
    const name = screen.getByTestId("referral-name");
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("min-w-0");
    expect(name.className).toContain("shrink");
    expect(name.className).not.toMatch(/max-w-/);
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

/*
  The CTA is driven by the real contract, not by hand-written strings: these
  tests assert what a user hears, and building the action here is what keeps
  that tied to the composition the app actually ships.
*/
function cta(over: { state?: PredictState } = {}) {
  const onPredict = vi.fn();
  const action = buildPredictAction({
    state: over.state ?? "idle",
    labels: {
      label: "Generează Predicții",
      hint: "Generează predicții pentru zilele selectate",
      busy: "Se generează predicțiile…",
      quotaSpent: "Ai folosit toate predicțiile de azi"
    },
    run: onPredict
  });
  render(
    <LocaleProvider>
      <PredictCta action={action} />
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

  /*
    NOT `disabled`. The attribute drops the button out of the tab order and the
    browser blurs it the instant it lands on the focused element, so the user
    who just pressed Enter loses focus to <body> and never hears the busy name
    this component swaps in. aria-disabled keeps it focusable; the handler guard
    is what makes it inert.
  */
  it("stays focusable and keeps focus when a run starts", () => {
    const { el, onPredict } = cta({ state: "busy" });
    expect(el.disabled).toBe(false);
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("aria-busy")).toBe("true");
    el.focus();
    expect(document.activeElement).toBe(el);
    fireEvent.click(el);
    // still the active element — the press did not blur it
    expect(document.activeElement).toBe(el);
    expect(onPredict).not.toHaveBeenCalled();
  });

  it("names the busy state in the visible tooltip as well as the accessible name", () => {
    const { el } = cta({ state: "busy" });
    expect(el.getAttribute("title")).toBe("Se generează predicțiile…");
  });

  it("announces the busy state through a live region, not just its own name", () => {
    cta({ state: "busy" });
    const status = screen.getByTestId("predict-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Se generează predicțiile…");
  });

  it("says nothing in the live region while idle", () => {
    cta();
    expect(screen.getByTestId("predict-status").textContent).toBe("");
  });

  it("cannot be double-submitted while a run is in flight", () => {
    const { el, onPredict } = cta({ state: "busy" });
    fireEvent.click(el);
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: "Enter" });
    expect(onPredict).not.toHaveBeenCalled();
  });

  it("does not fire while the daily quota is spent, and names the reason", () => {
    const { el, onPredict } = cta({ state: "blocked" });
    expect(el.disabled).toBe(false);
    expect(el.getAttribute("aria-disabled")).toBe("true");
    // Label in Name (WCAG 2.5.3): the name still opens with the visible label,
    // so "click Generează Predicții" keeps working, AND it carries the reason.
    expect(el.getAttribute("aria-label")).toBe("Generează Predicții — Ai folosit toate predicțiile de azi");
    expect(el.getAttribute("aria-label")).toContain("Ai folosit toate predicțiile de azi");
    expect(el.className).toContain("is-disabled");
    // The visible tooltip must name the state too — it used to keep the idle
    // hint, inviting an action the button refuses.
    expect(el.getAttribute("title")).toBe("Ai folosit toate predicțiile de azi");
    expect(el.getAttribute("title")).not.toBe("Generează predicții pentru zilele selectate");
    el.focus();
    // reachable, so the reason can actually be heard
    expect(document.activeElement).toBe(el);
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
