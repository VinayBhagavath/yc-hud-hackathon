"use client";

import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import statesTopo from "us-atlas/states-10m.json";
import { motion, useReducedMotion } from "framer-motion";
import type { ReplayState } from "@/lib/replay";
import { MAP_HEIGHT, MAP_WIDTH, project, projection, TREASURY } from "@/lib/projection";
import { usd } from "@/lib/format";
import { PALETTE } from "@/lib/palette";
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
  const reduced = useReducedMotion();

  const newestFlow = state.flows.length > 0 ? state.flows[state.flows.length - 1] : null;
  const activeRegion = newestFlow?.region ?? null;

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
      const color =
        funded === 0 ? PALETTE.faint : medicated > 0 ? PALETTE.emerald : PALETTE.slate;
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

  // One-shot bloom when the newest flow resolves to a medication.
  const bloom =
    newestFlow && newestFlow.outcome === "medicated"
      ? (() => {
          const xy = project(newestFlow.lon, newestFlow.lat);
          return xy ? { key: newestFlow.key, ...xy } : null;
        })()
      : null;

  return (
    <div className="relative">
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
                    fill: PALETTE.canvas2,
                    stroke: PALETTE.hairline,
                    strokeWidth: 0.6,
                    outline: "none",
                    pointerEvents: "none",
                  },
                  hover: { fill: PALETTE.canvas2, outline: "none" },
                  pressed: { fill: PALETTE.canvas2, outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {/* Allocation flow lines (treasury -> regions). */}
        <AllocationFlows flows={state.flows} />

        {/* Medication bloom — a gold→emerald ring at the converting region. */}
        {bloom && (
          <g key={bloom.key} transform={`translate(${bloom.x} ${bloom.y})`}>
            <motion.circle
              fill="none"
              stroke={PALETTE.gold}
              strokeWidth={2}
              initial={{ r: 6, opacity: 0.95 }}
              animate={{ r: 40, opacity: 0 }}
              transition={{ duration: 1.1, ease: "easeOut" }}
            />
            <motion.circle
              fill={PALETTE.emerald}
              initial={{ r: 4, opacity: 0.6 }}
              animate={{ r: 16, opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          </g>
        )}

        {/* Treasury anchor — the gold agent core is an HTML overlay (below) so it
            can share a layoutId with the cold-open. Here we just draw the faint
            seat the arcs fan out from. */}
        <g transform={`translate(${TREASURY.x} ${TREASURY.y})`}>
          {!reduced && (
            <motion.circle
              r={10}
              fill="none"
              stroke={PALETTE.gold}
              strokeWidth={1.2}
              initial={{ r: 10, opacity: 0.45 }}
              animate={{ r: 30, opacity: 0 }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          <text
            y={30}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill={PALETTE.gold}
            letterSpacing={2}
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

        {hoveredNode && <Tooltip node={hoveredNode} />}
      </ComposableMap>

      {/* Gold agent core — HTML overlay positioned over TREASURY. Shares
          layoutId="agent-core" with the cold-open for a seamless morph. */}
      <motion.div
        layoutId="agent-core"
        className="pointer-events-none absolute flex h-7 w-7 items-center justify-center rounded-full bg-gold text-canvas shadow-gold"
        // Centre with negative margins, not transform — framer-motion drives the
        // layout transform during the morph and would clobber a CSS translate.
        style={{
          left: `${(TREASURY.x / MAP_WIDTH) * 100}%`,
          top: `${(TREASURY.y / MAP_HEIGHT) * 100}%`,
          marginLeft: -14,
          marginTop: -14,
        }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M8 1 L15 8 L8 15 L1 8 Z" />
        </svg>
      </motion.div>
    </div>
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
        fill={PALETTE.canvas}
        stroke={PALETTE.hairline}
        strokeWidth={1}
        opacity={0.98}
      />
      <text x={14} y={22} fontSize={13} fontWeight={700} fill={PALETTE.ink}>
        {node.region}
      </text>
      <text x={14} y={22} fontSize={13} fill={PALETTE.ink} textAnchor="end" dx={w - 14}>
        <tspan fontSize={10} fill={PALETTE.muted}>
          {node.city.split(",")[1]?.trim() ?? ""}
        </tspan>
      </text>
      {rows.map(([label, value], i) => (
        <g key={label} transform={`translate(0 ${36 + i * lineH})`}>
          <text x={14} fontSize={11} fill={PALETTE.muted}>
            {label}
          </text>
          <text
            x={w - 14}
            fontSize={11.5}
            fill={PALETTE.ink}
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
