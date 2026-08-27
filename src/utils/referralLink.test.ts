import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REFERRAL_STORAGE_KEY,
  REFERRAL_TTL_MS,
  buildReferralLink,
  capturePendingReferral,
  clearPendingReferral,
  normalizeReferralCode,
  readPendingReferral
} from "./referralLink";

/**
 * The persistence half of the referral journey.
 *
 * The behaviour worth protecting is not "it stores a string" — it is that an invite
 * survives the auth round trip, that a stale or corrupt entry never reaches the
 * server, and that storage being unavailable can never break the app.
 */

const CODE = "ABCD234567";
const NOW = Date.parse("2026-08-27T12:00:00.000Z");

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("code normalisation", () => {
  it("accepts a valid Crockford base32 code and upper-cases it", () => {
    // Chat apps and mail clients routinely lower-case links.
    expect(normalizeReferralCode("abcd234567")).toBe(CODE);
    expect(normalizeReferralCode("  ABCD234567  ")).toBe(CODE);
  });

  it("rejects anything that is not the code shape", () => {
    for (const bad of [null, undefined, "", "SHORT", "ABCD2345678", "ABCD-34567", "<script>"]) {
      expect(normalizeReferralCode(bad as string), String(bad)).toBeNull();
    }
    // I, L, O and U are excluded from the alphabet on purpose.
    expect(normalizeReferralCode("ABCDL34567")).toBeNull();
    expect(normalizeReferralCode("ABCDI34567")).toBeNull();
  });
});

describe("capture", () => {
  it("stores a code from ?ref= with the capture time", () => {
    expect(capturePendingReferral("?ref=abcd234567", NOW)).toBe(CODE);
    expect(readPendingReferral(NOW)).toEqual({ code: CODE, capturedAt: NOW });
  });

  it("ignores a URL with no ref, and writes nothing", () => {
    expect(capturePendingReferral("?mode=signup", NOW)).toBeNull();
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });

  it("ignores a malformed ref rather than storing it for the server to reject", () => {
    expect(capturePendingReferral("?ref=not-a-code", NOW)).toBeNull();
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });

  it("does NOT overwrite an invite that is already pending", () => {
    capturePendingReferral("?ref=ABCD234567", NOW);
    // A second link arrives later. The first still wins — a user can only ever use
    // one, and silently swapping which is pending would surprise them.
    expect(capturePendingReferral("?ref=ZYXW987654", NOW + 1000)).toBe(CODE);
    expect(readPendingReferral(NOW + 1000)?.code).toBe(CODE);
  });

  it("survives a reload — the whole point of using localStorage", () => {
    capturePendingReferral("?ref=ABCD234567", NOW);
    // A later boot with a clean URL, exactly as after an auth redirect.
    expect(capturePendingReferral("", NOW + 60_000)).toBe(CODE);
  });
});

describe("expiry", () => {
  it("keeps an invite for the whole 30-day window", () => {
    capturePendingReferral("?ref=ABCD234567", NOW);
    expect(readPendingReferral(NOW + REFERRAL_TTL_MS - 1)?.code).toBe(CODE);
  });

  it("drops and DELETES it at the boundary", () => {
    // Half-open, matching the server's window: the boundary instant is expired.
    capturePendingReferral("?ref=ABCD234567", NOW);
    expect(readPendingReferral(NOW + REFERRAL_TTL_MS)).toBeNull();
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });

  it("drops and deletes it well past the window", () => {
    capturePendingReferral("?ref=ABCD234567", NOW);
    expect(readPendingReferral(NOW + REFERRAL_TTL_MS + 86_400_000)).toBeNull();
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });
});

describe("corrupt storage", () => {
  it.each([
    ["not json at all", "{{{"],
    ["json but not an object", '"ABCD234567"'],
    ["missing capturedAt", JSON.stringify({ code: CODE })],
    ["non-numeric capturedAt", JSON.stringify({ code: CODE, capturedAt: "yesterday" })],
    ["invalid code", JSON.stringify({ code: "nope", capturedAt: NOW })],
    ["null", "null"]
  ])("discards %s and clears the key", (_label, raw) => {
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, raw);
    expect(readPendingReferral(NOW)).toBeNull();
    // Cleared, so it is not re-read and re-rejected on every render.
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });
});

describe("hostile storage", () => {
  it("never throws when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    expect(() => readPendingReferral(NOW)).not.toThrow();
    expect(readPendingReferral(NOW)).toBeNull();
  });

  it("never throws when setItem throws — boot must not break for a referral", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => capturePendingReferral("?ref=ABCD234567", NOW)).not.toThrow();
  });

  it("never throws when removeItem throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearPendingReferral()).not.toThrow();
  });
});

describe("clearing", () => {
  it("removes the pending invite", () => {
    capturePendingReferral("?ref=ABCD234567", NOW);
    clearPendingReferral();
    expect(readPendingReferral(NOW)).toBeNull();
  });
});

describe("link building", () => {
  it("uses the runtime origin, never a hard-coded host", () => {
    expect(buildReferralLink(CODE, "https://footy-predictor-pro.vercel.app")).toBe(
      "https://footy-predictor-pro.vercel.app/?ref=ABCD234567"
    );
    // A preview or localhost origin must produce a link back to ITSELF, or every
    // previewer would send their invitees to production.
    expect(buildReferralLink(CODE, "http://localhost:5173")).toBe("http://localhost:5173/?ref=ABCD234567");
  });

  it("produces a link that capture can read back", () => {
    const url = new URL(buildReferralLink(CODE, "https://example.test"));
    expect(capturePendingReferral(url.search, NOW)).toBe(CODE);
  });
});
