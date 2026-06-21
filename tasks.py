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
    SEEDS = range(4)
    BUDGETS = (6000.0,)
else:
    SEEDS = range(60)
    BUDGETS = (3000.0, 4000.0, 6000.0)

# `tasks` is what `hud eval tasks.py claude` runs; `taskset` is what train.py uses.
tasks = [allocate(seed=s, budget=b) for s in SEEDS for b in BUDGETS]
taskset = Taskset("provider-allocation", tasks)
