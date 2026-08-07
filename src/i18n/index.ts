export type { Locale, TranslateFn, Dict } from "./types";
export { translate, readStoredLocale, writeStoredLocale, ensureCatalog, hasCatalog } from "./translate";
export { ro } from "./ro";
// `en` is deliberately NOT re-exported: an eager re-export here put both
// dictionaries in the entry chunk for every visitor. It loads on demand via
// ensureCatalog; nothing imported it statically (verified before removal).
export { NIGHT_OWL_MESSAGES, LIVE_CONTEXT_MESSAGES } from "./greetingMessages";
