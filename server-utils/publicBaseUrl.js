/**
 * Trusted app origin resolution — never build outbound URLs from client Host headers.
 * @module server-utils/publicBaseUrl
 */

function isProductionRuntime() {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

function stripTrailingSlash(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

/**
 * Parse hostname from a base URL string. Returns null if invalid.
 * @param {string} raw
 * @returns {string|null}
 */
export function hostnameFromBaseUrl(raw) {
  const s = stripTrailingSlash(raw);
  if (!s) return null;
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    const host = String(u.hostname || "").toLowerCase();
    if (!host || host === "localhost" || host === "127.0.0.1") return host || null;
    // Reject obvious junk
    if (host.includes(" ") || host.includes("@")) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Host allowlist from env bases + optional ALLOWED_APP_HOSTS CSV.
 * @returns {Set<string>}
 */
export function getAllowedAppHosts() {
  const hosts = new Set();
  const envBases = [
    process.env.PUBLIC_BASE_URL,
    process.env.APP_BASE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.CRON_WARM_PREDICT_BASE_URL,
    process.env.VITE_APP_URL,
    process.env.VERCEL_URL ? `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, "")}` : ""
  ];
  for (const b of envBases) {
    const h = hostnameFromBaseUrl(b);
    if (h) hosts.add(h);
  }
  const extra = String(process.env.ALLOWED_APP_HOSTS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  for (const h of extra) hosts.add(h);
  // Dev defaults
  hosts.add("localhost");
  hosts.add("127.0.0.1");
  return hosts;
}

/**
 * @param {string} hostname
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertHostAllowlisted(hostname) {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  if (!host) return { ok: false, error: "empty_host" };
  if (/[^a-z0-9.-]/.test(host) && host !== "127.0.0.1") {
    return { ok: false, error: "malformed_host" };
  }
  const allowed = getAllowedAppHosts();
  if (allowed.has(host)) return { ok: true };
  return { ok: false, error: "host_not_allowlisted" };
}

/**
 * Resolve trusted app origin for server-side redirects / internal fetches.
 * Production: NEVER uses request Host / X-Forwarded-*.
 *
 * @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined> } | null} [_req]
 * @param {{ purpose?: string }} [_opts]
 * @returns {{ ok: true, origin: string } | { ok: false, error: string, status: number }}
 */
export function resolveTrustedAppOrigin(_req = null, _opts = {}) {
  const candidates = [
    process.env.PUBLIC_BASE_URL,
    process.env.APP_BASE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.CRON_WARM_PREDICT_BASE_URL,
    process.env.VITE_APP_URL
  ];
  for (const c of candidates) {
    const cleaned = stripTrailingSlash(c);
    if (!cleaned) continue;
    const withProto = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    const host = hostnameFromBaseUrl(withProto);
    if (!host) continue;
    const check = assertHostAllowlisted(host);
    if (!check.ok) continue;
    return { ok: true, origin: withProto.replace(/\/+$/, "") };
  }

  const vercel = String(process.env.VERCEL_URL || "").trim().replace(/^https?:\/\//, "");
  if (vercel) {
    const origin = `https://${vercel}`.replace(/\/+$/, "");
    const host = hostnameFromBaseUrl(origin);
    if (host && assertHostAllowlisted(host).ok) {
      return { ok: true, origin };
    }
  }

  if (isProductionRuntime()) {
    return {
      ok: false,
      status: 503,
      error: "PUBLIC_BASE_URL (or APP_BASE_URL / VERCEL_URL) required in production — refusing Host header fallback."
    };
  }

  // Local/dev only fallback — never used in production.
  return { ok: true, origin: "http://localhost:3000" };
}

/**
 * Build an absolute internal API URL on the trusted origin.
 * @param {string} path e.g. "/api/history"
 * @param {Record<string, string|number|boolean|undefined|null>} [query]
 */
export function buildInternalApiUrl(path, query = {}) {
  const resolved = resolveTrustedAppOrigin(null, { purpose: "internal_api" });
  if (!resolved.ok) {
    throw new Error(resolved.error || "trusted_origin_unavailable");
  }
  const base = resolved.origin;
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(p, `${base}/`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * CORS Allow-Origin value if request Origin is allowlisted; otherwise null.
 * @param {import('http').IncomingMessage | { headers?: Record<string, string|string[]|undefined> }} req
 */
export function corsOriginIfAllowed(req) {
  const raw = req?.headers?.origin;
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (!origin) return null;
  try {
    const host = new URL(String(origin)).hostname.toLowerCase();
    if (assertHostAllowlisted(host).ok) return String(origin);
  } catch {
    return null;
  }
  return null;
}
