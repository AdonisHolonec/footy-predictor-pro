import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AuthTimeoutError } from "../utils/authTimeout";

/**
 * What happens to a sign-in when Supabase Auth stalls.
 *
 * Production evidence: `GET /auth/v1/user` returned 503 and then stopped
 * answering, while a valid unexpired session sat in storage. The old code read
 * that as "signed out" — it nulled the session and threw — so a transient
 * upstream wobble became a forced logout and a /workspace -> /login loop. And
 * because a hung promise never settles, a stalled profile read after a
 * *successful* sign-in left the button on "Se procesează…" indefinitely.
 *
 * These tests pin the two rules that follow: a request that fails is not a user
 * who is signed out, and nothing secondary may hold the button open.
 */

type Ctl = {
  getSession: () => Promise<unknown>;
  getUser: () => Promise<unknown>;
  refreshSession: () => Promise<unknown>;
  signIn: () => Promise<unknown>;
  profile: () => Promise<unknown>;
};

const ctl: Ctl = {
  getSession: async () => ({ data: { session: null }, error: null }),
  getUser: async () => ({ data: { user: null }, error: null }),
  refreshSession: async () => ({ data: { session: null }, error: null }),
  signIn: async () => ({ data: { session: null, user: null }, error: null }),
  profile: async () => ({ data: null, error: null })
};

vi.mock("../utils/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () => ctl.getSession(),
      getUser: () => ctl.getUser(),
      refreshSession: () => ctl.refreshSession(),
      signInWithPassword: () => ctl.signIn(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => ctl.profile() }) })
    })
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

async function mount() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
}

beforeEach(() => {
  ctl.getSession = async () => ({ data: { session: null }, error: null });
  ctl.getUser = async () => ({ data: { user: null }, error: null });
  ctl.refreshSession = async () => ({ data: { session: null }, error: null });
  ctl.signIn = async () => ({ data: { session: SESSION, user: SESSION.user }, error: null });
  ctl.profile = async () => ({ data: PROFILE, error: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ ok: false }) }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* -- login ----------------------------------------------------------------- */

describe("login", () => {
  test("a successful sign-in still resolves with the profile applied", async () => {
    await mount();
    await act(async () => {
      await api.login("user@example.com", "pw");
    });
    expect(screen.getByTestId("user").textContent).toBe("user@example.com");
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
  });

  test("a stalled sign-in rejects, so the caller's finally can clear submitting", async () => {
    ctl.signIn = async () => {
      throw new AuthTimeoutError(10_000);
    };
    await mount();

    // The shape Login.tsx uses: try/catch/finally around await login().
    let submitting = true;
    let caught: unknown = null;
    await act(async () => {
      try {
        await api.login("user@example.com", "pw");
      } catch (error) {
        caught = error;
      } finally {
        submitting = false;
      }
    });

    expect(caught).toBeInstanceOf(AuthTimeoutError);
    expect(submitting).toBe(false);
  });

  test("a failing profile read leaves the user signed in, not signed out", async () => {
    ctl.profile = async () => {
      throw new AuthTimeoutError(10_000);
    };
    await mount();
    await act(async () => {
      await api.login("user@example.com", "pw");
    });

    // Authenticated, degraded — the session decides, not the profile.
    expect(screen.getByTestId("session").textContent).toBe("session");
    expect(screen.getByTestId("user").textContent).toBe("user@example.com");
    expect(screen.getByTestId("status").textContent).toBe("auth-error");
  });

  test("a user without a loaded profile reports onboarding as unknown, not false", async () => {
    /*
      The distinction the onboarding gate depends on, asserted through the real
      mapSupabaseUser: while the profile is absent the answer is `undefined`
      ("we do not know"), never `false` ("this user never onboarded") — which is
      what showed an existing user the onboarding carousel mid-restore.
    */
    ctl.profile = async () => {
      throw new AuthTimeoutError(10_000);
    };
    await mount();
    await act(async () => {
      await api.login("user@example.com", "pw");
    });
    expect(api.user).not.toBeNull();
    expect(api.user?.onboardingCompleted).toBeUndefined();
  });

  test("a loaded profile reports onboarding as a real boolean", async () => {
    ctl.profile = async () => ({ data: { ...PROFILE, onboarding_completed: true }, error: null });
    await mount();
    await act(async () => {
      await api.login("user@example.com", "pw");
    });
    expect(api.user?.onboardingCompleted).toBe(true);
  });

  test("a loaded profile that has not onboarded reports a real false", async () => {
    // The case the whole feature turns on: a genuinely new user must still be
    // distinguishable from one whose profile simply has not arrived.
    ctl.profile = async () => ({ data: { ...PROFILE, onboarding_completed: false }, error: null });
    await mount();
    await act(async () => {
      await api.login("user@example.com", "pw");
    });
    expect(api.user?.onboardingCompleted).toBe(false);
  });

  test("a failing profile read is reported, never swallowed", async () => {
    ctl.profile = async () => {
      throw new AuthTimeoutError(10_000);
    };
    await mount();
    await act(async () => {
      await api.login("user@example.com", "pw");
    });
    expect(api.error).toBeTruthy();
  });

  test("a stalled bootstrap-admin call cannot hold the sign-in open", async () => {
    /*
      role "user" is the promotion candidate, so the POST is actually attempted.
      The bounded fetch converts a stall into this rejection after its deadline;
      the deadline itself is covered in authTimeout.test.ts, so injecting the
      post-deadline outcome keeps this test about handling rather than waiting.
    */
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      throw new AuthTimeoutError(10_000);
    });
    vi.stubGlobal("fetch", fetchSpy);
    await mount();

    const settled = vi.fn();
    await act(async () => {
      await api.login("user@example.com", "pw").then(settled, settled);
    });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("session").textContent).toBe("session");
    // The request must be cancellable — an unbounded one could hang forever.
    // The bootstrap request specifically must be cancellable — an unbounded one
    // could hang forever and hold the sign-in open on its own.
    const bootstrapCall = fetchSpy.mock.calls.find((call) =>
      String(call[0]).includes("syncBootstrapAdmin")
    );
    expect(bootstrapCall).toBeDefined();
    expect((bootstrapCall?.[1] as RequestInit | undefined)?.signal).toBeDefined();
  });

  test("a rejected credential still fails the way it always did", async () => {
    const credentialError = Object.assign(new Error("Invalid login credentials"), { name: "AuthApiError" });
    ctl.signIn = async () => ({ data: { session: null, user: null }, error: credentialError });
    await mount();
    await expect(api.login("user@example.com", "wrong")).rejects.toBe(credentialError);
  });

  test("a failed attempt is retryable — a later success authenticates normally", async () => {
    ctl.signIn = async () => {
      throw new AuthTimeoutError(10_000);
    };
    await mount();
    await act(async () => {
      await api.login("user@example.com", "pw").catch(() => null);
    });
    expect(screen.getByTestId("user").textContent).toBe("anon");

    ctl.signIn = async () => ({ data: { session: SESSION, user: SESSION.user }, error: null });
    await act(async () => {
      await api.login("user@example.com", "pw");
    });
    expect(screen.getByTestId("user").textContent).toBe("user@example.com");
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
  });
});

