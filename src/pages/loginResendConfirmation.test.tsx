import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../context/LocaleContext";
import { AuthProvider } from "../hooks/useAuth";
import { en } from "../i18n/en";
import { ro } from "../i18n/ro";
import Login from "./Login";

/**
 * The gap this closes: a user who never confirmed could log in, be told
 * "Email not confirmed" — raw English, in a Romanian UI, indistinguishable from
 * a wrong password — with no way forward except finding the old email and
 * clicking a link that had already expired.
 *
 * Real composition: LocaleProvider -> AuthProvider -> Login, with only the
 * transport mocked, so the classifier, the shared resend and the cooldown are
 * all the production ones.
 */

type Leaves = Record<string, Record<string, string>>;
const EN = (en as unknown as Leaves).auth;
const RO = (ro as unknown as Leaves).auth;

const { signInSpy, resendSpy } = vi.hoisted(() => ({
  signInSpy: vi.fn(),
  resendSpy: vi.fn()
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
      resend: resendSpy
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
    })
  }
}));

/**
 * A faithful `AuthApiError`: auth-js subclasses Error, so `instanceof Error` is
 * TRUE in production. A plain object here would let a raw-message fallback pass
 * the test while still leaking English to real users.
 */
class FakeAuthApiError extends Error {
  status = 400;
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthApiError";
    this.code = code;
  }
}
const apiError = (code: string, message: string) => new FakeAuthApiError(code, message);

const EMAIL = "unconfirmed@example.com";

function mount(locale: "ro" | "en" = "ro") {
  localStorage.setItem("footy:locale", locale);
  render(
    <LocaleProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={["/login"]}>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    </LocaleProvider>
  );
}

/*
  jsdom implements no `matchMedia`, and Login reads it for the
  prefers-reduced-motion parallax. Every real browser has had it since IE10, so
  this is an environment gap rather than a product one — stubbed here instead of
  weakening the component.
*/
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true, // reduced motion: skips the parallax listener entirely
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    })
  });
});

const errorBlock = () => document.querySelector("[data-slot='login-error']");
const resendButton = () =>
  document.querySelector("[data-slot='login-resend']") as HTMLButtonElement | null;
const sentBanner = () => document.querySelector("[data-slot='login-resend-sent']");

/**
 * The EN catalogue loads lazily, so LocaleProvider is not ready on first paint
 * and the form does not exist yet. Wait for it rather than assuming RO timing.
 */
async function attemptLogin(email = EMAIL, password = "hunter22") {
  await waitFor(() => expect(document.querySelector("form")).toBeTruthy());
  const inputs = document.querySelectorAll("input");
  const emailInput = document.querySelector('input[type="email"]') ?? inputs[0];
  const passwordInput = document.querySelector('input[type="password"]') ?? inputs[1];
  fireEvent.change(emailInput!, { target: { value: email } });
  fireEvent.change(passwordInput!, { target: { value: password } });
  fireEvent.submit(document.querySelector("form")!);
}

