#!/usr/bin/env node
/**
 * Runner for the Global Special Bet database integration suite.
 *
 * Brings up a throwaway Postgres container, runs
 * tests/integration/globalSpecialBets.db.test.js against it, and tears it down.
 * Nothing here touches a real database, and the suite is deliberately kept out
 * of test:unit and test:validation — it needs Docker, they do not.
 *
 * Plain Postgres rather than `supabase start`: this project has no local
 * Supabase stack (no supabase/config.toml), and the migration only needs
 * auth.users, auth.uid() and the three Supabase roles, which
 * tests/integration/bootstrap.auth.sql provides.
 *
 * If Docker is unavailable the run FAILS loudly. An integration suite that
 * silently passes without a database is worse than no suite at all.
 */
import { spawnSync } from "node:child_process";

/**
 * The suite path is an argument rather than a constant so package.json names it
 * literally. scripts/validate-package.mjs scans those strings for orphaned test
 * files — a guard added after suites once vanished from `npm test` — and hiding
 * the path inside this runner would blind it.
 */
const SUITE = process.argv[2] || "tests/integration/globalSpecialBets.db.test.js";
const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const IMAGE = process.env.GSB_TEST_IMAGE || "postgres:16-alpine";
const KEEP = process.env.GSB_TEST_KEEP === "1";

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
}

function fail(message) {
  console.error(`\n[gsb-integration] ${message}\n`);
  process.exit(1);
}

const docker = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
if (docker.status !== 0) {
  fail(
    "Docker is not available or its daemon is not running.\n" +
      "Start Docker Desktop and retry. These tests exercise real PostgreSQL " +
      "behaviour (RLS, SECURITY DEFINER, ON CONFLICT, transaction rollback) and " +
      "cannot be simulated."
  );
}

const existing = run("docker", ["ps", "-aq", "-f", `name=^${CONTAINER}$`]).stdout.trim();
if (!existing) {
  console.log(`[gsb-integration] starting ${IMAGE} as ${CONTAINER}…`);
  const started = run("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-p",
    "55432:5432",
    IMAGE
  ]);
  if (started.status !== 0) fail(`Could not start the container:\n${started.stderr}`);
} else {
  run("docker", ["start", CONTAINER]);
}

let ready = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  if (run("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"]).status === 0) {
    ready = true;
    break;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}
if (!ready) fail("Postgres did not become ready inside the container.");

const test = run("node", ["--test", SUITE], { stdio: "inherit" });

if (!KEEP) {
  run("docker", ["rm", "-f", CONTAINER]);
} else {
  console.log(`[gsb-integration] keeping ${CONTAINER} (GSB_TEST_KEEP=1)`);
}

process.exit(test.status ?? 1);
