import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import SupportDialog from "./SupportDialog";
import FeedbackDialog from "./FeedbackDialog";

/**
 * The one way into Support and Feedback, for every authenticated surface.
 *
 * This app has two authenticated UI trees — RootRouter sends admins to App.tsx
 * and everyone else to UserDashboard — and the first Support UI was mounted in
 * only one of them, so the people who own the product could not see the feature
 * they shipped. The fix is not a second copy: it is one component that both
 * trees mount.
 *
 * It therefore knows nothing about roles, dashboards or routes. It owns the two
 * dialogs and the state that opens them, and it renders in whichever shape the
 * host has room for. Anything role-shaped belongs to the caller.
 *
 *   card   — a titled panel, for a settings page with vertical space
 *   inline — two compact buttons, for a toolbar strip under a header
 */

type Props = {
  variant?: "card" | "inline";
  /**
   * Called once on a successful submission with the i18n key of the
   * confirmation, so the host can raise its own toast in its own style.
   */
  onSubmitted?: (messageKey: string) => void;
  className?: string;
};

export default function SupportEntry({ variant = "card", onSubmitted, className = "" }: Props) {
  const { t } = useLocale();
  const [supportOpen, setSupportOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Both dialogs are rendered here, once, whatever the variant. Mounting them
  // per-trigger would give a host with two entry points two live dialogs.
  const dialogs = (
    <>
      <SupportDialog
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        onSubmitted={() => onSubmitted?.("support.successMessage")}
      />
      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSubmitted={() => onSubmitted?.("feedback.successMessage")}
      />
    </>
  );

  if (variant === "inline") {
    return (
      <div className={`flex flex-wrap items-center justify-end gap-2 ${className}`}>
        <Button variant="ghost" size="sm" onClick={() => setSupportOpen(true)}>
          {t("support.openSupport")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setFeedbackOpen(true)}>
          {t("support.openFeedback")}
        </Button>
        {dialogs}
      </div>
    );
  }

  return (
    <Card className={className}>
      <h2 className="font-display text-[length:var(--fp-section)] font-semibold">{t("support.sectionTitle")}</h2>
      <p className="mt-1 text-sm text-[var(--fp-text-muted)]">{t("support.sectionHint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setSupportOpen(true)}>
          {t("support.openSupport")}
        </Button>
        <Button variant="ghost" onClick={() => setFeedbackOpen(true)}>
          {t("support.openFeedback")}
        </Button>
      </div>
      {dialogs}
    </Card>
  );
}
