/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        signal: {
          void: "#06080d",
          mist: "#0a0e14",
          fog: "#0f1419",
          bone: "#151d28",
          panel: "#1a2432",
          panelHi: "#1f2d3f",
          stone: "#475569",
          petrol: "#38bdf8",
          petrolMuted: "#22d3ee",
          petrolDeep: "#0284c7",
          sage: "#34d399",
          mint: "#5eead4",
          mintSoft: "rgba(94, 234, 212, 0.12)",
          amber: "#fbbf24",
          amberSoft: "#fcd34d",
          rose: "#fb7185",
          ink: "#f1f5f9",
          inkMuted: "#94a3b8",
          silver: "#cbd5e1",
          line: "rgba(56, 189, 248, 0.14)",
          glow: "rgba(56, 189, 248, 0.12)"
        }
      },
      fontFamily: {
        display: ["Syne", "system-ui", "sans-serif"],
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"]
      },
      boxShadow: {
        atelier: "0 4px 32px rgba(0, 0, 0, 0.45), 0 0 1px rgba(56, 189, 248, 0.2)",
        atelierLg: "0 12px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(56, 189, 248, 0.08)",
        innerSoft: "inset 0 1px 0 rgba(255,255,255,0.06)",
        frost: "0 0 40px rgba(56, 189, 248, 0.12), 0 0 80px rgba(52, 211, 153, 0.06)"
      },
      backgroundImage: {
        "lab-mesh":
          "radial-gradient(ellipse 120% 80% at 10% -20%, rgba(56, 189, 248, 0.14), transparent 50%), radial-gradient(ellipse 80% 50% at 90% 0%, rgba(52, 211, 153, 0.08), transparent 45%), radial-gradient(ellipse 60% 40% at 50% 100%, rgba(14, 165, 233, 0.06), transparent 50%)",
        "lab-grid":
          "linear-gradient(rgba(56,189,248,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.04) 1px, transparent 1px)",
        "lab-scan": "linear-gradient(180deg, transparent, rgba(56,189,248,0.03), transparent)"
      },
      backgroundSize: {
        grid: "32px 32px"
      },
      transitionDuration: {
        atelier: "280ms"
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" }
        },
        "stagger-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" }
        }
      },
      animation: {
        "pulse-soft": "pulse-soft 3s ease-in-out infinite",
        "stagger-in": "stagger-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 8s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
