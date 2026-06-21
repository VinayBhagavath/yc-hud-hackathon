"use client";

import { useEffect, useReducer, useRef } from "react";
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

const GW = 900;
const GH = 560;
const CX = GW / 2;
const CY = GH / 2;

type Kind = "agent" | "physician" | "patient";

interface GNode {
  id: string;
  kind: Kind;
  label: string;
  outcome?: string;
  dollars: number;
  medicated: number;
  // d3-force mutates these in place.
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  born: number; // event ordinal — newest pop in
}

interface GLink {
  source: string | GNode;
  target: string | GNode;
  value: number;
  kind: "fund" | "panel"; // agent→physician | physician→patient
}

const RADIUS_BY_KIND: Record<Kind, number> = { agent: 0, physician: 150, patient: 270 };

function nodeRadius(n: GNode): number {
  if (n.kind === "agent") return 16;
  if (n.kind === "physician") return 7 + Math.min(Math.sqrt(n.dollars) * 0.4, 9);
  return 4.5;
}

function nodeColor(n: GNode): string {
  if (n.kind === "agent") return PALETTE.gold;
  if (n.kind === "patient") return OUTCOME_COLOR[n.outcome ?? ""] ?? PALETTE.slate;
  return n.medicated > 0 ? PALETTE.emerald : PALETTE.slate;
}

// Build the desired graph (cumulative) from the replay flows.
function deriveGraph(state: ReplayState): { nodes: GNode[]; links: GLink[] } {
  const nodes = new Map<string, GNode>();
  const links: GLink[] = [];
  nodes.set("AGENT", {
    id: "AGENT",
    kind: "agent",
    label: "AGENT",
    dollars: state.spend,
    medicated: state.medicatedCount,
    x: CX,
    y: CY,
    fx: CX,
    fy: CY,
    born: -1,
  });

  const physLink = new Map<string, GLink>();
  state.flows.forEach((f, i) => {
    const physId = `phys:${f.physicianId}`;
    let phys = nodes.get(physId);
    if (!phys) {
      phys = {
        id: physId,
        kind: "physician",
        label: f.city.split(",")[0],
        dollars: 0,
        medicated: 0,
        x: CX + (Math.random() - 0.5) * 40,
        y: CY + (Math.random() - 0.5) * 40,
        born: i,
      };
      nodes.set(physId, phys);
    }
    phys.dollars += f.amount;
    if (f.outcome === "medicated") phys.medicated += 1;

    let pl = physLink.get(physId);
    if (!pl) {
      pl = { source: "AGENT", target: physId, value: 0, kind: "fund" };
      physLink.set(physId, pl);
      links.push(pl);
    }
    pl.value += f.amount;

    const patId = `pat:${f.patientId}`;
    if (!nodes.has(patId)) {
      nodes.set(patId, {
        id: patId,
        kind: "patient",
        label: f.patientId,
        outcome: f.outcome,
        dollars: f.amount,
        medicated: f.outcome === "medicated" ? 1 : 0,
        x: phys.x + (Math.random() - 0.5) * 30,
        y: phys.y + (Math.random() - 0.5) * 30,
        born: i,
      });
      links.push({ source: physId, target: patId, value: f.amount, kind: "panel" });
    }
  });

  return { nodes: [...nodes.values()], links };
}

