# Synthea cohort integration (Type 2 Diabetes / GLP-1)

Replaces the placeholder `make_cohort` in `dynamics.py` with a cohort built from
**real Synthea patients**. Runs with **zero setup** — a small committed snapshot
(`cohort_data.json`) means you do **not** need Synthea or the multi-GB CSVs.

## Files added
| File | Purpose |
|------|---------|
| `synthea_cohort.py` | Drop-in `make_cohort` + `public_view`, backed by Synthea. |
| `cohort_data.json` | Small (~15 KB) snapshot of the derived provider pool. Committed so the env runs without raw data. |

## What the agent sees / what's hidden
- **Indication:** Type 2 Diabetes (SNOMED 44054006). Convertible ("undertreated")
  pool = T2D **and** latest HbA1c ≥ 7.0 **and** no GLP-1 (all of them — Synthea
  models zero GLP-1s; that's the white-space the brand team sells into).
- **Observable features** (real, from Synthea): `region` (city), `volume`
  (provider patient volume), `avg_hba1c` (panel severity).
- **Hidden `k`** (cost-to-convert, $/patient): `BASE × city_cost_tier ×
  provider_residual × per-patient_jitter`. City is the learnable signal;
  residual + jitter are hidden. This is the **only synthetic piece** — no dataset
  models promotion-response.

## Wire it into the env (one line in `env.py`)
```python
# from dynamics import make_cohort, run_round, parse_alloc, public_view
from dynamics import run_round, parse_alloc
from synthea_cohort import make_cohort, public_view
```
`run_round` / `parse_alloc` are reused unchanged. Same return contract
(`(providers_public, thresholds_hidden)`, task-local int ids).

## Inspect it
```bash
python synthea_cohort.py          # prints pool summary + an example seed=0 task
```

## Current snapshot (small — for review before scaling)
- 36 providers with an undertreated panel, 111 patients total, panels of 2–7.
- Generated from 11,536 patients (`-p 10000 -s 1`, Massachusetts).

## Regenerate / scale up
```bash
# 1. generate a bigger population (trimmed to the 7 files we use)
java -jar synthea-with-dependencies.jar -p 50000 -s 1 \
  --exporter.baseDirectory ./synthea_run --exporter.fhir.export false \
  --exporter.csv.export true \
  --exporter.csv.included_files "patients.csv,conditions.csv,observations.csv,encounters.csv,medications.csv,providers.csv,organizations.csv"

# 2. rebuild the committed snapshot from the new CSVs
SYNTHEA_CSV_DIR=./synthea_run/csv python synthea_cohort.py dump
```
Density levers if panels stay thin: lower `UNCONTROLLED_HBA1C` (7.0 → 6.5 roughly
doubles the pool), aggregate attribution to organization instead of individual
provider, or generate more patients.
