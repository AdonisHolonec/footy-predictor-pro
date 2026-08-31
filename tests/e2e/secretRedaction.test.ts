import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REDACTED, isTextAttachment, redactAttachmentFiles, redactSecrets } from "../../e2e/secretRedaction";

/**
 * Every credential-shaped string here is synthetic. Nothing in this file is a
 * real secret, and none of these values exist in any environment.
 */
const SENTINEL = "TEST_REDACTION_SENTINEL_PASSWORD_DO_NOT_USE";
const FAKE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.c2lnbmF0dXJlLXBsYWNlaG9sZGVy";

const tmpFiles: string[] = [];
function tmpFile(contents: string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "redact-")), "error-context.md");
  fs.writeFileSync(p, contents, "utf8");
  tmpFiles.push(p);
  return p;
}
afterEach(() => {
  while (tmpFiles.length) {
    const p = tmpFiles.pop()!;
    try {
      fs.rmSync(path.dirname(p), { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

describe("redactSecrets", () => {
  it("removes a literal secret value taken from the environment", () => {
    const text = `- textbox "Parolă": ${SENTINEL}\nand again ${SENTINEL} inline`;
    const out = redactSecrets(text, { E2E_PASSWORD: SENTINEL });
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain(REDACTED);
  });

  it("redacts every configured credential variable, not just the first", () => {
    const env = { E2E_PASSWORD: "aaaaaaaaaaaa", E2E_ADMIN_PASSWORD: "bbbbbbbbbbbb", E2E_LOGOUT_PASSWORD: "cccccccccccc" };
    const out = redactSecrets("aaaaaaaaaaaa bbbbbbbbbbbb cccccccccccc", env);
    expect(out).toBe(`${REDACTED} ${REDACTED} ${REDACTED}`);
  });

  it("redacts a password textbox even when the value is unknown to us", () => {
    // The exposure path: we do not hold this value, structure alone must catch it.
    const out = redactSecrets('- textbox "Parolă": hunter2-not-in-env', {});
    expect(out).not.toContain("hunter2-not-in-env");
    expect(out).toContain(`textbox "Parolă": ${REDACTED}`);
  });

  it("matches password labels across locales and casings", () => {
    for (const label of ["Parolă", "Password", "parola", "Contraseña", "Passwort", "Mot de passe", "Senha"]) {
      const out = redactSecrets(`- textbox "${label}": s3cr3t-value`, {});
      expect(out, label).not.toContain("s3cr3t-value");
    }
  });

  it("redacts JWTs, Authorization headers and credential JSON fields", () => {
    expect(redactSecrets(`token=${FAKE_JWT}`, {})).not.toContain(FAKE_JWT);
    expect(redactSecrets(`authorization: Bearer ${FAKE_JWT}`, {})).not.toContain(FAKE_JWT);
    expect(redactSecrets('"access_token": "abc123def"', {})).not.toContain("abc123def");
    expect(redactSecrets('"refresh_token": "rt-abc-123"', {})).not.toContain("rt-abc-123");
    expect(redactSecrets('"password": "pw-abc-123"', {})).not.toContain("pw-abc-123");
  });

  it("keeps the diagnostics that make a failure readable", () => {
    const snapshot = [
      "Locator: getByRole('button', { name: /generează predicții/i })",
      "- textbox \"Email\": e2e-bot@footy-predictor.test",
      `- textbox "Parolă": ${SENTINEL}`,
      "- paragraph: Autentificarea a durat prea mult.",
      "- button \"Autentificare\""
    ].join("\n");
    const out = redactSecrets(snapshot, { E2E_PASSWORD: SENTINEL });
    expect(out).toContain("getByRole('button', { name: /generează predicții/i })");
    expect(out).toContain('textbox "Email": e2e-bot@footy-predictor.test');
    expect(out).toContain("Autentificarea a durat prea mult.");
    expect(out).toContain('button "Autentificare"');
    expect(out).not.toContain(SENTINEL);
  });

  it("ignores an implausibly short env value rather than redacting everything", () => {
    const out = redactSecrets("a perfectly ordinary sentence", { E2E_PASSWORD: "a" });
    expect(out).toBe("a perfectly ordinary sentence");
  });

  it("leaves text without secrets byte-identical", () => {
    const clean = "Locator: getByRole('navigation', { name: 'Admin' })\n- heading \"Azi\"";
    expect(redactSecrets(clean, { E2E_PASSWORD: SENTINEL })).toBe(clean);
  });
});

describe("isTextAttachment", () => {
  it("accepts text and the error-context attachment, rejects binaries", () => {
    expect(isTextAttachment("text/markdown", "error-context")).toBe(true);
    expect(isTextAttachment("application/octet-stream", "error-context")).toBe(true);
    expect(isTextAttachment("application/json", "whatever")).toBe(true);
    expect(isTextAttachment("image/png", "screenshot")).toBe(false);
    expect(isTextAttachment("application/zip", "trace")).toBe(false);
  });
});

describe("redactAttachmentFiles", () => {
  it("rewrites a text attachment in place and counts it", () => {
    const p = tmpFile(`- textbox "Parolă": ${SENTINEL}`);
    const changed = redactAttachmentFiles(
      [{ name: "error-context", contentType: "text/markdown", path: p }],
      { E2E_PASSWORD: SENTINEL }
    );
    expect(changed).toBe(1);
    const after = fs.readFileSync(p, "utf8");
    expect(after).not.toContain(SENTINEL);
    expect(after).toContain(REDACTED);
  });

  it("never rewrites a binary attachment", () => {
    const p = tmpFile(`- textbox "Parolă": ${SENTINEL}`);
    const changed = redactAttachmentFiles(
      [{ name: "screenshot", contentType: "image/png", path: p }],
      { E2E_PASSWORD: SENTINEL }
    );
    expect(changed).toBe(0);
    expect(fs.readFileSync(p, "utf8")).toContain(SENTINEL);
  });

  it("survives a missing file and an in-memory attachment without a path", () => {
    expect(() =>
      redactAttachmentFiles(
        [
          { name: "error-context", contentType: "text/markdown", path: path.join(os.tmpdir(), "does-not-exist-xyz.md") },
          { name: "error-context", contentType: "text/markdown" }
        ],
        {}
      )
    ).not.toThrow();
  });

  it("reports 0 when nothing needed redacting", () => {
    const p = tmpFile("- heading \"Azi\"");
    expect(redactAttachmentFiles([{ name: "error-context", contentType: "text/markdown", path: p }], {})).toBe(0);
  });
});
