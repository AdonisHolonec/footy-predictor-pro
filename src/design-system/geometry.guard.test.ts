/**
 * Geometry foundation guards (PR 3) — the contracts, not the pixel values:
 * one consumer container spelling, an official xs breakpoint instead of a
 * magic number, no sub-10px UI text, the 16px radius written one way, the
 * overlay stack expressed through tokens, and no declared-but-unconsumed
 * "official" scales pretending to be the system.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const TOKENS = readFileSync(join(__dirname, "tokens.css"), "utf8");
const TAILWIND = readFileSync(join(ROOT, "tailwind.config.js"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !p.endsWith("geometry.guard.test.ts")) out.push(p);
  }
  return out;
}

function offendersOf(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const source = readFileSync(file, "utf8");
    const m = source.match(pattern);
    if (m) hits.push(`${file}: ${m[0]}`);
  }
  return hits;
}

describe("geometry foundation", () => {
  it("declares the consumer container token and spells the width one way", () => {
    expect(TOKENS).toMatch(/--fp-container:\s*80rem/);
    expect(offendersOf(/max-w-\[1280px\]/)).toEqual([]);
    expect(offendersOf(/max-w-7xl/)).toEqual([]);
  });

  it("xs (380px) is an official breakpoint and the magic max-[380px] is gone", () => {
    expect(TAILWIND).toMatch(/xs:\s*"380px"/);
    expect(offendersOf(/max-\[380px\]:/)).toEqual([]);
  });

  it("no UI text below 10px", () => {
    expect(offendersOf(/text-\[[89]px\]/)).toEqual([]);
  });

  it("the 16px radius is written as the token, not as rounded-2xl / rounded-card", () => {
    expect(offendersOf(/rounded(?:-t)?-2xl/)).toEqual([]);
    expect(offendersOf(/rounded-card(?!-)/)).toEqual([]);
  });

  it("the overlay stack is token-named — no raw overlay-layer literals", () => {
    // z-10 / z-[1] / z-40 in-flow layering stays literal on purpose; the
    // OVERLAY stack (50…100) must go through the named layers.
    expect(offendersOf(/z-\[(?:6\d|7\d|8\d|9\d|100)\]/)).toEqual([]);
    expect(offendersOf(/fixed inset-0 z-50/)).toEqual([]);
    for (const token of ["--fp-z-overlay: 50", "--fp-z-drawer: 70", "--fp-z-palette: 80", "--fp-z-toast: 90", "--fp-z-prompt: 95", "--fp-z-tooltip: 100"]) {
      expect(TOKENS).toContain(token);
    }
  });

  it("keeps no fictional scales: declared tokens must have consumers", () => {
    // The eight-step spacing scale and the caption/card-title/num type tokens
    // shipped for two sprints with zero consumers. Deleted in PR 3; keep them
    // deleted — a scale nobody uses reads as the system while the code
    // follows another.
    expect(TOKENS).not.toMatch(/--fp-space-\d/);
    expect(TOKENS).not.toMatch(/--fp-caption|--fp-card-title|--fp-num(?!-)/);
  });

  it("exact-duplicate type sizes stay collapsed", () => {
    expect(offendersOf(/text-\[12px\]/)).toEqual([]);
    expect(offendersOf(/text-\[15px\]/)).toEqual([]);
  });
});
