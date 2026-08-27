/**
 * The one place this application decides whether user-authored text is acceptable.
 *
 * TWO CALLERS, ONE DICTIONARY. Display names and messages to administrators are
 * different surfaces with different length rules, but "what counts as offensive"
 * must not be allowed to drift between them — two lists become two policies, and
 * the second one is always the stale one. Everything below is exported from here
 * and duplicated nowhere.
 *
 * THE DICTIONARY NEVER LEAVES THE SERVER. It is not exported to the client bundle
 * and never appears in an API response: telling someone exactly which token
 * tripped the filter is a recipe for working around it, and shipping the list is
 * the same thing in bulk. The client gets a reason code; the user gets a sentence.
 *
 * THIS IS NOT AN XSS DEFENCE. Content safety and output escaping are separate
 * concerns and stay separate: React escapes what it renders, and nothing here is
 * a substitute for that. A name containing `<script>` is a naming problem, not a
 * security hole, and is treated as one.
 */

/* ------------------------------------------------------------------ policy */

/** Trimmed length bounds for a public display name. */
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 24;

/** Stable, machine-readable rejection reasons. Never prose, never rendered raw. */
export const SAFETY_REASONS = {
  DISPLAY_NAME_LENGTH: "invalid_display_name_length",
  DISPLAY_NAME_SHAPE: "invalid_display_name",
  DISPLAY_NAME_CONTENT: "inappropriate_display_name",
  MESSAGE_CONTENT: "inappropriate_message"
};

/* -------------------------------------------------------------- dictionary */

/**
 * Romanian and English terms treated as offensive in a public display name or a
 * message to a human administrator.
 *
 * Entries are matched on WORD BOUNDARIES, not as substrings — see `contains`.
 * That distinction is the whole reason a Romanian name like "Constantin" or an
 * ordinary word like "assess" survives: a blocked token buried inside a longer
 * legitimate word is not a match.
 *
 * Deliberately conservative. A filter that rejects real names is a filter people
 * route around, and the cost of missing one creative spelling is far lower than
 * the cost of telling someone their own name is unacceptable.
 */
const BLOCKED = [
  // Romanian
  "pula",
  "pule",
  "pizda",
  "muie",
  "curva",
  "curve",
  "futut",
  "fute",
  "futai",
  "cacat",
  "coaie",
  "bulangiu",
  "poponar",
  "tigan",
  "jidan",
  "handicapat",
  "retardat",
  "cretin",
  "nesimtit",
  "javra",
  "sugi",
  "sugimi",
  // English
  "fuck",
  "fucker",
  "fucking",
  "shit",
  "bitch",
  "cunt",
  "dick",
  "cock",
  "pussy",
  "whore",
  "slut",
  "bastard",
  "asshole",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "rapist",
  "nazi",
  "hitler",
  "wanker",
  "bollocks",
  "twat"
];

const BLOCKED_SET = new Set(BLOCKED);

/**
 * Inflection endings a blocked stem may legitimately carry — "fuckeri", "shits",
 * "curvele".
 *
 * An ALLOW-LIST of endings, not an open-ended prefix match. "starts with a blocked
 * stem" would reject the surname Pulaski ("pula" + "ski") and Cocktail ("cock" +
 * "tail"); requiring the remainder to be a real inflection keeps both, while still
 * catching the Romanian plural that a bare equality check misses.
 */
const INFLECTIONS = [
  "a", "e", "i", "u", "ul", "ule", "ii", "le", "lor", "ilor", "elor",
  "eri", "ari", "uri", "urile", "ilo",
  "s", "es", "ed", "er", "ers", "ing", "ings"
];

/* ---------------------------------------------------------- normalization */

/**
 * Diacritics are folded, not rejected.
 *
 * NFD splits "ă" into "a" plus a combining mark, which the range below removes.
 * This is what lets "Ștefan" and "Stefan" look identical to the matcher while
 * both remain perfectly valid to store — and what stops "fŭck" sliding past.
 */
/**
 * Letter homoglyphs that survive NFD because they are distinct letters, not
 * accented ones: dotless i and slashed l. Folded here rather than in the leet
 * map below, because `normalizeForMatch` strips non-ASCII to spaces first and a
 * later pass would never see them.
 */
const LETTER_HOMOGLYPHS = { "\u0131": "i", "\u0142": "l", "\u01c0": "l" };

function foldDiacritics(value) {
  const folded = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let out = "";
  for (const ch of folded) out += LETTER_HOMOGLYPHS[ch] ?? ch;
  return out;
}

/**
 * The canonical form used for matching: diacritics folded, lower-cased, every
 * non-alphanumeric run reduced to a single space.
 */
