"""GRPO training loop for the provider-allocation environment.

Prereqs:
  hud set HUD_API_KEY=...                         # from hud.ai/project/api-keys
  hud eval tasks.py claude                        # sanity-check: rewards must VARY
  hud models fork Qwen/Qwen3.5-4B --name payout-rl

Then: python train.py

NOTE: the exact HUD training API (Job.start, taskset.run, TrainingClient.step,
runtime construction) moves between versions. Install the HUD docs skill and
verify these signatures before a long run. The shape below matches v6 docs.
"""

import asyncio

from hud import Job, TrainingClient
from hud.agents import create_agent

import tasks

MODEL = "payout-rl"
GROUP_SIZE = 8
ITERATIONS = 20
LEARNING_RATE = 1e-5


async def main() -> None:
    agent = create_agent(
        MODEL,
        completion_kwargs={"extra_body": {"return_token_ids": True}},
    )
    trainer = TrainingClient(MODEL)
    runtime = None  # configure per your deployment (local/docker/modal/hud)

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
