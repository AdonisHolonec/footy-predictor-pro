import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LocaleProvider } from "../../context/LocaleContext";
import ReferralInviteDialog from "../../components/ux/ReferralInviteDialog";
import { ReferralError } from "../../services/referralService";
import { REFERRAL_STORAGE_KEY, REFERRAL_TTL_MS } from "../../utils/referralLink";
import { usePostLoginReferralInvite } from "./usePostLoginReferralInvite";

/**
 * The post-login referral invitation.
 *
 * A referred user's code is captured at boot and, until now, read only by the
 * Account card. This pins the new surface end to end through the REAL hook and
 * the REAL dialog against a mocked referral service: when it asks, when it does
 * not, that accepting is explicit and claims exactly once, that dismissing
 * claims nothing and keeps the code, how failures are shown and which of them
 * drop the code, and that one signed-in mount asks exactly once.
 */

const fetchReferralStatus = vi.fn();
const claimReferral = vi.fn();

vi.mock("../../services/referralService", async () => {
  const actual = await vi.importActual<typeof import("../../services/referralService")>(
    "../../services/referralService"
  );
  return {
    ...actual,
    fetchReferralStatus: (...args: unknown[]) => fetchReferralStatus(...args),
    claimReferral: (...args: unknown[]) => claimReferral(...args)
  };
});

const CODE = "ABCD234567";
const USER = "user-1";
const TOKEN = "token-1";
const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const SRC = join(__dirname, "..", "..");
const src = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const status = (over: Record<string, unknown> = {}) => ({
  hasReferralCode: true,
  code: "INVITER123",
  inviter: { attributed: 0, qualified: 0, rewarded: 0, successful: 0, earnedDays: 0, capRemaining: 10, cap: 10 },
  invitee: null,
  ...over
});

const ATTRIBUTED = {
  state: "attributed",
  attributedAt: null,
  expiresAt: null,
  qualifiedAt: null,
  rewardedAt: null,
  expired: false
};

function storePending(code = CODE, capturedAt = NOW) {
  window.localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify({ code, capturedAt }));
}
const stored = () => window.localStorage.getItem(REFERRAL_STORAGE_KEY);

type HarnessProps = { userId: string | null; accessToken: string | null; onAccepted?: () => void; unrelated?: number };

function Harness({ userId, accessToken, onAccepted, unrelated = 0 }: HarnessProps) {
  const invite = usePostLoginReferralInvite({ userId, accessToken, now: NOW, onAccepted });
  return (
    <>
      <span data-testid="unrelated">{unrelated}</span>
      <ReferralInviteDialog
        open={invite.open}
        claiming={invite.claiming}
        error={invite.error}
        canAccept={invite.pendingCode !== null}
        onAccept={() => void invite.accept()}
        onDecline={invite.dismiss}
      />
    </>
  );
}

function mount(props: Partial<HarnessProps> = {}) {
  const onAccepted = vi.fn();
  const full: HarnessProps = { userId: USER, accessToken: TOKEN, onAccepted, ...props };
  const utils = render(
    <LocaleProvider>
      <Harness {...full} />
    </LocaleProvider>
  );
  const rerender = (next: Partial<HarnessProps> = {}) =>
    utils.rerender(
      <LocaleProvider>
        <Harness {...full} {...next} />
      </LocaleProvider>
    );
  return { onAccepted, rerender, unmount: utils.unmount };
}

const flush = () => act(async () => {});
const dialog = () => screen.queryByRole("dialog");
const accept = () => screen.getByTestId("referral-invite-accept");
const decline = () => screen.getByTestId("referral-invite-decline");

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem("footy:locale", "ro");
  fetchReferralStatus.mockResolvedValue(status());
  claimReferral.mockResolvedValue({ state: "attributed", expiresAt: null });
});

afterEach(cleanup);

