"""Round driver the AGENT runs in its workspace shell: `python apply_round.py`.

Self-contained (stdlib only) so it runs from the workspace dir with no imports
from the rest of the package. Reads the agent's alloc.json + the hidden .state.json,
applies one round of the PLACEHOLDER medication rule (same rule as
dynamics.run_round; Synthea replaces it later), removes medicated patients,
refreshes the budget, and updates patients.json / results.json for the next round.

The env template reads .state.json afterward to compute the episode reward.
"""

import json
from pathlib import Path

WS = Path(__file__).resolve().parent


def main() -> None:
    state = json.loads((WS / ".state.json").read_text())

    if state["round"] >= state["rounds"]:
        print(f"All {state['rounds']} rounds already used. "
              f"Final: {state['medicated']}/{state['n_total']} medicated.")
        return

    try:
        raw = json.loads((WS / "alloc.json").read_text())
        alloc = {int(k): max(0.0, float(v)) for k, v in raw.items()}
    except Exception as e:  # noqa: BLE001 -- surface the problem to the agent
        print(f"Could not read alloc.json ({e}). Write it as "
              '{"<provider_id>": <amount>} and rerun.')
        return

    budget = state["budget"]
    total = sum(alloc.values())
    if total > budget:
        print(f"Over budget: ${total:.0f} > ${budget:.0f}. Round NOT applied; "
              "reduce allocations and rerun.")
        return

    thresholds = {int(k): v for k, v in state["thresholds"].items()}
    unmed = set(state["unmedicated"])

    newly = set()
    for prov in state["providers"]:
        active = [p for p in prov["patients"] if p in unmed]
        if not active:
            continue
        share = alloc.get(prov["id"], 0) / len(active)
        newly |= {p for p in active if share >= thresholds[p]}

    unmed -= newly
    state["unmedicated"] = sorted(unmed)
    state["medicated"] += len(newly)
    state["round"] += 1
    state["reward"] = state["medicated"] / state["n_total"] if state["n_total"] else 0.0
    (WS / ".state.json").write_text(json.dumps(state))

    view = [{"id": p["id"], "region": p["region"],
             "patients": [q for q in p["patients"] if q in unmed]}
            for p in state["providers"]]
    (WS / "patients.json").write_text(json.dumps(view, indent=2))
    (WS / "results.json").write_text(json.dumps(
        {"round": state["round"], "medicated": state["medicated"],
         "n_total": state["n_total"], "reward": state["reward"]}))

    print(f"Round {state['round']}/{state['rounds']} applied: +{len(newly)} medicated "
          f"this round, {state['medicated']}/{state['n_total']} total. "
          f"Budget ${budget:.0f} refreshed for the next round.")
    if state["round"] >= state["rounds"]:
        print("All rounds complete. Reply 'done'.")


if __name__ == "__main__":
    main()
