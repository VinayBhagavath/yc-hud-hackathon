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
          strokeWidth={1.4}
          initial={{ r: radius, opacity: 0.6 }}
          animate={{ r: radius * 2.4, opacity: 0 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      {/* soft halo */}
      <circle r={radius + 4} fill={color} opacity={funded ? 0.1 : 0.04} />
      {/* main body */}
      <circle
        r={radius}
        fill={color}
        fillOpacity={funded ? 0.22 : 0.1}
        stroke={color}
        strokeOpacity={funded ? 0.9 : 0.45}
        strokeWidth={1.4}
      />
      {/* core */}
      <circle r={Math.max(radius * 0.32, 2.4)} fill={funded ? color : PALETTE.muted} />
      {/* invisible larger hit area for hover */}
      <circle r={radius + 10} fill="transparent" />
    </g>
  );
}
