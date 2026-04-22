import { createClient } from "@vercel/kv";

function getKv() {
  const url = process.env.STORAGEE_KV_REST_API_URL || process.env.KV_REST_API_URL;
  const token = process.env.STORAGEE_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;
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

/**
 * Sliding hour bucket per IP for unauthenticated API abuse protection.
 * If KV is not configured, returns ok (skipped).
 */
export async function checkAnonymousRateLimit(req, { namespace, maxPerHour }) {
  const kv = getKv();
  if (!kv || !Number.isFinite(maxPerHour) || maxPerHour < 1) {
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
    return { ok: true, skipped: true };
  }
}
