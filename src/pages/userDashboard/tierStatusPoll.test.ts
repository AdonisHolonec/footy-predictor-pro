import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The tierStatus poll is a background timer, and its cost is entirely
 * off-screen: each tick INCRs the shared `anonrl:fixtures-day:{ip}:{hour}`
 * rate-limit counter and reads the daily predict counter — 2 KV commands,
 * answering 200 or 402 alike. At 30s that was 121 requests/hour per open tab
 * against a default cap of 120/hour, so one workspace consumed an IP's whole
 * fixture-listing budget.
 *
 * Asserted against the SOURCE rather than observed timing: UserDashboard has
 * no render test and mounting it needs the whole auth/predictions/history
 * stack plus Supabase, so a timing test would be asserting the mocks. This
 * follows the guard-test pattern already used in
 * components/support/supportEntry.test.tsx.
 */

const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src", rel), "utf8");

const dashboard = () => src("pages/UserDashboard.tsx");

describe("tierStatus polling cadence", () => {
  it("still polls tier status from the workspace", () => {
    // The mechanism must survive: losing it silently would freeze the quota
    // readout at whatever the session refresh last saw.
    expect(dashboard()).toMatch(/setInterval\(\s*\(\)\s*=>\s*\{[\s\S]{0,80}refreshTierStatus\(\);?[\s\S]{0,40}\}/);
  });

  it("polls every five minutes, not every thirty seconds", () => {
    const code = dashboard();
    expect(code, "the poll interval must be a named constant").toMatch(
      /const TIER_STATUS_POLL_MS = 5 \* 60_000;/
    );
    expect(code, "the interval must use the constant, not a literal").toMatch(/\}, TIER_STATUS_POLL_MS\);/);
    // The regression this exists to catch, in either spelling.
    expect(code, "30s polling is back").not.toMatch(/setInterval\([\s\S]{0,120}?\}, 30_?000\)/);
  });

  it("keeps exactly one polling timer", () => {
    // Two timers would double the KV cost invisibly.
    const code = dashboard();
    const polls = code.match(/refreshTierStatus\(\)/g) || [];
    expect(polls.length, `expected a single poll call site, found ${polls.length}`).toBe(1);
    expect((code.match(/TIER_STATUS_POLL_MS/g) || []).length, "constant declared once, used once").toBe(2);
  });

  it("clears the timer when the session goes away", () => {
    // Without this a sign-out would keep spending the IP's rate-limit budget.
    const code = dashboard();
    expect(code).toMatch(/return \(\) => clearInterval\(tm\);/);
    expect(code).toMatch(/if \(!session\?\.access_token\) return;/);
  });

  it("leaves the session-driven refresh in useAuth untouched", () => {
    // The initial read is a separate trigger and must keep firing on its own,
    // otherwise a fresh login would show no quota until the first poll.
    const auth = src("hooks/useAuth.ts");
    expect(auth).toMatch(/void refreshTierStatus\(\);/);
    expect(auth, "the session effect must not gain an interval").not.toMatch(/setInterval/);
  });
});
