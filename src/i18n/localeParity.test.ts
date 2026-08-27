import { describe, expect, it } from "vitest";
// NAMED exports — these modules have no default. A default import here makes
// both key sets empty and every parity assertion pass vacuously, which is what
// the "not vacuous" case below exists to catch.
import { en } from "./en";
import { ro } from "./ro";

/**
 * RO/EN key parity.
 *
 * This repository had no parity guard, so a key added to one locale and forgotten in
 * the other would ship — and `translate()` falls back to the key path, meaning the
 * user simply sees `account.referral.accept` where a button label belongs. Nothing
 * fails, nothing logs; it just looks broken to exactly the users who chose the other
 * language.
 *
 * The whole-dictionary check is the one that matters long-term. The
 * `account.referral` check is called out separately so a PR3d2 regression names
 * itself rather than hiding in a list of a thousand keys.
 */

type Dict = Record<string, unknown>;

/** Every leaf path, dotted. Objects recurse; anything else is a leaf. */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Dict).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

const roPaths = new Set(leafPaths(ro));
const enPaths = new Set(leafPaths(en));

const missingIn = (target: Set<string>, source: Set<string>, filter?: string) =>
  [...source].filter((p) => !target.has(p) && (!filter || p.startsWith(filter))).sort();

describe("i18n key parity", () => {
  it("has no account.referral key present in only one locale", () => {
    expect(missingIn(enPaths, roPaths, "account.referral")).toEqual([]);
    expect(missingIn(roPaths, enPaths, "account.referral")).toEqual([]);
  });

  it("actually covers the referral surface rather than passing vacuously", () => {
    // A parity test over an empty set passes trivially. These are the keys the
    // referral card cannot render without.
    for (const key of [
      "account.referral.title",
      "account.referral.accept",
      "account.referral.decline",
      "account.referral.copy",
      "account.referral.share",
      "account.referral.inviteOnce",
      "account.referral.capReached",
      "account.referral.stateRewarded",
      "account.referral.errorAlreadyAttributed"
    ]) {
      expect(roPaths.has(key), `ro is missing ${key}`).toBe(true);
      expect(enPaths.has(key), `en is missing ${key}`).toBe(true);
    }
  });

  it("has no key present in only one locale anywhere in the dictionary", () => {
    expect({ missingInEn: missingIn(enPaths, roPaths), missingInRo: missingIn(roPaths, enPaths) }).toEqual({
      missingInEn: [],
      missingInRo: []
    });
  });

  it("leaves no referral string empty in either locale", () => {
    // An empty string is worse than a missing key: translate() returns it happily
    // and the button renders blank.
    const read = (dict: unknown, path: string) =>
      path.split(".").reduce<unknown>((acc, part) => (acc as Dict)?.[part], dict);
    for (const path of [...roPaths].filter((p) => p.startsWith("account.referral"))) {
      expect(String(read(ro, path) ?? "").trim(), `ro ${path}`).not.toBe("");
      expect(String(read(en, path) ?? "").trim(), `en ${path}`).not.toBe("");
    }
  });
});
