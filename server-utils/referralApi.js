import { checkUserRateLimit } from "./anonymousRateLimit.js";
import { getRequester } from "./authAdmin.js";
import { resolveClaimIpHash } from "./referralIpHash.js";
import { attemptQualificationForUser } from "./referralRewards.js";
import { acknowledgeReferralBonuses, listPendingReferralBonuses } from "./referralNotifications.js";
import { validateDisplayName } from "./contentSafety.js";
import { CLAIM_REASONS, claimReferral, getOrCreateReferralCode, getReferralStatus } from "./referrals.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * Referral endpoints: issue a code, claim one, read your own status.
 *
 * WHY THIS IS NOT api/referral.js. The api/ directory sits at exactly twelve files
 * and Vercel counts every one as a serverless function; the Hobby plan allows
 * twelve (tests/vercelFunctionBudget.test.js exists because a thirteenth passed
 * every check and then failed at deploy). These endpoints keep their public URLs
 * through rewrites in vercel.json and are served by api/alerts.js — the same
 * consolidation /api/support and /api/special-bets already use.
 *
 * IDENTITY COMES FROM THE TOKEN, NEVER THE BODY. Every handler here derives the
 * user from a verified session. `claim` in particular accepts only a CODE: a
 * request that also names an inviter is answered by resolving the code and
 * ignoring the claim, because the inviter is whatever the code says it is.
 *
 * NO INVITER IDENTITY IS EVER RETURNED. claimReferral resolves an inviter id
 * internally and this layer drops it. Telling an invitee "you were referred" is
 * fine; telling them by whom, before that person chose to be known, is not.
 */

/**
 * Reason -> HTTP. 403 for "this is not allowed to you", 404/410 for the code
 * itself, 409 for a state that already exists. Distinguishing them is what lets the
 * client say something useful instead of "something went wrong".
 */
const CLAIM_STATUS = {
  [CLAIM_REASONS.MISSING_CODE]: 400,
  [CLAIM_REASONS.INVALID_CODE]: 404,
  [CLAIM_REASONS.DISABLED_CODE]: 410,
  [CLAIM_REASONS.ALREADY_ATTRIBUTED]: 409,
  [CLAIM_REASONS.SELF_SAME_ACCOUNT]: 403,
  [CLAIM_REASONS.SELF_SAME_EMAIL]: 403,
  [CLAIM_REASONS.SELF_NORMALIZED_EMAIL]: 403,
  [CLAIM_REASONS.SELF_SAME_STRIPE]: 403,
  /*
    410 rather than 409, and the same code a disabled code gets: both mean "this
    existed and is no longer usable", which is the distinction a client needs in
    order to say something true. 409 would suggest a conflict the caller could
    resolve, and there is none — UNIQUE(invitee_id) makes attribution permanent.
  */
  [CLAIM_REASONS.EXPIRED]: 410
};

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

async function authed(req, res) {
  const requester = await getRequester(req);
  if (!requester.ok) {
    res.status(requester.status).json({ ok: false, error: requester.error });
    return null;
  }
  const config = assertSupabaseConfigured();
  if (!config.ok) {
    res.status(503).json({ ok: false, error: config.error });
    return null;
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(503).json({ ok: false, error: "Clientul Supabase admin nu este disponibil." });
    return null;
  }
  return { user: requester.user, supabase };
}

/** GET|POST /api/referral?view=code — the caller's own active code, created on demand. */
async function handleCode(req, res, ctx) {
  const { code, created } = await getOrCreateReferralCode(ctx.user.id, { supabase: ctx.supabase });
  return res.status(200).json({ ok: true, code, created });
}

/** POST /api/referral?view=claim — attribute the caller to the owner of `code`. */
async function handleClaim(req, res, ctx) {
  /*
    Rate limited on the CODE path specifically: a claim is the one endpoint that
    reveals whether an arbitrary string is a real code, so it is the enumeration
    surface. 20/hour is far above any honest use — a person claims once, ever.
  */
  const limit = await checkUserRateLimit(ctx.user.id, { namespace: "referral_claim", maxPerHour: 20 });
  if (!limit.ok) {
    return res.status(429).json({ ok: false, error: "Prea multe încercări. Reîncearcă mai târziu." });
  }

  /*
    Hashed HERE, from the proxy headers, before anything else touches the request.
    The body is never consulted for an address: a client-supplied IP is a
    client-chosen hash, which is worse than none. In production a missing secret is
    a 503 rather than a NULL write — see referralIpHash.js for why a silently empty
    fraud column is the worst of the three options.
  */
  const ip = resolveClaimIpHash(req);
  if (!ip.ok) {
    console.error("[referral] ip_hash_unavailable", ip.error);
    return res.status(503).json({ ok: false, error: "Serviciul de recomandări nu este configurat complet." });
  }

  const result = await claimReferral(
    { userId: ctx.user.id, code: readBody(req).code, ipHash: ip.ipHash },
    { supabase: ctx.supabase }
  );

  if (!result.ok) {
    return res.status(CLAIM_STATUS[result.reason] || 400).json({ ok: false, reason: result.reason });
  }

  /*
    `attribution.id`, `attribution.inviterId` and the ip hash all exist on the
    service result and are deliberately not echoed. The invitee learns THAT they
    were attributed and for how long the window runs — not to whom, not under which
    internal id, and never the signal a fraud reviewer will compare.
  */
  return res.status(200).json({
    ok: true,
    attribution: {
      state: result.attribution.state,
      attributedAt: result.attribution.attributedAt,
      expiresAt: result.attribution.expiresAt
    }
  });
}

