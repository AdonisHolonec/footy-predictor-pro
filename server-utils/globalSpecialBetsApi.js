/**
 * server-utils/globalSpecialBetsApi.js — HTTP layer for Global Special Bet:
 * generate a snapshot, or read the ones already stored.
 *
 * The client sends intent only. It cannot supply selections, odds, confidence,
 * value scores or a user id: the server derives the user from the verified
 * session and rebuilds the pool from `predictions_history.raw_payload` through
 * server-utils/globalSpecialBetEngine.js.
 *
 * This lives in server-utils rather than in its own api/ file because Vercel
 * Hobby caps a deployment at 12 serverless functions and the project is at the
 * cap. `/api/special-bets` is a rewrite onto `/api/history?view=special-bets`,
 * the same consolidation `/api/stripe-webhook` uses onto api/billing.js. The
 * public URL is unchanged; only the function count is.
 */

import { getRequester } from "./authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "./supabaseAdmin.js";
import {
  canonicalizeLeagueScope,
  createGlobalSpecialBet,
  createGlobalSystemBets,
  isValidBetDate,
  isValidBetKind,
  isValidVariant,
  listGlobalSpecialBets
} from "./globalSpecialBets.js";
import { SYSTEM_SELECTION_COUNT } from "./globalSpecialBetEngine.js";

/**
 * A user may only bet on leagues they actually follow. `profiles.favorite_leagues`
 * is the existing source of that truth (useAuth.ts reads and writes it), so the
 * request is checked against it rather than against a list the client asserts.
 */
async function assertLeagueAccess(userId, leagueIds) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select("favorite_leagues")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "Nu am putut încărca ligile favorite." };

  const favorites = new Set((data?.favorite_leagues || []).map((id) => Number(id)));
  if (favorites.size === 0) {
    return { ok: false, status: 400, error: "Nu ai nicio ligă favorită selectată." };
  }
  const outside = leagueIds.filter((id) => !favorites.has(id));
  if (outside.length > 0) {
    return { ok: false, status: 403, error: `Ligi în afara favoritelor: ${outside.join(", ")}.` };
  }
  return { ok: true };
}

/**
 * The only k the public product sells.
 *
 * SYSTEM_K_VALUES = [3, 4, 5] stays what it is — generic infrastructure the
 * settlement engine, migration 054 and the tests all validate against, because
 * the engine can grade any k-of-n and a row already stored at k=4 must remain
 * settleable. What the PRODUCT offers is narrower, and this is where that
 * narrowing lives: one constant, at the boundary the public reaches.
 *
 * A "Bilet Sistem" is five selections of which at least three must win. There is
 * no 4/5 and no 5/5 on sale, so there is nothing to choose and no parameter to
 * carry a choice.
 */
const SYSTEM_PRODUCT_K = 3;

/**
 * Does the body try to set the k itself?
 *
 * Presence is the test, not value: `system_k: 3` is refused exactly like
 * `system_k: 4`. Accepting the one that happens to match today's product would
 * teach clients that k is theirs to send, and the day the product moved, those
 * clients would silently be asking for something else. `hasOwnProperty` rather
 * than a truthiness check, so `null` and an explicit `undefined` are caught too.
 */
function carriesClientSystemK(body) {
  return (
    Object.prototype.hasOwnProperty.call(body, "system_k") ||
    Object.prototype.hasOwnProperty.call(body, "systemK")
  );
}

/**
 * What the client asked for, or why it cannot have it.
 *
 * Pure and exported so the whole create contract can be tested without a
 * database or a session: everything below is a decision about the request, and
 * none of it needs either. `systemK` is an OUTPUT of this function, never an
 * input — the request has no say in it.
 */
