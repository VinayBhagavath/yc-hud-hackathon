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


def _balanced_objects(s: str) -> list[str]:
    """Return every top-level {...} balanced substring, in order of appearance."""
    objs, depth, start = [], 0, None
    for i, ch in enumerate(s):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                objs.append(s[start:i + 1])
                start = None
    return objs


def _coerce_plan(raw, rounds: int) -> dict[int, dict]:
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


def parse_plan(answer, rounds: int) -> dict[int, dict]:
    """Pull a {round: {provider_id: amount}} plan out of the agent's text answer.

    Models (esp. small ones) ramble and echo the example before the real plan,
    so we scan ALL balanced {...} objects and take the LAST one that parses to a
    valid plan -- skipping prose and the example (which often contains a literal
    ``...`` that fails json.loads).
    """
    if not isinstance(answer, str):
        return {}
    for cand in reversed(_balanced_objects(answer)):
        try:
            raw = json.loads(cand)
        except (ValueError, TypeError):
            continue
        plan = _coerce_plan(raw, rounds)
        if plan:
            return plan
    return {}


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
        f"Output ONLY a single JSON object and nothing else -- no reasoning, no explanation, "
        f"no markdown, starting with '{{'. Use the ACTUAL provider ids from the data above "
        f"and dollar amounts YOU choose; each round's total must be <= ${budget:.0f}. Shape "
        f"(placeholders -- fill in real ids/amounts, do not copy):\n"
        f'{{"round1": {{"<provider_id>": <dollars>, ...}}, "round2": {{...}}, "round3": {{...}}}}\n'
        f"/no_think"   # Qwen switch: answer directly instead of emitting a <think> ramble
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
