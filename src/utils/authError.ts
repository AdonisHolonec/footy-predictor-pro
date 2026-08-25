/**
 * Classifying a Supabase auth failure, once, in one place.
 *
 * `AuthApiError` carries a stable `code` (auth-js 2.110.7 types it as a closed
 * `ErrorCode` union), and the SDK's own documentation says to branch on it
 * rather than on `message` — the prose is server-side English and can change
 * without notice. Everything below keys on the code.
 *
 * The distinction matters because these arrive through the same rejection and
 * mean opposite things to a user:
 *
 *   email_not_confirmed        -> the password was RIGHT; finish confirming
 *   invalid_credentials        -> wrong email or password
 *   user_not_found             -> no such account
 *   user_banned                -> blocked
 *   over_email_send_rate_limit -> correct, but too soon
 *
 * Offering "resend confirmation" for any of the others would be an invitation to
 * send mail nobody asked for, so only the first is treated as resendable.
 */

/** The subset this app renders differently. Everything else is `unknown`. */
export type AuthErrorKind =
  | "email_not_confirmed"
  | "invalid_credentials"
  | "user_not_found"
  | "user_banned"
  | "rate_limited"
  | "unknown";

type MaybeAuthError = {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  name?: unknown;
};

function readCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as MaybeAuthError).code;
  return typeof code === "string" && code !== "" ? code : null;
}

function readMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as MaybeAuthError).message;
  return typeof message === "string" ? message : "";
}

/**
 * Last-resort match, used ONLY when the server sent no code at all.
 *
 * Self-hosted or older GoTrue builds predate `error_code` and answer with the
 * message alone. Narrow on purpose: it requires the whole phrase, so
 * "Invalid login credentials" cannot fall through it, and it is unreachable for
 * any response that does carry a code.
 */
function looksLikeUnconfirmedEmail(message: string): boolean {
  return /email\s+not\s+confirmed/i.test(message);
}

export function classifyAuthError(error: unknown): AuthErrorKind {
  const code = readCode(error);

  if (code) {
    switch (code) {
      case "email_not_confirmed":
        return "email_not_confirmed";
      case "invalid_credentials":
        return "invalid_credentials";
      case "user_not_found":
        return "user_not_found";
      case "user_banned":
        return "user_banned";
      case "over_email_send_rate_limit":
      case "over_request_rate_limit":
      case "over_sms_send_rate_limit":
        return "rate_limited";
      default:
        return "unknown";
    }
  }

  return looksLikeUnconfirmedEmail(readMessage(error)) ? "email_not_confirmed" : "unknown";
}

/** The one condition a confirmation resend can actually fix. */
export function isEmailNotConfirmedError(error: unknown): boolean {
  return classifyAuthError(error) === "email_not_confirmed";
}

/**
 * i18n key for a classified failure, or `null` to keep whatever the caller had.
 *
 * Returning a KEY rather than prose keeps the decision here and the wording in
 * the catalogues, and stops Supabase's English reaching a Romanian screen — the
 * `t()` fallback passes unknown strings straight through, which is exactly how
 * "Email not confirmed" used to be rendered verbatim.
 */
export function authErrorMessageKey(error: unknown): string | null {
  switch (classifyAuthError(error)) {
    case "email_not_confirmed":
      return "auth.emailNotConfirmedTitle";
    case "invalid_credentials":
      return "auth.invalidCredentialsMsg";
    case "rate_limited":
      return "auth.rateLimitedMsg";
    default:
      return null;
  }
}

/** Raised by the shared resend when it is asked again too soon. */
export const RESEND_COOLDOWN_CODE = "RESEND_COOLDOWN";

export class ResendCooldownError extends Error {
  readonly code = RESEND_COOLDOWN_CODE;
  readonly secondsRemaining: number;

  constructor(secondsRemaining: number) {
    super("auth.resendCooldownMsg");
    this.name = "ResendCooldownError";
    this.secondsRemaining = secondsRemaining;
  }
}

export function isResendCooldownError(error: unknown): error is ResendCooldownError {
  return Boolean(error) && (error as MaybeAuthError)?.name === "ResendCooldownError";
}
