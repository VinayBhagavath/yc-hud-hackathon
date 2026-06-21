"""HUD environment: fund providers to maximize patient medication uptake.

Decision flow
-------------
The policy agent allocates a fixed budget across *providers* (not patients).
Each provider serves a panel of patients. Whether a patient ends up medicated
is decided by a reward function that, in production, will be **Synthea**
(synthetic patient generation with transition-modeled provider preferences).

Until Synthea is wired in, the reward dynamics in dynamics.py use a
deterministic PLACEHOLDER rule so the full pipeline (episode loop, budget
refresh, training) runs end-to-end with a learnable, allocation-sensitive
reward.

Episode structure (3 rounds)
----------------------------
Per episode the agent allocates ``rounds`` (=3) times. Each round:
  1. the budget is fully refreshed to ``budget``,
  2. the agent funds providers,
  3. some currently-unmedicated patients become medicated,
  4. medicated patients are REMOVED for subsequent rounds (sticky).
Final reward = (total patients medicated across all rounds) / (initial count),
already in [0, 1] -- no oracle/normalization needed.

Two ways to drive the 3 rounds:
  * ``allocate``      -- multi-turn generator (cleanest). Relies on HUD driving
                         templates as true multi-turn generators. VERIFY against
                         the live HUD docs skill before depending on it.
  * ``allocate_tool`` -- single-prompt + workspace round-driver tool (safe
                         fallback matching the documented "deliverable is
                         workspace state + tools" pattern). See round_driver.py.
"""

from __future__ import annotations

import json
from pathlib import Path

from hud import Environment

from dynamics import make_cohort, run_round, parse_alloc, public_view

env = Environment(name="provider-allocation", version="0.0.1")

# Workspace the agent reads/writes. Authoritative reward state (hidden
# thresholds, medicated set, round logic) lives OUTSIDE it so the agent cannot
# tamper with its own reward.
ROOT = Path("/workspace")


# --------------------------------------------------------------------------- #
# Multi-turn generator template (cleanest; verify multi-turn support)
# --------------------------------------------------------------------------- #
@env.template()
async def allocate(seed: int = 0, budget: float = 4000.0, rounds: int = 3):
    providers, thresholds = make_cohort(seed)
    n_total = len(thresholds)
    unmedicated = set(thresholds)
    medicated = 0

    for r in range(rounds):
        ROOT.mkdir(parents=True, exist_ok=True)
        (ROOT / "patients.json").write_text(
            json.dumps(public_view(providers, unmedicated), indent=2)
        )
        answer = yield (
            f"Round {r + 1}/{rounds}. Budget ${budget:.0f} (fully refreshed this round). "
            f"{len(unmedicated)} patients still need medication; provider panels are in "
            f"/workspace/patients.json. Decide how much to fund each provider and write it "
            f'to /workspace/alloc.json as {{"<provider_id>": <amount>}}. Total must not '
            f"exceed the budget. Patients you medicate stay medicated; aim to medicate as "
            f"many patients as possible across all {rounds} rounds."
        )
        alloc = parse_alloc(answer)
        if sum(alloc.values()) > budget:
            continue  # over budget -> wasted round
        newly = run_round(providers, unmedicated, thresholds, alloc)
        unmedicated -= newly
        medicated += len(newly)

    yield medicated / n_total if n_total else 0.0


# --------------------------------------------------------------------------- #
# Single-prompt + workspace round-driver fallback
# --------------------------------------------------------------------------- #
@env.template()
async def allocate_tool(seed: int = 0, budget: float = 4000.0, rounds: int = 3):
    """Single-turn variant: the agent runs `python /authoritative/round_driver.py`
    after each write to /workspace/alloc.json. The driver applies the round,
    refreshes the budget, removes medicated patients, and updates
    /workspace/patients.json and /workspace/state.json. Final reward is read back
    from state.json. Authoritative state lives under /authoritative.
    """
    providers, thresholds = make_cohort(seed)
    n_total = len(thresholds)

    ROOT.mkdir(parents=True, exist_ok=True)
    auth = Path("/authoritative")
    auth.mkdir(parents=True, exist_ok=True)
    (auth / "thresholds.json").write_text(json.dumps(thresholds))
    (auth / "providers.json").write_text(json.dumps(providers))
    (auth / "config.json").write_text(
        json.dumps({"budget": budget, "rounds": rounds, "round": 0,
                    "medicated": [], "n_total": n_total})
    )
    (ROOT / "patients.json").write_text(
        json.dumps(public_view(providers, set(thresholds)), indent=2)
    )

    yield (
        f"You have {rounds} funding rounds. Each round: read /workspace/patients.json, "
        f"write your provider funding to /workspace/alloc.json as "
        f'{{"<provider_id>": <amount>}} (total <= ${budget:.0f}, refreshed every round), '
        f"then run `python /authoritative/round_driver.py` to apply it. Repeat until all "
        f"{rounds} rounds are used. Maximize total patients medicated; medicated patients "
        f"stay medicated and are removed from later rounds."
    )

    state = json.loads((ROOT / "state.json").read_text())
    yield state.get("reward", 0.0)
