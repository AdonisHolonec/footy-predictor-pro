import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import { ensureCatalog } from "../../i18n";

/**
 * The temporary subscription gate.
 *
 * What is worth protecting is not the blur — it is that the blur is NOT the
 * mechanism. A screen reader cannot see a blur and Tab does not care about
 * opacity, so the tests below check what actually blocks the section:
 * `aria-hidden` on the content and `disabled` on every purchase control, with
 * the support CTA deliberately left reachable.
 *
 * The gate must also stay clear of entitlement: a paying user is still Premium
 * or Ultra everywhere else, and referral is untouched.
 */

const startCheckout = vi.fn();
const openBillingPortal = vi.fn();

vi.mock("../../services/billingService", () => ({
  startCheckout: (...a: unknown[]) => startCheckout(...a),
  openBillingPortal: (...a: unknown[]) => openBillingPortal(...a),
  loadBillingConfig: () => Promise.resolve({ configured: true })
}));

// The referral and display-name cards fetch on mount; not what this file tests.
vi.mock("../../services/referralService", () => ({
  fetchReferralStatus: () =>
    Promise.resolve({
      hasReferralCode: false,
      code: null,
      inviter: { attributed: 0, qualified: 0, rewarded: 0, successful: 0, earnedDays: 0, capRemaining: 10, cap: 10 },
      invitee: null
    }),
  fetchOrCreateReferralCode: () => Promise.resolve(""),
  claimReferral: () => Promise.resolve({ state: "attributed", expiresAt: null }),
  ReferralError: class extends Error {}
}));
vi.mock("../../services/displayNameService", () => ({
  DISPLAY_NAME_MIN: 3,
  DISPLAY_NAME_MAX: 24,
  fetchDisplayName: () => Promise.resolve(null),
  saveDisplayName: () => Promise.resolve({ ok: true, reason: null, value: null }),
  validateDisplayNameShape: (v: string) => ({ value: v || null, reason: null }),
  tidyDisplayName: (v: string) => v.trim()
}));

const gate = vi.hoisted(() => ({ disabled: true }));
vi.mock("../../constants/featureGates", () => ({
  get SUBSCRIPTIONS_TEMPORARILY_DISABLED() {
    return gate.disabled;
  }
}));

async function renderProfile(over: Record<string, unknown> = {}) {
  const { default: ProfileView } = await import("./ProfileView");
  const props = {
    user: { id: "u1", email: "ana@example.test" },
    userTier: "free",
    isSubscriptionExpired: false,
    trialRemainingTime: { premiumMs: 0, ultraMs: 0 },
    tierQuotaExempt: false,
    predictCountToday: 1,
    predictLimitToday: 3,
    logout: vi.fn(),
    activate24hTrial: vi.fn(),
    updateFilters: vi.fn(),
    setStatus: vi.fn(),
    trialBusy: null,
    setTrialBusy: vi.fn(),
    billingBusy: null,
    setBillingBusy: vi.fn(),
    billingConfigured: true,
    formatRemaining: () => "00:00:00",
    handleNav: vi.fn(),
    showModelInternals: false,
    ...over
  };
  return render(
    <LocaleProvider>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ProfileView {...(props as any)} />
    </LocaleProvider>
  );
}

const card = () => screen.getByTestId("subscription-card");
const content = () => screen.getByTestId("subscription-content");

beforeEach(() => {
  gate.disabled = true;
  startCheckout.mockReset();
  openBillingPortal.mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the gated card", () => {
  it("keeps the subscription card visible rather than removing it", async () => {
    await renderProfile();
    expect(card()).toBeTruthy();
    // The real content is still mounted — the card keeps its shape.
    expect(content().textContent).toMatch(/premium/i);
    expect(content().textContent).toMatch(/ultra/i);
  });

  it("blurs the content", async () => {
    await renderProfile();
    expect(content().className).toContain("blur-");
  });

  /**
   * REGRESSION GUARD for the defect this gate shipped with.
   *
   * The card used to carry aria-disabled="true". Card renders a plain <div>,
   * whose implicit role is `generic` and does not support the attribute, so it
   * described nothing — but ARIA-aware consumers treat a disabled ancestor as
   * disabling everything inside it, and the support CTA is inside it. The one
   * action deliberately left available was announced as unavailable, and
   * Playwright refused to click it.
   *
   * Nothing in this card may reintroduce a disabled ancestor above the CTA.
   */
  it("never marks the whole card disabled, which would silence the CTA", async () => {
    await renderProfile();
    expect(card().getAttribute("aria-disabled")).toBeNull();
    expect(card().querySelector("[aria-disabled='true']")).toBeNull();
  });

  it("hides the blurred content from assistive technology", async () => {
    // Blur is decoration; this is the part a screen reader actually honours.
    await renderProfile();
    expect(content().getAttribute("aria-hidden")).toBe("true");
  });

  it("shows the overlay, sharp, with the explanation", async () => {
    await renderProfile();
    const gateEl = screen.getByTestId("subscription-gate");
    expect(gateEl.className).not.toContain("blur-");
    expect(gateEl.textContent).toMatch(/indisponibil/i);
    expect(gateEl.textContent).toMatch(/statistici, analize/i);
    // Never framed as a payment failure.
    expect(gateEl.textContent).not.toMatch(/eroare|stripe|expirat/i);
  });
});