describe("when the invitation is offered", () => {
  it("not before authentication — no dialog, no status request", async () => {
    storePending();
    mount({ userId: null, accessToken: null });
    await flush();
    expect(dialog()).toBeNull();
    expect(fetchReferralStatus).not.toHaveBeenCalled();
    expect(claimReferral).not.toHaveBeenCalled();
  });

  it("not with a user but no session token yet", async () => {
    storePending();
    mount({ accessToken: null });
    await flush();
    expect(dialog()).toBeNull();
    expect(fetchReferralStatus).not.toHaveBeenCalled();
  });

  it("signed in, pending code, not attributed → the dialog opens, and nothing is claimed", async () => {
    storePending();
    mount();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /invitat de un prieten/i })).toBeTruthy();
    expect(screen.getByText(/o singură invitație/i)).toBeTruthy();
    expect(fetchReferralStatus).toHaveBeenCalledTimes(1);
    expect(claimReferral).not.toHaveBeenCalled();
    expect(stored()).not.toBeNull();
  });

  it("no pending code → nothing, and not even a status request", async () => {
    mount();
    await flush();
    expect(dialog()).toBeNull();
    expect(fetchReferralStatus).not.toHaveBeenCalled();
  });

  it("an expired stored code → nothing", async () => {
    storePending(CODE, NOW - REFERRAL_TTL_MS - 1);
    mount();
    await flush();
    expect(dialog()).toBeNull();
    expect(fetchReferralStatus).not.toHaveBeenCalled();
  });

  it("already attributed → nothing, and the stored code is left alone", async () => {
    storePending();
    fetchReferralStatus.mockResolvedValue(status({ invitee: ATTRIBUTED }));
    mount();
    await flush();
    await flush();
    expect(dialog()).toBeNull();
    expect(claimReferral).not.toHaveBeenCalled();
    expect(stored()).not.toBeNull();
  });

  it("a status failure asks nothing and keeps the code for the Account card", async () => {
    storePending();
    fetchReferralStatus.mockRejectedValue(new ReferralError(503, ""));
    mount();
    await flush();
    await flush();
    expect(dialog()).toBeNull();
    expect(stored()).not.toBeNull();
  });
});

