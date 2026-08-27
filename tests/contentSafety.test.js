import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  SAFETY_REASONS,
  isOffensive,
  normalizeForMatch,
  validateAdminMessage,
  validateDisplayName
} from "../server-utils/contentSafety.js";

/**
 * Content safety.
 *
 * The interesting half of this file is the FALSE POSITIVES. Blocking "fuck" is
 * trivial; not blocking Pulaski, Cocktail, Dickinson, Curvature, Scunthorpe and
 * "assess" is the part that decides whether real people can use their own names.
 * A filter that fails those is one users route around, and the damage of telling
 * someone their surname is unacceptable is worse than missing one creative
 * spelling.
 */

/* ------------------------------------------------------------ length rules */

test("the policy is 3 to 24 characters, measured after trimming", () => {
  assert.equal(DISPLAY_NAME_MIN, 3);
  assert.equal(DISPLAY_NAME_MAX, 24);
  assert.equal(validateDisplayName("Ana").ok, true);
  assert.equal(validateDisplayName("A".repeat(24)).ok, true);
  assert.equal(validateDisplayName("Ab").reason, SAFETY_REASONS.DISPLAY_NAME_LENGTH);
  assert.equal(validateDisplayName("A".repeat(25)).reason, SAFETY_REASONS.DISPLAY_NAME_LENGTH);
});

test("surrounding whitespace does not count toward the limit", () => {
  // "  Ana  " is a three-character name, not a seven-character one.
  const r = validateDisplayName("   Ana   ");
  assert.equal(r.ok, true);
  assert.equal(r.value, "Ana");
  // And a 24-character name survives being pasted with padding.
  assert.equal(validateDisplayName(`  ${"A".repeat(24)}  `).ok, true);
});

test("internal whitespace runs are collapsed, not rejected", () => {
  assert.equal(validateDisplayName("Ana    Maria").value, "Ana Maria");
});

test("an empty name is a valid choice, meaning anonymous", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const r = validateDisplayName(empty);
    assert.equal(r.ok, true, String(empty));
    assert.equal(r.value, null);
  }
});

/* ------------------------------------------------------------ shape rules */

test("an email address and control characters are refused", () => {
  assert.equal(validateDisplayName("ana@example.test").reason, SAFETY_REASONS.DISPLAY_NAME_SHAPE);
  assert.equal(validateDisplayName("Ana\u0000Maria").reason, SAFETY_REASONS.DISPLAY_NAME_SHAPE);
  assert.equal(validateDisplayName("Ana\nMaria").value, "Ana Maria", "a newline should tidy, not reject");
});

/* ------------------------------------------------- legitimate names PASS */

const LEGITIMATE = [
  "Ana",
  "Andrei Pop",
  "Adrian123",
  "Constantin",
  "Alexandru",
  "Mihaela",
  "Ionut7",
  // Diacritics must survive untouched.
  "Ștefan",
  "Mădălina",
  "Călin",
  "Țiriac",
  "Anca-Maria",
  // The classic false-positive traps.
  "Pulaski",
  "Puleo",
  "Pulevski",
  "Cocktail",
  "Cocteau",
  "Dickinson",
  "Curvature",
  "Scunthorpe",
  "Analiza",
  "Titan",
  "Class",
  "Grass",
  "Bass",
  "Shore",
  "Costel",
  "Cocora"
];

test("legitimate names and ordinary words are never rejected", () => {
  const rejected = LEGITIMATE.filter((name) => isOffensive(name));
  assert.deepEqual(rejected, [], `false positives: ${rejected.join(", ")}`);
});

test("names with diacritics are stored exactly as typed", () => {
  // Folding happens for MATCHING only; it must never change what is saved.
  assert.equal(validateDisplayName("Ștefan").value, "Ștefan");
  assert.equal(validateDisplayName("Mădălina").value, "Mădălina");
});

/* ------------------------------------------------------- profanity BLOCKS */

const OFFENSIVE = [
  "pula",
  "PULA",
  "Pula",
  "muie",
  "pizdă",
  "căcat",
  "futut",
  "curvele",
  "pulele",
  "fuck",
  "FUCK",
  "fucking",
  "fuckeri",
  "shits",
  "nesimtitule"
];

test("profanity is blocked regardless of case or diacritics", () => {
  const missed = OFFENSIVE.filter((word) => !isOffensive(word));
  assert.deepEqual(missed, [], `missed: ${missed.join(", ")}`);
});

test("separator obfuscation is defeated", () => {
  for (const attempt of ["f.u.c.k", "f-u-c-k", "f u c k", "p*u*l*a", "f.u.c.k.e.r.i", "m.u.i.e"]) {
    assert.equal(isOffensive(attempt), true, attempt);
  }
});

test("repeated-letter and leetspeak obfuscation is defeated", () => {
  for (const attempt of ["fuuuck", "fuuuuuck", "c0ck", "5hit", "sh1t", "d1ck", "f4ggot", "fuck123"]) {
    assert.equal(isOffensive(attempt), true, attempt);
  }
});

test("homoglyph letters that survive NFD are folded", () => {
  // Dotless i is a distinct letter, not an accented one.
  assert.equal(isOffensive("muıe"), true);
});

test("separator collapsing does NOT join ordinary words into a match", () => {
  // The obfuscation rule only fires between SINGLE characters, so ordinary
  // multi-word text is never welded together into an accidental hit.
  assert.equal(normalizeForMatch("Ana Maria"), "ana maria");
  assert.equal(isOffensive("Ana Maria"), false);
  assert.equal(isOffensive("Marius Cocora Popescu"), false);
});

test("a blocked name is reported with the CONTENT reason, not the length one", () => {
  assert.equal(validateDisplayName("Pula").reason, SAFETY_REASONS.DISPLAY_NAME_CONTENT);
});

/* --------------------------------------------------------- admin messages */

test("an ordinary message to an administrator is accepted", () => {
  for (const message of [
    "Butonul de Predict nu raspunde pe telefon.",
    "Nu pot accesa contul meu de ieri.",
    "The odds column looks wrong for Premier League.",
    "Am o problema cu abonamentul Ultra."
  ]) {
    assert.equal(validateAdminMessage(message).ok, true, message);
  }
});

test("a profane message is refused with a stable reason and no quoted term", () => {
  const result = validateAdminMessage("sunteti niste f.u.c.k.e.r.i");
  assert.equal(result.ok, false);
  assert.equal(result.reason, SAFETY_REASONS.MESSAGE_CONTENT);
  // The response must not carry the word back to the caller.
  assert.equal(JSON.stringify(result).toLowerCase().includes("fuck"), false);
});

test("the dictionary is never exported", async () => {
  const module = await import("../server-utils/contentSafety.js");
  const exported = JSON.stringify(Object.keys(module));
  assert.equal(exported.includes("BLOCKED"), false, "the word list is reachable from outside");
});
