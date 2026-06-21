"""Round driver the AGENT runs in its workspace shell.

Pass the allocation as a single JSON argument (preferred -- no file writing):

    python apply_round.py '{"<provider_id>": <amount>, ...}'

(Falls back to reading alloc.json if no argument is given.)

Self-contained (stdlib only). Applies one round of the medication rule (same as
dynamics.run_round; Synthea data feeds it via env.py), removes medicated
patients, refreshes the budget, and updates patients.json / results.json for the
next round. The env template reads .state.json afterward to compute the reward.
"""

import json
import sys
from pathlib import Path

WS = Path(__file__).resolve().parent


def main() -> None:
    state = json.loads((WS / ".state.json").read_text())

    if state["round"] >= state["rounds"]:
        print(f"All {state['rounds']} rounds already used. "
              f"Final: {state['medicated']}/{state['n_total']} medicated.")
        return

    # Allocation from CLI arg (preferred) or alloc.json (fallback).
    if len(sys.argv) > 1:
        alloc_src = sys.argv[1]
    else:
        try:
            alloc_src = (WS / "alloc.json").read_text()
        except FileNotFoundError:
            print('Provide allocations: '
                  'python apply_round.py \'{"<provider_id>": <amount>}\'')
            return
    try:
        raw = json.loads(alloc_src)
        alloc = {int(k): max(0.0, float(v)) for k, v in raw.items()}
    except Exception as e:  # noqa: BLE001 -- surface the problem to the agent
        print(f"Could not parse allocations ({e}). "
              'Pass JSON like \'{"0": 1000, "1": 1500}\'.')
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

    # Preserve all observable provider features (region, volume, avg_hba1c, ...),
    # only trimming the patient list to those still untreated.
    view = [{**{k: v for k, v in p.items() if k != "patients"},
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
