import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureCatalog } from "../../i18n";
import { ReferralError } from "../../services/referralService";
import { REFERRAL_STORAGE_KEY, REFERRAL_TTL_MS } from "../../utils/referralLink";
import ReferralCard from "./ReferralCard";

/**
 * The user-facing referral card.
 *
 * NO NETWORK. The service module is stubbed, so nothing here can create a referral,
 * a claim or a reward — what is under test is what the component DOES with a server
 * answer, never the answer itself.
 *
 * The assertions that matter most: the card never claims on its own, it never
 * computes a referral number locally, and it issues exactly one status request per
 * mount.
 */

const fetchReferralStatus = vi.fn();
const fetchOrCreateReferralCode = vi.fn();
const claimReferral = vi.fn();

vi.mock("../../services/referralService", async () => {
  const actual = await vi.importActual<typeof import("../../services/referralService")>(
    "../../services/referralService"
  );
  return {
    ...actual,
    fetchReferralStatus: (...args: unknown[]) => fetchReferralStatus(...args),
    fetchOrCreateReferralCode: (...args: unknown[]) => fetchOrCreateReferralCode(...args),
    claimReferral: (...args: unknown[]) => claimReferral(...args)
  };
});

const CODE = "ABCD234567";
const USER = "user-1";
const NOW = Date.parse("2026-08-27T12:00:00.000Z");

const status = (over: Record<string, unknown> = {}) => ({
  hasReferralCode: true,
  code: CODE,
  inviter: { attributed: 0, qualified: 0, rewarded: 0, successful: 0, earnedDays: 0, capRemaining: 10, cap: 10 },
  invitee: null,
  ...over
});

function storePending(code = CODE, capturedAt = NOW) {
  window.localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify({ code, capturedAt }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem("footy:locale", "ro");
  fetchReferralStatus.mockResolvedValue(status());
  fetchOrCreateReferralCode.mockResolvedValue(CODE);
  claimReferral.mockResolvedValue({ state: "attributed", expiresAt: null });
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  cleanup();
  // navigator.share is removed so the clipboard-fallback cases are not polluted by
  // a leftover stub from the native-share case.
  delete (navigator as { share?: unknown }).share;
});

const renderCard = (props: Partial<{ userId: string | null; now: number }> = {}) =>
  render(<ReferralCard userId={props.userId === undefined ? USER : props.userId} now={props.now ?? NOW} />);

/* -------------------------------------------------------------- rendering */

describe("rendering", () => {
  it("renders nothing at all when signed out", () => {
    const { container } = renderCard({ userId: null });
    expect(container.innerHTML).toBe("");
    expect(fetchReferralStatus).not.toHaveBeenCalled();
  });

  it("shows a loading state before the status resolves, not an empty one", async () => {
    let resolve: (v: unknown) => void = () => {};
    fetchReferralStatus.mockReturnValue(new Promise((r) => (resolve = r)));
    renderCard();
    // "no referrals" must never flash before the answer arrives.
    expect(screen.getByLabelText(/se încarcă/i).getAttribute("aria-busy")).toBe("true");
    resolve(status());
    await waitFor(() => expect(screen.getByTestId("referral-code")).toBeTruthy());
  });

  it("displays the code and a link built from the runtime origin", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByTestId("referral-code").textContent).toContain(CODE));
    expect(screen.getByTestId("referral-link").textContent).toContain(`${window.location.origin}/?ref=${CODE}`);
  });

  it("mints a code only when the status has none", async () => {
    fetchReferralStatus.mockResolvedValue(status({ code: null, hasReferralCode: false }));
    renderCard();
    await waitFor(() => expect(fetchOrCreateReferralCode).toHaveBeenCalledTimes(1));

    cleanup();
    vi.clearAllMocks();
    fetchReferralStatus.mockResolvedValue(status());
    renderCard();
    await waitFor(() => expect(screen.getByTestId("referral-code")).toBeTruthy());
    expect(fetchOrCreateReferralCode).not.toHaveBeenCalled();
  });

  it("keeps the code and link breakable so a 390px card cannot overflow", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByTestId("referral-code")).toBeTruthy());
    expect(screen.getByTestId("referral-code").className).toContain("break-all");
    expect(screen.getByTestId("referral-link").className).toContain("break-all");
  });
});

/* -------------------------------------------------------- inviter metrics */

