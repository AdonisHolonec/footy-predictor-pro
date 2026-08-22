import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "../../context/LocaleContext";
import type { AuthStatus } from "../../hooks/useAuth";
import type { PredictionRow } from "../../types";
import { usePredictionsCache } from "./usePredictionsCache";

/**
 * UX-H — startup must be silent and must keep the cached matches on screen.
 *
 * Production (forensic audit, 2026-08-22): useAuth publishes the user twice on
 * login — first with `profile = null` (tier "free", authStatus "profile-pending"),
 * then with the real profile. The tier-promotion effect in usePredictionsCache
 * read that as free → paid on every paid login: it deleted the localStorage
 * cache, emptied `preds` (matches vanished for the duration of /api/history)
 * and announced "Plan upgraded". The forced re-hydration then wrote "Restored n
 * predictions from history" into the dashboard's never-cleared status banner.
 *
 * Everything below asserts observable behaviour through the real hook.
 */

type Deferred = { resolveWith: (items: unknown[]) => void };

let fetchMock: ReturnType<typeof vi.fn>;
let pending: Deferred[];

function deferred() {
  let resolveFn!: (v: unknown) => void;
  const promise = new Promise<unknown>((res) => {
    resolveFn = res;
  });
  return {
    promise,
    resolveWith: (items: unknown[]) =>
      resolveFn({ ok: true, status: 200, json: async () => ({ ok: true, mine: true, items }) })
  };
}

const USER = "user-1";
const KICKOFF = "2026-08-18T18:00:00+00:00";
const DATE = "2026-08-18";

function row(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    leagueId: 283,
    league: "Liga I",
    teams: { home: `H${id}`, away: `A${id}` },
    kickoff: KICKOFF,
    status: "NS",
    modelVersion: "v3",
    recommended: { pick: "Over 2.5", confidence: 70, odd: 1.9 },
    // Full-shape rows: corners + shots on target present, so an ultra user's
    // cache is not "legacy shaped" and does not trigger the tier-shape rehydrate.
    probs: { corners: { over: 0.5 }, shotsOnTarget: { over: 0.5 } },
    ...overrides
  } as unknown as PredictionRow;
}

function seedCache(rows: PredictionRow[]) {
  localStorage.setItem("footy.user.predictionsByUser", JSON.stringify({ [USER]: rows }));
}

type Snapshot = { preds: PredictionRow[]; notice: string | null };
type Api = { hydrate: (o?: { silent?: boolean }) => Promise<PredictionRow[]> };

function Probe({
  tier,
  authStatus,
  onRender,
  expose,
  setStatus
}: {
  tier: string;
  authStatus?: AuthStatus;
  onRender: (s: Snapshot) => void;
  expose: (api: Api) => void;
  setStatus: (m: string) => void;
}) {
  const cache = usePredictionsCache({
    user: { id: USER, tier } as never,
    userTier: tier,
    authStatus,
    accessToken: "token-1",
    date: DATE,
    selectedDates: [DATE],
    setSelectedDates: () => {},
    selectedLeagueIds: [283],
    history: [],
    setStatus
  } as never);
  onRender({ preds: cache.preds, notice: cache.rehydratedNotice });
  useEffect(() => {
    expose({ hydrate: cache.rehydratePredictionsFromHistory });
  });
  return null;
}

/** Surfaces the translated strings the assertions compare against. */
function Strings({ expose }: { expose: (t: (k: string, v?: Record<string, string | number>) => string) => void }) {
  const { t } = useLocale();
  expose(t);
  return null;
}

function mount(initial: { tier: string; authStatus?: AuthStatus }) {
  const snapshots: Snapshot[] = [];
  const statuses: string[] = [];
  let api: Api = { hydrate: () => Promise.resolve([]) };
  let t: (k: string, v?: Record<string, string | number>) => string = (k) => k;
  const view = (props: { tier: string; authStatus?: AuthStatus }) => (
    <LocaleProvider>
      <Strings expose={(fn) => (t = fn)} />
      <Probe
        {...props}
        onRender={(s) => snapshots.push(s)}
        expose={(a) => (api = a)}
        setStatus={(m) => statuses.push(m)}
      />
    </LocaleProvider>
  );
  const utils = render(view(initial));
  return {
    rerender: (props: { tier: string; authStatus?: AuthStatus }) => utils.rerender(view(props)),
    latest: () => snapshots[snapshots.length - 1],
    everEmpty: () => snapshots.some((s, i) => i > 0 && s.preds.length === 0),
    statuses,
    hydrate: (o?: { silent?: boolean }) => api.hydrate(o),
    t: (k: string, v?: Record<string, string | number>) => t(k, v)
  };
}

beforeEach(() => {
  localStorage.clear();
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
  vi.useRealTimers();
});

