import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR2b — the headline regression, through the REAL hook.
 *
 * entitlement.test.ts proves the rules. This proves the WIRING, which is where
 * the bug actually lived: refreshTierStatus wrote the server's EFFECTIVE tier
 * into `user.tier`, and the memos downstream read `user.tier` as the REQUESTED
 * tier. Every value in that chain was individually defensible; the composition
 * rendered FREE over ULTRA data. Only a test that drives the whole hook can
 * catch a re-introduction.
 */

const harness = vi.hoisted(() => ({
  onAuthStateChange: null as ((event: string, session: unknown) => void) | null,
  session: {
    access_token: "token-1",
    user: { id: "user-1", email: "premium@example.test", user_metadata: {}, app_metadata: {} }
  },
  profile: {
    user_id: "user-1",
    role: "user" as "user" | "admin",
    favorite_leagues: [],
    is_blocked: false,
    onboarding_completed: true,
    tier: "premium" as "free" | "premium" | "ultra",
    // Lapsed a fortnight ago. The user is NOT paying right now.
    subscription_expires_at: "2026-08-12T00:00:00.000Z",
    premium_trial_activated_at: null,
    ultra_trial_activated_at: null
  }
}));

vi.mock("../utils/supabaseClient", () => ({
  isSupabaseConfigured: true,
  readPersistedSession: () => null,
  supabase: {
    auth: {
      // Must return the session: the mount effect's getSession() resolves
      // AFTER the SIGNED_IN event, and a null here would blank the session the
      // listener had just established — which is not what the real client does.
      getSession: async () => ({ data: { session: harness.session }, error: null }),
      getUser: async () => ({ data: { user: harness.session.user }, error: null }),
      refreshSession: async () => ({ data: { session: harness.session }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        harness.onAuthStateChange = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      }
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: harness.profile, error: null }) })
      })
    })
  }
}));

const { AuthProvider, useAuth } = await import("./useAuth");

const SESSION = harness.session;

/** The server's answer for an expired Premium user carrying an active bonus. */
const TIER_STATUS = {
  tier: "ultra",
  requestedTier: "premium",
  subscriptionExpiresAt: "2026-08-12T00:00:00.000Z",
  hasActiveSubscription: false,
  bonusUntil: "2026-08-31T00:00:00.000Z",
  hasActiveBonus: true,
  premiumTrialRemainingMs: 0,
  ultraTrialRemainingMs: 0,
  predictCountToday: 3,
  predictLimit: null,
  quotaExempt: false
};

let tierStatusCalls = 0;

function Probe() {
  const auth = useAuth();
  return (
    <div data-testid="probe">
      {JSON.stringify({
        tier: auth.user?.tier ?? null,
        userTier: auth.userTier,
        resolved: auth.entitlementResolved,
        hasActiveSubscription: auth.hasActiveSubscription,
        isSubscriptionExpired: auth.isSubscriptionExpired,
        bonusUntil: auth.entitlement?.bonusUntil ?? null,
        hasActiveBonus: auth.entitlement?.hasActiveBonus ?? false,
        predictLimitToday: auth.predictLimitToday,
        predictCountToday: auth.predictCountToday
      })}
    </div>
  );
}

function read() {
  return JSON.parse(screen.getByTestId("probe").textContent || "{}");
}

async function signIn(tierStatus: unknown = TIER_STATUS) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("tierStatus=1")) {
        tierStatusCalls += 1;
        return { ok: true, status: 200, json: async () => ({ ok: true, tierStatus }) };
      }
      // syncBootstrapAdmin and anything else: a plain, harmless refusal.
      return { ok: false, status: 403, json: async () => ({ ok: false }) };
    })
  );
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await act(async () => {
    harness.onAuthStateChange?.("SIGNED_IN", SESSION);
  });
  await waitFor(() => expect(read().resolved).toBe(true));
}

beforeEach(() => {
  tierStatusCalls = 0;
  harness.onAuthStateChange = null;
  // `profiles.tier` is the REQUESTED tier — the default case is the lapsed
  // Premium user of §10. Tests that need another plan set it explicitly.
  harness.profile.role = "user";
  harness.profile.tier = "premium";
});

