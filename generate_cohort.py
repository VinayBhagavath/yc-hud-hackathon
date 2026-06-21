"""Scale up the cohort using the feature-driven-k algorithm.

Real Synthea data is thin (36 providers / 111 patients). This keeps the real
providers and BOOTSTRAPS more synthetic ones: it resamples the real feature
distribution (volume, avg_hba1c, escalation_affinity, panel size) and applies
the SAME cost model as synthea_cohort -- weak feature prior + dominant hidden
per-provider residual + per-patient jitter. z-scores are recomputed over the
combined pool so the prior stays calibrated. Overwrites cohort_data.json (the
real data is always recoverable from the synthea-feature-driven-k branch).

Usage: python generate_cohort.py [TOTAL_PROVIDERS]   # default 360
"""

from __future__ import annotations

import json
import math
import random
import sys

from synthea_cohort import (
    BASE_COST, BETA, CACHE_JSON, _patient_jitter, _provider_resid, _zscore,
)


def generate(total: int = 360, seed: int = 7) -> None:
    real = json.loads(CACHE_JSON.read_text())
    rng = random.Random(seed)
    panels = [len(p["patients"]) for p in real]

    # Real providers keep their uuids/patients; start the raw feature table.
    raw = [{"uuid": p["uuid"], "city": p.get("city", "REAL"),
            "state": p.get("state", "MA"), "volume": p["volume"],
            "avg_hba1c": p["avg_hba1c"],
            "escalation_affinity": p["escalation_affinity"],
            "patients": list(p["patients"])}
           for p in real]

    i = 0
    while len(raw) < total:
        base = rng.choice(real)
        vol = max(500, int(base["volume"] * math.exp(rng.gauss(0, 0.30))))
        hba = round(min(11.0, max(7.0, base["avg_hba1c"] + rng.gauss(0, 0.35))), 2)
        esc = round(min(0.9, max(0.0, base["escalation_affinity"] + rng.gauss(0, 0.10))), 3)
        uuid = f"synth-{i:05d}"
        pats = [f"{uuid}-p{j}" for j in range(rng.choice(panels))]
        raw.append({"uuid": uuid, "city": "SYNTHETIC", "state": "MA",
                    "volume": vol, "avg_hba1c": hba,
                    "escalation_affinity": esc, "patients": pats})
        i += 1

    # Recompute z over the combined pool, then assign hidden thresholds (k).
    zf = {f: _zscore([r[f] for r in raw]) for f in BETA}
    pool = []
    for r in raw:
        log_prior = -sum(BETA[f] * zf[f](r[f]) for f in BETA)          # weak prior
        base_k = BASE_COST * math.exp(log_prior) * _provider_resid(r["uuid"])  # +residual
        pool.append({
            "uuid": r["uuid"], "city": r["city"], "state": r["state"],
            "volume": r["volume"], "avg_hba1c": r["avg_hba1c"],
            "escalation_affinity": r["escalation_affinity"],
            "patients": r["patients"],
            "thresholds": {p: round(base_k * _patient_jitter(p), 1) for p in r["patients"]},
        })
    pool.sort(key=lambda d: d["uuid"])
    CACHE_JSON.write_text(json.dumps(pool))

    npat = sum(len(p["patients"]) for p in pool)
    nreal = len(real)
    print(f"wrote {len(pool)} providers / {npat} patients "
          f"({nreal} real + {len(pool) - nreal} synthetic) -> {CACHE_JSON.name}")


if __name__ == "__main__":
    generate(int(sys.argv[1]) if len(sys.argv) > 1 else 360)
