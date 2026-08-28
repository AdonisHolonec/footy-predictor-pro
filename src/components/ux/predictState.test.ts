/**
 * Guards for the PREDICT INTERACTION MODEL — the class of bug, not the instance.
 *
 * The instance was "the header CTA doesn't block". The class is "a gate that
 * lives on one surface, while the action has seven entry points". Testing the
 * header's disabled prop would have passed happily the whole time the command
 * palette was firing unblocked runs, so these assert the shape of the system
 * instead: the rule exists once, the action itself consults it, and no surface
 * re-derives it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildPredictAction,
  isPredictBlocked,
  resolvePredictState,
  type PredictQuota
} from "./predictState";

const DASHBOARD = readFileSync(join(__dirname, "../../pages/UserDashboard.tsx"), "utf8");
const PREDICT_CSS = readFileSync(join(__dirname, "predictCta.css"), "utf8");
const INDEX_CSS = readFileSync(join(__dirname, "../../index.css"), "utf8");
const CTA = readFileSync(join(__dirname, "PredictCta.tsx"), "utf8");
const SHELL = readFileSync(join(__dirname, "ConsumerShell.tsx"), "utf8");

/*
  Source-shape assertions must read CODE, not the comments explaining it.

  The first version of the guard below searched the raw file for "busyLabel"
  and failed on the doc comment that says the prop was REMOVED — a test that
  punishes documenting the very change it is protecting.
*/
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every component file under src/, for the whole-tree shape guards below. */
function componentSources(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  const root = join(__dirname, "../..");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push({ path: p, source: readFileSync(p, "utf8") });
      }
    }
  };
  walk(root);
  return out;
}

const quota = (over: Partial<PredictQuota> = {}): PredictQuota => ({
  quotaExempt: false,
  limit: 5,
  used: 0,
  ...over
});

describe("the quota rule itself", () => {
  it("blocks only when a real limit has actually been reached", () => {
    expect(isPredictBlocked(quota({ used: 4 }))).toBe(false);
    expect(isPredictBlocked(quota({ used: 5 }))).toBe(true);
    expect(isPredictBlocked(quota({ used: 9 }))).toBe(true);
  });

  it("never blocks an exempt account, whatever the counters say", () => {
    expect(isPredictBlocked(quota({ quotaExempt: true, used: 999 }))).toBe(false);
  });

  it("treats a null limit as no limit, never as a limit of zero", () => {
    expect(isPredictBlocked(quota({ limit: null, used: 999 }))).toBe(false);
  });

  it("resolves busy ahead of blocked, so every surface names the same state", () => {
    // Reachable on the very run that spends the last prediction: both inputs
    // are true at once, and the class, the name and both tooltips must agree.
    expect(resolvePredictState(true, quota({ used: 5 }))).toBe("busy");
    expect(resolvePredictState(false, quota({ used: 5 }))).toBe("blocked");
    expect(resolvePredictState(false, quota({ used: 1 }))).toBe("idle");
  });
});

describe("the shared action contract — behaviour, not source strings", () => {
  const labels = { label: "Generează Predicții", hint: "Generează predicții pentru zilele selectate",
                   busy: "Se generează predicțiile…", quotaSpent: "Ai folosit toate predicțiile de azi" };
  const build = (state: "idle" | "busy" | "blocked", run = () => {}) =>
    buildPredictAction({ state, labels, run });

  it("A + B — onActivate runs when idle and is inert when busy or blocked", () => {
    let runs = 0;
    const inc = () => { runs += 1; };
    build("idle", inc).onActivate();
    expect(runs).toBe(1);
    build("busy", inc).onActivate();
    build("blocked", inc).onActivate();
    expect(runs).toBe(1); // neither inert state added a run
  });

  it("every surface reading the contract gets the same answer — no contradicting booleans", () => {
    const busy = build("busy");
    const blocked = build("blocked");
    expect([busy.busy, busy.blocked, busy.disabled]).toEqual([true, false, true]);
    expect([blocked.busy, blocked.blocked, blocked.disabled]).toEqual([false, true, true]);
    // one reason string, reused everywhere rather than re-derived per surface
    expect(busy.reason).toBe(labels.busy);
    expect(blocked.reason).toBe(labels.quotaSpent);
    expect(build("idle").reason).toBeNull();
  });

  it("H + I + J — an unavailable surface shows the reason, never the instruction", () => {
    expect(build("idle").hint).toBe(labels.hint);
    expect(build("busy").hint).toBe(labels.busy);
    expect(build("blocked").hint).toBe(labels.quotaSpent);
  });

  it("Label in Name holds in every state", () => {
    for (const st of ["idle", "busy", "blocked"] as const) {
      const a = build(st);
      expect(a.accessibleName.toLowerCase()).toContain("generează predicții");
    }
    expect(build("busy").accessibleName).toContain(labels.busy);
    expect(build("blocked").accessibleName).toContain(labels.quotaSpent);
  });
});

