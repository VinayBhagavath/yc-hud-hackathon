"""Synthea-backed cohort generation -- the real-data replacement for the
placeholder ``make_cohort`` in ``dynamics.py``.

  <<< THIS IS WHAT SYNTHEA SWAPS IN >>>

Same contract as ``dynamics.make_cohort`` -- returns ``(providers_public,
thresholds_hidden)`` with task-local integer ids -- so ``dynamics.run_round``
and ``dynamics.parse_alloc`` are reused unchanged. To switch the environment
over, change ``env.py``'s import from::

    from dynamics import make_cohort, run_round, parse_alloc, public_view

to::

    from dynamics import run_round, parse_alloc
    from synthea_cohort import make_cohort, public_view

Indication: **Type 2 Diabetes**, marketing a branded GLP-1. The convertible
("undertreated") pool is: has T2D *and* latest HbA1c >= UNCONTROLLED_HBA1C *and*
not already on a GLP-1 (trivially all -- Synthea models no GLP-1s, which is the
white-space the brand team is selling into).

What is real vs synthetic
-------------------------
- REAL (from Synthea): which providers exist, their geography & patient volume,
  which of their patients are undertreated diabetics, and each panel's clinical
  profile (avg HbA1c). These are the agent's observable features.
- SYNTHETIC (here): ``k`` -- the marketing dollars needed to convert a patient.
  No dataset models promotion-response, so we build it from the REAL features
  (city cost-tier) + hidden noise. This is the only invented piece.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
SYNTHEA_CSV_DIR = Path(
    os.environ.get("SYNTHEA_CSV_DIR", str(Path.home() / "Downloads/synthea_run/csv"))
)
# Small, committed snapshot of the derived pool so the env runs WITHOUT the raw
# (multi-GB) Synthea CSVs. Built by `python synthea_cohort.py dump`; preferred
# over re-parsing CSVs when present.
CACHE_JSON = Path(__file__).with_name("cohort_data.json")

T2D_CODE = "44054006"            # SNOMED: Diabetes mellitus type 2 (disorder)
HBA1C_CODE = "4548-4"           # LOINC: Hemoglobin A1c
UNCONTROLLED_HBA1C = 7.0         # ADA control target is <7%; >= 7 == undertreated

# Cost-to-convert model (dollars per patient). Mirrors the scale of the
# placeholder REGION_THRESHOLDS (~80-700). City is the OBSERVABLE, learnable
# signal; the provider residual and per-patient jitter are HIDDEN.
BASE_COST = 200.0
CITY_TIERS = (0.5, 1.0, 2.0)     # cheap / mid / expensive, assigned per-city
RESID_SIGMA = 0.30               # hidden per-provider lognormal spread
JITTER = (0.85, 1.15)            # hidden per-patient multiplier band

DEFAULT_PROVIDERS_PER_TASK = 8
MIN_PANEL = 2                    # ignore providers with a tiny undertreated panel

CSV_FIELD_LIMIT = sys.maxsize
csv.field_size_limit(CSV_FIELD_LIMIT)


# --------------------------------------------------------------------------- #
# Deterministic hashing -> stable hidden parameters (reproducible, no global RNG)
# --------------------------------------------------------------------------- #
def _h(*parts) -> float:
    """Stable hash of the parts -> float in [0, 1)."""
    s = "|".join(str(p) for p in parts)
    d = hashlib.sha256(s.encode()).hexdigest()
    return int(d[:8], 16) / 0xFFFFFFFF


def _city_tier(city: str) -> float:
    return CITY_TIERS[int(_h("city", city) * len(CITY_TIERS))]


def _provider_resid(provider_id: str) -> float:
    # lognormal-ish hidden residual, stable per provider, NOT observable
    u = _h("resid", provider_id)
    # map uniform -> approx normal via inverse-erf-free trick (two-sample)
    v = _h("resid2", provider_id)
    z = math.sqrt(-2 * math.log(max(u, 1e-9))) * math.cos(2 * math.pi * v)
    return math.exp(RESID_SIGMA * z)


def _patient_jitter(patient_id: str) -> float:
    lo, hi = JITTER
    return lo + (hi - lo) * _h("jitter", patient_id)


# --------------------------------------------------------------------------- #
# Load + parse Synthea CSVs once, cache the derived provider pool
# --------------------------------------------------------------------------- #
_POOL = None  # cached list of provider dicts (UUID-keyed, full population)


def _stream(name: str):
    path = SYNTHEA_CSV_DIR / name
    if not path.exists():
        raise FileNotFoundError(
            f"Missing {path}. Set SYNTHEA_CSV_DIR or generate data first."
        )
    with path.open(newline="") as f:
        yield from csv.DictReader(f)


def _build_pool():
    """Parse Synthea -> list of providers, each with an undertreated diabetic
    panel and a hidden cost-to-convert per patient. Cached after first call."""
    # 1. diabetics
    diabetic = {row["PATIENT"] for row in _stream("conditions.csv")
                if row["CODE"] == T2D_CODE}

    # 2. latest HbA1c per diabetic
    latest = {}  # patient -> (date, value)
    for row in _stream("observations.csv"):
        if row["CODE"] != HBA1C_CODE or row["PATIENT"] not in diabetic:
            continue
        try:
            val = float(row["VALUE"])
        except (ValueError, KeyError):
            continue
        d = row["DATE"]
        if row["PATIENT"] not in latest or d > latest[row["PATIENT"]][0]:
            latest[row["PATIENT"]] = (d, val)

    # 3. undertreated = diabetic + uncontrolled
    undertreated = {p: v for p, (_, v) in latest.items() if v >= UNCONTROLLED_HBA1C}

    # 4. attribute each undertreated patient to their most-frequent provider
    visits = defaultdict(Counter)  # patient -> Counter(provider)
    for row in _stream("encounters.csv"):
        p = row["PATIENT"]
        prov = row["PROVIDER"]
        if p in undertreated and prov:
            visits[p][prov] += 1
    panel = defaultdict(list)      # provider -> [patient...]
    for p, counter in visits.items():
        prov = counter.most_common(1)[0][0]
        panel[prov].append(p)

    # 5. provider metadata
    meta = {}
    for row in _stream("providers.csv"):
        meta[row["Id"]] = {
            "city": row["CITY"], "state": row["STATE"],
            "volume": int(row["ENCOUNTERS"] or 0),
        }

    # 6. assemble pool
    pool = []
    for prov, patients in panel.items():
        if len(patients) < MIN_PANEL or prov not in meta:
            continue
        m = meta[prov]
        hba1cs = [undertreated[p] for p in patients]
        pool.append({
            "uuid": prov,
            "city": m["city"],
            "state": m["state"],
            "volume": m["volume"],
            "patients": patients,                 # patient UUIDs
            "avg_hba1c": round(sum(hba1cs) / len(hba1cs), 2),
            "thresholds": {                        # hidden $-to-convert per patient
                p: round(BASE_COST * _city_tier(m["city"])
                         * _provider_resid(prov) * _patient_jitter(p), 1)
                for p in patients
            },
        })
    pool.sort(key=lambda d: d["uuid"])  # stable order
    return pool


def dump_cache(path: Path = CACHE_JSON):
    """Build the pool from raw Synthea CSVs and write the small JSON snapshot."""
    pool = _build_pool()
    path.write_text(json.dumps(pool))
    return pool


def _pool():
    """Return the derived pool. Prefer the committed JSON snapshot (fast, no raw
    CSVs needed); fall back to parsing the Synthea CSVs if it's absent."""
    global _POOL
    if _POOL is None:
        if CACHE_JSON.exists():
            _POOL = json.loads(CACHE_JSON.read_text())
        elif SYNTHEA_CSV_DIR.exists():
            _POOL = _build_pool()
        else:
            raise FileNotFoundError(
                f"Neither {CACHE_JSON.name} nor {SYNTHEA_CSV_DIR} found. "
                "Run `python synthea_cohort.py dump` where the CSVs live."
            )
        if not _POOL:
            raise RuntimeError("No providers with an undertreated diabetic panel "
                               "found -- check the indication filters / data size.")
    return _POOL


