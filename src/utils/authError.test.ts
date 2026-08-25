import { describe, expect, it } from "vitest";

import {
  ResendCooldownError,
  authErrorMessageKey,
  classifyAuthError,
  isEmailNotConfirmedError,
  isResendCooldownError
} from "./authError";

/**
 * The classifier decides whether the app offers to send an email. Getting it
 * wrong in either direction is a real cost: too narrow and an unconfirmed user
 * is stuck, too wide and a mistyped password starts mailing people.
 *
 * Shapes below are auth-js `AuthApiError`s: `{ message, status, code }`, with
 * `code` drawn from the closed `ErrorCode` union in auth-js 2.110.7.
 */
const apiError = (code: string, message = "irrelevant", status = 400) => ({
  name: "AuthApiError",
  message,
  status,
  code
});

describe("classifyAuthError", () => {
  it("recognises email_not_confirmed from the stable code", () => {
    expect(classifyAuthError(apiError("email_not_confirmed", "Email not confirmed"))).toBe(
      "email_not_confirmed"
    );
    expect(isEmailNotConfirmedError(apiError("email_not_confirmed"))).toBe(true);
  });

  /*
    The whole point of keying on `code`. Every one of these arrives as a 400
    from the same call, and none of them is fixed by sending another email.
  */
  it.each([
    ["invalid_credentials", "invalid_credentials"],
    ["user_not_found", "user_not_found"],
    ["user_banned", "user_banned"],
    ["over_email_send_rate_limit", "rate_limited"],
    ["over_request_rate_limit", "rate_limited"],
    ["weak_password", "unknown"],
    ["signup_disabled", "unknown"]
  ])("classifies %s without ever calling it email_not_confirmed", (code, expected) => {
    expect(classifyAuthError(apiError(code))).toBe(expected);
    expect(isEmailNotConfirmedError(apiError(code))).toBe(false);
  });

  it("does not mistake wrong credentials for an unconfirmed email, whatever the prose", () => {
    // Real production shape: the message differs from the code's English.
    expect(isEmailNotConfirmedError(apiError("invalid_credentials", "Invalid login credentials"))).toBe(
      false
    );
  });

  it("survives non-error inputs instead of throwing", () => {
    for (const value of [null, undefined, "", 0, "email not confirmed", { nope: 1 }]) {
      expect(() => classifyAuthError(value)).not.toThrow();
    }
    // A bare string is not an auth error and must not be classified as one.
    expect(isEmailNotConfirmedError("email not confirmed")).toBe(false);
  });

  describe("codeless fallback (older / self-hosted GoTrue)", () => {
    it("matches the full phrase when no code was sent at all", () => {
      expect(isEmailNotConfirmedError({ message: "Email not confirmed", status: 400 })).toBe(true);
    });

    it("is unreachable once a code is present, even a contradictory one", () => {
      // Code wins: prose must never override an explicit classification.
      expect(isEmailNotConfirmedError(apiError("invalid_credentials", "Email not confirmed"))).toBe(
        false
      );
    });

    it("does not fire on neighbouring messages", () => {
      for (const message of [
        "Invalid login credentials",
        "Email address invalid",
        "Email rate limit exceeded",
        "confirmed"
      ]) {
        expect(isEmailNotConfirmedError({ message, status: 400 })).toBe(false);
      }
    });
  });
});

describe("authErrorMessageKey", () => {
  it("returns an i18n key for what we recognise", () => {
    expect(authErrorMessageKey(apiError("email_not_confirmed"))).toBe("auth.emailNotConfirmedTitle");
    expect(authErrorMessageKey(apiError("invalid_credentials"))).toBe("auth.invalidCredentialsMsg");
    expect(authErrorMessageKey(apiError("over_email_send_rate_limit"))).toBe("auth.rateLimitedMsg");
  });

  it("returns null for the unrecognised, so the caller keeps the original text", () => {
    // Flattening every unknown failure into one generic would hide real causes.
    expect(authErrorMessageKey(apiError("hook_timeout"))).toBeNull();
    expect(authErrorMessageKey(new Error("network down"))).toBeNull();
  });
});

describe("ResendCooldownError", () => {
  it("carries the remaining seconds and is recognisable", () => {
    const error = new ResendCooldownError(42);
    expect(isResendCooldownError(error)).toBe(true);
    expect(error.secondsRemaining).toBe(42);
    // The message is an i18n key, not prose — it is rendered through t().
    expect(error.message).toBe("auth.resendCooldownMsg");
  });

  it("does not claim unrelated errors", () => {
    expect(isResendCooldownError(new Error("boom"))).toBe(false);
    expect(isResendCooldownError(apiError("over_email_send_rate_limit"))).toBe(false);
    expect(isResendCooldownError(null)).toBe(false);
  });
});
