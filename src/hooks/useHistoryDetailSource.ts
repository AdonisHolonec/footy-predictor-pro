import { useMemo } from "react";
import type { PredictionRow } from "../types";
import { useHistoryDetail } from "./useHistoryDetail";

/**
 * Chooses which object the match modal renders from.
 *
 * Phase A2 of the history read/modal split: the modal stops depending
 * exclusively on the fat list row and prefers the by-fixture detail response
 * when one exists. The list row remains a full fallback for the whole of this
 * phase, so nothing the user sees changes yet — the point is that the modal now
 * has an independent source, which is what lets a later phase stop shipping
 * `raw_payload` for every row.
 *
 * Two things here are not obvious and both are load-bearing.
 *
 * First, `selectedMatch` is NOT a history row. The same setter is driven by
 * Home, Matches, Notifications and the command palette, all of which hold live
 * predictions, and it is re-synced against the live `preds` array on every poll.
 * A fixture that has not been graded yet has no row in `predictions_history`, so
 * asking for its detail is a guaranteed 404. Membership in the loaded history
 * decides whether a detail request happens at all — the section that opened the
 * modal is the wrong thing to key on, because Notifications and the palette can
 * open either kind.
 *
 * Second, the fixture identity is re-checked at the point of use. The hook's own
 * stale guard already prevents an older response from landing in state, but the
 * cache is module-scoped and shared: reopening fixture B while A's entry is
 * still cached would otherwise hand the modal A's data. Comparing ids here means
 * a mismatch can only ever fall back to the selected row, never render the wrong
 * match.
 */
export type HistoryDetailSource = {
  /** The object to hand to the modal. Never null while a match is selected. */
  match: PredictionRow | null;
  /** True only while a detail request for the current fixture is in flight. */
  loading: boolean;
  /** Detail failed. The modal still renders from the list row. */
  error: string | null;
  /** Whether this fixture is eligible for a detail request at all. */
  detailRequested: boolean;
  /** True once the modal is rendering detail rather than the list row. */
  usingDetail: boolean;
};

/**
 * Resolves the object the modal renders from.
 *
 * Exported for tests, and deliberately pure: the fallback precedence is the one
 * rule that must never regress, so it is verified without a React tree.
 */
export function resolveModalMatch(
  selected: PredictionRow | null,
  detail: PredictionRow | null
): PredictionRow | null {
  if (!selected) return null;
  if (detail && Number(detail.id) === Number(selected.id)) return detail;
  return selected;
}

export function useHistoryDetailSource(
  selectedMatch: PredictionRow | null,
  history: PredictionRow[]
): HistoryDetailSource {
  const historyIds = useMemo(() => {
    const ids = new Set<number>();
    for (const row of history || []) {
      const id = Number(row?.id);
      if (Number.isFinite(id)) ids.add(id);
    }
    return ids;
  }, [history]);

  const selectedId = selectedMatch ? Number(selectedMatch.id) : null;
  // Only fixtures already in history can have a detail row; anything else would
  // spend a request to earn a 404.
  const detailFixtureId = selectedId != null && historyIds.has(selectedId) ? selectedId : null;

  const { detail, loading, error } = useHistoryDetail(detailFixtureId);

  const match = resolveModalMatch(selectedMatch, detail);
  return {
    match,
    loading: detailFixtureId != null && loading,
    error: detailFixtureId != null ? error : null,
    detailRequested: detailFixtureId != null,
    usingDetail: Boolean(detail) && match === detail
  };
}
