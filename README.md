# Agent Sponsorship HUD

Read-only demo dashboard for the production-mode agent. It consumes Casey's Synthea-derived patient state and response-model outputs plus William's HUD training/eval exports, then renders the judge-facing dashboard as a single-page operator cockpit.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

Open `http://127.0.0.1:8000`.

## Data Inputs

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

For Casey's production SQLite file, set `CASEY_SQLITE_PATH=/path/to/state.sqlite`. The API will read `patient_views` and `physician_views` tables with the columns from the expanded dashboard contract: patient age, diagnosis-to-treatment gap, status, physician specialty/region, panel size, dossier summary, saturation band, and cumulative sponsorship.

The playback fixture mirrors William's HUD loop:

- `get_active_patients`
- `get_budget_status`
- `allocate_funding`
- `end_round`
- `resolve_round`

Skipped patients can still convert organically in the simulated world, but `counted_in_reward` remains `false`; only funded allocations count toward cost-per-medicated.

## Endpoints

- `GET /api/health`
- `GET /api/patients`
- `GET /api/physicians`
- `GET /api/rounds`
- `GET /api/eval`
- `GET /api/playback`
- `GET /api/overview`
- `GET /api/dashboard`

## Test

```bash
python3 -m unittest discover -s tests
```
