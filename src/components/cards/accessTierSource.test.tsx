import type { ComponentProps } from "react";
import fs from "node:fs";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PredictionRow } from "../../types";

/**
 * PR2b regression — the ACCESS-class consumers on the admin workspace.
 *
 * These two surfaces were missed by the first consumer audit. Before PR2b they
 * read `user.tier`, which `refreshTierStatus` happened to overwrite with the
 * EFFECTIVE tier — so they were accidentally correct. PR2b restored `user.tier`
 * to the requested plan, which silently made them wrong:
 *
 *   admin, profile tier "free"  ->  server serves tier "ultra"
 *   accessTier={user.tier}      ->  "free"  ->  MarketPicksGrid hides corners
 *
 * `accessTier` is not decoration: MarketPicksGrid mirrors maskPredictionForTier(),
 * so a FREE accessTier renders an ULTRA payload as FREE. That is the exact
 * inverse of the bug PR2b exists to fix, and it needs no bonus grant to happen —
 * every admin whose plan is not "ultra" hits it on the next page load.
 */

const captured: Array<Record<string, unknown>> = [];

vi.mock("./PredictionCard", () => ({
  default: (props: Record<string, unknown>) => {
    captured.push(props);
    return <div data-testid="card" />;
  }
}));

const { default: PredictionList } = await import("./PredictionList");

const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src", rel), "utf8");

const ROW = { id: 1, home: "A", away: "B", league: "L", kickoff: "2026-08-27T18:00:00Z" } as unknown as PredictionRow;

type ListProps = ComponentProps<typeof PredictionList>;

function renderList(props: Pick<ListProps, "user" | "userTier">) {
  captured.length = 0;
  render(
    <PredictionList
      variant="observatory"
      preds={[ROW]}
      groupedDisplayedMatches={[{ dateKey: "2026-08-27", matches: [ROW] }]}
      filterMode="ALL"
      setFilterMode={() => {}}
      sortBy="TIME"
      setSortBy={() => {}}
      pendingAmongDisplayedPreds={0}
      logoColors={{}}
      hashColor={() => "#888"}
      onSelectMatch={() => {}}
      onOpenAuth={() => {}}
      {...props}
    />
  );
  return captured[0];
}

afterEach(() => {
  cleanup();
});

describe("access-tier consumers read the EFFECTIVE tier", () => {
  it("[F] admin on a free plan, served ultra -> accessTier ultra", () => {
    // The precise failure the review caught: quotaExempt forces the server to
    // ULTRA while requestedTier stays the admin's own plan.
    const card = renderList({ user: { role: "admin", tier: "free" }, userTier: "ultra" });
    expect(card.accessTier).toBe("ultra");
    expect(card.accessTier).not.toBe("free");
  });

  it("a free user with an active bonus is rendered at ultra, not at their plan", () => {
    const card = renderList({ user: { role: "user", tier: "free" }, userTier: "ultra" });
    expect(card.accessTier).toBe("ultra");
    expect(card.canShowSpecialBet).toBe(true);
  });

  it("an expired premium user with no bonus is rendered at free, not at their plan", () => {
    // The other direction: the plan says premium, entitlement says free. The
    // card must follow entitlement or it shows markets the server withheld.
    const card = renderList({ user: { role: "user", tier: "premium" }, userTier: "free" });
    expect(card.accessTier).toBe("free");
    expect(card.canShowSpecialBet).toBe(false);
  });

  it("the admin role still short-circuits canShowSpecialBet", () => {
    const card = renderList({ user: { role: "admin", tier: "free" }, userTier: "free" });
    expect(card.canShowSpecialBet).toBe(true);
  });

  it("a plain free user gets neither special bet nor elevated markets", () => {
    const card = renderList({ user: { role: "user", tier: "free" }, userTier: "free" });
    expect(card.accessTier).toBe("free");
    expect(card.canShowSpecialBet).toBe(false);
  });
});

describe("no access decision reads the plan field", () => {
  /*
    Source-level, following the existing convention in supportEntry.test.tsx:
    App.tsx is the admin workspace shell and rendering it needs the whole
    controller, a session and a router. The guarantee that matters is narrow and
    textual — `user.tier` must never reach an access prop — so assert exactly
    that rather than stand up the tree.
  */
  it("[C] App.tsx passes the effective tier to MatchModal", () => {
    const app = src("App.tsx");
    expect(app).toMatch(/accessTier=\{c\.userTier \|\| "free"\}/);
    expect(app).toMatch(/canShowSpecialBet=\{c\.user\?\.role === "admin" \|\| c\.userTier === "ultra"\}/);
    expect(app).not.toMatch(/accessTier=\{c\.user\?\.tier/);
  });

  it("[D] PredictionList.tsx passes the effective tier to PredictionCard", () => {
    const list = src("components/cards/PredictionList.tsx");
    expect(list).toMatch(/accessTier=\{userTier\}/);
    expect(list).not.toMatch(/accessTier=\{user\?\.tier\}/);
    expect(list).not.toMatch(/user\?\.tier === "ultra"/);
  });

  it("userTier is threaded from the controller through both bodies", () => {
    expect(src("hooks/useAppController.ts")).toMatch(/userTier,/);
    expect(src("components/layout/GuestBody.tsx")).toMatch(/userTier=\{props\.userTier\}/);
    expect(src("components/layout/ObservatoryBody.tsx")).toMatch(/userTier=\{rest\.userTier\}/);
  });

  it("no src file routes user.tier into an access prop", () => {
    // A blunt sweep, deliberately: this class of bug is invisible in review
    // precisely because `user.tier` reads like the right thing.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (/accessTier=\{[^}]*\buser\??\.?\??\.tier\b/.test(text)) offenders.push(full);
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
