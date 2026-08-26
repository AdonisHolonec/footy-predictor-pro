import { checkUserRateLimit } from "./anonymousRateLimit.js";
import { getRequester } from "./authAdmin.js";
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
  [CLAIM_REASONS.SELF_SAME_STRIPE]: 403
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

  const result = await claimReferral(
    { userId: ctx.user.id, code: readBody(req).code, ip: null },
    { supabase: ctx.supabase }
  );

  if (!result.ok) {
    return res.status(CLAIM_STATUS[result.reason] || 400).json({ ok: false, reason: result.reason });
  }

  // `attribution.inviterId` exists on the service result and is deliberately not
  // echoed. The invitee learns that they were attributed, not to whom.
  return res.status(200).json({
    ok: true,
    attribution: {
      state: result.attribution.state,
      attributedAt: result.attribution.attributedAt
    }
  });
}

/** GET /api/referral?view=status — counts as an inviter, attribution as an invitee. */
async function handleStatus(req, res, ctx) {
  const status = await getReferralStatus(ctx.user.id, { supabase: ctx.supabase });
  return res.status(200).json({ ok: true, referral: status });
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

    return res.status(400).json({ ok: false, error: "Vedere necunoscută." });
  } catch (err) {
    console.error("[referral] handler_failed", err?.message || err);
    return res.status(500).json({ ok: false, error: "Eroare internă." });
  }
}

export default { handleReferralApi };
