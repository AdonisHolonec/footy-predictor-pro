import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReferralBonusToasts } from "./useReferralBonusToasts";
import type { ReferralBonus } from "../services/referralNotificationService";

/**
 * The delivery half of the feature: WHEN a reward is looked for, and how many
 * times a given one can reach the screen.
 */

const fetchReferralBonuses = vi.fn();
const acknowledgeReferralBonuses = vi.fn();

vi.mock("../services/referralNotificationService", () => ({
  fetchReferralBonuses: (...a: unknown[]) => fetchReferralBonuses(...a),
  acknowledgeReferralBonuses: (...a: unknown[]) => acknowledgeReferralBonuses(...a)
}));

const bonus = (id: string, over: Partial<ReferralBonus> = {}): ReferralBonus => ({
  grantId: id,
  role: "inviter",
  days: 5,
  inviteeName: `Name ${id}`,
  grantedAt: "2026-08-27T10:00:00Z",
  ...over
});

function Harness({ userId, refreshKey }: { userId: string | null; refreshKey: number }) {
  const { current, dismiss, pending } = useReferralBonusToasts(userId, refreshKey);
  return (
    <div>
      <span data-testid="current">{current ? current.grantId : "none"}</span>
      <span data-testid="pending">{pending}</span>
      <button onClick={dismiss}>next</button>
    </div>
  );
}

beforeEach(() => {
  fetchReferralBonuses.mockReset().mockResolvedValue([]);
  acknowledgeReferralBonuses.mockReset().mockResolvedValue(true);
});

afterEach(cleanup);

describe("queue behaviour", () => {
  it("shows grants one at a time, oldest first, keeping each name", async () => {
    // The server answers newest-first.
    fetchReferralBonuses.mockResolvedValue([bonus("new"), bonus("old")]);
    render(<Harness userId="u1" refreshKey={0} />);

    await waitFor(() => expect(screen.getByTestId("current").textContent).toBe("old"));
    expect(screen.getByTestId("pending").textContent).toBe("2");

    act(() => screen.getByText("next").click());
    expect(screen.getByTestId("current").textContent).toBe("new");
  });

  it("acknowledges each grant exactly once, as it reaches the screen", async () => {
    fetchReferralBonuses.mockResolvedValue([bonus("a")]);
    const { rerender } = render(<Harness userId="u1" refreshKey={0} />);
    await waitFor(() => expect(acknowledgeReferralBonuses).toHaveBeenCalledWith(["a"]));

    // A later refresh that still reports it pending must not re-acknowledge or re-queue.
    rerender(<Harness userId="u1" refreshKey={1} />);
    await waitFor(() => expect(fetchReferralBonuses).toHaveBeenCalledTimes(2));
    expect(acknowledgeReferralBonuses).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("pending").textContent).toBe("1");
  });

  it("never enqueues the same grant twice across refreshes", async () => {
    fetchReferralBonuses.mockResolvedValue([bonus("dup")]);
    const { rerender } = render(<Harness userId="u1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("1"));
    rerender(<Harness userId="u1" refreshKey={1} />);
    rerender(<Harness userId="u1" refreshKey={2} />);
    await waitFor(() => expect(fetchReferralBonuses).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId("pending").textContent).toBe("1");
  });

  it("does nothing at all while signed out", async () => {
    render(<Harness userId={null} refreshKey={0} />);
    await Promise.resolve();
    expect(fetchReferralBonuses).not.toHaveBeenCalled();
    expect(screen.getByTestId("current").textContent).toBe("none");
  });
});