beforeEach(() => {
  signInSpy.mockReset();
  resendSpy.mockReset();
  resendSpy.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("[1][2][3] login blocked by an unconfirmed email", () => {
  beforeEach(() => {
    signInSpy.mockResolvedValue({
      data: { session: null, user: null },
      error: apiError("email_not_confirmed", "Email not confirmed")
    });
  });

  it("shows the not-confirmed message and offers a resend", async () => {
    mount();
    await attemptLogin();
    await waitFor(() => expect(errorBlock()).toBeTruthy());
    expect(errorBlock()!.textContent).toContain(RO.emailNotConfirmedTitle);
    expect(errorBlock()!.textContent).toContain(RO.emailNotConfirmedBody);
    expect(resendButton()).toBeTruthy();
  });

  it("never shows Supabase's raw English message", async () => {
    mount();
    await attemptLogin();
    await waitFor(() => expect(errorBlock()).toBeTruthy());
    expect(document.body.textContent).not.toContain("Email not confirmed");
  });

  it("[13] keeps the typed email available, so nothing is re-entered", async () => {
    mount();
    await attemptLogin();
    await waitFor(() => expect(resendButton()).toBeTruthy());
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    expect(emailInput.value).toBe(EMAIL);
  });

  it("does not resend automatically — only on an explicit click", async () => {
    mount();
    await attemptLogin();
    await waitFor(() => expect(resendButton()).toBeTruthy());
    expect(resendSpy).not.toHaveBeenCalled();
  });
});

describe("[4][5] failures that must NOT offer a resend", () => {
  it.each([
    ["invalid_credentials", "Invalid login credentials"],
    ["user_not_found", "User not found"],
    ["user_banned", "User is banned"],
    ["over_request_rate_limit", "Request rate limit reached"],
    ["hook_timeout", "Something else entirely"]
  ])("%s shows the error but no resend button", async (code, message) => {
    signInSpy.mockResolvedValue({
      data: { session: null, user: null },
      error: apiError(code, message)
    });
    mount();
    await attemptLogin();
    await waitFor(() => expect(errorBlock()).toBeTruthy());
    expect(resendButton()).toBeNull();
    expect(errorBlock()!.textContent).not.toContain(RO.emailNotConfirmedTitle);
  });

  it("a network-level throw offers no resend either", async () => {
    signInSpy.mockRejectedValue(new Error("Failed to fetch"));
    mount();
    await attemptLogin();
    await waitFor(() => expect(errorBlock()).toBeTruthy());
    expect(resendButton()).toBeNull();
  });
});

describe("[6][7][8][9] the resend itself", () => {
  beforeEach(() => {
    signInSpy.mockResolvedValue({
      data: { session: null, user: null },
      error: apiError("email_not_confirmed", "Email not confirmed")
    });
  });

  it("calls auth.resend once, with the typed email, type=signup and the signup redirect", async () => {
    mount();
    await attemptLogin();
    await waitFor(() => expect(resendButton()).toBeTruthy());

    fireEvent.click(resendButton()!);
    await waitFor(() => expect(resendSpy).toHaveBeenCalledTimes(1));
    expect(resendSpy).toHaveBeenCalledWith({
      type: "signup",
      email: EMAIL,
      options: { emailRedirectTo: window.location.origin }
    });
  });

  it("[10] a second click while in flight does not send twice", async () => {
    let release: () => void = () => {};
    resendSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: {}, error: null });
        })
    );
    mount();
    await attemptLogin();
    await waitFor(() => expect(resendButton()).toBeTruthy());

    fireEvent.click(resendButton()!);
    await waitFor(() => expect(resendButton()!.disabled).toBe(true));
    expect(resendButton()!.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(resendButton()!);
    fireEvent.click(resendButton()!);
    expect(resendSpy).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(sentBanner()).toBeTruthy());
  });

  it("[10] two clicks in the SAME tick still send once", async () => {
    /*
      The disabled attribute cannot cover this: React has not re-rendered
      between the two events, so the button is still enabled for the second.
      Only the in-flight guard inside the handler stops the duplicate — which is
      exactly what a real double-click, or a double-tap on mobile, produces.
    */
    resendSpy.mockImplementation(() => new Promise(() => {}));
    mount();
    await attemptLogin();
    await waitFor(() => expect(resendButton()).toBeTruthy());

    const button = resendButton()!;
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(resendSpy).toHaveBeenCalledTimes(1));
    expect(resendSpy).toHaveBeenCalledTimes(1);
  });

  it("[11] announces that an email was SENT — never that the account is confirmed", async () => {
    mount();
    await attemptLogin();
    await waitFor(() => expect(resendButton()).toBeTruthy());
    fireEvent.click(resendButton()!);

    await waitFor(() => expect(sentBanner()).toBeTruthy());
    expect(sentBanner()!.textContent).toContain(RO.resendSentFromLogin);
    // The account is still unconfirmed until the user clicks the new link.
    expect(document.body.textContent).not.toContain(RO.signupConfirmedTitle);
    expect(sentBanner()!.getAttribute("role")).toBe("status");
  });

  it("[12] surfaces a resend failure and does not claim success", async () => {
    resendSpy.mockResolvedValue({
      data: {},
      error: apiError("over_email_send_rate_limit", "Email rate limit exceeded")
    });
    mount();
    await attemptLogin();
    await waitFor(() => expect(resendButton()).toBeTruthy());
    fireEvent.click(resendButton()!);

    await waitFor(() => expect(document.body.textContent).toContain(RO.rateLimitedMsg));
    expect(sentBanner()).toBeNull();
  });

  it("refuses a second send locally, naming the wait", async () => {
    mount();
    await attemptLogin();
    await waitFor(() => expect(resendButton()).toBeTruthy());

    fireEvent.click(resendButton()!);
    await waitFor(() => expect(sentBanner()).toBeTruthy());
    expect(resendSpy).toHaveBeenCalledTimes(1);

    // Ask again immediately: the shared cooldown answers before Supabase does.
    await attemptLogin();
    await waitFor(() => expect(resendButton()).toBeTruthy());
    fireEvent.click(resendButton()!);

    await waitFor(() => expect(document.body.textContent).toMatch(/\d+s/));
    expect(resendSpy).toHaveBeenCalledTimes(1);
  });
});

