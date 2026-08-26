import { mapUserIdsToEmails } from "./adminUserEmails.js";
import { assertAdmin } from "./authAdmin.js";
import { ipHashesMatch } from "./referralIpHash.js";
import { attemptRewardForAttribution, reverseReferral } from "./referralRewards.js";
import { ATTRIBUTION_WINDOW_MS, attributionExpiresAt } from "./referrals.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * Admin referral review: list, retry a stuck reward, reverse a paid one.
 *
 * WHY THIS IS NOT api/referral-admin.js. The api/ directory sits at exactly twelve
 * files and Vercel counts every one as a serverless function; the Hobby plan allows
 * twelve. These views ride api/admin.js, dispatched on `view` — the same
 * consolidation the admin inbox already uses.
 *
 * EVERY EXPORT HERE STARTS WITH assertAdmin. Not a hidden button, not a route the
 * client declines to render: an admin-only payload a normal session can fetch is
 * admin-only in name only.
 *
 * THE RAW IP IS NEVER HERE, AND NEITHER IS THE HASH. PR3b stores `ip_hash` as a soft
 * signal; this layer compares two hashes and reports a boolean. Sending the hash to a
 * browser would put a value in a client that exists only to be compared server-side,
 * and it buys a reviewer nothing they can act on.
 *
 * A MATCH IS NOT FRAUD. Carrier-grade NAT, offices, student halls and phone networks
 * put thousands of unrelated people behind one address. This reports
 * `ipSignal: "match" | "different" | "unavailable"` and acts on it never.
 */

/** Page size ceiling. A reviewer scans; they do not export the table. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/** Filters a reviewer can ask for. Anything else is refused, not interpreted. */
export const REFERRAL_FILTERS = Object.freeze([
  "all",
  "attributed",
  "qualified",
  "rewarded",
  "expired",
  "reversed",
  "rejected",
  "unrewarded"
]);

const ROW_COLUMNS =
  "id, inviter_id, invitee_id, code, state, attributed_at, qualified_at, rewarded_at, " +
  "inviter_rewarded_at, invitee_rewarded_at, rejected_reason, ip_hash, created_at";

function readBody(req) {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return typeof body === "object" ? body : {};
}

/**
 * Paging. A bad number is clamped rather than refused — a page size is a request,
 * not an assertion — but the ceiling is absolute.
 */
function readPaging(query) {
  const rawLimit = Number(query?.limit);
  const rawOffset = Number(query?.offset);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0;
  return { limit, offset };
}

/**
 * A stable handle for the table view.
 *
 * Full uuids are available in the detail drawer; the list shows a prefix so a
 * screenshot of a review session does not carry a hundred account identifiers.
 */
function shortId(value) {
  const id = String(value ?? "");
  return id ? `${id.slice(0, 8)}…` : null;
}

/** name@example.com -> n…@example.com. Enough to recognise, not to harvest. */
function maskEmail(email) {
  const value = String(email ?? "").trim();
  if (!value || !value.includes("@")) return null;
  const [local, domain] = value.split("@");
  const head = local.slice(0, 1) || "?";
  return `${head}…@${domain}`;
}

/**
 * Apply one named filter. `unrewarded` is the queue that matters operationally:
 * earned but not delivered, which in a healthy system is empty.
 */
function applyFilter(query, filter) {
  switch (filter) {
    case "unrewarded":
      return query.eq("state", "qualified").is("rewarded_at", null);
    case "all":
      return query;
    default:
      return query.eq("state", filter);
  }
}

/**
 * Grant rows for a page of attributions, in ONE query.
 *
 * Fetched by `reference_id in (...)` for exactly the ids on the page rather than per
 * row: a per-row lookup is the N+1 that turns a 25-row page into 51 round trips.
 */
