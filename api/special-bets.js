/**
 * api/special-bets.js — Global Special Bet: generate a snapshot, or read the
 * ones already stored.
 *
 * The client sends intent only. It cannot supply selections, odds, confidence,
 * value scores or a user id: the server derives the user from the verified
 * session and rebuilds the pool from `predictions_history.raw_payload` through
 * server-utils/globalSpecialBetEngine.js.
 *
 * Settlement is deliberately not here — a stored bet stays 'pending' until the
 * settlement increment lands.
 */

import { getRequester } from "../server-utils/authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../server-utils/supabaseAdmin.js";
import {
  canonicalizeLeagueScope,
  createGlobalSpecialBet,
  isValidBetDate,
  isValidVariant,
  listGlobalSpecialBets
} from "../server-utils/globalSpecialBets.js";

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

async function handlePost(req, res, userId) {
  const body = typeof req.body === "object" && req.body ? req.body : {};
  const betDate = body.bet_date ?? body.betDate;
  const variant = body.variant;

  if (!isValidBetDate(betDate)) {
    return res.status(400).json({ ok: false, error: "bet_date invalid (aşteptat YYYY-MM-DD)." });
  }
  if (!isValidVariant(variant)) {
    return res.status(400).json({ ok: false, error: "variant invalid (permise: 3, 5, 8)." });
  }

  const { leagueIds } = canonicalizeLeagueScope(body.leagueIds ?? body.league_ids);
  if (leagueIds.length === 0) {
    return res.status(400).json({ ok: false, error: "leagueIds lipsesc sau sunt invalide." });
  }

  const access = await assertLeagueAccess(userId, leagueIds);
  if (!access.ok) return res.status(access.status).json({ ok: false, error: access.error });

  const result = await createGlobalSpecialBet({
    userId,
    betDate,
    variant: Number(variant),
    leagueIds
  });

  // Too few eligible selections: an explicit answer, and nothing written.
  if (result.available === false) return res.status(200).json(result);

  // 201 only when this request actually created the row; a repeat gets 200 and
  // the same entity, which is what makes the endpoint safe to retry.
  return res.status(result.created ? 201 : 200).json(result);
}

async function handleGet(req, res, userId) {
  const { variant, bet_date: betDate, limit, offset } = req.query || {};

  if (variant !== undefined && variant !== "" && !isValidVariant(variant)) {
    return res.status(400).json({ ok: false, error: "variant invalid (permise: 3, 5, 8)." });
  }
  if (betDate && !isValidBetDate(betDate)) {
    return res.status(400).json({ ok: false, error: "bet_date invalid (aşteptat YYYY-MM-DD)." });
  }

  const { bets } = await listGlobalSpecialBets({ userId, variant, betDate, limit, offset });
  return res.status(200).json({ ok: true, bets });
}

export default async function handler(req, res) {
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