/* -- session restore ------------------------------------------------------- */

describe("session restore", () => {
  test("a 503 on getUser does not discard a session that is still present", async () => {
    ctl.getSession = async () => ({ data: { session: SESSION }, error: null });
    ctl.getUser = async () => ({ data: { user: null }, error: new Error("Service Unavailable") });
    ctl.refreshSession = async () => ({ data: { session: null }, error: new Error("refresh failed") });

    await mount();

    // The exact production failure: valid session, upstream not answering.
    expect(screen.getByTestId("session").textContent).toBe("session");
    expect(screen.getByTestId("user").textContent).toBe("user@example.com");
    expect(screen.getByTestId("status").textContent).toBe("auth-error");
  });

  test("a genuinely rejected session is still cleared", async () => {
    let calls = 0;
    ctl.getSession = async () => {
      calls += 1;
      // auth-js removes the session from storage when the refresh token is
      // rejected, so the re-read comes back empty — that is a real sign-out.
      return { data: { session: calls === 1 ? SESSION : null }, error: null };
    };
    ctl.getUser = async () => ({ data: { user: null }, error: new Error("invalid token") });
    ctl.refreshSession = async () => ({ data: { session: null }, error: new Error("refresh rejected") });

    await mount();
    expect(screen.getByTestId("session").textContent).toBe("none");
    expect(screen.getByTestId("user").textContent).toBe("anon");
    expect(screen.getByTestId("status").textContent).toBe("no-session");
  });

  test("no session at all resolves to a confirmed absence", async () => {
    await mount();
    expect(screen.getByTestId("status").textContent).toBe("no-session");
    expect(screen.getByTestId("user").textContent).toBe("anon");
  });

  test("a session whose profile fails still yields a usable signed-in state", async () => {
    ctl.getSession = async () => ({ data: { session: SESSION }, error: null });
    ctl.getUser = async () => ({ data: { user: SESSION.user }, error: null });
    ctl.profile = async () => {
      throw new AuthTimeoutError(10_000);
    };

    await mount();
    expect(screen.getByTestId("session").textContent).toBe("session");
    expect(screen.getByTestId("user").textContent).toBe("user@example.com");
    expect(screen.getByTestId("status").textContent).toBe("auth-error");
  });

  test("whenever a session exists the user object exists too", async () => {
    // This invariant is what stops AuthGate bouncing to /login mid-load.
    ctl.getSession = async () => ({ data: { session: SESSION }, error: null });
    ctl.getUser = async () => ({ data: { user: SESSION.user }, error: null });
    await mount();
    expect(screen.getByTestId("session").textContent).toBe("session");
    expect(screen.getByTestId("user").textContent).not.toBe("anon");
  });
});
