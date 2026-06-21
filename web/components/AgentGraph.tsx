"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
} from "d3-force";
import type { ReplayState } from "@/lib/replay";
import { OUTCOME_COLOR, PALETTE } from "@/lib/palette";
import { usd } from "@/lib/format";

const GW = 960;
const GH = 600;
const CX = GW / 2;
const CY = GH / 2;
const MAX_PATIENTS = 200; // perf cap on leaf nodes
const MAX_PER_PHYS = 6;

export interface GraphPhysician {
  physician_id: string;
  region: string;
  city: string;
  specialty: string;
}

type Kind = "agent" | "physician" | "patient";

interface GNode {
  id: string;
  kind: Kind;
  label: string;
  outcome?: string;
  dollars: number;
  medicated: number;
  funded: boolean;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GLink {
  source: string | GNode;
  target: string | GNode;
  value: number;
  kind: "fund" | "panel";
  lit: boolean;
}

function physRadius(n: GNode): number {
  if (!n.funded) return 2.6;
  return 5 + Math.min(Math.sqrt(n.dollars) * 0.34, 11);
}
function nodeRadius(n: GNode): number {
  if (n.kind === "agent") return 16;
  if (n.kind === "physician") return physRadius(n);
  return 3.4;
}
function nodeColor(n: GNode): string {
  if (n.kind === "agent") return PALETTE.gold;
  if (n.kind === "patient") return OUTCOME_COLOR[n.outcome ?? ""] ?? PALETTE.slate;
  if (!n.funded) return PALETTE.faint;
  return n.medicated > 0 ? PALETTE.emerald : PALETTE.slate;
}

export default function AgentGraph({
  state,
  physicians,
}: {
  state: ReplayState;
  physicians: GraphPhysician[];
}) {
  const reduced = useReducedMotion();
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const firstRun = useRef(true);
  const [, tick] = useReducer((x: number) => x + 1, 0);

  // Ambient physician ring is built once from the full roster; an angle per id
  // gives every physician a stable seat so the network reads as a fixed map.
  const seats = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    physicians.forEach((p, i) => {
      const a = (i / Math.max(physicians.length, 1)) * Math.PI * 2;
      const r = 150 + ((i * 53) % 90); // two loose rings for depth
      m.set(p.physician_id, { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r });
    });
    return m;
  }, [physicians]);

  useEffect(() => {
    // ---- Build desired graph: every physician (ambient) + funded leaves. ----
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: GNode[] = [];
    const links: GLink[] = [];

    const agent: GNode = prev.get("AGENT")
      ? (prev.get("AGENT") as GNode)
      : { id: "AGENT", kind: "agent", label: "AGENT", dollars: 0, medicated: 0, funded: true, x: CX, y: CY };
    agent.fx = CX;
    agent.fy = CY;
    agent.dollars = state.spend;
    agent.medicated = state.medicatedCount;
    nodes.push(agent);

    // Aggregate funded dollars/medicated per physician from the live flows.
    const physAgg = new Map<string, { dollars: number; medicated: number }>();
    for (const f of state.flows) {
      const a = physAgg.get(f.physicianId) ?? { dollars: 0, medicated: 0 };
      a.dollars += f.amount;
      if (f.outcome === "medicated") a.medicated += 1;
      physAgg.set(f.physicianId, a);
    }

    const physNode = new Map<string, GNode>();
    for (const p of physicians) {
      const agg = physAgg.get(p.physician_id);
      const seat = seats.get(p.physician_id)!;
      const old = prev.get(p.physician_id);
      const node: GNode = {
        id: p.physician_id,
        kind: "physician",
        label: p.city.split(",")[0],
        dollars: agg?.dollars ?? 0,
        medicated: agg?.medicated ?? 0,
        funded: !!agg,
        x: old?.x ?? seat.x,
        y: old?.y ?? seat.y,
        vx: old?.vx,
        vy: old?.vy,
      };
      nodes.push(node);
      physNode.set(p.physician_id, node);
      if (agg) {
        links.push({ source: "AGENT", target: p.physician_id, value: agg.dollars, kind: "fund", lit: true });
      }
    }

    // Patient leaves — most-recent funded only, capped per physician + overall.
    const perPhys = new Map<string, number>();
    const recent = state.flows.slice(Math.max(0, state.flows.length - MAX_PATIENTS));
    for (const f of recent) {
      const c = perPhys.get(f.physicianId) ?? 0;
      if (c >= MAX_PER_PHYS) continue;
      perPhys.set(f.physicianId, c + 1);
      const phys = physNode.get(f.physicianId);
      if (!phys) continue;
      const id = `pat:${f.patientId}`;
      const old = prev.get(id);
      nodes.push({
        id,
        kind: "patient",
        label: f.patientId,
        outcome: f.outcome,
        dollars: f.amount,
        medicated: f.outcome === "medicated" ? 1 : 0,
        funded: true,
        x: old?.x ?? phys.x + (Math.random() - 0.5) * 24,
        y: old?.y ?? phys.y + (Math.random() - 0.5) * 24,
        vx: old?.vx,
        vy: old?.vy,
      });
      links.push({ source: f.physicianId, target: id, value: f.amount, kind: "panel", lit: true });
    }

    nodesRef.current = nodes;
    linksRef.current = links;

    let sim = simRef.current;
    if (!sim) {
      sim = forceSimulation<GNode, GLink>()
        .force("charge", forceManyBody<GNode>().strength((n) => ((n as GNode).kind === "physician" ? -34 : -10)))
        .force("radial", forceRadial<GNode>((n) => (n.kind === "physician" ? 210 : n.kind === "patient" ? 250 : 0), CX, CY).strength((n) => (n.kind === "physician" ? 0.55 : 0.04)))
        .force("collide", forceCollide<GNode>((n) => nodeRadius(n) + 1.5))
        .force("link", forceLink<GNode, GLink>().id((n) => n.id).distance((l) => (l.kind === "fund" ? 150 : 16)).strength((l) => (l.kind === "fund" ? 0.04 : 0.7)));
      simRef.current = sim;
    }
    sim.nodes(nodes);
    (sim.force("link") as ReturnType<typeof forceLink<GNode, GLink>>).links(links);

    if (reduced) {
      sim.alpha(1);
      for (let i = 0; i < 140; i++) sim.tick();
      tick();
    } else {
      sim.on("tick", tick);
      // Full settle on first build; gentle nudge thereafter.
      sim.alpha(firstRun.current ? 1 : 0.18).restart();
    }
    firstRun.current = false;

    return () => {
      sim?.on("tick", null);
    };
  }, [state.flows.length, physicians, seats, reduced]);

  useEffect(
    () => () => {
      simRef.current?.stop();
    },
    [],
  );

  const nodes = nodesRef.current;
  const links = linksRef.current;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const resolve = (e: string | GNode): GNode | undefined => (typeof e === "string" ? byId.get(e) : e);

  // Label only the biggest few funded physicians.
  const labelled = new Set(
    [...nodes]
      .filter((n) => n.kind === "physician" && n.funded)
      .sort((a, b) => b.dollars - a.dollars)
      .slice(0, 7)
      .map((n) => n.id),
  );
  const fundedPhys = nodes.filter((n) => n.kind === "physician" && n.funded).length;
  const patientCount = nodes.filter((n) => n.kind === "patient").length;

  return (
    <svg
      viewBox={`0 0 ${GW} ${GH}`}
      role="img"
      aria-label="Agent decision graph"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <g>
        {links.map((l, i) => {
          const s = resolve(l.source);
          const t = resolve(l.target);
          if (!s || !t) return null;
          const stroke = l.kind === "fund" ? PALETTE.gold : OUTCOME_COLOR[(t.outcome as string) ?? ""] ?? PALETTE.slate;
          const w = l.kind === "fund" ? Math.max(0.6, Math.min(Math.sqrt(l.value) * 0.12, 2.6)) : 0.6;
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={stroke}
              strokeWidth={w}
              strokeOpacity={l.kind === "fund" ? 0.32 : 0.22}
              strokeLinecap="round"
            />
          );
        })}
      </g>

      <g>
        {nodes.map((n) => {
          const r = nodeRadius(n);
          const color = nodeColor(n);
          if (n.kind === "agent") {
            return (
              <motion.g
                key={n.id}
                initial={reduced ? false : { scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 16 }}
                style={{ transform: `translate(${n.x}px, ${n.y}px)` }}
              >
                <circle r={r + 7} fill={color} opacity={0.14} />
                <path d="M0 -15 L15 0 L0 15 L-15 0 Z" fill={color} stroke={PALETTE.canvas} strokeWidth={1.5} />
                <text y={30} textAnchor="middle" fontSize={12} fontWeight={700} fill={PALETTE.gold} letterSpacing={2}>
                  AGENT
                </text>
              </motion.g>
            );
          }
          return (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
              <circle
                r={r}
                fill={color}
                fillOpacity={n.kind === "patient" ? 0.95 : n.funded ? 0.85 : 0.5}
                stroke={PALETTE.canvas}
                strokeWidth={n.kind === "patient" ? 0.6 : 0.8}
              />
              {labelled.has(n.id) && (
                <text y={-r - 4} textAnchor="middle" fontSize={8.5} fill={PALETTE.muted} opacity={0.85}>
                  {n.label}
                </text>
              )}
            </g>
          );
        })}
      </g>

      <text x={18} y={GH - 16} fontSize={11} fill={PALETTE.faint}>
        {usd(state.spend, { compact: true })} routed · {fundedPhys} of {physicians.length} physicians funded · {patientCount} patients shown
      </text>
    </svg>
  );
}