describe("C + D — the execution boundary is synchronous, so no second run is reachable", () => {
  /*
    The palette's Enter path used to bypass its own disabled check, and
    warmAndPredict guarded blocked but not busy — two activations in the same
    tick both read `warmPredictBusy === false` through their render closure and
    both started a metered run. A ref flips synchronously; state does not.
  */
  const makeRunner = () => {
    const running = { current: false };
    let started = 0;
    const run = () => {
      if (running.current) return;
      running.current = true;
      started += 1;
    };
    return { run, started: () => started, finish: () => { running.current = false; } };
  };

  it("two activations in the SAME tick start exactly one run", () => {
    const r = makeRunner();
    r.run();
    r.run();
    expect(r.started()).toBe(1);
  });

  it("a run is possible again only once the previous one finishes", () => {
    const r = makeRunner();
    r.run();
    r.run();
    r.finish();
    r.run();
    expect(r.started()).toBe(2);
  });

  it("the dashboard uses a ref, not the busy state, as the boundary", () => {
    // State read through a closure cannot stop a same-tick second caller.
    expect(DASHBOARD).toMatch(/predictRunningRef\.current/);
    const body = DASHBOARD.slice(
      DASHBOARD.indexOf("async function warmAndPredict()"),
      DASHBOARD.indexOf("setWarmPredictBusy(true)")
    );
    expect(body).toContain("predictRunningRef.current");
    expect(body).toContain("isPredictBlocked");
  });
});

describe("A + B — one authoritative gate that every caller obeys", () => {
  /*
    Every Predict entry point calls warmAndPredict. With the gate inside that
    function, "blocked means no caller can start a run" holds even for surfaces
    that render no state at all — the onboarding effect, the command palette,
    restoreOrPredict.
  */
  it("warmAndPredict consults the shared gate before doing anything", () => {
    const body = DASHBOARD.slice(
      DASHBOARD.indexOf("async function warmAndPredict()"),
      DASHBOARD.indexOf("setWarmPredictBusy(true)")
    );
    expect(body).toContain("isPredictBlocked");
    expect(body).toMatch(/return;/);
  });

  it("no surface re-derives the quota rule for itself", () => {
    // The header used to inline `!tierQuotaExempt && limit !== null && used >= limit`.
    // One expression of the rule, in predictState.ts, or this fails.
    const inlined = DASHBOARD.match(/predictCountToday\s*>=\s*predictLimitToday/g) ?? [];
    expect(inlined).toEqual([]);
  });

  it("no JSX surface calls warmAndPredict directly — they go through onActivate", () => {
    /*
      The previous version of this counted call sites and required at least six,
      a floor the function DECLARATION alone helped satisfy. It also went green
      while the Banner was calling `warmAndPredict()` straight from an onClick,
      re-deriving its own disabled state and showing no reason — the exact
      bypass the contract exists to prevent.

      What actually matters is that no rendered control invokes the runner
      itself. Non-JSX callers (the onboarding effect, restoreOrPredict) are
      fine: they render nothing and the gate covers them.
    */
    const jsxDirectCalls = DASHBOARD.match(/on[A-Z]\w*=\{[^}]*warmAndPredict\(\)/g) ?? [];
    expect(jsxDirectCalls).toEqual([]);
  });
});

/**
 * A real cascade resolver, not a string scan.
 *
 * The previous version of these tests asserted that the text `transform: none`
 * existed in predictCta.css. Wrapping that file in `@layer components` — a
 * one-line, entirely plausible refactor — would have let index.css's unlayered
 * rule win, made an inert button visibly depress again, and kept every
 * assertion green. So this parses both stylesheets, computes specificity and
 * layer membership, and asserts WHICH RULE ACTUALLY WINS.
 */
