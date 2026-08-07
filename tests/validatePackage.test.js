import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  findDuplicateKeys,
  findOrphanSuites,
  listNodeTestFiles
} from "../scripts/validate-package.mjs";

/**
 * The scanner exists because JSON.parse cannot report duplicate keys — the
 * exact blindness behind the incident where `npm test` silently lost two
 * suites. These fixtures are synthetic reconstructions of that failure shape.
 */

test("clean JSON reports no duplicates", () => {
  const raw = `{"name":"x","scripts":{"test":"a","lint":"b"},"deps":{"react":"1"}}`;

  assert.deepEqual(findDuplicateKeys(raw), []);
});

test("detects a duplicate key at the top level", () => {
  const raw = `{"name":"x","name":"y"}`;

  assert.deepEqual(findDuplicateKeys(raw), ["name"]);
});

test("detects the incident shape: duplicate keys inside scripts", () => {
  // The real merge left `test` and `test:validation` declared twice each.
  const raw = `{
    "scripts": {
      "test": "run a",
      "test": "run b",
      "test:validation": "old list",
      "lint": "eslint .",
      "test:validation": "new list"
    }
  }`;

  assert.deepEqual(findDuplicateKeys(raw), ["scripts.test", "scripts.test:validation"]);
});

test("reports the full path for deeply nested duplicates", () => {
  const raw = `{"a":{"b":{"c":1,"c":2}}}`;

  assert.deepEqual(findDuplicateKeys(raw), ["a.b.c"]);
});

test("identical keys in different objects are not duplicates", () => {
  const raw = `{"a":{"test":1},"b":{"test":2}}`;

  assert.deepEqual(findDuplicateKeys(raw), []);
});

test("objects inside arrays get their own scope", () => {
  const raw = `{"arr":[{"k":1},{"k":2},{"k":3,"k":4}]}`;

  assert.deepEqual(findDuplicateKeys(raw), ["arr.2.k"]);
});

test("escaped quotes inside keys and values do not break the scan", () => {
  const raw = `{"a\\"b":1,"c":"say \\"hi\\"","a\\"b":2}`;

  assert.deepEqual(findDuplicateKeys(raw), ['a\\"b']);
});

test("handles literals, numbers and whitespace like real package.json files", () => {
  const raw = `{
    "flag": true,
    "count": 42.5,
    "nothing": null,
    "flag": false
  }`;

  assert.deepEqual(findDuplicateKeys(raw), ["flag"]);
});

test("a suite referenced by exact path is not an orphan", () => {
  const scripts = { "test:math": "node --test tests/math.test.js" };

  assert.deepEqual(findOrphanSuites(scripts, ["tests/math.test.js"]), []);
});

test("a suite covered by its directory glob is not an orphan", () => {
  const scripts = { "test:meta": "node --test tests/metaLearning/*.test.js" };

  assert.deepEqual(findOrphanSuites(scripts, ["tests/metaLearning/MetaDataHealth.test.js"]), []);
});

test("a suite no script mentions is an orphan — the silent-loss case", () => {
  const scripts = {
    test: "npm run test:math",
    "test:math": "node --test tests/math.test.js"
  };

  assert.deepEqual(findOrphanSuites(scripts, ["tests/math.test.js", "tests/forgotten.test.js"]), [
    "tests/forgotten.test.js"
  ]);
});

test("a glob for one directory does not cover a sibling directory", () => {
  const scripts = { "test:pipeline": "node --test tests/pipeline/modelFusion/*.test.js" };

  assert.deepEqual(findOrphanSuites(scripts, ["tests/pipeline/decision/select.test.js"]), [
    "tests/pipeline/decision/select.test.js"
  ]);
});

test("the real repository currently passes all three checks", () => {
  // Self-referential guard: if this test file itself were not registered in an
  // npm script, this assertion is what would fail in CI.
  const raw = fs.readFileSync("package.json", "utf8");

  assert.deepEqual(findDuplicateKeys(raw), []);
  assert.deepEqual(findOrphanSuites(JSON.parse(raw).scripts, listNodeTestFiles(process.cwd())), []);
});