describe("[15] unrelated login behaviour is unchanged", () => {
  it("a successful login produces no error block and no resend", async () => {
    signInSpy.mockResolvedValue({
      data: {
        session: { access_token: "tok", user: { id: "u1", email: EMAIL, user_metadata: {} } },
        user: { id: "u1", email: EMAIL, user_metadata: {} }
      },
      error: null
    });
    mount();
    await attemptLogin();
    await waitFor(() => expect(signInSpy).toHaveBeenCalledTimes(1));
    expect(resendButton()).toBeNull();
    expect(sentBanner()).toBeNull();
  });

  it("an empty email is refused before Supabase is called at all", async () => {
    mount();
    await attemptLogin("", "hunter22");
    await waitFor(() => expect(errorBlock()).toBeTruthy());
    expect(errorBlock()!.textContent).toContain(RO.emailRequiredMsg);
    expect(signInSpy).not.toHaveBeenCalled();
  });
});

describe("[16][17] i18n", () => {
  beforeEach(() => {
    signInSpy.mockResolvedValue({
      data: { session: null, user: null },
      error: apiError("email_not_confirmed", "Email not confirmed")
    });
  });

  it("Romanian", async () => {
    mount("ro");
    await attemptLogin();
    await waitFor(() => expect(errorBlock()).toBeTruthy());
    expect(errorBlock()!.textContent).toContain(RO.emailNotConfirmedTitle);
    expect(resendButton()!.textContent).toContain(RO.resendConfirmationFromLogin);
  });

  it("English", async () => {
    mount("en");
    await attemptLogin();
    await waitFor(() => expect(errorBlock()).toBeTruthy());
    await waitFor(() => expect(errorBlock()!.textContent).toContain(EN.emailNotConfirmedTitle));
    await waitFor(() =>
      expect(resendButton()!.textContent).toContain(EN.resendConfirmationFromLogin)
    );
  });

  it("both catalogues define every key this flow renders, in their own language", () => {
    for (const key of [
      "emailNotConfirmedTitle",
      "emailNotConfirmedBody",
      "resendConfirmationFromLogin",
      "resendSentFromLogin",
      "resendCooldownMsg",
      "invalidCredentialsMsg",
      "rateLimitedMsg"
    ] as const) {
      expect(RO[key], `ro.auth.${key}`).toBeTruthy();
      expect(EN[key], `en.auth.${key}`).toBeTruthy();
      expect(RO[key]).not.toBe(EN[key]);
    }
    // The cooldown copy must keep its interpolation slot in both languages.
    expect(RO.resendCooldownMsg).toContain("{seconds}");
    expect(EN.resendCooldownMsg).toContain("{seconds}");
  });
});
