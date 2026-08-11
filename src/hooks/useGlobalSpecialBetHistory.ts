import { useCallback, useEffect, useRef, useState } from "react";
import { GlobalSpecialBetApiError, listGlobalSpecialBets } from "../services/globalSpecialBetService";
import { describeGlobalSpecialBetError, type GlobalSpecialBetErrorView } from "../utils/globalSpecialBetView";
import type { GlobalSpecialBet } from "../types/globalSpecialBet";

/** How many stored bets one page of the history holds. */
export const GLOBAL_SPECIAL_BET_PAGE_SIZE = 10;

export type GlobalSpecialBetHistoryState =
  | { phase: "loading" }
  | { phase: "ready"; bets: GlobalSpecialBet[]; hasMore: boolean }
  | { phase: "error"; error: GlobalSpecialBetErrorView };

/**
 * The user's stored Global Special Bets, read through the API's own pagination.
 *
 * Nothing is recomputed: the list renders the snapshots exactly as stored. A
 * full page back means there may be another one — the API returns rows, not a
 * total, so "has more" is inferred from the page being full and nothing else.
 */
export function useGlobalSpecialBetHistory({ enabled = true }: { enabled?: boolean } = {}) {
  const [state, setState] = useState<GlobalSpecialBetHistoryState>({ phase: "loading" });
  const [offset, setOffset] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (nextOffset: number, append: boolean) => {
    setState((prev) => (append && prev.phase === "ready" ? prev : { phase: "loading" }));
    try {
      const page = await listGlobalSpecialBets({
        limit: GLOBAL_SPECIAL_BET_PAGE_SIZE,
        offset: nextOffset
      });
      if (!mounted.current) return;
      setState((prev) => {
        const previous = append && prev.phase === "ready" ? prev.bets : [];
        return {
          phase: "ready",
          bets: [...previous, ...page],
          hasMore: page.length === GLOBAL_SPECIAL_BET_PAGE_SIZE
        };
      });
      setOffset(nextOffset);
    } catch (error) {
      if (!mounted.current) return;
      const view =
        error instanceof GlobalSpecialBetApiError
          ? describeGlobalSpecialBetError(error.status, error.apiMessage)
          : describeGlobalSpecialBetError(0, null);
      setState({ phase: "error", error: view });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load(0, false);
  }, [enabled, load]);

  const loadMore = useCallback(() => {
    if (state.phase !== "ready" || !state.hasMore) return;
    void load(offset + GLOBAL_SPECIAL_BET_PAGE_SIZE, true);
  }, [load, offset, state]);

  const retry = useCallback(() => {
    void load(0, false);
  }, [load]);

  return { state, loadMore, retry };
}
