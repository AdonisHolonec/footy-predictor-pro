import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  readStoredLocale,
  translate,
  writeStoredLocale,
  type Locale,
  type TranslateFn
} from "../i18n";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: TranslateFn;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next: Locale = prev === "ro" ? "en" : "ro";
      writeStoredLocale(next);
      return next;
    });
  }, []);

  useEffect(() => {
    writeStoredLocale(locale);
  }, [locale]);

  const t = useCallback<TranslateFn>((key, params) => translate(locale, key, params), [locale]);

  const value = useMemo(() => ({ locale, setLocale, toggleLocale, t }), [locale, setLocale, toggleLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    const locale = readStoredLocale();
    return {
      locale,
      setLocale: writeStoredLocale,
      toggleLocale: () => writeStoredLocale(locale === "ro" ? "en" : "ro"),
      t: (key, params) => translate(locale, key, params)
    };
  }
  return ctx;
}