async function loadGrants(supabase, attributionIds) {
  const byAttribution = new Map();
  if (!attributionIds.length) return byAttribution;

  const { data, error } = await supabase
    .from("time_grants")
    .select("id, user_id, source, days, effective_until, revoked_at, revoked_reason, reference_id")
    .in("reference_id", attributionIds)
    .in("source", ["referral_inviter", "referral_invitee"]);
  if (error) throw new Error(error.message || "referralAdmin: grant read failed");

  for (const grant of data || []) {
    const bucket = byAttribution.get(grant.reference_id) || {};
    bucket[grant.source === "referral_inviter" ? "inviter" : "invitee"] = {
      grantId: grant.id,
      days: grant.days,
      effectiveUntil: grant.effective_until,
      revoked: Boolean(grant.revoked_at),
      revokedAt: grant.revoked_at,
      revokedReason: grant.revoked_reason
    };
    byAttribution.set(grant.reference_id, bucket);
  }
  return byAttribution;
}

/**
 * Has any OTHER attribution on this page been claimed from the same address?
 *
 * Compared with `ipHashesMatch` — constant-time, and the only comparison this
 * project performs on that column. The result is a label for a human, never an input
 * to a decision.
 */
function ipSignalFor(row, allRows) {
  if (!row.ip_hash) return "unavailable";
  const collides = allRows.some(
    (other) => other.id !== row.id && ipHashesMatch(String(row.ip_hash), String(other.ip_hash ?? ""))
  );
  return collides ? "match" : "different";
}

/**
 * One admin-facing record. `ip_hash` is read from the database and deliberately NOT
 * carried into the result — only the derived signal survives.
 */
function shapeRow(row, grants, emails, allRows) {
  const inviterEmail = emails.get(row.inviter_id) || null;
  const inviteeEmail = emails.get(row.invitee_id) || null;
  const bucket = grants.get(row.id) || {};
  return {
    id: row.id,
    idShort: shortId(row.id),
    inviterIdShort: shortId(row.inviter_id),
    inviteeIdShort: shortId(row.invitee_id),
    // Full ids and full emails belong to the detail drawer, which renders from this
    // same record; the table is expected to show the masked forms.
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    inviterEmail,
    inviteeEmail,
    inviterEmailMasked: maskEmail(inviterEmail),
    inviteeEmailMasked: maskEmail(inviteeEmail),
    code: row.code,
    state: row.state,
    attributedAt: row.attributed_at,
    expiresAt: attributionExpiresAt(row.attributed_at),
    qualifiedAt: row.qualified_at,
    rewardedAt: row.rewarded_at,
    inviterRewardedAt: row.inviter_rewarded_at,
    inviteeRewardedAt: row.invitee_rewarded_at,
    // A capped referral is rewarded with no inviter payout — the one case where
    // "rewarded" and "the inviter earned something" differ.
    inviterCapped: row.state === "rewarded" && !row.inviter_rewarded_at,
    unrewarded: row.state === "qualified" && !row.rewarded_at,
    reason: row.rejected_reason,
    ipSignal: ipSignalFor(row, allRows),
    inviterGrant: bucket.inviter || null,
    inviteeGrant: bucket.invitee || null
  };
}

/** GET /api/admin?view=referrals — one page of referral records. */
async function listReferrals(req, res, supabase) {
  const rawFilter = String(req.query?.filter || "all").toLowerCase();
  if (!REFERRAL_FILTERS.includes(rawFilter)) {
    return res.status(400).json({ ok: false, error: "Filtru necunoscut." });
  }
  const { limit, offset } = readPaging(req.query);

  let query = supabase
    .from("referral_attributions")
    .select(ROW_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  query = applyFilter(query, rawFilter);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message || "referralAdmin: list failed");

  const rows = data || [];
  const ids = rows.map((r) => r.id);
  const [grants, emails] = await Promise.all([
    loadGrants(supabase, ids),
    mapUserIdsToEmails(supabase, rows.flatMap((r) => [r.inviter_id, r.invitee_id]))
  ]);

  return res.status(200).json({
    ok: true,
    filter: rawFilter,
    total: Number(count) || 0,
    limit,
    offset,
    windowDays: Math.round(ATTRIBUTION_WINDOW_MS / (24 * 60 * 60 * 1000)),
    referrals: rows.map((row) => shapeRow(row, grants, emails, rows))
  });
}

