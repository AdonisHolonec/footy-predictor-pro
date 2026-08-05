import { describe, expect, it } from "vitest";
import { resolveMarketFamilyKey } from "./formatRecommendation";

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
