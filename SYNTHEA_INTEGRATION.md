# Synthea cohort integration (Type 2 Diabetes / GLP-1)

Replaces the placeholder `make_cohort` in `dynamics.py` with a cohort built from
**real Synthea patients**, where the hidden cost-to-convert (`k`) is a **weak
prior over real observable features + a dominant hidden residual** — designed so
the task is *learnable but not trivially solvable*.

Runs with **zero setup**: a small committed snapshot (`cohort_data.json`) means
you do **not** need Synthea or the multi-GB CSVs.

## Files
| File | Purpose |
|------|---------|
| `synthea_cohort.py` | Drop-in `make_cohort` + `public_view`, backed by Synthea. |
| `cohort_data.json` | ~16 KB snapshot of the derived provider pool (committed). |
| `gradient_check.py` | Validates the env on the real cohort: feature **signal** + training **headroom**. |

## Wire it into the env (one line in `env.py`)
```python
# from dynamics import make_cohort, run_round, parse_alloc, public_view
from dynamics import run_round, parse_alloc
from synthea_cohort import make_cohort, public_view
```
`run_round` / `parse_alloc` are reused unchanged. Same return contract
(`(providers_public, thresholds_hidden)`, task-local int ids).

## Indication & the convertible pool
- T2D = SNOMED `44054006`. **Undertreated** = T2D **and** latest HbA1c ≥ 7.0
  **and** no GLP-1 (all of them — Synthea models zero GLP-1s; that's the
  white-space the brand team sells into).
- Patient → provider by most-frequent encounter.

## The cost-to-convert model (`k`) — and why it's shaped this way
```
k = BASE × exp(−β·z(features)) × exp(RESID_SIGMA·residual) × per-patient jitter
          \___ weak, learnable ___/   \___ DOMINANT, must be probed ___/
```
- **Observable features** (real, from Synthea, exposed to the agent):
  `volume`, `avg_hba1c`, `escalation_affinity` (= share of a provider's diabetics
  already on insulin, i.e. willing to escalate therapy). Bigger / sicker /
  more-escalated → cheaper to convert.
- **Hidden** (grader only): the per-provider `residual` + per-patient `jitter`,
  baked into `thresholds`.

**Why a weak prior + dominant residual** (this is the key design decision):
- If features *fully* determined `k`, a strong base model would zero-shot the
  answer ("fund the big, sick, escalated panels") → flat GRPO curve, nothing to
  learn.
- Making the residual dominant means features are only a *prior*; the winning
  policy must spend, see who converted, and reallocate across the 3 rounds.
  That's realistic (you don't know a doc's true responsiveness until you promote
  and measure) **and** it's what creates a real training signal.

## Validation — `python gradient_check.py`
Two things must hold (measured over 40 seeds, in the scarce-budget regime):

| Metric | Meaning | Result |
|---|---|---|
| **SIGNAL** = feature_static − even | Do observable features carry learnable info? | **+0.16** ✅ |
| **HEADROOM** = cheats_cheapest − feature_static | Room above the best *simple* rule? | **+0.29** ✅ |

A crude 3-round adaptive heuristic recovers ≈0 of that headroom — i.e. closing
the gap needs a **learned, $-calibrated policy**. That gap *is* the RL task.

```
budget |   none    even  concentrate  feature_static  adaptive  cheats_cheapest
   600 |  0.000   0.037     0.039        0.172          0.172       0.432
  1500 |  0.000   0.213     0.240        0.435          0.440       0.785
  3000 |  0.000   0.641     0.513        0.709          0.705       0.943
```

## ⚠️ Important findings for the next step
1. **Budget must be scarce or the task is trivial.** At budget ≥ 6000, plain
   `even`-split already scores ~1.0 — there's no allocation decision. The
   interesting regime is **~1000–2200** (where `even` ≈ 0.1–0.4). **Lower the
   budgets in `tasks.py`** from `(3000, 4000, 6000)` to roughly `(1000, 1500, 2200)`.
2. **Data is thin.** 36 providers / 111 undertreated patients, panels of 2–7.
   Fine to validate; light for training. Scale up before a real run.

## Tuning knobs (top of `synthea_cohort.py`)
| Knob | Effect |
|---|---|
| `UNCONTROLLED_HBA1C` (7.0) | Lower → bigger pool (6.5 ≈ doubles it). |
| `BETA` | Feature-prior strength. Bigger → more learnable signal, but risks trivial. |
| `RESID_SIGMA` (0.80) | Hidden-residual spread. Bigger → more headroom / harder. |
| `MIN_PANEL` (2) | Min undertreated panel to include a provider. |
| `DEFAULT_PROVIDERS_PER_TASK` (8) | Providers sampled per task. |
| budgets in `tasks.py` | Scarcity. See finding #1. |

## Regenerate / scale up
```bash
# 1. bigger population (trimmed to the 7 files we use)
java -jar synthea-with-dependencies.jar -p 50000 -s 1 \
  --exporter.baseDirectory ./synthea_run --exporter.fhir.export false \
  --exporter.csv.export true \
  --exporter.csv.included_files "patients.csv,conditions.csv,observations.csv,encounters.csv,medications.csv,providers.csv,organizations.csv"

# 2. rebuild the committed snapshot (feature z-scores recompute over the new pool)
SYNTHEA_CSV_DIR=./synthea_run/csv python synthea_cohort.py dump

# 3. re-validate
python gradient_check.py
```
Density levers if panels stay thin: lower `UNCONTROLLED_HBA1C`, aggregate
attribution to organization instead of individual provider, or generate more
patients.
