/**
 * Domestic division tiers for the league selector ordering.
 *
 * Keyed by STABLE PROVIDER LEAGUE ID (API-Football), never by display name. Every id below was
 * read from the provider's current catalog (`/leagues?current=true`, 1,239 rows on 2026-09-23).
 * Only leagues whose division level is unambiguous are listed; everything else (cups, youth,
 * women's, reserve, regional amateur, play-off entries, national-team competitions) is left
 * UNCLASSIFIED on purpose and falls back to an alphabetical block at the end of the list.
 *
 * `tier` is the domestic pyramid level (1 = top flight). Parallel groups of one level
 * (Serie C Girone A/B/C, Liga III Seria 1–10, Regionalliga Nord/West…) share that level.
 *
 * This is a UI ordering concern only. It is independent of the model's league profiles and of
 * the meta-learning "quality tiers" (server-utils/metaLearning/leagueTiers.config.json), which
 * rank competitions by comparability, not by division.
 */

export type LeagueTierEntry = { tier: number; country: string };

/**
 * Deliberate country order used INSIDE a tier. The first eight follow the project's established
 * elite order (ELITE_LEAGUE_META: England, Spain, Italy, Germany, France, Netherlands, Romania,
 * USA); the rest is an editorial order of the remaining classified markets. Country strings are
 * the provider's own spelling (e.g. "Czech-Republic", "Saudi-Arabia").
 */
export const LEAGUE_COUNTRY_PRIORITY: readonly string[] = [
  "England", "Spain", "Italy", "Germany", "France", "Netherlands", "Romania", "USA",
  "Portugal", "Belgium", "Turkey", "Scotland", "Austria", "Switzerland", "Denmark", "Sweden",
  "Norway", "Poland", "Czech-Republic", "Greece", "Croatia", "Serbia", "Hungary", "Ukraine",
  "Bulgaria", "Slovakia", "Slovenia", "Finland", "Cyprus", "Israel", "Ireland", "Wales",
  "Northern-Ireland", "Brazil", "Argentina", "Mexico", "Colombia", "Chile", "Uruguay",
  "Japan", "South-Korea", "China", "Saudi-Arabia", "Australia", "Egypt", "Morocco"
];

/**
 * International CLUB competitions the product already treats as elite (leagueProfiles.config.json).
 * They are not domestic divisions, so they never take a tier; they are ordered as their own block
 * after every classified domestic tier and before the unclassified remainder, in this order.
 */
export const INTERNATIONAL_CLUB_COMPETITION_IDS: readonly number[] = [2, 3, 848];

const D = (tier: number, country: string): LeagueTierEntry => ({ tier, country });

