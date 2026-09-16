import { fetchWithAuth } from "../utils/apiAuth";

/**
 * Transport for the activity indicator.
 *
 * The aggregate shape is deliberately two integers. A normal user's response
 * carries no user id, no display name and no email — not filtered out on the
 * client, but never sent: see server-utils/presenceApi.js, which constructs the
 * non-admin body field by field.
 */
export type ActivityStats = {
  onlineCount: number;
  accessesToday: number;
};

/** Admin-only. Returned solely to a request that passed `assertAdmin` server-side. */
export type OnlineUser = {
  userId: string;
  /** The configured username (profiles.display_name), or null. */
  displayName: string | null;
  email: string | null;
  /** display_name, else email, else a dash — resolved server-side. */
  name: string;
  onlineSince: string | null;
};

export type AdminActivityStats = ActivityStats & { users: OnlineUser[] };

const ENDPOINT = "/api/alerts?view=presence";
const VISITOR_HEADER = "x-fp-visitor";
const VISITOR_STORAGE_KEY = "fp_visitor_session";

/**
 * A random token identifying this BROWSER SESSION, not this person.
 *
 * sessionStorage, not localStorage, and not a cookie: the browser discards it
 * when the session ends, so it cannot become a permanent anonymous identity and
 * there is nothing to correlate across days. The server only ever stores a hash
 * of it, and no IP is read anywhere in this feature.
 *
 * Returns null when storage is unavailable (private mode, blocked site data).
 * The request then carries no token and the visit simply is not counted —
 * preferable to inventing a fresh token per request, which would make one
 * visitor look like dozens.
 */
function visitorToken(): string | null {
  try {
    const existing = sessionStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(VISITOR_STORAGE_KEY, token);
    return token;
  } catch {
    return null;
  }
}

function visitorHeaders(): Record<string, string> {
  const token = visitorToken();
  return token ? { [VISITOR_HEADER]: token } : {};
}

function toStats(payload: unknown): ActivityStats {
  const row = (payload ?? {}) as Record<string, unknown>;
  const online = Number(row.onlineCount);
  const accesses = Number(row.accessesToday);
  return {
    onlineCount: Number.isFinite(online) && online > 0 ? Math.floor(online) : 0,
    accessesToday: Number.isFinite(accesses) && accesses > 0 ? Math.floor(accesses) : 0
  };
}

/**
 * Record this visit, and read the aggregate in the same round trip.
 *
 * One request rather than two: the visitor is announcing themselves and asking
 * who else is here, and splitting that would double the traffic for no extra
 * information. Works signed out — an anonymous visitor counts toward the day's
 * accesses but never toward `onlineCount`.
 */
export async function sendHeartbeat(): Promise<ActivityStats> {
  const res = await fetchWithAuth(ENDPOINT, { method: "POST", headers: visitorHeaders() });
  if (!res.ok) throw new Error(`presence_heartbeat_${res.status}`);
  return toStats(await res.json());
}

/** Read-only aggregate: records nothing, so rendering never inflates a count. */
export async function fetchActivityStats(): Promise<ActivityStats> {
  const res = await fetchWithAuth(ENDPOINT);
  if (!res.ok) throw new Error(`presence_read_${res.status}`);
  return toStats(await res.json());
}

/**
 * The nominal list. A non-admin caller gets 403 from the server — this function
 * existing in the bundle grants nothing, because the authorisation is not here.
 */
export async function fetchAdminActivity(): Promise<AdminActivityStats> {
  const res = await fetchWithAuth(`${ENDPOINT}&scope=admin`);
  if (!res.ok) throw new Error(`presence_admin_${res.status}`);
  const payload = (await res.json()) as Record<string, unknown>;
  const users = Array.isArray(payload.users) ? (payload.users as OnlineUser[]) : [];
  return { ...toStats(payload), users };
}
