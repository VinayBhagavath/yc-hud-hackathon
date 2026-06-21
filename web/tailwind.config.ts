import type { Config } from "tailwindcss";

// "Clinical Oil Painting" palette — warm, muted gallery tones. The chrome is
// painterly; the data stays crisp. Keep the set tight: canvas, surface, ink,
// emerald (medicated), gold (the agent), slate (funded · no convert).
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Canvas / surfaces — aged warm charcoal, not blue-black.
        canvas: "#15120c",
        "canvas-2": "#1b1710",
        surface: "#221d15",
        "surface-2": "#2a2418",
        hairline: "#3a3122",
        // Ink — warm off-white text.
        ink: "#ece3d1",
        muted: "#a99c81",
        faint: "#756a54",
        // Pigments.
        emerald: "#3fa882", // viridian — success / medicated
        "emerald-deep": "#1c4d3e",
        gold: "#c9a35b", // gold-leaf — the agent
        "gold-deep": "#6b5424",
        slate: "#828a96", // desaturated — funded · no convert
        organic: "#cf9a4a", // muted amber — organic conversions
        danger: "#cf6f57",

        // ---- Legacy aliases so older class names keep resolving ----
        panel: "#221d15",
        "panel-2": "#2a2418",
        money: "#3fa882",
        "money-dim": "#1c4d3e",
        skip: "#828a96",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Fraunces", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        placard: "0.18em",
      },
      boxShadow: {
        // Framed-canvas card: inner top highlight + soft long shadow.
        panel:
          "inset 0 1px 0 0 rgba(236,227,209,0.06), 0 18px 50px -24px rgba(0,0,0,0.85)",
        glow: "0 0 0 1px rgba(63,168,130,0.30), 0 0 26px -4px rgba(63,168,130,0.45)",
        gold: "0 0 0 1px rgba(201,163,91,0.35), 0 0 30px -4px rgba(201,163,91,0.50)",
      },
      keyframes: {
        "flow-dash": {
          to: { strokeDashoffset: "-1000" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.8)", opacity: "0.8" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        bloom: {
          "0%": { transform: "scale(0.6)", opacity: "0.9" },
          "100%": { transform: "scale(3)", opacity: "0" },
        },
        "ink-bleed": {
          "0%": { opacity: "0", filter: "blur(8px)", transform: "translateY(6px)" },
          "100%": { opacity: "1", filter: "blur(0)", transform: "translateY(0)" },
        },
        "gold-sweep": {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(220%)" },
        },
      },
      animation: {
        "ink-bleed": "ink-bleed 0.7s ease-out both",
        "gold-sweep": "gold-sweep 1.1s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
