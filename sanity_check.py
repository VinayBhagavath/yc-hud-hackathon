"""Offline probe: confirm the placeholder reward is allocation-sensitive.

GRPO can only learn if reward changes with the agent's action. This script
simulates simple policies on the placeholder dynamics (no HUD, no model) and
prints the resulting medication fraction. You should see reward rise as more
budget is applied and as allocation gets smarter -- if it's flat, there is no
gradient to train on.

Run: python sanity_check.py
"""

from dynamics import make_cohort, run_round


def simulate(seed: int, budget: float, policy, rounds: int = 3) -> float:
    providers, thresholds = make_cohort(seed)
    unmedicated = set(thresholds)
    medicated = 0
    for _ in range(rounds):
        alloc = policy(providers, unmedicated, budget)
        newly = run_round(providers, unmedicated, thresholds, alloc)
        unmedicated -= newly
        medicated += len(newly)
    return medicated / len(thresholds)


def even(providers, unmedicated, budget):
    """Split budget evenly across all providers."""
    return {p["id"]: budget / len(providers) for p in providers}


def concentrate(providers, unmedicated, budget):
    """Dump the whole budget on the provider with the most unmedicated patients."""
    active = [(p["id"], sum(1 for q in p["patients"] if q in unmedicated)) for p in providers]
    target = max(active, key=lambda x: x[1])[0]
    return {target: budget}


def region_aware(providers, unmedicated, budget):
    """Prioritize cheap regions (N > S > E), funding each provider just enough to
    cover its remaining patients. This is the signal the agent can learn from the
    visible `region` feature -- it should beat the region-blind policies."""
    rank = {"N": 0, "S": 1, "E": 2}
    per_patient = {"N": 120, "S": 300, "E": 700}  # enough to clear that region
    order = sorted(providers, key=lambda p: rank[p["region"]])
    alloc, left = {}, budget
    for p in order:
        active = sum(1 for q in p["patients"] if q in unmedicated)
        if not active:
            continue
        need = active * per_patient[p["region"]]
        give = min(need, left)
        if give > 0:
            alloc[p["id"]] = give
            left -= give
    return alloc


def none(providers, unmedicated, budget):
    return {}


if __name__ == "__main__":
    policies = {"none": none, "even": even, "concentrate": concentrate,
                "region_aware": region_aware}
    for budget in (1000, 3000, 6000, 12000):
        row = {name: round(
            sum(simulate(s, budget, fn) for s in range(20)) / 20, 3
        ) for name, fn in policies.items()}
        print(f"budget ${budget:>6}: {row}")
    print("\nReward should increase with budget and differ across policies. "
          "If every number is identical, the reward has no gradient.")
