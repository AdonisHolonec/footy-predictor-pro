import fs from "node:fs";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/**
 * Keep failure diagnostics; drop the secrets inside them.
 *
 * On failure Playwright writes an `error-context` attachment: an ARIA snapshot
 * of the page. That snapshot serialises input VALUES, and `<input
 * type="password">` is not special-cased — so a failure anywhere between
 * filling the login form and leaving it persists the account password in
 * plaintext. The HTML reporter then copies the attachment into
 * `playwright-report/`, which CI uploads as an artifact. On a public repository
 * that artifact is world-readable for its whole retention window; that is
 * exactly what happened on run 33391408361 (2026-08-31), where both auth
 * setups failed against an unresponsive Supabase and captured the E2E
 * password.
 *
 * The screenshot is NOT a leak — a password input paints as dots, so only
 * pixels are stored. The text snapshot is the whole exposure.
 *
 * Redacting the attachment rather than disabling it keeps every other part of
 * the snapshot — the locator, the URL, the DOM, the visible text — which is
 * what makes these failures diagnosable at all.
 */

/** The shape we need from an environment: names to values. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** Replacement marker. Deliberately shows that something WAS there. */
export const REDACTED = "[REDACTED]";

/**
 * Env vars whose VALUES must never survive into an artifact. Read at call time
 * so a rotated secret is picked up without a restart, and never logged.
 */
export const SECRET_ENV_VARS = [
  "E2E_PASSWORD",
  "E2E_ADMIN_PASSWORD",
  "E2E_LOGOUT_PASSWORD"
] as const;

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Structural rules, applied in addition to literal secret values so that a
 * credential we do NOT hold — a typo, a sentinel, a future field — is still
 * caught. Each keeps its key/label and redacts only the value.
 */
const STRUCTURAL_RULES: ReadonlyArray<{ re: RegExp; replace: string }> = [
  // ARIA snapshot line for any password-ish textbox, in any language:
  //   textbox "Parolă": hunter2   ->   textbox "Parolă": [REDACTED]
  { re: /(textbox\s+"[^"]*(?:parol|password|senha|contrase|passwort|mot de passe)[^"]*"\s*:)[^\n]*/gi, replace: `$1 ${REDACTED}` },
  // JSON/JS object fields carrying credentials or tokens.
  { re: /("(?:password|new_password|old_password|access_token|refresh_token|id_token|api_?key|apikey|secret)"\s*:\s*)"[^"]*"/gi, replace: `$1"${REDACTED}"` },
  // Authorization headers.
  { re: /((?:authorization|proxy-authorization)"?\s*[:=]\s*"?)(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, replace: `$1${REDACTED}` },
  // Bare JWTs (Supabase access/refresh tokens travel as these).
  { re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: REDACTED }
];

/**
 * Redact secret material from attachment text.
 *
 * Literal env values go first: they are exact, so they are caught even where
 * no structural rule matches (a URL, a log line, a stack trace). Structural
 * rules then cover values we do not hold.
 */
export function redactSecrets(text: string, env: EnvLike = process.env): string {
  let out = text;

  for (const name of SECRET_ENV_VARS) {
    const value = env[name];
    // A very short value would match everywhere; those are not real passwords.
    if (!value || value.length < 8) continue;
    out = out.replace(new RegExp(escapeRegExp(value), "g"), REDACTED);
  }

  for (const { re, replace } of STRUCTURAL_RULES) {
    out = out.replace(re, replace);
  }

  return out;
}

/** True when an attachment is text we can safely rewrite. */
export function isTextAttachment(contentType: string, name: string): boolean {
  if (contentType.startsWith("text/")) return true;
  if (contentType === "application/json") return true;
  // Playwright labels the ARIA snapshot as error-context; be explicit about it.
  return name === "error-context";
}

/**
 * Rewrites text attachments in place before any consuming reporter copies
 * them. Returns the number of files changed so the run reports its own
 * scrubbing rather than doing it invisibly.
 */
export function redactAttachmentFiles(
  attachments: ReadonlyArray<{ name: string; contentType: string; path?: string }>,
  env: EnvLike = process.env
): number {
  let changed = 0;
  for (const attachment of attachments) {
    if (!attachment.path) continue;
    if (!isTextAttachment(attachment.contentType, attachment.name)) continue;
    let original: string;
    try {
      original = fs.readFileSync(attachment.path, "utf8");
    } catch {
      continue; // already moved or removed — nothing to scrub
    }
    const redacted = redactSecrets(original, env);
    if (redacted === original) continue;
    try {
      fs.writeFileSync(attachment.path, redacted, "utf8");
      changed += 1;
    } catch {
      // Non-fatal: a failed rewrite must not mask the test failure itself.
    }
  }
  return changed;
}

/**
 * Reporter that scrubs attachments as each test ends — before the HTML
 * reporter copies them into the report directory at the end of the run.
 * Registered FIRST in playwright.config.ts so the ordering is explicit.
 */
export default class SecretRedactingReporter implements Reporter {
  private redactedFiles = 0;

  onTestEnd(_test: TestCase, result: TestResult): void {
    this.redactedFiles += redactAttachmentFiles(result.attachments);
  }

  onEnd(_result: FullResult): void {
    if (this.redactedFiles > 0) {
      // Count only — never the value, and never which secret matched.
      console.log(`[secret-redaction] scrubbed secret material from ${this.redactedFiles} attachment file(s)`);
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}
