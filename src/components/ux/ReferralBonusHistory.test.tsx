import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import { ensureCatalog } from "../../i18n";
import ReferralBonusHistory from "./ReferralBonusHistory";
import type { ReferralBonus } from "../../services/referralNotificationService";

/**
 * The durable half of a referral reward.
 *
 * The header cards say it in three words for five seconds; this keeps the whole
 * sentence afterwards. The assertion that matters most is a NEGATIVE one: the
 * history is read-only, and opening it must never acknowledge a notice the user
 * has not actually seen.
 */

const fetchReferralBonusHistory = vi.fn();
const acknowledgeReferralBonuses = vi.fn();

vi.mock("../../services/referralNotificationService", () => ({
  fetchReferralBonusHistory: (...a: unknown[]) => fetchReferralBonusHistory(...a),
  acknowledgeReferralBonuses: (...a: unknown[]) => acknowledgeReferralBonuses(...a)
}));

const INVITEE_UUID = "22222222-2222-2222-2222-222222222222";

const bonus = (over: Partial<ReferralBonus> = {}): ReferralBonus => ({
  grantId: "g-1",
  role: "inviter",
  days: 5,
  inviteeName: "Andrei Popescu",
  grantedAt: "2026-08-27T10:00:00Z",
  ...over
});

function renderHistory() {
  return render(
    <LocaleProvider>
      <ReferralBonusHistory />
    </LocaleProvider>
  );
}

