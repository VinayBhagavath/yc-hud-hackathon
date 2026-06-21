"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrainingPoint } from "@/lib/types";

export default function TrainingCurve({ curve }: { curve: TrainingPoint[] }) {
  return (
    <section className="panel flex flex-col p-4">
      <header className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Training curve</h2>
        <span className="text-[11px] text-muted">cost / medicated over steps</span>
      </header>
      <div className="h-[132px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#1c2030" vertical={false} />
            <XAxis
              dataKey="step"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#5a6072", fontSize: 10 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#5a6072", fontSize: 10 }}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: "#0d0f16",
                border: "1px solid #2a3142",
                borderRadius: 10,
                fontSize: 12,
              }}
              labelStyle={{ color: "#8a91a6" }}
            />
            <Line
              type="monotone"
              dataKey="random_cost_per_medicated"
              name="random"
              stroke="#5a6072"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="greedy_cost_per_medicated"
              name="greedy"
              stroke="#7aa2ff"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="trained_cost_per_medicated"
              name="trained"
              stroke="#34d399"
              strokeWidth={2.2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
