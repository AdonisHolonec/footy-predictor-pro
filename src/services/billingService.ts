import { fetchWithAuth } from "../utils/apiAuth";

export type BillingConfig = {
  configured: boolean;
  publishableKey: string | null;
  currency: string;
  prices: { premium: boolean; ultra: boolean };
};

export async function loadBillingConfig(): Promise<BillingConfig> {
  const res = await fetch("/api/billing?view=config");
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error || "Nu am putut încărca billing config.");
  return {
    configured: Boolean(json.configured),
    publishableKey: json.publishableKey ?? null,
    currency: String(json.currency || "eur"),
    prices: {
      premium: Boolean(json.prices?.premium),
      ultra: Boolean(json.prices?.ultra)
    }
  };
}

export async function startCheckout(tier: "premium" | "ultra"): Promise<string> {
  const res = await fetchWithAuth("/api/billing?view=checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier })
  });
  const json = await res.json();
  if (!json?.ok || !json?.url) {
    throw new Error(json?.error || "Nu am putut deschide Stripe Checkout.");
  }
  return String(json.url);
}

export async function openBillingPortal(): Promise<string> {
  const res = await fetchWithAuth("/api/billing?view=portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const json = await res.json();
  if (!json?.ok || !json?.url) {
    throw new Error(json?.error || "Nu am putut deschide portalul de abonament.");
  }
  return String(json.url);
}