export default function AgentGraph({ state }: { state: ReplayState }) {
  const reduced = useReducedMotion();
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const [, tick] = useReducer((x: number) => x + 1, 0);

  // Reconcile the simulation whenever the flow set changes (length is a stable
  // proxy — flows only ever grows/resets as the scrubber moves).
  useEffect(() => {
    const desired = deriveGraph(state);
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));

    // Carry over live positions/velocities for nodes that already exist.
    const nodes = desired.nodes.map((n) => {
      const old = prev.get(n.id);
      if (old) {
        return { ...n, x: old.x, y: old.y, vx: old.vx, vy: old.vy };
      }
      return n;
    });
    nodesRef.current = nodes;
    linksRef.current = desired.links;

    let sim = simRef.current;
    if (!sim) {
      sim = forceSimulation<GNode, GLink>()
        .force("charge", forceManyBody<GNode>().strength(-55))
        .force(
          "radial",
          forceRadial<GNode>((n) => RADIUS_BY_KIND[n.kind], CX, CY).strength(0.32),
        )
        .force(
          "collide",
          forceCollide<GNode>((n) => nodeRadius(n) + 3),
        );
      sim.force(
        "link",
        forceLink<GNode, GLink>()
          .id((n) => n.id)
          .distance((l) => (l.kind === "fund" ? 130 : 46))
          .strength(0.5),
      );
      simRef.current = sim;
    }

    sim.nodes(nodes);
    (sim.force("link") as ReturnType<typeof forceLink<GNode, GLink>>).links(desired.links);

    if (reduced) {
      // Settle synchronously, no per-tick re-render.
      sim.alpha(1);
      for (let i = 0; i < 120; i++) sim.tick();
      tick();
    } else {
      sim.on("tick", tick);
      sim.alpha(0.9).restart();
    }

    return () => {
      sim?.on("tick", null);
    };
  }, [state.flows.length, reduced]);

  // Stop the simulation when this view unmounts entirely.
  useEffect(
    () => () => {
      simRef.current?.stop();
    },
    [],
  );

  const nodes = nodesRef.current;
  const links = linksRef.current;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const resolve = (e: string | GNode): GNode | undefined =>
    typeof e === "string" ? byId.get(e) : e;

  return (
    <svg viewBox={`0 0 ${GW} ${GH}`} width="100%" height="auto" role="img" aria-label="Agent decision graph">
      {/* Edges. */}
      <g>
        {links.map((l, i) => {
          const s = resolve(l.source);
          const t = resolve(l.target);
          if (!s || !t) return null;
          const stroke =
            l.kind === "fund"
              ? PALETTE.gold
              : OUTCOME_COLOR[(t.outcome as string) ?? ""] ?? PALETTE.slate;
          const w =
            l.kind === "fund"
              ? Math.max(0.8, Math.min(Math.sqrt(l.value) * 0.22, 4))
              : 0.7;
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={stroke}
              strokeWidth={w}
              strokeOpacity={l.kind === "fund" ? 0.4 : 0.28}
              strokeLinecap="round"
            />
          );
        })}
      </g>

      {/* Nodes. */}
      <g>
        {nodes.map((n) => {
          const r = nodeRadius(n);
          const color = nodeColor(n);
          return (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
              {n.kind === "agent" ? (
                <motion.g
                  initial={reduced ? false : { scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 16 }}
                >
                  <circle r={r + 6} fill={color} opacity={0.16} />
                  <path
                    d="M0 -15 L15 0 L0 15 L-15 0 Z"
                    fill={color}
                    stroke={PALETTE.canvas}
                    strokeWidth={1.5}
                  />
                </motion.g>
              ) : (
                <motion.circle
                  r={r}
                  fill={color}
                  fillOpacity={n.kind === "physician" ? 0.85 : 0.95}
                  stroke={PALETTE.canvas}
                  strokeWidth={1}
                  initial={reduced ? false : { scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 220, damping: 18 }}
                />
              )}
              {n.kind === "agent" && (
                <text
                  y={30}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill={PALETTE.gold}
                  letterSpacing={2}
                >
                  AGENT
                </text>
              )}
              {n.kind === "physician" && r > 9 && (
                <text
                  y={-r - 4}
                  textAnchor="middle"
                  fontSize={8.5}
                  fill={PALETTE.muted}
                  opacity={0.8}
                >
                  {n.label}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Footnote scale hint. */}
      <text x={16} y={GH - 16} fontSize={11} fill={PALETTE.faint}>
        {usd(state.spend, { compact: true })} across {nodes.filter((n) => n.kind === "physician").length} physicians ·{" "}
        {nodes.filter((n) => n.kind === "patient").length} patients
      </text>
    </svg>
  );
}