export function normalizeForMatch(value) {
  return foldDiacritics(String(value ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Undo separator-obfuscation — "c.u.v.a.n.t", "c-u-v-a-n-t", "c u v a n t".
 *
 * ONLY runs where separators sit between SINGLE characters, because that pattern
 * is the signature of deliberate obfuscation and does not occur in ordinary
 * writing. Collapsing every space instead would join innocent neighbours into
 * accidental matches — "Ana Maria" must never become one token that happens to
 * span a blocked stem.
 */
export function collapseObfuscation(normalized) {
  return normalized.replace(/\b(?:[a-z0-9]\s+){2,}[a-z0-9]\b/g, (run) => run.replace(/\s+/g, ""));
}

/**
 * "fuuuck" is also tried as "fuuck" and "fuck".
 *
 * Two reduced variants rather than one aggressive squash: collapsing every repeat
 * to a single letter breaks real words, so the matcher tries each form and needs
 * only one to be clean for the text to pass.
 */
function repeatVariants(text) {
  return [text, text.replace(/(.)\1{2,}/g, "$1$1"), text.replace(/(.)\1+/g, "$1")];
}

/**
 * Leetspeak and homoglyph folding: "c0ck", "5hit", "d1ck", "muıe".
 *
 * Applied as an EXTRA candidate rather than in place of the plain form, so it can
 * only ever add a detection and never remove one. The mapping is limited to
 * substitutions people actually use to dodge filters; expanding it further starts
 * turning ordinary names containing digits into accidental matches.
 */
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "ı": "i", "ł": "l" };

function foldLeet(text) {
  let out = "";
  for (const ch of text) out += LEET[ch] ?? ch;
  return out;
}

/** A token is offensive if it IS a blocked stem, or a blocked stem plus an inflection. */
function matchesStem(token) {
  if (BLOCKED_SET.has(token)) return true;
  for (const suffix of INFLECTIONS) {
    if (!token.endsWith(suffix)) continue;
    const stem = token.slice(0, -suffix.length);
    if (stem && BLOCKED_SET.has(stem)) return true;
  }
  return false;
}

/**
 * Does this text contain a blocked term as a WHOLE WORD, in any normalized form?
 *
 * Word-boundary matching is the false-positive protection. A substring test would
 * reject "Constantin" for containing "tan", "assess" for "ass", and the town of
 * Scunthorpe for the obvious — the classic failure mode of naive filters.
 */
function contains(value) {
  const base = normalizeForMatch(value);
  if (!base) return false;

  const candidates = new Set();
  for (const variant of [base, collapseObfuscation(base)]) {
    for (const repeated of repeatVariants(variant)) {
      candidates.add(repeated);
      candidates.add(foldLeet(repeated));
    }
  }

  for (const candidate of candidates) {
    for (const token of candidate.split(" ")) {
      if (!token) continue;
      // Trailing digits are a common dressing: "fuck123", "pula2024".
      const undressed = token.replace(/[0-9]+$/, "") || token;
      if (matchesStem(token) || matchesStem(undressed)) return true;
    }
  }
  return false;
}

/** Exposed for tests; the list itself is deliberately never exported. */
export function isOffensive(value) {
  return contains(value);
}

/* ------------------------------------------------------------- validators */

/** Collapse internal whitespace runs so "Ana   Maria" stores as "Ana Maria". */
function tidy(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * A public display name.
 *
 * Returns the value to STORE on success — tidied, never the raw input — so every
 * caller persists the same normalized form instead of each doing its own trim.
 */
export function validateDisplayName(raw) {
  const value = tidy(raw);

  // An empty name is a valid choice: it means "stay anonymous".
  if (!value) return { ok: true, value: null, reason: null };

  if (value.length < DISPLAY_NAME_MIN || value.length > DISPLAY_NAME_MAX) {
    return { ok: false, value: null, reason: SAFETY_REASONS.DISPLAY_NAME_LENGTH };
  }
  if (value.includes("@")) {
    return { ok: false, value: null, reason: SAFETY_REASONS.DISPLAY_NAME_SHAPE };
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return { ok: false, value: null, reason: SAFETY_REASONS.DISPLAY_NAME_SHAPE };
    }
  }
  if (contains(value)) {
    return { ok: false, value: null, reason: SAFETY_REASONS.DISPLAY_NAME_CONTENT };
  }
  return { ok: true, value, reason: null };
}

/**
 * A message addressed to a human administrator.
 *
 * Length is NOT enforced here — supportApi already owns those limits and they
 * were chosen deliberately. This adds content checking, and nothing else.
 */
export function validateAdminMessage(raw) {
  const value = String(raw ?? "");
  if (contains(value)) {
    return { ok: false, reason: SAFETY_REASONS.MESSAGE_CONTENT };
  }
  return { ok: true, reason: null };
}

export default { validateDisplayName, validateAdminMessage, isOffensive, normalizeForMatch, SAFETY_REASONS };
