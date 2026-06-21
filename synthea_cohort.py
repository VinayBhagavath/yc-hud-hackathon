r"""Synthea-backed cohort generation -- the real-data replacement for the
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

The cost-to-convert model (``k``)
---------------------------------
``k`` = the marketing dollars to convert one patient. No dataset models
promotion-response, so we synthesize it -- but deliberately as a **weak prior
over REAL observable features plus a DOMINANT hidden residual**:

    k = BASE * exp(-beta . z(features)) * exp(RESID_SIGMA * residual) * jitter
              \___ weak, learnable ___/   \___ dominant, must be probed ___/

Why this shape (see SYNTHEA_INTEGRATION.md "Design rationale"):
- If features *fully* determined k, a strong base model would zero-shot the
  answer ("fund the big, sick, already-escalated panels") and the GRPO training
  curve would be flat -- nothing to learn.
- Making the residual dominant means observable features only give a *prior*;
  the winning policy must spend, observe who converted, and reallocate across
  the 3 rounds. That's realistic (you don't know a doc's true responsiveness
  until you promote and measure) and it's what gives a real training signal.

REAL (from Synthea), exposed to the agent:
  - volume             provider patient-volume (bigger -> cheaper prior)
  - avg_hba1c          panel severity (sicker -> cheaper prior)
  - escalation_affinity share of the provider's diabetics already on insulin,
                       i.e. willing to escalate therapy (higher -> cheaper prior)
SYNTHETIC, hidden: the per-provider residual + per-patient jitter (-> thresholds).
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import statistics as st
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
INSULIN_KEY = "insulin"          # escalation marker in medication DESCRIPTION

# Cost-to-convert model. ``BETA`` is the WEAK feature prior (signs: bigger /
# sicker / more-escalated -> cheaper, lower k). ``RESID_SIGMA`` is the DOMINANT
# hidden residual -- intentionally larger than the feature spread so the task
# rewards exploration, not just zero-shot reasoning.
BASE_COST = 200.0
BETA = {"volume": 0.25, "avg_hba1c": 0.20, "escalation_affinity": 0.35}
RESID_SIGMA = 0.80               # hidden per-provider lognormal spread (DOMINANT)
JITTER = (0.90, 1.10)            # hidden per-patient multiplier band

DEFAULT_PROVIDERS_PER_TASK = 8
MIN_PANEL = 2                    # ignore providers with a tiny undertreated panel

csv.field_size_limit(sys.maxsize)


# --------------------------------------------------------------------------- #
# Deterministic hashing -> stable hidden parameters (reproducible, no global RNG)
# --------------------------------------------------------------------------- #
def _h(*parts) -> float:
    """Stable hash of the parts -> float in [0, 1)."""
    d = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(d[:8], 16) / 0xFFFFFFFF


def _provider_resid(provider_id: str) -> float:
    """Dominant hidden residual, stable per provider, NOT observable."""
    u = _h("resid", provider_id)
    v = _h("resid2", provider_id)            # Box-Muller -> approx normal
    z = math.sqrt(-2 * math.log(max(u, 1e-9))) * math.cos(2 * math.pi * v)
    return math.exp(RESID_SIGMA * z)


def _patient_jitter(patient_id: str) -> float:
    lo, hi = JITTER
    return lo + (hi - lo) * _h("jitter", patient_id)


# --------------------------------------------------------------------------- #
# Load + parse Synthea CSVs once, cache the derived provider pool
# --------------------------------------------------------------------------- #
_POOL = None


def _stream(name: str):
    path = SYNTHEA_CSV_DIR / name
    if not path.exists():
        raise FileNotFoundError(
            f"Missing {path}. Set SYNTHEA_CSV_DIR or generate data first."
        )
    with path.open(newline="") as f:
        yield from csv.DictReader(f)


def _zscore(values):
    """Return a function mapping value -> z-score for this population."""
    mean = st.mean(values)
    sd = st.pstdev(values) or 1.0
    return lambda x: (x - mean) / sd


def _build_pool():
    """Parse Synthea -> list of providers, each with an undertreated diabetic
    panel and a hidden cost-to-convert per patient (weak feature prior +
    dominant residual). The z-score standardization is over the qualifying
    provider pool, so it is stable for a fixed dataset (recompute when you
    regenerate)."""
    # 1. diabetics
    diabetic = {r["PATIENT"] for r in _stream("conditions.csv")
                if r["CODE"] == T2D_CODE}

    # 2. latest HbA1c per diabetic
    latest = {}
    for r in _stream("observations.csv"):
        if r["CODE"] != HBA1C_CODE or r["PATIENT"] not in diabetic:
            continue
        try:
            val = float(r["VALUE"])
        except (ValueError, KeyError):
            continue
        if r["PATIENT"] not in latest or r["DATE"] > latest[r["PATIENT"]][0]:
            latest[r["PATIENT"]] = (r["DATE"], val)

    # 3. undertreated = diabetic + uncontrolled (the convertible pool, n_i)
    undertreated = {p: v for p, (_, v) in latest.items() if v >= UNCONTROLLED_HBA1C}

    # 4. escalation: diabetics already on insulin (proxy for "willing to escalate")
    insulin = {r["PATIENT"] for r in _stream("medications.csv")
               if INSULIN_KEY in r["DESCRIPTION"].lower()}

    # 5. attribute every diabetic to their most-frequent provider
    visits = defaultdict(Counter)
    for r in _stream("encounters.csv"):
        if r["PATIENT"] in diabetic and r["PROVIDER"]:
            visits[r["PATIENT"]][r["PROVIDER"]] += 1
    prov_all, prov_under = defaultdict(list), defaultdict(list)
    for p, counter in visits.items():
        prov = counter.most_common(1)[0][0]
        prov_all[prov].append(p)
        if p in undertreated:
            prov_under[prov].append(p)

    # 6. provider metadata
    meta = {r["Id"]: {"city": r["CITY"], "state": r["STATE"],
                      "volume": int(r["ENCOUNTERS"] or 0)}
            for r in _stream("providers.csv")}

    # 7. raw observable features for qualifying providers
    raw = []
    for prov, under in prov_under.items():
        if len(under) < MIN_PANEL or prov not in meta:
            continue
        alldiab = prov_all[prov]
        raw.append({
            "uuid": prov,
            "city": meta[prov]["city"], "state": meta[prov]["state"],
            "volume": meta[prov]["volume"],
            "avg_hba1c": round(st.mean(undertreated[p] for p in under), 2),
            "escalation_affinity": round(
                sum(p in insulin for p in alldiab) / len(alldiab), 3),
            "under": under,
        })
    if not raw:
        return []

    # 8. standardize features over the pool, then assign the hidden thresholds
    zf = {f: _zscore([r[f] for r in raw]) for f in BETA}
    pool = []
    for r in raw:
        log_prior = -sum(BETA[f] * zf[f](r[f]) for f in BETA)   # weak prior
        base_k = BASE_COST * math.exp(log_prior) * _provider_resid(r["uuid"])
        pool.append({
            "uuid": r["uuid"], "city": r["city"], "state": r["state"],
            "volume": r["volume"], "avg_hba1c": r["avg_hba1c"],
            "escalation_affinity": r["escalation_affinity"],
            "patients": r["under"],
            "thresholds": {p: round(base_k * _patient_jitter(p), 1)
                           for p in r["under"]},
        })
    pool.sort(key=lambda d: d["uuid"])
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
# Observable features handed to the agent (the cost-predictive ones).
FEATURES = ("volume", "avg_hba1c", "escalation_affinity")


def make_cohort(seed: int, n_providers: int = DEFAULT_PROVIDERS_PER_TASK,
                panel: int | None = None):
    """Sample a task from the real Synthea pool.

    A different ``seed`` samples a different subset of providers -> different
    optimal allocation -> the within-group reward variance GRPO needs. Returns
    ``(providers_public, thresholds_hidden)`` with task-local integer ids,
    matching ``dynamics.make_cohort``. ``panel`` is accepted for signature
    compatibility and ignored (panel sizes come from real data).
    """
    import random
    pool = _pool()
    chosen = random.Random(seed).sample(pool, min(n_providers, len(pool)))

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
            "region": prov["city"],                          # context (not cost-driving)
            "volume": prov["volume"],                        # OBSERVABLE feature
            "avg_hba1c": prov["avg_hba1c"],                  # OBSERVABLE feature
            "escalation_affinity": prov["escalation_affinity"],  # OBSERVABLE feature
            "patients": patient_ids,
        })
    return providers_public, thresholds


def public_view(providers, unmedicated: set) -> list:
    """Provider list trimmed to currently-unmedicated patients, WITH the real
    Synthea features the agent should reason over. ``thresholds`` (k) never
    appear here -- they are hidden and live only in the grader."""
    return [
        {"id": p["id"], "region": p["region"], "volume": p["volume"],
         "avg_hba1c": p["avg_hba1c"],
         "escalation_affinity": p["escalation_affinity"],
         "patients": [q for q in p["patients"] if q in unmedicated]}
        for p in providers
    ]


# --------------------------------------------------------------------------- #
# Standalone summary: `python synthea_cohort.py [dump]`
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "dump":
        dump_cache()
        _POOL = None
        print(f"Wrote {CACHE_JSON.name} from {SYNTHEA_CSV_DIR}\n")
    pool = _pool()
    n_pat = sum(len(p["patients"]) for p in pool)
    thr = [t for p in pool for t in p["thresholds"].values()]
    print(f"CSV dir: {SYNTHEA_CSV_DIR}")
    print(f"Providers with undertreated T2D panel: {len(pool)}")
    print(f"Total undertreated (T2D + HbA1c>={UNCONTROLLED_HBA1C}) patients: {n_pat}")
    print(f"Hidden $-to-convert (k): min={min(thr):.0f} "
          f"median={sorted(thr)[len(thr)//2]:.0f} max={max(thr):.0f}")

    # variance decomposition: confirm the residual really is dominant
    zf = {f: _zscore([p[f] for p in pool]) for f in BETA}
    feat_contrib = [-sum(BETA[f] * zf[f](p[f]) for f in BETA) for p in pool]
    resid = [math.log(_provider_resid(p["uuid"])) for p in pool]
    print(f"\nlog(k) variance: feature-prior std={st.pstdev(feat_contrib):.2f}  "
          f"residual std={st.pstdev(resid):.2f}  "
          f"-> residual {'DOMINANT' if st.pstdev(resid) > st.pstdev(feat_contrib) else 'NOT dominant'}")

    print("\n--- example task (seed=0) ---")
    provs, thresholds = make_cohort(0)
    for p in provs:
        print(f"  prov {p['id']}: vol={p['volume']:>6} "
              f"avgHbA1c={p['avg_hba1c']} affinity={p['escalation_affinity']} "
              f"panel={len(p['patients'])}")
    print(f"  total patients in task: {len(thresholds)}")
