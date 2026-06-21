"""Pure reward dynamics -- no HUD dependency, so it runs/tests standalone.

This is the core of the environment: cohort generation and the per-round
medication rule. ``env.py`` and ``round_driver.py`` import from here.

  <<< SYNTHEA SWAPS IN AT `run_round` >>>
"""

from __future__ import annotations

import json
import random

N_PROVIDERS = 5
PANEL = 8  # patients per provider

# PLACEHOLDER cost-effectiveness, correlated with the VISIBLE `region` feature so
# the agent has a learnable signal: patients at "N" providers medicate cheaply,
# "E" providers are expensive. The agent sees region (not thresholds), so a good
# policy learns to prioritise cheap regions. Synthea replaces this with real
# preference dynamics; until then this gives a demo a visible learning curve.
REGION_THRESHOLDS = {
    "N": [80, 120],     # cheap region -- best ROI
    "S": [200, 300],    # mid
    "E": [500, 700],    # expensive region -- worst ROI
}


def make_cohort(seed: int, n_providers: int = N_PROVIDERS, panel: int = PANEL):
    """Return (providers_public, thresholds_hidden).

    ``providers_public`` is all the agent sees: provider id, region, patient ids
    -- deliberately NO cost/threshold info, but ``region`` is correlated with
    cost (see REGION_THRESHOLDS), so it's a learnable feature. ``thresholds_hidden``
    maps patient_id -> the per-patient funding share required to medicate (the
    PLACEHOLDER stand-in for Synthea; never shown to the agent).
    """
    rng = random.Random(seed)
    providers, thresholds = [], {}
    pid = 0
    for j in range(n_providers):
        region = rng.choice(list(REGION_THRESHOLDS))
        patient_ids = []
        for _ in range(panel):
            thresholds[pid] = rng.choice(REGION_THRESHOLDS[region])  # PLACEHOLDER
            patient_ids.append(pid)
            pid += 1
        providers.append({"id": j, "region": region, "patients": patient_ids})
    return providers, thresholds


def run_round(providers, unmedicated: set, thresholds: dict, alloc: dict) -> set:
    """Return the set of patients newly medicated given this round's allocation.

    PLACEHOLDER rule: a provider's funding splits evenly across its currently
    unmedicated patients; a patient medicates iff that per-patient share meets
    their hidden threshold. Intentionally allocation-sensitive so training has a
    real gradient.

    Synthea integration: replace the body with a call that advances each
    patient's Synthea state given (patient state, provider funding) and returns
    whoever transitioned into a "medicated" state.
    """
    newly = set()
    for prov in providers:
        active = [p for p in prov["patients"] if p in unmedicated]
        if not active:
            continue
        share = alloc.get(prov["id"], 0) / len(active)
        newly |= {p for p in active if share >= thresholds[p]}
    return newly


def parse_alloc(answer) -> dict:
    """Best-effort parse of the agent's allocation into {provider_id: amount}."""
    if isinstance(answer, dict):
        raw = answer
    else:
        try:
            raw = json.loads(str(answer).strip())
        except (ValueError, TypeError):
            return {}
    out = {}
    for k, v in raw.items():
        try:
            out[int(k)] = max(0.0, float(v))
        except (ValueError, TypeError):
            continue
    return out


def public_view(providers, unmedicated: set) -> list:
    """Provider list trimmed to currently-unmedicated patients only."""
    return [
        {"id": p["id"], "region": p["region"],
         "patients": [q for q in p["patients"] if q in unmedicated]}
        for p in providers
    ]
