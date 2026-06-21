"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { DashboardPayload } from "@/lib/types";
import { PALETTE } from "@/lib/palette";
import { num, usd } from "@/lib/format";

// Stage coordinate system (a 1000×600 SVG, scaled responsively).
const SW = 1000;
const SH = 600;
const AGENT = { x: 620, y: 300 };

// A gentle curve between two stage points, bowed slightly upward.
function curve(ax: number, ay: number, bx: number, by: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2 - 40;
  return `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`;
}

// One flowing stream: faint base + animated dash + a travelling particle.
function Stream({
  d,
  color,
  show,
  delay = 0,
}: {
  d: string;
  color: string;
  show: boolean;
  delay?: number;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, delay }}
        >
          <path d={d} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.22} />
          <path
            className="flow-anim"
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            strokeOpacity={0.85}
            strokeDasharray="2 14"
            style={{ animation: "flow-dash 1.1s linear infinite" }}
          />
          <circle r={2.6} fill={color}>
            <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
          </circle>
        </motion.g>
      )}
    </AnimatePresence>
  );
}

const CAPTIONS = [
  "Patients carry an unfilled prescription.",
  "Physicians hold panels of under-medicated patients.",
  "Sponsors have budget — but no targeting.",
  "The RL agent fuses patient need, physician reach, and budget.",
];

