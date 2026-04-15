// src/lib/http.ts
import { fetchJSON } from "./fetchJSON";

export async function httpGetJSON<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const headers = {
    Accept: "application/json",
    ...(init?.headers || {}),
  } as Record<string, string>;
  return fetchJSON<T>(url, { ...init, headers });
}

export async function httpPostJSON<T = unknown, B = unknown>(
  url: string,
  body?: B,
  init?: RequestInit
): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init?.headers || {}),
  } as Record<string, string>;
  return fetchJSON<T>(url, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
    headers,
  });
}