export function parseCreateRequest(rawBody) {
  const body = typeof rawBody === "object" && rawBody ? rawBody : {};
  const refuse = (error) => ({ ok: false, status: 400, error });

  // Absent means combo. Every client written before System existed keeps working
  // unchanged, and nothing about the combo path moves.
  const betKind = body.bet_kind ?? body.betKind ?? "combo";
  if (!isValidBetKind(betKind)) return refuse("bet_kind invalid (permise: combo, system).");

  // REFUSED, never ignored. Silently overriding the client's k would hand a 3/5
  // to a caller that believes it bought a 4/5 — a different product under the
  // same response. The server owns k; a request that disagrees is wrong, and is
  // told so before anything is built or written.
  if (carriesClientSystemK(body)) {
    return refuse("system_k nu poate fi trimis: produsul îl stabileşte serverul.");
  }

  const betDate = body.bet_date ?? body.betDate;
  if (!isValidBetDate(betDate)) return refuse("bet_date invalid (aşteptat YYYY-MM-DD).");

  const variant = body.variant;
  if (!isValidVariant(variant)) return refuse("variant invalid (permise: 3, 5, 8).");
  // A System is exactly five selections. 3 and 8 are valid combo variants and
  // not this product, so they are refused by name rather than quietly corrected
  // to 5 — and `variant` is never derived from k, which the request cannot send.
  if (betKind === "system" && Number(variant) !== SYSTEM_SELECTION_COUNT) {
    return refuse(`Biletul Sistem are exact ${SYSTEM_SELECTION_COUNT} selecţii (variant ${SYSTEM_SELECTION_COUNT}).`);
  }

  const { leagueIds } = canonicalizeLeagueScope(body.leagueIds ?? body.league_ids);
  if (leagueIds.length === 0) return refuse("leagueIds lipsesc sau sunt invalide.");

  return {
    ok: true,
    betKind,
    betDate,
    variant: Number(variant),
    leagueIds,
    // The product's k, decided here and nowhere else. Null for a combo, which
    // has no k at all — migration 052 stores NULL for exactly that reason.
    systemK: betKind === "system" ? SYSTEM_PRODUCT_K : null
  };
}

async function handlePost(req, res, userId) {
  const parsed = parseCreateRequest(req.body);
  if (!parsed.ok) return res.status(parsed.status).json({ ok: false, error: parsed.error });

  const access = await assertLeagueAccess(userId, parsed.leagueIds);
  if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });

  // One call, one ticket. The k is the parsed product constant, never the request's.
  const result =
    parsed.betKind === "system"
      ? await createGlobalSystemBets({
          userId,
          betDate: parsed.betDate,
          leagueIds: parsed.leagueIds,
          systemK: parsed.systemK
        })
      : await createGlobalSpecialBet({
          userId,
          betDate: parsed.betDate,
          variant: parsed.variant,
          leagueIds: parsed.leagueIds
        });

  // Too few eligible selections: an explicit answer, and nothing written.
  if (result.available === false) return res.status(200).json(result);

  // 201 only when this request actually created the row; a repeat gets 200 and
  // the same entity, which is what makes the endpoint safe to retry.
  return res.status(result.created ? 201 : 200).json(result);
}

async function handleGet(req, res, userId) {
  const { variant, kind, bet_date: betDate, limit, offset } = req.query || {};

  if (variant !== undefined && variant !== "" && !isValidVariant(variant)) {
    return res.status(400).json({ ok: false, error: "variant invalid (permise: 3, 5, 8)." });
  }
  // READ-ONLY NARROWING. `kind` chooses which product to list. It cannot ask for one to
  // be built — no route accepts a k, and nothing here calls the system builder — so this
  // is not an entry point for System. Omitted, the behaviour is exactly what it was:
  // every kind, newest first.
  if (kind !== undefined && kind !== "" && !isValidBetKind(kind)) {
    return res.status(400).json({ ok: false, error: "kind invalid (permise: combo, system)." });
  }
  if (betDate && !isValidBetDate(betDate)) {
    return res.status(400).json({ ok: false, error: "bet_date invalid (aşteptat YYYY-MM-DD)." });
  }

  const { bets } = await listGlobalSpecialBets({ userId, variant, betKind: kind, betDate, limit, offset });
  return res.status(200).json({ ok: true, bets });
}

/**
 * Entry point for `/api/special-bets`, reached through the rewrite in
 * vercel.json. Behaves exactly as a standalone handler would.
 */
export async function handleGlobalSpecialBets(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
  }

  const requester = await getRequester(req);
  if (!requester.ok) {
    return res.status(requester.status || 401).json({ ok: false, error: requester.error || "Neautorizat" });
  }

  const cfg = assertSupabaseConfigured();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });

  // Never from the body: the session decides whose bet this is.
  const userId = requester.user.id;

  try {
    return req.method === "POST"
      ? await handlePost(req, res, userId)
      : await handleGet(req, res, userId);
  } catch (error) {
    console.error("[special-bets]", error?.message || error);
    return res.status(500).json({ ok: false, error: "Nu am putut procesa cererea Special Bet." });
  }
}
