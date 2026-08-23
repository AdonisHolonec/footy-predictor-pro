import { useCallback, useEffect, useRef, useState } from "react";
import {
  GlobalSpecialBetApiError,
  generateGlobalSpecialBet
} from "../services/globalSpecialBetService";
import { describeGlobalSpecialBetError, type GlobalSpecialBetErrorView } from "../utils/globalSpecialBetView";
import type {
  GlobalSpecialBet,
  GlobalSpecialBetKind,
  GlobalSpecialBetUnavailable,
  GlobalSpecialBetVariant,
  GlobalSpecialBetLeagueSummary
} from "../types/globalSpecialBet";

/**
 * Generation state for the Global Special Bet card.
 *
 * One state machine per PRODUCT, kept in a map: switching from 5 back to 3 shows
 * the snapshot 3 already produced instead of asking the server again. The server
 * remains the authority on idempotency — this cache exists to avoid a pointless
 * round trip, never to decide what a bet contains, and it lives in memory only.
 *
 * The key is kind AND variant, not the variant alone. A Combo 5 and a Bilet
 * Sistem are both variant 5 — five selections each — so keying on the number
 * would let one overwrite the other's loading, data and error state, and a user
 * flipping between them would watch a system's snapshot appear under the combo
 * heading. They are different products and get different slots.
 */

export type GlobalSpecialBetVariantState =
  | { phase: "idle" }
  | { phase: "generating" }
  | { phase: "ready"; bet: GlobalSpecialBet; created: boolean; leagueSummary?: GlobalSpecialBetLeagueSummary }
  | { phase: "unavailable"; unavailable: GlobalSpecialBetUnavailable }
  | { phase: "error"; error: GlobalSpecialBetErrorView };

const IDLE: GlobalSpecialBetVariantState = { phase: "idle" };

/**
 * What the user picked: a Combo of 3, 5 or 8, or the Bilet Sistem.
 *
 * The System's variant is 5 because a System is five selections. Its k is NOT
 * here and never will be: the product is 3/5, the server fixes it, and there is
 * nothing for the client to choose or send.
 */
export type GlobalSpecialBetProduct = {
  kind: GlobalSpecialBetKind;
  variant: GlobalSpecialBetVariant;
};

/** The one System the product sells. Five selections, at least three must win. */
export const SYSTEM_PRODUCT: GlobalSpecialBetProduct = { kind: "system", variant: 5 };

export const comboProduct = (variant: GlobalSpecialBetVariant): GlobalSpecialBetProduct => ({
  kind: "combo",
  variant
});

/** Stable compound key. "combo:5" and "system:5" are different slots. */
const productKey = (product: GlobalSpecialBetProduct) => `${product.kind}:${product.variant}`;

export type UseGlobalSpecialBetOptions = {
  /**
   * Generation date (idempotency key + audit metadata). The candidate pool is
   * every upcoming predicted fixture — it does NOT depend on this date.
   */
  betDate: string;
  /** The user's favourite leagues — the only scope the server accepts. */
  leagueIds: number[];
  initialProduct?: GlobalSpecialBetProduct;
};

export function useGlobalSpecialBet({
  betDate,
  leagueIds,
  initialProduct = { kind: "combo", variant: 3 }
}: UseGlobalSpecialBetOptions) {
  const [product, setProduct] = useState<GlobalSpecialBetProduct>(initialProduct);
  const [byProduct, setByProduct] = useState<Record<string, GlobalSpecialBetVariantState>>({});

  // A snapshot belongs to one date and one league scope; when either moves, what
  // was generated no longer describes what the user is looking at.
  const scopeKey = `${betDate}|${[...leagueIds].sort((a, b) => a - b).join(",")}`;
  const lastScopeKey = useRef(scopeKey);
  useEffect(() => {
    if (lastScopeKey.current === scopeKey) return;
    lastScopeKey.current = scopeKey;
    setByProduct({});
  }, [scopeKey]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const key = productKey(product);
  const state = byProduct[key] ?? IDLE;

  const generate = useCallback(async () => {
    // The visual guard is the disabled button; this is the guard that actually
    // prevents a second in-flight POST when both fire in the same tick.
    if ((byProduct[key] ?? IDLE).phase === "generating") return;
    if (!betDate || leagueIds.length === 0) return;

    setByProduct((prev) => ({ ...prev, [key]: { phase: "generating" } }));
    try {
      const result = await generateGlobalSpecialBet({
        betDate,
        variant: product.variant,
        leagueIds,
        // Sent only for a System. A Combo request stays byte-identical to the one
        // this app has always sent, which is what keeps the existing path safe.
        ...(product.kind === "system" ? { betKind: "system" as const } : {})
      });
      if (!mounted.current) return;
      const next: GlobalSpecialBetVariantState =
        result.available === true
          ? { phase: "ready", bet: result.bet, created: result.created, ...(result.leagueSummary ? { leagueSummary: result.leagueSummary } : {}) }
          : { phase: "unavailable", unavailable: result.unavailable };
      setByProduct((prev) => ({ ...prev, [key]: next }));
    } catch (error) {
      if (!mounted.current) return;
      const view =
        error instanceof GlobalSpecialBetApiError
          ? describeGlobalSpecialBetError(error.status, error.apiMessage)
          : describeGlobalSpecialBetError(0, null);
      setByProduct((prev) => ({ ...prev, [key]: { phase: "error", error: view } }));
    }
  }, [betDate, leagueIds, product, key, byProduct]);

  return {
    product,
    setProduct,
    state,
    isGenerating: state.phase === "generating",
    generate
  };
}
