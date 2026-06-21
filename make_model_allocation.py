"""Generate data/fixtures/model_allocation.json from the trained model's REAL
submit_ranking output, so the frontend US map can display the model's provider
ranking and per-provider money allocation.

The ranking below was emitted by the trained model (payout-q397b) via its
submit_ranking tool call during a training rollout (seed 0 cohort). The env's
funding rule (fund each provider in rank order, just enough to convert all its
patients, until the budget runs out) turns that ranking into dollar amounts.

Run: python make_model_allocation.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from synthea_cohort import make_cohort
from dynamics import run_round

SEED, BUDGET = 0, 3500.0
MODEL = "payout-q397b"
# Real submit_ranking output captured from a training rollout trace.
RANKING = [0, 2, 6, 4, 9, 8, 5, 1, 7, 3]

# Real coordinates for the Massachusetts towns in this cohort.
MA_COORDS = {
    "SOUTHBOROUGH": (42.305, -71.525), "SPRINGFIELD": (42.101, -72.590),
    "WESTBOROUGH": (42.269, -71.616), "UPTON": (42.174, -71.602),
    "PITTSFIELD": (42.450, -73.245), "HAVERHILL": (42.776, -71.077),
    "NORWOOD": (42.194, -71.199), "NORTHAMPTON": (42.328, -72.630),
    "OAK BLUFFS": (41.455, -70.562), "HOLYOKE": (42.204, -72.611),
}


def coords(city: str) -> tuple[float, float]:
    if city in MA_COORDS:
        return MA_COORDS[city]
    h = int(hashlib.sha256(city.encode()).hexdigest()[:8], 16)  # deterministic MA-bbox fallback
    return (41.5 + (h % 1000) / 1000 * 1.3, -73.3 + ((h // 1000) % 1000) / 1000 * 3.3)


def ranking_to_alloc(providers, thr, ranking, budget):
    prov = {p["id"]: p for p in providers}
    unmed, alloc, spent, seen = set(thr), {}, 0.0, set()
    for pid in ranking:
        p = prov.get(pid)
        if p is None or pid in seen:
            continue
        seen.add(pid)
        active = [q for q in p["patients"] if q in unmed]
        if not active:
            continue
        need = max(thr[q] for q in active) * len(active)
        if spent + need <= budget:
            alloc[pid] = need
            spent += need
            unmed -= set(active)
    return alloc


def main() -> None:
    providers, thr = make_cohort(SEED)
    alloc = ranking_to_alloc(providers, thr, RANKING, BUDGET)
    converted = len(run_round(providers, set(thr), thr, alloc))
    by_id = {p["id"]: p for p in providers}

    ranking_rows, base, byreg = [], [], []
    for rank, pid in enumerate(RANKING, 1):
        p = by_id[pid]
        city = p["region"]
        lat, lon = coords(city)
        amt = alloc.get(pid, 0.0)
        npat = len(p["patients"])
        conv = npat if pid in alloc else 0
        ranking_rows.append({
            "rank": rank, "provider_id": pid, "region": city,
            "allocation_usd": round(amt, 2), "n_patients": npat,
            "converted": conv, "funded": pid in alloc,
        })
        base.append({"region": city, "lat": lat, "lon": lon})
        byreg.append({"region": city, "funded": conv, "medicated": conv, "spend": round(amt, 2)})

    out = {
        "seed": SEED, "budget": BUDGET, "model": MODEL,
        "total_converted": converted, "n_total": len(thr),
        "total_spend": round(sum(alloc.values()), 2),
        "ranking": ranking_rows, "baseRegions": base, "byRegion": byreg,
    }
    Path("data/fixtures/model_allocation.json").write_text(json.dumps(out, indent=2))
    print(f"wrote data/fixtures/model_allocation.json: "
          f"{converted}/{len(thr)} converted, ${out['total_spend']:.0f} spent, "
          f"{sum(1 for r in ranking_rows if r['funded'])} providers funded")


if __name__ == "__main__":
    main()
