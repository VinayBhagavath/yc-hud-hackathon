"use client";

import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import statesTopo from "us-atlas/states-10m.json";
import { motion } from "framer-motion";
import type { ReplayState } from "@/lib/replay";
import { MAP_HEIGHT, MAP_WIDTH, project, projection, TREASURY } from "@/lib/projection";
import { usd } from "@/lib/format";
import AllocationFlows from "./AllocationFlows";
import RegionNode from "./RegionNode";

export interface BaseRegion {
  region: string;
  city: string;
  lat: number;
  lon: number;
  panel: number;
}

interface NodeDatum {
  region: string;
  city: string;
  x: number;
  y: number;
  radius: number;
  spend: number;
  funded: number;
  medicated: number;
  people: number;
  panel: number;
  color: string;
  active: boolean;
}

function radiusFor(spend: number): number {
  return 7 + Math.min(Math.sqrt(spend) * 0.72, 26);
}

export default function UsMap({
  state,
  baseRegions,
}: {
  state: ReplayState;
  baseRegions: BaseRegion[];
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const activeRegion =
    state.flows.length > 0 ? state.flows[state.flows.length - 1].region : null;

  const nodes = useMemo<NodeDatum[]>(() => {
    const liveByRegion = new Map(state.byRegion.map((r) => [r.region, r]));
    const out: NodeDatum[] = [];
    for (const base of baseRegions) {
      const xy = project(base.lon, base.lat);
      if (!xy) continue;
      const live = liveByRegion.get(base.region);
      const spend = live?.spend ?? 0;
      const medicated = live?.medicated ?? 0;
      const funded = live?.funded ?? 0;
      const color = funded === 0 ? "#5a6072" : medicated > 0 ? "#34d399" : "#7c8499";
      out.push({
        region: base.region,
        city: base.city,
        x: xy.x,
        y: xy.y,
        radius: radiusFor(spend),
        spend,
        funded,
        medicated,
        people: live?.people ?? 0,
        panel: base.panel,
        color,
        active: base.region === activeRegion,
      });
    }
    return out;
  }, [baseRegions, state.byRegion, activeRegion]);

  const hoveredNode = nodes.find((n) => n.region === hovered) ?? null;

  return (
    <ComposableMap
      // d3 GeoProjection instance is accepted at runtime; its call overloads
      // just don't line up with react-simple-maps' ProjectionFunction type.
      projection={projection as never}
      width={MAP_WIDTH}
      height={MAP_HEIGHT}
      style={{ width: "100%", height: "auto" }}
    >
      <Geographies geography={statesTopo as object}>
        {({ geographies }) =>
          geographies.map((geo) => (
            <Geography
              key={geo.rsmKey}
              geography={geo}
              style={{
                default: {
                  fill: "#10131c",
                  stroke: "#222a3b",
                  strokeWidth: 0.5,
                  outline: "none",
                  pointerEvents: "none",
                },
                hover: { fill: "#10131c", outline: "none" },
                pressed: { fill: "#10131c", outline: "none" },
              }}
            />
          ))
        }
      </Geographies>

      {/* Allocation flow lines (treasury -> regions). */}
      <AllocationFlows flows={state.flows} />

      {/* Treasury / agent node. */}
      <g transform={`translate(${TREASURY.x} ${TREASURY.y})`}>
        <motion.circle
          r={10}
          fill="none"
          stroke="#34d399"
          strokeWidth={1.4}
          initial={{ r: 10, opacity: 0.5 }}
          animate={{ r: 26, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
        />
        <circle r={9} fill="#0f1f1a" stroke="#34d399" strokeWidth={1.6} />
        <path d="M -3.4 0 L 0 -4.2 L 3.4 0 L 0 4.2 Z" fill="#34d399" />
        <text
          y={26}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="#8a91a6"
          letterSpacing={1.5}
        >
          AGENT
        </text>
      </g>

      {/* Region nodes. */}
      {nodes.map((node) => (
        <RegionNode
          key={node.region}
          x={node.x}
          y={node.y}
          radius={node.radius}
          color={node.color}
          active={node.active}
          funded={node.funded > 0}
          onEnter={() => setHovered(node.region)}
          onLeave={() => setHovered((h) => (h === node.region ? null : h))}
        />
      ))}

      {/* SVG tooltip (kept inside the projection so it scales with the map). */}
      {hoveredNode && <Tooltip node={hoveredNode} />}
    </ComposableMap>
  );
}

function Tooltip({ node }: { node: NodeDatum }) {
  const w = 188;
  const lineH = 18;
  const rows: [string, string][] = [
    ["People funded", `${node.people} / ${node.panel}`],
    ["Allocated", usd(node.spend)],
    ["Medicated", `${node.medicated}`],
  ];
  const h = 30 + rows.length * lineH + 8;
  // Clamp so the card stays on-canvas.
  let tx = node.x + node.radius + 12;
  if (tx + w > MAP_WIDTH) tx = node.x - node.radius - 12 - w;
  let ty = node.y - h / 2;
  ty = Math.max(8, Math.min(ty, MAP_HEIGHT - h - 8));

  return (
    <g transform={`translate(${tx} ${ty})`} pointerEvents="none">
      <rect
        width={w}
        height={h}
        rx={10}
        fill="#0d0f16"
        stroke="#2a3142"
        strokeWidth={1}
        opacity={0.98}
      />
      <text x={14} y={22} fontSize={13} fontWeight={700} fill="#e8ecf4">
        {node.region}
      </text>
      <text x={14} y={22} fontSize={13} fill="#e8ecf4" textAnchor="end" dx={w - 14}>
        <tspan fontSize={10} fill="#8a91a6">
          {node.city.split(",")[1]?.trim() ?? ""}
        </tspan>
      </text>
      {rows.map(([label, value], i) => (
        <g key={label} transform={`translate(0 ${36 + i * lineH})`}>
          <text x={14} fontSize={11} fill="#8a91a6">
            {label}
          </text>
          <text
            x={w - 14}
            fontSize={11.5}
            fill="#e8ecf4"
            textAnchor="end"
            fontFamily="var(--font-mono)"
          >
            {value}
          </text>
        </g>
      ))}
    </g>
  );
}
