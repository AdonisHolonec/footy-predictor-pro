import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * Deliberately narrow rule set for a first ESLint pass on a codebase that has
 * never been linted before. `no-unused-vars` alone produces 600+ hits (mostly
 * server-utils/pipeline/stages/*, which import a shared ~90-line dependency
 * list per stage regardless of use — a known, separately-tracked cleanup, not
 * something to force through a lint gate). Rather than block CI on a wall of
 * pre-existing noise, only rules that have demonstrated real bug-catching
 * value here are errors; everything else reports as a warning so it's visible
 * without breaking builds. Tighten this incrementally as the noisy rules get
 * addressed on their own schedule.
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

      "@typescript-eslint/no-unused-vars": "warn",
      "no-useless-assignment": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-unused-expressions": "warn"
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
  }
];
