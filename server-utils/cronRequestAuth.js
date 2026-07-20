/**
 * Authorizes cron / internal maintenance requests.
 * - Production: requires CRON_SECRET match via Bearer or x-cron-secret (no query ?secret=).
 * - Optional temporary production fallback: set ALLOW_VERCEL_CRON_UA_FALLBACK=1 to allow Vercel Cron UA only when CRON_SECRET is missing.
 * - Non-production: secret match OR same-origin browser (Origin/Referer) for local dev; if secret unset, allow dev.
 *   Query ?secret= is allowed only outside production for local scripts.
 */
export function isAuthorizedCronOrInternalRequest(req) {
  const secret = String(process.env.CRON_SECRET || "");
  const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  const provided = String(
    req.headers["x-cron-secret"] ||
      (typeof req.headers["authorization"] === "string"
        ? req.headers["authorization"].replace(/^Bearer\s+/i, "")
        : "") ||
      (!isProd ? req.query?.secret : "") ||
      ""
  );

  if (secret && provided === secret) return true;

  if (isProd) {
    // P0: UA fallback is explicitly disabled in production unless BOTH flags are set
    // AND CRON_SECRET is missing (emergency only). Prefer always setting CRON_SECRET.
    const onVercel = String(process.env.VERCEL || "") === "1";
    const allowUaFallback = String(process.env.ALLOW_VERCEL_CRON_UA_FALLBACK || "") === "1";
    const allowUaEmergency = String(process.env.ALLOW_VERCEL_CRON_UA_EMERGENCY || "") === "1";
    const ua = String(req.headers["user-agent"] || "").toLowerCase();
    if (allowUaFallback && allowUaEmergency && onVercel && !secret && ua.includes("vercel-cron")) {
      return true;
    }
    return false;
  }

  const host = String(req.headers.host || "");
  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  if (origin && host && origin.includes(host)) return true;
  if (referer && host && referer.includes(host)) return true;
  return !secret;
}
