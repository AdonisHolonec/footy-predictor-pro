import { useState, type FormEvent } from "react";

import { useLocale } from "../context/LocaleContext";
import Banner from "../design-system/Banner";
import Button from "../design-system/Button";
import Input from "../design-system/Input";
import { useAuth } from "../hooks/useAuth";
import {
  clearAuthHashFromUrl,
  hasAuthLinkError,
  isExpiredLinkError,
  readCapturedAuthHash
} from "../utils/supabaseAuthHash";

/**
 * What the user sees when a confirmation link does not work.
 *
 * Before this existed, GoTrue's `#error=…` fragment reached the app and nothing
 * read it: the redirect landed on the marketing page, no message appeared, and
 * the only signal the user got was a password login failing with "Email not
 * confirmed" — which reads as a wrong password, not an expired link. In
 * production that produced three link clicks and three failed logins in nine
 * minutes.
 *
 * Renders nothing at all unless the captured fragment carries an error, so both
 * hosts can mount it unconditionally and a successful confirmation is untouched.
 */
export default function AuthLinkNotice({ className = "" }: { className?: string }) {
  const { t } = useLocale();
  const { resendConfirmationEmail } = useAuth();

  /*
    Read once, at first render, from the load-time snapshot — not from
    `window.location.hash`. The hash is cleared below the moment the notice is
    shown, and auth-js clears it itself on the success path, so re-reading it
    would make this component's own cleanup erase its reason to exist.
  */
  const [parsed] = useState(readCapturedAuthHash);
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const visible = hasAuthLinkError(parsed) && !dismissed;

  /*
    F — drop the fragment once, as a render side effect rather than an effect
    hook, so `#error=access_denied&error_code=otp_expired…` is gone from the
    address bar by the time the user reads the message and cannot be copied into
    a support ticket or a shared link. `replaceState` keeps the SPA mounted.
  */
  if (visible && typeof window !== "undefined" && window.location.hash) {
    clearAuthHashFromUrl();
  }

  if (!visible) return null;

  const expired = isExpiredLinkError(parsed);

  /*
    An `access_denied` that is NOT `otp_expired` gets the generic message and no
    resend button: several unrelated GoTrue refusals share that class, and
    offering "resend" for them would send the user after an email that was never
    the problem. GoTrue's own `error_description` is English prose and is never
    shown as the message — it is kept out of the UI entirely.
  */
  const title = expired ? t("auth.linkExpiredTitle") : t("auth.linkInvalidTitle");
  const body = expired ? t("auth.linkExpiredBody") : t("auth.linkInvalidBody");

  async function onResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guard the double-click: Button also disables while `loading`, but the form
    // can still be submitted by keyboard before React re-renders.
    if (sending) return;
    const address = email.trim();
    if (!address) {
      setFailure(t("auth.emailRequiredMsg"));
      return;
    }
    setSending(true);
    setFailure(null);
    try {
      await resendConfirmationEmail(address);
      // Says only that Supabase accepted the request. Never "account confirmed".
      setSent(true);
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : t("auth.resendFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Banner tone={expired ? "warning" : "danger"} live="alert" className={className}>
      <div data-slot="auth-link-notice" className="w-full space-y-3">
        <div>
          <p className="text-sm font-semibold text-[var(--fp-text)]">{title}</p>
          <p className="mt-0.5 text-sm text-[var(--fp-text-muted)]">{body}</p>
        </div>

        {expired && !sent ? (
          <form onSubmit={onResend} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Input
              className="min-w-0 flex-1"
              type="email"
              autoComplete="email"
              label={t("auth.email")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={failure ?? undefined}
              data-slot="auth-link-notice-email"
            />
            <Button
              type="submit"
              variant="primary"
              loading={sending}
              data-slot="auth-link-notice-resend"
              className="shrink-0"
            >
              {t("auth.resendConfirmation")}
            </Button>
          </form>
        ) : null}

        {sent ? (
          <p data-slot="auth-link-notice-sent" role="status" className="text-sm font-semibold text-[var(--fp-success)]">
            {t("auth.resendSent")}
          </p>
        ) : null}

        <button
          type="button"
          data-slot="auth-link-notice-dismiss"
          onClick={() => setDismissed(true)}
          className="text-xs font-semibold text-[var(--fp-accent-text)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
        >
          {t("auth.backToLogin")}
        </button>
      </div>
    </Banner>
  );
}
