"use client";

import { motion, useReducedMotion } from "framer-motion";
import { PALETTE } from "@/lib/palette";

export interface RegionNodeProps {
  x: number;
  y: number;
  radius: number;
  color: string;
  active: boolean;
  funded: boolean;
  onEnter: () => void;
  onLeave: () => void;
}

// A clean, restrained metro dot: a solid filled circle (no piled-up halos), a
// thin dark seam to separate overlapping neighbours, and a single quiet pulse
// only on the most recent allocation.
export default function RegionNode({
  x,
  y,
  radius,
  color,
  active,
  funded,
  onEnter,
  onLeave,
}: RegionNodeProps) {
  const reduced = useReducedMotion();
  return (
    <g
      transform={`translate(${x} ${y})`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ cursor: "pointer" }}
    >
      {active && !reduced && (
        <motion.circle
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={1.2}
          initial={{ r: radius, opacity: 0.55 }}
          animate={{ r: radius * 2.2, opacity: 0 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      {funded ? (
        <circle
          r={radius}
          fill={color}
          fillOpacity={0.9}
          stroke={PALETTE.canvas}
          strokeWidth={0.8}
        />
      ) : (
        // Ambient, unfunded metro — a faint speck that shapes the country.
        <circle r={radius} fill={PALETTE.faint} fillOpacity={0.5} />
      )}
      {/* Larger invisible hit area for hover. */}
      <circle r={radius + 9} fill="transparent" />
    </g>
  );
}
