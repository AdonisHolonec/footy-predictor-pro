/** @type {import('tailwindcss').Config} */
export default {
  /** Include CSS that uses @apply so JIT emits theme utilities. */
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx,css}"],
  theme: {
    extend: {
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
        "stagger-in": "stagger-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 8s ease-in-out infinite",
        "card-in": "card-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both"
      }
    }
  },
  plugins: []
};
