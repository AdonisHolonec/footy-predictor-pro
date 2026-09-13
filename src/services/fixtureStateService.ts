import { fetchWithAuth } from "../utils/apiAuth";

/**
 * Read-only client for real fixture state — status, minute and score.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 * It is not a settlement source and it never becomes one. A score says what
 * happened on the pitch; whether a PICK came in is `special_bet_selections.status`,
 * written by the settlement engine. The two are carried side by side and never
 * derived from each other: a 2-1 does not make a bet won, and a won bet does not
 * license printing a score nobody sent us.
 *
 * ── WHY A SEPARATE CLIENT ────────────────────────────────────────────────────
 * `useLiveFixtureScorePoll` already reads this endpoint, but it is a polling
 * hook bound to `PredictionRow[]`: it decides WHICH rows are worth polling, owns
 * an interval, and merges momentum/narrative into prediction rows. None of that
 * applies to an admin panel that wants one snapshot for eight ids on demand.
 * Reusing it would mean bending a polling loop around a one-shot read; this is
 * the same HTTP contract with none of the lifecycle.
 *
 * NO POLLING LIVES HERE. One call per Details expansion. The endpoint already
 * caches upstream (45-180 s), so a reopened panel costs a cache hit, not a fetch
 * for every leg.
 */

/** Upstream `/fixtures` cap. A Global ticket holds at most 8 legs, so chunking is defence, not routine. */
export const FIXTURE_STATE_BATCH_LIMIT = 40;

export type FixtureState = {
  id: number;
  /** Upstream short code exactly as sent: NS, 1H, HT, 2H, FT, AET, PEN, PST, CANC… Never rewritten. */
  status: string;
  /** Minutes played, or null when upstream does not know. Never coerced to 0. */
  elapsed: number | null;
  inPlay: boolean;
  score: { home: number | null; away: number | null };
};

type LiveFixturePayload = {
  ok?: boolean;
  fixtures?: Array<{
    id?: number | string;
    status?: string;
    elapsed?: number | null;
    inPlay?: boolean;
    score?: { home?: number | null; away?: number | null } | null;
  }>;
};

/**
 * Only a real number survives.
 *
 * `Number(null)` is 0 and `Number("")` is 0, so a missing score would arrive as
 * a confident nil-nil — the single most damaging thing this file could do. The
 * server already guards `elapsed` the same way for the same reason.
 */
function finiteOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Unique, finite, positive ids in first-seen order. */
export function normalizeFixtureIds(ids: readonly unknown[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of ids || []) {
    const id = finiteOrNull(raw);
    if (id == null || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Fetch fixture state for a set of ids.
 *
 * Deduplicated first, so eight legs sharing one fixture cost one id, not eight.
 * Returns a Map keyed by fixture id; ids the server did not answer for are
 * simply ABSENT rather than present-and-empty, which is what lets the caller
 * distinguish "no data" from "no goals".
 *
 * Never throws for a partial answer: one failed chunk leaves its ids missing and
 * the rest still render. A caller that gets an empty Map shows its neutral state
 * — it must not interpret silence as a result.
 */
export async function fetchFixtureStates(ids: readonly unknown[]): Promise<Map<number, FixtureState>> {
  const unique = normalizeFixtureIds(ids);
  const out = new Map<number, FixtureState>();
  if (!unique.length) return out;

  for (const batch of chunk(unique, FIXTURE_STATE_BATCH_LIMIT)) {
    const res = await fetchWithAuth(`/api/fixtures?view=live&ids=${encodeURIComponent(batch.join(","))}`);
    if (!res.ok) continue;
    let body: LiveFixturePayload;
    try {
      body = (await res.json()) as LiveFixturePayload;
    } catch {
      continue;
    }
    if (body?.ok !== true || !Array.isArray(body.fixtures)) continue;

    for (const fx of body.fixtures) {
      const id = finiteOrNull(fx?.id);
      if (id == null) continue;
      out.set(id, {
        id,
        status: typeof fx?.status === "string" ? fx.status : "",
        elapsed: finiteOrNull(fx?.elapsed),
        inPlay: fx?.inPlay === true,
        score: { home: finiteOrNull(fx?.score?.home), away: finiteOrNull(fx?.score?.away) }
      });
    }
  }

  return out;
}
