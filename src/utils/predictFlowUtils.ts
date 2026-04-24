export function buildAuthHeaders(accessToken?: string | null) {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

export async function syncHistoryAfterPredict(accessToken?: string | null, days = 30) {
  const headers = buildAuthHeaders(accessToken);
  await fetch(`/api/history?sync=1&days=${days}`, { method: "POST", headers }).catch(() => null);
}

export function dedupePredictionsById<T extends { id?: string | number }>(rows: T[]) {
  return Array.from(new Map((rows || []).map((row) => [String(row?.id ?? ""), row])).values());
}
