import { fetchWithAuth } from "../utils/apiAuth";
import { supabase } from "../utils/supabaseClient";

/**
 * The user's own public display name.
 *
 * WRITES GO THROUGH THE API, NOT POSTGREST. Migration 065 revokes
 * UPDATE(display_name) from `authenticated`, so this column can no longer be set
 * from the browser directly — deliberately. It is the one value shown to ANOTHER
 * user, so it must pass the server's content filter, and a client that could
 * write the column itself would simply skip that.
 *
 * THE DICTIONARY IS NOT HERE. Client validation below covers shape only — length,
 * "@", control characters — because those are cheap, obvious and safe to reveal.
 * What counts as offensive stays on the server: shipping the word list in a
 * bundle anyone can read is the same as publishing it.
 */

export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 24;

/** Mirrors the server's stable reason codes; the UI maps these to sentences. */
export type DisplayNameReason =
  | "invalid_display_name_length"
  | "invalid_display_name"
  | "inappropriate_display_name"
  | "generic";

export type DisplayNameCheck = { value: string | null; reason: DisplayNameReason | null };

/** Same tidy the server applies, so the counter and the stored value agree. */
export function tidyDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Structural validation for immediate feedback. NOT authoritative — the server
 * re-runs everything and adds the content check on top.
 */
export function validateDisplayNameShape(raw: string): DisplayNameCheck {
  const value = tidyDisplayName(raw);
  if (!value) return { value: null, reason: null };
  if (value.length < DISPLAY_NAME_MIN || value.length > DISPLAY_NAME_MAX) {
    return { value: null, reason: "invalid_display_name_length" };
  }
  if (value.includes("@")) return { value: null, reason: "invalid_display_name" };
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return { value: null, reason: "invalid_display_name" };
  }
  return { value, reason: null };
}

/** Reading stays a direct PostgREST select — only writing was revoked. */
export async function fetchDisplayName(userId: string): Promise<string | null> {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
    if (error || !data) return null;
    return (data as { display_name: string | null }).display_name ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist a name. Resolves with the reason the server refused, or null on success.
 *
 * The server's answer wins even when the client thought the value was fine: the
 * content check only exists there.
 */
export async function saveDisplayName(value: string | null): Promise<{ ok: boolean; reason: DisplayNameReason | null; value: string | null }> {
  try {
    const res = await fetchWithAuth("/api/referral?view=display-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: value ?? "" })
    });
    const json = (await res.json()) as { ok?: boolean; reason?: string; displayName?: string | null };
    if (res.ok && json?.ok === true) {
      return { ok: true, reason: null, value: json.displayName ?? null };
    }
    const reason = (json?.reason as DisplayNameReason) || "generic";
    return { ok: false, reason, value: null };
  } catch {
    return { ok: false, reason: "generic", value: null };
  }
}
