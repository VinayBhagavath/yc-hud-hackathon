"""HUD environment: prioritize providers to maximize patient medication uptake.

Cohort: Synthea diabetes pool, feature-driven cost model (synthea_cohort), scaled
up with generate_cohort.py to ~100 patients/task. Each patient has a HIDDEN
cost-to-convert (k) = weak prior over observable features (volume, avg_hba1c,
escalation_affinity) + a dominant hidden residual. The agent sees the FEATURES,
not k -- it must judge which providers are cheap to convert. That feature->cost
relationship is the learnable signal (gradient_check.py: SIGNAL +0.11, HEADROOM
+0.34 at budget 7000).

ACTION = a PRIORITY RANKING of providers (models rank well; they budget dollars
badly). The env funds providers in the agent's order, each just enough to convert
all its untreated patients, until the one-time budget runs out.

Reward = patients converted / total.
"""

from __future__ import annotations

import json
import re

from hud import Environment

from dynamics import run_round
from synthea_cohort import make_cohort, public_view

env = Environment(name="provider-allocation", version="0.0.1")


def parse_ranking(answer) -> list[int]:
    """Extract an ordered list of provider ids (last JSON array of ints)."""
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
    untreated patients, until the budget runs out."""
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
        need = max(thresholds[q] for q in active) * len(active)
        if spent + need <= budget:
            alloc[pid] = need
            spent += need
            unmed -= set(active)
    return alloc


@env.template()
async def allocate(seed: int = 0, budget: float = 7000.0):
    providers, thresholds = make_cohort(seed)
    n_total = len(thresholds)
    view = public_view(providers, set(thresholds))   # features only -- k is hidden

    answer = yield (
        f"You direct a patient-access program for a branded GLP-1 diabetes therapy with a "
        f"one-time outreach budget of ${budget:.0f}. Goal: put as many undertreated Type 2 "
        f"Diabetes patients on therapy as possible.\n\n"
        f"Providers (JSON) -- each has observable features `volume` (provider size), "
        f"`avg_hba1c` (panel severity), `escalation_affinity` (share already escalating "
        f"therapy), a `region`, and its list of untreated patients:\n{json.dumps(view)}\n\n"
        f"Each patient has a HIDDEN cost-to-convert. The features correlate with it -- some "
        f"providers are much cheaper to convert than others -- but the exact relationship is "
        f"NOT given; judge which providers are most cost-effective from their features.\n\n"
        f"You do NOT set dollar amounts. RANK the providers from most to least cost-effective; "
        f"we fund them in your order -- each just enough to convert all its patients -- until "
        f"the ${budget:.0f} runs out.\n\n"
        f"There are {len(providers)} providers (ids 0 to {len(providers) - 1}). Output ONLY a "
        f"JSON array containing each provider id exactly once, in priority order, nothing else "
        f"-- e.g. [12, 3, 27, 5, ...].\n/no_think"
    )

    ranking = parse_ranking(answer)
    alloc = ranking_to_alloc(providers, thresholds, ranking, budget)
    newly = run_round(providers, set(thresholds), thresholds, alloc)
    yield len(newly) / n_total if n_total else 0.0
