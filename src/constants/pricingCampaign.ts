/**
 * Launch / promo pricing campaign.
 * Stripe checkout amounts stay in Stripe; this drives UI copy + badges only.
 * Set campaignEur / listEur when you want strike-through amounts on cards.
 */
export const PRICING_CAMPAIGN = {
  active: true,
  discountPercent: 50,
  /** Optional ISO date for countdown copy; omit to keep “limited time” only. */
  endsAt: null as string | null,
  plans: {
    premium: {
      /** What users pay now (EUR / month). */
      campaignEur: 9.99,
      /** Full / standard price before discount. */
      listEur: 19.99
    },
    ultra: {
      campaignEur: 19.99,
      listEur: 39.99
    }
  }
} as const;

export function formatEur(amount: number): string {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function listPriceFromCampaign(campaignEur: number, discountPercent = PRICING_CAMPAIGN.discountPercent): number {
  const pct = Math.max(1, Math.min(99, discountPercent));
  return Math.round((campaignEur / (1 - pct / 100)) * 100) / 100;
}
