import { fetchWithAuth } from "../utils/apiAuth";
import type {
  GlobalSpecialBet,
  GlobalSpecialBetGenerateResult,
  GlobalSpecialBetKind,
  GlobalSpecialBetSelection,
  GlobalSpecialBetLeagueSummary
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
  leagueSummary?: unknown;
};

const idList = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []);

/** Accept only the documented shape; anything else is "no summary", never a guess. */
function asLeagueSummary(value: unknown): GlobalSpecialBetLeagueSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const names: Record<string, string> = {};
  if (v.names && typeof v.names === "object") {
    for (const [id, name] of Object.entries(v.names as Record<string, unknown>)) if (typeof name === "string" && name.trim()) names[id] = name;
  }
  return {
    selectedLeagueIds: idList(v.selectedLeagueIds),
    eligibleLeagueIds: idList(v.eligibleLeagueIds),
    noEligibleLeagueIds: idList(v.noEligibleLeagueIds),
    noEligibleBecauseAlreadyStartedLeagueIds: idList(v.noEligibleBecauseAlreadyStartedLeagueIds),
    names
  };
}

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
  /**
   * Omitted for a Combo, which keeps the exact request this app has always
   * sent. "system" asks for the Bilet Sistem — five selections, at least three
   * of which must win. There is deliberately no `system_k`: the server owns the
   * k, and a request carrying one is refused with 400.
   */
  betKind?: "system";
}): Promise<GlobalSpecialBetGenerateResult> {
  const res = await fetchWithAuth("/api/special-bets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bet_date: params.betDate,
      variant: params.variant,
      leagueIds: params.leagueIds,
      ...(params.betKind ? { bet_kind: params.betKind } : {})
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
  const leagueSummary = asLeagueSummary(json.leagueSummary);
  return {
    available: true,
    created: Boolean(json.created),
    bet: { ...bet, selections: asSelections(json.selections) },
    ...(leagueSummary ? { leagueSummary } : {})
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

/**
 * Published Global Bets — the product's own tickets, read-only for consumers.
 *
 * There is deliberately NO parameter for owner, bet type or publication state.
 * The server fixes `bet_type = GLOBAL` and `published_at IS NOT NULL`, so a
 * draft and another user's ticket are not things this call can ask for. The
 * only input is the page size, and the server caps that too.
 *
 * Distinct from `fetchGlobalSpecialBets` above, which is the USER path despite
 * the historical "GlobalSpecialBet" name — that one lists the caller's OWN
 * tickets. The two must not be confused: `bet_type` is the real distinction.
 */
export async function fetchPublishedGlobalBets(limit?: number): Promise<GlobalSpecialBet[]> {
  const qs = new URLSearchParams({ scope: "global" });
  if (limit != null) qs.set("limit", String(limit));

  const res = await fetchWithAuth(`/api/special-bets?${qs.toString()}`);
  const json = await readEnvelope(res);
  assertOk(res, json);

  if (!Array.isArray(json.bets)) return [];
  return (json.bets as GlobalSpecialBet[]).map((bet) => ({
    ...bet,
    selections: asSelections(bet?.selections)
  }));
}
