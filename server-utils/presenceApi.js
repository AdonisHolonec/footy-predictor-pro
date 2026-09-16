/**
 * Live presence and daily access.
 *
 * THREE AUDIENCES, THREE SHAPES, ONE SOURCE.
 *
 *  - An anonymous visitor contributes to the day's access set and receives the
 *    two aggregate numbers. They are never "online": online requires an
 *    authenticated identity to deduplicate by.
 *  - Any authenticated user additionally beats presence, and receives the same
 *    two integers. No identifiers of any kind, so there is nothing to leak.
 *  - An admin receives `users[]` with a display name, an email and an
 *    online-since time, and ONLY after `assertAdmin` has passed on the server.
 *
 * WHY THE SPLIT IS SERVER-SIDE AND NOT A RENDER GUARD. `if (isAdmin) render()`
 * hides a list the browser already received; the network tab still has it. Here
 * the identity fields are never CONSTRUCTED unless the request proved admin, and
 * both tables have RLS enabled with no policies, so a PostgREST call with an
 * authenticated JWT cannot read them at all. The privacy rule is enforced by the
 * schema and this function, in that order.
 *
 * WHY A HEARTBEAT RATHER THAN REALTIME PRESENCE. The browser client is assembled
 * from @supabase/auth-js + @supabase/postgrest-js specifically to keep realtime
 * out of the bundle (src/utils/supabaseClient.ts), and there is no websocket
 * anywhere in the app. `useReferralBonusToasts` already solved the same "needs a
 * push" problem with activity-triggered reads; this follows it.
 */

import { createHash } from "node:crypto";

import { assertAdmin, getRequester } from "./authAdmin.js";
import { checkAnonymousRateLimit } from "./anonymousRateLimit.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { mapUserIdsToEmails } from "./adminUserEmails.js";
import { todayCalendarEuropeBucharest } from "./fixtureCalendarDateKey.js";

const PRESENCE_TABLE = "user_presence";
const ACCESS_TABLE = "daily_access";

/**
 * How long a heartbeat keeps a user online.
 *
 * Sized against the client's cadence, not chosen round. The hook beats at most
 * every 30s, so 90s absorbs two missed beats — a tunnel, a sleeping radio, a
 * slow function — before a present user is reported offline, and still lets a
 * closed tab disappear inside a minute and a half.
 */
export const PRESENCE_WINDOW_SECONDS = 90;

/** Minimum gap between heartbeats, mirrored by the client hook. */
export const HEARTBEAT_MIN_INTERVAL_MS = 30_000;

/** Header carrying the browser's random per-session token. */
export const VISITOR_HEADER = "x-fp-visitor";

/** `daily_access` keeps 90 days. Older rows are swept from this path, bounded. */
export const DAILY_ACCESS_RETENTION_DAYS = 90;

/** Rows deleted per sweep. Small on purpose: this runs inside a request. */
const CLEANUP_MAX_ROWS = 500;

/**
 * How often a POST also sweeps.
 *
 * Retention only has to keep up with one day's worth of expiring rows, so it
 * does not need to run on every heartbeat — and a DELETE on every beat would be
 * pure load for no benefit. At ~1 in 200 POSTs, a day with any real traffic
 * sweeps many times over, and a quiet day has nothing to sweep anyway.
 */
const CLEANUP_SAMPLE_RATE = 1 / 200;

/**
 * Per-IP hourly ceiling for ANONYMOUS access records.
 *
 * A legitimate anonymous session beats at most twice a minute — 120/hour — so
 * this allows roughly five concurrent sessions behind one address before it
 * trips, which keeps shared networks (offices, carrier NAT, university halls)
 * working. It is a guard against a client regenerating its token in a loop, not
 * an access-control decision, and it is why the number is generous rather than
 * tight.
 */
export const ANON_MAX_ACCESS_PER_HOUR = 600;
const ANON_RATE_NAMESPACE = "presence-access";

/** Cutoff ISO timestamp for "still online". */
export function presenceCutoffIso(nowMs = Date.now()) {
  return new Date(nowMs - PRESENCE_WINDOW_SECONDS * 1000).toISOString();
}

