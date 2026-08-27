import { supabase } from "../utils/supabaseClient";

/**
 * The user's own public display name.
 *
 * WHY THIS IS A DIRECT SUPABASE WRITE and not an API endpoint: `profiles` already
 * carries RLS scoping updates to auth.uid(), the privilege-column trigger already
 * rejects any attempt to touch role/tier/is_blocked, and `updateFavoriteLeagues`
 * writes the same table the same way. Adding an endpoint would have spent one of
 * the twelve serverless functions on a column the database already protects.
 *
 * THE VALIDATION HERE IS FOR THE MESSAGE, NOT THE SAFETY. The CHECK constraint on
 * profiles_display_name_shape is the actual guarantee; this exists so the user
 * gets "don't use an email address" instead of a Postgres constraint violation.
 */

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

export type DisplayNameError = "tooShort" | "tooLong" | "email" | "generic";

/** `null` means "no name" — a deliberate, valid choice that keeps the user anonymous. */
/**
 * One flat shape rather than a discriminated union: `reason === null` means the
 * value is good, and `value` is what should be saved. A union reads well until a
 * caller has to narrow it in a callback, and this has exactly one caller.
 */
export type DisplayNameCheck = { value: string | null; reason: DisplayNameError | null };

export function validateDisplayName(raw: string): DisplayNameCheck {
  const value = raw.trim();
  if (!value) return { value: null, reason: null };
  if (value.includes("@")) return { value: null, reason: "email" };
  if (value.length < DISPLAY_NAME_MIN) return { value: null, reason: "tooShort" };
  if (value.length > DISPLAY_NAME_MAX) return { value: null, reason: "tooLong" };
  return { value, reason: null };
}

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

export async function saveDisplayName(userId: string, value: string | null): Promise<boolean> {
  if (!supabase || !userId) return false;
  try {
    const { error } = await supabase.from("profiles").update({ display_name: value }).eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
}
