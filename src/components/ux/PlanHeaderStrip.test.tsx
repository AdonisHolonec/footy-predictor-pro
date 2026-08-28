import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import { ensureCatalog } from "../../i18n";
import PlanHeaderStrip, { formatBonusRemaining } from "./PlanHeaderStrip";
import ReferralCampaignStrip from "./ReferralCampaignStrip";
import type { UserTier } from "../../types";

/**
 * The permanent plan/referral strip.
 *
 * The assertion that matters most is that the EFFECTIVE tier drives the display.
 * A Free user running on bonus Ultra must read "Ultra"; showing their paid tier
 * would recreate exactly the bug PR2b split `tier` and `requestedTier` to fix.
 */

const NOW = Date.parse("2026-08-27T12:00:00.000Z");

function renderStrip(over: Partial<React.ComponentProps<typeof PlanHeaderStrip>> = {}) {
  render(
    <LocaleProvider>
      <PlanHeaderStrip
        tier={"free" as UserTier}
        requestedTier={"free" as UserTier}
        hasActiveBonus={false}
        bonusUntil={null}
        now={NOW}
        {...over}
      />
    </LocaleProvider>
  );
}

/*
  THE WHOLE CHROME, both surfaces at once.

  A reward is announced across two of them — the days on the plan card, the
  person on the campaign strip — and those are no longer the same component.
  Rendering both together is how these tests keep proving the pairing survived
  being split, rather than each half passing in isolation while the message as
  a whole makes no sense.
*/
function renderChrome(over: Partial<React.ComponentProps<typeof PlanHeaderStrip>> = {}) {
  const onOpenReferral = vi.fn();
  render(
    <LocaleProvider>
      <PlanHeaderStrip
        tier={"free" as UserTier}
        requestedTier={"free" as UserTier}
        hasActiveBonus={false}
        bonusUntil={null}
        now={NOW}
        {...over}
      />
      <ReferralCampaignStrip onOpenReferral={onOpenReferral} bonus={over.bonus ?? null} />
    </LocaleProvider>
  );
  return { onOpenReferral };
}

/** The chrome alone, so a test can re-render it with different props. */
function strip(over: Partial<React.ComponentProps<typeof PlanHeaderStrip>> = {}) {
  return (
    <LocaleProvider>
      <PlanHeaderStrip
        tier={"free" as UserTier}
        requestedTier={"free" as UserTier}
        hasActiveBonus={false}
        bonusUntil={null}
        now={NOW}
        {...over}
      />
      {/* Both surfaces: a notice arriving and leaving is a transition across
          the pair, and testing one half of it would prove nothing. */}
      <ReferralCampaignStrip onOpenReferral={() => {}} bonus={over.bonus ?? null} />
    </LocaleProvider>
  );
}

/** Same as renderStrip, but hands back `rerender` for transition tests. */
function renderStripFor(over: Partial<React.ComponentProps<typeof PlanHeaderStrip>> = {}) {
  return render(strip(over));
}

