import { useCallback, useState } from "react";
import { SupportApiError } from "../../services/supportService";

/**
 * The submit lifecycle the three support surfaces share.
 *
 * They differ in what they collect and in nothing else: each one validates, posts
 * once, shows a confirmation, and has to say something specific when the server
 * refuses. Keeping the state machine and the failure mapping here means a fix to
 * either lands in all three, and each dialog stays readable as a form.
 */

export type SubmitStatus = "idle" | "submitting" | "success" | "error";

/**
 * HTTP status to i18n key.
 *
 * A rate limit is not "something went wrong": the user did nothing wrong, the
 * request was well-formed, and it will work again shortly. Saying so is the whole
 * point of not collapsing these into one message.
 *
 * 405 is a client bug — the UI called with the wrong method — so it gets its own
 * key rather than being dressed up as a server problem the user might retry.
 */
export function errorKeyForStatus(status: number): string {
  if (status === 400) return "support.errorInvalid";
  if (status === 401) return "support.errorAuth";
  if (status === 403) return "support.errorForbidden";
  if (status === 405) return "support.errorClient";
  if (status === 429) return "support.errorRateLimited";
  if (status >= 500) return "support.errorServer";
  return "support.errorGeneric";
}

export type SupportSubmitState = {
  status: SubmitStatus;
  /** i18n key for the failure, or null. Never a raw server string. */
  errorKey: string | null;
  submit: (run: () => Promise<void>) => Promise<void>;
  reset: () => void;
};

export function useSupportSubmit(): SupportSubmitState {
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const submit = useCallback(async (run: () => Promise<void>) => {
    setStatus("submitting");
    setErrorKey(null);
    try {
      await run();
      setStatus("success");
    } catch (error: unknown) {
      // The server's own message can name a column or a constraint. The user gets
      // translated copy keyed off the status instead; the detail is not theirs to
      // debug and is already in the server log.
      setErrorKey(error instanceof SupportApiError ? errorKeyForStatus(error.status) : "support.errorNetwork");
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setErrorKey(null);
  }, []);

  return { status, errorKey, submit, reset };
}
