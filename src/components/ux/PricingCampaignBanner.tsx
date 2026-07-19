import { PRICING_CAMPAIGN } from "../../constants/pricingCampaign";
import { useLocale } from "../../context/LocaleContext";

type Props = {
  /** Compact one-liner for dialogs / upgrade prompts. */
  compact?: boolean;
  className?: string;
};

/** Highlights the limited-time −50% vs standard price campaign. */
export default function PricingCampaignBanner({ compact = false, className = "" }: Props) {
  const { t } = useLocale();
  if (!PRICING_CAMPAIGN.active) return null;

  const pct = PRICING_CAMPAIGN.discountPercent;

  if (compact) {
    return (
      <p
        className={`rounded-[var(--fp-radius-sm)] border border-[var(--fp-warning)]/35 bg-[var(--fp-warning)]/10 px-3 py-2 text-xs font-semibold leading-snug text-[var(--fp-text)] ${className}`}
      >
        <span className="mr-1.5 inline-flex items-center rounded-md bg-[var(--fp-warning)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-navy)]">
          −{pct}%
        </span>
        {t("pricing.compact", { pct })}
      </p>
    );
  }

  return (
    <div
      className={`rounded-[var(--fp-radius)] border border-[var(--fp-warning)]/40 bg-gradient-to-r from-[var(--fp-warning)]/15 via-[var(--fp-accent-muted)] to-[var(--fp-warning)]/10 px-3 py-3 sm:px-4 ${className}`}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md bg-[var(--fp-warning)] px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--fp-navy)]">
          {t("pricing.badge", { pct })}
        </span>
        <span className="inline-flex items-center rounded-md border border-[var(--fp-border)] bg-[var(--fp-bg-card)]/80 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--fp-accent)]">
          {t("pricing.limited")}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-[var(--fp-text)]">{t("pricing.headline", { pct })}</p>
      <p className="mt-1 text-xs font-medium leading-relaxed text-[var(--fp-text-muted)]">{t("pricing.body", { pct })}</p>
    </div>
  );
}

type PlanPriceProps = {
  tier: "premium" | "ultra";
  className?: string;
};

/** Strike-through list price + campaign price when amounts are configured. */
export function PlanCampaignPrice({ tier, className = "" }: PlanPriceProps) {
  const { t } = useLocale();
  if (!PRICING_CAMPAIGN.active) return null;

  const plan = PRICING_CAMPAIGN.plans[tier];
  const campaign = plan.campaignEur;
  const list =
    plan.listEur ??
    (campaign != null ? listPriceFromCampaignSafe(campaign, PRICING_CAMPAIGN.discountPercent) : null);
  const pct = PRICING_CAMPAIGN.discountPercent;

  if (campaign == null || list == null) {
    return (
      <div className={`mt-2 flex flex-wrap items-baseline gap-2 ${className}`}>
        <span className="inline-flex items-center rounded-md bg-[var(--fp-warning)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-navy)]">
          −{pct}%
        </span>
        <span className="text-sm font-semibold text-[var(--fp-text)]">{t("pricing.promoLabel")}</span>
        <span className="text-xs font-medium text-[var(--fp-text-muted)]">{t("pricing.vsStandard")}</span>
      </div>
    );
  }

  return (
    <div className={`mt-2 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-[var(--fp-text-muted)] line-through decoration-[var(--fp-danger)]/70">
          {formatLocalEur(list)}
        </span>
        <span className="font-display text-3xl font-bold tabular-nums text-[var(--fp-text)]">{formatLocalEur(campaign)}</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--fp-text-muted)]">{t("pricing.perMonth")}</span>
        <span className="inline-flex items-center rounded-md bg-[var(--fp-warning)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-navy)]">
          −{pct}%
        </span>
      </div>
      <p className="mt-1 text-[11px] font-medium text-[var(--fp-text-muted)]">{t("pricing.includesDiscount", { pct })}</p>
    </div>
  );
}

function listPriceFromCampaignSafe(campaignEur: number, discountPercent: number): number {
  const pct = Math.max(1, Math.min(99, discountPercent));
  return Math.round((campaignEur / (1 - pct / 100)) * 100) / 100;
}

function formatLocalEur(amount: number): string {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
}
