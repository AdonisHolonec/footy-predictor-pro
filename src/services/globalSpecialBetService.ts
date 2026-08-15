import { fetchWithAuth } from "../utils/apiAuth";
import type {
  GlobalSpecialBet,
  GlobalSpecialBetGenerateResult,
  GlobalSpecialBetKind,
  GlobalSpecialBetSelection
} from "../types/globalSpecialBet";

/**
 * HTTP client for `/api/special-bets`.
 *
 * The client sends INTENT only — date, variant, leagues. It never sends a
 * selection, an odd, a confidence or a user id: the server derives the user from
 * the verified session and rebuilds the candidate pool itself.
 */

/** Carries the HTTP status so callers can distinguish auth from access from failure. */
export class GlobalSpecialBetApiError extends Error {
  readonly status: number;
  /** The server's own message when it supplied one — preferred over any generic copy. */
  readonly apiMessage: string | null;

  constructor(status: number, apiMessage: string | null) {
    super(apiMessage || `special-bets request failed with ${status}`);
    this.name = "GlobalSpecialBetApiError";
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

type ApiEnvelope = {
  ok?: boolean;
  error?: string;
  bets?: unknown;
  bet?: unknown;
  selections?: unknown;
  created?: boolean;
  available?: boolean;
  variant?: number;
  required?: number;
  availableCandidates?: number;
};

async function readEnvelope(res: Response): Promise<ApiEnvelope> {
  try {
    return (await res.json()) as ApiEnvelope;
  } catch {
    return {};
  }
}

/**
 * A non-ok response is an error even when the body is unreadable — a 500 must
 * never be mistaken for "not enough selections", which is a 200 with
 * `available: false`.
 */
function assertOk(res: Response, json: ApiEnvelope): void {
  if (res.ok && json.ok !== false) return;
  throw new GlobalSpecialBetApiError(res.status, typeof json.error === "string" ? json.error : null);
}

function asSelections(value: unknown): GlobalSpecialBetSelection[] {
  return Array.isArray(value) ? (value as GlobalSpecialBetSelection[]) : [];
}

/**
 * Ask the server to build (or return) the bet for one date/variant/league scope.
 *
 * POST answers with the snapshot itself, so the UI renders from this result and
 * does not follow up with a GET. Repeating the call is safe: the database owns
 * idempotency and returns the same entity with `created: false`.
 */
export async function generateGlobalSpecialBet(params: {
  betDate: string;
  variant: number;
  leagueIds: number[];
}): Promise<GlobalSpecialBetGenerateResult> {
  const res = await fetchWithAuth("/api/special-bets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bet_date: params.betDate,
      variant: params.variant,
      leagueIds: params.leagueIds
    })
  });
  const json = await readEnvelope(res);
  assertOk(res, json);

  // Too few eligible selections: a product state, not a failure. Nothing was written.
  if (json.available === false) {
    return {
      available: false,
      created: false,
      unavailable: {
        available: false,
        variant: Number(json.variant),
        required: Number(json.required),
        availableCandidates: Number(json.availableCandidates)
      }
    };
  }

  // POST returns bet and selections as siblings; GET nests them. Normalise here
  // so every consumer sees one shape.
  const bet = json.bet as GlobalSpecialBet | undefined;
  if (!bet || typeof bet !== "object") {
    throw new GlobalSpecialBetApiError(res.status, null);
  }
  return {
    available: true,
    created: Boolean(json.created),
    bet: { ...bet, selections: asSelections(json.selections) }
  };
}

/**
 * The user's stored bets, newest first. Reads the snapshot and nothing else —
 * no engine, no recomputation.
 */
export async function listGlobalSpecialBets(params?: {
  variant?: number;
  /** Narrow to one product. Omitted returns every kind — the existing behaviour. */
  kind?: GlobalSpecialBetKind;
  betDate?: string;
  limit?: number;
  offset?: number;
}): Promise<GlobalSpecialBet[]> {
  const qs = new URLSearchParams();
  if (params?.variant != null) qs.set("variant", String(params.variant));
  // Variant cannot stand in for kind — Combo 5 and Systems 3/5, 4/5 and 5/5 share it.
  if (params?.kind) qs.set("kind", params.kind);
  if (params?.betDate) qs.set("bet_date", params.betDate);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));

  const suffix = qs.toString();
  const res = await fetchWithAuth(`/api/special-bets${suffix ? `?${suffix}` : ""}`);
  const json = await readEnvelope(res);
  assertOk(res, json);

  if (!Array.isArray(json.bets)) return [];
  return (json.bets as GlobalSpecialBet[]).map((bet) => ({
    ...bet,
    selections: asSelections(bet?.selections)
  }));
}
