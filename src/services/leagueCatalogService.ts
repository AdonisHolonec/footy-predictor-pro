import type { LeagueCatalogEntry } from "../types";

/**
 * Full league catalog for the consumer "Selectează ligile" panel.
 *
 * Source: /api/fixtures?view=leagues, which serves the provider's CURRENT league list
 * from a 24h shared cache (one upstream call per day for everyone). The client adds a
 * second layer so a session never asks twice: an in-flight promise memo plus a
 * sessionStorage copy with the same 24h TTL. Nothing here is per league.
 */
const STORAGE_KEY = "footy.leagueCatalog.v1";
const TTL_MS = 24 * 60 * 60 * 1000;

type StoredCatalog = { fetchedAt: number; leagues: LeagueCatalogEntry[] };

let inflight: Promise<LeagueCatalogEntry[]> | null = null;

/** Deduplicate by league id (first occurrence wins) and drop malformed rows. */
export function normalizeLeagueCatalog(rows: unknown): LeagueCatalogEntry[] {
  const byId = new Map<number, LeagueCatalogEntry>();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = raw as Partial<LeagueCatalogEntry>;
    const id = Number(r?.id);
    if (!Number.isInteger(id) || id <= 0 || byId.has(id)) continue;
    byId.set(id, {
      id,
      name: String(r.name || "").trim() || `League ${id}`,
      country: String(r.country || "").trim() || "Unknown",
      type: r.type === "Cup" ? "Cup" : "League",
      logo: typeof r.logo === "string" && r.logo ? r.logo : undefined
    });
  }
  return Array.from(byId.values());
}

function readStored(): LeagueCatalogEntry[] | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCatalog;
    if (!parsed || Date.now() - Number(parsed.fetchedAt) > TTL_MS) return null;
    const leagues = normalizeLeagueCatalog(parsed.leagues);
    return leagues.length ? leagues : null;
  } catch {
    return null;
  }
}

function writeStored(leagues: LeagueCatalogEntry[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ fetchedAt: Date.now(), leagues } satisfies StoredCatalog));
  } catch {
    // storage may be unavailable (private mode, quota); the in-memory memo still applies
  }
}

/** One catalog load per session; rejects (and clears the memo) only when nothing usable came back. */
export function fetchLeagueCatalog(): Promise<LeagueCatalogEntry[]> {
  const stored = readStored();
  if (stored) return Promise.resolve(stored);
  if (inflight) return inflight;
  inflight = (async () => {
    const response = await fetch("/api/fixtures?view=leagues");
    const json = await response.json();
    if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca catalogul de ligi.");
    const leagues = normalizeLeagueCatalog(json.leagues);
    if (!leagues.length) throw new Error("Catalogul de ligi este gol.");
    writeStored(leagues);
    return leagues;
  })().catch((error: unknown) => {
    inflight = null;
    throw error;
  });
  return inflight;
}

/** Test seam. */
export function resetLeagueCatalogCache() {
  inflight = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
