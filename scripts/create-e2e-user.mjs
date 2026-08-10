#!/usr/bin/env node
/**
 * Create (or rotate) a dedicated E2E test account via the Supabase admin API.
 *
 *   node scripts/create-e2e-user.mjs <email> <ENV_PREFIX>
 *   node scripts/create-e2e-user.mjs e2e-auth@footy-predictor.test E2E_LOGOUT
 *
 * Generates a strong password, creates the user with email already confirmed,
 * and appends `<ENV_PREFIX>_EMAIL` / `<ENV_PREFIX>_PASSWORD` to the gitignored
 * .env.e2e.local. The password is never printed — read it from that file, or
 * pipe it straight into `gh secret set`.
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import fs from "node:fs";
import crypto from "node:crypto";

const ENV_FILE = ".env.local";
const CREDS_FILE = ".env.e2e.local";

function readEnvFile(path) {
  if (!fs.existsSync(path)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")];
      })
  );
}

const [email, prefix] = process.argv.slice(2);
if (!email || !prefix) {
  console.error("usage: node scripts/create-e2e-user.mjs <email> <ENV_PREFIX>");
  process.exit(1);
}

const env = { ...readEnvFile(ENV_FILE), ...process.env };
const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(`Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (looked in ${ENV_FILE} and the environment).`);
  process.exit(1);
}

// URL-safe, no shell-hostile characters — these values travel through env files,
// GitHub secrets and a Playwright fill().
const password = crypto.randomBytes(24).toString("base64url");

const res = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ email, password, email_confirm: true })
});

if (!res.ok) {
  console.error(`Supabase admin API returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const user = await res.json();
fs.appendFileSync(
  CREDS_FILE,
  `\n# Dedicated E2E account for ${prefix}, created ${new Date().toISOString().slice(0, 10)}.\n` +
    `${prefix}_EMAIL=${email}\n${prefix}_PASSWORD=${password}\n`,
  "utf8"
);

console.log(`Created ${email} (id ${user.id}).`);
console.log(`Credentials appended to ${CREDS_FILE} as ${prefix}_EMAIL / ${prefix}_PASSWORD.`);
