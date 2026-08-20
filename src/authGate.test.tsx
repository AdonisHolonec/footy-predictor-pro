import { Suspense, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
  user: null as { email: string; role: string; isBlocked: boolean } | null,
  session: null as { access_token: string } | null,
  loading: false,
  authStatus: "unresolved" as string
};

vi.mock("./hooks/useAuth", () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: ReactNode }) => children
}));

vi.mock("./pages/UserDashboard", () => ({ default: () => <div data-testid="dash">workspace</div> }));
vi.mock("./pages/AdminDashboard", () => ({ default: () => <div data-testid="admin">admin</div> }));

import { AuthGate } from "./RootRouter";

function renderGate() {
  return render(
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

function setState(next: Partial<typeof authState>) {
  Object.assign(authState, { user: null, session: null, loading: false, authStatus: "unresolved" }, next);
}

const USER = { email: "user@example.com", role: "user", isBlocked: false };
const SESSION = { access_token: "token-A" };

afterEach(cleanup);

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
