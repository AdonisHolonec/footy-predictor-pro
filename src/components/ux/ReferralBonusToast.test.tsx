import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureCatalog } from "../../i18n";
import { LocaleProvider } from "../../context/LocaleContext";
import ReferralBonusToast from "./ReferralBonusToast";
import type { ReferralBonus } from "../../services/referralNotificationService";

/**
 * The transient reward notice.
 *
 * What is worth protecting here is the WORDING and the PRIVACY, not the styling.
 * An inviter must be told who joined; an invitee must never be told who invited
 * them; and no identifier that is not a chosen display name may appear on screen
 * in either direction.
 */

const INVITEE_UUID = "22222222-2222-2222-2222-222222222222";

const bonus = (over: Partial<ReferralBonus> = {}): ReferralBonus => ({
  grantId: "44444444-4444-4444-4444-444444444444",
  role: "inviter",
  days: 5,
  inviteeName: "Andrei Popescu",
  grantedAt: "2026-08-27T10:00:00Z",
  ...over
});

function renderToast(b: ReferralBonus | null, onDismiss = () => {}) {
  return render(
    <LocaleProvider>
      <ReferralBonusToast bonus={b} onDismiss={onDismiss} />
    </LocaleProvider>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("inviter notification", () => {
  it("names the person who joined and states the reward", async () => {
    renderToast(bonus());
    const text = (await screen.findByRole("status")).textContent ?? "";
    expect(text).toContain("Andrei Popescu");
    expect(text).toContain("5");
    expect(text).toMatch(/recomandarea ta/i);
  });

  it("falls back to an anonymous wording when the invitee set no name", async () => {
    renderToast(bonus({ inviteeName: null }));
    const text = (await screen.findByRole("status")).textContent ?? "";
    // Never "undefined", never "null", never a uuid standing in for a person.
    expect(text).not.toMatch(/undefined|null/i);
    expect(text).toMatch(/cineva/i);
    expect(text).toContain("5");
  });

  it("renders a markup-shaped name as TEXT, never as markup", async () => {
    renderToast(bonus({ inviteeName: "<img src=x onerror=alert(1)>" }));
    const status = await screen.findByRole("status");
    // The characters are shown; no element was created from them.
    expect(status.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(status.querySelector("img")).toBeNull();
  });

  it("renders a long name without dropping the reward information", async () => {
    renderToast(bonus({ inviteeName: "A".repeat(40) }));
    const text = (await screen.findByRole("status")).textContent ?? "";
    expect(text).toContain("A".repeat(40));
    expect(text).toContain("5");
  });
});

describe("invitee notification", () => {
  it("states the reward and reveals NOTHING about the inviter", async () => {
    renderToast(bonus({ role: "invitee", inviteeName: null }));
    const text = (await screen.findByRole("status")).textContent ?? "";
    expect(text).toContain("5");
    expect(text).toMatch(/invita/i);
    // No name, no uuid, no email — an invitee is never told who invited them.
    expect(text).not.toContain("Andrei");
    expect(text).not.toContain(INVITEE_UUID);
    expect(text).not.toContain("@");
  });

  it("ignores an inviteeName even if one somehow reaches an invitee bonus", async () => {
    // Defence in depth: the service already strips this, and the component must
    // not become the thing that reintroduces it.
    renderToast(bonus({ role: "invitee", inviteeName: "Leaked Person" }));
    const text = (await screen.findByRole("status")).textContent ?? "";
    expect(text).not.toContain("Leaked Person");
  });
});

describe("presentation contract", () => {
  it("renders nothing at all when there is no bonus", () => {
    renderToast(null);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces politely without stealing focus", async () => {
    renderToast(bonus());
    const status = await screen.findByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    // A reward is information, not an interruption: focus stays where it was.
    expect(document.activeElement).toBe(document.body);
  });

  it("dismisses itself after five seconds", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <LocaleProvider>
        <ReferralBonusToast bonus={bonus()} onDismiss={onDismiss} />
      </LocaleProvider>
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(onDismiss, "dismissed early").not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onDismiss, "did not dismiss at 5s").toHaveBeenCalledTimes(1);
  });

  it("clears its timer on unmount rather than firing into a dead component", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { unmount } = render(
      <LocaleProvider>
        <ReferralBonusToast bonus={bonus()} onDismiss={onDismiss} />
      </LocaleProvider>
    );
    unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("localisation", () => {
  it("renders the English wording when the catalogue is English", async () => {
    await ensureCatalog("en");
    window.localStorage.setItem("footy:locale", "en");
    renderToast(bonus());
    const text = (await screen.findByRole("status")).textContent ?? "";
    expect(text).toContain("Andrei Popescu");
    expect(text).toMatch(/joined through your referral/i);
    expect(text).toMatch(/Ultra days/i);
    // A missing key renders as the dotted path; this is what catches that.
    expect(text).not.toContain("account.referral");
  });
});
