"use client";

import { Fragment } from "react";
import type { FlowItem } from "@/lib/replay";
import { arcPath, project, TREASURY } from "@/lib/projection";
import { OUTCOME_COLOR, PALETTE } from "@/lib/palette";

const COLORS = OUTCOME_COLOR;

// How many of the most-recent flows stay "alive" (animated dashes + particle).
const ACTIVE_WINDOW = 4;
// Only the most recent arcs are drawn — older allocations are already conveyed
// by the grown metro dots, so we keep the map calm rather than a web of lines.
const MAX_THREADS = 48;

export default function AllocationFlows({ flows }: { flows: FlowItem[] }) {
  if (flows.length === 0) return null;
  const shown = flows.length > MAX_THREADS ? flows.slice(flows.length - MAX_THREADS) : flows;
  const newestIndex = shown.length - 1;

  return (
    <g>
      {shown.map((flow, i) => {
        const dest = project(flow.lon, flow.lat);
        if (!dest) return null;
        const d = arcPath(TREASURY, dest);
        const color = COLORS[flow.outcome] ?? PALETTE.slate;
        const recency = newestIndex - i; // 0 = newest
        const isActive = recency < ACTIVE_WINDOW;
        // Thin, low-contrast threads that fade quickly into the background.
        const baseOpacity = isActive ? 0.6 - recency * 0.12 : Math.max(0.08 - (recency - ACTIVE_WINDOW) * 0.0015, 0.04);
        const width = isActive ? 1.4 - recency * 0.2 : 0.7;

        return (
          <Fragment key={flow.key}>
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={Math.max(width, 0.6)}
              strokeOpacity={baseOpacity}
              strokeLinecap="round"
            />
            {isActive && (
              <path
                className="flow-anim"
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={Math.max(width, 0.6)}
                strokeOpacity={0.7}
                strokeLinecap="round"
                strokeDasharray="2 16"
                style={{ animation: "flow-dash 1.1s linear infinite" }}
              />
            )}
            {recency === 0 && (
              <circle r={2.6} fill={PALETTE.gold}>
                <animateMotion dur="1.1s" repeatCount="indefinite" path={d} />
              </circle>
            )}
          </Fragment>
        );
      })}
    </g>
  );
}
