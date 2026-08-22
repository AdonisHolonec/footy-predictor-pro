import { Suspense, useEffect, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * Who gets sent to /login.
 *
 * `!user` used to mean "unresolved", "no session", "profile still loading" and
 * "the auth request failed" all at once, and this gate read every one of them as
 * "signed out". In production a 503 on getUser() therefore bounced a user with a
 * valid, unexpired session to /login — which bounced back to /workspace as soon
 * as state recovered, the loop that was actually observed.
 *
 * The rule under test: a session is the authority on being signed in; a missing
 * profile is a degraded session, not an anonymous one.
 */

const authState = {
  user: null as { id?: string; email: string; role: string; isBlocked: boolean; tier?: string } | null,
  session: null as { access_token: string } | null,
  loading: false,
  authStatus: "unresolved" as string
};

vi.mock("./hooks/useAuth", () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: ReactNode }) => children
}));

/** Mount counters: the admin loop was a REMOUNT loop, so mounts are what the tests count. */
const mounts = vi.hoisted(() => ({ dash: 0, admin: 0 }));

vi.mock("./pages/UserDashboard", () => {
  function UserDashboardMock() {
    useEffect(() => {
      mounts.dash += 1;
    }, []);
    return <div data-testid="dash">workspace</div>;
  }
  return { default: UserDashboardMock };
});
vi.mock("./pages/AdminDashboard", () => {
  function AdminDashboardMock() {
    useEffect(() => {
      mounts.admin += 1;
    }, []);
    return <div data-testid="admin">admin</div>;
  }
  return { default: AdminDashboardMock };
});

import { AuthGate } from "./RootRouter";

function gateTree() {
  return (
    <MemoryRouter initialEntries={["/workspace"]}>
      {/* The dashboards are lazy(), exactly as RootRouter loads them. */}
      <Suspense fallback={<div data-testid="suspense">loading</div>}>
        <Routes>
          <Route path="/workspace" element={<AuthGate />} />
          <Route path="/login" element={<div data-testid="login">login page</div>} />
        </Routes>
      </Suspense>
    </MemoryRouter>
  );
}

function renderGate() {
  return render(gateTree());
}

function setState(next: Partial<typeof authState>) {
  Object.assign(authState, { user: null, session: null, loading: false, authStatus: "unresolved" }, next);
}

const USER = { id: "u-1", email: "user@example.com", role: "user", isBlocked: false };
const ADMIN = { ...USER, role: "admin" };
const SESSION = { access_token: "token-A" };

afterEach(() => {
  cleanup();
  mounts.dash = 0;
  mounts.admin = 0;
});

describe("AuthGate", () => {
  test("a confirmed absent session still goes to /login", () => {
    setState({ authStatus: "no-session" });
    renderGate();
    expect(screen.getByTestId("login")).toBeTruthy();
  });

  test("an unresolved state waits instead of guessing", () => {
    setState({ authStatus: "unresolved", loading: true });
    renderGate();
    expect(screen.queryByTestId("login")).toBeNull();
    expect(screen.queryByTestId("dash")).toBeNull();
  });

  test("an unresolved status waits even once the loading flag has cleared", () => {
    /*
      The distinguishing case: `loading` is false but nothing has been decided
      yet. Treating that as "signed out" is exactly the bug — it redirects before
      the session has had a chance to appear.
    */
    setState({ authStatus: "unresolved", loading: false, session: null, user: null });
    renderGate();
    expect(screen.queryByTestId("login")).toBeNull();
    expect(screen.queryByTestId("dash")).toBeNull();
  });

  test("a valid session whose profile is still loading does NOT go to /login", async () => {
    setState({ session: SESSION, user: USER, authStatus: "profile-pending" });
    renderGate();
    expect(screen.queryByTestId("login")).toBeNull();
    expect(await screen.findByTestId("dash")).toBeTruthy();
  });

  test("a valid session whose profile FAILED does NOT go to /login", async () => {
    // The production case: 503 on getUser, session still valid in storage.
    setState({ session: SESSION, user: USER, authStatus: "auth-error" });
    renderGate();
    expect(screen.queryByTestId("login")).toBeNull();
    expect(await screen.findByTestId("dash")).toBeTruthy();
  });

  test("a session present but no user object yet holds, rather than redirecting", () => {
    setState({ session: SESSION, user: null, authStatus: "profile-pending" });
    renderGate();
    expect(screen.queryByTestId("login")).toBeNull();
    expect(screen.queryByTestId("dash")).toBeNull();
  });

  test("a fully authenticated user reaches the workspace", async () => {
    setState({ session: SESSION, user: USER, authStatus: "authenticated" });
    renderGate();
    expect(await screen.findByTestId("dash")).toBeTruthy();
  });

  test("a blocked account is still blocked", () => {
    setState({ session: SESSION, user: { ...USER, isBlocked: true }, authStatus: "authenticated" });
    renderGate();
    expect(screen.queryByTestId("dash")).toBeNull();
    expect(screen.queryByTestId("login")).toBeNull();
  });

  test("an admin still reaches the admin dashboard", async () => {
    setState({ session: SESSION, user: { ...USER, role: "admin" }, authStatus: "authenticated" });
    renderGate();
    expect(await screen.findByTestId("admin")).toBeTruthy();
  });
});

