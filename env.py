"""HUD environment: prioritize providers to maximize patient medication uptake.

ACTION = a PRIORITY RANKING of providers (not dollar amounts). Models are bad at
budgeting dollars (they collapse to funding one provider), but good at ranking.
So the agent outputs an ordered list of provider ids; the ENV does the money:
it funds each provider in order just enough to put all its untreated patients on
therapy, until the one-time budget runs out. The agent's only job is to rank
providers by cost-effectiveness -- the real learnable skill (cost correlates with
region, which is observable).

Tool-free, single decision. Reward = patients converted / total.

Reward source: Synthea diabetes cohort (synthea_cohort.make_cohort) + the
cost-to-convert rule (dynamics.run_round).
"""

from __future__ import annotations

import json
import re

from hud import Environment

from dynamics import run_round
from synthea_cohort import make_cohort, public_view

env = Environment(name="provider-allocation", version="0.0.1")


def parse_ranking(answer) -> list[int]:
    """Extract an ordered list of provider ids from the agent's answer.

    Takes the LAST JSON array of integers in the text (skips prose / examples).
    """
    if not isinstance(answer, str):
        return []
    for cand in reversed(re.findall(r"\[[^\[\]]*\]", answer)):
        try:
            arr = json.loads(cand)
        except (ValueError, TypeError):
            continue
        ids = []
        for x in arr:
            try:
                ids.append(int(x))
            except (ValueError, TypeError):
                pass
        if ids:
            return ids
    return []


def ranking_to_alloc(providers, thresholds, ranking, budget) -> dict[int, float]:
    """Fund providers in priority order, each just enough to clear ALL its
    untreated patients, until the budget runs out. Returns {provider_id: dollars}.
    """
    prov = {p["id"]: p for p in providers}
    unmed = set(thresholds)
    alloc, spent, seen = {}, 0.0, set()
    for pid in ranking:
        p = prov.get(pid)
        if p is None or pid in seen:
            continue
        seen.add(pid)
        active = [q for q in p["patients"] if q in unmed]
        if not active:
            continue
        need = max(thresholds[q] for q in active) * len(active)  # share=max_thr -> clears all
        if spent + need <= budget:
            alloc[pid] = need
            spent += need
            unmed -= set(active)
    return alloc


@env.template()
async def allocate(seed: int = 0, budget: float = 2500.0):
    providers, thresholds = make_cohort(seed)
    n_total = len(thresholds)
    view = public_view(providers, set(thresholds))

    answer = yield (
        f"You direct a patient-access program for a branded GLP-1 diabetes therapy with a "
        f"one-time outreach budget of ${budget:.0f}. Goal: put as many undertreated Type 2 "
        f"Diabetes patients on therapy as possible.\n\n"
        f"Providers (JSON) -- each has a `region` (city), `volume`, `avg_hba1c`, and the ids "
        f"of untreated patients:\n{json.dumps(view)}\n\n"
        f"Each patient has a HIDDEN cost-to-convert that correlates with their provider's "
        f"region. You do NOT set dollar amounts. Instead, RANK the providers from most to "
        f"least cost-effective. We will fund them in your order -- each one just enough to "
        f"convert all its patients -- until the ${budget:.0f} runs out. So put the providers "
        f"whose patients are cheapest to convert (and who serve more patients per dollar) "
        f"first.\n\n"
        f"Output ONLY a JSON array of provider ids in priority order, nothing else, e.g. "
        f"[3, 7, 1, 4].\n/no_think"
    )

    ranking = parse_ranking(answer)
    alloc = ranking_to_alloc(providers, thresholds, ranking, budget)
    newly = run_round(providers, set(thresholds), thresholds, alloc)
    yield len(newly) / n_total if n_total else 0.0