describe("inviter metrics", () => {
  it("renders the SERVER's successful count, never one derived from state", async () => {
    // The capped case: eleven rewarded referrals, ten of which paid the inviter.
    fetchReferralStatus.mockResolvedValue(
      status({
        inviter: { attributed: 0, qualified: 0, rewarded: 10, successful: 10, earnedDays: 50, capRemaining: 0, cap: 10 }
      })
    );
    renderCard();
    const metrics = await screen.findByTestId("referral-metrics");
    expect(metrics.textContent).toContain("10");
    expect(metrics.textContent).toContain("50");
    // 11 / 55 is what a client-side count of `state='rewarded'` would produce.
    expect(metrics.textContent).not.toContain("11");
    expect(metrics.textContent).not.toContain("55");
  });

  it("shows earned days and cap remaining from the server", async () => {
    fetchReferralStatus.mockResolvedValue(
      status({
        inviter: { attributed: 0, qualified: 0, rewarded: 3, successful: 3, earnedDays: 15, capRemaining: 7, cap: 10 }
      })
    );
    renderCard();
    const metrics = await screen.findByTestId("referral-metrics");
    expect(metrics.textContent).toContain("15");
    expect(metrics.textContent).toContain("7");
  });

  it("announces the cap WITHOUT implying the invitee loses out", async () => {
    fetchReferralStatus.mockResolvedValue(
      status({
        inviter: { attributed: 0, qualified: 0, rewarded: 10, successful: 10, earnedDays: 50, capRemaining: 0, cap: 10 }
      })
    );
    renderCard();
    expect(await screen.findByText(/limita de recompense a fost atinsă/i)).toBeTruthy();
    // The cap limits the inviter's earning, never the friend's reward.
    expect(screen.getByText(/prietenii tăi primesc în continuare/i)).toBeTruthy();
  });

  it("summarises pending referrals as a count only", async () => {
    fetchReferralStatus.mockResolvedValue(
      status({
        inviter: { attributed: 2, qualified: 1, rewarded: 0, successful: 0, earnedDays: 0, capRemaining: 10, cap: 10 }
      })
    );
    renderCard();
    expect(await screen.findByText(/3 în așteptare/i)).toBeTruthy();
  });
});

/* ----------------------------------------------------------- copy / share */

