import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SESSION_RESTORE_TIMEOUT_MS } from "../utils/authTimeout";

/**
 * The spinner that never ended.
 *
 * L1 put a deadline on every auth REQUEST, and in production those deadlines
 * demonstrably fired — three of them, ten seconds apart. The app still sat on
 * "Se încarcă sesiunea…" indefinitely, because `auth.getSession()` first awaits
 * auth-js's `initializePromise`, which spans however many refresh attempts
 * auth-js decides to make. Bounding each attempt does not bound a sequence.
 *
 * `setLoading(false)` lives in that promise's `finally`, so an unbounded restore
 * is an unbounded spinner. The invariant under test: restore always settles, and
 * a timeout never invents a logout it has no evidence for.
 */

const ctl = {
  getSession: (() => Promise.resolve({ data: { session: null }, error: null })) as () => Promise<unknown>,
  getUser: (() => Promise.resolve({ data: { user: null }, error: null })) as () => Promise<unknown>,
  refreshSession: (() => Promise.resolve({ data: { session: null }, error: null })) as () => Promise<unknown>,
  profile: (() => Promise.resolve({ data: null, error: null })) as () => Promise<unknown>,
  persisted: null as { access_token?: string; user?: { id?: string; email?: string } } | null
};

vi.mock("../utils/supabaseClient", () => ({
  isSupabaseConfigured: true,
  readPersistedSession: () => ctl.persisted,
  supabase: {
    auth: {
      getSession: () => ctl.getSession(),
      getUser: () => ctl.getUser(),
      refreshSession: () => ctl.refreshSession(),
      signInWithPassword: async () => ({ data: { session: null, user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => ctl.profile() }) }) })
  }
}));

import { AuthProvider, useAuth } from "./useAuth";

const SESSION = {
  access_token: "token-A",
  user: { id: "u1", email: "user@example.com", user_metadata: {} }
};
const PROFILE = { user_id: "u1", role: "user", favorite_leagues: [], is_blocked: false };

let api: ReturnType<typeof useAuth>;

function Probe() {
  api = useAuth();
  return (
    <div>
      <span data-testid="status">{api.authStatus}</span>
      <span data-testid="user">{api.user?.email ?? "anon"}</span>
      <span data-testid="session">{api.session ? "session" : "none"}</span>
      <span data-testid="loading">{api.loading ? "loading" : "ready"}</span>
    </div>
  );
}

function mount() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

const read = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  ctl.getSession = async () => ({ data: { session: null }, error: null });
  ctl.getUser = async () => ({ data: { user: null }, error: null });
  ctl.refreshSession = async () => ({ data: { session: null }, error: null });
  ctl.profile = async () => ({ data: PROFILE, error: null });
  ctl.persisted = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ ok: false }) }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Drives the restore deadline without waiting on a wall clock. */
async function advancePastDeadline() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SESSION_RESTORE_TIMEOUT_MS + 100);
  });
}

describe("session restore is bounded", () => {
  test("a healthy restore still resolves normally and quickly", async () => {
    ctl.getSession = async () => ({ data: { session: SESSION }, error: null });
    ctl.getUser = async () => ({ data: { user: SESSION.user }, error: null });

    mount();
    await waitFor(() => expect(read("loading")).toBe("ready"));
    expect(read("status")).toBe("authenticated");
    expect(read("user")).toBe("user@example.com");
  });

  test("a getSession that NEVER resolves still settles the loading state", async () => {
    vi.useFakeTimers();
    // The production shape: auth-js never finishes initialising.
    ctl.getSession = () => new Promise(() => {});
    ctl.persisted = { access_token: "token-A", user: { id: "u1", email: "user@example.com" } };

    mount();
    expect(read("loading")).toBe("loading");

    await advancePastDeadline();

    // The invariant: the gate is never left spinning forever.
    expect(read("loading")).toBe("ready");
  });

  test("a restore timeout does not discard a session that is still stored", async () => {
    vi.useFakeTimers();
    ctl.getSession = () => new Promise(() => {});
    ctl.persisted = { access_token: "token-A", user: { id: "u1", email: "user@example.com" } };

    mount();
    await advancePastDeadline();

    // A timeout answers nothing about whether the credential is valid, so the
    // stored session stands and the state merely says "degraded".
    expect(read("session")).toBe("session");
    expect(read("user")).toBe("user@example.com");
    expect(read("status")).toBe("auth-error");
  });

  test("a restore timeout with no stored session routes as unauthenticated", async () => {
    vi.useFakeTimers();
    ctl.getSession = () => new Promise(() => {});
    ctl.persisted = null;

    mount();
    await advancePastDeadline();

    expect(read("loading")).toBe("ready");
    expect(read("session")).toBe("none");
    expect(read("status")).toBe("no-session");
  });

  test("a confirmed absent session still resolves to no-session", async () => {
    mount();
    await waitFor(() => expect(read("loading")).toBe("ready"));
    expect(read("status")).toBe("no-session");
    expect(read("user")).toBe("anon");
  });

  test("a timeout is reported to the user, not swallowed", async () => {
    vi.useFakeTimers();
    ctl.getSession = () => new Promise(() => {});
    ctl.persisted = { access_token: "token-A", user: { id: "u1", email: "user@example.com" } };

    mount();
    await advancePastDeadline();
    expect(api.error).toBeTruthy();
  });

  test("the deadline leaves no timer behind once restore settles", async () => {
    vi.useFakeTimers();
    ctl.getSession = () => new Promise(() => {});
    ctl.persisted = null;

    mount();
    await advancePastDeadline();
    // Any straggler here would fire against an unmounted tree.
    expect(vi.getTimerCount()).toBe(0);
  });
});

/* -- L1 behaviour must survive L2 ------------------------------------------ */

describe("L1 guarantees still hold", () => {
  test("a 503 on getUser still preserves the session rather than logging out", async () => {
    ctl.getSession = async () => ({ data: { session: SESSION }, error: null });
    ctl.getUser = async () => ({ data: { user: null }, error: new Error("Service Unavailable") });
    ctl.refreshSession = async () => ({ data: { session: null }, error: new Error("refresh failed") });

    mount();
    await waitFor(() => expect(read("loading")).toBe("ready"));
    expect(read("session")).toBe("session");
    expect(read("status")).toBe("auth-error");
  });

  test("a genuinely rejected session is still cleared", async () => {
    let calls = 0;
    ctl.getSession = async () => {
      calls += 1;
      return { data: { session: calls === 1 ? SESSION : null }, error: null };
    };
    ctl.getUser = async () => ({ data: { user: null }, error: new Error("invalid token") });
    ctl.refreshSession = async () => ({ data: { session: null }, error: new Error("refresh rejected") });

    mount();
    await waitFor(() => expect(read("loading")).toBe("ready"));
    expect(read("session")).toBe("none");
    expect(read("status")).toBe("no-session");
  });

  test("a degraded profile still yields a signed-in user", async () => {
    ctl.getSession = async () => ({ data: { session: SESSION }, error: null });
    ctl.getUser = async () => ({ data: { user: SESSION.user }, error: null });
    ctl.profile = async () => {
      throw new Error("profile unavailable");
    };

    mount();
    await waitFor(() => expect(read("loading")).toBe("ready"));
    expect(read("user")).toBe("user@example.com");
    expect(read("status")).toBe("auth-error");
  });
});