afterEach(() => {
  // No globals:true in vitest.config, so RTL's auto-cleanup is not installed —
  // without this every render stacks and getByTestId matches several probes.
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAuth entitlement wiring", () => {
  it("[10] expired Premium + active bonus: user.tier stays premium, userTier is ultra", async () => {
    await signIn();
    const state = read();

    // THE regression. Before PR2b: user.tier === "ultra" (the effective tier
    // written into the plan field) and userTier === "free" (re-derived from it
    // against a subscription that had already lapsed).
    expect(state.tier).toBe("premium");
    expect(state.userTier).toBe("ultra");

    // The bonus is not a purchase, and the lapsed plan is still lapsed.
    expect(state.hasActiveSubscription).toBe(false);
    expect(state.isSubscriptionExpired).toBe(true);
    expect(state.hasActiveBonus).toBe(true);
    expect(state.bonusUntil).toBe("2026-08-31T00:00:00.000Z");
  });

  it("[5] the UI tier matches what the server masked at — no Free badge over Ultra data", async () => {
    await signIn();
    expect(read().userTier).toBe(TIER_STATUS.tier);
  });

  it("[R] resolves entitlement with exactly one tierStatus request", async () => {
    await signIn();
    expect(tierStatusCalls).toBe(1);
  });

  it("[I] once the bonus expires the effective tier drops but the plan does not", async () => {
    await signIn({
      ...TIER_STATUS,
      tier: "free",
      bonusUntil: null,
      hasActiveBonus: false
    });
    const state = read();
    expect(state.tier).toBe("premium");
    expect(state.userTier).toBe("free");
    expect(state.isSubscriptionExpired).toBe(true);
  });

  it("[G] an Ultra subscriber with a bonus is simply ultra, and still subscribed", async () => {
    /*
      The profile moves with requestedTier, not with the effective tier. That is
      the invariant PR2b restores: `profiles.tier` and `tierStatus.requestedTier`
      are now two views of ONE fact, so whichever of the profile load and the
      tierStatus response lands second, `user.tier` ends up the same. Before
      PR2b they were two different facts sharing a field, and the winner of that
      race decided what the badge said.
    */
    harness.profile.tier = "ultra";
    await signIn({
      ...TIER_STATUS,
      requestedTier: "ultra",
      hasActiveSubscription: true,
      subscriptionExpiresAt: "2099-01-01T00:00:00.000Z"
    });
    const state = read();
    expect(state.tier).toBe("ultra");
    expect(state.userTier).toBe("ultra");
    expect(state.hasActiveSubscription).toBe(true);
    expect(state.isSubscriptionExpired).toBe(false);
  });

  it("[F] admin on a free plan: user.tier stays free, userTier is ultra", async () => {
    /*
      quotaExempt forces the server to ULTRA while requestedTier stays the
      admin's own plan. This is the pair the admin workspace consumes — and
      before the blocker fix, App.tsx and PredictionList read the "free" half
      of it into accessTier and rendered an ULTRA payload as FREE.
      accessTierSource.test.tsx pins the consuming end; this pins the source.
    */
    harness.profile.tier = "free";
    harness.profile.role = "admin";
    await signIn({
      ...TIER_STATUS,
      tier: "ultra",
      requestedTier: "free",
      hasActiveSubscription: false,
      subscriptionExpiresAt: null,
      bonusUntil: null,
      hasActiveBonus: false,
      quotaExempt: true,
      predictLimit: null
    });
    const state = read();
    expect(state.tier).toBe("free");
    expect(state.userTier).toBe("ultra");
    expect(state.hasActiveSubscription).toBe(false);
    // No expiry was ever set, so nothing may claim the plan lapsed.
    expect(state.isSubscriptionExpired).toBe(false);
    expect(state.hasActiveBonus).toBe(false);
  });

  it("carries the quota fields the dashboard renders", async () => {
    await signIn({ ...TIER_STATUS, predictCountToday: 3, predictLimit: 40 });
    const state = read();
    expect(state.predictCountToday).toBe(3);
    expect(state.predictLimitToday).toBe(40);
  });

  it("[D] a refused tierStatus leaves entitlement unresolved instead of guessing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 402, json: async () => ({ ok: false }) })));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await act(async () => {
      harness.onAuthStateChange?.("SIGNED_IN", SESSION);
    });
    // The profile says "premium", and before PR2b that alone would have driven
    // the badge. Now nothing is claimed until the server says so.
    await waitFor(() => expect(read().tier).toBe("premium"));
    expect(read().resolved).toBe(false);
    expect(read().userTier).toBe("free");
    expect(read().isSubscriptionExpired).toBe(false);
  });
});
