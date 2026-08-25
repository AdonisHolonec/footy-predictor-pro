import { useEffect, useState } from "react";

import { consumeSignupConfirmation } from "../utils/supabaseAuthHash";
import { useAuth } from "./useAuth";

/**
 * True once the user has arrived here by confirming their signup email.
 *
 * Two signals, and both are required, because neither is sufficient alone:
 *
 *  - the AUTH STATE says the confirmation actually worked. A session exists,
 *    which is the outcome worth announcing — not the mere shape of a URL. This
 *    is what makes the hook wait for auth-js to come back from `_getUser`
 *    rather than congratulating anyone whose address bar happens to look right.
 *
 *  - the CAPTURED FRAGMENT says where that session came from. auth-js reports a
 *    confirmed signup as a plain SIGNED_IN, exactly like a password login, so
 *    the auth state cannot tell the two apart on its own. The pre-auth-js
 *    snapshot is the only surviving record of the difference.
 *
 * An ordinary password login therefore never reaches `true`: it loads with no
 * fragment, so the snapshot's `type` is null and `consumeSignupConfirmation()`
 * stays false for the whole page load however many times it is asked.
 *
 * Exactly-once lives in the module-scoped latch, not in this state, so a second
 * mount or a second consumer cannot produce a second announcement. The effect is
 * keyed on WHETHER a session exists rather than on the session object, so a
 * token refresh — which replaces that object — does not re-run it; and if it
 * did, the latch is already spent.
 */
export function useSignupConfirmed(): boolean {
  const { session } = useAuth();
  const hasSession = Boolean(session?.access_token);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!hasSession) return;
    if (consumeSignupConfirmation()) setConfirmed(true);
  }, [hasSession]);

  return confirmed;
}

export default useSignupConfirmed;
