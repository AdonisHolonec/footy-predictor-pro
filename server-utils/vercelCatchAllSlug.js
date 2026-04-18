/**
 * Resolves optional catch-all segments for Vercel Node serverless (non-Next).
 * req.query.slug may be missing; pathname on req.url is a reliable fallback.
 *
 * @param {any} req
 * @param {string} basePath e.g. "/api/history" or "/api/backtest"
 * @returns {string[]}
 */
export function slugSegmentsFromRequest(req, basePath) {
  const prefix = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const q = req.query || {};

  const fromQuery = (s) => {
    if (s === undefined || s === null || s === "") return null;
    if (Array.isArray(s)) return s.length ? s : [];
    const str = String(s);
    if (!str) return null;
    return str.includes("/") ? str.split("/").filter(Boolean) : [str];
  };

  let s = q.slug;
  let parsed = fromQuery(s);
  if (parsed !== null) return parsed;

  if (q["...slug"] !== undefined) {
    parsed = fromQuery(q["...slug"]);
    if (parsed !== null) return parsed;
  }

  const raw = typeof req.url === "string" ? req.url.split("?")[0] : "";
  if (raw === prefix) return [];
  const withSlash = `${prefix}/`;
  if (raw.startsWith(withSlash)) {
    return raw.slice(withSlash.length).split("/").filter(Boolean);
  }
  return [];
}
