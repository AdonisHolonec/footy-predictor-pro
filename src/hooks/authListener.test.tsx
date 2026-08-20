import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * A null session is not a logout.
 *
 * In auth-js 2.110.7 exactly two events can arrive with a null session:
 * SIGNED_OUT, emitted only by `_removeSession()`, and INITIAL_SESSION, which is
 * emitted with `null` when initialisation *errors*. Every other event —
 * SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY, MFA — always
 * carries a session.
 *
 * Production hit the second case: the app had a working session, auth-js failed
 * to initialise against a degraded server, and the listener read `session ==
 * null` as "signed out", bouncing /workspace -> /login while the stored record
 * sat untouched. Storage is the discriminator, because `_removeSession()`
 * deletes the record *before* emitting SIGNED_OUT.
 *
 * These tests pin that distinction from both sides: a transient null must never
 * sign anyone out, and a real revocation or an explicit sign-out still must.
 */

type Handler = (event: string, session: unknown) => void;

const handlers: Handler[] = [];
const ctl = {
  getSession: (() => Promise.resolve({ data: { session: null }, error: null })) as () => Promise<unknown>,
  getUser: (() => Promise.resolve({ data: { user: null }, error: null })) as () => Promise<unknown>,
  refreshSession: (() => Promise.resolve({ data: { session: null }, error: null })) as () => Promise<unknown>,
  profile: (() => Promise.resolve({ data: null, error: null })) as () => Promise<unknown>,
  signOut: (() => Promise.resolve({ error: null })) as () => Promise<unknown>,
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
      signOut: () => ctl.signOut(),
      onAuthStateChange: (cb: Handler) => {
        handlers.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      }
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => ctl.profile() }) }) })
  }
}));

import { AuthProvider, useAuth } from "./useAuth";

const SESSION = {
  access_token: "token-A",
  user: { id: "u1", email: "user@example.com", user_metadata: {} }
};
const STORED = { access_token: "token-A", user: { id: "u1", email: "user@example.com" } };
const PROFILE = { user_id: "u1", role: "user", favorite_leagues: [], is_blocked: false };

let api: ReturnType<typeof useAuth>;
let renders = 0;

function Probe() {
  api = useAuth();
  renders += 1;
  return (
    <div>
      <span data-testid="status">{api.authStatus}</span>
      <span data-testid="user">{api.user?.email ?? "anon"}</span>
      <span data-testid="session">{api.session ? "session" : "none"}</span>
      <span data-testid="loading">{api.loading ? "loading" : "ready"}</span>
    </div>
  );
}

const read = (id: string) => screen.getByTestId(id).textContent;

/** Mounts with a live session already established, as /workspace would have. */
async function mountSignedIn() {
  ctl.getSession = async () => ({ data: { session: SESSION }, error: null });
  ctl.getUser = async () => ({ data: { user: SESSION.user }, error: null });
  ctl.persisted = STORED;
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await waitFor(() => expect(read("loading")).toBe("ready"));
  expect(read("user")).toBe("user@example.com");
}

async function emit(event: string, session: unknown) {
  await act(async () => {
    handlers.forEach((h) => h(event, session));
    await Promise.resolve();
  });
}

beforeEach(() => {
  handlers.length = 0;
  renders = 0;
  ctl.getSession = async () => ({ data: { session: null }, error: null });
  ctl.getUser = async () => ({ data: { user: null }, error: null });
  ctl.refreshSession = async () => ({ data: { session: null }, error: null });
  ctl.profile = async () => ({ data: PROFILE, error: null });
  ctl.signOut = async () => ({ error: null });
  ctl.persisted = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ ok: false }) }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* -- the false logout ------------------------------------------------------ */

