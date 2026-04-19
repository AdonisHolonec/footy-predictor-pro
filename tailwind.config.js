/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        signal: {
          bone: "#ebe6de",
          fog: "#e2dcd2",
          mist: "#f7f4ee",
          stone: "#b8aea0",
          petrol: "#0c302c",
          petrolMuted: "#134842",
          petrolDeep: "#082220",
          sage: "#6d8f7e",
          mint: "#a8c4b8",
          mintSoft: "#c5ddd0",
          amber: "#9a7218",
          amberSoft: "#c9a04a",
          rose: "#a86b70",
          ink: "#25221e",
          inkMuted: "#5c574e",
          line: "rgba(12, 48, 44, 0.08)"
        }
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"]
      },
      boxShadow: {
        atelier: "0 4px 24px rgba(12, 48, 44, 0.07), 0 12px 48px rgba(12, 48, 44, 0.06)",
        atelierLg: "0 8px 40px rgba(12, 48, 44, 0.1), 0 2px 8px rgba(12, 48, 44, 0.04)",
        innerSoft: "inset 0 1px 0 rgba(255,255,255,0.65)"
      },
      backgroundImage: {
        "signal-noise":
          "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(168, 196, 184, 0.35), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(196, 169, 74, 0.12), transparent 50%)",
        "signal-grid":
          "linear-gradient(rgba(12,48,44,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(12,48,44,0.04) 1px, transparent 1px)"
      },
      backgroundSize: {
        grid: "24px 24px"
      },
      transitionDuration: {
        atelier: "220ms"
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.72" }
        },
        "stagger-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        "pulse-soft": "pulse-soft 2.8s ease-in-out infinite",
        "stagger-in": "stagger-in 0.45s ease-out both"
      }
    }
  },
  plugins: []
};
