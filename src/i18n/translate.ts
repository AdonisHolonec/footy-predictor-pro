import type { Dict, Locale } from "./types";
import { en } from "./en";
import { ro } from "./ro";

const catalogs: Record<Locale, Dict> = { ro, en };

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
  const raw = lookup(catalogs[locale], key) ?? lookup(catalogs.ro, key) ?? key;
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
