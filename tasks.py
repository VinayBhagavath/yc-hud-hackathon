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
    SEEDS = range(6)              # 6 tasks x group 4 = 24 rollouts/iter
    BUDGETS = (2500.0,)           # single-round sweet spot: even 0.29, smart ceiling 0.66
else:
    # 12 tasks x group 8 = 96 rollouts/iter for steadier gradients + generalization.
    SEEDS = range(12)
    BUDGETS = (2500.0,)

# Expose exactly ONE taskset. Exposing both a loose list and a Taskset makes
# HUD's module loader discover the same tasks twice -> "duplicate task slugs".
# `hud eval tasks.py` and `hud sync tasks` both read this taskset; train.py uses
# `tasks.taskset`.
taskset = Taskset(
    "provider-allocation",
    [allocate(seed=s, budget=b) for s in SEEDS for b in BUDGETS],
)
