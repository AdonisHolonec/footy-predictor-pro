import { describe, expect, it } from "vitest";
import {
  buildFixtureLabelIndex,
  describeGlobalSpecialBetError,
  formatConfidencePercent,
  formatOdds,
  formatValueScore,
  lookupFixtureLabel,
  marketIconKey,
  marketLabelKey,
  statusLabelKey,
  statusTone,
  summarizeGlobalSpecialBet
} from "./globalSpecialBetView";
import type { GlobalSpecialBet, GlobalSpecialBetSelection } from "../types/globalSpecialBet";

function selection(overrides: Partial<GlobalSpecialBetSelection> = {}): GlobalSpecialBetSelection {
  return {
    id: "sel-1",
    special_bet_id: "bet-1",
    fixture_id: 999001,
    league_id: 39,
    kickoff_at: "2026-08-11T18:30:00.000Z",
    market: "corners",
    selection: "Over 7.5",
    side: "over",
    line: 7.5,
    odds: 1.32,
    confidence: 82,
    value_score: 12.4,
    status: "pending",
    settled_at: null,
    ...overrides
  };
}

function bet(overrides: Partial<GlobalSpecialBet> = {}): GlobalSpecialBet {
  return {
    id: "bet-1",
    user_id: "user-1",
    bet_date: "2026-08-11",
    league_ids: [39, 140],
    league_scope: "39,140",
    variant: 3,
    status: "pending",
    total_odds: 4.812,
    average_confidence: 78.5,
    model_version: "v3",
    created_at: "2026-08-11T09:00:00.000Z",
    settled_at: null,
    settled_total_odds: null,
    selections: [selection(), selection({ id: "sel-2" }), selection({ id: "sel-3" })],
    ...overrides
  };
}

describe("status vocabulary", () => {
  it("maps every backend status to its own tone and label", () => {
    expect(statusTone("won")).toBe("success");
    expect(statusTone("lost")).toBe("danger");
    expect(statusTone("pending")).toBe("warning");
    expect(statusTone("void")).toBe("neutral");

    expect(statusLabelKey("won")).toBe("gsb.statusWon");
    expect(statusLabelKey("lost")).toBe("gsb.statusLost");
    expect(statusLabelKey("pending")).toBe("gsb.statusPending");
    expect(statusLabelKey("void")).toBe("gsb.statusVoid");
  });

  it("does not invent a status for a value the API never sends", () => {
    expect(statusTone("cashed_out")).toBe("neutral");
    expect(statusLabelKey("cashed_out")).toBe("gsb.statusPending");
  });
});

describe("numeric formatting", () => {
  it("returns null instead of zero for a missing value", () => {
    // settled_total_odds is NULL for a lost or pending bet — rendering 0.00
    // there would invent a payout the server refused to express.
    expect(formatOdds(null)).toBeNull();
    expect(formatOdds(undefined)).toBeNull();
    expect(formatOdds("")).toBeNull();
    expect(formatConfidencePercent(null)).toBeNull();
    expect(formatValueScore(null)).toBeNull();
  });

  it("formats a real zero as a real zero", () => {
    expect(formatValueScore(0)).toBe("0.0");
    expect(formatConfidencePercent(0)).toBe("0%");
  });

  it("formats odds and confidence the way the rest of the product does", () => {
    expect(formatOdds(4.8123)).toBe("4.81");
    expect(formatConfidencePercent(78.5)).toBe("79%");
    expect(formatValueScore(12.44)).toBe("12.4");
  });

  it("rejects a non-numeric value rather than coercing it", () => {
    expect(formatOdds("abc")).toBeNull();
  });
});

describe("market vocabulary", () => {
  it("reuses the product's existing market labels for every settleable family", () => {
    expect(marketLabelKey("ou")).toBe("card.marketGoals");
    expect(marketLabelKey("corners")).toBe("match.featCorners");
    expect(marketLabelKey("shots")).toBe("match.featShots");
    expect(marketLabelKey("1x2")).toBe("match.market1x2");
    expect(marketLabelKey("dc")).toBe("recommendation.doubleChance");
    expect(marketLabelKey("btts")).toBe("match.marketGgNgg");
  });

  it("returns null for an unmapped family so the raw value is shown instead of a wrong name", () => {
    expect(marketLabelKey("cards")).toBeNull();
    expect(marketIconKey("cards")).toBe("OTHER");
  });

  it("maps families onto the existing market icons", () => {
    expect(marketIconKey("corners")).toBe("CORNERS");
    expect(marketIconKey("1x2")).toBe("1X2");
  });
});