# --------------------------------------------------------------------------- #
# Public API: drop-in replacements for dynamics.make_cohort / public_view
# --------------------------------------------------------------------------- #
def make_cohort(seed: int, n_providers: int = DEFAULT_PROVIDERS_PER_TASK,
                panel: int | None = None):
    """Sample a task from the real Synthea pool.

    A different ``seed`` samples a different subset of providers -> different
    optimal allocation -> the within-group reward variance GRPO needs. Returns
    ``(providers_public, thresholds_hidden)`` with task-local integer ids,
    matching ``dynamics.make_cohort``. ``panel`` is accepted for signature
    compatibility and ignored (panel sizes come from real data).
    """
    pool = _pool()
    rng = random.Random(seed)
    chosen = rng.sample(pool, min(n_providers, len(pool)))

    providers_public, thresholds = [], {}
    next_pid = 0
    for j, prov in enumerate(chosen):
        patient_ids = []
        for puuid in prov["patients"]:
            thresholds[next_pid] = prov["thresholds"][puuid]
            patient_ids.append(next_pid)
            next_pid += 1
        providers_public.append({
            "id": j,
            "region": prov["city"],          # OBSERVABLE, correlated with cost
            "volume": prov["volume"],         # OBSERVABLE provider size
            "avg_hba1c": prov["avg_hba1c"],   # OBSERVABLE panel severity
            "patients": patient_ids,
        })
    return providers_public, thresholds


def public_view(providers, unmedicated: set) -> list:
    """Provider list trimmed to currently-unmedicated patients, WITH the real
    Synthea features the agent should reason over (region, volume, avg HbA1c)."""
    return [
        {"id": p["id"], "region": p["region"], "volume": p["volume"],
         "avg_hba1c": p["avg_hba1c"],
         "patients": [q for q in p["patients"] if q in unmedicated]}
        for p in providers
    ]


# --------------------------------------------------------------------------- #
# Standalone summary: `python synthea_cohort.py`
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "dump":
        dump_cache()
        _POOL = None  # force reload from the freshly written cache below
        print(f"Wrote {CACHE_JSON.name} from {SYNTHEA_CSV_DIR}\n")
    pool = _pool()
    n_pat = sum(len(p["patients"]) for p in pool)
    print(f"CSV dir: {SYNTHEA_CSV_DIR}")
    print(f"Providers with undertreated T2D panel: {len(pool)}")
    print(f"Total undertreated (T2D + HbA1c>={UNCONTROLLED_HBA1C}) patients: {n_pat}")
    cities = Counter(p["city"] for p in pool)
    print(f"Distinct cities (regions): {len(cities)}  top: {cities.most_common(5)}")
    thr = [t for p in pool for t in p["thresholds"].values()]
    print(f"Hidden $-to-convert: min={min(thr):.0f} "
          f"median={sorted(thr)[len(thr)//2]:.0f} max={max(thr):.0f}")
    print("\n--- example task (seed=0) ---")
    provs, thresholds = make_cohort(0)
    for p in provs:
        print(f"  prov {p['id']}: region={p['region']!r} vol={p['volume']} "
              f"avgHbA1c={p['avg_hba1c']} panel={len(p['patients'])}")
    print(f"  total patients in task: {len(thresholds)}")
