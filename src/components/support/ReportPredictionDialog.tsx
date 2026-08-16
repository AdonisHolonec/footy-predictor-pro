import { useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Dialog from "../../design-system/Dialog";
import Select from "../../design-system/Select";
import Textarea from "../../design-system/Textarea";
import { SUPPORT_LIMITS, submitPredictionReport, type SupportContext } from "../../services/supportService";
import type { PredictionRow } from "../../types";
import { useSupportSubmit } from "./useSupportSubmit";

/**
 * "Something is wrong with this prediction."
 *
 * The user picks a reason and, optionally, says more. Everything identifying the
 * prediction is already on the card, so asking for it again would be asking the
 * user to transcribe what we are about to send anyway.
 *
 * The gathered context is shown back to them, read-only, before they send. A
 * report is a message to a human, and the user is entitled to see what leaves
 * their screen.
 */

/** Reasons, each one the headline the ticket body opens with. */
const REASONS = ["wrong_result", "wrong_odds", "missing_data", "wrong_recommendation", "other"] as const;
type Reason = (typeof REASONS)[number];

type Props = {
  open: boolean;
  onClose: () => void;
  /** The card the report was opened from. Null keeps the dialog closed. */
  row: PredictionRow | null;
  onSubmitted?: () => void;
};

/**
 * Build the server's context from a prediction row.
 *
 * Only keys the server's allow-list accepts, and only those actually present —
 * an undefined field is omitted rather than sent as null, so the admin inbox
 * shows what was known instead of a row of blanks.
 */
export function contextFromRow(row: PredictionRow): SupportContext {
  const context: SupportContext = {};
  // PredictionRow keys the fixture as `id`; the server's context field is
  // `fixtureId`, so the rename happens here rather than on either side.
  const fixtureId = Number(row.id);
  if (Number.isFinite(fixtureId)) context.fixtureId = fixtureId;
  const leagueId = Number(row.leagueId);
  if (Number.isFinite(leagueId)) context.leagueId = leagueId;

  const recommended = row.recommended;
  if (recommended?.pick) context.recommendation = String(recommended.pick).slice(0, 300);
  if (recommended?.family) context.family = String(recommended.family);
  if (recommended?.period) context.period = String(recommended.period);
  if (recommended?.scope) context.scope = String(recommended.scope);
  if (row.modelVersion) context.modelVersion = String(row.modelVersion);
  if (row.kickoff) context.kickoffAt = String(row.kickoff);
  return context;
}

export default function ReportPredictionDialog({ open, onClose, row, onSubmitted }: Props) {
  const { t } = useLocale();
  const [reason, setReason] = useState<Reason | "">("");
  const [details, setDetails] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const { status, errorKey, submit, reset } = useSupportSubmit();

  function close() {
    setReason("");
    setDetails("");
    setShowErrors(false);
    reset();
    onClose();
  }

  const reasonError = !reason ? t("predictionReport.errorReasonRequired") : "";

  async function onSend() {
    setShowErrors(true);
    if (!reason || !row) return;
    await submit(async () => {
      // The server requires a message; the chosen reason is the message when the
      // user adds nothing, so a two-click report is still a complete one.
      const headline = t(`predictionReport.reasons.${reason}`);
      const body = details.trim() ? `${headline}\n\n${details.trim()}` : headline;
      await submitPredictionReport({
        category: "prediction",
        message: body,
        context: contextFromRow(row)
      });
      onSubmitted?.();
    });
  }

  const busy = status === "submitting";
  const done = status === "success";
  const context = row ? contextFromRow(row) : {};

  return (
    <Dialog
      open={open && Boolean(row)}
      onClose={close}
      title={t("predictionReport.title")}
      description={done ? undefined : t("predictionReport.subtitle")}
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
              {t("predictionReport.send")}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p role="status" className="text-[var(--fp-text)]">
          {t("predictionReport.successMessage")}
        </p>
      ) : (
        <div className="space-y-4">
          {row ? (
            <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-2">
              <p className="font-display text-sm font-semibold text-[var(--fp-text)]">
                {row.teams?.home} <span className="text-[var(--fp-text-muted)]">{t("common.vs")}</span>{" "}
                {row.teams?.away}
              </p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-fp-accent/70">
                {row.league}
              </p>
              {context.recommendation ? (
                <p className="mt-1 text-[11px] text-[var(--fp-text-muted)]">
                  {t("predictionReport.contextPick")}: {context.recommendation}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-[var(--fp-text-faint)]">{t("predictionReport.contextNote")}</p>
            </div>
          ) : null}

          <Select
            label={t("predictionReport.reason")}
            required
            placeholder={t("predictionReport.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value as Reason)}
            disabled={busy}
            error={showErrors ? reasonError : ""}
            options={REASONS.map((value) => ({ value, label: t(`predictionReport.reasons.${value}`) }))}
          />

          <Textarea
            label={t("predictionReport.details")}
            rows={3}
            maxLength={SUPPORT_LIMITS.message}
            placeholder={t("predictionReport.detailsPlaceholder")}
            description={t("predictionReport.detailsHint")}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            disabled={busy}
          />

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
