/**
 * The one place that reads a Supabase auth redirect fragment.
 *
 * Implicit flow returns everything in the URL hash, and GoTrue uses the same
 * fragment for both outcomes:
 *
 *   success  #access_token=…&refresh_token=…&type=signup
 *   failure  #error=access_denied&error_code=otp_expired&error_description=…
 *
 * `/auth/v1/verify` answers 303 either way, so the fragment — not the status —
 * is what says whether a confirmation worked. Three call sites used to build
 * their own `URLSearchParams` over this hash and each looked only for `type`,
 * which is why an expired link reached production as a silent no-op.
 *
 * Pure by construction: `parse` never touches `window`, so the interesting
 * cases are testable as strings.
 */

export type SupabaseAuthHash = {
  /** `signup`, `recovery`, `magiclink`… — present on success, absent on error. */
  type: string | null;
  /** Coarse class, e.g. `access_denied`. Never assume it implies a code. */
  error: string | null;
  /** The precise reason, e.g. `otp_expired`. This is what we branch on. */
  errorCode: string | null;
  /** GoTrue's English prose. Diagnostic only — never the user-facing message. */
  errorDescription: string | null;
  /** True when the fragment carries a session rather than a failure. */
  hasSession: boolean;
};

const EMPTY: SupabaseAuthHash = Object.freeze({
  type: null,
  error: null,
  errorCode: null,
  errorDescription: null,
  hasSession: false
});

/** `null` for a missing param, so callers never have to distinguish "" from absent. */
function read(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value === null || value === "" ? null : value;
}

/**
 * @param hash a location fragment, with or without the leading `#`.
 */
export function parseSupabaseAuthHash(hash: string | null | undefined): SupabaseAuthHash {
  if (!hash) return EMPTY;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return {
    type: read(params, "type"),
    error: read(params, "error"),
    errorCode: read(params, "error_code"),
    errorDescription: read(params, "error_description"),
    hasSession: params.has("access_token")
  };
}

/** Any failure at all — an error fragment can arrive without an `error_code`. */
export function hasAuthLinkError(parsed: SupabaseAuthHash): boolean {
  return Boolean(parsed.error || parsed.errorCode || parsed.errorDescription);
}

/**
 * An expired-or-already-used confirmation link.
 *
 * Keyed on `error_code`, never on `error`: `access_denied` is the class GoTrue
 * returns for several unrelated refusals, so treating it as "expired" would tell
 * some users to resend an email that was never the problem. The comparison is on
 * the code alone and not on any expiry duration — the window is a Supabase
 * dashboard setting this code deliberately knows nothing about.
 */
export function isExpiredLinkError(parsed: SupabaseAuthHash): boolean {
  return parsed.errorCode === "otp_expired";
}

/**
 * The fragment as it was when the document loaded.
 *
 * Taken at module evaluation — before React renders — because auth-js clears the
 * hash itself on the SUCCESS path (`GoTrueClient` sets `window.location.hash = ''`
 * once it has a session). Reading later would race that write. Failures never
 * reach the clearing line, so an error fragment does survive to first render; the
 * snapshot means correctness does not depend on that continuing to be true.
 *
 * No token ever leaves this module: only `type` and the three error fields are
 * kept, so `access_token` and `refresh_token` cannot reach state or logs.
 */
const capturedAtLoad: SupabaseAuthHash =
  typeof window === "undefined" ? EMPTY : parseSupabaseAuthHash(window.location.hash);

export function readCapturedAuthHash(): SupabaseAuthHash {
  return capturedAtLoad;
}

/**
 * Drop the fragment without navigating.
 *
 * `replaceState` rather than assigning `location.hash`, so no history entry is
 * pushed, the SPA does not remount, and `#error=…` stops travelling with every
 * link the user copies for the rest of the session. Search params are preserved —
 * `/login?mode=signup` must survive this.
 */
export function clearAuthHashFromUrl(): void {
  if (typeof window === "undefined" || !window.location.hash) return;
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
}