const card = () => screen.getByTestId("plan-card");
const detail = () => screen.getByTestId("plan-detail").textContent ?? "";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("the six plan states", () => {
  it("Free shows Free / Plan gratuit", () => {
    renderStrip({ tier: "free", requestedTier: "free" });
    expect(card().textContent).toContain("Free");
    expect(detail()).toMatch(/plan gratuit/i);
    expect(card().dataset.tier).toBe("free");
  });

  /*
    NO subscription instant here — that is the point. These two cards carry a
    paid tier with no grant the resolver can name, and they used to assert
    "Abonament activ", which is a claim about a subscription nobody supplied.
    The honest sentence for "the access is real, its source is unknown" is
    "Acces activ". A subscriber WITH an instant shows the countdown instead;
    that case is covered in headerV2.test.tsx.
  */
  it("Premium with no grant instant says access is active, not that it is paid for", () => {
    renderStrip({ tier: "premium", requestedTier: "premium" });
    expect(card().textContent).toContain("Premium");
    expect(detail()).toMatch(/acces activ/i);
    expect(detail()).not.toMatch(/abonament activ/i);
    expect(card().dataset.tier).toBe("premium");
  });

  it("Ultra with no grant instant says access is active, not that it is paid for", () => {
    renderStrip({ tier: "ultra", requestedTier: "ultra" });
    expect(card().textContent).toContain("Ultra");
    expect(detail()).toMatch(/acces activ/i);
    expect(detail()).not.toMatch(/abonament activ/i);
    expect(card().dataset.tier).toBe("ultra");
  });

  it("Free + bonus shows ULTRA, not Free — the effective tier wins", () => {
    renderStrip({ tier: "ultra", requestedTier: "free", hasActiveBonus: true, bonusUntil: null });
    expect(card().textContent).toContain("Ultra");
    expect(card().textContent).not.toContain("Free");
    expect(detail()).toMatch(/bonus activ/i);
    expect(card().dataset.tier).toBe("ultra");
  });

  it("Premium + bonus explains WHY the tier is Ultra", () => {
    renderStrip({ tier: "ultra", requestedTier: "premium", hasActiveBonus: true, bonusUntil: null });
    expect(card().textContent).toContain("Ultra");
    expect(detail()).toMatch(/premium \+ bonus/i);
  });

  it("Ultra + bonus shows Ultra / Bonus activ", () => {
    renderStrip({ tier: "ultra", requestedTier: "ultra", hasActiveBonus: true, bonusUntil: null });
    expect(card().textContent).toContain("Ultra");
    expect(detail()).toMatch(/bonus activ/i);
  });
});

describe("tier authority", () => {
  it("renders the EFFECTIVE tier even when it disagrees with the paid one", () => {
    // The whole point: `tier` decides, `requestedTier` only colours the wording.
    renderStrip({ tier: "ultra", requestedTier: "free", hasActiveBonus: true, bonusUntil: null });
    expect(card().dataset.tier).toBe("ultra");
  });

  it("colour is never the only signal — every state names its tier in text", () => {
    for (const tier of ["free", "premium", "ultra"] as UserTier[]) {
      cleanup();
      renderStrip({ tier, requestedTier: tier });
      expect(card().textContent?.toLowerCase()).toContain(tier);
    }
  });
});