describe("a null session with the record still in storage", () => {
  test("INITIAL_SESSION(null) from a failed init does not sign the user out", async () => {
    await mountSignedIn();
    // auth-js emits this when initialisation errors — e.g. our own deadlines.
    await emit("INITIAL_SESSION", null);

    expect(read("session")).toBe("session");
    expect(read("user")).toBe("user@example.com");
    expect(read("status")).toBe("auth-error");
  });

  test("a transient refresh failure does not send the user to /login", async () => {
    await mountSignedIn();
    await emit("SIGNED_OUT", null); // storage untouched → not a real sign-out

    // AuthGate only redirects when both are absent.
    expect(api.session).not.toBeNull();
    expect(api.user).not.toBeNull();
  });

  test("the loading state still settles on a transient null", async () => {
    await mountSignedIn();
    await emit("INITIAL_SESSION", null);
    expect(read("loading")).toBe("ready");
  });

  test("a transient null settles loading even while restore is still pending", async () => {
    /*
      The distinguishing case: the event arrives BEFORE restore has resolved, so
      `loading` is still true. Without settling it here the gate would keep
      spinning until L2's deadline — bounded, but needlessly slow, and the
      earlier assertion could not see the difference because loading had already
      settled at mount.
    */
    vi.useFakeTimers();
    try {
      ctl.getSession = () => new Promise(() => {});
      ctl.persisted = STORED;
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );
      expect(read("loading")).toBe("loading");

      await emit("INITIAL_SESSION", null);

      // Settled by the listener, without waiting on the restore deadline.
      expect(read("loading")).toBe("ready");
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("repeated transient nulls do not thrash the state", async () => {
    await mountSignedIn();
    const before = renders;
    await emit("INITIAL_SESSION", null);
    await emit("INITIAL_SESSION", null);
    await emit("INITIAL_SESSION", null);

    expect(read("session")).toBe("session");
    expect(read("status")).toBe("auth-error");
    // Three identical events must not produce runaway re-rendering.
    expect(renders - before).toBeLessThan(10);
  });
});

/* -- the real thing -------------------------------------------------------- */

describe("a null session with the record gone", () => {
  test("SIGNED_OUT after auth-js purged storage clears the user", async () => {
    await mountSignedIn();
    // _removeSession() deletes the record before emitting SIGNED_OUT.
    ctl.persisted = null;
    await emit("SIGNED_OUT", null);

    expect(read("session")).toBe("none");
    expect(read("user")).toBe("anon");
    expect(read("status")).toBe("no-session");
  });

  test("a revoked session clears even if the event is INITIAL_SESSION", async () => {
    await mountSignedIn();
    ctl.persisted = null;
    await emit("INITIAL_SESSION", null);

    expect(read("session")).toBe("none");
    expect(read("status")).toBe("no-session");
  });

  test("a stored record without a user is not treated as a session", async () => {
    await mountSignedIn();
    ctl.persisted = { access_token: "t" };
    await emit("SIGNED_OUT", null);

    expect(read("session")).toBe("none");
    expect(read("status")).toBe("no-session");
  });
});

/* -- user-initiated sign-out ----------------------------------------------- */

describe("explicit sign-out", () => {
  test("signing out clears immediately", async () => {
    await mountSignedIn();
    ctl.signOut = async () => {
      ctl.persisted = null;
      return { error: null };
    };
    await act(async () => {
      await api.logout();
    });

    expect(read("session")).toBe("none");
    expect(read("user")).toBe("anon");
    expect(read("status")).toBe("no-session");
  });

  test("signing out clears even when the network call fails", async () => {
    await mountSignedIn();
    // The outage case: the record may survive, but the intent was explicit.
    ctl.signOut = async () => ({ error: new Error("network down") });
    await act(async () => {
      await api.logout().catch(() => null);
    });

    expect(read("session")).toBe("none");
    expect(read("user")).toBe("anon");
    expect(read("status")).toBe("no-session");
  });
});

/* -- events that carry a session are untouched ----------------------------- */

describe("events carrying a session behave as before", () => {
  test("SIGNED_IN establishes the user", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(read("loading")).toBe("ready"));
    ctl.persisted = STORED;
    await emit("SIGNED_IN", SESSION);
    await waitFor(() => expect(read("user")).toBe("user@example.com"));
    expect(read("status")).toBe("authenticated");
  });

  test("TOKEN_REFRESHED keeps the user signed in", async () => {
    await mountSignedIn();
    await emit("TOKEN_REFRESHED", { ...SESSION, access_token: "token-B" });
    await waitFor(() => expect(read("user")).toBe("user@example.com"));
    expect(read("session")).toBe("session");
  });

  test("INITIAL_SESSION with a session behaves normally", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(read("loading")).toBe("ready"));
    ctl.persisted = STORED;
    await emit("INITIAL_SESSION", SESSION);
    await waitFor(() => expect(read("user")).toBe("user@example.com"));
  });

  test("USER_UPDATED keeps the user signed in", async () => {
    await mountSignedIn();
    await emit("USER_UPDATED", SESSION);
    await waitFor(() => expect(read("session")).toBe("session"));
    expect(read("user")).toBe("user@example.com");
  });

  test("a degraded profile on a session-carrying event still leaves a user", async () => {
    await mountSignedIn();
    ctl.profile = async () => {
      throw new Error("profile unavailable");
    };
    await emit("TOKEN_REFRESHED", SESSION);
    await waitFor(() => expect(read("status")).toBe("auth-error"));
    expect(read("user")).toBe("user@example.com");
  });
});

/* -- compatibility with L1 / L2 -------------------------------------------- */

describe("L1 and L2 guarantees survive", () => {
  test("restore still settles and a 503 still preserves the session", async () => {
    ctl.getSession = async () => ({ data: { session: SESSION }, error: null });
    ctl.getUser = async () => ({ data: { user: null }, error: new Error("Service Unavailable") });
    ctl.refreshSession = async () => ({ data: { session: null }, error: new Error("refresh failed") });
    ctl.persisted = STORED;

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(read("loading")).toBe("ready"));
    expect(read("session")).toBe("session");
    expect(read("status")).toBe("auth-error");
  });

  test("a confirmed absent session still routes as unauthenticated", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(read("loading")).toBe("ready"));
    expect(read("status")).toBe("no-session");
    expect(read("user")).toBe("anon");
  });

  test("no timer is left behind by the listener path", async () => {
    // Mount on real timers (waitFor polls), then switch so the count below
    // reflects only what the listener itself schedules.
    await mountSignedIn();
    vi.useFakeTimers();
    try {
      await emit("INITIAL_SESSION", null);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
