import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  /** Include CSS that uses @apply so JIT emits theme utilities. */
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx,css}"],
  theme: {
    /* xs was already a real breakpoint — max-[380px]: appeared 29 times across
       MatchCard/MatchModal before PR 3 declared it. Making it official turns
       the magic number into `max-xs:` and keeps the set closed: no other new
       breakpoints. Spread first so xs sorts before sm in the cascade. */
    screens: {
      xs: "380px",
      ...defaultTheme.screens
    },
    extend: {
      /**
       * Semantic colours as first-class Tailwind colours.
       *
       * Tailwind 3.4 silently DROPS any `<util>-[var(--fp-x)]/NN` class — an
       * opacity modifier cannot be composed onto an arbitrary var() colour, so
       * ~600 semantic tints across the app produced no CSS at all (borders fell
       * back to preflight grey, tinted panels had no background). Registering
       * each token as `rgb(var(--fp-x-rgb) / <alpha-value>)` is the root fix:
       * `bg-fp-danger/10` now emits exactly the 10% tint the code intended, and
       * every future opacity works without new tokens. The `--fp-*-rgb`
       * triplets live in design-system/tokens.css next to their hex twins, per
       * theme; a guard test (tokens.guard.test.ts) keeps the two in sync.
       *
       * Plain `text-[var(--fp-x)]` classes (no modifier) still work and are
       * untouched — only the broken `/NN` spellings were migrated.
       */
      colors: {
        "fp-bg": "rgb(var(--fp-bg-rgb) / <alpha-value>)",
        "fp-bg-elevated": "rgb(var(--fp-bg-elevated-rgb) / <alpha-value>)",
        "fp-bg-card": "rgb(var(--fp-bg-card-rgb) / <alpha-value>)",
        "fp-bg-muted": "rgb(var(--fp-bg-muted-rgb) / <alpha-value>)",
        "fp-navy": "rgb(var(--fp-navy-rgb) / <alpha-value>)",
        "fp-accent": "rgb(var(--fp-accent-rgb) / <alpha-value>)",
        "fp-accent-hover": "rgb(var(--fp-accent-hover-rgb) / <alpha-value>)",
        "fp-accent-text": "rgb(var(--fp-accent-text-rgb) / <alpha-value>)",
        "fp-purple": "rgb(var(--fp-purple-rgb) / <alpha-value>)",
        "fp-text": "rgb(var(--fp-text-rgb) / <alpha-value>)",
        "fp-text-muted": "rgb(var(--fp-text-muted-rgb) / <alpha-value>)",
        "fp-text-faint": "rgb(var(--fp-text-faint-rgb) / <alpha-value>)",
        "fp-success": "rgb(var(--fp-success-rgb) / <alpha-value>)",
        "fp-danger": "rgb(var(--fp-danger-rgb) / <alpha-value>)",
        "fp-warning": "rgb(var(--fp-warning-rgb) / <alpha-value>)",
        "fp-live": "rgb(var(--fp-live-rgb) / <alpha-value>)",
        "fp-value": "rgb(var(--fp-value-rgb) / <alpha-value>)"
      },
      fontFamily: {
        display: ["Archivo", "system-ui", "sans-serif"],
        sans: ["Archivo", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"]
      },
      borderRadius: {
        card: "0.875rem",
        "card-lg": "1.125rem"
      },
      boxShadow: {
        /**
         * Token-backed elevation. `shadow-[var(--fp-shadow-sm)]` never worked:
         * Tailwind parses a bare var() arbitrary value as a shadow COLOUR
         * (`--tw-shadow-color`), leaving `--tw-shadow` at `0 0 #0000` — so all
         * 68 call sites rendered no shadow. Named shadows pass the token
         * through as the full box-shadow definition, exactly as authored in
         * tokens.css, per theme.
         */
        "fp-sm": "var(--fp-shadow-sm)",
        fp: "var(--fp-shadow)",
        "fp-lg": "var(--fp-shadow-lg)",
        atelier: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 28px rgba(0, 0, 0, 0.28)",
        atelierLg: "0 1px 0 rgba(255,255,255,0.05) inset, 0 16px 40px rgba(0, 0, 0, 0.35)",
        innerSoft: "inset 0 1px 0 rgba(255,255,255,0.05)",
        frost: "0 10px 32px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(62, 207, 191, 0.12)",
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 16px rgba(0, 0, 0, 0.22)",
        "card-hover": "0 1px 0 rgba(255,255,255,0.06) inset, 0 12px 36px rgba(0, 0, 0, 0.38)"
      },
      backgroundImage: {
        "lab-mesh":
          "radial-gradient(ellipse 90% 50% at 0% 0%, rgba(62, 207, 191, 0.07), transparent 50%), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(61, 214, 140, 0.05), transparent 45%)",
        "lab-grid":
          "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
        "lab-scan": "linear-gradient(180deg, transparent, rgba(62,207,191,0.02), transparent)"
      },
      backgroundSize: {
        grid: "40px 40px"
      },
      transitionDuration: {
        atelier: "240ms"
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" }
        },
        "orb-breathe": {
          "0%, 100%": { transform: "translate(-50%, -50%) scale(1)" },
          "50%": { transform: "translate(-50%, -50%) scale(1.035)" }
        },
        "stagger-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" }
        },
        "card-in": {
          from: { opacity: "0", transform: "translateY(12px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" }
        }
      },
      animation: {
        "pulse-soft": "pulse-soft 3s ease-in-out infinite",
        "orb-breathe": "orb-breathe 2.6s ease-in-out infinite",
        "stagger-in": "stagger-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 8s ease-in-out infinite",
        "card-in": "card-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both"
      }
    }
  },
  plugins: [
    // `hover-fine:` — real mouse hover only, gated behind (hover:hover) and (pointer:fine).
    // Plain `hover:` also fires on touch (tap), which can leave translate/shadow "stuck"
    // until the next tap elsewhere. Use on primary tap targets.
    ({ addVariant }) => {
      addVariant("hover-fine", "@media (hover: hover) and (pointer: fine) { &:hover }");
    }
  ]
};
