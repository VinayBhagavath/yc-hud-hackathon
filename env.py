"""HUD environment: prioritize providers via TOOL CALLS to retrieve data.

The agent does NOT get a JSON dump. It calls tools to retrieve data on demand:
  - get_providers()            -> provider summaries (features, patient counts)
  - get_patients(provider_id)  -> that provider's patients with per-patient
                                  clinical features (hba1c, age, income)
  - submit_ranking(ranking)    -> provider ids in priority order; ends the episode
The env then funds providers in that order, each just enough to convert all its
patients, until the one-time budget runs out. Reward = fraction converted.

Cost-to-convert (k) is HIDDEN: a weak prior over the observable provider AND
per-patient features + a dominant hidden per-provider residual (synthea_cohort).
The agent must judge cost from the features it retrieves.

Built for a large tool-using model (Qwen 397B): it reasons briefly, inspects
data via tools, then submits a ranking. ~50 patients/task.
"""

from __future__ import annotations

import asyncio
import json
import re
import socket

from fastmcp import FastMCP

from hud import Environment
from hud.capabilities import Capability

from dynamics import run_round
from synthea_cohort import make_cohort

env = Environment(name="provider-allocation", version="0.1.0")
server = FastMCP(name="provider-tools")

STATE: dict = {}   # per-rollout (one child process per rollout); set by the template


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


_PORT = _free_port()


def _parse_ranking_text(answer) -> list[int]:
    """Fallback: pull an ordered list of provider ids from a text answer (last
    JSON array of ints) -- used if the model writes its ranking instead of
    calling submit_ranking."""
    if not isinstance(answer, str):
        return []
    for cand in reversed(re.findall(r"\[[^\[\]]*\]", answer)):
        try:
            arr = json.loads(cand)
        except (ValueError, TypeError):
            continue
        ids = [int(x) for x in arr if isinstance(x, (int, float))]
        if ids:
            return ids
    return []


def _score(ranking) -> float:
    alloc = _ranking_to_alloc(STATE["providers"], STATE["thresholds"], list(ranking), STATE["budget"])
    newly = run_round(STATE["providers"], set(STATE["thresholds"]), STATE["thresholds"], alloc)
    return len(newly) / STATE["n_total"] if STATE["n_total"] else 0.0


def _ranking_to_alloc(providers, thresholds, ranking, budget) -> dict[int, float]:
    prov = {p["id"]: p for p in providers}
    unmed, alloc, spent, seen = set(thresholds), {}, 0.0, set()
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


@server.tool
def get_providers() -> str:
    """List all providers with summary features (volume, avg_hba1c,
    escalation_affinity, region) and how many untreated patients each has."""
    if not STATE:
        return json.dumps({"error": "no active episode"})
    out = [{"id": p["id"], "region": p["region"], "volume": p["volume"],
            "avg_hba1c": p["avg_hba1c"], "escalation_affinity": p["escalation_affinity"],
            "n_patients": len(p["patients"])}
           for p in STATE["providers"]]
    return json.dumps({"budget": STATE["budget"], "providers": out})


@server.tool
def get_patients(provider_id: int) -> str:
    """Get one provider's untreated patients with per-patient clinical features:
    hba1c (severity), age, income. (Cost-to-convert is not shown.)"""
    if not STATE:
        return json.dumps({"error": "no active episode"})
    for p in STATE["providers"]:
        if p["id"] == provider_id:
            return json.dumps({"provider_id": provider_id, "patients": p["patient_features"]})
    return json.dumps({"error": f"no provider {provider_id}"})


@server.tool
def submit_ranking(ranking: list[int]) -> str:
    """Submit provider ids in priority order (most cost-effective first). We fund
    them in order, each just enough to convert all its patients, until the budget
    runs out. This ends the episode."""
    if not STATE:
        return json.dumps({"error": "no active episode"})
    STATE["reward"] = _score(ranking)
    STATE["submitted"] = True
    alloc = _ranking_to_alloc(STATE["providers"], STATE["thresholds"], list(ranking), STATE["budget"])
    return json.dumps({"funded_providers": sorted(alloc),
                       "converted": round(STATE["reward"] * STATE["n_total"]),
                       "n_total": STATE["n_total"], "reward": round(STATE["reward"], 3)})


_server_task: asyncio.Task | None = None


@env.initialize
async def _up():
    global _server_task
    if _server_task is None:
        _server_task = asyncio.create_task(
            server.run_async(transport="http", host="127.0.0.1", port=_PORT))
        await asyncio.sleep(1.0)
    env.add_capability(Capability.mcp(name="tools", url=f"http://127.0.0.1:{_PORT}/mcp"))


@env.shutdown
async def _down():
    global _server_task
    if _server_task is not None:
        _server_task.cancel()
        _server_task = None


@env.template()
async def allocate(seed: int = 0, budget: float = 3500.0):
    providers, thresholds = make_cohort(seed)
    STATE.clear()
    STATE.update(providers=providers, thresholds=thresholds,
                 budget=budget, n_total=len(thresholds), reward=0.0, submitted=False)

    answer = yield (
        f"You direct a patient-access program for a branded GLP-1 diabetes therapy with a "
        f"one-time outreach budget of ${budget:.0f}. Goal: put as many undertreated Type 2 "
        f"Diabetes patients on therapy as possible.\n\n"
        f"Use the tools to investigate, then submit a plan:\n"
        f"  - get_providers() -- provider summaries (volume, avg_hba1c, escalation_affinity, "
        f"region, patient count)\n"
        f"  - get_patients(provider_id) -- a provider's patients with per-patient hba1c, age, "
        f"income\n"
        f"  - submit_ranking([...]) -- provider ids in priority order (most cost-effective "
        f"first)\n\n"
        f"Each patient has a HIDDEN cost-to-convert that the features only hint at (some "
        f"providers/patients are much cheaper than others). We fund providers in your ranked "
        f"order -- each just enough to convert all its patients -- until the ${budget:.0f} "
        f"runs out, so rank the most cost-effective providers first.\n\n"
        f"Inspect what you need with the tools, then IMMEDIATELY call the submit_ranking tool "
        f"with every provider id in priority order. Do NOT write a per-provider summary or a "
        f"long analysis -- your final action must be the submit_ranking tool call itself."
    )

    # Prefer the tool submission; fall back to a ranking written in the final text.
    if not STATE.get("submitted"):
        ranking = _parse_ranking_text(answer)
        if ranking:
            STATE["reward"] = _score(ranking)
    yield STATE.get("reward", 0.0)
