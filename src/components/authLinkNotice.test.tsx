import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "../i18n/en";
import { ro } from "../i18n/ro";

/*
  Same narrowing the other i18n-aware suites use (see detailLayers.test.tsx):
  the EN catalogue is typed as a loose Dict so it can load lazily, so leaf reads
  need the cast. Values are still the real catalogue — nothing is stubbed.
*/
type Leaves = Record<string, Record<string, string>>;
const EN = (en as unknown as Leaves).auth;
const RO = (ro as unknown as Leaves).auth;

/**
 * The regression this exists to stop.
 *
 * A confirmation link that has expired comes back as
 * `#error=access_denied&error_code=otp_expired&…`. Nothing in the app read that
 * fragment, so the user landed on a normal page with no message, tried their
 * password, and got "Email not confirmed" — which reads as a wrong password.
 * Production logs show three link clicks and three failed logins in nine minutes.
 *
 * `readCapturedAuthHash` snapshots the fragment at MODULE EVALUATION, so every
 * case here sets `window.location.hash` and then imports the module fresh via
 * `vi.resetModules()`. That is also the ordering guarantee under test: auth-js
 * clears the hash on the success path before React renders, so a component that
 * re-read `window.location.hash` at render time would be racing it.
 */

const EXPIRED =
  "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

const resendSpy = vi.fn<(email: string) => Promise<void>>();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ resendConfirmationEmail: resendSpy })
}));

function setHash(hash: string) {
  window.history.replaceState({}, "", `/${hash}`);
}

/** Fresh module graph, so the load-time snapshot sees the hash we just set. */
async function mountWith(hash: string, locale: "ro" | "en" = "ro") {
  localStorage.setItem("footy:locale", locale);
  setHash(hash);
  vi.resetModules();
  const [{ default: AuthLinkNotice }, { LocaleProvider }] = await Promise.all([
    import("./AuthLinkNotice"),
    import("../context/LocaleContext")
  ]);
  render(
    <LocaleProvider>
      <AuthLinkNotice />
    </LocaleProvider>
  );
}

const notice = () => document.querySelector("[data-slot='auth-link-notice']");
const resendButton = () =>
  document.querySelector("[data-slot='auth-link-notice-resend']") as HTMLButtonElement | null;
const emailInput = () =>
  document.querySelector("[data-slot='auth-link-notice-email']") as HTMLInputElement | null;

