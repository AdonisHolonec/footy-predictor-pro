import { createClient } from "@vercel/kv";

function isProduction() {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

function getKv() {
  // Align aliases with fetcher.js so cache + rate limit share the same store.
  const url =
    process.env.KV_REST_API_URL ||
    process.env.STORAGEE_KV_REST_API_URL ||
    process.env.Database_KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGEE_KV_REST_API_TOKEN ||
    process.env.Database_KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    return createClient({ url, token });
  } catch {
    return null;
  }
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (xf) return xf.slice(0, 64);
  const real = String(req.headers["x-real-ip"] || "").trim();
  if (real) return real.slice(0, 64);
  const socketIp = req.socket?.remoteAddress;
  if (socketIp) return String(socketIp).slice(0, 64);
  return "unknown";
}

/** Shared hour-bucket counter. `subject` is already trusted (an IP or a user id). */
async function consumeHourBucket(prefix, namespace, subject, maxPerHour) {
  const kv = getKv();
  if (!kv || !Number.isFinite(maxPerHour) || maxPerHour < 1) {
    if (isProduction()) {
      return { ok: false, retryAfterSec: 60, reason: "rate_limit_unavailable" };
    }
    return { ok: true, skipped: true };
  }
  const hourBucket = new Date().toISOString().slice(0, 13);
  const key = `${prefix}:${namespace}:${subject}:${hourBucket}`;
  try {
    const count = await kv.incr(key);
    if (count === 1) {
      await kv.expire(key, 3900);
    }
    if (count > maxPerHour) {
      return { ok: false, retryAfterSec: 3600 };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[${prefix}]`, e?.message || e);
    if (isProduction()) {
      return { ok: false, retryAfterSec: 60, reason: "rate_limit_error" };
    }
    return { ok: true, skipped: true };
  }
}

/**
 * Sliding hour bucket per AUTHENTICATED USER.
 *
 * The IP limiter below is the wrong tool for a signed-in write path: a shared
 * NAT or a corporate proxy makes one abusive account throttle every colleague,
 * while a single account on a phone can rotate addresses freely. Keyed on the
 * user id, one account's quota is its own.
 *
 * `userId` must come from the verified token — never from a request body — or
 * the caller has handed the limiter a value the abuser chooses.
 *
 * Same posture as the anonymous limiter: fail-CLOSED in production. A support
 * form with no working limiter is a spam endpoint.
 */
export async function checkUserRateLimit(userId, { namespace, maxPerHour }) {
  const subject = String(userId || "").slice(0, 64);
  if (!subject) {
    // No identity, no quota to spend — refuse rather than fall back to a shared
    // bucket every caller would collide in.
    return { ok: false, retryAfterSec: 60, reason: "rate_limit_no_subject" };
  }
  return consumeHourBucket("userrl", namespace, subject, maxPerHour);
}

/**
 * Sliding hour bucket per IP for unauthenticated API abuse protection.
 * Production: fail-closed when KV is missing or errors.
 * Non-production: fail-open (skipped) so local/dev still works without KV.
 */
export async function checkAnonymousRateLimit(req, { namespace, maxPerHour }) {
  const kv = getKv();
  if (!kv || !Number.isFinite(maxPerHour) || maxPerHour < 1) {
    if (isProduction()) {
      return { ok: false, retryAfterSec: 60, reason: "rate_limit_unavailable" };
    }
    return { ok: true, skipped: true };
  }
  const ip = clientIp(req);
  const hourBucket = new Date().toISOString().slice(0, 13);
  const key = `anonrl:${namespace}:${ip}:${hourBucket}`;
  try {
    const count = await kv.incr(key);
    if (count === 1) {
      await kv.expire(key, 3900);
    }
    if (count > maxPerHour) {
      return { ok: false, retryAfterSec: 3600 };
    }
    return { ok: true };
  } catch (e) {
    console.error("[anonymousRateLimit]", e?.message || e);
    if (isProduction()) {
      return { ok: false, retryAfterSec: 60, reason: "rate_limit_error" };
    }
    return { ok: true, skipped: true };
  }
}