describe("blocked actions", () => {
  it("disables subscribe and manage-billing, so Tab skips them", async () => {
    await renderProfile();
    const blocked = Array.from(content().querySelectorAll("button"));
    expect(blocked.length).toBeGreaterThanOrEqual(3);
    for (const b of blocked) {
      expect(b.hasAttribute("disabled"), `${b.textContent} is still focusable`).toBe(true);
    }
  });

  it("never reaches Stripe even if a blocked control is clicked", async () => {
    await renderProfile();
    for (const b of Array.from(content().querySelectorAll("button"))) fireEvent.click(b);
    expect(startCheckout).not.toHaveBeenCalled();
    expect(openBillingPortal).not.toHaveBeenCalled();
  });
});

describe("the support CTA", () => {
  it("is a real, enabled, keyboard-reachable button", async () => {
    await renderProfile();
    const cta = screen.getByRole("button", { name: /contacteaz/i });
    expect(cta.tagName).toBe("BUTTON");
    expect(cta.hasAttribute("disabled")).toBe(false);
    expect(cta.tabIndex).toBe(0);
    cta.focus();
    expect(document.activeElement).toBe(cta);
  });

  it("has no disabled ancestor, so nothing announces it as unavailable", async () => {
    // The precise shape of the shipped defect: the button was fine, an
    // ancestor was not. Walking up is the only way to catch that — asserting
    // the element in isolation passed the whole time it was broken.
    await renderProfile();
    const cta = screen.getByRole("button", { name: /contacteaz/i });
    expect(cta.closest("[aria-disabled='true']")).toBeNull();
    expect(cta.closest("[disabled]")).toBeNull();
    expect(cta.closest("[aria-hidden='true']")).toBeNull();
  });

  it("lives OUTSIDE the aria-hidden region, or it would be unreachable", async () => {
    await renderProfile();
    const cta = screen.getByRole("button", { name: /contacteaz/i });
    expect(content().contains(cta)).toBe(false);
  });

  it("opens the existing support dialog rather than navigating away", async () => {
    const handleNav = vi.fn();
    await renderProfile({ handleNav });
    fireEvent.click(screen.getByRole("button", { name: /contacteaz/i }));
    // The same SupportEntry dialog both authenticated trees mount.
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(handleNav).not.toHaveBeenCalled();
  });
});

describe("nothing else is affected", () => {
  it("still shows the user's real tier — the gate is not entitlement", async () => {
    for (const tier of ["free", "premium", "ultra"]) {
      cleanup();
      await renderProfile({ userTier: tier });
      expect(screen.getAllByText(new RegExp(`^${tier}$`, "i")).length).toBeGreaterThan(0);
    }
  });

  it("leaves the referral card mounted and usable", async () => {
    await renderProfile();
    expect(screen.getByTestId("account-referral")).toBeTruthy();
  });

  it("gates only the subscription section, nothing else on the page", async () => {
    await renderProfile();
    expect(screen.queryAllByTestId("subscription-gate")).toHaveLength(1);
  });
});

describe("turning the gate off", () => {
  it("restores the original subscription card exactly", async () => {
    gate.disabled = false;
    await renderProfile();
    expect(screen.queryByTestId("subscription-gate")).toBeNull();
    expect(content().className ?? "").not.toContain("blur-");
    expect(content().getAttribute("aria-hidden")).toBeNull();
    // Purchase controls work again.
    const buttons = Array.from(content().querySelectorAll("button"));
    expect(buttons.some((b) => !b.hasAttribute("disabled"))).toBe(true);
  });
});

describe("localisation", () => {
  it("renders the English wording when the catalogue is English", async () => {
    await ensureCatalog("en");
    window.localStorage.setItem("footy:locale", "en");
    await renderProfile();
    const gateEl = screen.getByTestId("subscription-gate");
    expect(gateEl.textContent).toMatch(/temporarily unavailable/i);
    expect(gateEl.textContent).toMatch(/contact the administrator/i);
    // A missing key would render its dotted path.
    expect(gateEl.textContent).not.toContain("account.subscriptionUnavailable");
  });
});