describe("fixture label lookup", () => {
  const rows = [
    [{ id: 999001, league: "Premier League", teams: { home: "Arsenal", away: "Chelsea" } }],
    [{ id: 999002, league: "La Liga", teams: { home: "Betis", away: "Sevilla" } }]
  ];

  it("joins names from rows the client already holds", () => {
    const index = buildFixtureLabelIndex(rows);
    expect(lookupFixtureLabel(index, 999001)).toEqual({ title: "Arsenal – Chelsea", league: "Premier League" });
    expect(lookupFixtureLabel(index, 999002).league).toBe("La Liga");
  });

  it("degrades to null rather than inventing a name for an unknown fixture", () => {
    const index = buildFixtureLabelIndex(rows);
    expect(lookupFixtureLabel(index, 424242)).toEqual({ title: null, league: null });
    expect(lookupFixtureLabel(undefined, 999001)).toEqual({ title: null, league: null });
  });

  it("keeps the first source that knows a fixture", () => {
    const index = buildFixtureLabelIndex([
      [{ id: 1, league: "First", teams: { home: "A", away: "B" } }],
      [{ id: 1, league: "Second", teams: { home: "C", away: "D" } }]
    ]);
    expect(lookupFixtureLabel(index, 1).league).toBe("First");
  });
});

describe("summary", () => {
  it("passes the snapshot through and counts what the API returned", () => {
    const summary = summarizeGlobalSpecialBet(bet());
    expect(summary.variant).toBe(3);
    expect(summary.selectionCount).toBe(3);
    expect(summary.totalOdds).toBe("4.81");
    expect(summary.averageConfidence).toBe("79%");
    expect(summary.status).toBe("pending");
    expect(summary.settledTotalOdds).toBeNull();
  });

  it("shows settled odds only once the server produced them", () => {
    const won = summarizeGlobalSpecialBet(bet({ status: "won", settled_total_odds: 3.21 }));
    expect(won.settledTotalOdds).toBe("3.21");
    // total_odds is never rewritten by settlement.
    expect(won.totalOdds).toBe("4.81");
  });

  it("keeps settled odds absent for a lost bet", () => {
    expect(summarizeGlobalSpecialBet(bet({ status: "lost" })).settledTotalOdds).toBeNull();
  });
});

describe("error mapping", () => {
  it("prefers the server's own reason over generic copy", () => {
    const view = describeGlobalSpecialBetError(403, "Ligi în afara favoritelor: 61.");
    expect(view.titleKey).toBe("gsb.errorAccessTitle");
    expect(view.message).toBe("Ligi în afara favoritelor: 61.");
    expect(view.retryable).toBe(false);
  });

  it("sends 401 to the auth story, not to a retry loop", () => {
    const view = describeGlobalSpecialBetError(401, null);
    expect(view.titleKey).toBe("gsb.errorAuthTitle");
    expect(view.retryable).toBe(false);
  });

  it("treats a 500 as a retryable failure and never as 'not enough selections'", () => {
    const view = describeGlobalSpecialBetError(500, null);
    expect(view.titleKey).toBe("gsb.errorTitle");
    expect(view.retryable).toBe(true);
    expect(view.messageKey).not.toBe("gsb.unavailableDesc");
  });

  it("keeps 400 non-retryable and surfaces the validation reason", () => {
    const view = describeGlobalSpecialBetError(400, "variant invalid (permise: 3, 5, 8).");
    expect(view.titleKey).toBe("gsb.errorRequestTitle");
    expect(view.message).toBe("variant invalid (permise: 3, 5, 8).");
    expect(view.retryable).toBe(false);
  });

  it("maps 409 to the conflict story the contract describes", () => {
    expect(describeGlobalSpecialBetError(409, null).titleKey).toBe("gsb.errorConflictTitle");
  });
});
