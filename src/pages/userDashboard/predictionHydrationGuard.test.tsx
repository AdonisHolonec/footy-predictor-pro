import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import { usePredictionsCache } from "./usePredictionsCache";
import type { PredictionRow } from "../../types";

/**
 * One hydration request at a time.
 *
 * Both de-dup guards in usePredictionsCache are conditioned on `preds.length > 0`,
 * so the empty-cache case — the only case that actually needs hydrating — reached
 * the request with nothing stopping a second call. Measured in production: two
 * identical 45,074,431-byte responses starting 11 ms apart on one cold start.
 *
 * Everything below asserts observable behaviour: how many requests were issued,
 * what they asked for, and what the hook did with the answer. No source text.
 */

type Deferred = {
  promise: Promise<unknown>;
  resolveWith: (items: unknown[], extra?: Record<string, unknown>) => void;
  rejectWith: () => void;
};

let fetchMock: ReturnType<typeof vi.fn>;
let pending: Deferred[];

function deferred(): Deferred {
  let resolveFn!: (v: unknown) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return {
    promise,
    resolveWith: (items: unknown[], extra: Record<string, unknown> = {}) =>
      resolveFn({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          mine: true,
          items,
          stats: { wins: 0, losses: 0, settled: 0, winRate: 0 },
          ...extra
        })
      }),
    rejectWith: () => rejectFn(new Error("network down"))
  };
}

/** Only the prediction-hydration calls, ignoring any other history traffic. */
function hydrationCalls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("mine=1") && !u.includes("view="));
}

function settleLatest(items: unknown[], extra: Record<string, unknown> = {}) {
  pending[pending.length - 1].resolveWith(items, extra);
}

beforeEach(() => {
  pending = [];
  fetchMock = vi.fn(() => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Hydrate = () => Promise<PredictionRow[]>;

const KICKOFF_IN_RANGE = "2026-08-18T18:00:00+00:00";
const KICKOFF_OUT_OF_RANGE = "2026-08-11T18:00:00+00:00";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 900001,
    leagueId: 283,
    league: "Liga I",
    teams: { home: "A", away: "B" },
    kickoff: KICKOFF_IN_RANGE,
    status: "NS",
    modelVersion: "v3",
    recommended: { pick: "Over 2.5", confidence: 70, odd: 1.9 },
    probs: { corners: { over: 0.5 }, shotsOnTarget: { over: 0.5 } },
    ...overrides
  };
}

/** Renders the hook and hands the caller its hydration function. */
function Probe({
  expose,
  tier = "ultra",
  leagues = [283]
}: {
  expose: (fn: Hydrate) => void;
  tier?: string;
  leagues?: number[];
}) {
  const cache = usePredictionsCache({
    user: { id: "user-1", tier } as never,
    userTier: tier,
    accessToken: "token-1",
    date: "2026-08-18",
    selectedDates: ["2026-08-18"],
    setSelectedDates: () => {},
    selectedLeagueIds: leagues,
    history: [],
    setStatus: () => {}
  } as never);
  useEffect(() => {
    expose(cache.rehydratePredictionsFromHistory as Hydrate);
  });
  return null;
}

function mount(props: { tier?: string; leagues?: number[] } = {}) {
  let hydrate: Hydrate = (() => Promise.resolve([])) as Hydrate;
  render(
    <LocaleProvider>
      <Probe
        expose={(fn) => {
          hydrate = fn;
        }}
        {...props}
      />
    </LocaleProvider>
  );
  return { call: () => hydrate() };
}

describe("hydration in-flight guard", () => {
  it("issues one request when hydration is triggered concurrently", async () => {
    const h = mount();
    await waitFor(() => expect(hydrationCalls().length).toBe(1));

    // Three more callers arrive while the first request is still in flight.
    const a = h.call();
    const b = h.call();
    const c = h.call();

    expect(hydrationCalls().length).toBe(1);

    settleLatest([row()]);
    const [ra, rb, rc] = await Promise.all([a, b, c]);

    // Concurrent callers share the one answer rather than racing separate ones.
    expect(ra).toEqual(rb);
    expect(rb).toEqual(rc);
    expect(hydrationCalls().length).toBe(1);
  });

  it("allows a later hydration once the first has resolved", async () => {
    const h = mount();
    await waitFor(() => expect(hydrationCalls().length).toBe(1));

    settleLatest([row()]);
    await h.call();

    const second = h.call();
    await waitFor(() => expect(hydrationCalls().length).toBe(2));
    settleLatest([row({ id: 900002 })]);
    await second;

    expect(hydrationCalls().length).toBe(2);
  });

  it("retries after a failed hydration instead of latching off", async () => {
    const h = mount();
    await waitFor(() => expect(hydrationCalls().length).toBe(1));

    pending[0].rejectWith();
    expect(await h.call()).toEqual([]);

    const retry = h.call();
    await waitFor(() => expect(hydrationCalls().length).toBe(2));
    settleLatest([row()]);
    const rows = await retry;

    // A failure is not remembered as a successful hydration.
    expect(rows.map((r) => Number(r.id))).toEqual([900001]);
  });

  it("does not remember an empty result as a completed hydration", async () => {
    const h = mount();
    await waitFor(() => expect(hydrationCalls().length).toBe(1));

    settleLatest([]);
    expect(await h.call()).toEqual([]);

    const again = h.call();
    await waitFor(() => expect(hydrationCalls().length).toBe(2));
    settleLatest([row()]);
    expect((await again).length).toBe(1);
  });

  it("leaves the hydration request itself unchanged", async () => {
    mount();
    await waitFor(() => expect(hydrationCalls().length).toBe(1));
    const url = hydrationCalls()[0];

    expect(url).toContain("/api/history");
    expect(url).toContain("days=14");
    expect(url).toContain("limit=1000");
    expect(url).toContain("mine=1");
    // The full projection is what feeds the prediction cards; a light row here
    // would strip them and keep every row looking legacy.
    expect(url).not.toContain("view=");
  });

  it("still applies the date filter to hydrated rows", async () => {
    const h = mount();
    await waitFor(() => expect(hydrationCalls().length).toBe(1));

    settleLatest([row({ id: 900003, kickoff: KICKOFF_OUT_OF_RANGE })]);

    // Selected date is 2026-08-18; a 08-11 kickoff must not be restored.
    expect(await h.call()).toEqual([]);
  });

  it("still applies the league filter to hydrated rows", async () => {
    const h = mount({ leagues: [999] });
    await waitFor(() => expect(hydrationCalls().length).toBe(1));

    settleLatest([row({ leagueId: 283 })]);
    expect(await h.call()).toEqual([]);
  });

  it("refuses a response that is not user-scoped", async () => {
    const h = mount();
    await waitFor(() => expect(hydrationCalls().length).toBe(1));

    settleLatest([row()], { mine: false });
    expect(await h.call()).toEqual([]);
  });

  it("keeps the ultra legacy-shape row restorable and does not block the next call", async () => {
    const h = mount({ tier: "ultra" });
    await waitFor(() => expect(hydrationCalls().length).toBe(1));

    // probs without corners/shotsOnTarget is what hasLegacyPredictionShape flags for ultra.
    settleLatest([row({ probs: { home: 0.4 } })]);
    expect((await h.call()).length).toBe(1);

    const next = h.call();
    await waitFor(() => expect(hydrationCalls().length).toBe(2));
    settleLatest([]);
    await next;
    expect(hydrationCalls().length).toBe(2);
  });
});
