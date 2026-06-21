# YC HUD Hackathon

This repo now contains both halves of the demo system:

- Provider allocation RL environment from `provider-allocation-rl`
- Agent Sponsorship HUD dashboard/read layer on `main`

The dashboard is the judge-facing control room. The provider allocation files are
the current RL/training path and placeholder dynamics that Synthea can replace.

## Dashboard

The dashboard is a read-only FastAPI app plus a frontend. It consumes Casey's
Synthea-derived patient state and response-model outputs plus William's HUD
training/eval exports, then renders the agent's production replay.

### Frontend (Next.js — primary, animated)

`web/` is the rehauled control room: a live US **zipcode map** with animated
allocation flow lines from the agent to each location, money + people totals by
region and by person, the agent's tool calls, and a replay engine over the
playback rounds. See `web/README.md`.

```bash
# 1) API
uvicorn app.main:app --reload --port 8000

# 2) Web (in web/)
cd web && npm install && npm run dev   # http://localhost:3000
```

Geo is **zipcode-driven**: physicians carry a `zip`, resolved to lat/lon/city by
`app/geo.py` via a ZIP3-prefix centroid table (`data/geo/`). Real zipcodes can be
added to the data later and plot correctly with no code change.

### Legacy static page

The original single-page demo is still served by FastAPI at `http://127.0.0.1:8000`
(the `static/` dir) for the no-build path.

The API uses fixture JSON by default. Swap in real exports with env vars:

```bash
PATIENTS_JSON=/path/to/patients.json \
PHYSICIANS_JSON=/path/to/physicians.json \
ROUNDS_JSON=/path/to/rounds.json \
EVAL_SUMMARIES_JSON=/path/to/eval_summaries.json \
PLAYBACK_JSON=/path/to/playback.json \
TRAINING_CURVE_JSON=/path/to/training_curve.json \
TASK_RESULTS_JSON=/path/to/task_results.json \
SENSITIVITY_JSON=/path/to/sensitivity.json \
DOSE_RESPONSE_JSON=/path/to/dose_response.json \
uvicorn app.main:app --port 8000
```

For Casey's production SQLite file, set
`CASEY_SQLITE_PATH=/path/to/state.sqlite`. The API reads `patient_views` and
`physician_views` tables with the expanded dashboard contract: patient age,
diagnosis-to-treatment gap, status, physician specialty/region, panel size,
dossier summary, saturation band, and cumulative sponsorship.

The playback fixture mirrors William's HUD loop:

- `get_active_patients`
- `get_budget_status`
- `allocate_funding`
- `end_round`
- `resolve_round`

Skipped patients can still convert organically in the simulated world, but
`counted_in_reward` remains `false`; only funded allocations count toward
cost-per-medicated.

Dashboard endpoints:

- `GET /api/health`
- `GET /api/patients`
- `GET /api/physicians` (now includes `zip`/`lat`/`lon`/`city`)
- `GET /api/geo` (one resolved geo point per physician)
- `GET /api/rounds`
- `GET /api/eval`
- `GET /api/playback`
- `GET /api/overview`
- `GET /api/dashboard`

Dashboard test:

```bash
python3 -B -m unittest discover -s tests
```

## Provider Allocation RL

The RL environment trains an agent to allocate a budget across healthcare
providers so as to maximize patient medication outcomes. Money goes to
providers; patient outcomes determine the reward.

Current problem shape:

- The agent funds providers. Each provider serves a panel of patients.
- An episode is 3 rounds.
- Each round refreshes the budget.
- Medicated patients are removed from later rounds.
- Patient data shown to the agent contains no hidden threshold/cost info.

Current reward source:

The production medicate/do-not-medicate decision is intended to come from
Synthea and Casey's response model. The current provider branch uses a
deterministic placeholder in `dynamics.run_round` so the HUD pipeline can run
and train today. The placeholder is the part Synthea replaces; see
`<<< SYNTHEA SWAPS IN >>>` in `dynamics.py`.

Provider files:

| File | Purpose |
|------|---------|
| `dynamics.py` | Pure reward logic (cohort gen placeholder + per-round medication rule). No HUD dep. |
| `synthea_cohort.py` | Real Synthea diabetes cohort (`make_cohort`/`public_view`); the live data source. |
| `cohort_data.json` | Committed ~15KB cohort snapshot so the env runs with zero setup. |
| `env.py` | HUD `Environment` + the tool-free `allocate` task template. |
| `tasks.py` | Seed × budget sweep → `taskset`. |
| `train.py` | GRPO training loop. |
| `sanity_check.py` | Offline probe: confirms reward is allocation-sensitive (no HUD needed). |
| `Dockerfile.hud` / `pyproject.toml` | Packaging for `hud deploy`. |

## How the 3 rounds work (tool-free)

Trainable models (e.g. a forked Qwen) run under HUD's `openai_compatible` agent
harness, which has **no bash/shell tool** — so the env uses **no tools at all**.
Provider data is embedded in the prompt (`public_view`, costs hidden) and the
agent answers with its full plan as JSON: `{"round1": {"<provider>": amount}, ...}`.
The template parses it and simulates all `rounds` rounds server-side
(sticky removal + budget refresh) to compute the reward. This works with any
model harness and keeps the hidden cost-to-convert entirely server-side.

## Run it

```bash
pip install -r requirements.txt

# Verify the reward has a gradient, no HUD/API needed:
python sanity_check.py

# Configure HUD:
hud set HUD_API_KEY=...

# Baseline eval:
hud eval tasks.py claude

# Train:
hud models fork Qwen/Qwen3.5-4B --name payout-rl
python train.py
```

## Notes

- The dashboard models the final demo narrative: funded-only
  cost-per-medicated reward, skipped organic conversions excluded from reward,
  and a shrinking production pool.
- The provider allocation RL branch currently exposes a provider-level
  placeholder reward. Aligning `dynamics.py` with Casey's final funded-only
  patient-level reward is the next integration step.
- Hidden thresholds and authoritative round state should remain outside the
  agent workspace.
