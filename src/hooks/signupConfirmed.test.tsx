import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "../i18n/en";
import { ro } from "../i18n/ro";

/**
 * Success feedback for a confirmed signup, driven by the AUTH STATE.
 *
 * auth-js reports a confirmed signup as a plain SIGNED_IN — byte-identical to a
 * password login (`_initialize` uses `redirectType` only to pick between
 * PASSWORD_RECOVERY and SIGNED_IN, and never forwards it). So the event stream
 * alone cannot tell the two apart, and the announcement is gated on BOTH a real
 * session and the fragment captured before auth-js consumed it.
 *
 * These tests drive the real composition: LocaleProvider → AuthProvider →
 * AuthLinkNotice, with only the transport (`utils/supabaseClient`) mocked. The
 * session arrives the way production delivers it — through onAuthStateChange —
 * rather than being handed to the component.
 */

type Leaves = Record<string, Record<string, string>>;
const EN = (en as unknown as Leaves).auth;
const RO = (ro as unknown as Leaves).auth;

const SIGNUP_SUCCESS = "#access_token=REDACTED&refresh_token=REDACTED&type=signup";

/**
 * Delivery modelled on auth-js, not invented.
 *
 * `_initialize` calls `_saveSession(session)` and only THEN notifies subscribers,
 * so by the time SIGNED_IN arrives `getSession()` already answers with that
 * session. An emitter that fires SIGNED_IN while `getSession()` still resolves
 * null would let the provider's own startup lookup overwrite the session a
 * moment later — a race production does not have.
 */
const { emit } = vi.hoisted(() => {
  const handlers: Array<(event: string, session: unknown) => void> = [];
  let current: unknown = null;
  return {
    emit: {
      handlers,
      reset() {
        handlers.length = 0;
        current = null;
      },
      currentSession: () => current,
      /** Save first, notify second — the order auth-js uses. */
      fire(event: string, session: unknown) {
        if (session !== undefined) current = session;
        for (const handler of handlers) handler(event, session);
      }
    }
  };
});

vi.mock("../utils/supabaseClient", () => ({
  isSupabaseConfigured: true,
  readPersistedSession: () => null,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: emit.currentSession() }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      resend: vi.fn(async () => ({ data: {}, error: null })),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        emit.handlers.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      }
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
    })
  }
}));

const sessionFor = (token: string) => ({
  access_token: token,
  user: { id: "u1", email: "new@example.com", user_metadata: {} }
});

/** Fresh module graph so the load-time snapshot sees the fragment we just set. */
async function mountWith(hash: string, locale: "ro" | "en" = "ro") {
  localStorage.setItem("footy:locale", locale);
  window.history.replaceState({}, "", `/${hash}`);
  vi.resetModules();
  const [{ default: AuthLinkNotice }, { LocaleProvider }, { AuthProvider }] = await Promise.all([
    import("../components/AuthLinkNotice"),
    import("../context/LocaleContext"),
    import("./useAuth")
  ]);
  render(
    <LocaleProvider>
      <AuthProvider>
        <AuthLinkNotice />
      </AuthProvider>
    </LocaleProvider>
  );
  /*
    Let the provider's own startup getSession() settle before any event is fired.
    Without this the notification races that lookup and the null it resolves with
    lands last, wiping the session — an artefact of the harness, not of the app.
  */
  await act(async () => {
    await Promise.resolve();
  });
}

const confirmedLine = () => document.querySelector("[data-slot='auth-confirmed']");
const notice = () => document.querySelector("[data-slot='auth-link-notice']");
const occurrences = (needle: string) => (document.body.textContent || "").split(needle).length - 1;

