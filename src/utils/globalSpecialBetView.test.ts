import { describe, expect, it } from "vitest";
import {
  buildFixtureLabelIndex,
  describeGlobalSpecialBetError,
  formatConfidencePercent,
  formatDateTime,
  formatOdds,
  formatProbabilityPercent,
  formatValueScore,
  isDecidingSelection,
  isUnderwaySelection,
  lookupFixtureLabel,
  orderSelectionsByKickoff,
  readBetProgress,
  readGlobalSpecialBet,
  marketIconKey,
  marketLabelKey,
  resolveSelectionLabel,
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
    // The pre-048 default: a stored selection with no names of its own, which
    // is what every fixture in this file wants unless it says otherwise.
    fixture_label: null,
    league_name: null,
    kickoff_at: "2026-08-11T18:30:00.000Z",
    market: "corners",
    selection: "Over 7.5",
    side: "over",
    line: 7.5,
    odds: 1.32,
    confidence: 82,
    value_score: 12.4,
    // Pre-050 default: no stored probability, exactly like every legacy row.
    probability: null,
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
    // Pre-050 default: legacy bets carry no stored ticket probability.
    ticket_probability: null,
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

  it("formats a stored 0-1 probability as a whole percent, and null as null", () => {
    // 050 stores fractions; the UI speaks percentages. A legacy NULL must stay
    // null — "0%" would turn an honest absence into a fake certainty.
    expect(formatProbabilityPercent(0.3256)).toBe("33%");
    expect(formatProbabilityPercent(0.9)).toBe("90%");
    expect(formatProbabilityPercent(1)).toBe("100%");
    expect(formatProbabilityPercent(null)).toBeNull();
    expect(formatProbabilityPercent(undefined)).toBeNull();
    expect(formatProbabilityPercent("")).toBeNull();
    expect(formatProbabilityPercent("abc")).toBeNull();
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

describe("naming a selection", () => {
  const index = buildFixtureLabelIndex([
    [{ id: 999001, league: "Joined League", teams: { home: "Joined H", away: "Joined A" } }]
  ]);

  it("prefers what the bet stored over what the session happens to hold", () => {
    const stored = selection({ fixture_label: "Arsenal – Chelsea", league_name: "Premier League" });
    // Not a tie-break: the snapshot is what was actually bet on, and the index
    // only knows fixtures still loaded — the wrong set for an old bet.
    expect(resolveSelectionLabel(stored, index)).toEqual({
      title: "Arsenal – Chelsea",
      league: "Premier League"
    });
  });

  it("names a selection with no fixture loaded anywhere", () => {
    const stored = selection({
      fixture_id: 424242,
      fixture_label: "Arsenal – Chelsea",
      league_name: "Premier League"
    });
    expect(resolveSelectionLabel(stored, index).title).toBe("Arsenal – Chelsea");
    expect(resolveSelectionLabel(stored, undefined).league).toBe("Premier League");
  });

  it("falls back to the join for a selection stored before 048", () => {
    expect(resolveSelectionLabel(selection(), index)).toEqual({
      title: "Joined H – Joined A",
      league: "Joined League"
    });
  });

  it("falls back per field, keeping the half it has", () => {
    const half = selection({ fixture_label: "Arsenal – Chelsea", league_name: null });
    expect(resolveSelectionLabel(half, index)).toEqual({
      title: "Arsenal – Chelsea",
      league: "Joined League"
    });
  });

  it("treats an empty stored name as no name at all", () => {
    const blank = selection({ fixture_label: "   ", league_name: "" });
    expect(resolveSelectionLabel(blank, index).title).toBe("Joined H – Joined A");
    expect(resolveSelectionLabel(blank, index).league).toBe("Joined League");
  });

  it("degrades to null when neither the snapshot nor the join knows", () => {
    expect(resolveSelectionLabel(selection({ fixture_id: 424242 }), index)).toEqual({
      title: null,
      league: null
    });
  });
});

describe("reading what happened to a bet", () => {
  const legs = (...statuses: GlobalSpecialBetSelection["status"][]) =>
    statuses.map((status, i) => selection({ id: `sel-${i}`, status }));

  it("names the single selection that brought a bet down", () => {
    // aggregateBetStatus() loses the bet on ANY lost leg, so with exactly one
    // lost leg that leg is the whole reason — worth saying out loud.
    const r = readGlobalSpecialBet(bet({ status: "lost", selections: legs("won", "won", "lost") }));
    expect(r.key).toBe("gsb.readingLostOne");
    expect(r.tally).toEqual({ won: 2, lost: 1, void: 0, pending: 0 });
  });

  it("counts them instead when several failed, because none of them decided it alone", () => {
    const r = readGlobalSpecialBet(bet({ status: "lost", selections: legs("won", "lost", "lost") }));
    expect(r.key).toBe("gsb.readingLostMany");
    expect(r.vars).toEqual({ n: 2, total: 3 });
  });

  it("separates a clean win from one carried by a void", () => {
    const clean = readGlobalSpecialBet(bet({ status: "won", selections: legs("won", "won", "won") }));
    expect(clean.key).toBe("gsb.readingWonClean");
    expect(clean.vars).toEqual({ total: 3 });

    // A void settles at 1.00, which is why the settled odds sit below what was
    // promised. Without this line the gap between the two numbers is unexplained.
    const one = readGlobalSpecialBet(bet({ status: "won", selections: legs("won", "won", "void") }));
    expect(one.key).toBe("gsb.readingWonVoidOne");

    const many = readGlobalSpecialBet(bet({ status: "won", selections: legs("won", "void", "void") }));
    expect(many.key).toBe("gsb.readingWonVoidMany");
    expect(many.vars).toEqual({ n: 2 });
  });

  it("says a fully voided bet never ran", () => {
    const r = readGlobalSpecialBet(bet({ status: "void", selections: legs("void", "void", "void") }));
    expect(r.key).toBe("gsb.readingVoid");
  });

  it("reports progress while the bet is undecided", () => {
    const r = readGlobalSpecialBet(bet({ status: "pending", selections: legs("won", "pending", "pending") }));
    expect(r.key).toBe("gsb.readingPending");
    expect(r.vars).toEqual({ won: 1, pending: 2, total: 3 });
  });

  it("treats a status it does not model as pending rather than miscounting it", () => {
    const odd = [selection({ status: "weird" as GlobalSpecialBetSelection["status"] })];
    const r = readGlobalSpecialBet(bet({ status: "pending", selections: odd }));
    expect(r.tally.pending).toBe(1);
    expect(r.total).toBe(1);
  });

  it("marks a losing leg only on a bet that actually lost", () => {
    const lost = selection({ status: "lost" });
    expect(isDecidingSelection("lost", lost)).toBe(true);
    // Nothing "decides" a win — every leg had to land, so highlighting one
    // would tell a story the settlement rules do not support.
    expect(isDecidingSelection("won", selection({ status: "won" }))).toBe(false);
    expect(isDecidingSelection("pending", lost)).toBe(false);
  });
});

describe("a bet still running", () => {
  const NOON = Date.parse("2026-08-11T12:00:00.000Z");
  const at = (id: string, kickoff: string, status: GlobalSpecialBetSelection["status"] = "pending") =>
    selection({ id, kickoff_at: kickoff, status });

  it("counts settled, under way and waiting legs separately", () => {
    const progress = readBetProgress(
      bet({
        selections: [
          at("sel-1", "2026-08-11T09:00:00.000Z", "won"),
          at("sel-2", "2026-08-11T11:30:00.000Z"),
          at("sel-3", "2026-08-11T18:30:00.000Z")
        ]
      }),
      NOON
    );
    expect(progress).toMatchObject({ settled: 1, underway: 1, waiting: 1, total: 3 });
    expect(progress.next?.id).toBe("sel-3");
  });

  it("keeps a graded leg settled however long ago it kicked off", () => {
    // The clock never overrules settlement: a match played this morning and
    // already won must not be reported as still being decided.
    const progress = readBetProgress(
      bet({ selections: [at("sel-1", "2026-08-11T09:00:00.000Z", "won")] }),
      NOON
    );
    expect(progress).toMatchObject({ settled: 1, underway: 0, waiting: 0 });
  });

  it("names the earliest leg still to come, not the first one stored", () => {
    const progress = readBetProgress(
      bet({
        selections: [
          at("late", "2026-08-11T21:00:00.000Z"),
          at("early", "2026-08-11T19:00:00.000Z"),
          at("mid", "2026-08-11T20:00:00.000Z")
        ]
      }),
      NOON
    );
    expect(progress.next?.id).toBe("early");
  });

  it("has nothing next once every leg has started", () => {
    const progress = readBetProgress(
      bet({
        selections: [at("sel-1", "2026-08-11T10:00:00.000Z"), at("sel-2", "2026-08-11T11:00:00.000Z")]
      }),
      NOON
    );
    expect(progress.next).toBeNull();
    expect(progress.underway).toBe(2);
  });

  it("treats a kickoff it cannot parse as waiting and never offers it as next", () => {
    // We cannot claim a match started without a time, and we have no time to
    // show for it either — so it waits, silently.
    const progress = readBetProgress(bet({ selections: [at("sel-1", "not-a-date")] }), NOON);
    expect(progress).toMatchObject({ underway: 0, waiting: 1 });
    expect(progress.next).toBeNull();
  });

  it("marks a leg as under way only while it is pending and started", () => {
    expect(isUnderwaySelection(at("sel-1", "2026-08-11T11:00:00.000Z"), NOON)).toBe(true);
    expect(isUnderwaySelection(at("sel-1", "2026-08-11T13:00:00.000Z"), NOON)).toBe(false);
    expect(isUnderwaySelection(at("sel-1", "2026-08-11T11:00:00.000Z", "won"), NOON)).toBe(false);
    expect(isUnderwaySelection(at("sel-1", "not-a-date"), NOON)).toBe(false);
  });

  it("orders the legs by kickoff and sinks the undated ones to the end", () => {
    const ordered = orderSelectionsByKickoff([
      at("late", "2026-08-11T21:00:00.000Z"),
      at("undated", "not-a-date"),
      at("early", "2026-08-11T19:00:00.000Z")
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["early", "late", "undated"]);
  });

  it("keeps the server's order between legs kicking off together", () => {
    const same = "2026-08-11T19:00:00.000Z";
    const ordered = orderSelectionsByKickoff([at("first", same), at("second", same), at("third", same)]);
    expect(ordered.map((s) => s.id)).toEqual(["first", "second", "third"]);
  });

  it("does not reorder the caller's array", () => {
    const input = [at("late", "2026-08-11T21:00:00.000Z"), at("early", "2026-08-11T19:00:00.000Z")];
    orderSelectionsByKickoff(input);
    expect(input.map((s) => s.id)).toEqual(["late", "early"]);
  });

  it("returns null for a timestamp it cannot read rather than an Invalid Date", () => {
    expect(formatDateTime("not-a-date", "ro")).toBeNull();
    // The rendered text is timezone- and ICU-dependent, so this asserts only
    // what the product depends on: a day and a clock time, never "Invalid Date".
    const shown = formatDateTime("2026-08-11T18:30:00.000Z", "ro");
    expect(shown).toMatch(/\d{1,2}/);
    expect(shown).toMatch(/\d{1,2}[:.]\d{2}/);
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

  it("surfaces the STORED ticket probability, formatted, and never recomputes it", () => {
    // The legs would multiply to something else entirely — the snapshot wins.
    const summary = summarizeGlobalSpecialBet(bet({ ticket_probability: 0.3256 }));
    expect(summary.ticketProbability).toBe("33%");
  });

  it("keeps ticket probability null on a legacy snapshot — no fake 0%", () => {
    expect(summarizeGlobalSpecialBet(bet()).ticketProbability).toBeNull();
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
