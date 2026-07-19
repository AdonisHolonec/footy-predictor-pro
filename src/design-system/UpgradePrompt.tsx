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
  if (!open) return null;

  const planLabel = requiredTier === "ultra" ? "Ultra" : "Premium";

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-[var(--fp-navy)]/45 px-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal
      aria-labelledby="upgrade-prompt-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-6 shadow-[var(--fp-shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--fp-accent)]">Upgrade required</p>
        <h2 id="upgrade-prompt-title" className="mt-2 font-display text-xl font-semibold text-[var(--fp-text)]">
          Unlock {feature}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--fp-text-muted)]">
          This feature is available on the <strong className="text-[var(--fp-text)]">{planLabel}</strong> plan (or
          higher). Upgrade to see full confidence, advanced signals, and markets.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              onGoUpgrade();
              onClose();
            }}
          >
            Go to upgrade
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
