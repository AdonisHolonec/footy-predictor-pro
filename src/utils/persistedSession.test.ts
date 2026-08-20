import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Reading the session straight from storage.
 *
 * This is the tie-breaker L2 leans on: a restore that timed out proves nothing
 * about whether a credential is valid, whereas auth-js removing the record from
 * storage means it has actually decided the session is dead. So this function
 * decides whether a timeout keeps someone signed in or routes them to /login —
 * and it must never throw, because it runs on the failure path.
 */

const URL_ENV = "https://rpabibdgbhcnmvxmhnsg.supabase.co";
const KEY = "sb-rpabibdgbhcnmvxmhnsg-auth-token";

async function loadReader() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", URL_ENV);
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  const mod = await import("./supabaseClient");
  return mod.readPersistedSession;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("readPersistedSession", () => {
  test("returns the stored session when one is present", async () => {
    const read = await loadReader();
    localStorage.setItem(KEY, JSON.stringify({ access_token: "t", user: { id: "u1" } }));
    expect(read()?.user?.id).toBe("u1");
  });

  test("reports no session when storage is empty", async () => {
    const read = await loadReader();
    expect(read()).toBeNull();
  });

  test("a record with no user is not a session anyone can be restored into", async () => {
    const read = await loadReader();
    localStorage.setItem(KEY, JSON.stringify({ access_token: "t" }));
    expect(read()).toBeNull();
  });

  test("a record with no access token is not a session either", async () => {
    const read = await loadReader();
    localStorage.setItem(KEY, JSON.stringify({ user: { id: "u1" } }));
    expect(read()).toBeNull();
  });

  test("unparseable storage reports no evidence instead of throwing", async () => {
    const read = await loadReader();
    localStorage.setItem(KEY, "{not json");
    expect(() => read()).not.toThrow();
    expect(read()).toBeNull();
  });

  test("a non-object payload reports no evidence instead of throwing", async () => {
    const read = await loadReader();
    localStorage.setItem(KEY, JSON.stringify("just-a-string"));
    expect(() => read()).not.toThrow();
    expect(read()).toBeNull();
  });

  test("storage that throws on read is survivable", async () => {
    const read = await loadReader();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    try {
      expect(() => read()).not.toThrow();
      expect(read()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