beforeEach(() => {
  fetchReferralBonusHistory.mockReset().mockResolvedValue([]);
  acknowledgeReferralBonuses.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("empty and loading", () => {
  it("renders nothing at all while loading", () => {
    // Most users have no bonuses; an empty card would be noise on every visit.
    fetchReferralBonusHistory.mockReturnValue(new Promise(() => {}));
    renderHistory();
    expect(screen.queryByTestId("referral-bonus-history")).toBeNull();
  });

  it("renders nothing when the history is empty", async () => {
    renderHistory();
    await waitFor(() => expect(fetchReferralBonusHistory).toHaveBeenCalled());
    expect(screen.queryByTestId("referral-bonus-history")).toBeNull();
  });

  it("survives an API failure without breaking the notifications screen", async () => {
    // The service resolves to [] on failure; this proves the component agrees.
    fetchReferralBonusHistory.mockResolvedValue([]);
    expect(() => renderHistory()).not.toThrow();
    await waitFor(() => expect(fetchReferralBonusHistory).toHaveBeenCalled());
    expect(screen.queryByTestId("referral-bonus-history")).toBeNull();
  });
});

describe("rendered rewards", () => {
  it("shows the FULL inviter sentence, not the header's short form", async () => {
    fetchReferralBonusHistory.mockResolvedValue([bonus()]);
    renderHistory();
    const text = (await screen.findByTestId("referral-bonus-history")).textContent ?? "";
    expect(text).toContain("Andrei Popescu");
    expect(text).toMatch(/recomandarea ta/i);
    expect(text).toContain("5");
  });

  it("shows the invitee sentence and names nobody", async () => {
    fetchReferralBonusHistory.mockResolvedValue([bonus({ role: "invitee", inviteeName: null })]);
    renderHistory();
    const text = (await screen.findByTestId("referral-bonus-history")).textContent ?? "";
    expect(text).toMatch(/invita/i);
    expect(text).not.toContain("Andrei");
  });

  it("falls back to the anonymous wording when no name was set", async () => {
    fetchReferralBonusHistory.mockResolvedValue([bonus({ inviteeName: null })]);
    renderHistory();
    const text = (await screen.findByTestId("referral-bonus-history")).textContent ?? "";
    expect(text).toMatch(/cineva/i);
    expect(text).not.toMatch(/undefined|null/i);
  });

  it("lists every reward, each with its own name", async () => {
    fetchReferralBonusHistory.mockResolvedValue([
      bonus({ grantId: "a", inviteeName: "Andrei" }),
      bonus({ grantId: "b", inviteeName: "Maria" }),
      bonus({ grantId: "c", role: "invitee", inviteeName: null })
    ]);
    renderHistory();
    const el = await screen.findByTestId("referral-bonus-history");
    expect(el.querySelectorAll("li")).toHaveLength(3);
    expect(el.textContent).toContain("Andrei");
    expect(el.textContent).toContain("Maria");
  });

  it("renders the reward amount from the grant, not a hard-coded five", async () => {
    fetchReferralBonusHistory.mockResolvedValue([bonus({ days: 10 })]);
    renderHistory();
    expect((await screen.findByTestId("referral-bonus-history")).textContent).toContain("10");
  });

  it("formats the date, and omits it safely when absent", async () => {
    fetchReferralBonusHistory.mockResolvedValue([bonus({ grantedAt: "2026-08-27T10:00:00Z" })]);
    renderHistory();
    const text = (await screen.findByTestId("referral-bonus-history")).textContent ?? "";
    expect(text).toMatch(/2026/);
    expect(text).not.toMatch(/invalid date|nan/i);

    cleanup();
    fetchReferralBonusHistory.mockResolvedValue([bonus({ grantId: "z", grantedAt: null })]);
    renderHistory();
    const second = (await screen.findByTestId("referral-bonus-history")).textContent ?? "";
    expect(second).not.toMatch(/invalid date|nan/i);
  });
});

describe("privacy", () => {
  it("never renders an email or a uuid", async () => {
    fetchReferralBonusHistory.mockResolvedValue([bonus(), bonus({ grantId: "b", role: "invitee", inviteeName: null })]);
    renderHistory();
    const text = (await screen.findByTestId("referral-bonus-history")).textContent ?? "";
    expect(text).not.toContain("@");
    expect(text).not.toContain(INVITEE_UUID);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
  });

  it("tells an invitee nothing about who invited them", async () => {
    // Defence in depth: the server strips this, and the view must not restore it.
    fetchReferralBonusHistory.mockResolvedValue([bonus({ role: "invitee", inviteeName: "Leaked Person" })]);
    renderHistory();
    const text = (await screen.findByTestId("referral-bonus-history")).textContent ?? "";
    expect(text).not.toContain("Leaked Person");
  });
});

describe("read-only", () => {
  it("does NOT acknowledge anything merely because the history was opened", async () => {
    // The whole point of a separate history: reading it must not consume a notice
    // the user has never actually been shown in the header.
    fetchReferralBonusHistory.mockResolvedValue([bonus(), bonus({ grantId: "b" })]);
    renderHistory();
    await screen.findByTestId("referral-bonus-history");
    expect(acknowledgeReferralBonuses).not.toHaveBeenCalled();
  });

  it("reads once per mount, not on every render", async () => {
    fetchReferralBonusHistory.mockResolvedValue([bonus()]);
    const { rerender } = renderHistory();
    await screen.findByTestId("referral-bonus-history");
    rerender(
      <LocaleProvider>
        <ReferralBonusHistory />
      </LocaleProvider>
    );
    expect(fetchReferralBonusHistory).toHaveBeenCalledTimes(1);
  });
});

describe("localisation", () => {
  it("renders the English wording when the catalogue is English", async () => {
    await ensureCatalog("en");
    window.localStorage.setItem("footy:locale", "en");
    fetchReferralBonusHistory.mockResolvedValue([bonus()]);
    renderHistory();
    const text = (await screen.findByTestId("referral-bonus-history")).textContent ?? "";
    expect(text).toMatch(/joined through your referral/i);
    expect(text).toMatch(/Ultra days/i);
    // A missing key renders as its dotted path.
    expect(text).not.toContain("account.referral");
  });
});

describe("accessibility", () => {
  it("uses a heading and a real list, readable without colour", async () => {
    fetchReferralBonusHistory.mockResolvedValue([bonus()]);
    renderHistory();
    const el = await screen.findByTestId("referral-bonus-history");
    expect(el.querySelector("h2")).toBeTruthy();
    expect(el.querySelector("ul")).toBeTruthy();
    // The reward is stated in words, not conveyed by the badge colour alone.
    expect(el.querySelector("li")?.textContent).toMatch(/ultra/i);
  });

  it("does not steal focus when it appears", async () => {
    fetchReferralBonusHistory.mockResolvedValue([bonus()]);
    renderHistory();
    await screen.findByTestId("referral-bonus-history");
    expect(document.activeElement).toBe(document.body);
  });
});