/**
 * Admin <-> Today loop.
 *
 * useAuth publishes a placeholder user (role "user", authStatus
 * "profile-pending") before every profile read - on login and on every later
 * getSession(). AdminDashboard's mount-time favourite-leagues save calls
 * getSession(), so reading that placeholder as a demotion remounted the two
 * dashboards against each other indefinitely. The gate must hold the last
 * RESOLVED tree through a pending/failed profile and switch once on a real
 * role change.
 */
describe("AuthGate - placeholder role is not authoritative", () => {
  /** Drive the gate through a sequence of auth states with one mounted tree. */
  async function sequence(states: Array<Partial<typeof authState>>) {
    setState(states[0]);
    const utils = renderGate();
    for (const next of states.slice(1)) {
      setState(next);
      await act(async () => {
        utils.rerender(gateTree());
      });
    }
    return utils;
  }

  const adminResolved = { session: SESSION, user: ADMIN, authStatus: "authenticated" };
  const adminPlaceholder = { session: SESSION, user: { ...ADMIN, role: "user" }, authStatus: "profile-pending" };
  const userResolved = { session: SESSION, user: USER, authStatus: "authenticated" };
  const userPlaceholder = { session: SESSION, user: USER, authStatus: "profile-pending" };

  test("3/4/5. admin -> placeholder -> admin keeps AdminDashboard mounted once, UserDashboard never mounts", async () => {
    await sequence([adminResolved, adminPlaceholder, adminResolved, adminPlaceholder, adminResolved]);
    expect(await screen.findByTestId("admin")).toBeTruthy();
    expect(screen.queryByTestId("dash")).toBeNull();
    expect(mounts.admin).toBe(1);
    expect(mounts.dash).toBe(0);
  });

  test("6. user -> placeholder -> user keeps UserDashboard mounted once", async () => {
    await sequence([userResolved, userPlaceholder, userResolved]);
    expect(await screen.findByTestId("dash")).toBeTruthy();
    expect(mounts.dash).toBe(1);
    expect(mounts.admin).toBe(0);
  });

  test("7. a resolved admin -> user demotion switches exactly once", async () => {
    // ONE resolved publish must be enough: the switch happens on that render, not a later one.
    await sequence([adminResolved, userResolved]);
    expect(await screen.findByTestId("dash")).toBeTruthy();
    expect(screen.queryByTestId("admin")).toBeNull();
    expect(mounts.admin).toBe(1);
    expect(mounts.dash).toBe(1);
  });

  test("8/11. a resolved user -> admin promotion (bootstrap admin) switches exactly once", async () => {
    const utils = await sequence([userResolved, { ...userResolved, authStatus: "profile-pending" }, adminResolved]);
    expect(await screen.findByTestId("admin")).toBeTruthy();
    expect(screen.queryByTestId("dash")).toBeNull();
    for (const next of [adminPlaceholder, adminResolved]) {
      setState(next);
      await act(async () => {
        utils.rerender(gateTree());
      });
    }
    expect(mounts.dash).toBe(1);
    expect(mounts.admin).toBe(1);
  });

  test("9. profile-pending with no prior resolved role uses the published role - never guesses admin", async () => {
    await sequence([adminPlaceholder]);
    expect(await screen.findByTestId("dash")).toBeTruthy();
    expect(screen.queryByTestId("admin")).toBeNull();
  });

  test("10. an ultra non-admin is a user", async () => {
    await sequence([{ session: SESSION, user: { ...USER, tier: "ultra" }, authStatus: "authenticated" }]);
    expect(await screen.findByTestId("dash")).toBeTruthy();
    expect(screen.queryByTestId("admin")).toBeNull();
  });

  test("12. reload: pending placeholder then resolved admin mounts AdminDashboard once", async () => {
    await sequence([{ session: SESSION, user: null, authStatus: "profile-pending" }, adminResolved, adminPlaceholder, adminResolved]);
    expect(await screen.findByTestId("admin")).toBeTruthy();
    expect(mounts.admin).toBe(1);
    expect(mounts.dash).toBe(0);
  });

  test("15. the getSession() placeholder repeated many times never alternates the tree", async () => {
    const states: Array<Partial<typeof authState>> = [adminResolved];
    for (let i = 0; i < 6; i += 1) states.push(adminPlaceholder, adminResolved);
    await sequence(states);
    expect(mounts.admin).toBe(1);
    expect(mounts.dash).toBe(0);
  });

  test("16. a profile read failure after a resolved admin holds the admin tree (stable, not alternating)", async () => {
    await sequence([adminResolved, { session: SESSION, user: { ...ADMIN, role: "user" }, authStatus: "auth-error" }, adminResolved]);
    expect(await screen.findByTestId("admin")).toBeTruthy();
    expect(mounts.admin).toBe(1);
    expect(mounts.dash).toBe(0);
  });

  test("16b. a profile read failure on first load is a stable user tree", async () => {
    await sequence([{ session: SESSION, user: { ...ADMIN, role: "user" }, authStatus: "auth-error" }]);
    expect(await screen.findByTestId("dash")).toBeTruthy();
    expect(mounts.dash).toBe(1);
  });

  test("a different user id never inherits the previous remembered role", async () => {
    await sequence([
      adminResolved,
      // Account switch: the user object is gone for a moment, then a different id arrives unresolved.
      { session: SESSION, user: null, authStatus: "profile-pending" },
      { session: SESSION, user: { ...USER, id: "u-2" }, authStatus: "profile-pending" }
    ]);
    expect(await screen.findByTestId("dash")).toBeTruthy();
    expect(screen.queryByTestId("admin")).toBeNull();
  });

  test("an account switch without an intermediate null user never inherits the previous role", async () => {
    await sequence([adminResolved, { session: SESSION, user: { ...USER, id: "u-2" }, authStatus: "profile-pending" }]);
    expect(await screen.findByTestId("dash")).toBeTruthy();
    expect(screen.queryByTestId("admin")).toBeNull();
  });

  test("only the literal admin role opens AdminDashboard - any other resolved role is a user", async () => {
    for (const role of ["moderator", "editor", "ADMIN", ""]) {
      cleanup();
      mounts.dash = 0;
      mounts.admin = 0;
      await sequence([{ session: SESSION, user: { ...USER, role }, authStatus: "authenticated" }]);
      expect(await screen.findByTestId("dash"), role).toBeTruthy();
      expect(screen.queryByTestId("admin"), role).toBeNull();
    }
  });

  test("a resolved blocked admin is still blocked", async () => {
    await sequence([adminResolved, { session: SESSION, user: { ...ADMIN, isBlocked: true }, authStatus: "authenticated" }]);
    expect(screen.queryByTestId("admin")).toBeNull();
    expect(screen.queryByTestId("dash")).toBeNull();
  });
});
