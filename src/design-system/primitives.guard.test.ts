/**
 * Primitive-consolidation guards (PR 4) — the DUPLICATES must stay dead:
 * once a pattern has a primitive, its hand-rolled recipe may not reappear.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

function offenders(pattern: RegExp, except: string[] = []): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    if (except.some((e) => file.endsWith(e))) continue;
    if (pattern.test(readFileSync(file, "utf8"))) hits.push(file);
  }
  return hits;
}

describe("primitive consolidation", () => {
  it("the filter-chip recipe lives only in FilterChip", () => {
    expect(
      offenders(/rounded-full border px-3 py-1 font-mono text-\[10px\] font-semibold uppercase tracking-wide/, [
        "design-system/FilterChip.tsx"
      ])
    ).toEqual([]);
  });

  it("no hand-rolled tablist buttons outside the primitive", () => {
    // role="tab" on a raw <button> was the tab-strip recipe; tabs now come
    // from SegmentedControl. (role="tabpanel" containers remain legitimate.)
    expect(offenders(/<button[^>]*\n[^<]*role="tab"/m, ["design-system/SegmentedControl.tsx"])).toEqual([]);
  });

  it("Button never renders the '…' loading literal again", () => {
    const source = readFileSync(join(__dirname, "Button.tsx"), "utf8");
    expect(source).not.toMatch(/loading \? "…"/);
    expect(source).toMatch(/aria-busy/);
  });

  it("primitives introduce no hex colours and no sub-10px text", () => {
    for (const name of ["IconButton", "SegmentedControl", "FilterChip", "SectionHeader", "Banner", "Toast", "Button"]) {
      const source = readFileSync(join(__dirname, `${name}.tsx`), "utf8");
      expect(source, name).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
      expect(source, name).not.toMatch(/text-\[[89]px\]/);
    }
  });

  it("the shell carries no emoji controls — they moved to Account in UX-B", () => {
    const shell = readFileSync(join(SRC, "components", "ux", "ConsumerShell.tsx"), "utf8");
    for (const glyph of ["🔔", "👤", "⚙", "★"]) {
      expect(shell.includes(glyph), glyph).toBe(false);
    }
  });
});
