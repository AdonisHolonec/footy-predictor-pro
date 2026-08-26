import { createHmac, timingSafeEqual } from "node:crypto";

import { clientIp } from "./anonymousRateLimit.js";

/**
 * Deterministic, unguessable IP hashing for referral fraud review.
 *
 * WHY THIS EXISTS AT ALL. PR3a shipped `referral_attributions.ip_hash` and left it
 * NULL on purpose, because a useful signal has to be two things at once:
 *
 *   (a) UNGUESSABLE — IPv4 is 2^32 addresses. An unsalted SHA-256 of one is
 *       reversible by exhaustive search in seconds on a laptop, so a leaked hash
 *       column would be a leaked address column.
 *   (b) STABLE — two sign-ups an hour apart from the same address must produce the
 *       same hash, or there is nothing to compare and the column is decoration.
 *
 * A per-row salt buys (a) at the cost of (b). A global secret buys both, which is
 * why this needs a secret OF ITS OWN.
 *
 * WHY NOT REUSE AN EXISTING SECRET. CRON_SECRET and STRIPE_WEBHOOK_SECRET are
 * authentication credentials on their own rotation schedules, and
 * SUPABASE_SERVICE_ROLE_KEY is the database's master key. Keying IP hashes to any
 * of them means the next routine rotation silently voids every stored hash while
 * the column still looks populated — the worst possible failure, because it is
 * invisible. REFERRAL_IP_HASH_SECRET rotates when someone decides the historic
 * signal is worth discarding, and never by accident.
 *
 * THE HASH IS A SOFT SIGNAL, NEVER A BLOCK. Carrier-grade NAT, university halls,
 * offices and phone networks put thousands of unrelated people behind one address;
 * auto-rejecting a shared IP would refuse more honest referrals than fraudulent
 * ones. Two attributions sharing a hash is something a human looks at in PR3d, not
 * something this code acts on.
 *
 * THE RAW ADDRESS IS NEVER STORED AND NEVER LOGGED. It exists as a local inside
 * `hashClientIp` and nowhere else.
 */

export const REFERRAL_IP_HASH_SECRET_ENV = "REFERRAL_IP_HASH_SECRET";

/**
 * A 16-character floor, checked rather than assumed.
 *
 * HMAC accepts a one-byte key and produces a perfectly well-formed digest from it,
 * so a placeholder like "changeme" fails nothing and looks identical to a real
 * secret in the column. Since the whole point of property (a) is that the key
 * cannot be guessed, a key that can be guessed is a silent downgrade to the
 * unsalted hash this module exists to avoid — so it is refused loudly instead.
 */
export const MIN_SECRET_LENGTH = 16;

function readSecret() {
  return String(process.env[REFERRAL_IP_HASH_SECRET_ENV] || "").trim();
}

function isProduction() {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

/**
 * Is the secret present and plausible? Returns a result rather than throwing so
 * callers can decide the HTTP shape, and so tests can assert the failure directly.
 *
 * The error text names the variable and NOTHING else. It must never echo the value,
 * its length or a prefix: an error string is the one part of a failed request that
 * reliably reaches a log aggregator.
 */
export function assertReferralIpHashSecret() {
  const secret = readSecret();
  if (!secret) {
    return { ok: false, error: `${REFERRAL_IP_HASH_SECRET_ENV} is not configured.` };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      ok: false,
      error: `${REFERRAL_IP_HASH_SECRET_ENV} is too short to be a secret (minimum ${MIN_SECRET_LENGTH} characters).`
    };
  }
  return { ok: true };
}

/**
 * Reduce an address to the form two visits from the same client agree on.
 *
 * Without this, `1.2.3.4`, `1.2.3.4:51999` and `::ffff:1.2.3.4` hash to three
 * different values and the comparison the column exists for silently never fires.
 * All three are the same host.
 */
export function normalizeIp(rawIp) {
  let ip = String(rawIp ?? "")
    .trim()
    .toLowerCase();
  if (!ip || ip === "unknown") return null;

  // "[2001:db8::1]:443" — bracketed form always carries an optional port.
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    ip = bracketed[1];
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    // IPv4 with a port. Only stripped when there is exactly ONE colon, because a
    // bare IPv6 address is nothing but colons and must survive untouched.
    ip = ip.slice(0, ip.lastIndexOf(":"));
  }

  // IPv4-mapped IPv6. Node reports the same client either way depending on whether
  // the socket happened to be dual-stack, which is not a property of the client.
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) ip = mapped[1];

  ip = ip.replace(/^::ffff:/, "");
  if (!ip) return null;
  return ip.slice(0, 64);
}

/**
 * The client address, from the proxy headers this project already trusts.
 *
 * Precedence is `clientIp` in anonymousRateLimit.js — imported rather than
 * reimplemented, so the rate limiter and the fraud signal can never disagree about
 * who the caller is. NOTHING here reads the request body: a client-supplied `ip`
 * field is a client-chosen hash, which is worse than no hash.
 */
export function readRequestIp(req) {
  if (!req?.headers) return null;
  return normalizeIp(clientIp(req));
}

/**
 * HMAC-SHA256 of a normalized address, hex.
 *
 * Returns null — never a hash of the empty string — when there is no address to
 * hash. A constant standing in for "unknown" would make every address-less request
 * collide with every other one and read as a fraud ring in PR3d's review.
 */
export function hashClientIp(rawIp, { secret = readSecret() } = {}) {
  const ip = normalizeIp(rawIp);
  if (!ip) return null;
  if (!secret) return null;
  return createHmac("sha256", secret).update(ip).digest("hex");
}

/**
 * The hash to store for this claim, or an explicit refusal.
 *
 * Same posture as the rate limiter next door, for the same reason: in PRODUCTION a
 * missing secret FAILS THE REQUEST, because writing NULL into a column whose
 * purpose is comparison produces a fraud review that quietly sees nothing. Outside
 * production it degrades to `skipped` so a developer without the secret can still
 * exercise the flow — and says so in the result rather than pretending it hashed.
 */
export function resolveClaimIpHash(req) {
  const check = assertReferralIpHashSecret();
  if (!check.ok) {
    if (isProduction()) return { ok: false, error: check.error };
    return { ok: true, ipHash: null, skipped: true, reason: check.error };
  }
  return { ok: true, ipHash: hashClientIp(readRequestIp(req)) };
}

/**
 * Constant-time comparison, for PR3d's admin review.
 *
 * Exported now so the comparison never gets written as `a === b` at a call site
 * later. Both operands are hex digests of identical length, so length inequality is
 * decided before `timingSafeEqual`, which throws on mismatched buffers.
 */
export function ipHashesMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export default {
  REFERRAL_IP_HASH_SECRET_ENV,
  MIN_SECRET_LENGTH,
  assertReferralIpHashSecret,
  normalizeIp,
  readRequestIp,
  hashClientIp,
  resolveClaimIpHash,
  ipHashesMatch
};
