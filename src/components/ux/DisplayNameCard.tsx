import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import Input from "../../design-system/Input";
import SectionHeader from "../../design-system/SectionHeader";
import {
  DISPLAY_NAME_MAX,
  fetchDisplayName,
  saveDisplayName,
  validateDisplayName,
  type DisplayNameError
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
 * The copy says so plainly rather than implying the field is required, because a
 * name shown to another person should be opted into, not collected by default.
 */
export default function DisplayNameCard({ userId }: { userId: string | null | undefined }) {
  const { t } = useLocale();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayNameError | null>(null);
  const [saved, setSaved] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!userId || loaded.current) return;
    loaded.current = true;
    void fetchDisplayName(userId).then((name) => setValue(name ?? ""));
  }, [userId]);

  const onSave = useCallback(async () => {
    if (!userId) return;
    const check = validateDisplayName(value);
    if (check.reason) {
      setError(check.reason);
      setSaved(false);
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await saveDisplayName(userId, check.value);
    setBusy(false);
    if (ok) {
      setSaved(true);
      setValue(check.value ?? "");
    } else {
      setError("generic");
    }
  }, [userId, value]);

  if (!userId) return null;

  const errorKey: Record<DisplayNameError, string> = {
    tooShort: "account.displayName.errorTooShort",
    tooLong: "account.displayName.errorTooLong",
    email: "account.displayName.errorEmail",
    generic: "account.displayName.errorGeneric"
  };

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
        error={error ? t(errorKey[error]) : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
          setSaved(false);
        }}
      />
      {/* Announced, not merely shown — the same contract the referral card uses. */}
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
