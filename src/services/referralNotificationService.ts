import { fetchWithAuth } from "../utils/apiAuth";

/**
 * Transport for referral bonus notifications.
 *
 * NO IDENTITY IS EVER REQUESTED OR SENT. The GET carries no parameters at all —
 * the caller is the session — and the POST carries grant ids and nothing else.
 * The invitee's name arrives from the server already resolved and already
 * sanitised; this layer must never look one up, because doing so would mean the
 * client querying another user's profile.
 */

export type ReferralBonusRole = "inviter" | "invitee";

export type ReferralBonus = {
  /** The grant's own uuid — the identity that makes "show once" possible. */
  grantId: string;
  role: ReferralBonusRole;
  days: number;
  /** Present only for inviter bonuses, and null when the invitee set no name. */
  inviteeName: string | null;
  grantedAt: string | null;
};

/** Guards against a malformed payload becoming "undefined zile Ultra" on screen. */
function toBonus(raw: unknown): ReferralBonus | null {
  const r = (raw ?? {}) as Partial<ReferralBonus>;
  const grantId = String(r.grantId ?? "");
  if (!grantId) return null;
  const role: ReferralBonusRole = r.role === "inviter" ? "inviter" : "invitee";
  const days = Number(r.days);
  return {
    grantId,
    role,
    days: Number.isFinite(days) && days > 0 ? days : 0,
    // An invitee bonus never carries a name, whatever the server sent.
    inviteeName: role === "inviter" && r.inviteeName ? String(r.inviteeName) : null,
    grantedAt: r.grantedAt ? String(r.grantedAt) : null
  };
}

/**
 * Unacknowledged referral bonuses for the signed-in user.
 *
 * Resolves to an empty list on ANY failure rather than rejecting. A missing
 * notification is invisible; a rejected promise on the boot path is a broken app,
 * and this is the least important request the workspace makes.
 */
/**
 * Every referral bonus ever received, for Account > Notifications.
 *
 * The header notice lasts five seconds; this is where the full wording lives
 * afterwards, so a user who looked away has not lost the news.
 */
export async function fetchReferralBonusHistory(): Promise<ReferralBonus[]> {
  return readBonuses("/api/referral?view=bonus&history=1");
}

export async function fetchReferralBonuses(): Promise<ReferralBonus[]> {
  return readBonuses("/api/referral?view=bonus");
}

async function readBonuses(url: string): Promise<ReferralBonus[]> {
  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { ok?: boolean; bonuses?: unknown[] };
    if (json?.ok !== true || !Array.isArray(json.bonuses)) return [];
    return json.bonuses.map(toBonus).filter((b): b is ReferralBonus => b !== null);
  } catch {
    return [];
  }
}

/**
 * Mark bonuses as shown. Best effort by design.
 *
 * A failed acknowledgement means the toast reappears next session — mildly
 * annoying, and strictly better than letting a failed write surface as an error
 * over a reward the user genuinely received.
 */
export async function acknowledgeReferralBonuses(grantIds: string[]): Promise<boolean> {
  if (grantIds.length === 0) return true;
  try {
    const res = await fetchWithAuth("/api/referral?view=bonus-ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantIds })
    });
    return res.ok;
  } catch {
    return false;
  }
}