export default function LineageIntro({
  data,
  onDone,
}: {
  data: DashboardPayload;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Representative geometry derived from the real payload.
  const patients = useMemo(() => {
    const n = Math.min(14, Math.max(6, data.overview.undermedicated));
    return Array.from({ length: n }, (_, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      return { x: 110 + col * 26, y: 210 + row * 30, key: i };
    });
  }, [data.overview.undermedicated]);

  const physicians = useMemo(() => {
    const seen = new Map<string, { specialty: string; city: string }>();
    for (const p of data.physicians) {
      if (!seen.has(p.region)) seen.set(p.region, { specialty: p.specialty, city: p.city ?? p.region });
      if (seen.size >= 3) break;
    }
    const list = [...seen.values()];
    const ys = [200, 300, 400];
    return list.map((p, i) => ({ ...p, x: 360, y: ys[i] ?? 300, key: i }));
  }, [data.physicians]);

  const sponsors = useMemo(
    () => [
      { label: "Sponsor A", x: 880, y: 215 },
      { label: "Sponsor B", x: 900, y: 300 },
      { label: "Sponsor C", x: 880, y: 385 },
    ],
    [],
  );

  // Beat timeline. Reduced-motion jumps near the end and hands off fast.
  useEffect(() => {
    const schedule = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
    if (reduced) {
      setBeat(3);
      schedule(onDone, 900);
    } else {
      schedule(() => setBeat(1), 1700);
      schedule(() => setBeat(2), 3400);
      schedule(() => setBeat(3), 5100);
      schedule(onDone, 7000);
    }
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [reduced, onDone]);

  const showPatients = beat >= 0;
  const showPhys = beat >= 1;
  const showSponsors = beat >= 2;
  const converge = beat >= 3;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Skip affordance. */}
      <button
        onClick={onDone}
        className="absolute right-5 top-5 z-10 rounded-full border border-hairline bg-canvas-2 px-3 py-1.5 text-xs text-muted transition hover:text-ink"
      >
        Skip intro →
      </button>

      <span className="placard absolute left-6 top-6">Data lineage · origin story</span>

      <div className="relative w-full max-w-[1100px] px-6">
        <svg viewBox={`0 0 ${SW} ${SH}`} width="100%" height="auto">
          {/* Patient → physician streams. */}
          {physicians.map((ph) =>
            patients
              .filter((_, i) => i % physicians.length === ph.key)
              .map((pt) => (
                <Stream
                  key={`pp-${ph.key}-${pt.key}`}
                  d={curve(pt.x, pt.y, ph.x - 10, ph.y)}
                  color={PALETTE.slate}
                  show={showPhys && !converge}
                />
              )),
          )}

          {/* Physician → agent streams. */}
          {physicians.map((ph) => (
            <Stream
              key={`pa-${ph.key}`}
              d={curve(ph.x + 10, ph.y, AGENT.x - 16, AGENT.y)}
              color={PALETTE.emerald}
              show={converge}
            />
          ))}

          {/* Sponsor → agent funding streams. */}
          {sponsors.map((s, i) => (
            <Stream
              key={`sa-${i}`}
              d={curve(s.x - 14, s.y, AGENT.x + 16, AGENT.y)}
              color={PALETTE.gold}
              show={showSponsors}
            />
          ))}

          {/* Patient glyphs. */}
          <AnimatePresence>
            {showPatients &&
              patients.map((pt) => (
                <motion.circle
                  key={pt.key}
                  cx={pt.x}
                  cy={pt.y}
                  r={4}
                  fill={PALETTE.slate}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: converge ? 0.25 : 0.9, scale: 1 }}
                  transition={{ delay: reduced ? 0 : pt.key * 0.05, duration: 0.4 }}
                />
              ))}
          </AnimatePresence>

          {/* Physician nodes. */}
          <AnimatePresence>
            {showPhys &&
              physicians.map((ph) => (
                <motion.g
                  key={ph.key}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5 }}
                  style={{ transformOrigin: `${ph.x}px ${ph.y}px` }}
                >
                  <circle
                    cx={ph.x}
                    cy={ph.y}
                    r={13}
                    fill={PALETTE.emerald}
                    fillOpacity={0.18}
                    stroke={PALETTE.emerald}
                    strokeWidth={1.4}
                  />
                  <circle cx={ph.x} cy={ph.y} r={4} fill={PALETTE.emerald} />
                  <text
                    x={ph.x}
                    y={ph.y - 20}
                    textAnchor="middle"
                    fontSize={11}
                    fill={PALETTE.muted}
                  >
                    {ph.specialty} · {ph.city.split(",")[0]}
                  </text>
                </motion.g>
              ))}
          </AnimatePresence>

          {/* Sponsor nodes. */}
          <AnimatePresence>
            {showSponsors &&
              sponsors.map((s, i) => (
                <motion.g
                  key={i}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  style={{ transformOrigin: `${s.x}px ${s.y}px` }}
                >
                  <rect
                    x={s.x - 13}
                    y={s.y - 13}
                    width={26}
                    height={26}
                    rx={6}
                    fill={PALETTE.gold}
                    fillOpacity={0.16}
                    stroke={PALETTE.gold}
                    strokeWidth={1.4}
                  />
                  <text x={s.x} y={s.y - 20} textAnchor="middle" fontSize={11} fill={PALETTE.muted}>
                    {s.label}
                  </text>
                </motion.g>
              ))}
          </AnimatePresence>
        </svg>

        {/* The gold AGENT core — HTML overlay sharing layoutId with the map's
            treasury node for a seamless morph into the live room. */}
        <AnimatePresence>
          {converge && (
            <motion.div
              layoutId="agent-core"
              className="pointer-events-none absolute flex h-14 w-14 items-center justify-center rounded-full bg-gold text-canvas shadow-gold"
              // Centre via negative margins (see UsMap) so the layoutId morph
              // isn't fighting a CSS translate.
              style={{
                left: `${(AGENT.x / SW) * 100}%`,
                top: `${(AGENT.y / SH) * 100}%`,
                marginLeft: -28,
                marginTop: -28,
              }}
              transition={{ type: "spring", stiffness: 120, damping: 18 }}
            >
              <svg width="26" height="26" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 1 L15 8 L8 15 L1 8 Z" />
              </svg>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Lower-third caption placard, cross-fading per beat. */}
      <div className="absolute bottom-[12%] flex h-12 items-center justify-center px-6">
        <AnimatePresence mode="wait">
          <motion.p
            key={beat}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.45 }}
            className="font-serif text-xl text-ink"
          >
            {CAPTIONS[beat]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Quiet data-true footnote so judges see it's wired to the payload. */}
      <p className="absolute bottom-[6%] text-[11px] text-faint">
        {num(data.overview.undermedicated)} under-medicated patients ·{" "}
        {num(data.physicians.length)} physicians ·{" "}
        {usd(data.overview.total_sponsorship_usd, { compact: true })} sponsorship
      </p>
    </motion.div>
  );
}