describe("accepting", () => {
  it("claims ONLY the code, exactly once, shows the busy state, clears the code, closes, and reports success", async () => {
    storePending();
    let resolve!: (v: unknown) => void;
    claimReferral.mockReturnValue(new Promise((res) => (resolve = res)));
    const { onAccepted } = mount();
    await screen.findByRole("dialog");

    fireEvent.click(accept());
    fireEvent.click(accept());
    await flush();
    expect(claimReferral).toHaveBeenCalledTimes(1);
    expect(claimReferral).toHaveBeenCalledWith(CODE);
    expect(claimReferral.mock.calls[0]).toHaveLength(1);
    // Busy: the dialog refuses its close paths while the claim is in flight.
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText(/se acceptă/i)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog()).not.toBeNull();
    expect(stored()).not.toBeNull();

    await act(async () => resolve({ state: "attributed", expiresAt: null }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(stored()).toBeNull();
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });
});

describe("dismissing", () => {
  it.each([
    ["Not now", () => fireEvent.click(decline())],
    ["X", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["backdrop", () => fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement)]
  ])("via %s closes without claiming and keeps the code for later", async (_label, close) => {
    storePending();
    mount();
    await screen.findByRole("dialog");
    close();
    await waitFor(() => expect(dialog()).toBeNull());
    expect(claimReferral).not.toHaveBeenCalled();
    expect(stored()).not.toBeNull();
  });

  it("stays dismissed for this mount through re-renders and unrelated state changes", async () => {
    storePending();
    const { rerender } = mount();
    await screen.findByRole("dialog");
    fireEvent.click(decline());
    await waitFor(() => expect(dialog()).toBeNull());
    rerender({ unrelated: 1 });
    rerender({ unrelated: 2, accessToken: "token-refreshed" });
    await flush();
    expect(dialog()).toBeNull();
    expect(fetchReferralStatus).toHaveBeenCalledTimes(1);
  });

  it("asks again on a fresh mount while the code is still valid", async () => {
    storePending();
    const first = mount();
    await screen.findByRole("dialog");
    fireEvent.click(decline());
    first.unmount();
    mount();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});

describe("claim failures", () => {
  it("a transient failure shows a message, keeps the code and lets the user retry", async () => {
    storePending();
    claimReferral
      .mockRejectedValueOnce(new ReferralError(500, ""))
      .mockResolvedValueOnce({ state: "attributed", expiresAt: null });
    mount();
    await screen.findByRole("dialog");
    fireEvent.click(accept());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(dialog()).not.toBeNull();
    expect(stored()).not.toBeNull();
    fireEvent.click(accept());
    await waitFor(() => expect(claimReferral).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(stored()).toBeNull();
  });

  it("rate limiting reads as wait-and-retry and keeps the code", async () => {
    storePending();
    claimReferral.mockRejectedValue(new ReferralError(429, ""));
    mount();
    await screen.findByRole("dialog");
    fireEvent.click(accept());
    expect(await screen.findByText(/prea multe încercări/i)).toBeTruthy();
    expect(stored()).not.toBeNull();
  });

  it("a configuration outage reads as unavailable, keeps the code, leaks nothing", async () => {
    storePending();
    claimReferral.mockRejectedValue(new ReferralError(503, "ip_hash_unavailable"));
    mount();
    await screen.findByRole("dialog");
    fireEvent.click(accept());
    expect(await screen.findByText(/nu este disponibil/i)).toBeTruthy();
    expect(screen.queryByText(/ip_hash/)).toBeNull();
    expect(stored()).not.toBeNull();
  });

  it.each([
    [404, /codul de invitație nu este valid/i],
    [409, /ai folosit deja o invitație/i],
    [410, /invitația a expirat/i]
  ])("a %i refusal shows the safe message, drops the dead code, and leaves only the way out", async (code, pattern) => {
    storePending();
    claimReferral.mockRejectedValue(new ReferralError(code as number, "reason_code"));
    mount();
    await screen.findByRole("dialog");
    fireEvent.click(accept());
    await waitFor(() => expect(screen.getByText(pattern as RegExp)).toBeTruthy());
    expect(stored()).toBeNull();
    expect(screen.queryByTestId("referral-invite-accept")).toBeNull();
    expect(screen.queryByText(/reason_code/)).toBeNull();
    fireEvent.click(decline());
    await waitFor(() => expect(dialog()).toBeNull());
  });
});

describe("request budget", () => {
  it("one signed-in mount asks once: re-renders, a token refresh and the two-step user publish add nothing", async () => {
    storePending();
    const { rerender } = mount({ accessToken: null });
    await flush();
    expect(fetchReferralStatus).not.toHaveBeenCalled();
    rerender({ accessToken: TOKEN });
    await screen.findByRole("dialog");
    rerender({ accessToken: TOKEN, unrelated: 1 });
    rerender({ accessToken: "token-2", unrelated: 2 });
    await flush();
    expect(fetchReferralStatus).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("the wiring that ships", () => {
  const dashboard = src("pages/UserDashboard.tsx");
  const card = src("components/ux/ReferralCard.tsx");

  it("the dashboard mounts the invitation once, from the signed-in user and session", () => {
    expect((dashboard.match(/<ReferralInviteDialog/g) || []).length).toBe(1);
    expect(dashboard).toMatch(
      /usePostLoginReferralInvite\(\{\s*userId: user\?\.id \?\? null,\s*accessToken: session\?\.access_token \?\? null/
    );
  });

  it("it is not coupled to Predict: the promo trigger and the completion callback do not mention it", () => {
    const runStart = dashboard.indexOf("const predictAction = buildPredictAction({");
    const runEnd = dashboard.indexOf("useEffect(() => {", dashboard.indexOf("async function warmAndPredict()", runStart));
    expect(dashboard.slice(runStart, runEnd)).not.toMatch(/referralInvite|ReferralInvite/);
    const completionStart = dashboard.indexOf("onPredictCompleted: async (deduped, token) => {");
    expect(dashboard.slice(completionStart, dashboard.indexOf("loadHistory();", completionStart))).not.toMatch(
      /referralInvite/
    );
    expect(dashboard).toMatch(/<PredictPromoDialog/);
  });

  it("there is ONE claim state machine: the card runs on the shared hook and no longer calls the service itself", () => {
    expect(card).toMatch(/useReferralClaim\(/);
    expect(card).not.toMatch(/claimReferral\(|clearPendingReferral\(|readPendingReferral\(/);
    expect(src("components/ux/useReferralClaim.ts")).toMatch(/claimReferral\(pendingCode\)/);
  });
});
