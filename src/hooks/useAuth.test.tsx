import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `useAuth` used to be a plain hook, so each of its seven consumers built its
 * own state, its own `getSession()` and its own `onAuthStateChange`
 * subscription. Three mount together on /workspace, which is how one
 * activation journey issued 9-11 POSTs to
 * /api/fixtures?syncBootstrapAdmin=1 — every one a 403.
 *
 * These tests pin the two guarantees that fixed it: one lifecycle for all
 * consumers, and one bootstrap-admin ask per access token.
 */

const authStateHandlers: Array<(event: string, session: unknown) => void> = [];
let subscribeCount = 0;
let getSessionCount = 0;
let currentToken = "token-A";

function sessionFor(token: string) {
  return { access_token: token, user: { id: "u1", email: "user@example.com", user_metadata: {} } };
}

vi.mock("../utils/supabaseClient", () => ({
  isSupabaseConfigured: true,
  /*
    A real sign-out purges the stored record, so this returns null: the listener
    reads storage to tell a genuine sign-out from a transient null-session event,
    and these tests exercise the genuine one.
  */
  readPersistedSession: () => null,
  supabase: {
    auth: {
      getSession: vi.fn(async () => {
        getSessionCount += 1;
        return { data: { session: sessionFor(currentToken) }, error: null };
      }),
      getUser: vi.fn(async () => ({ data: { user: sessionFor(currentToken).user }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: sessionFor(currentToken) }, error: null })),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        subscribeCount += 1;
        authStateHandlers.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      }
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          // A plain consumer: role "user" is exactly the promotion candidate.
          maybeSingle: async () => ({ data: { user_id: "u1", role: "user", favorite_leagues: [] }, error: null })
        })
      })
    })
  }
}));

import { AuthProvider, useAuth } from "./useAuth";

/** Renders the shared state so a test can compare what each consumer sees. */
function Consumer({ id }: { id: string }) {
  const { user, loading } = useAuth();
  return <div data-testid={id}>{loading ? "loading" : (user?.email ?? "anon")}</div>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  authStateHandlers.length = 0;
  subscribeCount = 0;
  getSessionCount = 0;
  currentToken = "token-A";
  fetchMock = vi.fn(async () => ({
    ok: false,
    status: 403,
    json: async () => ({ ok: false, error: "Emailul nu este in lista ADMIN_EMAILS." })
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** POSTs to the bootstrap-admin endpoint, whatever else the app fetched. */
function bootstrapCalls(): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes("syncBootstrapAdmin")).length;
}

describe("AuthProvider shares one lifecycle", () => {
  it("runs one session lookup and one subscription for many consumers", async () => {
    render(
      <AuthProvider>
        <Consumer id="a" />
        <Consumer id="b" />
        <Consumer id="c" />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("a").textContent).not.toBe("loading"));

    // The regression: three consumers used to mean three of each.
    expect(subscribeCount, "one Supabase auth subscription for the whole app").toBe(1);
    expect(getSessionCount, "session resolved once, not once per consumer").toBeLessThanOrEqual(2);
  });

  it("gives every consumer the same auth state", async () => {
    render(
      <AuthProvider>
        <Consumer id="a" />
        <Consumer id="b" />
        <Consumer id="c" />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("a").textContent).not.toBe("loading"));
    const seen = ["a", "b", "c"].map((id) => screen.getByTestId(id).textContent);
    expect(new Set(seen).size, `consumers disagreed: ${JSON.stringify(seen)}`).toBe(1);
    expect(seen[0]).toBe("user@example.com");
  });

  it("fails loudly outside the provider instead of reading a logged-out shape", () => {
    // Silently returning "anon" would bounce a signed-in user to /login.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer id="orphan" />)).toThrow(/AuthProvider/);
    quiet.mockRestore();
  });
});

describe("bootstrap-admin ask is memoised per access token", () => {
  it("asks once per token, and again only when the token changes", async () => {
    render(
      <AuthProvider>
        <Consumer id="a" />
      </AuthProvider>
    );
    await waitFor(() => expect(bootstrapCalls()).toBe(1));

    // Same token, more auth events: SIGNED_IN and TOKEN_REFRESHED both reach
    // promoteBootstrapAdminInDb, and both used to POST again.
    authStateHandlers.forEach((cb) => cb("SIGNED_IN", sessionFor("token-A")));
    authStateHandlers.forEach((cb) => cb("TOKEN_REFRESHED", sessionFor("token-A")));
    await new Promise((r) => setTimeout(r, 40));
    expect(bootstrapCalls(), "same token must not be re-asked").toBe(1);

    // A new token is a new question: the allowlist is keyed on its email.
    currentToken = "token-B";
    authStateHandlers.forEach((cb) => cb("TOKEN_REFRESHED", sessionFor("token-B")));
    await waitFor(() => expect(bootstrapCalls()).toBe(2));

    authStateHandlers.forEach((cb) => cb("TOKEN_REFRESHED", sessionFor("token-B")));
    await new Promise((r) => setTimeout(r, 40));
    expect(bootstrapCalls(), "token B must not be re-asked either").toBe(2);

    // Back to an already-asked token: still no new request.
    authStateHandlers.forEach((cb) => cb("TOKEN_REFRESHED", sessionFor("token-A")));
    await new Promise((r) => setTimeout(r, 40));
    expect(bootstrapCalls(), "returning to token A must stay memoised").toBe(2);
  });

  it("lets the next session through after a sign-out", async () => {
    render(
      <AuthProvider>
        <Consumer id="a" />
      </AuthProvider>
    );
    await waitFor(() => expect(bootstrapCalls()).toBe(1));

    authStateHandlers.forEach((cb) => cb("SIGNED_OUT", null));
    await new Promise((r) => setTimeout(r, 20));

    // Memoising by user id would strand this sign-in; keying on the token
    // cannot, because a fresh sign-in mints a fresh one.
    currentToken = "token-C";
    authStateHandlers.forEach((cb) => cb("SIGNED_IN", sessionFor("token-C")));
    await waitFor(() => expect(bootstrapCalls()).toBe(2));
  });

  it("retries after a thrown request, since nothing was decided", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });

    render(
      <AuthProvider>
        <Consumer id="a" />
      </AuthProvider>
    );
    await waitFor(() => expect(bootstrapCalls()).toBe(1));

    // A 403 is an answer and is memoised; a throw is not an answer, so the
    // token is released and a later path may ask again.
    authStateHandlers.forEach((cb) => cb("TOKEN_REFRESHED", sessionFor("token-A")));
    await waitFor(() => expect(bootstrapCalls()).toBe(2));
  });
});
