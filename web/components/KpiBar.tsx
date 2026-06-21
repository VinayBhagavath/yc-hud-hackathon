"use client";

import type { ReplayState } from "@/lib/replay";
import type { EvalSummary } from "@/lib/types";
import { num, pct, usd } from "@/lib/format";
import CountUp from "./CountUp";

function Kpi({
  label,
  children,
  accent,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3.5 first:pl-0">
      <span className="text-[11px] uppercase tracking-wider text-muted">{label}</span>
      <span
        className={`tabular text-2xl font-semibold leading-none ${
          accent ? "text-money" : "text-ink"
        }`}
      >
        {children}
      </span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </div>
  );
}

export default function KpiBar({
  state,
  evals,
}: {
  state: ReplayState;
  evals: EvalSummary[];
}) {
  const trained = evals.find((e) => e.policy_name === "trained");
  const random = evals.find((e) => e.policy_name === "random");
  const improvement =
    trained && random
      ? Math.round((1 - trained.avg_cost_per_medicated / random.avg_cost_per_medicated) * 100)
      : null;

  return (
    <div className="panel flex flex-wrap items-stretch divide-x divide-hairline px-5">
      <Kpi label="Total allocated" hint={`${state.fundedCount} allocations`}>
        <CountUp value={state.spend} format={(n) => usd(n)} />
      </Kpi>
      <Kpi label="People reached" hint="patients funded">
        <CountUp value={state.peopleReached} format={(n) => num(Math.round(n))} />
      </Kpi>
      <Kpi
        label="Cost / medicated"
        accent
        hint={state.medicatedCount > 0 ? `${state.medicatedCount} medicated` : "no conversions yet"}
      >
        {state.costPerMedicated === null ? (
          "—"
        ) : (
          <CountUp value={state.costPerMedicated} format={(n) => usd(n)} />
        )}
      </Kpi>
      <Kpi label="Conversion" hint="funded → medicated">
        <CountUp value={state.conversionRate * 100} format={(n) => `${n.toFixed(0)}%`} />
      </Kpi>
      <div className="flex flex-col justify-center gap-1 px-5 py-3.5">
        <span className="text-[11px] uppercase tracking-wider text-muted">Policy</span>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-money/40 bg-money/10 px-2.5 py-1 text-xs font-semibold text-money">
          <span className="h-1.5 w-1.5 rounded-full bg-money" /> TRAINED
        </span>
        {improvement !== null && (
          <span className="text-[11px] text-faint">
            {improvement}% cheaper vs random · {pct(trained?.conversion_rate, 0)} conv
          </span>
        )}
      </div>
    </div>
  );
}
