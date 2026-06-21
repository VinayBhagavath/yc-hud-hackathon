"""Taskset: a sweep over seeds and budgets.

Each (seed, budget) pair is a distinct concrete task. Variety across seeds gives
GRPO the within-group reward variance it needs.

Set SMOKE_TEST=1 for a tiny, cheap run to verify the pipeline end-to-end.
"""

import os

from hud.eval import Taskset

from env import allocate

SMOKE_TEST = os.environ.get("SMOKE_TEST") == "1"

if SMOKE_TEST:
    SEEDS = range(20)              # 20 tasks (20x the original 1-task smoke run)
    BUDGETS = (1500.0,)           # tight -> max learning headroom (naive 0.16, ceiling 0.75)
else:
    SEEDS = range(60)
    BUDGETS = (1200.0, 1500.0, 2000.0)  # tight, non-saturating range for GRPO variance

# Expose exactly ONE taskset. Exposing both a loose list and a Taskset makes
# HUD's module loader discover the same tasks twice -> "duplicate task slugs".
# `hud eval tasks.py` and `hud sync tasks` both read this taskset; train.py uses
# `tasks.taskset`.
taskset = Taskset(
    "provider-allocation",
    [allocate(seed=s, budget=b) for s in SEEDS for b in BUDGETS],
)
