import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import Input from "../../design-system/Input";
import SectionHeader from "../../design-system/SectionHeader";
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  fetchDisplayName,
  saveDisplayName,
  validateDisplayNameShape,
  type DisplayNameReason
} from "../../services/displayNameService";

/**
 * Where a user chooses the one piece of identity another user can see.
 *
 * THIS IS THE ONLY WAY A NAME EVER REACHES AN INVITER. The product has no other
 * public identity — everything else it stores about a person is either private
 * (email) or meaningless to a stranger (a uuid). Leaving this empty is a real
 * choice and the default: an invitee who never fills it in stays anonymous, and
 * their inviter simply sees "someone joined".
 *
 * THE SERVER DECIDES. The check below runs for speed, not authority: it knows
 * about length and shape, never about which words are unacceptable. A rejection
 * that only the server can make comes back as a reason code and is rendered here
 * as a sentence — and the text the user typed is left untouched so they can edit
 * it rather than retype it.
 */
export default function DisplayNameCard({ userId }: { userId: string | null | undefined }) {
  const { t } = useLocale();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<DisplayNameReason | null>(null);
  const [saved, setSaved] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!userId || loaded.current) return;
    loaded.current = true;
    void fetchDisplayName(userId).then((name) => setValue(name ?? ""));
  }, [userId]);

  const onSave = useCallback(async () => {
    if (!userId) return;
    const shape = validateDisplayNameShape(value);
    if (shape.reason) {
      setReason(shape.reason);
      setSaved(false);
      return;
    }
    setBusy(true);
    setReason(null);
    const result = await saveDisplayName(shape.value);
    setBusy(false);
    if (result.ok) {
      setSaved(true);
      // The stored value, not the typed one — the server tidies whitespace.
      setValue(result.value ?? "");
    } else {
      // The typed text is deliberately preserved for editing.
      setReason(result.reason);
    }
  }, [userId, value]);

  if (!userId) return null;

  const MESSAGES: Record<DisplayNameReason, string> = {
    invalid_display_name_length: "account.displayName.validation.length",
    invalid_display_name: "account.displayName.validation.shape",
    inappropriate_display_name: "account.displayName.validation.inappropriate",
    generic: "account.displayName.validation.generic"
  };

  const used = value.trim().replace(/\s+/g, " ").length;

  return (
    <Card className="space-y-3" data-testid="account-display-name">
      <SectionHeader
        as="h2"
        size="section"
        title={t("account.displayName.title")}
        description={t("account.displayName.description")}
      />
      {/* Input owns the label, the error text and the aria wiring between them
          (aria-invalid + aria-describedby) — hand-rolling those here would have
          produced a second, worse version of a solved problem. */}
      <Input
        label={t("account.displayName.label")}
        value={value}
        maxLength={DISPLAY_NAME_MAX}
        placeholder={t("account.displayName.placeholder")}
        description={t("account.displayName.hint", { min: DISPLAY_NAME_MIN, max: DISPLAY_NAME_MAX })}
        error={reason ? t(MESSAGES[reason]) : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setReason(null);
          setSaved(false);
        }}
      />
      {/*
        The counter is plain text, NOT an aria-live region: it changes on every
        keystroke, and announcing each one would bury the field's actual label and
        error under a stream of numbers. The limit is already announced through the
        description above, which is what assistive technology reads on focus.
      */}
      <p className="text-xs tabular-nums opacity-70" data-testid="display-name-counter">
        {used} / {DISPLAY_NAME_MAX}
      </p>
      {/* Saving IS announced — it is a discrete outcome, not a running total. */}
      <p aria-live="polite" className="sr-only">
        {saved ? t("account.displayName.saved") : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void onSave()}>
          {t("account.displayName.save")}
        </Button>
        {value ? (
          <Button variant="secondary" disabled={busy} onClick={() => setValue("")}>
            {t("account.displayName.clear")}
          </Button>
        ) : null}
      </div>
      {saved ? <p className="text-sm opacity-70">{t("account.displayName.saved")}</p> : null}
    </Card>
  );
}
