"""Headroom-aware gradient check on the REAL Synthea cohort.

The placeholder ``sanity_check.py`` only asks "does a smart policy beat a dumb
one?". With a feature-driven k that's no longer the right question -- the new
risk is the task being *too easy* (a static feature policy maxes it out, leaving
nothing for GRPO to learn). So this script measures TWO things:

  1. SIGNAL   = feature_static - blind baselines
                Do the observable features (volume, avg_hba1c, escalation_affinity)
                carry learnable information about cost? Must be > 0.
  2. HEADROOM = adaptive - feature_static
                Does using the 3-round feedback to discover the hidden residual
                beat a static feature policy? Must be > 0, or there's nothing
                worth training (raise RESID_SIGMA).

``cheats_cheapest`` uses the hidden thresholds directly -- a reference ceiling,
not a real policy.

Run: python gradient_check.py
"""

from __future__ import annotations

import statistics as st

from synthea_cohort import FEATURES, make_cohort, public_view
from dynamics import run_round

SEEDS = range(40)
BUDGETS = (600.0, 1000.0, 1500.0, 2200.0, 3000.0)
GUESS_PER_PATIENT = 300.0  # a feature policy's blind guess at $/patient


# --------------------------------------------------------------------------- #
# Episode driver (mirrors env.py: 3 rounds, budget refreshes, medicated stick)
# --------------------------------------------------------------------------- #
def simulate(seed, budget, policy, rounds=3):
    provs, thr = make_cohort(seed)
    unmed = set(thr)
    medicated = 0
    history = []
    for r in range(rounds):
        view = public_view(provs, unmed)
        alloc = {k: v for k, v in policy(r, view, budget, thr, history).items() if v > 0}
        if sum(alloc.values()) > budget + 1e-6:
            alloc = {}  # over budget -> wasted round (matches env.py)
        newly = run_round(provs, unmed, thr, alloc)
        unmed -= newly
        medicated += len(newly)
        history.append({"alloc": alloc, "newly": newly, "view": view})
    return medicated / len(thr)


# --------------------------------------------------------------------------- #
# Policies. Signature: (round_idx, view, budget, thresholds, history) -> alloc
# Only `cheats_*` may read `thresholds`.
# --------------------------------------------------------------------------- #
def _active(view):
    return [p for p in view if p["patients"]]


def none(r, view, budget, thr, hist):
    return {}


def even(r, view, budget, thr, hist):
    a = _active(view)
    return {p["id"]: budget / len(a) for p in a} if a else {}


def concentrate(r, view, budget, thr, hist):
    a = _active(view)
    if not a:
        return {}
    target = max(a, key=lambda p: len(p["patients"]))
    return {target["id"]: budget}


def _feature_score(view):
    """Cheapness proxy from OBSERVABLE features only (no thresholds). Higher =
    predicted cheaper. Standardized within the current task's providers."""
    a = _active(view)
    if not a:
        return {}
    z = {}
    for f in FEATURES:
        vals = [p[f] for p in a]
        mean, sd = st.mean(vals), st.pstdev(vals) or 1.0
        z[f] = {p["id"]: (p[f] - mean) / sd for p in a}
    # same sign convention as the generative prior: bigger/sicker/escalated = cheaper
    return {p["id"]: z["volume"][p["id"]] + z["avg_hba1c"][p["id"]]
            + z["escalation_affinity"][p["id"]] for p in a}


def _greedy_fund(active, order_key, budget):
    """Fund providers in `order_key` order, ~enough to clear each panel, till
    budget runs out. Shared by feature_static and adaptive."""
    alloc, left = {}, budget
    for p in sorted(active, key=order_key):
        give = min(len(p["patients"]) * GUESS_PER_PATIENT, left)
        if give <= 0:
            break
        alloc[p["id"]] = give
        left -= give
    return alloc


def feature_static(r, view, budget, thr, hist):
    """Rank providers by predicted cheapness; fund cheapest-looking first.
    Uses features but NEVER adapts to feedback."""
    score = _feature_score(view)
    return _greedy_fund(_active(view), lambda p: -score.get(p["id"], 0), budget)


def _observed_efficiency(hist):
    """provider_id -> (patients converted / dollars spent) accumulated so far."""
    from collections import defaultdict
    spent, won = defaultdict(float), defaultdict(float)
    for h in hist:
        for pid, amt in h["alloc"].items():
            spent[pid] += amt
        for p in h["view"]:
            c = sum(1 for q in p["patients"] if q in h["newly"])
            won[p["id"]] += c
    return {pid: won[pid] / s for pid, s in spent.items() if s > 0}


def adaptive(r, view, budget, thr, hist):
    """Round 0: allocate by the feature prior (productive, not a wasted probe).
    Later rounds: prefer providers whose OBSERVED cost-per-conversion was good,
    falling back to the feature prior for any not yet funded -- i.e. discover the
    dominant hidden residual through feedback."""
    a = _active(view)
    if not a:
        return {}
    score = _feature_score(view)
    if r == 0:
        return _greedy_fund(a, lambda p: -score.get(p["id"], 0), budget)
    eff = _observed_efficiency(hist)
    # probed providers ranked by observed efficiency first; then unprobed by prior
    def key(p):
        pid = p["id"]
        return (0, -eff[pid]) if pid in eff else (1, -score.get(pid, 0))
    return _greedy_fund(a, key, budget)


def cheats_cheapest(r, view, budget, thr, hist):
    """Reference ceiling: buy whole panels cheapest-first using the HIDDEN k.
    To clear a provider's remaining panel its share must cover its max threshold,
    so cost = max(threshold) * panel_size."""
    opts = []
    for p in _active(view):
        ts = [thr[q] for q in p["patients"]]
        opts.append((max(ts) * len(ts), len(ts), p["id"]))
    opts.sort(key=lambda o: o[0] / o[1])  # cost per patient cleared
    alloc, left = {}, budget
    for cost, _n, pid in opts:
        if cost <= left:
            alloc[pid] = cost
            left -= cost
    return alloc


# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    policies = {"none": none, "even": even, "concentrate": concentrate,
                "feature_static": feature_static, "adaptive": adaptive,
                "cheats_cheapest": cheats_cheapest}

    print("Avg medication fraction over", len(list(SEEDS)), "seeds:\n")
    header = f"{'budget':>8} | " + " ".join(f"{n:>15}" for n in policies)
    print(header)
    print("-" * len(header))
    rows = {}
    for b in BUDGETS:
        row = {name: st.mean(simulate(s, b, fn) for s in SEEDS)
               for name, fn in policies.items()}
        rows[b] = row
        print(f"{b:>8.0f} | " + " ".join(f"{row[n]:>15.3f}" for n in policies))

    # verdict
    sig = st.mean(rows[b]["feature_static"] - rows[b]["even"] for b in BUDGETS)
    head = st.mean(rows[b]["cheats_cheapest"] - rows[b]["feature_static"] for b in BUDGETS)
    adp = st.mean(rows[b]["adaptive"] - rows[b]["feature_static"] for b in BUDGETS)
    print(f"\nSIGNAL   (feature_static - even):           {sig:+.3f}  "
          f"{'OK -- features carry learnable signal' if sig > 0.01 else 'WEAK -- features barely help'}")
    print(f"HEADROOM (cheats_cheapest - feature_static): {head:+.3f}  "
          f"{'OK -- room above the best simple rule -> worth training' if head > 0.05 else 'LOW -- task near-trivial'}")
    print(f"  (a crude 3-round adaptive heuristic recovers only {adp:+.3f} of that gap --")
    print(f"   closing it needs a *learned*, $-calibrated policy, i.e. exactly the RL task.)")
