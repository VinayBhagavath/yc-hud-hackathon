// Single source of truth for the hex values used inside SVG / canvas / recharts,
// where Tailwind class tokens can't reach. Mirrors tailwind.config.ts so there
// are no stray hardcoded colors scattered through components.
export const PALETTE = {
  canvas: "#15120c",
  canvas2: "#1b1710",
  surface: "#221d15",
  surface2: "#2a2418",
  hairline: "#3a3122",
  ink: "#ece3d1",
  muted: "#a99c81",
  faint: "#756a54",
  emerald: "#3fa882", // medicated
  emeraldDeep: "#1c4d3e",
  gold: "#c9a35b", // the agent
  goldDeep: "#6b5424",
  slate: "#828a96", // funded · no convert
  organic: "#cf9a4a", // organic conversions
  danger: "#cf6f57",
} as const;

// Outcome → pigment. Used by the map arcs, region nodes, and the agent graph so
// the colour story is identical everywhere.
export const OUTCOME_COLOR: Record<string, string> = {
  medicated: PALETTE.emerald,
  undermedicated: PALETTE.slate,
  organic_medicated: PALETTE.organic,
};
