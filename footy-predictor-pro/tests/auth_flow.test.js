/**
 * E2E smoke test pentru fluxul auth după fix-urile aplicate.
 *
 * Acoperă:
 *  1. Semnup nou → profile row creat automat de trigger DB (fix bug #1)
 *  2. Login cu user-ul creat → sesiune activă, role=user
 *  3. Admin promotion via service role → verificare rol actualizat
 *  4. Delete user test (cleanup)
 *  5. Forgot password (resetPasswordForEmail) — nu verifică inbox-ul, doar că API răspunde ok
 *
 * Rulare: node --env-file=.env.local tests/auth_flow.test.js
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  throw new Error(
    "Missing envs: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY"
  );
}

const anon = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const admin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Random email per run so tests are idempotent and don't collide
const rand = Math.random().toString(36).slice(2, 10);
const testEmail = `footytest+${rand}@mailinator.com`;
const testPassword = "Test1234!secure";
let createdUserId = null;

test("1. Signup → DB trigger creates profile row (no client upsert needed)", async () => {
  // IMPORTANT: Use admin.auth.admin.createUser to bypass email confirmation
  // (simulates the case where user has confirmed email via link).
  const { data, error } = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true
  });
  assert.equal(error, null, `createUser error: ${error?.message}`);
  assert.ok(data?.user?.id, "user id expected after signup");
  createdUserId = data.user.id;

  // Wait a beat for trigger to fire (should be synchronous but just in case).
  await new Promise((r) => setTimeout(r, 250));

  // Verify profile row was auto-created by handle_new_user_profile trigger (migration 004).
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("user_id, role, favorite_leagues, is_blocked")
    .eq("user_id", createdUserId)
    .maybeSingle();

  assert.equal(profileError, null, `profile read error: ${profileError?.message}`);
  assert.ok(profile, "profile row must exist (created by DB trigger)");
  assert.equal(profile.role, "user", "default role should be 'user'");
  assert.equal(profile.is_blocked, false, "default is_blocked should be false");
  assert.deepEqual(profile.favorite_leagues, [], "default favorite_leagues should be empty array");
});

test("2. Login with created user → session active, role=user", async () => {
  const { data, error } = await anon.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  });
  assert.equal(error, null, `login error: ${error?.message}`);
  assert.ok(data.session?.access_token, "access_token expected after login");
  assert.equal(data.user?.id, createdUserId, "user id should match");

  // Verify user can read own profile via RLS.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
  });
  const { data: selfProfile, error: selfError } = await userClient
    .from("profiles")
    .select("role, is_blocked")
    .eq("user_id", createdUserId)
    .maybeSingle();
  assert.equal(selfError, null, `self-read RLS error: ${selfError?.message}`);
  assert.equal(selfProfile?.role, "user");
});

test("3. Admin can promote user to admin via service role", async () => {
  const { error } = await admin
    .from("profiles")
    .update({ role: "admin" })
    .eq("user_id", createdUserId);
  assert.equal(error, null, `promotion error: ${error?.message}`);

  const { data: updated } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", createdUserId)
    .maybeSingle();
  assert.equal(updated?.role, "admin", "role should be updated to admin");
});

test("4. Forgot password API responds ok (or rate-limits)", async () => {
  // This does not verify the actual email arrival, only that Supabase accepts the request.
  const { error } = await anon.auth.resetPasswordForEmail(testEmail, {
    redirectTo: "http://localhost:5173"
  });
  // Supabase may silently succeed even for non-existent emails (security best practice),
  // and rate limits on reset emails (~1/min) are expected when tests run repeatedly.
  const msg = String(error?.message || "").toLowerCase();
  const isAcceptable = !error || msg.includes("rate limit");
  assert.ok(isAcceptable, `resetPasswordForEmail unexpected error: ${error?.message}`);
});

test("5. Cleanup: delete test user", async () => {
  const { error } = await admin.auth.admin.deleteUser(createdUserId);
  assert.equal(error, null, `delete error: ${error?.message}`);

  // Verify profile is cascade-deleted (ON DELETE CASCADE on user_id FK from migration 004).
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id")
    .eq("user_id", createdUserId)
    .maybeSingle();
  assert.equal(profile, null, "profile should be cascade-deleted");
});
