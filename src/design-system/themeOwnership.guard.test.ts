/**
 * Theme ownership guard (PR 2) — protects the ARCHITECTURE, not the
 * implementation: there is exactly one application-level owner of the theme
 * class on <html>, and it is design-system/theme.ts. The guard would have
 * failed on the pre-PR-2 codebase, where useUiPrefs (mounted only by
 * UserDashboard) was the owner and every other route ran classless.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const OWNER = join(__dirname, "theme.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("theme ownership", () => {
  it("design-system/theme.ts is the only module that writes theme classes to the DOM", () => {
    const writers: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      // A writer = touches classList AND mentions a theme-* class literal.
      if (/classList/.test(source) && /theme-(light|dark|contrast)/.test(source)) writers.push(file);
    }
    expect(writers).toEqual([OWNER]);
  });

  it("useUiPrefs no longer owns application — it delegates to the shared writer", () => {
    const source = readFileSync(join(SRC, "hooks", "useUiPrefs.ts"), "utf8");
    expect(source).not.toMatch(/classList/);
    expect(source).not.toMatch(/dataset\.theme/);
    expect(source).toMatch(/from "\.\.\/design-system\/theme"/);
  });

  it("nothing writes the dead data-theme attribute anymore", () => {
    for (const file of walk(SRC)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/dataset\.theme|data-theme=/);
    }
  });

  it("the router root mounts ThemeBoot, so every route gets a theme", () => {
    const source = readFileSync(join(SRC, "RootRouter.tsx"), "utf8");
    expect(source).toMatch(/<ThemeBoot \/>/);
  });

  it("the index.html pre-paint bootstrap stays in sync with the module's contract", () => {
    const html = readFileSync(join(SRC, "..", "index.html"), "utf8");
    const themeModule = readFileSync(OWNER, "utf8");
    // Same mirror key on both sides…
    const mirrorKey = themeModule.match(/THEME_MIRROR_KEY = "([^"]+)"/)?.[1];
    expect(mirrorKey).toBeTruthy();
    expect(html).toContain(`localStorage.getItem("${mirrorKey}")`);
    // …and the same three (and only three) theme values.
    expect(html).toContain('stored === "dark" || stored === "contrast"');
    expect(html).toContain('classList.add("theme-" + theme)');
    // The bootstrap never defaults to anything but light.
    expect(html).toContain('var theme = "light"');
  });
});
