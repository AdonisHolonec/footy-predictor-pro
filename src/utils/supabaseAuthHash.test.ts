import { beforeEach, describe, expect, it, vi } from "vitest";

import { hasAuthLinkError, isExpiredLinkError, parseSupabaseAuthHash } from "./supabaseAuthHash";

/**
 * The fragment is the ONLY thing that says whether a confirmation worked:
 * `/auth/v1/verify` answers 303 for success and for failure alike. These cases
 * are the exact shapes production produced on 2026-08-25.
 */

const EXPIRED =
  "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
const SUCCESS =
  "#access_token=REDACTED_ACCESS&expires_in=3600&refresh_token=REDACTED_REFRESH&token_type=bearer&type=signup";

describe("parseSupabaseAuthHash", () => {
  it("reads the otp_expired fragment production actually returned", () => {
    const parsed = parseSupabaseAuthHash(EXPIRED);
    expect(parsed.error).toBe("access_denied");
    expect(parsed.errorCode).toBe("otp_expired");
    expect(parsed.errorDescription).toBe("Email link is invalid or has expired");
    expect(parsed.type).toBeNull();
    expect(parsed.hasSession).toBe(false);
  });

  it("does not mistake an error fragment for a success", () => {
    const parsed = parseSupabaseAuthHash(EXPIRED);
    expect(parsed.hasSession).toBe(false);
    expect(hasAuthLinkError(parsed)).toBe(true);
  });

  it("keeps the success signup fragment intact and error-free", () => {
    const parsed = parseSupabaseAuthHash(SUCCESS);
    expect(parsed.type).toBe("signup");
    expect(parsed.hasSession).toBe(true);
    expect(hasAuthLinkError(parsed)).toBe(false);
    expect(isExpiredLinkError(parsed)).toBe(false);
  });

  it("parses with or without the leading #, and treats empty input as empty", () => {
    expect(parseSupabaseAuthHash("error_code=otp_expired").errorCode).toBe("otp_expired");
    for (const empty of ["", "#", null, undefined]) {
      const parsed = parseSupabaseAuthHash(empty);
      expect(hasAuthLinkError(parsed)).toBe(false);
      expect(parsed.type).toBeNull();
    }
  });

  it("recognises the recovery fragment the reset flow depends on", () => {
    expect(parseSupabaseAuthHash("#access_token=REDACTED&type=recovery").type).toBe("recovery");
  });
});

describe("isExpiredLinkError", () => {
  it("is true only for error_code=otp_expired", () => {
    expect(isExpiredLinkError(parseSupabaseAuthHash(EXPIRED))).toBe(true);
  });

  /*
    The distinction the brief asked for explicitly: access_denied is a CLASS.
    GoTrue returns it for refusals a resend cannot fix, so promising "your link
    expired, request another" on the class alone would send those users after an
    email that was never the problem.
  */
  it("is false for an access_denied that is not otp_expired", () => {
    const parsed = parseSupabaseAuthHash(
      "#error=access_denied&error_code=identity_already_exists&error_description=Identity+already+exists"
    );
    expect(hasAuthLinkError(parsed)).toBe(true);
    expect(isExpiredLinkError(parsed)).toBe(false);
  });

  it("is false for an error fragment carrying no code at all", () => {
    const parsed = parseSupabaseAuthHash("#error=server_error&error_description=Unexpected+failure");
    expect(hasAuthLinkError(parsed)).toBe(true);
    expect(isExpiredLinkError(parsed)).toBe(false);
  });
});

describe("token safety", () => {
  it("never surfaces access_token or refresh_token values", () => {
    const parsed = parseSupabaseAuthHash(SUCCESS);
    const serialised = JSON.stringify(parsed);
    expect(serialised).not.toContain("REDACTED_ACCESS");
    expect(serialised).not.toContain("REDACTED_REFRESH");
    expect(Object.keys(parsed).sort()).toEqual([
      "error",
      "errorCode",
      "errorDescription",
      "hasSession",
      "type"
    ]);
  });
});

/**
 * The latch that makes the success announcement exactly-once.
 *
 * `consumeSignupConfirmation` reads a module-scoped snapshot, so each case has to
 * set the fragment and re-import the module. That is not test scaffolding around
 * a weakness — it IS the mechanism: the snapshot is taken during synchronous
 * module evaluation, which is what beats auth-js clearing the hash later, after
 * an awaited `_getUser` round-trip.
 */
async function freshWith(hash: string) {
  window.history.replaceState({}, "", `/${hash}`);
  vi.resetModules();
  return await import("./supabaseAuthHash");
}

describe("consumeSignupConfirmation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("[1] is true for a successful signup confirmation", async () => {
    const mod = await freshWith("#access_token=REDACTED&refresh_token=REDACTED&type=signup");
    expect(mod.consumeSignupConfirmation()).toBe(true);
  });

  it("[4][5] is true only ONCE, however many times it is asked", async () => {
    const mod = await freshWith("#access_token=REDACTED&refresh_token=REDACTED&type=signup");
    expect(mod.consumeSignupConfirmation()).toBe(true);
    expect(mod.consumeSignupConfirmation()).toBe(false);
    expect(mod.consumeSignupConfirmation()).toBe(false);
  });

  it("[2] is false for an ordinary login, which loads with no fragment", async () => {
    const mod = await freshWith("");
    expect(mod.consumeSignupConfirmation()).toBe(false);
    // Asked again the way a token refresh would: still false.
    expect(mod.consumeSignupConfirmation()).toBe(false);
  });

  it("[6] is false after a reload, because the fragment is gone by then", async () => {
    const first = await freshWith("#access_token=REDACTED&type=signup");
    expect(first.consumeSignupConfirmation()).toBe(true);
    // A reload re-evaluates the module, but auth-js has cleared the URL.
    const second = await freshWith("");
    expect(second.consumeSignupConfirmation()).toBe(false);
  });

  it("[7] is false for a FAILED confirmation, even though type says signup", async () => {
    const mod = await freshWith("#error=access_denied&error_code=otp_expired&type=signup");
    // No access_token ⇒ nothing was confirmed. This belongs to the expired-link
    // notice, and must never be announced as success.
    expect(mod.consumeSignupConfirmation()).toBe(false);
    expect(mod.isExpiredLinkError(mod.readCapturedAuthHash())).toBe(true);
  });

  it("is false for a recovery link carrying a session", async () => {
    const mod = await freshWith("#access_token=REDACTED&type=recovery");
    expect(mod.consumeSignupConfirmation()).toBe(false);
  });

  it("does not expose the token it had to look at", async () => {
    const mod = await freshWith("#access_token=REDACTED_ACCESS&type=signup");
    expect(mod.consumeSignupConfirmation()).toBe(true);
    expect(JSON.stringify(mod.readCapturedAuthHash())).not.toContain("REDACTED_ACCESS");
  });
});