describe("copy and share", () => {
  it("copies the link and announces it politely", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /copiază linkul/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/?ref=${CODE}`);
    await waitFor(() => expect(screen.getByText(/link copiat/i)).toBeTruthy());
  });

  it("reports a copy failure instead of claiming success", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /copiază linkul/i }));
    await waitFor(() => expect(screen.getByText(/nu am putut copia/i)).toBeTruthy());
  });

  it("uses native share when the browser offers it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /trimite invitația/i }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].url).toContain(`?ref=${CODE}`);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when native share is absent", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /trimite invitația/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it("falls back to the clipboard when the user cancels a native share", async () => {
    Object.assign(navigator, { share: vi.fn().mockRejectedValue(new Error("AbortError")) });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /trimite invitația/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
  });
});

/* ------------------------------------------------------------- the claim */

describe("claiming an invitation", () => {
  it("NEVER claims automatically — the prompt waits for the user", async () => {
    storePending();
    renderCard();
    expect(await screen.findByTestId("referral-invite-prompt")).toBeTruthy();
    // The single most important assertion in this file.
    expect(claimReferral).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).not.toBeNull();
  });

  it("says plainly that only one invitation can ever be used", async () => {
    storePending();
    renderCard();
    expect(await screen.findByText(/poți folosi o singură invitație/i)).toBeTruthy();
  });

  it("claims with ONLY the code when the user accepts, then refreshes once", async () => {
    storePending();
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /acceptă invitația/i }));

    await waitFor(() => expect(claimReferral).toHaveBeenCalledWith(CODE));
    expect(claimReferral.mock.calls[0]).toHaveLength(1);
    // One refresh after a successful claim — not a poll.
    await waitFor(() => expect(fetchReferralStatus).toHaveBeenCalledTimes(2));
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });

  it("keeps the invitation when the claim fails on the network", async () => {
    storePending();
    claimReferral.mockRejectedValue(new ReferralError(500, ""));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /acceptă invitația/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // A transient failure must not silently consume the user's one invitation.
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).not.toBeNull();
  });

  it.each([
    [404, /codul de invitație nu este valid/i],
    [409, /ai folosit deja o invitație/i],
    [410, /invitația a expirat/i]
  ])("maps a %i refusal to a safe message and drops the dead code", async (statusCode, pattern) => {
    storePending();
    claimReferral.mockRejectedValue(new ReferralError(statusCode as number, "reason_code"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /acceptă invitația/i }));

    await waitFor(() => expect(screen.getByText(pattern as RegExp)).toBeTruthy());
    // Terminal for this code — re-offering it would be a loop the user cannot exit.
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
    // No raw server reason leaks into the UI.
    expect(screen.queryByText(/reason_code/)).toBeNull();
  });

  it("maps rate limiting to a wait-and-retry message", async () => {
    storePending();
    claimReferral.mockRejectedValue(new ReferralError(429, ""));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /acceptă invitația/i }));
    expect(await screen.findByText(/prea multe încercări/i)).toBeTruthy();
  });

  it("lets the user decline, and keeps the invitation for later", async () => {
    storePending();
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /nu acum/i }));

    await waitFor(() => expect(screen.queryByTestId("referral-invite-prompt")).toBeNull());
    expect(claimReferral).not.toHaveBeenCalled();
    // Declining is "not now", not "never".
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).not.toBeNull();
  });

  it("offers no prompt for an EXPIRED stored invitation", async () => {
    storePending(CODE, NOW - REFERRAL_TTL_MS - 1);
    renderCard();
    await waitFor(() => expect(screen.getByTestId("referral-code")).toBeTruthy());
    expect(screen.queryByTestId("referral-invite-prompt")).toBeNull();
  });

  it("offers no prompt for a malformed stored invitation", async () => {
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, "{{{not json");
    renderCard();
    await waitFor(() => expect(screen.getByTestId("referral-code")).toBeTruthy());
    expect(screen.queryByTestId("referral-invite-prompt")).toBeNull();
  });

  it("offers no prompt to someone who is already attributed", async () => {
    storePending();
    fetchReferralStatus.mockResolvedValue(
      status({
        invitee: {
          state: "attributed",
          attributedAt: null,
          expiresAt: null,
          qualifiedAt: null,
          rewardedAt: null,
          expired: false
        }
      })
    );
    renderCard();
    await waitFor(() => expect(screen.getByTestId("referral-invitee-state")).toBeTruthy());
    expect(screen.queryByTestId("referral-invite-prompt")).toBeNull();
  });
});

/* ---------------------------------------------------------- invitee state */

describe("invitee state", () => {
  const invitee = (over: Record<string, unknown>) => ({
    state: "attributed",
    attributedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-08-31T00:00:00.000Z",
    qualifiedAt: null,
    rewardedAt: null,
    expired: false,
    ...over
  });

  it.each([
    ["attributed", {}, /invitat de un prieten/i],
    ["qualified", { state: "qualified" }, /recompensă câștigată/i],
    ["rewarded", { state: "rewarded" }, /5 zile ultra active/i],
    ["expired", { state: "expired", expired: true }, /invitația a expirat/i]
  ])("renders the %s state", async (_label, over, pattern) => {
    fetchReferralStatus.mockResolvedValue(status({ invitee: invitee(over as Record<string, unknown>) }));
    renderCard();
    expect(await screen.findByText(pattern as RegExp)).toBeTruthy();
  });

  it("shows the expiry date for an open attribution", async () => {
    fetchReferralStatus.mockResolvedValue(status({ invitee: invitee({}) }));
    renderCard();
    expect(await screen.findByText(/expiră/i)).toBeTruthy();
  });

  it("never names the inviter", async () => {
    fetchReferralStatus.mockResolvedValue(status({ invitee: invitee({}) }));
    const { container } = renderCard();
    await waitFor(() => expect(screen.getByTestId("referral-invitee-state")).toBeTruthy());
    const html = container.innerHTML;
    for (const forbidden of ["inviterId", "inviter_id", "@", "ip_hash", "ipHash"]) {
      expect(html.includes(forbidden), forbidden).toBe(false);
    }
  });
});

/* ------------------------------------------------ request budget & errors */

describe("request budget", () => {
  it("issues exactly ONE status request per mount", async () => {
    const { rerender } = renderCard();
    await waitFor(() => expect(screen.getByTestId("referral-code")).toBeTruthy());
    // Re-render without unmounting: a naive effect would fire again.
    rerender(<ReferralCard userId={USER} now={NOW} />);
    rerender(<ReferralCard userId={USER} now={NOW} />);
    expect(fetchReferralStatus).toHaveBeenCalledTimes(1);
  });

  it("contains no timer of its own — there is no polling", async () => {
    /*
      Spying on window.setInterval cannot work here: @testing-library's own waitFor
      polls with it, so the spy fires for reasons that have nothing to do with the
      component. The rule is about the SOURCE, so assert on the source.
    */
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/components/ux/ReferralCard.tsx", "utf8");
    expect(source).not.toMatch(/setInterval|setTimeout/);
  });
});

describe("error state", () => {
  it("offers a retry when the status cannot be loaded, and does not fake data", async () => {
    fetchReferralStatus.mockRejectedValue(new ReferralError(503, ""));
    renderCard();

    expect(await screen.findByTestId("referral-error")).toBeTruthy();
    expect(screen.getByText(/nu este disponibil/i)).toBeTruthy();
    expect(screen.queryByTestId("referral-metrics")).toBeNull();

    fetchReferralStatus.mockResolvedValue(status());
    fireEvent.click(screen.getByRole("button", { name: /reîncearcă/i }));
    await waitFor(() => expect(screen.getByTestId("referral-code")).toBeTruthy());
  });
});

/* ----------------------------------------------------------------- locale */

describe("localisation", () => {
  it("renders English when the stored locale is en", async () => {
    window.localStorage.setItem("footy:locale", "en");
    // The EN dictionary is loaded lazily; without this the first render still
    // resolves against RO and the assertion would be testing the wrong locale.
    await ensureCatalog("en");
    renderCard();
    expect(await screen.findByText(/invite a friend/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy link/i })).toBeTruthy();
  });

  it("renders no raw translation keys in either locale", async () => {
    for (const locale of ["ro", "en"]) {
      cleanup();
      window.localStorage.setItem("footy:locale", locale);
      await ensureCatalog(locale as "ro" | "en");
      const { container } = renderCard();
      await waitFor(() => expect(screen.getByTestId("referral-code")).toBeTruthy());
      // translate() falls back to the key path, so a missing key shows up verbatim.
      expect(container.innerHTML.includes("account.referral."), locale).toBe(false);
    }
  });
});
