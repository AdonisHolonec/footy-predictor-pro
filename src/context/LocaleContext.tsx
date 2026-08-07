import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ensureCatalog,
  hasCatalog,
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
  // False only when the stored locale is EN on first visit of the session:
  // the dictionary loads lazily now, and flipping the UI before it lands
  // would flash Romanian at an English reader.
  const [ready, setReady] = useState<boolean>(() => hasCatalog(locale));

  useEffect(() => {
    if (!ready) {
      let cancelled = false;
      void ensureCatalog(locale).then(() => {
        if (!cancelled) setReady(true);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [ready, locale]);

  const setLocale = useCallback((next: Locale) => {
    // The locale flips only once its dictionary is registered, so the switch
    // is atomic from the reader's point of view — never mixed languages.
    void ensureCatalog(next).then(() => {
      setLocaleState(next);
      writeStoredLocale(next);
    });
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next: Locale = prev === "ro" ? "en" : "ro";
      if (!hasCatalog(next)) {
        // Async path: keep prev now, flip when the dictionary lands.
        void ensureCatalog(next).then(() => {
          setLocaleState(next);
          writeStoredLocale(next);
        });
        return prev;
      }
      writeStoredLocale(next);
      return next;
    });
  }, []);

  useEffect(() => {
    writeStoredLocale(locale);
  }, [locale]);

  const t = useCallback<TranslateFn>((key, params) => translate(locale, key, params), [locale]);

  const value = useMemo(() => ({ locale, setLocale, toggleLocale, t }), [locale, setLocale, toggleLocale, t]);

  if (!ready) {
    // Same visual language as the app's other loading states; lasts one small
    // network roundtrip, and only for stored-EN visitors on a cold cache.
    return (
      <div className="lab-page grid min-h-screen place-items-center">
        <div className="lab-bg" aria-hidden />
        <div className="relative z-10 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fp-accent)]">
          Loading…
        </div>
      </div>
    );
  }

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
