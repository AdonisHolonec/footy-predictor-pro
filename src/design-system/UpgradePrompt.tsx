import PricingCampaignBanner from "../components/ux/PricingCampaignBanner";
import { PRICING_CAMPAIGN } from "../constants/pricingCampaign";
import { useLocale } from "../context/LocaleContext";
import Button from "./Button";

export type UpgradeTier = "premium" | "ultra";

type Props = {
  open: boolean;
  feature: string;
  requiredTier: UpgradeTier;
  onClose: () => void;
  onGoUpgrade: () => void;
};

/** Shown when the user activates a plan-locked control. */
export default function UpgradePrompt({ open, feature, requiredTier, onClose, onGoUpgrade }: Props) {
  const { t } = useLocale();
  if (!open) return null;

  const planLabel = requiredTier === "ultra" ? "Ultra" : "Premium";

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--fp-navy)]/45 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-[2px] sm:items-center sm:px-4"
      role="dialog"
      aria-modal
      aria-labelledby="upgrade-prompt-title"
      onClick={onClose}
    >
      <div
        className="max-h-[min(90dvh,40rem)] w-full max-w-md overflow-y-auto rounded-t-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-5 shadow-[var(--fp-shadow-lg)] sm:rounded-[var(--fp-radius-lg)] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--fp-accent)]">{t("upgrade.required")}</p>
        <h2 id="upgrade-prompt-title" className="mt-2 font-display text-xl font-semibold text-[var(--fp-text)]">
          {t("upgrade.unlock", { feature })}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--fp-text-muted)]">{t("upgrade.body", { plan: planLabel })}</p>
        {PRICING_CAMPAIGN.active ? <PricingCampaignBanner compact className="mt-3" /> : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              onGoUpgrade();
              onClose();
            }}
          >
            {t("upgrade.go")}
          </Button>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
            {t("upgrade.notNow")}
          </Button>
        </div>
      </div>
    </div>
  );
}
