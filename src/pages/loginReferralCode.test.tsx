import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LocaleProvider } from "../context/LocaleContext";
import { AuthProvider } from "../hooks/useAuth";
import { en } from "../i18n/en";
import { ro } from "../i18n/ro";
import ReferralInviteDialog from "../components/ux/ReferralInviteDialog";
import { usePostLoginReferralInvite } from "./userDashboard/usePostLoginReferralInvite";
import { REFERRAL_STORAGE_KEY, readPendingReferral } from "../utils/referralLink";
import Login from "./Login";

/**
 * The manual referral code at signup.
 *
 * A friend can send the CODE rather than the link. This pins that the code is an
 * optional field of the signup form only, that a valid code goes into the SAME
 * pending referral the link uses (normalised, through the link's own capture
 * path), that nothing is claimed before there is a signed-in user, that an
 * invalid code blocks the submit until fixed or removed, how a code already
 * captured from a link is handled, and that the stored code is exactly what
 * PR #246's post-login invitation then picks up.
 *
 * Real composition: LocaleProvider -> AuthProvider -> Login, with only the
 * Supabase transport mocked, as loginResendConfirmation.test.tsx does.
 */

type Leaves = Record<string, Record<string, string>>;
const EN = (en as unknown as Leaves).auth;
const RO = (ro as unknown as Leaves).auth;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (key: string) => new RegExp(`^(${esc(EN[key])}|${esc(RO[key])})$`);

const { signUpSpy, signInSpy, fetchStatusSpy, claimSpy } = vi.hoisted(() => ({
  signUpSpy: vi.fn(),
  signInSpy: vi.fn(),
  fetchStatusSpy: vi.fn(),
  claimSpy: vi.fn()
}));

vi.mock("../utils/supabaseClient", () => ({
  isSupabaseConfigured: true,
  readPersistedSession: () => null,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: signInSpy,
      signUp: signUpSpy
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
    })
  }
}));

vi.mock("../services/referralService", async () => {
  const actual = await vi.importActual<typeof import("../services/referralService")>("../services/referralService");
  return {
    ...actual,
    fetchReferralStatus: (...args: unknown[]) => fetchStatusSpy(...args),
    claimReferral: (...args: unknown[]) => claimSpy(...args)
  };
});

const CODE = "ABCD234567";
const OTHER = "ZZZZ234567";
const EMAIL = "new@example.com";
const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const src = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

function mount(path = "/login?mode=signup") {
  localStorage.setItem("footy:locale", "ro");
  render(
    <LocaleProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    </LocaleProvider>
  );
}

const storePending = (code = CODE, capturedAt = NOW) =>
  localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify({ code, capturedAt }));
const stored = () => localStorage.getItem(REFERRAL_STORAGE_KEY);
const field = () => document.querySelector('[data-slot="login-referral-code"]') as HTMLInputElement | null;
const hint = () => document.querySelector('[data-slot="login-referral-hint"]')?.textContent ?? "";

function fillBasics() {
  fireEvent.change(document.querySelector('input[type="email"]') as HTMLInputElement, { target: { value: EMAIL } });
  fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
    target: { value: "secret123" }
  });
  fireEvent.click(document.querySelector('input[type="checkbox"]') as HTMLInputElement);
}
const submit = () => fireEvent.submit(document.querySelector("form") as HTMLFormElement);

