import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * The 2026-08 lint-zero pass cleared the historical warning backlog (695 → 0:
 * stage-file import/local cleanup, dead stores, catch-any typing), so every
 * enabled rule now runs at error severity and `npm run lint` gates with
 * --max-warnings 0. Add new rules at "warn" first only while burning down
 * their findings, then promote.
 *
 * no-constant-binary-expression is not a stylistic pick: it's what caught a
 * live bug in AutoCalibrationEngine.js where `Number(x) ?? DEFAULT` silently
 * never fell through to the default (Number(undefined) is NaN, not nullish).
 */
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "docs/**",
      "backups/**",
      // Local Playwright artifacts (gitignored; a stale local report must not break lint).
      "playwright-report/**",
      "test-results/**",
      "supabase/**",
      "public/**",
      "server-utils/context/**",
      // Vendored AI-assistant tooling, not project code — the moral equivalent of
      // node_modules. Mostly gitignored, so CI never saw it; locally it drowned the
      // real signal in 6,739 third-party errors (browser-context skill scripts,
      // CommonJS) while the project itself linted clean of errors. Ignoring it
      // restores local/CI parity. Deliberately NOT ".github/**": a future action
      // script of our own must stay linted.
      ".agents/**",
      ".claude/**",
      ".github/skills/**",
      ".github/agents/**",
      "ui-ux-pro-max-skill/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-undef": "error",
      "no-constant-binary-expression": "error",

      // Underscore prefixes and rest-sibling omission are the deliberate
      // "intentionally unused" convention this codebase already follows
      // (interface params, JSDoc'd stubs, { omitted, ...rest } destructuring) —
      // the options below are the typescript-eslint-documented way to encode it.
      "@typescript-eslint/no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-useless-assignment": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-expressions": "error",
      "no-unused-expressions": "error"
    }
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser }
    },
    rules: {
      // TS ambient/lib types (RequestInfo, RequestInit, etc.) aren't runtime
      // globals, so plain no-undef false-positives on them; tsc already covers
      // this, and better, via the typecheck script.
      "no-undef": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    files: ["server-utils/**/*.js", "api/**/*.js", "scripts/**/*.{js,mjs}", "tests/**/*.js"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    // E2E specs and the Playwright config run under Node but are TS files
    // outside src/, so they get node globals with no-undef kept ON — unlike
    // src/**, they are not covered by the tsc typecheck project, so the rule
    // still has real work to do here.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
];
