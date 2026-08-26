import { fetchWithAuth } from "../utils/apiAuth";

/**
 * Client for the admin referral views on `/api/admin`.
 *
 * Modelled on adminInboxService: failures surface as a typed error with the HTTP
 * status attached, so the panel can tell "you are not an admin" from "the server
 * broke" without parsing a message — and so no server string is ever rendered raw.
 *
 * NOTHING HERE DECIDES ANYTHING. Cap arithmetic, eligibility, the IP verdict and
 * every state transition belong to the server; this transports the answer. That is
 * why `ReferralAdminRow` has no `ipHash` field — the payload does not carry one.
 */

export const REFERRAL_PAGE_SIZE = 25;

export type ReferralState = "attributed" | "qualified" | "rewarded" | "expired" | "rejected" | "reversed";

export type ReferralFilter =
  | "all"
  | "attributed"
  | "qualified"
  | "rewarded"
  | "expired"
  | "reversed"
  | "rejected"
  | "unrewarded";

/** A soft signal for a human. Never a verdict, never an action. */
export type IpSignal = "match" | "different" | "unavailable";

export type ReferralGrantView = {
  grantId: string;
  days: number;
  effectiveUntil: string | null;
  revoked: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
};

export type ReferralAdminRow = {
  id: string;
  idShort: string | null;
  inviterIdShort: string | null;
  inviteeIdShort: string | null;
  inviterId: string;
  inviteeId: string;
  inviterEmail: string | null;
  inviteeEmail: string | null;
  inviterEmailMasked: string | null;
  inviteeEmailMasked: string | null;
  code: string;
  state: ReferralState;
  attributedAt: string | null;
  expiresAt: string | null;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  inviterRewardedAt: string | null;
  inviteeRewardedAt: string | null;
  /** Rewarded, but the inviter was at their lifetime cap and earned nothing. */
  inviterCapped: boolean;
  /** Earned but not delivered — the queue that should be empty. */
  unrewarded: boolean;
  reason: string | null;
  ipSignal: IpSignal;
  inviterGrant: ReferralGrantView | null;
  inviteeGrant: ReferralGrantView | null;
};

export type ReferralAdminPage = {
  filter: ReferralFilter;
  total: number;
  limit: number;
  offset: number;
  windowDays: number;
  referrals: ReferralAdminRow[];
};

export class ReferralAdminError extends Error {
  status: number;

  /** A stable reason code from the server, when it sent one. Never prose. */
  reason: string;

  constructor(status: number, reason: string) {
    super(`referral admin request failed (${status})`);
    this.name = "ReferralAdminError";
    this.status = status;
    this.reason = reason;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON body is a gateway or server failure, not a payload to inspect.
    throw new ReferralAdminError(res.status, "");
  }
}

/** One page of referral records, newest first. */
export async function fetchReferralPage(params: {
  filter?: ReferralFilter;
  limit?: number;
  offset?: number;
}): Promise<ReferralAdminPage> {
  const qs = new URLSearchParams({ view: "referrals", filter: params.filter ?? "all" });
  qs.set("limit", String(params.limit ?? REFERRAL_PAGE_SIZE));
  if (params.offset) qs.set("offset", String(params.offset));

  const res = await fetchWithAuth(`/api/admin?${qs.toString()}`);
  const json = await readJson(res);
  if (!res.ok || json?.ok !== true) {
    throw new ReferralAdminError(res.status, String(json?.reason || json?.error || ""));
  }
  return {
    filter: (json.filter as ReferralFilter) ?? "all",
    total: Number(json.total) || 0,
    limit: Number(json.limit) || REFERRAL_PAGE_SIZE,
    offset: Number(json.offset) || 0,
    windowDays: Number(json.windowDays) || 30,
    referrals: Array.isArray(json.referrals) ? (json.referrals as ReferralAdminRow[]) : []
  };
}

/**
 * Reverse a rewarded referral.
 *
 * Sends an attribution id and a reason and nothing else — the server resolves both
 * grants from the attribution inside one transaction, so there is no grant id for a
 * client to get wrong.
 */
export async function reverseReferral(attributionId: string, reason: string): Promise<{ state: string }> {
  const res = await fetchWithAuth("/api/admin?view=reverse-referral", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attributionId, reason })
  });
  const json = await readJson(res);
  if (!res.ok || json?.ok !== true) {
    throw new ReferralAdminError(res.status, String(json?.reason || json?.error || ""));
  }
  return { state: String(json.state || "reversed") };
}

/**
 * Finish an earned-but-undelivered reward.
 *
 * Idempotent server-side, so a double click converges rather than paying twice — the
 * button does not need to guard against itself for correctness, only for clarity.
 */
export async function retryReferralReward(attributionId: string): Promise<{ reason: string | null }> {
  const res = await fetchWithAuth("/api/admin?view=retry-referral-reward", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attributionId })
  });
  const json = await readJson(res);
  if (!res.ok || json?.ok !== true) {
    throw new ReferralAdminError(res.status, String(json?.reason || json?.error || ""));
  }
  return { reason: json.reason ? String(json.reason) : null };
}
