// Derived, read-only views over the dashboard payload + replay state. These add
// selectors on top of the replay engine without touching its reducer.
import type { EvalSummary } from "./types";

export interface BaselineCosts {
  trained: number | null;
  greedy: number | null;
  random: number | null;
}

export function baselineCosts(evals: EvalSummary[]): BaselineCosts {
  const pick = (name: string) =>
    evals.find((e) => e.policy_name === name)?.avg_cost_per_medicated ?? null;
  return { trained: pick("trained"), greedy: pick("greedy"), random: pick("random") };
}

// Percent cheaper that `cost` is vs a `baseline` (positive = cheaper). Returns
// null when either side is missing or non-positive.
export function pctCheaper(cost: number | null, baseline: number | null): number | null {
  if (cost == null || baseline == null || baseline <= 0) return null;
  return Math.round((1 - cost / baseline) * 100);
}

// Headline "beats greedy/random by N%" callout, computed off the eval summaries.
export function superiorityCallout(evals: EvalSummary[]): {
  vsGreedy: number | null;
  vsRandom: number | null;
} {
  const { trained, greedy, random } = baselineCosts(evals);
  return {
    vsGreedy: pctCheaper(trained, greedy),
    vsRandom: pctCheaper(trained, random),
  };
}
