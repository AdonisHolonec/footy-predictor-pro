import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Dialog from "../../design-system/Dialog";
import Select from "../../design-system/Select";
import Textarea from "../../design-system/Textarea";
import {
  FEEDBACK_CATEGORIES,
  SUPPORT_LIMITS,
  submitFeedback,
  type FeedbackCategory
} from "../../services/supportService";
import { useSupportSubmit } from "./useSupportSubmit";

/**
 * "Here is an idea."
 *
 * Deliberately shorter than Support: a category, a message, and an optional
 * rating. No subject, because nobody is going to reply to a thread — feedback is
 * written once and read by us. Every field beyond those three is one more reason
 * to close the dialog instead of sending.
 *
 * The rating is 1-5 to match the server's range, and skipping it is a valid
 * submission rather than a validation error.
 */

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
};

const MIN_MESSAGE = 5;
const RATINGS = [1, 2, 3, 4, 5];

export default function FeedbackDialog({ open, onClose, onSubmitted }: Props) {
  const { t } = useLocale();
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const { status, errorKey, submit, reset } = useSupportSubmit();

  function close() {
    setCategory("");
    setMessage("");
    setRating(null);
    setShowErrors(false);
    reset();
    onClose();
  }

  const categoryError = !category ? t("feedback.errorCategoryRequired") : "";
  const messageError =
    message.trim().length < MIN_MESSAGE ? t("feedback.errorMessageTooShort", { min: MIN_MESSAGE }) : "";
  const invalid = Boolean(categoryError || messageError);

  async function onSend() {
    setShowErrors(true);
    if (invalid) return;
    await submit(async () => {
      await submitFeedback({
        category: category as FeedbackCategory,
        message: message.trim(),
        ...(rating ? { rating } : {})
      });
      onSubmitted?.();
    });
  }

  const busy = status === "submitting";
  const done = status === "success";

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("feedback.title")}
      description={done ? undefined : t("feedback.subtitle")}
      size="sm"
      closeOnBackdrop={done}
      busy={busy}
      footer={
        done ? (
          <Button variant="primary" onClick={close}>
            {t("support.done")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              {t("support.cancel")}
            </Button>
            <Button variant="primary" onClick={onSend} loading={busy} disabled={busy}>
              {t("feedback.send")}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p role="status" className="text-[var(--fp-text)]">
          {t("feedback.successMessage")}
        </p>
      ) : (
        <div className="space-y-4">
          <Select
            label={t("feedback.category")}
            required
            placeholder={t("feedback.categoryPlaceholder")}
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            disabled={busy}
            error={showErrors ? categoryError : ""}
            options={FEEDBACK_CATEGORIES.map((value) => ({ value, label: t(`feedback.categories.${value}`) }))}
          />

          <Textarea
            label={t("feedback.message")}
            required
            rows={4}
            maxLength={SUPPORT_LIMITS.message}
            placeholder={t("feedback.messagePlaceholder")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={busy}
            error={showErrors ? messageError : ""}
          />

          {/* radiogroup rather than five checkboxes: exactly one value applies, and
              arrow-key navigation between the stars comes free with the role. */}
          <fieldset disabled={busy} className="border-0 p-0">
            <legend className="block text-xs font-semibold text-[var(--fp-text-muted)]">
              {t("feedback.rating")}
            </legend>
            <div role="radiogroup" aria-label={t("feedback.rating")} className="mt-1.5 flex flex-wrap gap-1.5">
              {RATINGS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={t("feedback.ratingValue", { value })}
                  onClick={() => setRating(rating === value ? null : value)}
                  className={`h-11 min-w-11 rounded-[var(--fp-radius-sm)] border text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] ${
                    rating !== null && value <= rating
                      ? "border-fp-warning/40 bg-fp-warning/15 text-[var(--fp-warning)]"
                      : "border-[var(--fp-border)] text-[var(--fp-text-muted)]"
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-[var(--fp-text-faint)]">{t("feedback.ratingHint")}</p>
          </fieldset>

          {errorKey ? (
            <p
              role="alert"
              className="rounded-[var(--fp-radius-sm)] border border-fp-danger/40 bg-fp-danger/10 px-3 py-2 text-xs font-medium text-[var(--fp-danger)]"
            >
              {t(errorKey)}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
