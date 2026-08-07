/**
 * package.json structural validation (audit remediation, Sprint 2).
 *
 * Exists because of a real incident: a merge left `test` and `test:validation`
 * declared twice, JSON.parse silently kept the last occurrence, and `npm test`
 * ran green for days while skipping the Meta Learning suite and the
 * history-sync chunking regression test. Valid JSON, wrong contents, no error
 * anywhere — the class of failure that looks like proof.
 *
 * Three checks, zero dependencies:
 *   1. package.json parses (free, from the scan).
 *   2. No duplicate keys at ANY nesting level. JSON.parse cannot see these by
 *      definition, so a minimal recursive-descent scanner walks the raw text.
 *   3. No orphaned node-test suites: every tests/**\/*.test.js on disk must be
 *      referenced by some npm script, either by exact path or via a directory
 *      glob (`tests/dir/*.test.js`). A forgotten suite fails nothing — it
 *      simply never runs — which is exactly how the incident stayed invisible.
 *      (src/ vitest suites are out of scope: `vitest run src` discovers them.)
 *
 * Runs in CI right after `npm ci`, before the test suite.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Scan raw JSON text and return duplicate key paths (e.g. "scripts.test").
 * Minimal recursive-descent walk — not a general parser, just enough JSON to
 * track object scopes and the keys seen in each.
 */
export function findDuplicateKeys(raw) {
  const duplicates = [];
  let i = 0;

  const ws = () => {
    while (i < raw.length && /\s/.test(raw[i])) i++;
  };

  const parseString = () => {
    // Caller guarantees raw[i] === '"'.
    let out = "";
    i++;
    while (i < raw.length) {
      const c = raw[i];
      if (c === "\\") {
        out += raw[i] + raw[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return out;
      }
      out += c;
      i++;
    }
    throw new Error("unterminated string");
  };

  const parseValue = (pathParts) => {
    ws();
    const c = raw[i];
    if (c === "{") return parseObject(pathParts);
    if (c === "[") return parseArray(pathParts);
    if (c === '"') {
      parseString();
      return;
    }
    // Bare literal (number / true / false / null): consume until a delimiter.
    while (i < raw.length && !/[,\]}]/.test(raw[i])) i++;
  };

  const parseObject = (pathParts) => {
    i++; // consume {
    const seen = new Set();
    ws();
    if (raw[i] === "}") {
      i++;
      return;
    }
    for (;;) {
      ws();
      const key = parseString();
      if (seen.has(key)) duplicates.push([...pathParts, key].join("."));
      seen.add(key);
      ws();
      i++; // consume :
      parseValue([...pathParts, key]);
      ws();
      if (raw[i] === ",") {
        i++;
        continue;
      }
      i++; // consume }
      return;
    }
  };

  const parseArray = (pathParts) => {
    i++; // consume [
    ws();
    if (raw[i] === "]") {
      i++;
      return;
    }
    let index = 0;
    for (;;) {
      parseValue([...pathParts, String(index++)]);
      ws();
      if (raw[i] === ",") {
        i++;
        continue;
      }
      i++; // consume ]
      return;
    }
  };

  parseValue([]);
  return duplicates;
}

/**
 * Given the parsed scripts map and the test files on disk (repo-relative,
 * forward slashes), return the ones no script references.
 */
export function findOrphanSuites(scripts, testFiles) {
  const allScripts = Object.values(scripts || {}).join(" ");
  const orphans = [];
  for (const file of testFiles) {
    if (allScripts.includes(file)) continue;
    const dir = file.slice(0, file.lastIndexOf("/"));
    if (allScripts.includes(`${dir}/*.test.js`)) continue;
    orphans.push(file);
  }
  return orphans;
}

/** Recursively list tests/**\/*.test.js as repo-relative forward-slash paths. */
export function listNodeTestFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.js")) {
        found.push(path.relative(root, full).replaceAll("\\", "/"));
      }
    }
  };
  walk(path.join(root, "tests"));
  return found.sort();
}

function main() {
  const root = process.cwd();
  const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`package.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const duplicates = findDuplicateKeys(raw);
  if (duplicates.length > 0) {
    console.error("package.json declares duplicate keys (JSON.parse silently keeps the last one):");
    for (const d of duplicates) console.error(`  - ${d}`);
    process.exit(1);
  }

  const orphans = findOrphanSuites(parsed.scripts, listNodeTestFiles(root));
  if (orphans.length > 0) {
    console.error("test suites on disk that no npm script runs (they never execute, and nothing fails):");
    for (const o of orphans) console.error(`  - ${o}`);
    process.exit(1);
  }

  console.log("package.json ok: valid JSON, no duplicate keys, no orphaned test suites");
}

// Import-safe for the unit test; executes only when invoked directly.
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  main();
}
