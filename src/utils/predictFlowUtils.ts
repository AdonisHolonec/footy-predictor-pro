export function buildAuthHeaders(accessToken?: string | null) {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

/**
 * P0: users must not trigger global history sync.
 * Kept as a no-op for backward-compatible call sites; settlement relies on cron + local hydrate.
 */
export async function syncHistoryAfterPredict(_accessToken?: string | null, _days = 7) {
  return;
}

export function dedupePredictionsById<T extends { id?: string | number }>(rows: T[]) {
  return Array.from(new Map((rows || []).map((row) => [String(row?.id ?? ""), row])).values());
}
