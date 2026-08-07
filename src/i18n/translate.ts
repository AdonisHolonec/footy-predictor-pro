import type { Dict, Locale } from "./types";
import { ro } from "./ro";

/**
 * RO is eager on purpose: it is the default locale AND the hard requirement of
 * the fallback chain below. EN registers lazily through ensureCatalog — before
 * this split every visitor downloaded both dictionaries when exactly one is
 * ever read (Sprint 5 of the audit remediation program).
 */
const catalogs: Partial<Record<Locale, Dict>> = { ro };

let enLoading: Promise<void> | null = null;

export function hasCatalog(locale: Locale): boolean {
  return Boolean(catalogs[locale]);
}

/**
 * Idempotent. Resolves once the locale's dictionary is registered; RO resolves
 * immediately. Callers flip the UI locale only after this settles, so a user
 * never reads mixed languages mid-load.
 */
export function ensureCatalog(locale: Locale): Promise<void> {
  if (catalogs[locale]) return Promise.resolve();
  if (locale === "en") {
    enLoading ||= import("./en").then((m) => {
      catalogs.en = m.en;
    });
    return enLoading;
  }
  return Promise.resolve();
}

function lookup(dict: Dict, path: string): string | undefined {
  const parts = path.split(".");
  let cur: string | Dict | undefined = dict;
  for (const p of parts) {
    if (cur == null || typeof cur === "string") return undefined;
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  // An unregistered catalog degrades to RO — same direction as the existing
  // missing-key fallback, never a crash and never a raw key when RO has it.
  const dict = catalogs[locale] ?? catalogs.ro!;
  const raw = lookup(dict, key) ?? lookup(catalogs.ro!, key) ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] != null ? String(params[name]) : `{${name}}`
  );
}

export function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem("footy:locale");
    if (v === "en" || v === "ro") return v;
  } catch {
    /* ignore */
  }
  return "ro";
}

export function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem("footy:locale", locale);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}
