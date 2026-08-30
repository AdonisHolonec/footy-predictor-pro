import { beforeAll, describe, expect, it } from "vitest";
import {
  formatLineLabel,
  formatMarketPeriodShort,
  formatMarketScopeShort,
  formatRecommendedPick,
  resolveMarketFamilyKey
} from "./formatRecommendation";
import { ensureCatalog, translate } from "../i18n/translate";

// EN registers lazily; without awaiting this the fallback chain serves RO.
// (RO is eager — no ensure needed for tRo.)
beforeAll(() => ensureCatalog("en"));
const t = (key: string, params?: Record<string, string | number>) => translate("en", key, params);
const tRo = (key: string, params?: Record<string, string | number>) => translate("ro", key, params);

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
  it('renders "Over 3.5 Corners · FT" from structural meta (test 16)', () => {
    const out = formatRecommendedPick("Over 3.5", "Corners", t, {
      period: "full_match",
      scope: "match",
      bookLine: 3.5
    });
    expect(out.label).toBe("Over 3.5 Corners · FT");
    expect(out.familyKey).toBe("CORNERS");
  });

  it('renders "Over 3.5 Home Corners · FT" for home scope (test 17)', () => {
    const out = formatRecommendedPick("Over 3.5", "Corners", t, {
      period: "full_match",
      scope: "home",
      bookLine: 3.5
    });
    expect(out.label).toBe("Over 3.5 Home Corners · FT");
  });

  it('renders "Over 4.5 Corners · FH" for a first-half pick (test 18)', () => {
    const out = formatRecommendedPick("Over 4.5", "Corners", t, {
      period: "first_half",
      scope: "match",
      bookLine: 4.5
    });
    expect(out.label).toBe("Over 4.5 Corners · FH");
  });

  it('renders "Under 10.25 Corners · FT" — quarter line stays exact (test 19)', () => {
    const out = formatRecommendedPick("Under 10.25", "Corners", t, {
      period: "full_match",
      scope: "match",
      bookLine: 10.25
    });
    expect(out.label).toBe("Under 10.25 Corners · FT");
  });

  it("prefers the structural bookLine over the label — a lossy legacy label is repaired", () => {
    // Legacy persisted label "Under 10.3" (toFixed damage), but bookLine 10.25 is stored.
    const out = formatRecommendedPick("Under 10.3", "Corners", t, {
      period: "full_match",
      scope: "match",
      bookLine: 10.25
    });
    expect(out.label).toBe("Under 10.25 Corners · FT");
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
    expect(out.label).toBe("Under 10 Corners · FT");
  });
});

describe("formatMarketPeriodShort — compact period abbreviations (product rule)", () => {
  it("maps the four defined periods and nothing else", () => {
    expect(formatMarketPeriodShort("full_match")).toBe("FT");
    expect(formatMarketPeriodShort("first_half")).toBe("FH");
    expect(formatMarketPeriodShort("second_half")).toBe("SH");
    expect(formatMarketPeriodShort("extra_time")).toBe("ET");
  });

  it("never invents an abbreviation for unknown or undefined periods", () => {
    expect(formatMarketPeriodShort("weird_period")).toBeNull();
    expect(formatMarketPeriodShort(null)).toBeNull();
    expect(formatMarketPeriodShort(undefined)).toBeNull();
  });
});

describe("compact period labels in recommended picks", () => {
  it('renders "Over 0.5 Goals · ET" for an extra-time pick', () => {
    const out = formatRecommendedPick("Over 0.5 Goals", "Over/Under", t, {
      period: "extra_time",
      scope: "match",
      bookLine: 0.5
    });
    expect(out.label).toContain("· ET");
  });

  it("keeps the verbose period in ariaLabel while the visual label is compact", () => {
    const out = formatRecommendedPick("Over 4.5", "Corners", t, {
      period: "full_match",
      scope: "match",
      bookLine: 4.5
    });
    expect(out.label).toBe("Over 4.5 Corners · FT");
    expect(out.ariaLabel).toBe("Over 4.5 Corners · Full Match");
  });

  it('renders "Over 4.5 Corners · SH" for a second-half pick, verbose in aria', () => {
    const out = formatRecommendedPick("Over 4.5", "Corners", t, {
      period: "second_half",
      scope: "match",
      bookLine: 4.5
    });
    expect(out.label).toBe("Over 4.5 Corners · SH");
    expect(out.ariaLabel).toBe("Over 4.5 Corners · 2nd Half");
  });

  it("does not mutate the internal period descriptor it renders from", () => {
    const meta = { period: "full_match", scope: "match", bookLine: 4.5 };
    formatRecommendedPick("Over 4.5", "Corners", t, meta);
    expect(meta.period).toBe("full_match");
  });

  it("ariaLabel stays verbose for compact market names even without a period", () => {
    const out = formatRecommendedPick("GG", "BTTS", t);
    expect(out.label).toBe("BTTS");
    expect(out.ariaLabel).toBe("Both Teams To Score – Yes");
  });
});

