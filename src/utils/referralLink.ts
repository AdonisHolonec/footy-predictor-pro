/**
 * The `?ref=` half of the referral journey: capture it, keep it across the auth
 * round trip, hand it to the claim prompt, forget it afterwards.
 *
 * WHY localStorage AND NOT sessionStorage. Signing up sends the user to their email
 * client, and the confirmation link frequently opens in a NEW TAB — sometimes in a
 * different browser profile. sessionStorage is per-tab and would be gone by then, so
 * the invite would silently evaporate at exactly the moment it mattered.
 *
 * WHY A TTL ANYWAY. localStorage is forever, and a code left lying around for months
 * would eventually pre-fill a prompt for an invite the user has long forgotten. The
 * 30 days mirror the attribution window: past that the server would refuse the claim
 * regardless, so keeping it is pure confusion.
 *
 * THIS IS A CONVENIENCE, NOT AN AUTHORITY. The stored code only ever pre-fills a
 * prompt the user must accept. The server resolves the inviter, applies every
 * self-referral rule and owns the outcome — nothing here is trusted.
 */

/** Matches the `footy.*` namespacing every other stored key in this app uses. */
export const REFERRAL_STORAGE_KEY = "footy.referral.pending";

/** Same 30 days as the server's attribution window. */
export const REFERRAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Crockford-style base32, exactly ten characters — the shape
 * `generateReferralCode` produces. Validated here so a hand-edited URL or a
 * corrupted storage entry is discarded instead of being sent to the server.
 */
const CODE_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;

export type PendingReferral = { code: string; capturedAt: number };

/**
 * Normalise what arrived in the URL. Lowercase links are common in chat apps and
 * email clients that "helpfully" rewrite them, and the server upper-cases anyway.
 */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = String(raw ?? "")
    .trim()
    .toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/**
 * Storage can throw, not just return null: Safari's private mode and browsers with
 * site data disabled raise on access. A referral is never worth breaking boot over,
 * so every entry point here swallows.
 */
function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota, private mode, disabled storage — the user simply pastes the code.
  }
}

export function clearPendingReferral(): void {
  try {
    window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Nothing to do; a stale entry expires on its own.
  }
}

/**
 * The pending invite, if there is a valid unexpired one.
 *
 * Deletes what it rejects. A malformed or expired entry that survived would be
 * re-read on every render and re-rejected forever.
 */
export function readPendingReferral(now: number = Date.now()): PendingReferral | null {
  const raw = safeGetItem(REFERRAL_STORAGE_KEY);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPendingReferral();
    return null;
  }

  const entry = parsed as Partial<PendingReferral> | null;
  const code = normalizeReferralCode(entry?.code);
  const capturedAt = Number(entry?.capturedAt);

  if (!code || !Number.isFinite(capturedAt)) {
    clearPendingReferral();
    return null;
  }
  if (now - capturedAt >= REFERRAL_TTL_MS) {
    clearPendingReferral();
    return null;
  }
  return { code, capturedAt };
}

/**
 * Capture `?ref=` from the current URL. Called from main.tsx before render.
 *
 * MUST RUN EARLY. Supabase's auth redirects rewrite the URL, and Auth.tsx calls
 * `history.replaceState` of its own; by the time any component mounts the parameter
 * may be gone. Boot is the only place it is reliably still there.
 *
 * AN EXISTING PENDING CODE IS NOT OVERWRITTEN. If someone opens a second invite link
 * while one is already waiting, the first still wins — they can only ever use one,
 * and silently swapping which is pending would be a surprise the UI never explained.
 *
 * The parameter is deliberately NOT stripped from the URL: rewriting history at boot
 * fights the router, and a visible `?ref=` is harmless.
 *
 * @returns the code that is now pending, or null.
 */
export function capturePendingReferral(
  search: string = typeof window === "undefined" ? "" : window.location.search,
  now: number = Date.now()
): string | null {
  const existing = readPendingReferral(now);
  if (existing) return existing.code;

  let code: string | null;
  try {
    code = normalizeReferralCode(new URLSearchParams(search).get("ref"));
  } catch {
    // A malformed query string is not worth a boot failure.
    return null;
  }
  if (!code) return null;

  safeSetItem(REFERRAL_STORAGE_KEY, JSON.stringify({ code, capturedAt: now }));
  return code;
}

/**
 * The shareable link for a code, built from the ACTUAL runtime origin.
 *
 * Never hard-coded: the same bundle serves localhost, preview deployments and
 * production, and a baked host would send every previewer's invitees to the wrong
 * place — or to a domain the project no longer owns.
 */
export function buildReferralLink(code: string, origin?: string): string {
  const base = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  return `${base}/?ref=${encodeURIComponent(code)}`;
}
