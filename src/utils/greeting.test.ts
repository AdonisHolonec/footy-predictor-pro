import { beforeEach, describe, expect, it } from "vitest";
import { getGreeting, getGreetingType } from "./greeting";

function atHour(hour: number, minute = 0): Date {
  const d = new Date(2026, 0, 15, hour, minute, 0);
  return d;
}

describe("getGreetingType", () => {
  it("returns morning for the 05:00 boundary", () => {
    expect(getGreetingType(atHour(5, 0))).toBe("morning");
  });

  it("returns morning for the 11:59 boundary", () => {
    expect(getGreetingType(atHour(11, 59))).toBe("morning");
  });

  it("returns day for the 12:00 boundary", () => {
    expect(getGreetingType(atHour(12, 0))).toBe("day");
  });

  it("returns day for the 17:59 boundary", () => {
    expect(getGreetingType(atHour(17, 59))).toBe("day");
  });

  it("returns evening for the 18:00 boundary", () => {
    expect(getGreetingType(atHour(18, 0))).toBe("evening");
  });

  it("returns evening for the 22:59 boundary", () => {
    expect(getGreetingType(atHour(22, 59))).toBe("evening");
  });

  it("returns night for the 23:00 boundary", () => {
    expect(getGreetingType(atHour(23, 0))).toBe("night");
  });

  it("returns night for the 04:59 boundary", () => {
    expect(getGreetingType(atHour(4, 59))).toBe("night");
  });
});

describe("getGreeting", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns the Romanian morning greeting", () => {
    const result = getGreeting({ locale: "ro", hasLiveMatches: false, date: atHour(8) });
    expect(result.type).toBe("morning");
    expect(result.text).toBe("Bună dimineața 👋");
  });

  it("returns the English morning greeting", () => {
    const result = getGreeting({ locale: "en", hasLiveMatches: false, date: atHour(8) });
    expect(result.type).toBe("morning");
    expect(result.text).toBe("Good Morning 👋");
  });

  it("returns the Romanian day greeting", () => {
    const result = getGreeting({ locale: "ro", hasLiveMatches: false, date: atHour(14) });
    expect(result.type).toBe("day");
    expect(result.text).toBe("Bună ziua 👋");
  });

  it("returns the Romanian evening greeting", () => {
    const result = getGreeting({ locale: "ro", hasLiveMatches: false, date: atHour(20) });
    expect(result.type).toBe("evening");
    expect(result.text).toBe("Bună seara 👋");
  });

  it("returns a night-owl idle message with no live-match reference when there are no live matches", () => {
    const result = getGreeting({ locale: "ro", hasLiveMatches: false, liveCount: 0, date: atHour(1) });
    expect(result.type).toBe("night");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).not.toMatch(/LIVE/);
  });

  it("returns a night-owl live message referencing the live count when live matches exist", () => {
    const result = getGreeting({ locale: "ro", hasLiveMatches: true, liveCount: 7, date: atHour(1) });
    expect(result.type).toBe("night");
    expect(result.text).toContain("7");
  });

  it("never repeats the same night-owl message on consecutive calls", () => {
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const result = getGreeting({ locale: "ro", hasLiveMatches: false, date: atHour(2) });
      seen.push(result.text);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).not.toBe(seen[i - 1]);
    }
  });

  it("shuffle-bag: shows every idle night-owl message once before any repeats", async () => {
    const { NIGHT_OWL_MESSAGES } = await import("../i18n/greetingMessages");
    const poolSize = NIGHT_OWL_MESSAGES.ro.idle.length;
    const firstCycle = new Set<string>();
    for (let i = 0; i < poolSize; i++) {
      const result = getGreeting({ locale: "ro", hasLiveMatches: false, date: atHour(2) });
      firstCycle.add(result.text);
    }
    expect(firstCycle.size).toBe(poolSize);
  });

  it("has matching English/Romanian night-owl pool sizes", async () => {
    const { NIGHT_OWL_MESSAGES } = await import("../i18n/greetingMessages");
    expect(NIGHT_OWL_MESSAGES.ro.live.length).toBe(NIGHT_OWL_MESSAGES.en.live.length);
    expect(NIGHT_OWL_MESSAGES.ro.idle.length).toBe(NIGHT_OWL_MESSAGES.en.idle.length);
    expect(NIGHT_OWL_MESSAGES.ro.live.length + NIGHT_OWL_MESSAGES.ro.idle.length).toBeGreaterThanOrEqual(20);
  });

  it("has matching English/Romanian live-context pool sizes", async () => {
    const { LIVE_CONTEXT_MESSAGES } = await import("../i18n/greetingMessages");
    expect(LIVE_CONTEXT_MESSAGES.ro.manyLive.length).toBe(LIVE_CONTEXT_MESSAGES.en.manyLive.length);
    expect(LIVE_CONTEXT_MESSAGES.ro.championsLeague.length).toBe(LIVE_CONTEXT_MESSAGES.en.championsLeague.length);
    expect(LIVE_CONTEXT_MESSAGES.ro.europaLeague.length).toBe(LIVE_CONTEXT_MESSAGES.en.europaLeague.length);
    expect(LIVE_CONTEXT_MESSAGES.ro.weekend.length).toBe(LIVE_CONTEXT_MESSAGES.en.weekend.length);
  });

  it("prioritizes many-live-matches context over the night-owl greeting", () => {
    const result = getGreeting({ locale: "en", hasLiveMatches: true, liveCount: 12, date: atHour(1) });
    expect(result.type).toBe("live");
    expect(result.text).toContain("12");
  });

  it("prioritizes a live Champions League match over the night-owl greeting", () => {
    const result = getGreeting({
      locale: "en",
      hasLiveMatches: true,
      liveCount: 2,
      hasLiveChampionsLeague: true,
      date: atHour(1)
    });
    expect(result.type).toBe("live");
    expect(result.text).toMatch(/Champions League/i);
  });

  it("prioritizes a live Europa League match over the base evening greeting", () => {
    const result = getGreeting({
      locale: "en",
      hasLiveMatches: true,
      liveCount: 2,
      hasLiveEuropaLeague: true,
      date: atHour(20)
    });
    expect(result.type).toBe("live");
    expect(result.text).toMatch(/Europa League/i);
  });

  it("shows a weekend flavor greeting on a Saturday afternoon with no other context", () => {
    const saturday = new Date(2026, 0, 17, 14, 0, 0); // 2026-01-17 is a Saturday
    expect(saturday.getDay()).toBe(6);
    const result = getGreeting({ locale: "en", hasLiveMatches: false, date: saturday });
    expect(result.type).toBe("live");
  });

  it("keeps the dedicated morning greeting on a weekend morning (weekend context does not override it)", () => {
    const saturdayMorning = new Date(2026, 0, 17, 8, 0, 0);
    const result = getGreeting({ locale: "en", hasLiveMatches: false, date: saturdayMorning });
    expect(result.type).toBe("morning");
    expect(result.text).toBe("Good Morning 👋");
  });
});
