"""HUD environment: fund providers to maximize patient medication uptake.

Trainable models (e.g. a forked Qwen) run under HUD's openai_compatible agent
harness, which has NO bash/shell tool -- only filesystem + MCP. So this env is
*tool-free*: the provider data is embedded in the prompt and the agent answers
with its full multi-round funding plan as JSON text. That works with every model
harness (Claude, Qwen, ...) and keeps the hidden cost-to-convert entirely
server-side (no leak).

Decision: fund providers (not patients). A patient converts when the funding to
their provider, split evenly across that provider's still-untreated patients,
meets that patient's hidden cost-to-convert. Converted patients are removed from
later rounds (sticky); the budget refreshes each round.

  reward = total patients converted across all rounds / initial count   in [0, 1]

Reward source: Synthea diabetes cohort via synthea_cohort.make_cohort; the
cost-to-convert rule is dynamics.run_round.
"""

from __future__ import annotations

import json
import re

from hud import Environment

from dynamics import run_round
from synthea_cohort import make_cohort, public_view

env = Environment(name="provider-allocation", version="0.0.1")


def parse_plan(answer, rounds: int) -> dict[int, dict]:
    """Pull a {round: {provider_id: amount}} plan out of the agent's text answer.

    Tolerant of markdown fences / surrounding prose: grabs the outermost JSON
    object. Accepts either {"round1": {...}, ...} or {"1": {...}, ...}. Returns
    {round_index: {provider_id: amount}} for 0..rounds-1; missing rounds -> {}.
    """
    if not isinstance(answer, str):
        return {}
    m = re.search(r"\{.*\}", answer, re.DOTALL)
    if not m:
        return {}
    try:
        raw = json.loads(m.group(0))
    except (ValueError, TypeError):
        return {}

    plan: dict[int, dict] = {}
    for key, alloc in (raw.items() if isinstance(raw, dict) else []):
        digits = re.search(r"\d+", str(key))
        if not digits or not isinstance(alloc, dict):
            continue
        r = int(digits.group(0))
        r = r - 1 if r >= 1 else r          # "round1"/"1" -> index 0
        if 0 <= r < rounds:
            out = {}
            for pid, amt in alloc.items():
                try:
                    out[int(pid)] = max(0.0, float(amt))
                except (ValueError, TypeError):
                    continue
            plan[r] = out
    return plan


@env.template()
async def allocate(seed: int = 0, budget: float = 1500.0, rounds: int = 3):
    providers, thresholds = make_cohort(seed)
    n_total = len(thresholds)
    view = public_view(providers, set(thresholds))   # features only, NO costs

    answer = yield (
        f"You direct a patient-access program for a branded GLP-1 diabetes therapy. "
        f"Allocate ${budget:.0f} of outreach funding across healthcare providers in EACH "
        f"of {rounds} rounds (the budget refreshes every round) to get as many "
        f"undertreated Type 2 Diabetes patients onto therapy as possible.\n\n"
        f"Providers (JSON) -- each has a `region` (city), `volume`, `avg_hba1c`, and the "
        f"ids of patients still untreated:\n{json.dumps(view)}\n\n"
        f"A patient converts when the funding you give their provider, split evenly across "
        f"that provider's still-untreated patients, meets that patient's hidden "
        f"cost-to-convert (NOT shown; it correlates with region). Converted patients stay "
        f"on therapy and are removed from later rounds. Plan all {rounds} rounds up front, "
        f"spending each round's budget where it converts the most patients.\n\n"
        f"Respond with ONLY a JSON object mapping each round to provider funding, e.g.:\n"
        f'{{"round1": {{"0": 800, "3": 700}}, "round2": {{"1": 1500}}, "round3": {{"2": 900}}}}\n'
        f"Each round's total must be <= ${budget:.0f}."
    )

    plan = parse_plan(answer, rounds)
    unmedicated = set(thresholds)
    medicated = 0
    for r in range(rounds):
        alloc = plan.get(r, {})
        if sum(alloc.values()) > budget:        # over budget -> wasted round
            continue
        newly = run_round(providers, unmedicated, thresholds, alloc)
        unmedicated -= newly
        medicated += len(newly)

    yield medicated / n_total if n_total else 0.0
