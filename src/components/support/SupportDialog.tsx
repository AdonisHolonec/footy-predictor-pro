import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Dialog from "../../design-system/Dialog";
import Input from "../../design-system/Input";
import Select from "../../design-system/Select";
import Textarea from "../../design-system/Textarea";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_LIMITS,
  submitSupportTicket,
  type SupportCategory
} from "../../services/supportService";
import { useSupportSubmit } from "./useSupportSubmit";

/**
 * "I have a problem."
 *
 * Support is the slow lane: a category, a subject and a description, because
 * somebody will read it and reply, and a one-line complaint with no subject is
 * harder to answer than to send. Feedback is the fast lane and lives next door.
 *
 * `pageRoute` is attached because a ticket about "the page is blank" is
 * unanswerable without knowing which page. It is the current path only — no ids,
 * no query string, nothing the user did not already have in the address bar.
 */

type Props = {
  open: boolean;
  onClose: () => void;
  /** Fired once on success so the host can raise its own toast. */
  onSubmitted?: () => void;
};

const MIN_MESSAGE = 10;

export default function SupportDialog({ open, onClose, onSubmitted }: Props) {
  const { t } = useLocale();
  const [category, setCategory] = useState<SupportCategory | "">("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [contactRequested, setContactRequested] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const { status, errorKey, submit, reset } = useSupportSubmit();

  function close() {
    setCategory("");
    setSubject("");
    setMessage("");
    setContactRequested(true);
    setShowErrors(false);
    reset();
    onClose();
  }

  const categoryError = !category ? t("support.errorCategoryRequired") : "";
  const subjectError = !subject.trim() ? t("support.errorSubjectRequired") : "";
  const messageError =
    message.trim().length < MIN_MESSAGE ? t("support.errorMessageTooShort", { min: MIN_MESSAGE }) : "";
  const invalid = Boolean(categoryError || subjectError || messageError);

  async function onSend() {
    setShowErrors(true);
    if (invalid) return;
    await submit(async () => {
      await submitSupportTicket({
        category: category as SupportCategory,
        subject: subject.trim(),
        message: message.trim(),
        contactRequested,
        pageRoute: typeof window !== "undefined" ? window.location.pathname : undefined
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
      title={t("support.title")}
      description={done ? undefined : t("support.subtitle")}
      size="md"
      // A half-written ticket must not be lost to a stray click on the backdrop.
      closeOnBackdrop={done}
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
              {t("support.send")}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p role="status" className="text-[var(--fp-text)]">
          {t("support.successMessage")}
        </p>
      ) : (
        <div className="space-y-4">
          <Select
            label={t("support.category")}
            required
            placeholder={t("support.categoryPlaceholder")}
            value={category}
            onChange={(e) => setCategory(e.target.value as SupportCategory)}
            disabled={busy}
            error={showErrors ? categoryError : ""}
            options={SUPPORT_CATEGORIES.map((value) => ({ value, label: t(`support.categories.${value}`) }))}
          />

          <Input
            label={t("support.subject")}
            required
            maxLength={SUPPORT_LIMITS.subject}
            placeholder={t("support.subjectPlaceholder")}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy}
            error={showErrors ? subjectError : ""}
          />

          <Textarea
            label={t("support.message")}
            required
            rows={5}
            maxLength={SUPPORT_LIMITS.message}
            placeholder={t("support.messagePlaceholder")}
            description={t("support.messageHint")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={busy}
            error={showErrors ? messageError : ""}
          />

          <label className="flex items-center gap-2 text-xs text-[var(--fp-text-muted)]">
            <input
              type="checkbox"
              checked={contactRequested}
              onChange={(e) => setContactRequested(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 accent-[var(--fp-accent)]"
            />
            {t("support.contactRequested")}
          </label>

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
