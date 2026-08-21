import { describe, expect, test, beforeAll } from "vitest";

import { ensureCatalog, translate } from "./translate";

/**
 * Accessible names for the outcome badge.
 *
 * On mobile the badge renders an icon with no visible text, so `common.status.*`
 * is the only thing carrying the outcome to a screen reader. That makes a missing
 * EN key worse than it looks: `translate` falls back to RO before it falls back to
 * the raw key, so an untranslated status is not a visible bug — an English user
 * simply hears Romanian. The fallback is deliberate everywhere else, which is
 * exactly why these keys need a test that RO and EN actually differ.
 */

const STATUS_KEYS = ["pending", "win", "loss", "push", "halfWin", "halfLoss", "void"] as const;

const EXPECTED = {
  ro: {
    pending: "În așteptare",
    win: "Câștigător",
    loss: "Pierdut",
    push: "Egal",
    halfWin: "Jumătate câștigătoare",
    halfLoss: "Jumătate pierdută",
    void: "Anulat"
  },
  en: {
    pending: "Pending",
    win: "Winner",
    loss: "Lost",
    push: "Push",
    halfWin: "Half win",
    halfLoss: "Half loss",
    void: "Void"
  }
} as const;

describe("outcome status accessible names", () => {
  beforeAll(async () => {
    await ensureCatalog("en");
  });

  test.each(STATUS_KEYS)("%s resolves in both locales", (key) => {
    expect(translate("ro", `common.status.${key}`)).toBe(EXPECTED.ro[key]);
    expect(translate("en", `common.status.${key}`)).toBe(EXPECTED.en[key]);
  });

  test("no status key silently falls back to Romanian in EN", () => {
    for (const key of STATUS_KEYS) {
      const path = `common.status.${key}`;
      expect(translate("en", path)).not.toBe(translate("ro", path));
    }
  });

  test("an unknown status key degrades to the raw key rather than throwing", () => {
    expect(translate("ro", "common.status.nope")).toBe("common.status.nope");
  });

  test("neither the accessible name nor the visible badge is an all-caps abbreviation", () => {
    // UX-E: the visible badge is a full Title-case word ("Won" / "Lost"), the
    // same token the ticket history uses — so neither surface can announce or
    // read as "WIN" / "LOSE" shouting.
    const fullWord = /^\p{Lu}\p{Ll}/u;
    for (const locale of ["en", "ro"] as const) {
      for (const key of ["win", "loss"]) {
        expect(translate(locale, `common.status.${key}`)).toMatch(fullWord);
        expect(translate(locale, `history.${key}`)).toMatch(fullWord);
      }
    }
  });
});
