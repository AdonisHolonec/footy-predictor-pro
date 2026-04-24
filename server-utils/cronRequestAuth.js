/**
 * Authorizes cron / internal maintenance requests.
 * - Production: requires CRON_SECRET match (Bearer / x-cron-secret / query secret).
 * - Optional temporary production fallback: set ALLOW_VERCEL_CRON_UA_FALLBACK=1 to allow Vercel Cron UA only when CRON_SECRET is missing.
 * - Non-production: secret match OR same-origin browser (Origin/Referer) for local dev; if secret unset, allow dev.
 */
export function isAuthorizedCronOrInternalRequest(req) {
  const secret = String(process.env.CRON_SECRET || "");
  const provided = String(
    req.headers["x-cron-secret"] ||
      (typeof req.headers["authorization"] === "string"
        ? req.headers["authorization"].replace(/^Bearer\s+/i, "")
        : "") ||
      req.query.secret ||
      ""
  );

  if (secret && provided === secret) return true;

  const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProd) {
    const onVercel = String(process.env.VERCEL || "") === "1";
    const allowUaFallback = String(process.env.ALLOW_VERCEL_CRON_UA_FALLBACK || "") === "1";
    const ua = String(req.headers["user-agent"] || "").toLowerCase();
    if (allowUaFallback && onVercel && !secret && ua.includes("vercel-cron")) return true;
    return false;
  }

  const host = String(req.headers.host || "");
  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  if (origin && host && origin.includes(host)) return true;
  if (referer && host && referer.includes(host)) return true;
  return !secret;
}