beforeEach(() => {
  resendSpy.mockReset();
  resendSpy.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("expired confirmation link", () => {
  it("[1][3] detects otp_expired and shows the expired-link state", async () => {
    await mountWith(EXPIRED);
    expect(notice()).toBeTruthy();
    expect(document.body.textContent).toContain(RO.linkExpiredTitle);
    expect(resendButton()).toBeTruthy();
  });

  it("[2] never presents an error fragment as a success", async () => {
    await mountWith(EXPIRED);
    const text = document.body.textContent || "";
    expect(text).not.toContain(RO.emailConfirmedMsg);
    expect(text).not.toContain(EN.emailConfirmedMsg);
    // [11] a queued email is not a confirmed account, and nothing here claims it is.
    expect(text).not.toContain(RO.resendSent);
  });

  it("[2] does not leak GoTrue's raw English error_description as the message", async () => {
    await mountWith(EXPIRED);
    expect(document.body.textContent).not.toContain("Email link is invalid or has expired");
  });

  it("[9] strips the error fragment from the URL once shown", async () => {
    await mountWith(EXPIRED);
    await waitFor(() => expect(window.location.hash).toBe(""));
    // The notice survives its own cleanup — it read the snapshot, not the URL.
    expect(notice()).toBeTruthy();
  });

  it("[10] never triggers a sign-in on its own", async () => {
    await mountWith(EXPIRED);
    // The only auth call this component may make is the one the user asks for.
    expect(resendSpy).not.toHaveBeenCalled();
  });
});

describe("resend", () => {
  it("[4] calls resend with the address the user typed", async () => {
    await mountWith(EXPIRED);
    fireEvent.change(emailInput()!, { target: { value: "  viciu@example.com  " } });
    fireEvent.click(resendButton()!);
    await waitFor(() => expect(resendSpy).toHaveBeenCalledTimes(1));
    // Trimmed — a copy-pasted address must not fail on whitespace.
    expect(resendSpy).toHaveBeenCalledWith("viciu@example.com");
  });

  it("[5] a second click while in flight does not send twice", async () => {
    let release: () => void = () => {};
    resendSpy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        })
    );
    await mountWith(EXPIRED);
    fireEvent.change(emailInput()!, { target: { value: "viciu@example.com" } });
    fireEvent.click(resendButton()!);
    await waitFor(() => expect(resendButton()!.disabled).toBe(true));
    fireEvent.click(resendButton()!);
    fireEvent.click(resendButton()!);
    expect(resendSpy).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(document.body.textContent).toContain(RO.resendSent));
  });

  it("[6] shows the sent confirmation and retires the form", async () => {
    await mountWith(EXPIRED);
    fireEvent.change(emailInput()!, { target: { value: "viciu@example.com" } });
    fireEvent.click(resendButton()!);
    await waitFor(() =>
      expect(document.querySelector("[data-slot='auth-link-notice-sent']")).toBeTruthy()
    );
    expect(document.body.textContent).toContain(RO.resendSent);
    expect(resendButton()).toBeNull();
  });

  it("[7] surfaces a resend failure and keeps the form usable", async () => {
    resendSpy.mockRejectedValue(new Error("rate limit exceeded"));
    await mountWith(EXPIRED);
    fireEvent.change(emailInput()!, { target: { value: "viciu@example.com" } });
    fireEvent.click(resendButton()!);
    await waitFor(() => expect(document.body.textContent).toContain("rate limit exceeded"));
    expect(document.querySelector("[data-slot='auth-link-notice-sent']")).toBeNull();
    expect(resendButton()!.disabled).toBe(false);
  });

  it("refuses an empty address without calling Supabase", async () => {
    await mountWith(EXPIRED);
    fireEvent.click(resendButton()!);
    await waitFor(() => expect(document.body.textContent).toContain(RO.emailRequiredMsg));
    expect(resendSpy).not.toHaveBeenCalled();
  });
});

describe("fragments that must NOT produce an expired-link state", () => {
  it("[8] renders nothing for the success signup fragment", async () => {
    await mountWith("#access_token=REDACTED&refresh_token=REDACTED&type=signup");
    expect(notice()).toBeNull();
    expect(document.body.textContent).not.toContain(RO.linkExpiredTitle);
  });

  it("renders nothing when there is no fragment at all", async () => {
    await mountWith("");
    expect(notice()).toBeNull();
  });

  it("shows the generic message — and no resend — for a non-expiry access_denied", async () => {
    await mountWith("#error=access_denied&error_code=identity_already_exists");
    expect(notice()).toBeTruthy();
    expect(document.body.textContent).toContain(RO.linkInvalidTitle);
    expect(document.body.textContent).not.toContain(RO.linkExpiredTitle);
    // Resending would send the user after an email that was never the problem.
    expect(resendButton()).toBeNull();
  });
});

describe("i18n", () => {
  it("[12] renders Romanian copy under the ro locale", async () => {
    await mountWith(EXPIRED, "ro");
    expect(document.body.textContent).toContain(RO.linkExpiredTitle);
    expect(document.body.textContent).toContain(RO.linkExpiredBody);
    expect(resendButton()!.textContent).toContain(RO.resendConfirmation);
  });

  it("[13] renders English copy under the en locale", async () => {
    await mountWith(EXPIRED, "en");
    await waitFor(() => expect(document.body.textContent).toContain(EN.linkExpiredTitle));
    expect(document.body.textContent).toContain(EN.linkExpiredBody);
    expect(resendButton()!.textContent).toContain(EN.resendConfirmation);
  });

  it("the two catalogues define every key this component renders", () => {
    for (const key of [
      "linkExpiredTitle",
      "linkExpiredBody",
      "linkInvalidTitle",
      "linkInvalidBody",
      "resendConfirmation",
      "resendSent",
      "resendFailed"
    ] as const) {
      expect(RO[key], `RO.${key}`).toBeTruthy();
      expect(EN[key], `EN.${key}`).toBeTruthy();
      // A key that fell through to the other catalogue would ship mixed language.
      expect(RO[key]).not.toBe(EN[key]);
    }
  });
});
