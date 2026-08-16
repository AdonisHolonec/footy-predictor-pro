/**
 * Colour-foundation guards (PR 1).
 *
 * Tailwind 3.4 silently drops `<util>-[var(--fp-x)]/NN` classes — an opacity
 * modifier cannot compose onto an arbitrary var() colour — which is how ~600
 * semantic tints and all 68 token shadows shipped as no-ops. The fix registers
 * every semantic colour as `rgb(var(--fp-x-rgb) / <alpha-value>)` in
 * tailwind.config.js, with the RGB triplets living beside their hex twins in
 * tokens.css. These tests keep the three failure modes from coming back:
 *
 *  1. a broken `/NN`-on-var class reappearing anywhere in src/;
 *  2. the hex token and its -rgb triplet drifting apart in any theme;
 *  3. the focus ring regressing to the old hardcoded teal.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const TOKENS = readFileSync(join(__dirname, "tokens.css"), "utf8");
const INDEX_CSS = readFileSync(join(SRC, "index.css"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    // The guard quotes the forbidden patterns in its own comments — skip self.
    else if (/\.(ts|tsx)$/.test(name) && !p.endsWith("tokens.guard.test.ts")) out.push(p);
  }
  return out;
}

describe("colour foundation guards", () => {
  it("no Tailwind class composes an opacity modifier onto a var() colour", () => {
    // These classes compile to NOTHING in Tailwind 3.4 — the whole class is
    // dropped and borders fall back to preflight grey. Use the registered
    // colours instead: `bg-fp-danger/10`, `border-fp-accent/35`, …
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      const matches = source.match(/[a-z-]+-\[var\(--[a-z-]+\)\]\/[0-9]+/g);
      if (matches) offenders.push(`${file}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no shadow class passes a token as an arbitrary value", () => {
    // `shadow-[var(--fp-shadow-sm)]` sets --tw-shadow-color, not box-shadow,
    // and renders no shadow. Use the named shadows: shadow-fp-sm / fp / fp-lg.
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      if (/shadow-\[var\(--fp-shadow/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("every theme block keeps each -rgb triplet in sync with its hex twin", () => {
    // Two spellings of one colour: --fp-x (hex/rgba, consumed by plain var()
    // classes) and --fp-x-rgb (raw channels, consumed by Tailwind's
    // <alpha-value> composition). They must never drift.
    const blocks = extractBlocks(TOKENS);
    expect(Object.keys(blocks)).toEqual(
      expect.arrayContaining([":root", "html.theme-light", "html.theme-dark", "html.theme-contrast"])
    );

    for (const [blockName, vars] of Object.entries(blocks)) {
      for (const [name, value] of Object.entries(vars)) {
        if (!name.endsWith("-rgb")) continue;
        const base = name.slice(0, -4);
        // Resolve the hex twin: the theme block's own value, else :root's
        // (documented inheritance — e.g. theme-contrast inherits warm-light
        // values for tokens it never overrides).
        const hex = vars[base] ?? blocks[":root"][base];
        expect(hex, `${blockName} ${base} has a triplet but no resolvable base value`).toBeTruthy();
        const resolved = resolveColor(hex, vars, blocks[":root"]);
        expect(
          toTriplet(resolved),
          `${blockName}: ${name} (${value}) out of sync with ${base} (${resolved})`
        ).toBe(value.trim());
      }
    }
  });

  it("live and value semantic tokens exist in every theme", () => {
    const blocks = extractBlocks(TOKENS);
    for (const blockName of [":root", "html.theme-light", "html.theme-dark", "html.theme-contrast"]) {
      for (const token of ["--fp-live", "--fp-live-rgb", "--fp-value", "--fp-value-rgb"]) {
        expect(blocks[blockName][token.replace(/^--/, "")], `${blockName} missing ${token}`).toBeTruthy();
      }
    }
  });

  it("the focus ring is themed, never the old hardcoded teal", () => {
    // rgba(62, 207, 191, …) belonged to no theme. The ring now rides
    // --fp-focus-ring / --fp-focus-ring-soft, defined per theme in tokens.css.
    const focusRules = INDEX_CSS.match(/:focus-visible[^}]+}/g) ?? [];
    expect(focusRules.length).toBeGreaterThan(0);
    for (const rule of focusRules) {
      expect(rule).not.toMatch(/62,\s*207,\s*191/);
      expect(rule).toMatch(/var\(--fp-focus-ring/);
    }
    for (const blockName of [":root", "html.theme-light", "html.theme-dark", "html.theme-contrast"]) {
      const vars = extractBlocks(TOKENS)[blockName];
      expect(vars["fp-focus-ring"], `${blockName} missing --fp-focus-ring`).toBeTruthy();
      expect(vars["fp-focus-ring-soft"], `${blockName} missing --fp-focus-ring-soft`).toBeTruthy();
    }
  });
});

/** Parse tokens.css into { blockSelector: { varNameWithoutDashes: value } }. */
function extractBlocks(css: string): Record<string, Record<string, string>> {
  const blocks: Record<string, Record<string, string>> = {};
  const re = /(:root|html\.theme-[a-z]+)\s*{([^}]+)}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const selector = m[1];
    const vars: Record<string, string> = blocks[selector] ?? {};
    const varRe = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
    let v: RegExpExecArray | null;
    while ((v = varRe.exec(m[2]))) vars[v[1]] = v[2].trim();
    blocks[selector] = vars;
  }
  return blocks;
}

/** Follow one level of var() indirection (e.g. --fp-accent-text: var(--fp-accent)). */
function resolveColor(
  value: string,
  themeVars: Record<string, string>,
  rootVars: Record<string, string>
): string {
  const ref = value.match(/^var\(--([a-z0-9-]+)\)$/);
  if (!ref) return value;
  return themeVars[ref[1]] ?? rootVars[ref[1]] ?? value;
}

/** "#rrggbb" | "#rgb" → "R G B" (the triplet spelling used by tokens.css). */
function toTriplet(color: string): string {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) throw new Error(`base token is not plain hex, cannot verify triplet: ${color}`);
  let h = hex[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
