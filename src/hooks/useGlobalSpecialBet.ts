import { useCallback, useEffect, useRef, useState } from "react";
import {
  GlobalSpecialBetApiError,
  generateGlobalSpecialBet
} from "../services/globalSpecialBetService";
import { describeGlobalSpecialBetError, type GlobalSpecialBetErrorView } from "../utils/globalSpecialBetView";
import type {
  GlobalSpecialBet,
  GlobalSpecialBetUnavailable,
  GlobalSpecialBetVariant
} from "../types/globalSpecialBet";

/**
 * Generation state for the Global Special Bet card.
 *
 * One state machine per variant, kept in a map: switching from 5 back to 3 shows
 * the snapshot 3 already produced instead of asking the server again. The server
 * remains the authority on idempotency — this cache exists to avoid a pointless
 * round trip, never to decide what a bet contains, and it lives in memory only.
 */

export type GlobalSpecialBetVariantState =
  | { phase: "idle" }
  | { phase: "generating" }
  | { phase: "ready"; bet: GlobalSpecialBet; created: boolean }
  | { phase: "unavailable"; unavailable: GlobalSpecialBetUnavailable }
  | { phase: "error"; error: GlobalSpecialBetErrorView };

const IDLE: GlobalSpecialBetVariantState = { phase: "idle" };

export type UseGlobalSpecialBetOptions = {
  /** Calendar day whose fixtures the bet is built from. */
  betDate: string;
  /** The user's favourite leagues — the only scope the server accepts. */
  leagueIds: number[];
  initialVariant?: GlobalSpecialBetVariant;
};

export function useGlobalSpecialBet({ betDate, leagueIds, initialVariant = 3 }: UseGlobalSpecialBetOptions) {
  const [variant, setVariant] = useState<GlobalSpecialBetVariant>(initialVariant);
  const [byVariant, setByVariant] = useState<Record<number, GlobalSpecialBetVariantState>>({});

  // A snapshot belongs to one date and one league scope; when either moves, what
  // was generated no longer describes what the user is looking at.
  const scopeKey = `${betDate}|${[...leagueIds].sort((a, b) => a - b).join(",")}`;
  const lastScopeKey = useRef(scopeKey);
  useEffect(() => {
    if (lastScopeKey.current === scopeKey) return;
    lastScopeKey.current = scopeKey;
    setByVariant({});
  }, [scopeKey]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const state = byVariant[variant] ?? IDLE;

  const generate = useCallback(async () => {
    // The visual guard is the disabled button; this is the guard that actually
    // prevents a second in-flight POST when both fire in the same tick.
    if ((byVariant[variant] ?? IDLE).phase === "generating") return;
    if (!betDate || leagueIds.length === 0) return;

    setByVariant((prev) => ({ ...prev, [variant]: { phase: "generating" } }));
    try {
      const result = await generateGlobalSpecialBet({ betDate, variant, leagueIds });
      if (!mounted.current) return;
      const next: GlobalSpecialBetVariantState =
        result.available === true
          ? { phase: "ready", bet: result.bet, created: result.created }
          : { phase: "unavailable", unavailable: result.unavailable };
      setByVariant((prev) => ({ ...prev, [variant]: next }));
    } catch (error) {
      if (!mounted.current) return;
      const view =
        error instanceof GlobalSpecialBetApiError
          ? describeGlobalSpecialBetError(error.status, error.apiMessage)
          : describeGlobalSpecialBetError(0, null);
      setByVariant((prev) => ({ ...prev, [variant]: { phase: "error", error: view } }));
    }
  }, [betDate, leagueIds, variant, byVariant]);

  return {
    variant,
    setVariant,
    state,
    isGenerating: state.phase === "generating",
    generate
  };
}
