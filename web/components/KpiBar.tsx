"use client";

import { useEffect, useRef, useState } from "react";
import type { ReplayState } from "@/lib/replay";
import type { EvalSummary } from "@/lib/types";
import { num, pct, usd } from "@/lib/format";
import { baselineCosts, pctCheaper } from "@/lib/selectors";
import CountUp from "./CountUp";

// A small supporting stat in the right cluster.
function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-placard text-muted">{label}</span>
      <span className={`tabular text-lg font-semibold leading-none ${accent ?? "text-ink"}`}>{value}</span>
    </div>
  );
}

export default function KpiBar({ state, evals }: { state: ReplayState; evals: EvalSummary[] }) {
  const { greedy } = baselineCosts(evals);
  const trainedEval = evals.find((e) => e.policy_name === "trained");
  const liveCost = state.costPerMedicated;
  const vsGreedy = pctCheaper(liveCost, greedy);

  // One-shot gold sweep each time a new round resolves.
  const [sweepKey, setSweepKey] = useState(0);
  const prevRound = useRef(state.roundIndex);
  useEffect(() => {
    if (state.roundIndex !== prevRound.current) {
      prevRound.current = state.roundIndex;
      setSweepKey((k) => k + 1);
    }
  }, [state.roundIndex]);

  const budgetPct = state.budgetTotal > 0 ? Math.min(state.spend / state.budgetTotal, 1) : 0;

  return (
    <section className="panel relative flex flex-wrap items-stretch gap-x-10 gap-y-6 overflow-hidden px-7 py-6">
      <span
        key={sweepKey}
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-0 w-1/3 animate-gold-sweep bg-gradient-to-r from-transparent via-gold/10 to-transparent motion-reduce:hidden"
      />

      {/* THE focal point: cost to medicate one patient. */}
      <div className="z-10 flex min-w-[260px] flex-col gap-1.5">
        <span className="placard">Cost to medicate one patient</span>
        <span className="metric-serif text-[68px] font-semibold leading-[0.85] text-gold">
          {liveCost === null ? "—" : <CountUp value={liveCost} format={(n) => usd(n)} />}
        </span>
        <span className="text-xs">
          {vsGreedy == null ? (
            <span className="text-faint">the agent&apos;s blended price per conversion</span>
          ) : vsGreedy > 0 ? (
            <span className="text-emerald">▼ {vsGreedy}% cheaper than the greedy baseline</span>
          ) : (
            <span className="text-muted">▲ {Math.abs(vsGreedy)}% vs greedy · still settling</span>
          )}
        </span>
      </div>

      {/* Secondary metric. */}
      <div className="z-10 flex flex-col justify-center gap-1.5 border-l border-hairline/60 pl-10">
        <span className="placard">Patients medicated</span>
        <span className="metric-serif text-[44px] font-semibold leading-[0.85] text-emerald">
          <CountUp value={state.medicatedCount} format={(n) => num(Math.round(n))} />
        </span>
        <span className="text-xs text-faint">
          of {num(state.fundedCount)} funded · {pct(state.conversionRate, 0)} convert
        </span>
      </div>

      {/* Tertiary supporting cluster. */}
      <div className="z-10 ml-auto flex items-center gap-9 self-center">
        <Stat label="Budget deployed" value={<CountUp value={state.spend} format={(n) => usd(n, { compact: true })} />} />
        <Stat label="of authorised" value={pct(budgetPct, 0)} />
        <Stat label="People reached" value={num(state.peopleReached)} />
        <Stat label="Round" value={<span>{state.roundIndex + 1}<span className="text-faint"> / {state.totalRounds}</span></span>} />
        <div className="flex flex-col items-start gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-gold">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" /> TRAINED AGENT
          </span>
          {trainedEval && (
            <span className="text-[10px] text-faint">{pct(trainedEval.conversion_rate, 0)} eval conversion</span>
          )}
        </div>
      </div>
    </section>
  );
}
