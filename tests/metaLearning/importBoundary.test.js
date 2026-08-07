/**
 * Import-boundary guard for the Meta Learning layer.
 *
 * The layer's central constraint is that it is a SEPARATE, READ-ONLY stratum over data
 * PredictorV3 already produced. That is only credible if it is mechanically enforced:
 * a single convenience import from the pipeline would couple the analytics layer to the
 * prediction path and make "this cannot affect predictions" untrue.
 *
 * This test fails the build if any module under server-utils/metaLearning/ imports from
 * PredictionEngine, pipeline, confidence or value.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAYER_ROOT = join(__dirname, "..", "..", "server-utils", "metaLearning");

/** Directories the meta layer must never reach into. */
const FORBIDDEN = [
  { pattern: /PredictionEngine/, label: "server-utils/PredictionEngine" },
  { pattern: /(^|[/\\])pipeline[/\\]/, label: "server-utils/pipeline" },
  { pattern: /(^|[/\\])confidence[/\\]/, label: "server-utils/confidence" },
  { pattern: /(^|[/\\])value[/\\]/, label: "server-utils/value" },
  { pattern: /(^|[/\\])context[/\\]/, label: "server-utils/context" }
];

/**
 * Modules the layer is allowed to import, by basename. Anything new must be added here
 * deliberately — the point is that widening the dependency surface is a visible decision,
 * not an accident.
 */
const ALLOWED_REPO_IMPORTS = new Set([
  "supabaseAdmin.js",
  "modelConstants.js",
  "predictionsHistory.js",
  "TipEvent.js",
  "BacktestAnalytics.js",
  "benchmarkMetrics.js",
  "benchmarkEvents.js",
  "isotonicCalibration.js"
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

function importSpecifiers(source) {
  const specs = [];
  const re = /(?:^|\s)(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(source)) !== null) specs.push(match[1]);
  const dynamic = /import\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamic.exec(source)) !== null) specs.push(match[1]);
  return specs;
}

const files = walk(LAYER_ROOT);

test("meta learning layer has files to check", () => {
  assert.ok(files.length >= 5, `expected the layer to exist, found ${files.length} files`);
});

test("no meta learning module imports the prediction stack", () => {
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const spec of importSpecifiers(source)) {
      for (const { pattern, label } of FORBIDDEN) {
        if (pattern.test(spec)) {
          violations.push(`${relative(LAYER_ROOT, file)} -> ${spec} (${label})`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `meta learning must not import the prediction stack:\n${violations.join("\n")}`);
});

test("meta learning only imports allowlisted repo modules", () => {
  const unexpected = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const spec of importSpecifiers(source)) {
      // node: builtins and intra-layer relative imports are always fine.
      if (spec.startsWith("node:")) continue;
      if (!spec.startsWith(".")) continue; // bare package imports are not repo coupling
      // Resolve against the importing file, so a sibling reached via "../" from a
      // subdirectory still counts as inside the layer.
      const resolved = resolve(dirname(file), spec);
      if (!relative(LAYER_ROOT, resolved).startsWith("..")) continue;
      const basename = spec.split("/").pop();
      if (!ALLOWED_REPO_IMPORTS.has(basename)) {
        unexpected.push(`${relative(LAYER_ROOT, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(
    unexpected,
    [],
    `add to ALLOWED_REPO_IMPORTS only if the dependency is intended:\n${unexpected.join("\n")}`
  );
});
