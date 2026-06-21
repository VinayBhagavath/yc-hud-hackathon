"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrainingPoint } from "@/lib/types";
import { PALETTE } from "@/lib/palette";
import Placard from "./Placard";

export default function TrainingCurve({
  curve,
  progress = 0,
}: {
  curve: TrainingPoint[];
  progress?: number;
}) {
  // A gold marker rides the trained line as the replay scrubs — the agent's
  // cost racing below the faint greedy/random ghost lines.
  const idx = curve.length
    ? Math.min(curve.length - 1, Math.round(progress * (curve.length - 1)))
    : 0;
  const marker = curve[idx];

  return (
    <section className="panel flex flex-col p-4">
      <Placard
        title="Training curve"
        subtitle="Cost / medicated over training — trained dives below the ghosts"
      />
      <div className="h-[120px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke={PALETTE.hairline} vertical={false} strokeOpacity={0.5} />
            <XAxis
              dataKey="step"
              axisLine={false}
              tickLine={false}
              tick={{ fill: PALETTE.faint, fontSize: 10 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: PALETTE.faint, fontSize: 10 }}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: PALETTE.canvas2,
                border: `1px solid ${PALETTE.hairline}`,
                borderRadius: 10,
                fontSize: 12,
              }}
              labelStyle={{ color: PALETTE.muted }}
            />
            {/* Faint ghost baselines. */}
            <Line
              type="monotone"
              dataKey="random_cost_per_medicated"
              name="random"
              stroke={PALETTE.faint}
              strokeWidth={1.4}
              strokeDasharray="3 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="greedy_cost_per_medicated"
              name="greedy"
              stroke={PALETTE.slate}
              strokeWidth={1.4}
              strokeDasharray="3 4"
              dot={false}
              isAnimationActive={false}
            />
            {/* The agent. */}
            <Line
              type="monotone"
              dataKey="trained_cost_per_medicated"
              name="trained"
              stroke={PALETTE.gold}
              strokeWidth={2.4}
              dot={false}
              isAnimationActive={false}
            />
            {marker && (
              <ReferenceDot
                x={marker.step}
                y={marker.trained_cost_per_medicated}
                r={4}
                fill={PALETTE.gold}
                stroke={PALETTE.canvas}
                strokeWidth={1.5}
                isFront
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