describe("UX-H A/B — the auth placeholder tier is not a plan upgrade", () => {
  it("login: profile-pending 'free' → authenticated 'ultra' keeps the cached matches and emits nothing", async () => {
    seedCache([row(1), row(2), row(3)]);
    const m = mount({ tier: "free", authStatus: "profile-pending" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(3));

    m.rerender({ tier: "ultra", authStatus: "authenticated" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(3));

    expect(m.everEmpty()).toBe(false);
    expect(m.statuses).toEqual([]);
    expect(JSON.parse(localStorage.getItem("footy.user.predictionsByUser") || "{}")[USER]).toHaveLength(3);
  });

  it("reload race: authenticated 'ultra' → placeholder 'free' → 'ultra' again is not an upgrade", async () => {
    seedCache([row(1), row(2)]);
    const m = mount({ tier: "ultra", authStatus: "authenticated" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(2));
    m.rerender({ tier: "free", authStatus: "profile-pending" });
    m.rerender({ tier: "ultra", authStatus: "authenticated" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(2));
    expect(m.statuses).toEqual([]);
  });

  it("a real promotion (authenticated free → ultra) still clears the masked cache and announces it, in i18n", async () => {
    seedCache([row(1), row(2)]);
    const m = mount({ tier: "free", authStatus: "authenticated" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(2));

    m.rerender({ tier: "ultra", authStatus: "authenticated" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(0));

    expect(m.statuses).toEqual([m.t("dash.planUpgraded")]);
    expect(m.statuses[0]).not.toContain("{");
    expect(JSON.parse(localStorage.getItem("footy.user.predictionsByUser") || "{}")[USER]).toBeUndefined();
  });

  it("callers that do not pass authStatus keep the previous behaviour (promotion detected)", async () => {
    seedCache([row(1)]);
    const m = mount({ tier: "free" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(1));
    m.rerender({ tier: "premium" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(0));
    expect(m.statuses).toHaveLength(1);
  });

  it("a downgrade never clears anything", async () => {
    seedCache([row(1)]);
    const m = mount({ tier: "ultra", authStatus: "authenticated" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(1));
    m.rerender({ tier: "free", authStatus: "authenticated" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(1));
    expect(m.statuses).toEqual([]);
  });
});

describe("UX-H A — cached matches stay visible while history loads", () => {
  it("empty history does not erase cached matches; a non-empty one replaces them without an empty frame", async () => {
    seedCache([row(1), row(2)]);
    const m = mount({ tier: "ultra", authStatus: "authenticated" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(2));

    // Ask for hydration the way Refresh does, then answer with nothing.
    const p1 = m.hydrate();
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    await act(async () => {
      pending[pending.length - 1].resolveWith([]);
      await p1;
    });
    expect(m.latest().preds).toHaveLength(2);

    const p2 = m.hydrate();
    await waitFor(() => expect(pending.length).toBeGreaterThan(1));
    await act(async () => {
      pending[pending.length - 1].resolveWith([row(1), row(2), row(3)]);
      await p2;
    });
    expect(m.latest().preds).toHaveLength(3);
    expect(m.everEmpty()).toBe(false);
  });
});

describe("UX-H C — restoration messages", () => {
  it("startup (effect-driven) hydration is silent: no status, no notice", async () => {
    // Empty cache → the hook's own effect hydrates on mount.
    const m = mount({ tier: "ultra", authStatus: "authenticated" });
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => {
      pending[0].resolveWith([row(1), row(2)]);
      await Promise.resolve();
    });
    await waitFor(() => expect(m.latest().preds).toHaveLength(2));
    expect(m.statuses).toEqual([]);
    expect(m.latest().notice).toBeNull();
  });

  it("user-initiated hydration announces once, in the current locale, with a bounded notice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seedCache([row(1)]);
    const m = mount({ tier: "ultra", authStatus: "authenticated" });
    await waitFor(() => expect(m.latest().preds).toHaveLength(1));
    // The first commit still sees preds=[] and starts the silent startup
    // hydration; a Refresh during that window joins it (existing in-flight
    // dedup). Let it settle first, so this is a genuine user-initiated call.
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => {
      pending[0].resolveWith([]);
      await Promise.resolve();
    });
    expect(m.statuses).toEqual([]);

    const p = m.hydrate();
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => {
      pending[1].resolveWith([row(1), row(2)]);
      await p;
    });
    expect(m.statuses).toEqual([m.t("dash.restoredHistory", { n: 2 })]);
    expect(m.latest().notice).toBe(m.t("dash.restoredNotice", { n: 2 }));

    // Re-renders do not restart the 5 s timer; it expires once.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    m.rerender({ tier: "ultra", authStatus: "authenticated" });
    expect(m.latest().notice).toBe(m.t("dash.restoredNotice", { n: 2 }));
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(m.latest().notice).toBeNull();
    expect(m.statuses).toHaveLength(1);
  });

  it("RO and EN carry every string this flow can show", () => {
    const { t: tRo } = (() => {
      let fn: (k: string, v?: Record<string, string | number>) => string = (k) => k;
      render(
        <LocaleProvider>
          <Strings expose={(f) => (fn = f)} />
        </LocaleProvider>
      );
      return { t: fn };
    })();
    for (const key of ["dash.planUpgraded", "dash.restoredHistory", "dash.restoredNotice", "dash.rehydratedLabel"]) {
      const text = tRo(key, { n: 4 });
      expect(text, key).not.toBe(key);
      expect(text, key).not.toContain("{n}");
    }
  });
});
