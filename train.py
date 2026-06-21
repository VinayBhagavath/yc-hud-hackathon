"""GRPO training loop for the provider-allocation environment.

Runs on HUD's cloud by default (rollouts on HUDRuntime, training server-side via
TrainingClient). Monitor at hud.ai, `hud jobs`, and `hud models checkpoints`.

Setup
-----
  pip install -r requirements.txt
  hud set HUD_API_KEY=...                         # from hud.ai/project/api-keys

  # Sanity-check the reward gradient locally first (no HUD needed):
  python sanity_check.py

  # Deploy env + taskset to HUD so rollouts run in the cloud:
  hud deploy                                       # build/register env image on HUD
  hud sync tasks provider-allocation               # publish the taskset
  hud eval tasks.py claude --remote                # baseline; confirm rewards VARY

  # Make a trainable model and train:
  hud models fork Qwen/Qwen3.5-4B --name payout-rl
  python train.py

NOTE: HUD's training API and runtime classes move between versions. Verify
Job.start / taskset.run / TrainingClient.step / HUDRuntime / create_agent kwargs
against the HUD docs skill before a long run.
"""

import asyncio
import os

from hud import Job, TrainingClient, LocalRuntime  # , HUDRuntime
from hud.agents import create_agent

import tasks

# Set SMOKE_TEST=1 for a tiny, cheap run (also shrinks the taskset in tasks.py).
SMOKE_TEST = os.environ.get("SMOKE_TEST") == "1"

MODEL = "payout-rl"
GROUP_SIZE = 4 if SMOKE_TEST else 8
ITERATIONS = 2 if SMOKE_TEST else 20
LEARNING_RATE = 1e-5
# Cap concurrent rollouts -- unbounded gather opens too many sockets/processes
# and hits the OS file-descriptor limit (Errno 24: Too many open files).
MAX_CONCURRENT = 4
ROLLOUT_TIMEOUT = 300.0  # per-rollout wall-clock cap (s) so one stuck rollout can't wedge the batch

# Sampling temperature is REQUIRED for GRPO: rollouts in a group must differ, or
# advantage (reward - group_mean) is ~0 and nothing is learned. Keep it > 0.
TEMPERATURE = 1.0


async def main() -> None:
    agent = create_agent(
        MODEL,
        completion_kwargs={
            "temperature": TEMPERATURE,
            "extra_body": {"return_token_ids": True},
        },
    )
    trainer = TrainingClient(MODEL)

    # Rollouts serve the env LOCALLY (same path as `hud eval`); the model is
    # still sampled through the HUD gateway and weight updates run on HUD via
    # TrainingClient. Swap to HUDRuntime() to run the env on HUD infra too
    # (needs `hud deploy` first).
    runtime = LocalRuntime("env.py")

    session = await Job.start(MODEL, group=GROUP_SIZE)
    for it in range(ITERATIONS):
        start = len(session.runs)
        await tasks.taskset.run(
            agent, runtime=runtime, job=session,
            max_concurrent=MAX_CONCURRENT, rollout_timeout=ROLLOUT_TIMEOUT,
        )
        batch = session.runs[start:]
        metrics = await trainer.step(
            batch, learning_rate=LEARNING_RATE, group_size=GROUP_SIZE
        )
        print(f"iter {it}: {metrics}")


if __name__ == "__main__":
    asyncio.run(main())
