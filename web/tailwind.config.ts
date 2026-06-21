import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#0a0b0f",
        panel: "#11131a",
        "panel-2": "#161922",
        hairline: "#222634",
        ink: "#e8ecf4",
        muted: "#8a91a6",
        faint: "#5a6072",
        money: "#34d399", // emerald — funded / medicated
        "money-dim": "#0f3d31",
        organic: "#fbbf24", // amber — organic conversions
        skip: "#475069", // muted — skipped
        danger: "#f87171",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(52,211,153,0.25), 0 0 24px -4px rgba(52,211,153,0.45)",
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 40px -16px rgba(0,0,0,0.8)",
      },
      keyframes: {
        "flow-dash": {
          to: { strokeDashoffset: "-1000" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.8)", opacity: "0.8" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
