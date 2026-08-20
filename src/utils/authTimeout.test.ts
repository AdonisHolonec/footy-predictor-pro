import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  AUTH_REQUEST_TIMEOUT_MS,
  AUTH_TIMEOUT_MESSAGE_KEY,
  AuthTimeoutError,
  createTimeoutFetch,
  isAuthTimeoutError
} from "./authTimeout";

/**
 * The deadline itself.
 *
 * Supabase Auth was measured hanging past 8s against endpoints that normally
 * answer in 22-101ms, and auth-js has no timeout of its own — so a stalled
 * request produced a promise that never settled and a button that never reset.
 * What matters here is that a hang becomes a rejection, that the socket is
 * actually aborted rather than abandoned, and that a fast request pays nothing.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function hangingFetch() {
  return vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
  );
}

describe("bounded auth fetch", () => {
  test("a stalled request rejects instead of hanging forever", async () => {
    const bounded = createTimeoutFetch(1000, hangingFetch() as unknown as typeof fetch);

    const pending = bounded("https://example.test/auth/v1/token");
    const assertion = expect(pending).rejects.toBeInstanceOf(AuthTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  test("the in-flight request is aborted, not merely abandoned", async () => {
    let seen: AbortSignal | undefined;
    const hang = vi.fn((_i: unknown, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_r, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const bounded = createTimeoutFetch(500, hang as unknown as typeof fetch);

    const pending = bounded("https://example.test/auth/v1/user").catch(() => "rejected");
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(seen?.aborted).toBe(true);
  });

  test("a fast response is returned untouched and incurs no delay", async () => {
    const ok = new Response("{}", { status: 200 });
    const fast = vi.fn(async () => ok);
    const bounded = createTimeoutFetch(10_000, fast as unknown as typeof fetch);

    const result = await bounded("https://example.test/auth/v1/token", { method: "POST" });
    expect(result).toBe(ok);
    expect(fast).toHaveBeenCalledTimes(1);
    // No timer is left pending for the caller to wait on.
    expect(vi.getTimerCount()).toBe(0);
  });

  test("the deadline timer is cleared once a request settles", async () => {
    const bounded = createTimeoutFetch(10_000, (async () => new Response("{}")) as unknown as typeof fetch);
    await bounded("https://example.test/x");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an ordinary network failure stays a network failure", async () => {
    const boom = new TypeError("Failed to fetch");
    const bounded = createTimeoutFetch(1000, (async () => {
      throw boom;
    }) as unknown as typeof fetch);

    await expect(bounded("https://example.test/x")).rejects.toBe(boom);
  });

  test("a caller's own abort is honoured and is not reported as a timeout", async () => {
    const controller = new AbortController();
    const bounded = createTimeoutFetch(10_000, hangingFetch() as unknown as typeof fetch);

    const pending = bounded("https://example.test/x", { signal: controller.signal });
    controller.abort();
    await pending.then(
      () => expect.unreachable("should have rejected"),
      (error: unknown) => expect(isAuthTimeoutError(error)).toBe(false)
    );
  });

  test("the caller's init is forwarded, so headers and method survive", async () => {
    const seen: RequestInit[] = [];
    const bounded = createTimeoutFetch(1000, (async (_i: unknown, init?: RequestInit) => {
      seen.push(init as RequestInit);
      return new Response("{}");
    }) as unknown as typeof fetch);

    await bounded("https://example.test/x", { method: "POST", headers: { apikey: "k" } });
    expect(seen[0].method).toBe("POST");
    expect(new Headers(seen[0].headers).get("apikey")).toBe("k");
  });
});

describe("timeout identification", () => {
  test("recognises its own error and rejects unrelated ones", () => {
    expect(isAuthTimeoutError(new AuthTimeoutError(10_000))).toBe(true);
    expect(isAuthTimeoutError(new Error("Invalid login credentials"))).toBe(false);
    expect(isAuthTimeoutError(null)).toBe(false);
    expect(isAuthTimeoutError("timeout")).toBe(false);
  });

  test("survives auth-js rewrapping the transport error", () => {
    // auth-js `_handleRequest` catches any throw from an injected fetcher and
    // rethrows it as AuthRetryableFetchError, preserving the message.
    const rewrapped = new Error(new AuthTimeoutError(AUTH_REQUEST_TIMEOUT_MS).message);
    rewrapped.name = "AuthRetryableFetchError";
    expect(isAuthTimeoutError(rewrapped)).toBe(true);
  });

  test("the deadline is a single shared constant, sized above real auth latency", () => {
    // Measured normal latency was 22-101ms; observed hangs exceeded 8000ms.
    expect(AUTH_REQUEST_TIMEOUT_MS).toBeGreaterThan(8_000);
    expect(AUTH_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(new AuthTimeoutError(AUTH_REQUEST_TIMEOUT_MS).timeoutMs).toBe(AUTH_REQUEST_TIMEOUT_MS);
  });

  test("the user-facing message is an i18n key, never a raw dump", () => {
    expect(AUTH_TIMEOUT_MESSAGE_KEY.startsWith("auth.")).toBe(true);
    expect(AUTH_TIMEOUT_MESSAGE_KEY).not.toMatch(/supabase|fetch|abort/i);
  });
});
