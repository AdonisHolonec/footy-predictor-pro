import { describe, expect, test } from "vitest";

import type { User } from "../../types";
import { shouldShowOnboarding } from "./helpers";

/**
 * Who gets asked to onboard.
 *
 * L1 establishes the session before enriching it, so `user` now legitimately
 * exists with no profile for the length of a profile fetch — measured at ~440ms
 * in production. The old gate read `Boolean(profile?.onboarding_completed)`,
 * collapsing "not onboarded" and "profile hasn't loaded" into the same `false`,
 * and showed the onboarding carousel to a long-onboarded user until the profile
 * landed and it vanished again.
 *
 * The rule: a question we cannot answer yet must not be answered with a modal.
 */

/** Mirrors mapSupabaseUser's tri-state for the field under test. */
function userFrom(profile: { onboarding_completed?: boolean } | null): User {
  return {
    id: "u1",
    email: "user@example.com",
    role: "user",
    favoriteLeagues: [],
    isBlocked: false,
    onboardingCompleted: profile ? Boolean(profile.onboarding_completed) : undefined,
    tier: "free",
    subscription_expires_at: null,
    premium_trial_activated_at: null,
    ultra_trial_activated_at: null,
    predict_count_today: 0,
    notificationPrefs: { safe: true, value: true, email: false },
    emailNotificationsConsentedAt: null
  } as User;
}

describe("shouldShowOnboarding", () => {
  test("a session whose profile has not loaded onboards nobody", () => {
    // The regression window: user exists, profile still in flight.
    expect(shouldShowOnboarding(userFrom(null))).toBe(false);
  });

  test("a loaded profile that has not onboarded opens the carousel", () => {
    expect(shouldShowOnboarding(userFrom({ onboarding_completed: false }))).toBe(true);
  });

  test("a loaded profile that has onboarded does not", () => {
    expect(shouldShowOnboarding(userFrom({ onboarding_completed: true }))).toBe(false);
  });

  test("a pre-migration row without the column counts as not onboarded", () => {
    // That IS a loaded profile — distinct from having no profile at all.
    expect(shouldShowOnboarding(userFrom({}))).toBe(true);
  });

  test("degraded auth, where the profile is unavailable, onboards nobody", () => {
    expect(shouldShowOnboarding(userFrom(null))).toBe(false);
  });

  test("a signed-out user is never onboarded", () => {
    expect(shouldShowOnboarding(null)).toBe(false);
    expect(shouldShowOnboarding(undefined)).toBe(false);
  });

  test("the carousel stays shut across the whole profile transition", () => {
    // The exact production sequence for an existing user: session, then profile.
    const duringFetch = shouldShowOnboarding(userFrom(null));
    const afterFetch = shouldShowOnboarding(userFrom({ onboarding_completed: true }));
    expect([duringFetch, afterFetch]).toEqual([false, false]);
  });

  test("a genuinely new user is still onboarded once the profile lands", () => {
    // The audience the feature exists for must not be locked out by the fix.
    expect(shouldShowOnboarding(userFrom(null))).toBe(false);
    expect(shouldShowOnboarding(userFrom({ onboarding_completed: false }))).toBe(true);
  });

  test("undefined and false remain genuinely distinguishable", () => {
    // The whole fix rests on this distinction surviving the mapping.
    expect(userFrom(null).onboardingCompleted).toBeUndefined();
    expect(userFrom({ onboarding_completed: false }).onboardingCompleted).toBe(false);
    expect(userFrom({ onboarding_completed: true }).onboardingCompleted).toBe(true);
  });
});
