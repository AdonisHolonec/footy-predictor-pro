import { beforeAll, describe, expect, it } from "vitest";
import { formatLineLabel, formatRecommendedPick, resolveMarketFamilyKey } from "./formatRecommendation";
import { ensureCatalog, translate } from "../i18n/translate";

// EN registers lazily; without this the fallback chain serves RO.
beforeAll(() => ensureCatalog("en"));
const t = (key: string, params?: Record<string, string | number>) => translate("en", key, params);

describe("resolveMarketFamilyKey", () => {
  it("maps explicit Corners family and pick tokens to CORNERS", () => {
    expect(resolveMarketFamilyKey("Under 10.5", "Corners")).toBe("CORNERS");
    expect(resolveMarketFamilyKey("Over 9.5 Corners", "Over/Under")).toBe("CORNERS");
  });

  it("remaps Over/Under + non-goals line to CORNERS", () => {
    expect(resolveMarketFamilyKey("Under 10.5", "Over/Under")).toBe("CORNERS");
    expect(resolveMarketFamilyKey("Over 8.5", "Over/Under")).toBe("CORNERS");
  });

  it("keeps Over/Under goals lines as GOALS", () => {
    expect(resolveMarketFamilyKey("Over 2.5", "Over/Under")).toBe("GOALS");
    expect(resolveMarketFamilyKey("Peste 1.5", "Over/Under")).toBe("GOALS");
  });

  it("infers high bare O/U lines as CORNERS when family is missing (legacy)", () => {
    expect(resolveMarketFamilyKey("Under 11.5")).toBe("CORNERS");
    expect(resolveMarketFamilyKey("Over 2.5")).toBe("GOALS");
  });

  it("accepts case-insensitive and legacy family separators", () => {
    expect(resolveMarketFamilyKey("1", "1x2")).toBe("1X2");
    expect(resolveMarketFamilyKey("1X", "double chance")).toBe("DOUBLE_CHANCE");
    expect(resolveMarketFamilyKey("Over 2.5", "over-under")).toBe("GOALS");
    expect(resolveMarketFamilyKey("Under 10.5", "CORNERS")).toBe("CORNERS");
    expect(resolveMarketFamilyKey("Over 3.5", "cards")).toBe("CARDS");
  });

  it("maps 1X2, Double Chance, BTTS, Cards from pick or family", () => {
    expect(resolveMarketFamilyKey("1", "1X2")).toBe("1X2");
    expect(resolveMarketFamilyKey("1X", "Double Chance")).toBe("DOUBLE_CHANCE");
    expect(resolveMarketFamilyKey("GG", "BTTS")).toBe("BTTS");
    expect(resolveMarketFamilyKey("Cards Under 3.5", "Over/Under")).toBe("CARDS");
    expect(resolveMarketFamilyKey("ngg")).toBe("BTTS");
    expect(resolveMarketFamilyKey("x2")).toBe("DOUBLE_CHANCE");
  });

  it("falls back safely on malformed / unknown family values", () => {
    expect(resolveMarketFamilyKey("1", "not-a-family")).toBe("1X2");
    expect(resolveMarketFamilyKey("Over 2.5", "")).toBe("GOALS");
    expect(resolveMarketFamilyKey("Over 2.5", null)).toBe("GOALS");
    expect(resolveMarketFamilyKey("", "Corners")).toBe("CORNERS");
    expect(resolveMarketFamilyKey(undefined, undefined)).toBe("OTHER");
  });
});

describe("formatLineLabel (lossless)", () => {
  it("keeps integer, quarter and half lines exact — never toFixed(1)", () => {
    expect(formatLineLabel(10)).toBe("10");
    expect(formatLineLabel(10.25)).toBe("10.25");
    expect(formatLineLabel(10.5)).toBe("10.5");
    expect(formatLineLabel(10.75)).toBe("10.75");
    expect(formatLineLabel(3.5)).toBe("3.5");
  });
});

describe("formatRecommendedPick — Market Identity Contract labels", () => {
  it('renders "Over 3.5 Corners · Full Match" from structural meta (test 16)', () => {
    const out = formatRecommendedPick("Over 3.5", "Corners", t, {
      period: "full_match",
      scope: "match",
      bookLine: 3.5
    });
    expect(out.label).toBe("Over 3.5 Corners · Full Match");
    expect(out.familyKey).toBe("CORNERS");
  });

  it('renders "Over 3.5 Home Corners · Full Match" for home scope (test 17)', () => {
    const out = formatRecommendedPick("Over 3.5", "Corners", t, {
      period: "full_match",
      scope: "home",
      bookLine: 3.5
    });
    expect(out.label).toBe("Over 3.5 Home Corners · Full Match");
  });

  it('renders "Over 4.5 Corners · 1st Half" for a first-half pick (test 18)', () => {
    const out = formatRecommendedPick("Over 4.5", "Corners", t, {
      period: "first_half",
      scope: "match",
      bookLine: 4.5
    });
    expect(out.label).toBe("Over 4.5 Corners · 1st Half");
  });

  it('renders "Under 10.25 Corners · Full Match" — quarter line stays exact (test 19)', () => {
    const out = formatRecommendedPick("Under 10.25", "Corners", t, {
      period: "full_match",
      scope: "match",
      bookLine: 10.25
    });
    expect(out.label).toBe("Under 10.25 Corners · Full Match");
  });

  it("prefers the structural bookLine over the label — a lossy legacy label is repaired", () => {
    // Legacy persisted label "Under 10.3" (toFixed damage), but bookLine 10.25 is stored.
    const out = formatRecommendedPick("Under 10.3", "Corners", t, {
      period: "full_match",
      scope: "match",
      bookLine: 10.25
    });
    expect(out.label).toBe("Under 10.25 Corners · Full Match");
  });

  it("never invents a period: legacy rows without meta render exactly as before", () => {
    const out = formatRecommendedPick("Under 10.5", "Corners", t);
    expect(out.label).toBe("Under 10.5 Corners");
    expect(out.label).not.toContain("·");
    const unknown = formatRecommendedPick("Under 10.5", "Corners", t, {
      period: null,
      scope: null
    });
    expect(unknown.label).toBe("Under 10.5 Corners");
  });

  it("integer lines render lossless in labels (Under 10, not Under 10.0)", () => {
    const out = formatRecommendedPick("Under 10.0", "Corners", t, {
      period: "full_match",
      scope: "match",
      bookLine: 10
    });
    expect(out.label).toBe("Under 10 Corners · Full Match");
  });
});
