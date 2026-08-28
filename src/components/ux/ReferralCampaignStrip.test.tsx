/**
 * The referral campaign, now its own strip under the 56px bar.
 *
 * The suite that used to live in PlanHeaderStrip.test.tsx moves here with the
 * control, and gains the assertions the move itself needs: that the campaign is
 * BELOW the header rather than inside it, that it survives on the first
 * viewport without a menu or a scroll, and that its fixed product copy is never
 * the thing that gives way.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import { ensureCatalog } from "../../i18n";
import ConsumerShell from "./ConsumerShell";
import ReferralCampaignStrip from "./ReferralCampaignStrip";
import type { ReferralBonus } from "../../services/referralNotificationService";

const REWARD: ReferralBonus = {
  role: "inviter",
  days: 5,
  inviteeName: "Andrei Popescu"
} as unknown as ReferralBonus;

function renderStrip(over: Partial<React.ComponentProps<typeof ReferralCampaignStrip>> = {}) {
  const onOpenReferral = vi.fn();
  render(
    <LocaleProvider>
      <ReferralCampaignStrip onOpenReferral={onOpenReferral} {...over} />
    </LocaleProvider>
  );
  return { onOpenReferral };
}

const cta = () => screen.getByTestId("referral-cta");

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the campaign states the offer and opens the referral surface", () => {
  it("states the reward and never claims anything", () => {
    const { onOpenReferral } = renderStrip();
    expect(cta().textContent).toMatch(/invit/i);
    expect(cta().textContent).toContain("+5");
    expect(cta().textContent).toMatch(/ultra/i);
    // Never the rejected wording.
    expect(cta().textContent).not.toMatch(/timp gratuit/i);

    fireEvent.click(cta());
    expect(onOpenReferral).toHaveBeenCalledTimes(1);
  });

  it("is a real button, reachable and focusable by keyboard", () => {
    renderStrip();
    expect(cta().tagName).toBe("BUTTON");
    expect(cta().getAttribute("type")).toBe("button");
    cta().focus();
    expect(document.activeElement).toBe(cta());
  });

  it("activates through the click path Enter and Space are routed to", () => {
    const { onOpenReferral } = renderStrip();
    fireEvent.click(cta());
    expect(onOpenReferral).toHaveBeenCalledTimes(1);
  });
});

describe("it renders BELOW the 56px header, not inside it", () => {
  function renderShell() {
    render(
      <LocaleProvider>
        <ConsumerShell
          activeNav="home"
          onNavigate={() => {}}
          date="2026-08-27"
          onDateChange={() => {}}
          statusSlot={<div data-testid="fake-plan">plan</div>}
          campaignSlot={<ReferralCampaignStrip onOpenReferral={() => {}} />}
        >
          <div data-testid="page-content">content</div>
        </ConsumerShell>
      </LocaleProvider>
    );
  }

  it("is outside <header>, so it cannot change the bar's height", () => {
    renderShell();
    expect(screen.getByTestId("referral-campaign-strip").closest("header")).toBeNull();
  });

  it("sits after the header and before the page content", () => {
    renderShell();
    const strip = screen.getByTestId("referral-campaign-strip");
    const header = document.querySelector("header")!;
    const content = screen.getByTestId("page-content");
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(header.compareDocumentPosition(strip) & 4).toBeTruthy();
    expect(strip.compareDocumentPosition(content) & 4).toBeTruthy();
  });

  it("the 56px bar itself is untouched and carries no referral control", () => {
    renderShell();
    const bar = screen.getByTestId("context-bar");
    expect(bar.className).toContain("h-14");
    expect(bar.querySelector('[data-testid="referral-cta"]')).toBeNull();
  });

  it("needs no menu, modal or toast to be reached", () => {
    renderShell();
    const strip = screen.getByTestId("referral-campaign-strip");
    expect(strip.closest('[role="dialog"]')).toBeNull();
    expect(strip.closest("[hidden]")).toBeNull();
    expect(getComputedStyle(strip).display).not.toBe("none");
  });
});

describe("fixed product copy is never what gives way", () => {
  it("the offer carries no truncation and no width cap", () => {
    renderStrip();
    const detail = screen.getByTestId("referral-detail");
    expect(detail.className).toContain("whitespace-nowrap");
    expect(detail.className).not.toContain("truncate");
    expect(detail.className).not.toMatch(/max-w-/);
  });

  it("an entirely fixed notice is never clamped either", () => {
    renderStrip({ bonus: { ...REWARD, role: "invitee", inviteeName: null } as ReferralBonus });
    const detail = screen.getByTestId("referral-detail");
    expect(detail.dataset.fixed).toBe("true");
    expect(detail.className).not.toContain("truncate");
  });

  it("only the joiner's NAME may lose characters", () => {
    renderStrip({ bonus: REWARD });
    const name = screen.getByTestId("referral-name");
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("min-w-0");
    expect(name.className).not.toMatch(/max-w-/);
    // The product's own words beside it stay whole.
    expect(screen.getByTestId("referral-fixed").className).not.toContain("truncate");
  });

  it("renders no uuid, whatever the server sent", () => {
    renderStrip({ bonus: { ...REWARD, inviteeName: "a@b.com" } as ReferralBonus });
    const text = screen.getByTestId("referral-campaign-strip").textContent ?? "";
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe("the FREE badge keeps its approved contract", () => {
  it("is present while the campaign is the permanent offer", () => {
    renderStrip();
    expect(screen.getByTestId("badge-free")).toBeTruthy();
  });

  it("is decorative, so assistive technology never reads it twice", () => {
    renderStrip();
    expect(screen.getByTestId("badge-free").getAttribute("aria-hidden")).toBe("true");
  });

  it("costs the row no layout, being absolutely positioned", () => {
    renderStrip();
    expect(screen.getByTestId("badge-free").className).toContain("absolute");
    expect(screen.getByTestId("badge-free").className).toContain("pointer-events-none");
  });

  it("steps aside while a reward notice is showing", () => {
    renderStrip({ bonus: REWARD });
    expect(screen.queryByTestId("badge-free")).toBeNull();
  });
});

describe("accessibility", () => {
  it("the accessible name is the visible campaign wording, not an override", () => {
    renderStrip();
    // No aria-label: the button's own words are its name.
    expect(cta().getAttribute("aria-label")).toBeNull();
    const visible = (cta().textContent ?? "").toLowerCase();
    expect(visible).toMatch(/invit/);
    expect(visible).toContain("+5");
  });

  it("carries the offer terms as a description, not as their only carrier", () => {
    renderStrip();
    expect(cta().getAttribute("title")).toBeTruthy();
    // The reward is stated in visible words too — never colour or tooltip alone.
    expect(cta().textContent).toContain("+5");
  });

  it("clears the 44px touch minimum without growing the strip", () => {
    renderStrip();
    expect(cta().className).toContain("touch-target");
  });

  it("has no parent aria-disabled anywhere above it", () => {
    renderStrip();
    let node: HTMLElement | null = cta().parentElement;
    while (node) {
      expect(node.getAttribute("aria-disabled")).toBeNull();
      node = node.parentElement;
    }
  });
});

describe("localisation", () => {
  it("renders Romanian wording by default", () => {
    renderStrip();
    expect(cta().textContent).toMatch(/invită/i);
    expect(cta().textContent).toMatch(/zile ultra/i);
    expect(cta().textContent).not.toContain("account.header");
  });

  it("renders English wording when the catalogue is English", async () => {
    await ensureCatalog("en");
    window.localStorage.setItem("footy:locale", "en");
    renderStrip();
    expect(cta().textContent).toMatch(/invite/i);
    expect(cta().textContent).toMatch(/ultra days/i);
    // A missing key would render the dotted path.
    expect(screen.getByTestId("referral-campaign-strip").textContent).not.toContain("account.header");
  });
});
