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
import logging
import os

from hud import Job, TrainingClient, LocalRuntime  # , HUDRuntime
from hud.agents import create_agent

import tasks

# Surface HUD's INFO logs (e.g. "running N rollouts (... x group)") so the run
# isn't silent while iteration 0 churns through rollouts before the first print.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
# ...but silence the per-HTTP-request flood from these libraries (one line per
# rollout step otherwise) so the [train] progress lines stay readable.
for _noisy in ("httpx", "httpcore", "openai", "asyncssh", "websockets", "urllib3"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# Set SMOKE_TEST=1 for a tiny, cheap run (also shrinks the taskset in tasks.py).
SMOKE_TEST = os.environ.get("SMOKE_TEST") == "1"

MODEL = "payout-q397"   # largest trainable Qwen (397B A17B) -- reliably emits tool calls
GROUP_SIZE = 4 if SMOKE_TEST else 8        # GRPO group: rollouts/task
ITERATIONS = 5 if SMOKE_TEST else 30       # on-policy steps
LEARNING_RATE = 1e-5
# Tinker is healthy now, so parallelize harder. Still capped so we don't exhaust
# local file descriptors or hammer the backend.
MAX_CONCURRENT = 4   # 397B is heavy
ROLLOUT_TIMEOUT = 600.0  # 397B + tools is slow; let rollouts finish

# Sampling temperature is REQUIRED for GRPO: rollouts in a group must differ, or
# advantage (reward - group_mean) is ~0 and nothing is learned. Keep it > 0.
TEMPERATURE = 1.0


async def main() -> None:
    agent = create_agent(
        MODEL,
        max_steps=14,                     # bound the tool loop (get_providers + a few get_patients + submit)
        completion_kwargs={
            "temperature": TEMPERATURE,
            "max_tokens": 1200,           # short thinking + tool calls (speed)
            "extra_body": {"return_token_ids": True},
        },
    )
    trainer = TrainingClient(MODEL)

    # Env runs locally; HUD does the model sampling + GRPO weight updates.
    runtime = LocalRuntime("env.py")

    n_tasks = len(tasks.taskset.tasks)
    print(f"[train] model={MODEL} tasks={n_tasks} group={GROUP_SIZE} "
          f"iterations={ITERATIONS} -> ~{n_tasks * GROUP_SIZE} rollouts/iter "
          f"at {MAX_CONCURRENT}-wide.", flush=True)

    session = await Job.start(MODEL, group=GROUP_SIZE)
    print(f"[train] job started: {session.id}  (watch live: https://hud.ai/jobs)", flush=True)

    for it in range(ITERATIONS):
        start = len(session.runs)
        print(f"[train] iter {it}: running rollouts...", flush=True)

        # Rollouts: tolerate a flaky backend -- skip the iteration rather than crash.
        try:
            await tasks.taskset.run(
                agent, runtime=runtime, job=session,
                max_concurrent=MAX_CONCURRENT, rollout_timeout=ROLLOUT_TIMEOUT,
            )
        except Exception as e:  # noqa: BLE001
            print(f"[train] iter {it}: rollouts failed ({e!r}); skipping", flush=True)
            continue

        batch = session.runs[start:]
        rewards = [r.reward for r in batch if getattr(r, "reward", None) is not None]
        errors = sum(1 for r in batch if getattr(r, "error", None))
        mean = sum(rewards) / len(rewards) if rewards else 0.0
        spread = (max(rewards) - min(rewards)) if rewards else 0.0
        print(f"[train] iter {it}: {len(batch)} rollouts, {errors} errors, "
              f"reward mean={mean:.3f} spread={spread:.3f} -> training step...", flush=True)

        if spread == 0.0:
            print(f"[train] iter {it}: zero reward spread -> no gradient, skipping step", flush=True)
            continue

        # Training step: retry once on a transient Tinker failure.
        for attempt in range(2):
            try:
                metrics = await trainer.step(
                    batch, learning_rate=LEARNING_RATE, group_size=GROUP_SIZE
                )
                print(f"[train] iter {it} DONE: {metrics}", flush=True)
                break
            except Exception as e:  # noqa: BLE001
                print(f"[train] iter {it}: step failed (attempt {attempt + 1}/2): {e!r}", flush=True)
                await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main())