export const LEAGUE_TIER_BY_ID: Readonly<Record<number, LeagueTierEntry>> = {
  // ---- England
  39: D(1, "England"), 40: D(2, "England"), 41: D(3, "England"), 42: D(4, "England"), 43: D(5, "England"),
  // ---- Spain (Primera RFEF groups = 3, Segunda RFEF groups = 4)
  140: D(1, "Spain"), 141: D(2, "Spain"),
  435: D(3, "Spain"), 436: D(3, "Spain"), 437: D(3, "Spain"), 438: D(3, "Spain"), 692: D(3, "Spain"),
  875: D(4, "Spain"), 876: D(4, "Spain"), 877: D(4, "Spain"), 878: D(4, "Spain"), 879: D(4, "Spain"),
  // ---- Italy (Serie C gironi = 3, Serie D gironi = 4)
  135: D(1, "Italy"), 136: D(2, "Italy"), 138: D(3, "Italy"), 942: D(3, "Italy"), 943: D(3, "Italy"),
  426: D(4, "Italy"), 427: D(4, "Italy"), 428: D(4, "Italy"), 429: D(4, "Italy"), 430: D(4, "Italy"),
  431: D(4, "Italy"), 432: D(4, "Italy"), 433: D(4, "Italy"), 434: D(4, "Italy"),
  // ---- Germany (Regionalliga = 4)
  78: D(1, "Germany"), 79: D(2, "Germany"), 80: D(3, "Germany"),
  83: D(4, "Germany"), 84: D(4, "Germany"), 85: D(4, "Germany"), 86: D(4, "Germany"), 87: D(4, "Germany"),
  // ---- France ("Ligue 3" = National = 3, National 2 groups = 4, National 3 groups = 5)
  61: D(1, "France"), 62: D(2, "France"), 63: D(3, "France"),
  67: D(4, "France"), 68: D(4, "France"), 69: D(4, "France"), 70: D(4, "France"),
  461: D(5, "France"), 462: D(5, "France"), 463: D(5, "France"), 464: D(5, "France"), 465: D(5, "France"),
  466: D(5, "France"), 467: D(5, "France"), 468: D(5, "France"), 469: D(5, "France"), 470: D(5, "France"),
  471: D(5, "France"), 472: D(5, "France"), 1029: D(5, "France"),
  // ---- Romania (Liga III series = 3)
  283: D(1, "Romania"), 284: D(2, "Romania"),
  784: D(3, "Romania"), 785: D(3, "Romania"), 786: D(3, "Romania"), 787: D(3, "Romania"), 788: D(3, "Romania"),
  789: D(3, "Romania"), 790: D(3, "Romania"), 791: D(3, "Romania"), 792: D(3, "Romania"), 793: D(3, "Romania"),
  // ---- Netherlands / Portugal / Belgium
  88: D(1, "Netherlands"), 89: D(2, "Netherlands"), 492: D(3, "Netherlands"), 92: D(4, "Netherlands"),
  94: D(1, "Portugal"), 95: D(2, "Portugal"), 865: D(3, "Portugal"),
  144: D(1, "Belgium"), 145: D(2, "Belgium"), 487: D(3, "Belgium"),
  // ---- Turkey (3. Lig groups = 4) / Scotland
  203: D(1, "Turkey"), 204: D(2, "Turkey"), 205: D(3, "Turkey"), 552: D(4, "Turkey"), 553: D(4, "Turkey"), 554: D(4, "Turkey"),
  179: D(1, "Scotland"), 180: D(2, "Scotland"), 183: D(3, "Scotland"), 184: D(4, "Scotland"),
  // ---- Central / Northern Europe
  218: D(1, "Austria"), 219: D(2, "Austria"),
  207: D(1, "Switzerland"), 208: D(2, "Switzerland"),
  119: D(1, "Denmark"), 120: D(2, "Denmark"), 122: D(3, "Denmark"), 862: D(4, "Denmark"),
  113: D(1, "Sweden"), 114: D(2, "Sweden"), 563: D(3, "Sweden"), 564: D(3, "Sweden"),
  103: D(1, "Norway"), 104: D(2, "Norway"), 473: D(3, "Norway"), 474: D(3, "Norway"),
  106: D(1, "Poland"), 107: D(2, "Poland"), 109: D(3, "Poland"),
  345: D(1, "Czech-Republic"), 346: D(2, "Czech-Republic"),
  197: D(1, "Greece"), 494: D(2, "Greece"),
  210: D(1, "Croatia"), 211: D(2, "Croatia"), 946: D(3, "Croatia"),
  286: D(1, "Serbia"), 287: D(2, "Serbia"),
  271: D(1, "Hungary"), 272: D(2, "Hungary"),
  333: D(1, "Ukraine"), 334: D(2, "Ukraine"),
  172: D(1, "Bulgaria"), 173: D(2, "Bulgaria"),
  332: D(1, "Slovakia"), 506: D(2, "Slovakia"),
  373: D(1, "Slovenia"), 374: D(2, "Slovenia"),
  244: D(1, "Finland"), 1087: D(2, "Finland"), 245: D(3, "Finland"),
  318: D(1, "Cyprus"), 319: D(2, "Cyprus"), 320: D(3, "Cyprus"),
  383: D(1, "Israel"), 382: D(2, "Israel"), 496: D(3, "Israel"),
  357: D(1, "Ireland"), 358: D(2, "Ireland"),
  110: D(1, "Wales"), 111: D(2, "Wales"),
  408: D(1, "Northern-Ireland"), 407: D(2, "Northern-Ireland"),
  // ---- Americas
  253: D(1, "USA"), 255: D(2, "USA"), 489: D(3, "USA"), 256: D(4, "USA"),
  71: D(1, "Brazil"), 72: D(2, "Brazil"), 75: D(3, "Brazil"), 76: D(4, "Brazil"),
  128: D(1, "Argentina"), 129: D(2, "Argentina"), 131: D(3, "Argentina"), 134: D(3, "Argentina"), 132: D(4, "Argentina"), 133: D(5, "Argentina"),
  262: D(1, "Mexico"), 263: D(2, "Mexico"),
  239: D(1, "Colombia"), 240: D(2, "Colombia"),
  265: D(1, "Chile"), 266: D(2, "Chile"), 711: D(3, "Chile"),
  268: D(1, "Uruguay"), 269: D(2, "Uruguay"),
  // ---- Asia / Oceania / Africa
  98: D(1, "Japan"), 99: D(2, "Japan"), 100: D(3, "Japan"),
  292: D(1, "South-Korea"), 293: D(2, "South-Korea"),
  169: D(1, "China"), 170: D(2, "China"), 929: D(3, "China"),
  307: D(1, "Saudi-Arabia"), 308: D(2, "Saudi-Arabia"), 309: D(3, "Saudi-Arabia"),
  188: D(1, "Australia"),
  233: D(1, "Egypt"), 887: D(2, "Egypt"),
  200: D(1, "Morocco"), 201: D(2, "Morocco")
};
