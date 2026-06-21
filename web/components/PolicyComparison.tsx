"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { EvalSummary } from "@/lib/types";
import { titleCase, usd } from "@/lib/format";

const COLOR: Record<string, string> = {
  trained: "#34d399",
  greedy: "#7aa2ff",
  random: "#5a6072",
};

export default function PolicyComparison({ evals }: { evals: EvalSummary[] }) {
  const data = [...evals]
    .sort((a, b) => b.avg_cost_per_medicated - a.avg_cost_per_medicated)
    .map((e) => ({
      name: titleCase(e.policy_name),
      key: e.policy_name,
      cost: e.avg_cost_per_medicated,
    }));

  return (
    <section className="panel flex flex-col p-4">
      <header className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Cost per medicated</h2>
        <span className="text-[11px] text-muted">trained vs baselines</span>
      </header>
      <div className="h-[132px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 44, top: 8, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              width={58}
              tick={{ fill: "#8a91a6", fontSize: 11 }}
            />
            <Bar dataKey="cost" radius={[0, 5, 5, 0]} barSize={18} isAnimationActive>
              {data.map((d) => (
                <Cell key={d.key} fill={COLOR[d.key] ?? "#5a6072"} />
              ))}
              <LabelList
                dataKey="cost"
                position="right"
                formatter={(v: number) => usd(v)}
                fill="#e8ecf4"
                fontSize={11}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
