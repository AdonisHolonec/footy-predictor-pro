/**
 * A deadline for auth traffic.
 *
 * Supabase Auth was observed intermittently returning 503 and then simply not
 * answering: a raw `fetch()` from the page — no app code, no auth-js — hung past
 * 8s against endpoints that normally answer in 22-101ms. `@supabase/auth-js`
 * 2.110.7 has no AbortController and no setTimeout anywhere in its fetch layer,
 * so a stalled request is a promise that never settles. Nothing downstream can
 * recover from that: `catch` and `finally` both need a promise that eventually
 * *does* something, which is why the sign-in button sat on "Se procesează…"
 * indefinitely with no error.
 *
 * This adds the missing deadline at the transport, so every auth request either
 * answers or fails — it does not attempt to fix the upstream incident.
 *
 * Safe against spurious sign-out: auth-js `_handleRequest` wraps ANY throw from
 * an injected fetcher in `AuthRetryableFetchError`, and `_callRefreshToken` only
 * destroys a session when the error is NOT retryable. A timed-out background
 * refresh therefore leaves a valid session intact.
 */

/**
 * Measured normal auth latency is 22-101ms; the pathological cases hung past
 * 8,000ms. 10s is ~100x the observed worst normal case — generous enough for a
 * slow mobile network, short enough that no one waits minutes for a verdict.
 */
export const AUTH_REQUEST_TIMEOUT_MS = 10_000;

/**
 * i18n key for the user-facing timeout message. Stored in place of a raw error
 * string: `translate()` returns an unknown key verbatim, so rendering every auth
 * error through t() localises the ones we own and passes technical messages
 * through untouched — no raw Supabase dump reaches the user for this case.
 */
export const AUTH_TIMEOUT_MESSAGE_KEY = "auth.timeoutMsg";

/** Stable discriminator, so callers never string-match an error message. */
export const AUTH_TIMEOUT_CODE = "AUTH_TIMEOUT";

export class AuthTimeoutError extends Error {
  readonly code = AUTH_TIMEOUT_CODE;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Authentication request exceeded ${timeoutMs}ms`);
    this.name = "AuthTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * True for our own deadline, including after auth-js has rewrapped it — the
 * rewrap preserves the message, and the code survives on the original instance.
 */
export function isAuthTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  if (candidate.code === AUTH_TIMEOUT_CODE) return true;
  if (candidate.name === "AuthTimeoutError") return true;
  return typeof candidate.message === "string" && candidate.message.includes("Authentication request exceeded");
}

/**
 * `fetch` with a deadline. Aborts the in-flight request rather than merely
 * abandoning it, and reports the deadline as `AuthTimeoutError` so a timeout is
 * distinguishable from an ordinary network failure.
 *
 * A caller's own `signal` is honoured as well as the deadline: aborting either
 * one aborts the request, and only our own deadline is reported as a timeout.
 */
export function createTimeoutFetch(
  timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
  impl: typeof fetch = (...args: Parameters<typeof fetch>) => fetch(...args)
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const external = init?.signal;
    const forwardAbort = () => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener("abort", forwardAbort, { once: true });
    }

    try {
      return await impl(input, { ...init, signal: controller.signal });
    } catch (error: unknown) {
      // Only our own deadline becomes a timeout; a caller's abort stays theirs.
      if (timedOut && !external?.aborted) throw new AuthTimeoutError(timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", forwardAbort);
    }
  };
}
