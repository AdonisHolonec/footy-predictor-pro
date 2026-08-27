import { fetchWithAuth } from "../utils/apiAuth";

/**
 * Client for the user-facing referral endpoints on `/api/referral`.
 *
 * NO BUSINESS LOGIC LIVES HERE. The cap, the 30-day window, qualification,
 * eligibility and every self-referral rule are decided server-side; this transports
 * the answer. `InviterMetrics.successful` in particular is the server's count of
 * `inviter_rewarded_at IS NOT NULL AND state <> 'reversed'` — the client must never
 * derive it from `state`, because a capped referral is `rewarded` while the inviter
 * earned nothing.
 *
 * Failures surface as a typed error carrying the HTTP status, so the card can map
 * 404/409/410/429 to sentences a person can act on without ever rendering a server
 * string. No raw message from PostgREST or Postgres reaches a user.
 */

export type ReferralInviteeState = "attributed" | "qualified" | "rewarded" | "expired" | "rejected" | "reversed";

export type InviterMetrics = {
  attributed: number;
  qualified: number;
  /** Kept for shape compatibility; carries the same corrected number as `successful`. */
  rewarded: number;
  /** Referrals that actually PAID this inviter. The only "successful" worth showing. */
  successful: number;
  earnedDays: number;
  capRemaining: number;
  cap: number;
};

export type InviteeStatus = {
  state: ReferralInviteeState;
  attributedAt: string | null;
  expiresAt: string | null;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  expired: boolean;
};

export type ReferralStatus = {
  hasReferralCode: boolean;
  code: string | null;
  inviter: InviterMetrics;
  invitee: InviteeStatus | null;
};

export class ReferralError extends Error {
  status: number;

  /** Stable reason code from the server. Never prose, never rendered raw. */
  reason: string;

  constructor(status: number, reason: string) {
    super(`referral request failed (${status})`);
    this.name = "ReferralError";
    this.status = status;
    this.reason = reason;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON body is a gateway failure, not a payload to inspect.
    throw new ReferralError(res.status, "");
  }
}

/**
 * Defensive shaping.
 *
 * The card renders numbers into sentences, and `undefined` reaching a template
 * produces "undefined zile Ultra" rather than an error anyone would notice in
 * review. Coercing here keeps every downstream component free of `?? 0` noise.
 */
function toMetrics(raw: unknown): InviterMetrics {
  const m = (raw ?? {}) as Partial<InviterMetrics>;
  return {
    attributed: Number(m.attributed) || 0,
    qualified: Number(m.qualified) || 0,
    rewarded: Number(m.rewarded) || 0,
    successful: Number(m.successful) || 0,
    earnedDays: Number(m.earnedDays) || 0,
    capRemaining: Number(m.capRemaining) || 0,
    cap: Number(m.cap) || 0
  };
}

/** The caller's own referral status. ONE request per account mount — never polled. */
export async function fetchReferralStatus(): Promise<ReferralStatus> {
  const res = await fetchWithAuth("/api/referral?view=status");
  const json = await readJson(res);
  if (!res.ok || json?.ok !== true) {
    throw new ReferralError(res.status, String(json?.reason || json?.error || ""));
  }
  const referral = (json.referral ?? {}) as Record<string, unknown>;
  return {
    hasReferralCode: Boolean(referral.hasReferralCode),
    code: referral.code ? String(referral.code) : null,
    inviter: toMetrics(referral.inviter),
    invitee: (referral.invitee as InviteeStatus | null) ?? null
  };
}

/**
 * Issue the caller's own code, creating one on first ask.
 *
 * Separate from status because status is a read on every account visit while this
 * writes a row; a user who never opens the referral card never gets a code minted.
 */
export async function fetchOrCreateReferralCode(): Promise<string> {
  const res = await fetchWithAuth("/api/referral?view=code");
  const json = await readJson(res);
  if (!res.ok || json?.ok !== true) {
    throw new ReferralError(res.status, String(json?.reason || json?.error || ""));
  }
  return String(json.code || "");
}

/**
 * Accept an invitation.
 *
 * Sends ONLY the code. The invitee is taken from the verified session server-side,
 * so there is deliberately no user id, inviter id, tier or entitlement field to get
 * wrong — or to forge.
 */
export async function claimReferral(code: string): Promise<{ state: string; expiresAt: string | null }> {
  const res = await fetchWithAuth("/api/referral?view=claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  const json = await readJson(res);
  if (!res.ok || json?.ok !== true) {
    throw new ReferralError(res.status, String(json?.reason || json?.error || ""));
  }
  const attribution = (json.attribution ?? {}) as Record<string, unknown>;
  return {
    state: String(attribution.state || "attributed"),
    expiresAt: attribution.expiresAt ? String(attribution.expiresAt) : null
  };
}
