# Provider Allocation RL (HUD)

Train an agent to allocate a budget across healthcare **providers** so as to
maximize the number of **patients** who end up medicated. Money goes to
providers; the reward is measured on patient outcomes.

## Problem shape

- The agent funds providers (not patients directly). Each provider serves a
  panel of patients.
- An **episode is 3 rounds**. Each round the budget is **fully refreshed**, the
  agent re-allocates, some patients get medicated, and **medicated patients are
  removed** from later rounds (once medicated, they stay medicated).
- **Reward** = total patients medicated across all rounds / initial patient
  count, in `[0, 1]`.
- Patient data shown to the agent contains **no cost/threshold info** — the
  agent must infer where funding converts to outcomes.

## Reward source

In production the medicate / don't-medicate decision comes from **Synthea**
(synthetic patients with transition-modeled provider preferences). It is **not
implemented yet** — `dynamics.run_round` uses a deterministic **placeholder**
rule so the whole pipeline runs and trains today. The placeholder is the only
thing Synthea replaces; see `<<< SYNTHEA SWAPS IN >>>` in `dynamics.py`.

## Files

| File | Purpose |
|------|---------|
| `dynamics.py` | Pure reward logic (cohort gen + per-round medication rule). No HUD dep. **Synthea swaps in here.** |
| `env.py` | HUD `Environment` + the `allocate` task template (workspace shell). |
| `apply_round.py` | Round driver the agent runs in its workspace shell once per round. |
| `tasks.py` | Seed × budget sweep → `tasks` (eval) and `taskset` (train). |
| `train.py` | GRPO training loop. |
| `sanity_check.py` | Offline probe: confirms reward is allocation-sensitive (no HUD needed). |
| `Dockerfile.hud` / `pyproject.toml` | Packaging for `hud deploy`. |

## How the 3 rounds work

HUD templates are single-turn (`yield prompt` → agent acts → `yield reward`);
multi-step work happens in a **workspace shell** between the two yields. So the
agent drives the 3 rounds by running `python apply_round.py` once per round:
read `patients.json` → write `alloc.json` → run the driver (applies the round,
removes medicated patients, refreshes the budget, rewrites `patients.json`).
The template reads the final state to compute the reward.

## Run it

```bash
pip install -r requirements.txt

# 1. Verify the reward has a gradient (no HUD/API needed):
python sanity_check.py

# 2. Configure HUD:
hud set HUD_API_KEY=...          # from hud.ai/project/api-keys

# 3. Baseline eval — confirm rewards VARY across rollouts:
hud eval tasks.py claude

# 4. Train:
hud models fork Qwen/Qwen3.5-4B --name payout-rl
python train.py
```

## Notes / caveats

- **GRPO needs reward variance.** The seed sweep in `tasks.py` provides it. If a
  group's rollouts all score the same, there's no advantage signal and nothing
  is learned.
- **HUD API drift.** `Job.start`, `taskset.run`, `TrainingClient.step`, and
  runtime construction in `train.py` match the v6 docs but move between versions
  — verify with the HUD docs skill.
- **No reward tampering.** Hidden thresholds / authoritative round state live
  outside the agent's `/workspace`.
- **Tune difficulty** via `N_PROVIDERS`, `PANEL`, threshold distribution
  (`dynamics.py`) and the budget sweep (`tasks.py`).
