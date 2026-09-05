import { fetchWithAuth } from "../utils/apiAuth";

/**
 * Client for the admin Global Tickets views on `/api/admin`.
 *
 * NOTHING HERE DECIDES ANYTHING. Which predictions are eligible, which leagues
 * take part, which selections a ticket contains and whether a variant can be
 * built are all server answers — this transports them. The browser sends a
 * variant and receives a ticket; it never sends a league, a user or a selection,
 * because the server would ignore all three and offering the parameter would
 * imply the client had a say.
 *
 * That is the difference from globalSpecialBetService, which is the USER path
 * and does send a league selection. The two must not converge.
 *
 * Modelled on referralAdminService: failures surface as a typed error with the
 * HTTP status attached, so the panel can tell "you are not an admin" from "the
 * server broke" without parsing prose — and so no server string is rendered raw.
 */

export const GLOBAL_VARIANTS = [3, 5, 8] as const;
export type GlobalVariant = (typeof GLOBAL_VARIANTS)[number];

/** Why a generation produced no ticket. Mirrors GLOBAL_TICKET_POOL_STATES. */
export type PoolState = "no_populated_predictions" | "insufficient_candidates" | "ok";

export type GlobalTicketSelection = {
  id: string | null;
  fixtureId: number;
  leagueId: number;
  kickoffAt: string;
  market: string;
  selection: string;
  side: string | null;
  line: number | null;
  odds: number | null;
  confidence: number | null;
  probability: number | null;
  fixtureLabel: string | null;
  leagueName: string | null;
  status: string | null;
};

export type GlobalTicket = {
  id: string;
  betDate: string;
  variant: number;
  betKind: string;
  systemK: number | null;
  status: string;
  betType: string;
  betSource: string;
  publishedAt: string | null;
  createdAt: string | null;
  settledAt: string | null;
  totalOdds: number | null;
  averageConfidence: number | null;
  ticketProbability: number | null;
  modelVersion: string | null;
  selections: GlobalTicketSelection[];
};

/**
 * Built, or explained. The two cases are disjoint and BOTH are successes.
 *
 * Named halves rather than an inline union so `available` keeps its LITERAL
 * type: widened to `boolean` it stops being a discriminant, and every caller
 * loses narrowing at the `if` — which is exactly what happened the first time.
 */
export type GenerateBuilt = {
  available: true;
  created: boolean;
  duplicate: boolean;
  ticket: GlobalTicket;
  candidatesAvailable: number;
  fixturesConsidered: number;
  leaguesConsidered: number;
};

export type GenerateUnavailable = {
  available: false;
  poolState: PoolState;
  variant: number;
  required: number;
  candidatesAvailable: number;
  fixturesConsidered: number;
  leaguesConsidered: number;
  rejected: Record<string, number>;
};

export type GenerateResult = GenerateBuilt | GenerateUnavailable;

/**
 * Narrow a generate result to its "nothing was built" half.
 *
 * An explicit type guard rather than `if (!result.available)`, because this
 * project compiles with `"strict": false` — and without `strictNullChecks`
 * TypeScript does NOT narrow a discriminated union on a boolean literal. The
 * plain `if` compiles as a boolean test and leaves the union intact, so every
 * field read inside it fails. A user-defined guard works regardless of the flag,
 * which is why the narrowing lives here instead of at each call site.
 */
export function isUnavailable(result: GenerateResult): result is GenerateUnavailable {
  return result.available === false;
}

export class GlobalTicketAdminError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "GlobalTicketAdminError";
    this.status = status;
    this.code = code;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function request(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetchWithAuth(url, init);
  const body = await readJson(res);
  if (!res.ok || body.ok !== true) {
    // The CODE travels, not the server's prose: the panel maps codes to its own
    // copy, so a database message can never reach a screen.
    const code = typeof body.error === "string" ? body.error : null;
    throw new GlobalTicketAdminError(code || `HTTP ${res.status}`, res.status, code);
  }
  return body;
}

/** The bounded admin list — drafts and published together, newest day first. */
export async function fetchGlobalTickets(): Promise<GlobalTicket[]> {
  const body = await request("/api/admin?view=global-tickets");
  return (body.tickets as GlobalTicket[]) || [];
}

/**
 * Generate one GLOBAL draft.
 *
 * The variant is the ONLY input. There is deliberately no parameter for leagues,
 * a user or a date: the server owns the candidate pool and picks the bet date.
 */
export async function generateGlobalTicket(variant: GlobalVariant): Promise<GenerateResult> {
  const body = await request("/api/admin?view=global-tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant })
  });

  if (body.available === false) {
    const unavailable: GenerateUnavailable = {
      available: false,
      poolState: body.poolState as PoolState,
      variant: Number(body.variant),
      required: Number(body.required),
      candidatesAvailable: Number(body.candidatesAvailable ?? 0),
      fixturesConsidered: Number(body.fixturesConsidered ?? 0),
      leaguesConsidered: Number(body.leaguesConsidered ?? 0),
      rejected: (body.rejected as Record<string, number>) || {}
    };
    return unavailable;
  }

  const built: GenerateBuilt = {
    available: true,
    created: body.created === true,
    duplicate: body.duplicate === true,
    ticket: body.ticket as GlobalTicket,
    candidatesAvailable: Number(body.candidatesAvailable ?? 0),
    fixturesConsidered: Number(body.fixturesConsidered ?? 0),
    leaguesConsidered: Number(body.leaguesConsidered ?? 0)
  };
  return built;
}

/** Release one draft. Explicit, separate from creation, and admin-only server-side. */
export async function publishGlobalTicket(id: string): Promise<GlobalTicket> {
  const body = await request("/api/admin?view=publish-global-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  return body.ticket as GlobalTicket;
}
