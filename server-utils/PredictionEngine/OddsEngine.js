import { shinImpliedProbs } from "../advancedMath.js";
import { clamp, result, neutral } from "./helpers.js";

/**
 * Market-implied relative strength from 1X2 odds (Shin).
 * Default weight 0 — does not alter λ until enabled.
 */
export function calculate(ctx) {
  const odds = ctx.odds;
  const oh = Number(odds?.home);
  const od = Number(odds?.draw);
  const oa = Number(odds?.away);
  if (!Number.isFinite(oh) || !Number.isFinite(od) || !Number.isFinite(oa) || oh <= 1 || od <= 1 || oa <= 1) {
    return neutral({ reason: "odds_not_provided", extensionPoint: true });
  }

  const shin = shinImpliedProbs(oh, od, oa);
  if (!shin) return neutral({ reason: "odds_shin_failed" });

  // Map market probs to gentle multiplicative factors around 1.0
  const home = clamp(0.85 + shin.p1 * 0.3, 0.88, 1.12);
  const away = clamp(0.85 + shin.p2 * 0.3, 0.88, 1.12);

  return result((home + away) / 2, 0.7, {
    home,
    away,
    market: { p1: shin.p1, pX: shin.pX, p2: shin.p2 },
    odds: { home: oh, draw: od, away: oa },
    available: true
  });
}

export const OddsEngine = { calculate, name: "odds" };