type Rule = { selector: string; layered: boolean; reduced: boolean; decls: Record<string, string>; order: number };

function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  // Track layer/at-rule nesting so we know whether a rule sits inside @layer.
  const stack: { layer: boolean; reduced: boolean }[] = [];
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf("{", i);
    if (brace === -1) break;
    const close = css.indexOf("}", i);
    if (close !== -1 && close < brace) { stack.pop(); i = close + 1; continue; }
    /*
      Only the LAST statement before the brace is this block's prelude. Slicing
      the whole gap swallows preceding statements — `@tailwind base;` ahead of
      `@layer base {` made every rule in the file read as unlayered, which is
      precisely the misreading this resolver exists to prevent.
    */
    const gap = css.slice(i, brace).replace(/\/\*[\s\S]*?\*\//g, "");
    const prelude = gap.split(";").pop()!.trim();
    if (prelude.startsWith("@")) {
      stack.push({ layer: /^@layer\b/.test(prelude), reduced: /prefers-reduced-motion/.test(prelude) });
      i = brace + 1;
      continue;
    }
    // a style rule: read to its closing brace
    let depth = 1, j = brace + 1;
    while (j < css.length && depth > 0) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
    const body = css.slice(brace + 1, j - 1);
    const decls: Record<string, string> = {};
    for (const d of body.split(";")) {
      const c = d.indexOf(":");
      if (c === -1) continue;
      const prop = d.slice(0, c).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!prop || prop.startsWith("@")) continue;
      decls[prop] = d.slice(c + 1).trim();
    }
    for (const sel of prelude.split(",")) {
      if (sel.trim())
        rules.push({
          selector: sel.trim(),
          layered: stack.some((s) => s.layer),
          reduced: stack.some((s) => s.reduced),
          decls,
          order: order++
        });
    }
    i = j;
  }
  return rules;
}

/** (id, class+attr+pseudo-class, element+pseudo-element) — :not() contributes its argument. */
function specificity(sel: string): [number, number, number] {
  let s = sel;
  let a = 0, b = 0, c = 0;
  s = s.replace(/:not\(([^)]*)\)/g, (_, inner) => { const [x, y, z] = specificity(inner); a += x; b += y; c += z; return " "; });
  a += (s.match(/#[\w-]+/g) || []).length;
  b += (s.match(/\.[\w-]+/g) || []).length;
  b += (s.match(/\[[^\]]*\]/g) || []).length;
  b += (s.match(/:(?!:)[\w-]+/g) || []).length;
  c += (s.match(/::[\w-]+/g) || []).length;
  c += (s.match(/(^|[\s>+~])([a-z][\w-]*)/gi) || []).length;
  return [a, b, c];
}

const cmp = (x: [number, number, number], y: [number, number, number]) =>
  x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/** Does `el` (a tiny descriptor) match this selector, for the shapes we care about? */
function matches(sel: string, el: { classes: string[]; ariaDisabled: boolean; active: boolean }): boolean {
  if (!/:active/.test(sel)) return false;
  if (!el.active) return false;
  const notArgs = [...sel.matchAll(/:not\(([^)]*)\)/g)].map((m) => m[1]);
  for (const arg of notArgs) {
    if (arg === ":disabled") continue; // never natively disabled — the :not passes
    if (arg === '[aria-disabled="true"]' && el.ariaDisabled) return false;
  }
  const base = sel.replace(/:not\([^)]*\)/g, "");
  if (/\[aria-disabled="true"\]/.test(base) && !el.ariaDisabled) return false;
  for (const cls of base.match(/\.[\w-]+/g) || []) {
    if (!el.classes.includes(cls.slice(1))) return false;
  }
  if (/^button/.test(base) || /[\s>+~]button/.test(base)) return true;
  return (base.match(/\.[\w-]+/g) || []).length > 0;
}