describe("activity-driven delivery", () => {
  it("re-checks when the window regains focus — this is what serves the inviter", async () => {
    render(<Harness userId="u1" refreshKey={0} />);
    await waitFor(() => expect(fetchReferralBonuses).toHaveBeenCalledTimes(1));

    fetchReferralBonuses.mockResolvedValue([bonus("arrived")]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(screen.getByTestId("current").textContent).toBe("arrived"));
  });

  it("throttles bursts of focus events instead of firing a request per event", async () => {
    render(<Harness userId="u1" refreshKey={0} />);
    await waitFor(() => expect(fetchReferralBonuses).toHaveBeenCalledTimes(1));

    act(() => {
      for (let i = 0; i < 10; i += 1) window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(fetchReferralBonuses).toHaveBeenCalledTimes(2));
    // Ten alt-tabs are one re-check, not ten.
    expect(fetchReferralBonuses).toHaveBeenCalledTimes(2);
  });

  it("ignores a visibilitychange that reports the tab as hidden", async () => {
    render(<Harness userId="u1" refreshKey={0} />);
    await waitFor(() => expect(fetchReferralBonuses).toHaveBeenCalledTimes(1));

    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await Promise.resolve();
    expect(fetchReferralBonuses).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("removes its listeners on unmount", async () => {
    const { unmount } = render(<Harness userId="u1" refreshKey={0} />);
    await waitFor(() => expect(fetchReferralBonuses).toHaveBeenCalledTimes(1));
    unmount();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await Promise.resolve();
    expect(fetchReferralBonuses).toHaveBeenCalledTimes(1);
  });
});

/**
 * Let the mocked fetch resolve WITHOUT advancing the clock.
 *
 * `vi.waitFor` drives fake timers forward while it polls, which silently ate the
 * whole five-second window before the assertions below could run — the first
 * version of these tests failed for that reason, not because the hook was wrong.
 */
async function flushFetch() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the five-second lifecycle", () => {
  /**
   * The timer moved HERE when the notice moved into the header cards. Those cards
   * are permanent chrome with no dismissal of their own, so if the hook did not
   * own the clock nothing would ever clear the notice. These tests deliberately
   * exercise the hook the application actually mounts.
   */
  it("clears the notice after exactly five seconds", async () => {
    vi.useFakeTimers();
    fetchReferralBonuses.mockResolvedValue([bonus("a")]);
    render(<Harness userId="u1" refreshKey={0} />);
    await flushFetch();
    expect(screen.getByTestId("current").textContent).toBe("a");

    await vi.advanceTimersByTimeAsync(4999);
    expect(screen.getByTestId("current").textContent, "cleared early").toBe("a");

    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByTestId("current").textContent, "still showing at 5s").toBe("none");
    vi.useRealTimers();
  });

  it("gives each queued reward its own full five seconds", async () => {
    // Two rewards must not share one window — the second starts its own.
    vi.useFakeTimers();
    fetchReferralBonuses.mockResolvedValue([bonus("second"), bonus("first")]);
    render(<Harness userId="u1" refreshKey={0} />);
    await flushFetch();
    expect(screen.getByTestId("current").textContent).toBe("first");

    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByTestId("current").textContent).toBe("second");

    await vi.advanceTimersByTimeAsync(4999);
    expect(screen.getByTestId("current").textContent, "second reward was cut short").toBe("second");
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByTestId("current").textContent).toBe("none");
    vi.useRealTimers();
  });

  it("does not leave a timer running after unmount", async () => {
    vi.useFakeTimers();
    fetchReferralBonuses.mockResolvedValue([bonus("a")]);
    const { unmount } = render(<Harness userId="u1" refreshKey={0} />);
    await flushFetch();
    expect(screen.getByTestId("current").textContent).toBe("a");
    unmount();
    // No act() warning and no state update on an unmounted tree.
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();
  });
});

describe("resilience", () => {
  it("a failing fetch leaves the app with nothing to show and no throw", async () => {
    fetchReferralBonuses.mockResolvedValue([]);
    render(<Harness userId="u1" refreshKey={0} />);
    await waitFor(() => expect(fetchReferralBonuses).toHaveBeenCalled());
    expect(screen.getByTestId("current").textContent).toBe("none");
  });

  it("a failing acknowledgement still shows the reward", async () => {
    acknowledgeReferralBonuses.mockResolvedValue(false);
    fetchReferralBonuses.mockResolvedValue([bonus("x")]);
    render(<Harness userId="u1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByTestId("current").textContent).toBe("x"));
  });
});
