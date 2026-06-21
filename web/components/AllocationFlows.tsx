"use client";

import { Fragment } from "react";
import type { FlowItem } from "@/lib/replay";
import { arcPath, project, TREASURY } from "@/lib/projection";
import { OUTCOME_COLOR, PALETTE } from "@/lib/palette";

const COLORS = OUTCOME_COLOR;

// How many of the most-recent flows stay "alive" (animated dashes + particle).
const ACTIVE_WINDOW = 5;
// Cap rendered threads so hundreds of allocations stay smooth — older arcs are
// already "remembered" by the grown region nodes underneath.
const MAX_THREADS = 120;

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
        // Older flows fade to faint persistent threads.
        const baseOpacity = isActive ? 0.95 - recency * 0.18 : 0.16;
        const width = isActive ? 2.2 - recency * 0.35 : 1;

        return (
          <Fragment key={flow.key}>
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={Math.max(width, 0.8)}
              strokeOpacity={baseOpacity}
              strokeLinecap="round"
            />
            {isActive && (
              <path
                className="flow-anim"
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={Math.max(width, 0.8)}
                strokeOpacity={0.9}
                strokeLinecap="round"
                strokeDasharray="2 16"
                style={{
                  animation: "flow-dash 1.1s linear infinite",
                }}
              />
            )}
            {recency === 0 && (
              <circle r={3.4} fill={PALETTE.gold}>
                <animateMotion dur="1.1s" repeatCount="indefinite" path={d} />
              </circle>
            )}
          </Fragment>
        );
      })}
    </g>
  );
}
