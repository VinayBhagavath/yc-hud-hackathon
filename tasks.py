"""Taskset: a sweep over seeds and budgets.

Each (seed, budget) pair is a distinct concrete task. The variety across seeds
gives GRPO the within-group reward variance it needs -- different cohorts and
budgets produce different optimal allocations, so rollouts in a group spread out
instead of collapsing to identical scores.

Swap `allocate` for `allocate_tool` if you use the workspace round-driver path.
"""

from env import allocate

SEEDS = range(60)
BUDGETS = (3000.0, 4000.0, 6000.0)

tasks = [allocate(seed=s, budget=b) for s in SEEDS for b in BUDGETS]