function winner(
  prop: string,
  el: { classes: string[]; ariaDisabled: boolean; active: boolean },
  reducedMotion = false
) {
  const all = [...parseRules(INDEX_CSS).map((r) => ({ ...r, file: "index.css" })),
               ...parseRules(PREDICT_CSS).map((r) => ({ ...r, file: "predictCta.css", order: r.order + 100000 }))];
  const candidates = all.filter(
    (r) => r.decls[prop] !== undefined && matches(r.selector, el) && (reducedMotion || !r.reduced)
  );
  if (!candidates.length) return null;
  /*
    Winner is the LAST element after sorting by ascending precedence.
    Unlayered beats @layer, so unlayered must sort LATER — this comparator was
    inverted on the first attempt and the resolver happily declared a layered
    rule the winner, which is the exact mistake it exists to catch.
  */
  candidates.sort((x, y) =>
    Number(y.layered) - Number(x.layered) ||
    cmp(specificity(x.selector), specificity(y.selector)) ||
    x.order - y.order);
  return candidates[candidates.length - 1];
}

describe("C + D — cascade: an inert control cannot receive the press transform", () => {
  const busy = { classes: ["fp-predict", "is-busy"], ariaDisabled: true, active: true };
  const blocked = { classes: ["fp-predict", "is-disabled"], ariaDisabled: true, active: true };
  const idle = { classes: ["fp-predict"], ariaDisabled: false, active: true };

  it("the global press rule exists and would otherwise match an aria-disabled button", () => {
    // Establishes the hazard the opt-out answers. `:not(:disabled)` is true for
    // this button because it never sets the native attribute.
    const global = parseRules(INDEX_CSS).find((r) => /button:active:not\(:disabled\)/.test(r.selector));
    expect(global).toBeTruthy();
    expect(matches(global!.selector, busy)).toBe(true);
    expect(matches(global!.selector, blocked)).toBe(true);
  });

  it("BUSY resolves transform to none — by cascade, whatever the layer", () => {
    const w = winner("transform", busy);
    expect(w?.decls.transform).toBe("none");
    expect(w?.file).toBe("predictCta.css");
  });

  it("BLOCKED resolves transform to none — by cascade, whatever the layer", () => {
    const w = winner("transform", blocked);
    expect(w?.decls.transform).toBe("none");
  });

  it("BUSY and BLOCKED resolve filter to none", () => {
    expect(winner("filter", busy)?.decls.filter).toBe("none");
    expect(winner("filter", blocked)?.decls.filter).toBe("none");
  });

  it("IDLE keeps its press feedback — the opt-out is scoped, not a blanket kill", () => {
    const w = winner("transform", idle);
    expect(w).toBeTruthy();
    expect(w?.decls.transform).not.toBe("none");
  });

  it("under reduced motion the inert states are STILL inert, and idle loses only the motion", () => {
    expect(winner("transform", busy, true)?.decls.transform).toBe("none");
    expect(winner("transform", blocked, true)?.decls.transform).toBe("none");
    // idle legitimately drops to none here — that is the reduced-motion contract,
    // not the inert opt-out.
    expect(winner("transform", idle, true)?.decls.transform).toBe("none");

    /*
      The filter is the half that actually bites. index.css's reduced-motion
      copy of the global press rule is UNLAYERED and sets
      `filter: brightness(0.99)` — a flash on press. It only loses to this
      component because predictCta.css is unlayered too and outranks it on
      specificity. Wrap predictCta.css in any @layer and the unlayered global
      wins outright, and an inert button flashes again. That refactor is exactly
      what defeated the previous string-matching version of these tests.
    */
    expect(winner("filter", busy, true)?.decls.filter).toBe("none");
    expect(winner("filter", blocked, true)?.decls.filter).toBe("none");
    expect(winner("filter", busy, true)?.file).toBe("predictCta.css");
  });

  it("the raised rim stays off while inert, on hover AND on focus", () => {
    const rim = parseRules(PREDICT_CSS).filter((r) => /::before/.test(r.selector) && r.decls.opacity === "1");
    const guarded = rim.filter((r) => /:hover|:focus-visible/.test(r.selector));
    expect(guarded.length).toBeGreaterThan(0);
    for (const r of guarded) expect(r.selector).toContain(':not([aria-disabled="true"])');
  });
});

