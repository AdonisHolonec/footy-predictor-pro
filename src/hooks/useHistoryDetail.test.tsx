import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearHistoryDetailCache, useHistoryDetail } from "./useHistoryDetail";

/**
 * The history LIST ships ~261 KB of `raw_payload` per row purely so the match
 * modal can render without a fetch — the measured cause of /api/history's
 * statement timeouts. This hook is the detail source that lets the list stop.
 *
 * These tests pin the four properties that make it safe to rely on: it asks
 * once per fixture, it never re-asks for a fixture it already holds, a slow
 * answer for a fixture the user has navigated away from cannot overwrite the
 * current one, and a failure surfaces as an error rather than as data.
 */

/** Renders the hook's state so assertions read the real values. */
function Probe({ id }: { id: number | null }) {
  const { detail, loading, error } = useHistoryDetail(id);
  return <span data-testid="state">{loading ? "loading" : error ? `error:${error}` : (detail?.id ?? "none")}</span>;
}

let fetchMock: ReturnType<typeof vi.fn>;

/** A resolved detail response for one fixture. */
function itemResponse(id: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, scope: "fixture_detail", item: { id, teams: { home: "H", away: "A" } } })
  };
}

beforeEach(() => {
  __clearHistoryDetailCache();
  fetchMock = vi.fn(async (url: string) => itemResponse(Number(String(url).split("fixtureId=")[1])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Detail requests only, ignoring anything else the tree might fetch. */
function detailCalls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("fixtureId="));
}

describe("useHistoryDetail", () => {
  it("fetches the detail for a fixture", async () => {
    render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));
    expect(detailCalls()).toEqual(["/api/history?fixtureId=101"]);
  });

  it("does not re-request a fixture it already holds", async () => {
    const { unmount } = render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));
    unmount();

    // Reopening the same match must be free: a settled row cannot change.
    render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));
    expect(detailCalls().length, "the second open re-requested the same fixture").toBe(1);
  });

  it("fetches different fixtures independently", async () => {
    const { unmount } = render(<Probe id={101} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("101"));
    unmount();

    render(<Probe id={202} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("202"));
    expect(detailCalls()).toEqual(["/api/history?fixtureId=101", "/api/history?fixtureId=202"]);
  });

  it("never lets a slow answer overwrite the fixture now selected", async () => {
    // 101 resolves AFTER 202: without the guard, the user would open 202 and
    // then watch it silently become 101.
    fetchMock.mockImplementation(async (url: string) => {
      const id = Number(String(url).split("fixtureId=")[1]);
      if (id === 101) await new Promise((r) => setTimeout(r, 60));
      return itemResponse(id);
    });

    const view = render(<Probe id={101} />);
    view.rerender(<Probe id={202} />);

    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("202"));
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.getByTestId("state").textContent, "a stale response replaced the current fixture").toBe("202");
  });

  it("surfaces a failure as an error, not as data", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: "Fixture inexistent în istoric." })
    }));

    render(<Probe id={999} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("error:"));
    expect(screen.getByTestId("state").textContent).toContain("inexistent");
  });

  it("asks for nothing when no fixture is selected", async () => {
    render(<Probe id={null} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(detailCalls()).toEqual([]);
    expect(screen.getByTestId("state").textContent).toBe("none");
  });

  it("does not update state after unmount", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => errors.push(a));
    fetchMock.mockImplementation(async (url: string) => {
      await new Promise((r) => setTimeout(r, 40));
      return itemResponse(Number(String(url).split("fixtureId=")[1]));
    });

    const { unmount } = render(<Probe id={303} />);
    unmount();
    await new Promise((r) => setTimeout(r, 90));
    expect(errors, "unmount produced a React state-update warning").toEqual([]);
    spy.mockRestore();
  });
});
