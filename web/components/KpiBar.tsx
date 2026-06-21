"use client";

import { useEffect, useRef, useState } from "react";
import type { ReplayState } from "@/lib/replay";
import type { EvalSummary } from "@/lib/types";
import { num, pct, usd } from "@/lib/format";
import { baselineCosts, pctCheaper } from "@/lib/selectors";
import CountUp from "./CountUp";

// One large engraved-plaque metric: serif figure + quiet caption.
function BigMetric({
  label,
  value,
  caption,
  tone = "ink",
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: "ink" | "emerald" | "gold";
}) {
  const toneClass =
    tone === "gold" ? "text-gold" : tone === "emerald" ? "text-emerald" : "text-ink";
  return (
    <div className="flex flex-col gap-1.5 px-6 py-4">
      <span className="placard">{label}</span>
      <span className={`metric-serif text-[2.7rem] font-semibold leading-[0.95] ${toneClass}`}>
        {value}
      </span>
      {caption && (
        <span className="text-[11px] leading-tight text-faint">{caption}</span>
      )}
    </div>
  );
}

// Small secondary stat for the right cluster.
function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-placard text-muted">{label}</span>
      <span className="tabular text-base font-semibold text-ink">{value}</span>
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
  const { greedy, random } = baselineCosts(evals);
  const trainedEval = evals.find((e) => e.policy_name === "trained");
  const liveCost = state.costPerMedicated;
  const vsGreedy = pctCheaper(liveCost, greedy);

  // One-shot gold sweep across the scoreboard each time a new round resolves.
  const [sweepKey, setSweepKey] = useState(0);
  const prevRound = useRef(state.roundIndex);
  useEffect(() => {
    if (state.roundIndex !== prevRound.current) {
      prevRound.current = state.roundIndex;
      setSweepKey((k) => k + 1);
    }
  }, [state.roundIndex]);

  const budgetPct =
    state.budgetTotal > 0 ? Math.min(state.spend / state.budgetTotal, 1) : 0;

  return (
    <section className="panel relative flex flex-wrap items-stretch overflow-hidden divide-x divide-hairline/70">
      {/* Gold round-resolve sweep (decorative, reduced-motion safe). */}
      <span
        key={sweepKey}
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-0 w-1/3 animate-gold-sweep bg-gradient-to-r from-transparent via-gold/10 to-transparent motion-reduce:hidden"
      />

      <BigMetric
        label="Cost · medicated"
        tone="gold"
        value={
          liveCost === null ? "—" : <CountUp value={liveCost} format={(n) => usd(n)} />
        }
        caption={
          vsGreedy != null ? (
            <span className="text-emerald">▼ {vsGreedy}% cheaper than greedy</span>
          ) : (
            "agent's price to medicate one patient"
          )
        }
      />
      <BigMetric
        label="Patients medicated"
        tone="emerald"
        value={<CountUp value={state.medicatedCount} format={(n) => num(Math.round(n))} />}
        caption={`${num(state.fundedCount)} funded · ${pct(state.conversionRate, 0)} convert`}
      />
      <BigMetric
        label="Budget deployed"
        value={<CountUp value={state.spend} format={(n) => usd(n, { compact: true })} />}
        caption={`${pct(budgetPct, 0)} of ${usd(state.budgetTotal, { compact: true })} authorised`}
      />

      {/* Secondary cluster + policy badge. */}
      <div className="z-10 flex flex-1 items-center justify-end gap-7 px-6 py-4">
        <MiniStat label="People reached" value={num(state.peopleReached)} />
        <MiniStat
          label="Round"
          value={
            <span>
              {state.roundIndex + 1}
              <span className="text-faint"> / {state.totalRounds}</span>
            </span>
          }
        />
        <div className="flex flex-col items-end gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-gold">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" /> TRAINED AGENT
          </span>
          {trainedEval && (
            <span className="text-[10px] text-faint">
              {pct(trainedEval.conversion_rate, 0)} eval conversion
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
