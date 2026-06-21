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

from hud import Job, TrainingClient, HUDRuntime  # , LocalRuntime
from hud.agents import create_agent

import tasks

MODEL = "payout-rl"
GROUP_SIZE = 8
ITERATIONS = 20
LEARNING_RATE = 1e-5

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

    # Cloud rollouts on HUD infra (this is the "train through HUD" path).
    # Requires `hud deploy` first. For local iteration instead, use:
    #   runtime = LocalRuntime("env.py")
    runtime = HUDRuntime()

    session = await Job.start(MODEL, group=GROUP_SIZE)
    for it in range(ITERATIONS):
        start = len(session.runs)
        await tasks.taskset.run(agent, runtime=runtime, job=session)
        batch = session.runs[start:]
        metrics = await trainer.step(
            batch, learning_rate=LEARNING_RATE, group_size=GROUP_SIZE
        )
        print(f"iter {it}: {metrics}")


if __name__ == "__main__":
    asyncio.run(main())
