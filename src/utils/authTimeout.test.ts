import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  AUTH_REQUEST_TIMEOUT_MS,
  AUTH_TIMEOUT_MESSAGE_KEY,
  AuthTimeoutError,
  SESSION_RESTORE_TIMEOUT_MS,
  SessionRestoreTimeoutError,
  createTimeoutFetch,
  isAuthTimeoutError,
  isSessionRestoreTimeoutError,
  withDeadline
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

/* -- the orchestration deadline -------------------------------------------- */

describe("withDeadline", () => {
  test("a promise that never settles is forced to settle", async () => {
    const never = new Promise<string>(() => {});
    const bounded = withDeadline(never, 15_000, () => new SessionRestoreTimeoutError(15_000));
    const assertion = expect(bounded).rejects.toBeInstanceOf(SessionRestoreTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  test("a fast result passes through untouched", async () => {
    const bounded = withDeadline(Promise.resolve("session"), 15_000, () => new Error("unused"));
    await expect(bounded).resolves.toBe("session");
  });

  test("the work's own rejection is preserved, not replaced by the deadline", async () => {
    const boom = new Error("refresh rejected");
    const bounded = withDeadline(Promise.reject(boom), 15_000, () => new Error("deadline"));
    await expect(bounded).rejects.toBe(boom);
  });

  test("no timer is left pending after success", async () => {
    await withDeadline(Promise.resolve(1), 15_000, () => new Error("x"));
    expect(vi.getTimerCount()).toBe(0);
  });

  test("no timer is left pending after a timeout", async () => {
    const bounded = withDeadline(new Promise<never>(() => {}), 5_000, () => new Error("x")).catch(() => "done");
    await vi.advanceTimersByTimeAsync(5_000);
    await bounded;
    expect(vi.getTimerCount()).toBe(0);
  });

  test("repeated initialisation does not accumulate competing timers", async () => {
    const runs = [1, 2, 3, 4, 5].map((n) => withDeadline(Promise.resolve(n), 15_000, () => new Error("x")));
    await Promise.all(runs);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("the deadline abandons the losing promise rather than retrying it", async () => {
    const work = vi.fn(() => new Promise<never>(() => {}));
    const bounded = withDeadline(work(), 5_000, () => new Error("x")).catch(() => "done");
    await vi.advanceTimersByTimeAsync(20_000);
    await bounded;
    // One attempt, ever. A deadline must not multiply auth traffic.
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe("session-restore deadline sizing", () => {
  test("it outlives a single transport deadline but not auth-js's retry budget", () => {
    // A slow-but-successful request must not be cut short; the ~30s retry
    // sequence that produced the observed hang must be.
    expect(SESSION_RESTORE_TIMEOUT_MS).toBeGreaterThan(AUTH_REQUEST_TIMEOUT_MS);
    expect(SESSION_RESTORE_TIMEOUT_MS).toBeLessThan(30_000);
  });

  test("the two timeout kinds are distinguishable", () => {
    const restore = new SessionRestoreTimeoutError(15_000);
    const transport = new AuthTimeoutError(10_000);
    expect(isSessionRestoreTimeoutError(restore)).toBe(true);
    expect(isSessionRestoreTimeoutError(transport)).toBe(false);
    expect(isAuthTimeoutError(restore)).toBe(false);
    expect(isSessionRestoreTimeoutError(new Error("nope"))).toBe(false);
  });
});
