/**
 * Overlay structural guards (PR 5) — walk the source tree and fail if a future
 * change reintroduces any of the patterns this PR deleted. Each rule names the
 * disease it prevents; the allow-lists are exact files, not directories.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = walk(SRC).filter((f) => !/\.test\.(ts|tsx)$/.test(f) && !f.endsWith("overlay.guard.test.ts"));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(SRC.length + 1).split("\\").join("/");

describe("overlay structural guards", () => {
  it("document/window keydown listeners live ONLY in overlayInfra (+ the palette's ⌘K opener)", () => {
    // Before PR 5 there were five independent Escape listeners; Escape over a
    // stacked prompt closed the modal underneath. Never again.
    const allowed = new Set(["design-system/overlayInfra.ts", "components/ux/CommandPalette.tsx"]);
    const offenders = files
      .filter((f) => /addEventListener\((["'])keydown\1/.test(read(f)))
      .map(rel)
      .filter((f) => !allowed.has(f));
    expect(offenders).toEqual([]);
  });

  it("the palette's remaining listener is the ⌘K opener, NOT an Escape handler", () => {
    const palette = read(join(SRC, "components/ux/CommandPalette.tsx"));
    expect(/key\s*===\s*(["'])Escape\1/.test(palette)).toBe(false);
  });

  it("body overflow / paddingRight writes live ONLY in the ref-counted scroll lock", () => {
    // One surface locking scroll while seven didn't is how the audit found the
    // page scrolling under an open modal.
    const offenders = files
      .filter((f) => /document\.body\.style\.(overflow|paddingRight)\s*=/.test(read(f)))
      .map(rel)
      .filter((f) => f !== "design-system/overlayInfra.ts");
    expect(offenders).toEqual([]);
  });

  it('role="dialog" is rendered ONLY by Overlay — no hand-rolled modal shells', () => {
    const offenders = files
      .filter((f) => /role=("|')dialog\1/.test(read(f)))
      .map(rel)
      .filter((f) => f !== "design-system/Overlay.tsx");
    expect(offenders).toEqual([]);
  });

  it("no fixed-inset backdrops outside Overlay (Toast is fixed but not a backdrop)", () => {
    const allowed = new Set(["design-system/Overlay.tsx"]);
    const offenders = files
      .filter((f) => read(f).includes("fixed inset-0"))
      .map(rel)
      .filter((f) => !allowed.has(f));
    expect(offenders).toEqual([]);
  });

  it("no duplicated focus-trap machinery — the focusable query exists once, in overlayInfra", () => {
    // Three byte-identical copy-pasted traps (Auth, PerformanceCounter,
    // MatchModal model hook) collapsed into focusablesIn().
    const offenders = files
      .filter((f) => /querySelectorAll<HTMLElement>\(\s*['"`]/.test(read(f)))
      .map(rel)
      .filter((f) => f !== "design-system/overlayInfra.ts");
    expect(offenders).toEqual([]);
  });

  it("no literal z-index inside the overlay band (≥50) — overlay stacking is tokens-only", () => {
    // PR 3 reserved 50+ for overlays (--fp-z-overlay .. --fp-z-tooltip); any
    // literal in that band could silently outstack a tokened surface. Chrome
    // below the band (z-40 headers/navs) is PR 6 territory and stays untouched.
    const offenders = files
      .filter((f) => /className[^\n]*\bz-(50|\[(?:[5-9]\d|\d{3,})\])/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("createPortal is used ONLY by the shared engine (Overlay + Toast)", () => {
    const allowed = new Set(["design-system/Overlay.tsx", "design-system/Toast.tsx"]);
    const offenders = files
      .filter((f) => read(f).includes("createPortal"))
      .map(rel)
      .filter((f) => !allowed.has(f));
    expect(offenders).toEqual([]);
  });
});
