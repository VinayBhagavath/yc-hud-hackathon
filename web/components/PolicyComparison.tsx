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
import { superiorityCallout } from "@/lib/selectors";
import { PALETTE } from "@/lib/palette";
import Placard from "./Placard";

const COLOR: Record<string, string> = {
  trained: PALETTE.gold, // the agent
  greedy: PALETTE.slate,
  random: PALETTE.faint,
};

export default function PolicyComparison({ evals }: { evals: EvalSummary[] }) {
  const data = [...evals]
    .sort((a, b) => b.avg_cost_per_medicated - a.avg_cost_per_medicated)
    .map((e) => ({
      name: titleCase(e.policy_name),
      key: e.policy_name,
      cost: e.avg_cost_per_medicated,
    }));

  const { vsGreedy, vsRandom } = superiorityCallout(evals);

  return (
    <section className="panel flex flex-col p-4">
      <Placard
        title="Cost per medicated"
        subtitle="Trained agent vs greedy & random baselines — lower is better"
      />
      <div className="h-[120px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 48, top: 4, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              width={58}
              tick={{ fill: PALETTE.muted, fontSize: 11 }}
            />
            <Bar dataKey="cost" radius={[0, 5, 5, 0]} barSize={18} isAnimationActive>
              {data.map((d) => (
                <Cell key={d.key} fill={COLOR[d.key] ?? PALETTE.faint} />
              ))}
              <LabelList
                dataKey="cost"
                position="right"
                formatter={(v: number) => usd(v)}
                fill={PALETTE.ink}
                fontSize={11}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {(vsGreedy != null || vsRandom != null) && (
        <p className="mt-1 text-[11px] text-faint">
          Trained agent medicates for{" "}
          {vsGreedy != null && <span className="font-semibold text-gold">{vsGreedy}% less than greedy</span>}
          {vsGreedy != null && vsRandom != null && " · "}
          {vsRandom != null && <span className="font-semibold text-emerald">{vsRandom}% less than random</span>}
        </p>
      )}
    </section>
  );
}
