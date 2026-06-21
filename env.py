"""HUD environment: fund providers to maximize patient medication uptake.

HUD templates are strictly single-turn: `yield prompt` -> (agent acts) ->
`yield reward`. Multi-step work happens in a WORKSPACE shell between those two
yields (the documented pattern), NOT via extra yields.

So the 3-round episode is driven by the agent running `python apply_round.py` in
its workspace once per round. Each round the budget refreshes, some patients get
medicated, and medicated patients are removed (sticky). The reward is the final
medicated fraction, read back from the workspace state.

  reward = total patients medicated / initial patient count   in [0, 1]

Reward source: the per-round rule is a deterministic PLACEHOLDER (in
apply_round.py / dynamics.run_round). Synthea replaces only that rule later.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from hud import Environment

from dynamics import make_cohort

env = Environment(name="provider-allocation", version="0.0.1")

# A bash shell + filesystem the agent can read/write (the documented capability).
# Fresh per rollout (each rollout runs in its own env process/container).
WORKSPACE = Path(tempfile.mkdtemp(prefix="hud-provider-alloc-"))
ws = env.workspace(WORKSPACE, network=False)

_APPLY_SRC = Path(__file__).resolve().parent / "apply_round.py"


@env.template()
async def allocate(seed: int = 0, budget: float = 4000.0, rounds: int = 3):
    providers, thresholds = make_cohort(seed)
    n_total = len(thresholds)

    # Hidden authoritative state (includes thresholds -- not shown to the agent).
    state = {
        "providers": providers,                       # id, region, patient ids
        "thresholds": {str(k): v for k, v in thresholds.items()},
        "unmedicated": sorted(thresholds),
        "medicated": 0,
        "round": 0,
        "rounds": rounds,
        "budget": budget,
        "n_total": n_total,
        "reward": 0.0,
    }
    (WORKSPACE / ".state.json").write_text(json.dumps(state))

    # Public view: providers + region + remaining patient ids, NO cost info.
    view = [{"id": p["id"], "region": p["region"], "patients": p["patients"]}
            for p in providers]
    (WORKSPACE / "patients.json").write_text(json.dumps(view, indent=2))

    # Clear any stale files and drop the round driver in the workspace.
    for f in ("alloc.json", "results.json"):
        (WORKSPACE / f).unlink(missing_ok=True)
    shutil.copy(_APPLY_SRC, WORKSPACE / "apply_round.py")

    answer = yield (
        f"You have a bash shell in your working directory and ${budget:.0f} to allocate "
        f"across healthcare providers in EACH of {rounds} rounds (the budget refreshes "
        f"every round). Goal: medicate as many patients as possible across all rounds.\n\n"
        f"`patients.json` lists providers, each with a `region` and the ids of patients "
        f"who still need medication. A patient becomes medicated when the funding you give "
        f"their provider -- split evenly across that provider's listed patients -- is "
        f"enough for them. Medicated patients stay medicated and are removed from later "
        f"rounds. (Hint: cost-effectiveness correlates with region.)\n\n"
        f"Each round:\n"
        f"  1. read patients.json\n"
        f'  2. write your funding to alloc.json as {{"<provider_id>": <amount>}}, '
        f"total <= ${budget:.0f}\n"
        f"  3. run `python apply_round.py`  (it reports results and refreshes patients.json)\n"
        f"Repeat for all {rounds} rounds, then reply 'done'."
    )

    try:
        final = json.loads((WORKSPACE / ".state.json").read_text())
        yield float(final.get("reward", 0.0))
    except Exception:  # noqa: BLE001
        yield 0.0