describe("E + F — the busy rail is themed, not hardcoded", () => {
  /*
    The rail is the only visual carrier of busy, so WCAG 1.4.11 wants 3:1 of it.
    Hardcoded white measured 2.73:1 on the dark theme's green face and 1.73:1 on
    high contrast's. The numeric proof lives in browser QA; this pins the
    mechanism so it cannot silently regress to a literal again.
  */
  // Comments are stripped first: the block explains the OLD hardcoded sweep by
  // quoting it, and the assertion is about declarations, not prose.
  const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const railBlock = () => {
    const css = stripComments(PREDICT_CSS);
    const start = css.indexOf(".fp-predict.is-busy::before");
    return css.slice(start, css.indexOf("}", start));
  };

  it("draws the rail from --fp-on-accent, the ink that flips with the theme", () => {
    expect(railBlock()).toContain("var(--fp-on-accent)");
  });

  it("uses no hardcoded white anywhere in the rail", () => {
    expect(railBlock()).not.toMatch(/rgba\(255,\s*255,\s*255/);
  });

  it("keeps the reduced-motion rail themed and at full strength", () => {
    const css = stripComments(PREDICT_CSS);
    const reduced = css.slice(css.lastIndexOf("prefers-reduced-motion"));
    expect(reduced).toContain("var(--fp-on-accent)");
    expect(reduced).not.toMatch(/background-color:\s*rgba\(255,\s*255,\s*255/);
  });
});

describe("C(12) + D(12) + I — the quota reason has ONE home, and it is not over the glyphs", () => {
  const CTA = readFileSync(join(__dirname, "PredictCta.tsx"), "utf8");
  const STRIP = readFileSync(join(__dirname, "PlanHeaderStrip.tsx"), "utf8");

  it("no element is absolutely positioned over the Predict button's own label", () => {
    // A tag pinned to the CTA measured 3.6px of overlap with the label's first
    // line and covered the "Ă" of GENEREAZĂ in Romanian. Nothing may live there.
    expect(CTA).not.toMatch(/blockedTag/);
    expect(PREDICT_CSS).not.toMatch(/\.fp-predict-tag/);
    const absolutes = parseRules(PREDICT_CSS).filter((r) => r.decls.position === "absolute");
    // ::before is the only out-of-flow layer, and it is the rim/rail — never text.
    for (const r of absolutes) expect(r.selector).toMatch(/::before/);
  });

  it("the plan card owns quota exhaustion, using the same rule as the Predict gate", () => {
    expect(STRIP).toContain("isPredictBlocked");
    expect(STRIP).toMatch(/quotaSpent/);
  });

  it("J — an exempt account cannot render a fake exhaustion", () => {
    // Exemption arrives as quota === null, so the predicate is unreachable for it.
    expect(isPredictBlocked({ quotaExempt: true, limit: 5, used: 99 })).toBe(false);
    expect(isPredictBlocked({ quotaExempt: false, limit: null, used: 99 })).toBe(false);
  });
});

/*
  ONE COMPOSITION, NOT TWO.

  The contract stopped surfaces disagreeing about the STATE. These stop them
  disagreeing about the STRINGS. PredictCta used to take `state`, `hint`,
  `busyLabel`, `disabledLabel` and `accessibleName` as five loose props and
  rebuild the spoken name and the tooltip from them — a second derivation of
  what buildPredictAction had already resolved. The two agreed only for as long
  as someone kept them agreeing, and they had already drifted once: the title
  read the idle promise on a button that would refuse.
*/
describe("one composition, not two", () => {
  it("only predictState.ts builds a `label — reason` name", () => {
    /*
      The em-dash join is the signature of composing an ACCESSIBLE NAME.
      Anywhere else it is a second path to a string the contract already owns.

      Scope note: a surface may still compose its own VISIBLE text — the palette
      row renders `label · reason` — because that is display, not the name a
      voice-control user has to say. The name has exactly one author; the
      separator here is deliberately the one the contract uses.
    */
    const offenders = componentSources()
      .filter(({ path }) => !path.endsWith("predictState.ts"))
      .filter(({ source }) => /`\$\{[A-Za-z.]*label[A-Za-z.]*\}\s+—\s+/i.test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("the CTA takes the action itself, not strings describing it", () => {
    const code = stripComments(CTA);
    const props = code.slice(code.indexOf("type Props = {"), code.indexOf("};", code.indexOf("type Props = {")));
    expect(props).toContain("action: PredictAction");
    for (const gone of ["busyLabel", "disabledLabel", "accessibleName?", "state?", "onPredict"]) {
      expect(props, `PredictCta should no longer accept ${gone}`).not.toContain(gone);
    }
  });

  it("the CTA SPREADS the surface and overrides only the name", () => {
    /*
      The earlier version of this test asserted that the CTA set title, onClick
      and aria-label itself — which passed happily while the component was a
      second implementation of predictSurfaceProps. Restating the factory's
      output is the defect, not the proof, so the assertion is inverted: the
      factory is spread, and the ONLY thing the component may still name for
      itself is aria-label, because its letters are aria-hidden and it has no
      visible words to fall back on when idle.
    */
    const code = stripComments(CTA);
    expect(code).toContain("{...predictSurfaceProps(action)}");
    expect(code).toContain("aria-label={action.accessibleName}");
    for (const rebuilt of ["title={", "onClick={", "aria-busy={", "aria-disabled={"]) {
      expect(code, `PredictCta should take ${rebuilt} from the spread`).not.toContain(rebuilt);
    }
    // No local guard duplicating onActivate's.
    expect(code).not.toMatch(/if\s*\(inert\)\s*return/);
  });

  it("the shell passes the action whole, with no dead optional chaining", () => {
    const code = stripComments(SHELL);
    // The file has more than one Tooltip — close the slice at the one that
    // FOLLOWS the Predict block, not at the first in the file.
    const start = code.indexOf("{predictAction ? (");
    expect(start, "the Predict block moved — this guard is reading the wrong region").toBeGreaterThan(-1);
    const block = code.slice(start, code.indexOf("</Tooltip>", start));
    expect(block).toContain("<PredictCta action={predictAction} />");
    /*
      Inside `predictAction ? …` the value is narrowed, so `predictAction?.x`
      and `?? fallback` can never fire. They are not merely redundant: they read
      as though the contract might be absent, which is the belief that produced
      five loose props in the first place.
    */
    expect(block).not.toContain("predictAction?.");
    expect(block).not.toMatch(/predictAction\.\w+\s*\?\?/);
  });
});

/*
  THE INK ON AN ACCENT FILL.

  Every Predict surface paints on --fp-accent, which is RED in light and GREEN
  in dark and high contrast. A literal white ink is only legible against one of
  those: measured in a real browser it read 4.20 / 2.87 / 1.78, failing 4.5:1 in
  two themes on 14px semibold text. --fp-on-accent flips with the theme and
  reads 4.20 / 6.81 / 11.77.

  Scoped to the surfaces this brief owns. Sixteen other call sites in src/ still
  hardcode white on an accent fill and are recorded as separate, pre-existing
  work — a repo-wide ban here would fail on code this change did not touch.
*/
describe("accent-fill ink is a token, not a literal", () => {
  const OWNED = [
    "../../design-system/Button.tsx",
    "../../design-system/EmptyState.tsx",
    "PredictCta.tsx",
    "ConsumerShell.tsx",
    "CommandPalette.tsx"
  ];

  it("no Predict surface pairs a literal white ink with an accent fill", () => {
    const offenders: string[] = [];
    for (const rel of OWNED) {
      const source = stripComments(readFileSync(join(__dirname, rel), "utf8"));
      for (const cls of source.match(/"[^"]*bg-\[var\(--fp-accent\)\][^"]*"/g) ?? []) {
        if (/\btext-white\b/.test(cls)) offenders.push(`${rel}: ${cls.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the primary button names the theme-flipping ink explicitly", () => {
    const button = stripComments(readFileSync(join(__dirname, "../../design-system/Button.tsx"), "utf8"));
    expect(button).toContain("text-[var(--fp-on-accent)]");
  });
});

/*
  SPREAD THE SURFACE, DO NOT MINE IT.

  `predictSurfaceProps(action)["aria-label"]` type-checks, reads sensibly, and
  is how the palette row ended up with a correct accessible name, no tooltip and
  no state attribute — the factory applied one-sixth of the way. Indexing the
  result is always this mistake: the whole point of the factory is that its
  fields travel together.
*/
describe("the surface factory is spread, never indexed", () => {
  it("no consumer pulls a single field out of predictSurfaceProps", () => {
    const offenders: string[] = [];
    for (const { path, source } of componentSources()) {
      if (path.endsWith("predictState.ts")) continue;
      const hits = stripComments(source).match(/predictSurfaceProps\([^)]*\)\s*(\[|\.)/g) ?? [];
      if (hits.length) offenders.push(`${path}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