/**
 * The dedupe token for one visitor-day. NOT an identity.
 *
 * Authenticated visitors key on their user id, so every tab and device collapses
 * to one access. Anonymous visitors key on a hash of a random token the browser
 * generated and discards at the end of its session — no IP is read, nothing is
 * derived from the person, and there is nothing to correlate across days.
 *
 * Returns null when there is neither, so a caller with no token cannot silently
 * become an untracked access or, worse, a shared one.
 */
export function visitorKeyFor({ userId = null, visitorToken = null } = {}) {
  if (userId) return `u:${String(userId)}`;
  const token = String(visitorToken || "").trim();
  // Bounded: a hostile client must not be able to push arbitrary length into a
  // hash call, and anything shorter than this is not a plausible random token.
  if (token.length < 16 || token.length > 200) return null;
  return `a:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
}

/**
 * The one name an admin sees.
 *
 * `display_name` is the app's configured public identity (services/displayNameService.ts
 * — the only value ever shown to another user, which is why migration 065 made
 * it server-written). Email is the fallback, never the preference.
 */
export function resolveIdentity({ displayName, email } = {}) {
  const name = String(displayName || "").trim();
  if (name) return name;
  const mail = String(email || "").trim();
  if (mail) return mail;
  return "—";
}

const defaultDeps = {
  assertAdmin,
  getRequester,
  getSupabaseAdmin,
  mapUserIdsToEmails,
  checkAnonymousRateLimit,
  today: todayCalendarEuropeBucharest,
  now: () => Date.now(),
  /** Injected so the sweep can be driven deterministically in tests. */
  shouldSweep: () => Math.random() < CLEANUP_SAMPLE_RATE
};

/** Both aggregate numbers. Never includes an identifier. */
async function readCounts(supabase, { cutoffIso, today }) {
  const online = await supabase
    .from(PRESENCE_TABLE)
    .select("user_id", { count: "exact", head: true })
    .gte("last_seen_at", cutoffIso);
  if (online.error) throw online.error;

  const accesses = await supabase
    .from(ACCESS_TABLE)
    .select("visitor_key", { count: "exact", head: true })
    .eq("access_day", today);
  if (accesses.error) throw accesses.error;

  return {
    onlineCount: Math.max(0, Number(online.count) || 0),
    accessesToday: Math.max(0, Number(accesses.count) || 0)
  };
}

/**
 * The nominal list. Admin-only by construction — the caller must have proved
 * admin BEFORE this runs, because it is the only place identity is assembled.
 */
async function readOnlineUsers(supabase, deps, cutoffIso) {
  const { data, error } = await supabase
    .from(PRESENCE_TABLE)
    .select("user_id, online_since, last_seen_at")
    .gte("last_seen_at", cutoffIso)
    .order("online_since", { ascending: true })
    .limit(200);
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => String(row.user_id));

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", ids);
  if (profileError) throw profileError;

  const nameById = new Map(
    (Array.isArray(profiles) ? profiles : []).map((p) => [String(p.user_id), p.display_name])
  );
  // Emails live in auth.users and are reachable only through the existing
  // server-only admin mapping — never through a PostgREST select.
  const emailById = await deps.mapUserIdsToEmails(supabase, ids);

  return rows.map((row) => {
    const id = String(row.user_id);
    const email = emailById?.get?.(id) ?? emailById?.[id] ?? null;
    const displayName = nameById.get(id) ? String(nameById.get(id)) : null;
    return {
      userId: id,
      /** The configured username, or null — the UI falls back to `email`. */
      displayName,
      email: email || null,
      /** What the UI actually prints: display_name, else email, else a dash. */
      name: resolveIdentity({ displayName, email }),
      onlineSince: row.online_since || row.last_seen_at || null
    };
  });
}

/**
 * GET  /api/alerts?view=presence              -> { onlineCount, accessesToday }
 * GET  /api/alerts?view=presence&scope=admin  -> + users[] (admin only)
 * POST /api/alerts?view=presence              -> record, then the same aggregate
 *
 * POST is the heartbeat AND the access record. Anonymous callers are accepted on
 * POST because the approved semantics count anonymous visitors; they get no
 * presence row, only a place in the day's access set.
 */
export async function handlePresenceApi(req, res, deps = defaultDeps) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }

  const wantsAdmin = String(req.query?.scope || "") === "admin";

  // Admin scope is authorised BEFORE anything is read, so a non-admin never
  // reaches the code that assembles identities.
  if (wantsAdmin) {
    const admin = await deps.assertAdmin(req);
    if (!admin.ok) {
      return res.status(admin.status || 403).json({ ok: false, error: admin.error || "Neautorizat" });
    }
  }

  // Identity is optional outside the admin scope: an anonymous visitor still
  // counts. A present-but-invalid token is treated as anonymous rather than
  // rejected, so an expired session never blocks the page's activity badge.
  let requesterId = null;
  if (!wantsAdmin) {
    const requester = await deps.getRequester(req);
    if (requester.ok) requesterId = String(requester.user.id);
  } else {
    const admin = await deps.getRequester(req);
    if (admin.ok) requesterId = String(admin.user.id);
  }

  const supabase = deps.getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil" });
  }

  try {
    const today = deps.today();

    if (method === "POST") {
      const visitorKey = visitorKeyFor({
        userId: requesterId,
        visitorToken: req.headers?.[VISITOR_HEADER]
      });
      /*
        The anonymous token is client-generated, so a hostile client can mint a
        fresh one per request and manufacture "visitors". The existing per-IP
        hourly limiter is the guard — reused rather than reinvented, and applied
        ONLY to anonymous records: an authenticated visitor already deduplicates
        on their user id, which no client can forge.

        A rejection means the access is simply NOT COUNTED. It is not an error
        and it is not a refusal: the response below is identical either way, so
        the limiter can never become a way to probe anything, and it cannot leak
        identity because this branch has no identity to leak.
      */
      let mayRecord = true;
      if (!requesterId && visitorKey) {
        try {
          const verdict = await deps.checkAnonymousRateLimit(req, {
            namespace: ANON_RATE_NAMESPACE,
            maxPerHour: ANON_MAX_ACCESS_PER_HOUR
          });
          mayRecord = verdict?.ok !== false;
        } catch {
          // The limiter failing is not a reason to drop a legitimate visit, and
          // not a reason to fail the request either. Count it and move on.
          mayRecord = true;
        }
      }

      // No identity and no token: nothing can be deduplicated, so nothing is
      // written. Counting it would mean every such request is a new "visitor".
      if (mayRecord && (requesterId || visitorKey)) {
        const { error } = await supabase.rpc("record_user_presence", {
          p_user_id: requesterId,
          p_access_day: today,
          p_window_seconds: PRESENCE_WINDOW_SECONDS,
          p_visitor_key: visitorKey
        });
        // A failed write must not fail the read: a slightly stale count is
        // better than an error where a count belongs.
        if (error) console.warn("[presence.record_failed]", error.message || "rpc_error");
      }

      /*
        Retention, sampled and bounded, on the way past.

        Deliberately AFTER the record above and wrapped so it cannot affect it:
        today's access is the thing that matters, and a sweep that fails, times
        out or hits a lock must leave it untouched. The predicate is strictly
        `access_day < cutoff`, so this can never race today's insert or count.
      */
      if (deps.shouldSweep()) {
        try {
          const { error } = await supabase.rpc("cleanup_daily_access", {
            p_retention_days: DAILY_ACCESS_RETENTION_DAYS,
            p_max_rows: CLEANUP_MAX_ROWS
          });
          if (error) console.warn("[presence.cleanup_failed]", error.message || "rpc_error");
        } catch (error) {
          console.warn("[presence.cleanup_failed]", error?.message || "cleanup_error");
        }
      }
    }

    const cutoffIso = presenceCutoffIso(deps.now());
    const counts = await readCounts(supabase, { cutoffIso, today });

    if (!wantsAdmin) {
      // Deliberately constructed field by field. Spreading a row here is how an
      // identity ends up in a normal user's response by accident.
      return res.status(200).json({
        ok: true,
        onlineCount: counts.onlineCount,
        accessesToday: counts.accessesToday
      });
    }

    const users = await readOnlineUsers(supabase, deps, cutoffIso);
    return res.status(200).json({
      ok: true,
      onlineCount: counts.onlineCount,
      accessesToday: counts.accessesToday,
      users
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Activitatea nu a putut fi citită" });
  }
}

export default {
  handlePresenceApi,
  resolveIdentity,
  presenceCutoffIso,
  visitorKeyFor,
  PRESENCE_WINDOW_SECONDS,
  HEARTBEAT_MIN_INTERVAL_MS,
  VISITOR_HEADER,
  DAILY_ACCESS_RETENTION_DAYS,
  ANON_MAX_ACCESS_PER_HOUR
};
