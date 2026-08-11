import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Every CI check passed and the deployment still failed:
 *
 *   errorCode:    exceeded_serverless_functions_per_deployment
 *   errorMessage: No more than 12 Serverless Functions can be added to a
 *                 Deployment on the Hobby plan.
 *
 * Nothing in the test suite could see it, because the function budget is a
 * property of the api/ directory rather than of any file's behaviour. Adding a
 * thirteenth handler is a one-line change that looks harmless in review and is
 * only rejected at deploy time, after merge.
 *
 * These tests move that failure earlier: over budget is now a red test rather
 * than a red deployment. When the plan changes, raise the limit here — that
 * edit is the record of the decision.
 */

const API_DIR = path.join(process.cwd(), "api");
const VERCEL_CONFIG = path.join(process.cwd(), "vercel.json");

/** Vercel counts every file under api/ as its own serverless function. */
const HOBBY_FUNCTION_LIMIT = 12;

function listApiFunctions(dir = API_DIR, prefix = "api") {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const abs = path.join(dir, entry.name);
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) return listApiFunctions(abs, rel);
      return entry.name.endsWith(".js") ? [rel] : [];
    })
    .sort();
}

const readRewrites = () => JSON.parse(fs.readFileSync(VERCEL_CONFIG, "utf8")).rewrites || [];

test("the api/ directory stays within the deployable function budget", () => {
  const functions = listApiFunctions();

  assert.ok(
    functions.length <= HOBBY_FUNCTION_LIMIT,
    `${functions.length} serverless functions exceeds the ${HOBBY_FUNCTION_LIMIT} the plan allows. ` +
      `Fold an endpoint into an existing function behind a ?view= rewrite instead of adding a file:\n  ` +
      functions.join("\n  ")
  );
});

test("every /api rewrite points at a function that exists", () => {
  // A consolidated endpoint keeps its public URL through a rewrite. If the
  // destination file is renamed or deleted, the URL 404s in production while
  // every unit test still passes — so the mapping is checked here.
  const apiRewrites = readRewrites().filter((r) => String(r.destination || "").startsWith("/api/"));

  assert.ok(apiRewrites.length > 0, "expected at least the billing and special-bets consolidations");

  for (const rewrite of apiRewrites) {
    const file = String(rewrite.destination).split("?")[0].replace(/^\//, "");
    assert.ok(
      fs.existsSync(path.join(process.cwd(), `${file}.js`)),
      `${rewrite.source} rewrites to ${rewrite.destination}, but ${file}.js does not exist`
    );
  }
});

test("a consolidated endpoint has no leftover standalone function", () => {
  // Both halves of the consolidation must land together. Keeping api/x.js while
  // also rewriting /api/x elsewhere costs the function budget for a file that
  // no longer serves traffic — the rewrite wins, so the file is dead weight.
  const functions = new Set(listApiFunctions());

  for (const rewrite of readRewrites()) {
    const source = String(rewrite.source || "");
    if (!source.startsWith("/api/") || source.includes("(")) continue;
    const shadowed = `${source.replace(/^\//, "")}.js`;
    assert.ok(
      !functions.has(shadowed),
      `${shadowed} still exists but ${source} is rewritten to ${rewrite.destination}; delete the file`
    );
  }
});

test("the special-bets consolidation is wired end to end", () => {
  // The three pieces that have to agree: the rewrite, the view name the handler
  // branches on, and the module that serves it.
  const rewrite = readRewrites().find((r) => r.source === "/api/special-bets");
  assert.ok(rewrite, "vercel.json must rewrite /api/special-bets");
  assert.equal(rewrite.destination, "/api/history?view=special-bets");

  const handler = fs.readFileSync(path.join(API_DIR, "history.js"), "utf8");
  assert.match(
    handler,
    /req\.query\.view\s*\|\|\s*""\)\s*===\s*"special-bets"/,
    "api/history.js must branch on view=special-bets"
  );
  assert.match(handler, /handleGlobalSpecialBets/, "api/history.js must delegate to the GSB handler");
  assert.ok(fs.existsSync(path.join(process.cwd(), "server-utils", "globalSpecialBetsApi.js")));
});