/*
  jsdom implements no `matchMedia`, and Login reads it for the
  prefers-reduced-motion parallax — the same environment gap
  loginResendConfirmation.test.tsx stubs, stubbed the same way.
*/
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    })
  });
  vi.clearAllMocks();
  localStorage.clear();
  signUpSpy.mockResolvedValue({ data: { user: null, session: null }, error: null });
  signInSpy.mockResolvedValue({ data: { user: null, session: null }, error: null });
  fetchStatusSpy.mockResolvedValue({ hasReferralCode: false, code: null, inviter: {}, invitee: null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("where the field appears", () => {
  it("is in the signup form, labelled as optional, with its own hint", () => {
    mount();
    const input = field();
    expect(input).not.toBeNull();
    expect(screen.getByLabelText(either("referralCodeLabel"))).toBe(input);
    expect(input!.getAttribute("aria-describedby")).toBe("login-referral-hint");
    expect(hint()).toMatch(either("referralCodeHint"));
  });

  it("is not in the login form", () => {
    mount("/login");
    expect(field()).toBeNull();
  });

  it("appears when switching from login to signup", () => {
    mount("/login");
    fireEvent.click(screen.getByRole("button", { name: either("noAccount") }));
    expect(field()).not.toBeNull();
  });
});

describe("signing up", () => {
  it("empty: signup is unchanged, nothing is stored, nothing is claimed", async () => {
    mount();
    fillBasics();
    submit();
    await waitFor(() => expect(signUpSpy).toHaveBeenCalledTimes(1));
    expect(signUpSpy.mock.calls[0][0]).toMatchObject({ email: EMAIL, password: "secret123" });
    expect(stored()).toBeNull();
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it("a valid code, typed lowercase with whitespace, is normalised into the pending referral; signup proceeds; nothing is claimed", async () => {
    mount();
    fillBasics();
    fireEvent.change(field()!, { target: { value: "  abcd234567 \n" } });
    submit();
    await waitFor(() => expect(signUpSpy).toHaveBeenCalledTimes(1));
    expect(readPendingReferral()?.code).toBe(CODE);
    expect(claimSpy).not.toHaveBeenCalled();
    const fetchCalls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0])
    );
    expect(fetchCalls.some((u) => u.includes("/api/referral"))).toBe(false);
    expect(await screen.findByText(either("signupSuccessMsg"))).toBeTruthy();
  });

  it("an invalid code is refused before anything is sent, explained, and not stored; fixing it lets signup proceed", async () => {
    mount();
    fillBasics();
    fireEvent.change(field()!, { target: { value: "not-a-code" } });
    submit();
    await act(async () => {});
    expect(signUpSpy).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
    const error = screen.getByRole("alert");
    expect(error.textContent).toMatch(either("referralCodeInvalidMsg"));
    expect(field()!.getAttribute("aria-invalid")).toBe("true");
    expect(field()!.getAttribute("aria-describedby")).toBe("login-referral-error");

    fireEvent.change(field()!, { target: { value: CODE } });
    expect(screen.queryByRole("alert")).toBeNull();
    submit();
    await waitFor(() => expect(signUpSpy).toHaveBeenCalledTimes(1));
    expect(readPendingReferral()?.code).toBe(CODE);
  });

  it("removing an invalid code also lets signup proceed, with nothing stored", async () => {
    mount();
    fillBasics();
    fireEvent.change(field()!, { target: { value: "???" } });
    submit();
    await act(async () => {});
    expect(signUpSpy).not.toHaveBeenCalled();
    fireEvent.change(field()!, { target: { value: "" } });
    submit();
    await waitFor(() => expect(signUpSpy).toHaveBeenCalledTimes(1));
    expect(stored()).toBeNull();
  });

  it("a signup that fails leaves the stored code for the retry", async () => {
    signUpSpy.mockResolvedValue({ data: { user: null, session: null }, error: new Error("User already registered") });
    mount();
    fillBasics();
    fireEvent.change(field()!, { target: { value: CODE } });
    submit();
    await waitFor(() => expect(signUpSpy).toHaveBeenCalledTimes(1));
    expect(readPendingReferral()?.code).toBe(CODE);
  });
});

describe("a code already captured from an invitation link", () => {
  it("is shown pre-filled, with the from-link hint, and the same code submits without duplicating state", async () => {
    storePending();
    mount();
    expect(field()!.value).toBe(CODE);
    expect(hint()).toMatch(either("referralCodeFromLink"));
    fillBasics();
    submit();
    await waitFor(() => expect(signUpSpy).toHaveBeenCalledTimes(1));
    const entry = JSON.parse(stored() as string) as { code: string; capturedAt: number };
    expect(entry.code).toBe(CODE);
    expect(entry.capturedAt).toBe(NOW);
  });

  it("typing a different code says it will replace the link's code, and the submit replaces it explicitly", async () => {
    storePending();
    mount();
    fireEvent.change(field()!, { target: { value: OTHER } });
    expect(hint()).toMatch(either("referralCodeReplaces"));
    fillBasics();
    submit();
    await waitFor(() => expect(signUpSpy).toHaveBeenCalledTimes(1));
    expect(readPendingReferral()?.code).toBe(OTHER);
    expect(Object.keys(localStorage).filter((k) => k.startsWith("footy.referral"))).toEqual([REFERRAL_STORAGE_KEY]);
  });

  it("clearing the pre-filled code keeps the link's code pending", async () => {
    storePending();
    mount();
    fireEvent.change(field()!, { target: { value: "" } });
    fillBasics();
    submit();
    await waitFor(() => expect(signUpSpy).toHaveBeenCalledTimes(1));
    expect(readPendingReferral()?.code).toBe(CODE);
  });
});

describe("convergence with the post-login invitation (PR #246)", () => {
  function Invite({ userId, token }: { userId: string; token: string }) {
    const invite = usePostLoginReferralInvite({ userId, accessToken: token, now: NOW });
    return (
      <ReferralInviteDialog
        open={invite.open}
        claiming={invite.claiming}
        error={invite.error}
        canAccept={invite.pendingCode !== null}
        onAccept={() => void invite.accept()}
        onDecline={invite.dismiss}
      />
    );
  }

  it("the code stored at signup is exactly what the post-login invitation finds, and the claim still waits for the user", async () => {
    mount();
    fillBasics();
    fireEvent.change(field()!, { target: { value: CODE.toLowerCase() } });
    submit();
    await waitFor(() => expect(signUpSpy).toHaveBeenCalledTimes(1));
    cleanup();

    // The user confirms their email and signs in on the same browser: the
    // workspace mounts, the existing hook reads the same storage entry.
    render(
      <LocaleProvider>
        <Invite userId="user-b" token="token-b" />
      </LocaleProvider>
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(fetchStatusSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("ordinary login is untouched", () => {
  it("signs in with email and password, stores nothing, shows no referral field", async () => {
    mount("/login");
    fireEvent.change(document.querySelector('input[type="email"]') as HTMLInputElement, { target: { value: EMAIL } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: "secret123" }
    });
    submit();
    await waitFor(() => expect(signInSpy).toHaveBeenCalledTimes(1));
    expect(field()).toBeNull();
    expect(stored()).toBeNull();
  });
});

describe("the wiring that ships", () => {
  it("the form stores through the link's own capture path and never claims", () => {
    const login = src("pages/Login.tsx");
    expect(login).toMatch(/capturePendingReferral\(`\?ref=\$\{encodeURIComponent\(code\)\}`\)/);
    expect(login).not.toMatch(/claimReferral|\/api\/referral|localStorage\.setItem/);
    expect(src("hooks/useAuth.ts")).not.toMatch(/referral/i);
  });
});
