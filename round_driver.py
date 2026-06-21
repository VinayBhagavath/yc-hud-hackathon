"""Workspace round-driver for the `allocate_tool` template (fallback path).

Run by the agent as `python /authoritative/round_driver.py` after writing its
allocation to /workspace/alloc.json. Applies one round using the authoritative
(tamper-proof) state, refreshes the budget, removes medicated patients, and
updates the workspace files the agent reads next round.

Lives under /authoritative on purpose: the agent can execute it but cannot edit
the thresholds or the medicated set it reads from there.
"""

from __future__ import annotations

import json
from pathlib import Path

from dynamics import run_round, parse_alloc, public_view

ROOT = Path("/workspace")
AUTH = Path("/authoritative")


def main() -> None:
    cfg = json.loads((AUTH / "config.json").read_text())
    thresholds = {int(k): v for k, v in json.loads((AUTH / "thresholds.json").read_text()).items()}
    providers = json.loads((AUTH / "providers.json").read_text())

    if cfg["round"] >= cfg["rounds"]:
        print("All rounds already used.")
        return

    medicated = set(cfg["medicated"])
    unmedicated = set(thresholds) - medicated

    alloc = parse_alloc((ROOT / "alloc.json").read_text())
    if sum(alloc.values()) > cfg["budget"]:
        print(f"Over budget (${sum(alloc.values()):.0f} > ${cfg['budget']:.0f}); round wasted.")
        newly = set()
    else:
        newly = run_round(providers, unmedicated, thresholds, alloc)

    medicated |= newly
    cfg["medicated"] = sorted(medicated)
    cfg["round"] += 1
    reward = len(medicated) / cfg["n_total"] if cfg["n_total"] else 0.0
    cfg["reward"] = reward
    (AUTH / "config.json").write_text(json.dumps(cfg))

    # Refresh workspace view for the next round.
    (ROOT / "patients.json").write_text(
        json.dumps(public_view(providers, set(thresholds) - medicated), indent=2)
    )
    (ROOT / "state.json").write_text(
        json.dumps({"round": cfg["round"], "rounds": cfg["rounds"],
                    "medicated_total": len(medicated), "reward": reward})
    )

    print(f"Round {cfg['round']}/{cfg['rounds']}: +{len(newly)} medicated "
          f"({len(medicated)}/{cfg['n_total']} total). Running reward: {reward:.3f}")


if __name__ == "__main__":
    main()
