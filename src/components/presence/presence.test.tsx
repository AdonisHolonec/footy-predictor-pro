import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * The activity indicator and the admin list.
 *
 * WHAT IS WORTH PINNING HERE. Not that a number renders — that the component
 * SWAPS on `onlineCount > 0`, that it shows nothing rather than a zero before
 * anything is known, and that a normal user's surface has no way to display an
 * identity because the hook it uses has no field to hold one.
 *
 * Dedupe ("three tabs = one user") is asserted server-side in
 * tests/presenceApi.test.js and enforced by the schema: `user_presence` is keyed
 * by user_id, so it is not a client concern and a client test could only fake it.
 */

const sendHeartbeat = vi.fn();
const fetchActivityStats = vi.fn();
const fetchAdminActivity = vi.fn();

vi.mock("../../services/presenceService", () => ({
  sendHeartbeat: (...args: unknown[]) => sendHeartbeat(...args),
  fetchActivityStats: (...args: unknown[]) => fetchActivityStats(...args),
  fetchAdminActivity: (...args: unknown[]) => fetchAdminActivity(...args)
}));

const { default: ActivityIndicator } = await import("./ActivityIndicator");
const { default: AdminOnlineUsers } = await import("./AdminOnlineUsers");
const { default: ConsumerShell } = await import("../ux/ConsumerShell");

beforeEach(() => {
  sendHeartbeat.mockReset();
  fetchActivityStats.mockReset();
  fetchAdminActivity.mockReset();
});

afterEach(() => {
  // This repo unmounts explicitly — there is no global auto-cleanup, so without
  // this every render accumulates and the testid queries find duplicates.
  cleanup();
  vi.useRealTimers();
});