/** GET /api/referral?view=status — counts as an inviter, attribution as an invitee. */
async function handleStatus(req, res, ctx) {
  /*
    SECONDARY QUALIFICATION TRIGGER (PR3c).

    The Predict hook is primary, but it can only see the facts that existed when it
    ran. A user who Predicts and THEN confirms their email is qualified on durable
    facts yet has no event left to notice it — the hook already fired and found the
    address unverified. Re-evaluating here closes that ordering without a
    verification webhook, because both preconditions are stored state rather than
    events: whenever this runs, it computes the same answer.

    Opportunistic and non-blocking. `attemptQualificationForUser` never throws, and
    its result is deliberately ignored: a status read reports status. Surfacing a
    reward decision through it would let an internal SQL reason reach the client,
    and would make a read endpoint fail for a write-side problem.
  */
  await attemptQualificationForUser(ctx.user.id, { supabase: ctx.supabase });

  const status = await getReferralStatus(ctx.user.id, { supabase: ctx.supabase });
  return res.status(200).json({ ok: true, referral: status });
}

/**
 * The referral bonuses this caller has not been shown yet.
 *
 * The response is already presentation-safe: the module returns a grant id, a
 * role, a day count and — for inviter grants only — the invitee's chosen public
 * display name. No email, no user id, no attribution id, no ip_hash reaches the
 * client, because none of them is in the payload to begin with.
 */
async function handleBonus(req, res, ctx) {
  const bonuses = await listPendingReferralBonuses(ctx.user.id, { supabase: ctx.supabase });
  return res.status(200).json({ ok: true, bonuses });
}

/**
 * Mark bonuses as shown.
 *
 * The body carries grant ids and NOTHING else — no user id, no name, no day
 * count. Anything the client could otherwise forge is derived server-side from
 * the session, and the ids themselves are re-checked against the caller's own
 * grants before a row is written.
 */
async function handleBonusAck(req, res, ctx) {
  const grantIds = Array.isArray(readBody(req).grantIds) ? readBody(req).grantIds : [];
  const result = await acknowledgeReferralBonuses(ctx.user.id, grantIds, { supabase: ctx.supabase });
  return res.status(200).json({ ok: true, acknowledged: result.acknowledged });
}

/**
 * Set (or clear) the caller's public display name.
 *
 * THIS ENDPOINT EXISTS BECAUSE THE COLUMN IS NO LONGER CLIENT-WRITABLE. Migration
 * 065 revokes UPDATE(display_name) from `authenticated`, so PostgREST can no
 * longer be used to set a name directly. That is deliberate: this is the one
 * value shown to ANOTHER user, and it must pass the content filter, which lives
 * in application code rather than in a CHECK constraint.
 *
 * The rejection reason is a stable CODE, never prose and never the matched term:
 * telling someone which word tripped the filter is a map for getting around it.
 */
async function handleDisplayName(req, res, ctx) {
  const check = validateDisplayName(readBody(req).displayName);
  if (!check.ok) {
    return res.status(400).json({ ok: false, reason: check.reason });
  }

  const { error } = await ctx.supabase
    .from("profiles")
    .update({ display_name: check.value })
    .eq("user_id", ctx.user.id);
  if (error) {
    // The raw Postgres message is deliberately not forwarded.
    console.error("[referral] display_name_write_failed");
    return res.status(500).json({ ok: false, error: "Eroare internă." });
  }
  // Echo the STORED value so the field shows exactly what was persisted.
  return res.status(200).json({ ok: true, displayName: check.value });
}

export async function handleReferralApi(req, res) {
  const view = String(req.query?.view || "");
  const method = String(req.method || "GET").toUpperCase();

  try {
    const ctx = await authed(req, res);
    if (!ctx) return undefined;

    if (view === "code") {
      if (method !== "GET" && method !== "POST") {
        return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      }
      return await handleCode(req, res, ctx);
    }

    if (view === "claim") {
      if (method !== "POST") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await handleClaim(req, res, ctx);
    }

    if (view === "status") {
      if (method !== "GET") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await handleStatus(req, res, ctx);
    }

    if (view === "bonus") {
      if (method !== "GET") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await handleBonus(req, res, ctx);
    }

    if (view === "bonus-ack") {
      if (method !== "POST") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await handleBonusAck(req, res, ctx);
    }

    if (view === "display-name") {
      if (method !== "POST") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await handleDisplayName(req, res, ctx);
    }

    return res.status(400).json({ ok: false, error: "Vedere necunoscută." });
  } catch (err) {
    console.error("[referral] handler_failed", err?.message || err);
    return res.status(500).json({ ok: false, error: "Eroare internă." });
  }
}

export default { handleReferralApi };
