import { describe, expect, it } from "vitest";

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