describe("bonus countdown", () => {
  it("renders the remaining time ALONGSIDE the state, not instead of it", () => {
    // 12 days, 7 hours, 44 minutes after NOW.
    const until = new Date(NOW + ((12 * 24 + 7) * 60 + 44) * 60_000).toISOString();
    renderStrip({ tier: "ultra", requestedTier: "free", hasActiveBonus: true, bonusUntil: until });
    expect(detail()).toContain("12z 7h 44m");
    expect(detail()).toMatch(/bonus activ/i);
  });

  it("a paying Premium user on bonus sees BOTH why and how long", () => {
    // The state this exists to protect: the countdown must not hide the fact that
    // the underlying subscription is Premium, so the user knows what they fall
    // back to when the bonus ends.
    const until = new Date(NOW + (3 * 24 * 60 + 125) * 60_000).toISOString();
    renderStrip({ tier: "ultra", requestedTier: "premium", hasActiveBonus: true, bonusUntil: until });
    expect(detail()).toMatch(/premium \+ bonus/i);
    expect(detail()).toContain("3z 2h 5m");
  });

  it("falls back to the sub-label when there is no bonus instant to count", () => {
    renderStrip({ tier: "ultra", requestedTier: "ultra", hasActiveBonus: true, bonusUntil: null });
    expect(detail()).toMatch(/bonus activ/i);
  });

  it("never shows a negative or expired countdown", () => {
    const past = new Date(NOW - 60_000).toISOString();
    renderStrip({ tier: "ultra", requestedTier: "ultra", hasActiveBonus: true, bonusUntil: past });
    expect(detail()).toMatch(/bonus activ/i);
    expect(detail()).not.toContain("-");
  });

  it("ignores an unparseable instant rather than rendering NaN", () => {
    renderStrip({ tier: "ultra", requestedTier: "ultra", hasActiveBonus: true, bonusUntil: "not-a-date" });
    expect(detail()).not.toMatch(/nan/i);
  });

  it("creates NO timer when nothing is counting down", () => {
    const spy = vi.spyOn(window, "setInterval");
    render(
      <LocaleProvider>
        <PlanHeaderStrip
          tier="free"
          requestedTier="free"
          hasActiveBonus={false}
          bonusUntil={null}

        />
      </LocaleProvider>
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("formats units without leading zero groups", () => {
    expect(formatBonusRemaining(44 * 60_000, "z", "h", "m")).toBe("44m");
    expect(formatBonusRemaining((7 * 60 + 44) * 60_000, "z", "h", "m")).toBe("7h 44m");
    expect(formatBonusRemaining(0, "z", "h", "m")).toBe("");
  });
});

/*
  The "referral CTA" suite moved to ReferralCampaignStrip.test.tsx along with
  the control itself: the campaign is no longer part of this 56px strip. What
  stays here is the header's own guarantee that it does NOT render it.
*/
describe("the campaign is NOT in the 56px header", () => {
  it("renders no referral control of any kind", () => {
    renderStrip();
    expect(screen.queryByTestId("referral-cta")).toBeNull();
    expect(screen.queryByTestId("referral-detail")).toBeNull();
    expect(screen.getByTestId("plan-header-strip").textContent ?? "").not.toMatch(/invit/i);
  });

  it("still renders the plan itself, which is what the bar is for", () => {
    renderStrip({ tier: "ultra" as UserTier, requestedTier: "ultra" as UserTier });
    expect(screen.getByTestId("plan-card")).toBeTruthy();
    expect(screen.getByTestId("plan-detail")).toBeTruthy();
  });
});

/* --------------------------------- reward notices, inside the cards */

const REWARD = {
  grantId: "g-1",
  role: "inviter" as const,
  days: 5,
  inviteeName: "Andrei Popescu",
  grantedAt: null
};

const referralCard = () => screen.getByTestId("referral-cta");
const referralDetail = () => screen.getByTestId("referral-detail").textContent ?? "";

describe("reward notice lives in the cards, not in a toast", () => {
  it("puts the days on the PLAN card and the person on the REFERRAL card", () => {
    renderChrome({ tier: "ultra", requestedTier: "free", hasActiveBonus: true, bonusUntil: null, bonus: REWARD });
    // Each card carries the half it owns.
    expect(card().textContent).toContain("+5");
    expect(detail()).toMatch(/ultra/i);
    expect(referralCard().textContent).toMatch(/felicit/i);
    expect(referralDetail()).toContain("Andrei Popescu");
  });

  it("an invitee reward names nobody at all", () => {
    renderChrome({ bonus: { ...REWARD, role: "invitee", inviteeName: null } });
    expect(referralDetail()).toMatch(/invita/i);
    expect(referralDetail()).not.toContain("Andrei");
    // No identity of any kind reaches an invitee.
    expect(screen.getByTestId("plan-header-strip").textContent).not.toContain("@");
  });

  it("falls back to an anonymous wording when the invitee set no name", () => {
    renderChrome({ bonus: { ...REWARD, inviteeName: null } });
    expect(referralDetail()).toMatch(/cineva/i);
    expect(referralDetail()).not.toMatch(/undefined|null/i);
  });

  it("never renders an email or a uuid, whatever the server sent", () => {
    renderChrome({ bonus: { ...REWARD, inviteeName: "andrei@example.test" } });
    const text = screen.getByTestId("plan-header-strip").textContent ?? "";
    // The name is rendered as given, but the strip must never build one out of
    // identifiers — nothing here reads a uuid or an address from anywhere else.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("a long name truncates instead of stretching the header", () => {
    renderChrome({ bonus: { ...REWARD, inviteeName: "Alexandru-Constantin Dumitrescu" } });
    // The clamp moved off the whole message onto the name alone: it used to cut
    // the product's own words along with the name it was there to bound.
    const name = screen.getByTestId("referral-name");
    expect(name.className).toContain("truncate");
    // Shrinks under flex pressure now instead of carrying a fixed 32px cap that
    // cut every name to ~4 characters whether or not the row was short of room.
    expect(name.className).toContain("min-w-0");
    expect(name.className).toContain("shrink");
    expect(name.className).not.toMatch(/max-w-/);
    expect(screen.getByTestId("referral-fixed").className).not.toContain("truncate");
    // The reward half stays fully readable regardless of the name's length.
    expect(card().textContent).toContain("+5");
  });

  it("marks the strip as showing a notice, for styling and for tests", () => {
    renderChrome({ bonus: REWARD });
    expect(screen.getByTestId("plan-header-strip").dataset.notice).toBe("true");
    cleanup();
    renderStrip();
    expect(screen.getByTestId("plan-header-strip").dataset.notice).toBeUndefined();
  });
});

describe("a notice changes nothing permanent", () => {
  it("leaves the referral CTA still clickable, with the same meaning", () => {
    const { onOpenReferral } = renderChrome({ bonus: REWARD });
    const cta = referralCard();
    expect(cta.tagName).toBe("BUTTON");
    fireEvent.click(cta);
    // Still the entry point to the referral surface — never a claim.
    expect(onOpenReferral).toHaveBeenCalledTimes(1);
  });

  it("does not change the effective plan the card represents", () => {
    // The reward is news about a grant; the tier still comes from the server.
    renderStrip({ tier: "premium", requestedTier: "premium", bonus: REWARD });
    expect(card().dataset.tier).toBe("premium");
  });

  it("restores the permanent content when the notice is gone", () => {
    const { rerender } = renderStripFor({ bonus: REWARD });
    expect(referralCard().textContent).toMatch(/felicit/i);

    rerender(strip({ bonus: null }));
    expect(referralCard().textContent).toMatch(/invit/i);
    expect(referralDetail()).toContain("+5");
    expect(detail()).toMatch(/plan gratuit/i);
  });
});

/*
  THE SPOKEN ANNOUNCEMENT SURVIVED THE SPLIT.

  The reward is shown across two surfaces that are now two components — the
  days here, the person on the campaign strip below the bar. A sighted user
  reads them as one thing because they are eight pixels apart; a screen-reader
  user cannot perceive that adjacency at all, which is why the announcement is
  ONE sentence carrying both halves, and why it stays in the header rather than
  being split in two along the same seam as the layout.

  Nothing tested this before, which made it exactly the kind of thing a later
  tidy-up would quietly take apart.
*/
describe("the reward is announced as one sentence, not two fragments", () => {
  it("speaks the person AND the days, in one live region", () => {
    renderChrome({ bonus: REWARD });
    const live = document.querySelector('[role="status"][aria-live="polite"]') as HTMLElement;
    expect(live).toBeTruthy();
    const said = live.textContent ?? "";
    // The campaign's half...
    expect(said).toMatch(/felicit/i);
    expect(said).toContain("Andrei Popescu");
    // ...and the plan card's half, in the same utterance.
    expect(said).toContain("+5");
    expect(said).toMatch(/ultra/i);
  });

  it("says nothing at all when there is no reward", () => {
    renderChrome();
    const live = document.querySelector('[role="status"][aria-live="polite"]') as HTMLElement;
    expect((live.textContent ?? "").trim()).toBe("");
  });

  it("lives in the header, so moving the campaign did not move the announcement", () => {
    renderChrome({ bonus: REWARD });
    const live = document.querySelector('[role="status"][aria-live="polite"]')!;
    expect(live.closest('[data-testid="plan-header-strip"]')).toBeTruthy();
    expect(live.closest('[data-testid="referral-campaign-strip"]')).toBeNull();
  });

  it("is the ONLY live region in the chrome — the strip must not announce too", () => {
    renderChrome({ bonus: REWARD });
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
  });
});

describe("localisation", () => {
  it("renders English wording when the catalogue is English", async () => {
    await ensureCatalog("en");
    window.localStorage.setItem("footy:locale", "en");
    renderChrome({ tier: "free", requestedTier: "free" });
    expect(detail()).toMatch(/free plan/i);
    expect(screen.getByTestId("referral-cta").textContent).toMatch(/invite/i);
    // A missing key would render the dotted path.
    expect(screen.getByTestId("plan-header-strip").textContent).not.toContain("account.header");
  });
});
