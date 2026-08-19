import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PredictionRow } from "../types";
import { __clearHistoryDetailCache } from "./useHistoryDetail";
import { resolveModalMatch, useHistoryDetailSource } from "./useHistoryDetailSource";

/**
 * Phase A2: the match modal's source becomes the by-fixture detail row, with the
 * history list row as a full fallback.
 *
 * The properties pinned here are the ones that would let the modal show wrong or
 * no data: that it always has something to render the instant it opens, that a
 * fixture with no history row never spends a request, that a detail failure is
 * survivable, and that fixture A's data can never appear over fixture B.
 */

/** A list row — the fallback source. `src` marks which object won. */
function listRow(id: number): PredictionRow {
  return { id, src: "list", teams: { home: "H", away: "A" } } as unknown as PredictionRow;
}

/** What the detail endpoint returns for the same fixture. */
function detailItem(id: number) {
  return { id, src: "detail", teams: { home: "H", away: "A" } };
}

let fetchMock: ReturnType<typeof vi.fn>;

function okResponse(id: number) {
  return { ok: true, status: 200, json: async () => ({ ok: true, scope: "fixture_detail", item: detailItem(id) }) };
}

beforeEach(() => {
  __clearHistoryDetailCache();
  fetchMock = vi.fn(async (url: string) => okResponse(Number(String(url).split("fixtureId=")[1])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function detailCalls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("fixtureId="));
}

/** Renders which source won, plus the loading/error signals. */
function Probe({ selected, history }: { selected: PredictionRow | null; history: PredictionRow[] }) {
  const { match, loading, error } = useHistoryDetailSource(selected, history);
  const src = match ? String((match as unknown as { src: string }).src) : "none";
  return (
    <span data-testid="state">{`${src}:${match?.id ?? "-"}:${loading ? "loading" : "idle"}:${error ? "err" : "ok"}`}</span>
  );
}

const state = () => String(screen.getByTestId("state").textContent);

describe("useHistoryDetailSource", () => {
  it("renders the list row immediately, before any detail arrives", () => {
    // No awaiting: this is the first synchronous render. The modal must never
    // wait on the network to open.
    render(<Probe selected={listRow(101)} history={[listRow(101)]} />);
    expect(state()).toBe("list:101:loading:ok");
  });

  it("requests detail for the selected fixture and upgrades to it", async () => {
    render(<Probe selected={listRow(101)} history={[listRow(101)]} />);
    await waitFor(() => expect(state()).toBe("detail:101:idle:ok"));
    expect(detailCalls()).toEqual(["/api/history?fixtureId=101"]);
  });

  it("never requests detail for a fixture that is not in history", async () => {
    // Live predictions opened from Home, Matches, Notifications or the command
    // palette have no history row yet — asking would earn a guaranteed 404.
    render(<Probe selected={listRow(555)} history={[listRow(101)]} />);
    await new Promise((r) => setTimeout(r, 40));
    expect(detailCalls()).toEqual([]);
    expect(state()).toBe("list:555:idle:ok");
  });

  it("reuses the cache on reopen, with no second request and no loading flash", async () => {
    const first = render(<Probe selected={listRow(101)} history={[listRow(101)]} />);
    await waitFor(() => expect(state()).toBe("detail:101:idle:ok"));
    first.unmount();

    render(<Probe selected={listRow(101)} history={[listRow(101)]} />);
    // Synchronous: a cached row must hydrate on the very first render.
    expect(state()).toBe("detail:101:idle:ok");
    expect(detailCalls().length, "reopening re-requested a cached fixture").toBe(1);
  });

  it("keeps different fixtures independent across A → B → A", async () => {
    const hist = [listRow(101), listRow(202)];
    const view = render(<Probe selected={listRow(101)} history={hist} />);
    await waitFor(() => expect(state()).toBe("detail:101:idle:ok"));

    view.rerender(<Probe selected={listRow(202)} history={hist} />);
    await waitFor(() => expect(state()).toBe("detail:202:idle:ok"));

    view.rerender(<Probe selected={listRow(101)} history={hist} />);
    expect(state()).toBe("detail:101:idle:ok");
    expect(detailCalls()).toEqual(["/api/history?fixtureId=101", "/api/history?fixtureId=202"]);
  });

  it("never lets fixture A's slow response appear over fixture B", async () => {
    // 101 resolves well after 202. Without both the hook's stale guard and the
    // id re-check at the point of use, the user would open B and watch it
    // silently become A.
    fetchMock.mockImplementation(async (url: string) => {
      const id = Number(String(url).split("fixtureId=")[1]);
      if (id === 101) await new Promise((r) => setTimeout(r, 60));
      return okResponse(id);
    });

    const hist = [listRow(101), listRow(202)];
    const view = render(<Probe selected={listRow(101)} history={hist} />);
    view.rerender(<Probe selected={listRow(202)} history={hist} />);

    await waitFor(() => expect(state()).toBe("detail:202:idle:ok"));
    await new Promise((r) => setTimeout(r, 120));
    expect(state(), "fixture A's response overwrote fixture B").toBe("detail:202:idle:ok");
  });

  it("survives a detail failure by staying on the list row", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ ok: false, error: "Fixture inexistent în istoric." })
    }));

    render(<Probe selected={listRow(101)} history={[listRow(101)]} />);
    await waitFor(() => expect(state()).toBe("list:101:idle:err"));
    // The modal still has a complete object to render — a failed optional fetch
    // must not become a fatal History error.
    expect(state()).toContain("list:101");
  });

  it("does not poison the cache after a failure", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: "boom" })
    }));

    const view = render(<Probe selected={listRow(101)} history={[listRow(101)]} />);
    await waitFor(() => expect(state()).toBe("list:101:idle:err"));
    view.unmount();

    // A later open retries and succeeds: the failure was not cached.
    render(<Probe selected={listRow(101)} history={[listRow(101)]} />);
    await waitFor(() => expect(state()).toBe("detail:101:idle:ok"));
  });

  it("closes cleanly while a detail request is still in flight", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => errors.push(a));
    fetchMock.mockImplementation(async (url: string) => {
      await new Promise((r) => setTimeout(r, 40));
      return okResponse(Number(String(url).split("fixtureId=")[1]));
    });

    const view = render(<Probe selected={listRow(303)} history={[listRow(303)]} />);
    expect(state()).toBe("list:303:loading:ok");

    // Closing the modal is exactly this: selectedMatch goes null mid-flight.
    view.rerender(<Probe selected={null} history={[listRow(303)]} />);
    expect(state()).toBe("none:-:idle:ok");

    await new Promise((r) => setTimeout(r, 90));
    expect(state()).toBe("none:-:idle:ok");
    expect(errors, "closing during load produced a React warning").toEqual([]);
    spy.mockRestore();
  });
});

describe("resolveModalMatch", () => {
  it("prefers detail only when it is the same fixture", () => {
    const selected = listRow(101);
    expect(resolveModalMatch(selected, detailItem(101) as unknown as PredictionRow)).toMatchObject({ src: "detail" });
    // The guard that makes the shared module-level cache safe.
    expect(resolveModalMatch(selected, detailItem(202) as unknown as PredictionRow)).toBe(selected);
    expect(resolveModalMatch(selected, null)).toBe(selected);
    expect(resolveModalMatch(null, detailItem(101) as unknown as PredictionRow)).toBeNull();
  });

  it("matches ids across string and number forms", () => {
    // The list carries fixture ids from JSON; the detail row from Postgres.
    const selected = { id: "101", src: "list" } as unknown as PredictionRow;
    expect(resolveModalMatch(selected, detailItem(101) as unknown as PredictionRow)).toMatchObject({ src: "detail" });
  });
});