beforeEach(() => {
  // No session yet: production establishes it asynchronously, after _getUser.
  emit.reset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("successful signup confirmation", () => {
  it("[1][3] announces success once the session lands, after auth-js has cleared the hash", async () => {
    await mountWith(SIGNUP_SUCCESS);
    // Nothing yet — a fragment alone must not congratulate anyone.
    expect(confirmedLine()).toBeNull();

    // auth-js clears the hash, THEN notifies. Reproduce that exact order.
    window.history.replaceState({}, "", "/");
    await act(async () => emit.fire("SIGNED_IN", sessionFor("token-A")));

    await waitFor(() => expect(confirmedLine()).toBeTruthy());
    expect(document.body.textContent).toContain(RO.signupConfirmedTitle);
  });

  it("[4][5] stays at exactly one message across repeated auth-state updates", async () => {
    await mountWith(SIGNUP_SUCCESS);
    window.history.replaceState({}, "", "/");
    await act(async () => emit.fire("SIGNED_IN", sessionFor("token-A")));
    await waitFor(() => expect(confirmedLine()).toBeTruthy());

    // Token refresh, a re-emitted SIGNED_IN, profile hydration — the churn that
    // used to re-fire the old hash-based branch on every lastAuthEvent change.
    await act(async () => {
      emit.fire("TOKEN_REFRESHED", sessionFor("token-B"));
      emit.fire("SIGNED_IN", sessionFor("token-B"));
      emit.fire("TOKEN_REFRESHED", sessionFor("token-C"));
    });

    await waitFor(() => expect(occurrences(RO.signupConfirmedTitle)).toBe(1));
    expect(document.querySelectorAll("[data-slot='auth-confirmed']")).toHaveLength(1);
  });

  it("[6] a reload does not redisplay it, because the fragment is gone", async () => {
    await mountWith(SIGNUP_SUCCESS);
    await act(async () => emit.fire("SIGNED_IN", sessionFor("token-A")));
    await waitFor(() => expect(confirmedLine()).toBeTruthy());
    cleanup();

    // Reload: fresh modules, but auth-js already stripped the fragment.
    await mountWith("");
    await act(async () => emit.fire("SIGNED_IN", sessionFor("token-A")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmedLine()).toBeNull();
  });
});

describe("[2][11] normal login is not a signup confirmation", () => {
  it("says nothing when a session arrives with no fragment", async () => {
    await mountWith("");
    await act(async () => emit.fire("SIGNED_IN", sessionFor("token-A")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmedLine()).toBeNull();
    expect(notice()).toBeNull();
    expect(document.body.textContent).not.toContain(RO.signupConfirmedTitle);
  });

  it("says nothing for a recovery link, even though it carries a session", async () => {
    await mountWith("#access_token=REDACTED&type=recovery");
    await act(async () => emit.fire("SIGNED_IN", sessionFor("token-A")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmedLine()).toBeNull();
  });
});

describe("[7] the expired-link flow from #175 is untouched", () => {
  const EXPIRED =
    "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

  it("still shows the expired message and the resend button", async () => {
    await mountWith(EXPIRED);
    expect(notice()).toBeTruthy();
    expect(document.body.textContent).toContain(RO.linkExpiredTitle);
    expect(document.querySelector("[data-slot='auth-link-notice-resend']")).toBeTruthy();
    // And never the success copy.
    expect(confirmedLine()).toBeNull();
    expect(document.body.textContent).not.toContain(RO.signupConfirmedTitle);
  });

  it("a session arriving later cannot turn a failed confirmation into a success", async () => {
    await mountWith(EXPIRED);
    await act(async () => emit.fire("SIGNED_IN", sessionFor("token-A")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmedLine()).toBeNull();
    expect(document.body.textContent).toContain(RO.linkExpiredTitle);
  });
});

describe("i18n", () => {
  it("[9] Romanian", async () => {
    await mountWith(SIGNUP_SUCCESS, "ro");
    await act(async () => emit.fire("SIGNED_IN", sessionFor("token-A")));
    await waitFor(() => expect(document.body.textContent).toContain(RO.signupConfirmedTitle));
    expect(document.body.textContent).toContain(RO.signupConfirmedBody);
  });

  it("[10] English", async () => {
    await mountWith(SIGNUP_SUCCESS, "en");
    await act(async () => emit.fire("SIGNED_IN", sessionFor("token-A")));
    await waitFor(() => expect(document.body.textContent).toContain(EN.signupConfirmedTitle));
    expect(document.body.textContent).toContain(EN.signupConfirmedBody);
  });

  it("both catalogues define the success copy, in their own language", () => {
    for (const key of ["signupConfirmedTitle", "signupConfirmedBody"] as const) {
      expect(RO[key], `ro.auth.${key}`).toBeTruthy();
      expect(EN[key], `en.auth.${key}`).toBeTruthy();
      expect(RO[key]).not.toBe(EN[key]);
    }
  });
});
