import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import SupportDialog from "./SupportDialog";
import FeedbackDialog from "./FeedbackDialog";
import MyTicketsPanel from "./MyTicketsPanel";

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
  variant?: "card" | "inline" | "cta";
  /**
   * Button text for the `cta` variant only.
   *
   * Passed in rather than read from a key here, because the sentence that makes
   * sense depends entirely on why the host is asking — "Report a problem" is the
   * wrong label above a message about subscriptions. The host owns its wording;
   * this component still owns the dialog.
   */
  label?: string;
  /**
   * Called once on a successful submission with the i18n key of the
   * confirmation, so the host can raise its own toast in its own style.
   */
  onSubmitted?: (messageKey: string) => void;
  className?: string;
};

export default function SupportEntry({ variant = "card", label, onSubmitted, className = "" }: Props) {
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

  /*
    One primary button that opens the SAME support dialog. It exists for hosts
    that have already said why they are asking — a temporary product gate, for
    instance — where a second "send feedback" button would only dilute the one
    action the user needs.
  */
  if (variant === "cta") {
    return (
      <div className={className}>
        <Button variant="primary" onClick={() => setSupportOpen(true)}>
          {label ?? t("support.openSupport")}
        </Button>
        {dialogs}
      </div>
    );
  }

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
      {/* Only in the card shape: the inline variant is a two-button toolbar strip with
          no room for a list, and the tree that mounts it is the admin one, which reads
          every ticket through the Admin Inbox already. */}
      <MyTicketsPanel className="mt-5 border-t border-[var(--fp-border)] pt-4" />
      {dialogs}
    </Card>
  );
}
