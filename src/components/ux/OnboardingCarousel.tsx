import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";

type Props = {
  onComplete: () => void;
};

const STEPS = [
  { icon: "🎯", titleKey: "flow.onboardingStep1Title", bodyKey: "flow.onboardingStep1Body" },
  { icon: "💰", titleKey: "flow.onboardingStep2Title", bodyKey: "flow.onboardingStep2Body" },
  { icon: "📊", titleKey: "flow.onboardingStep3Title", bodyKey: "flow.onboardingStep3Body" }
] as const;

export default function OnboardingCarousel({ onComplete }: Props) {
  const { t } = useLocale();
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--fp-navy)]/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-sm flex-col items-center rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-6 text-center shadow-[var(--fp-shadow)] sm:p-8">
        <button
          type="button"
          onClick={onComplete}
          className="self-end text-xs font-semibold text-[var(--fp-text-muted)] hover:text-[var(--fp-text)]"
        >
          {t("flow.onboardingSkip")}
        </button>

        <span className="mt-2 text-5xl" aria-hidden>
          {current.icon}
        </span>
        <h1 className="mt-5 font-display text-xl font-semibold text-[var(--fp-text)]">{t(current.titleKey)}</h1>
        <p className="mt-2.5 text-sm text-[var(--fp-text-muted)]">{t(current.bodyKey)}</p>

        <div className="mt-6 flex items-center gap-1.5">
          {STEPS.map((s, idx) => (
            <span
              key={s.titleKey}
              className={`h-1.5 rounded-full transition-all ${
                idx === step ? "w-6 bg-[var(--fp-accent)]" : "w-1.5 bg-[var(--fp-border-strong)]"
              }`}
            />
          ))}
        </div>

        <Button
          className="mt-6 w-full"
          onClick={() => {
            if (isLast) onComplete();
            else setStep((s) => s + 1);
          }}
        >
          {isLast ? t("flow.onboardingGetStarted") : t("flow.onboardingNext")}
        </Button>
      </div>
    </div>
  );
}