/**
 * POST /api/admin?view=reverse-referral — revoke both grants, mark reversed.
 *
 * Accepts an attribution id and a reason and NOTHING else. An inviter id, an invitee
 * id or a grant id in the body is ignored: everything is resolved inside migration
 * 064's transaction from the attribution itself, so no reviewer can aim a revoke at
 * an unrelated grant.
 */
async function reverseHandler(req, res, admin) {
  const body = readBody(req);
  const attributionId = String(body.attributionId ?? "").trim();
  const reason = String(body.reason ?? "").trim();

  if (!attributionId) return res.status(400).json({ ok: false, error: "attributionId lipsește." });
  if (!reason) return res.status(400).json({ ok: false, error: "Motivul este obligatoriu." });

  const result = await reverseReferral(attributionId, reason);
  console.log(
    `[referral] action=reverse attribution_id=${attributionId} admin_id=${admin?.id ?? "-"} ` +
      `ok=${result.ok} reason_code=${result.reason ?? "-"} ` +
      `inviter_revoked=${result.inviterGrantRevoked} invitee_revoked=${result.inviteeGrantRevoked}`
  );

  if (!result.ok) {
    // Deterministic reason codes, never a Postgres message.
    return res.status(result.reason === "not_found" ? 404 : 409).json({ ok: false, reason: result.reason });
  }
  return res.status(200).json({
    ok: true,
    reason: result.reason,
    attributionId,
    state: result.state ?? "reversed",
    reversedAt: result.reversedAt,
    inviterGrantRevoked: result.inviterGrantRevoked,
    inviteeGrantRevoked: result.inviteeGrantRevoked
  });
}

/**
 * POST /api/admin?view=retry-referral-reward — finish an earned-but-undelivered reward.
 *
 * Routes through the SAME `reward_referral` transaction the Predict hook uses. There
 * is deliberately no admin-only grant path: a second way to pay would be a second set
 * of cap, idempotency and atomicity rules to keep in step.
 */
async function retryHandler(req, res, admin) {
  const attributionId = String(readBody(req).attributionId ?? "").trim();
  if (!attributionId) return res.status(400).json({ ok: false, error: "attributionId lipsește." });

  const result = await attemptRewardForAttribution(attributionId);
  console.log(
    `[referral] action=retry_reward attribution_id=${attributionId} admin_id=${admin?.id ?? "-"} ` +
      `ok=${result.ok} reason_code=${result.reason ?? "-"} capped=${result.inviterCapped ?? "-"}`
  );

  if (!result.ok) {
    return res.status(result.reason === "not_qualified" ? 409 : 502).json({ ok: false, reason: result.reason });
  }
  return res.status(200).json({
    ok: true,
    // `already_rewarded` is success: a double-clicked retry must converge.
    reason: result.reason,
    attributionId,
    inviterCapped: result.inviterCapped,
    rewardedAt: result.rewardedAt
  });
}

export async function handleReferralAdmin(req, res) {
  const view = String(req.query?.view || "").toLowerCase();
  const method = String(req.method || "GET").toUpperCase();

  try {
    const admin = await assertAdmin(req);
    if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

    const config = assertSupabaseConfigured();
    if (!config.ok) return res.status(503).json({ ok: false, error: config.error });
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(503).json({ ok: false, error: "Clientul Supabase admin nu este disponibil." });

    if (view === "referrals") {
      if (method !== "GET") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await listReferrals(req, res, supabase);
    }
    if (view === "reverse-referral") {
      if (method !== "POST") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await reverseHandler(req, res, admin.user);
    }
    if (view === "retry-referral-reward") {
      if (method !== "POST") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await retryHandler(req, res, admin.user);
    }
    return res.status(400).json({ ok: false, error: "Vedere necunoscută." });
  } catch (err) {
    console.error("[referral] admin_handler_failed", err?.message || err);
    return res.status(500).json({ ok: false, error: "Eroare internă." });
  }
}

export default { handleReferralAdmin, REFERRAL_FILTERS };
