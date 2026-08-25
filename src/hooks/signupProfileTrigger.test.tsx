import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "./useAuth";

/**
 * The profile row belongs to the database, not to signup().
 *
 * `signup()` used to follow `auth.signUp` with a client-side
 * `profiles.upsert({user_id, role:'user', favorite_leagues:[], is_blocked:false})`
 * — the same values the `on_auth_user_created_profile` trigger already inserts.
 * With email confirmation on, signUp() returns no session, so that request went
 * out under the anon key, `auth.uid()` was NULL, and the INSERT policy
 * `with check (auth.uid() = user_id)` rejected it. Its result was never checked,
 * so every signup silently ate the refusal.
 *
 * These tests pin both halves: signup no longer writes to `profiles`, and the
 * trigger that does the work is still in the migrations.
 */

// `vi.mock` is hoisted above the file body, and this factory reads the spies
// eagerly — so they have to be hoisted with it rather than declared below.
const { fromSpy, signUpSpy, resendSpy } = vi.hoisted(() => ({
  fromSpy: vi.fn(),
  signUpSpy: vi.fn(),
  resendSpy: vi.fn()
}));

vi.mock("../utils/supabaseClient", () => ({
  isSupabaseConfigured: true,
  readPersistedSession: () => null,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signUp: signUpSpy,
      resend: resendSpy
    },
    from: fromSpy
  }
}));

let api: ReturnType<typeof useAuth> | null = null;

function Probe() {
  api = useAuth();
  return null;
}

const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

/**
 * A PostgREST stub that records which VERBS were used per relation.
 *
 * signup() legitimately READS the profile the trigger just created, so
 * "no traffic at all" would be the wrong assertion. What must never happen
 * again is a WRITE from this path.
 */
const writeVerbs: string[] = [];
function queryBuilder(relation: string) {
  const record = (verb: string) => () => {
    writeVerbs.push(`${relation}.${verb}`);
    return builder;
  };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    upsert: record("upsert"),
    insert: record("insert"),
    update: record("update"),
    delete: record("delete")
  };
  return builder;
}

beforeEach(() => {
  api = null;
  writeVerbs.length = 0;
  fromSpy.mockReset();
  fromSpy.mockImplementation((relation: string) => queryBuilder(relation));
  signUpSpy.mockReset();
  // Confirmation on ⇒ a user but NO session. This is the production shape.
  signUpSpy.mockResolvedValue({
    data: { user: { id: "u-new", email: "new@example.com", user_metadata: {} }, session: null },
    error: null
  });
  resendSpy.mockReset();
  resendSpy.mockResolvedValue({ data: {}, error: null });
});

afterEach(cleanup);

describe("[14] signup after removing the redundant profiles upsert", () => {
  it("completes without writing to profiles", async () => {
    mount();
    await waitFor(() => expect(api).not.toBeNull());
    const result = await api!.signup("new@example.com", "hunter22");

    expect(signUpSpy).toHaveBeenCalledTimes(1);
    /*
      The whole point. Reading the profile is fine — the trigger created it, and
      signup() hydrates the UI from it. Writing to it is what was removed, and
      what must not come back.
    */
    expect(writeVerbs).toEqual([]);
    expect(fromSpy.mock.calls.map((call) => call[0])).not.toContain("profiles.upsert");
    expect(result.user?.id).toBe("u-new");
  });

  it("still sends the redirect the confirmation link depends on", async () => {
    mount();
    await waitFor(() => expect(api).not.toBeNull());
    await api!.signup("new@example.com", "hunter22");

    const options = signUpSpy.mock.calls[0][0].options;
    expect(options.emailRedirectTo).toBe(window.location.origin);
  });

  it("does not pretend an unconfirmed signup produced a session", async () => {
    mount();
    await waitFor(() => expect(api).not.toBeNull());
    const result = await api!.signup("new@example.com", "hunter22");
    expect(result.session).toBeNull();
  });
});

describe("resendConfirmationEmail", () => {
  it("asks GoTrue for a signup email at the same redirect signup uses", async () => {
    mount();
    await waitFor(() => expect(api).not.toBeNull());
    await api!.resendConfirmationEmail("new@example.com");

    expect(resendSpy).toHaveBeenCalledWith({
      type: "signup",
      email: "new@example.com",
      options: { emailRedirectTo: window.location.origin }
    });
    // No second client, no table write, no new endpoint.
    expect(writeVerbs).toEqual([]);
  });

  it("throws when Supabase refuses, so the caller can show the failure", async () => {
    resendSpy.mockResolvedValue({ data: {}, error: new Error("over_email_send_rate_limit") });
    mount();
    await waitFor(() => expect(api).not.toBeNull());
    await expect(api!.resendConfirmationEmail("new@example.com")).rejects.toThrow(
      "over_email_send_rate_limit"
    );
  });
});

describe("the trigger that actually creates the profile", () => {
  it("is still declared in migration 004", () => {
    const sql = readFileSync(
      join(__dirname, "..", "..", "supabase", "migrations", "004_profiles_auth.sql"),
      "utf8"
    );
    expect(sql).toMatch(/create trigger on_auth_user_created_profile/);
    expect(sql).toMatch(/after insert on auth\.users/);
    expect(sql).toMatch(/execute procedure public\.handle_new_user_profile\(\)/);
    // SECURITY DEFINER is what lets it insert while the caller is still anon.
    expect(sql).toMatch(
      /create or replace function public\.handle_new_user_profile\(\)[\s\S]*?security definer/
    );
    expect(sql).toMatch(/insert into public\.profiles \(user_id, role, favorite_leagues, is_blocked\)/);
  });
});