describe("compact market labels — approved mapping (STEP 2)", () => {
  const ftMeta = { period: "full_match", scope: "match", bookLine: null };

  it("BTTS is locale-native: GG/NGG in RO, BTTS/No BTTS in EN", () => {
    expect(formatRecommendedPick("GG", "BTTS", tRo, ftMeta).label).toBe("GG · FT");
    expect(formatRecommendedPick("NGG", "BTTS", tRo, ftMeta).label).toBe("NGG · FT");
    expect(formatRecommendedPick("GG", "BTTS", t, ftMeta).label).toBe("BTTS · FT");
    expect(formatRecommendedPick("NGG", "BTTS", t, ftMeta).label).toBe("No BTTS · FT");
  });

  it("BTTS aria keeps the full sentence in each locale", () => {
    expect(formatRecommendedPick("GG", "BTTS", tRo, ftMeta).ariaLabel).toBe(
      "Ambele Echipe Marchează – Da · Meci întreg"
    );
    expect(formatRecommendedPick("GG", "BTTS", t, ftMeta).ariaLabel).toBe(
      "Both Teams To Score – Yes · Full Match"
    );
  });

  it("Double Chance compacts to DC 1X / DC 12 / DC X2 with verbose aria", () => {
    for (const code of ["1X", "12", "X2"] as const) {
      const out = formatRecommendedPick(code, "Double Chance", t, ftMeta);
      expect(out.label).toBe(`DC ${code} · FT`);
      expect(out.ariaLabel).toBe(`Double Chance ${code} · Full Match`);
    }
  });

  it("1X2 stays verbose — never compacted to bare 1/X/2", () => {
    expect(formatRecommendedPick("1", "1X2", t).label).toBe("Home Win");
    expect(formatRecommendedPick("X", "1X2", t).label).toBe("Draw");
    expect(formatRecommendedPick("2", "1X2", t).label).toBe("Away Win");
    expect(formatRecommendedPick("1", "1X2", tRo).label).toBe("Victorie Gazde");
  });

  it('Correct Score compacts to "CS 2-1" with verbose aria', () => {
    const out = formatRecommendedPick("2-1", "Correct Score", t, ftMeta);
    expect(out.label).toBe("CS 2-1 · FT");
    expect(out.ariaLabel).toBe("Correct Score 2-1 · Full Match");
  });

  it("scope keeps full words (Home/Gazde, Away/Oaspeți) — never single letters", () => {
    const home = formatRecommendedPick("Over 3.5", "Corners", t, { period: "full_match", scope: "home", bookLine: 3.5 });
    expect(home.label).toBe("Over 3.5 Home Corners · FT");
    const awayRo = formatRecommendedPick("Sub 3.5", "Corners", tRo, { period: "full_match", scope: "away", bookLine: 3.5 });
    expect(awayRo.label).toBe("Sub 3.5 Oaspeți Cornere · FT");
    expect(formatMarketScopeShort("home", t)).toBe("Home");
    expect(formatMarketScopeShort("away", tRo)).toBe("Oaspeți");
  });

  it("match scope adds no suffix; unknown scope adds nothing", () => {
    const out = formatRecommendedPick("Over 3.5", "Corners", t, { period: "full_match", scope: "match", bookLine: 3.5 });
    expect(out.label).toBe("Over 3.5 Corners · FT");
    expect(formatMarketScopeShort("match", t)).toBeNull();
    expect(formatMarketScopeShort("weird", t)).toBeNull();
    expect(formatMarketScopeShort(null, t)).toBeNull();
  });

  it("compact branches leave internal metadata untouched", () => {
    const meta = { period: "full_match", scope: "match", bookLine: null };
    formatRecommendedPick("GG", "BTTS", tRo, meta);
    formatRecommendedPick("1X", "Double Chance", t, meta);
    formatRecommendedPick("2-1", "Correct Score", t, meta);
    expect(meta).toEqual({ period: "full_match", scope: "match", bookLine: null });
  });
});

describe("shots families are labelled unambiguously (audit: fixture 1557383)", () => {
  const meta = (bookLine: number) => ({ period: "full_match", scope: "match", bookLine });

  it("renders a total-shots pick as Total shots and a SOT pick as Shots on target (EN)", () => {
    const total = formatRecommendedPick("Shots Over 10.5", "Shots", t, meta(10.5));
    const sot = formatRecommendedPick("SOT Over 8.5", "Shots on Target", t, meta(8.5));
    expect(total.label).toBe("Over 10.5 Total shots · FT");
    expect(sot.label).toBe("Over 8.5 Shots on target · FT");
    expect(total.label).not.toBe(sot.label);
    // Family key is unchanged on purpose — Special Bet diversity still sees one SHOTS slot.
    expect(total.familyKey).toBe("SHOTS");
    expect(sot.familyKey).toBe("SHOTS");
  });

  it("uses the same wording in RO", () => {
    expect(formatRecommendedPick("Shots Over 21.5", "Shots", tRo, meta(21.5)).label).toBe("Peste 21.5 Total șuturi · FT");
    expect(formatRecommendedPick("SOT Under 9.5", "Shots on Target", tRo, meta(9.5)).label).toBe("Sub 9.5 Șuturi la poartă · FT");
  });

  it("legacy rows without a persisted family are still told apart by the server's own label prefix", () => {
    expect(formatRecommendedPick("SOT Over 7.5", undefined, t).label).toBe("Over 7.5 Shots on target");
    expect(formatRecommendedPick("Shots Over 21.5", undefined, t).label).toBe("Over 21.5 Total shots");
    expect(resolveMarketFamilyKey("SOT Over 7.5")).toBe("SHOTS");
  });
});