describe("ActivityIndicator", () => {
  it("shows the live count when somebody is online", async () => {
    sendHeartbeat.mockResolvedValue({ onlineCount: 25, accessesToday: 74 });
    render(<ActivityIndicator userId="u-1" variant="toolbar" />);

    const badge = await screen.findByTestId("activity-indicator");
    expect(badge.dataset.state).toBe("online");
    expect(badge.textContent).toContain("25");
    expect(badge.textContent).toContain("online");
    expect(badge.getAttribute("aria-label")).toBe("25 online");
  });

  it("falls back to today's accesses when nobody is online", async () => {
    sendHeartbeat.mockResolvedValue({ onlineCount: 0, accessesToday: 74 });
    render(<ActivityIndicator userId="u-1" variant="toolbar" />);

    const badge = await screen.findByTestId("activity-indicator");
    expect(badge.dataset.state).toBe("accesses");
    expect(badge.textContent).toContain("74");
    // The visible contract is the short form; the sentence is the accessible name.
    expect(badge.textContent).toContain("azi");
    expect(badge.getAttribute("aria-label")).toBe("74 accesări astăzi");
  });

  it("renders nothing until a reading exists, so a zero is never a placeholder", () => {
    // Never resolves: this is the state between mount and the first response.
    sendHeartbeat.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ActivityIndicator userId="u-1" />);
    expect(container.textContent).toBe("");
  });

  it("shows the access count to a signed-out visitor", async () => {
    // Anonymous visitors count toward the day, so the badge is theirs too — and
    // `onlineCount` is 0 for them by construction, since online needs an identity.
    sendHeartbeat.mockResolvedValue({ onlineCount: 0, accessesToday: 74 });
    render(<ActivityIndicator userId={null} variant="toolbar" />);

    const badge = await screen.findByTestId("activity-indicator");
    expect(badge.dataset.state).toBe("accesses");
    expect(badge.textContent).toContain("74");
  });

  it("keeps the last good reading when a refresh fails", async () => {
    sendHeartbeat.mockRejectedValue(new Error("offline"));
    const { container } = render(<ActivityIndicator userId="u-1" />);
    // A failed request must not become "0 online".
    await waitFor(() => expect(sendHeartbeat).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("the mobile variant shows the short form and keeps the full accessible name", async () => {
    sendHeartbeat.mockResolvedValue({ onlineCount: 0, accessesToday: 74 });
    render(<ActivityIndicator userId="u-1" variant="compact" />);

    const badge = await screen.findByTestId("activity-indicator");
    // The 56px app bar already overflows at 390px; the sentence cannot ride there.
    expect(badge.textContent).toContain("74");
    expect(badge.textContent).toContain("azi");
    expect(badge.textContent).not.toContain("accesări astăzi");
    expect(badge.getAttribute("aria-label")).toBe("74 accesări astăzi");
  });

  it("beats even when signed out, so anonymous visitors are counted", async () => {
    sendHeartbeat.mockResolvedValue({ onlineCount: 0, accessesToday: 74 });
    render(<ActivityIndicator userId={null} />);
    await waitFor(() => expect(sendHeartbeat).toHaveBeenCalled());
  });

  it("reserves width in both states so the header does not jump", async () => {
    sendHeartbeat.mockResolvedValue({ onlineCount: 25, accessesToday: 74 });
    const { rerender } = render(<ActivityIndicator userId="u-1" variant="compact" />);
    const live = (await screen.findByTestId("activity-indicator")).className;

    sendHeartbeat.mockResolvedValue({ onlineCount: 0, accessesToday: 74 });
    rerender(<ActivityIndicator userId="u-2" variant="compact" />);
    const idle = (await screen.findByTestId("activity-indicator")).className;

    // Same reserved floor in both states: swapping between "25 online" and
    // "74 azi" must move nothing in the app bar.
    expect(live).toContain("min-w-[5.25rem]");
    expect(idle).toContain("min-w-[5.25rem]");
    // Only the colour may differ between states — never the geometry, which is
    // what would move the logo and the menu around it.
    const geometry = (cls: string) => cls.replace(/text-\[var\(--fp-[a-z-]+\)\]/g, "").trim();
    expect(geometry(live)).toBe(geometry(idle));
  });
});

describe("mobile placement", () => {
  const noop = () => {};
  const mountShell = () =>
    render(
      <ConsumerShell
        activeNav="home"
        onNavigate={noop}
        date="2026-08-25"
        onDateChange={noop}
        activitySlot={<span data-testid="slot-probe">probe</span>}
      >
        <div />
      </ConsumerShell>
    );

  it("the badge is NOT inside the 56px top bar", () => {
    // It started there and did not fit: that row's zones already sum to ~395px
    // of min-content against 366px usable at 390px.
    mountShell();
    const bar = screen.getByTestId("context-bar");
    const probe = screen.getByTestId("slot-probe");
    expect(bar.contains(probe)).toBe(false);
  });

  it("it sits below the header and above the day strip", () => {
    mountShell();
    const probe = screen.getByTestId("slot-probe");
    const header = document.querySelector("header");
    const day = screen.getByTestId("day-selector");

    // `compareDocumentPosition` returns a bitmask; `no-bitwise` is not enabled
    // in this repo, so no disable directive belongs here.
    expect(header!.compareDocumentPosition(probe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(probe.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the row is mobile-only, so desktop keeps its toolbar placement", () => {
    mountShell();
    const row = screen.getByTestId("slot-probe").parentElement;
    expect(row?.className).toContain("lg:hidden");
    // One indicator on screen at a time — the desktop copy is a separate,
    // lg-only element rendered by the dashboard, not a second one here.
    expect(screen.getAllByTestId("slot-probe")).toHaveLength(1);
  });

  it("the logo and the nav controls are untouched by the move", () => {
    mountShell();
    const bar = screen.getByTestId("context-bar");
    // The brand button and the Predict/menu cluster still own the bar.
    expect(bar.textContent).toContain("Footy");
    expect(bar.querySelector("[aria-label]")).toBeTruthy();
  });

  it("renders nothing extra when no slot is supplied", () => {
    render(
      <ConsumerShell activeNav="home" onNavigate={noop} date="2026-08-25" onDateChange={noop}>
        <div />
      </ConsumerShell>
    );
    expect(screen.queryByTestId("slot-probe")).toBeNull();
  });
});

describe("AdminOnlineUsers", () => {
  const PAYLOAD = {
    onlineCount: 2,
    accessesToday: 74,
    users: [
      {
        userId: "u-1",
        displayName: "MariaP",
        name: "MariaP",
        email: "maria@example.com",
        onlineSince: "2026-01-01T11:42:00.000Z"
      },
      {
        // display_name unset: the row must print the email instead of a uuid.
        userId: "u-2",
        displayName: null,
        name: "andrei@example.com",
        email: "andrei@example.com",
        onlineSince: null
      }
    ]
  };

  it("shows both KPIs and the nominal list", async () => {
    fetchAdminActivity.mockResolvedValue(PAYLOAD);
    render(<AdminOnlineUsers enabled />);

    expect((await screen.findByTestId("admin-online-count")).textContent).toBe("2");
    expect(screen.getByTestId("admin-accesses-today").textContent).toBe("74");
    expect(await screen.findByText("MariaP")).toBeTruthy();
    expect(screen.getAllByText("andrei@example.com").length).toBeGreaterThan(0);
  });

  it("renders nothing and requests nothing when disabled", () => {
    render(<AdminOnlineUsers enabled={false} />);
    expect(screen.queryByTestId("admin-online-users")).toBeNull();
    expect(fetchAdminActivity).not.toHaveBeenCalled();
  });

  it("keeps the previous list when a refresh fails rather than emptying it", async () => {
    fetchAdminActivity.mockRejectedValue(new Error("403"));
    render(<AdminOnlineUsers enabled />);

    // A refused or dropped request is not evidence that everybody left, so the
    // panel must not assert "nobody online" on the strength of an error.
    await waitFor(() => expect(fetchAdminActivity).toHaveBeenCalled());
    expect(screen.queryByText("Niciun utilizator online.")).toBeNull();
    expect(screen.getByTestId("admin-online-count").textContent).toBe("—");
  });
});
