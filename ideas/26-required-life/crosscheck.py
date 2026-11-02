#!/usr/bin/env python3
"""crosscheck.py: the replacement line written a second time, on top of Skyhook's OWN finance code.

It imports finance/skyhook_finance.py from a Skyhook checkout (read-only: bytecode writing is
switched off before the import, so nothing lands in the checkout), takes the base cash flows from
net_cash_flows_M() exactly as Skyhook computes them, subtracts a replacement line written here
independently of model.js, and prints JSON. model.test.mjs runs it and compares every number with
model.js. Needs openpyxl (the finance module reads the workbook with it); exits 3 if the checkout or
openpyxl is missing, which the test reports as a skip.

    python3 -B ideas/26-required-life/crosscheck.py --repo /home/user/skyhook
    python3 -B ideas/26-required-life/crosscheck.py --repo /home/user/skyhook \
        --fixture ideas/26-required-life/snapshots/skyhook_finance_outputs.json

With --fixture it also writes the same results, without the 40-year flows of the replacement runs,
to a committed fixture (added at review), so model.test.mjs can reconcile model.js against Skyhook's
own module on a machine that has neither the checkout nor openpyxl. Its provenance sidecar is
written afterwards with tools/snapshot.mjs --sidecar-only against finance/skyhook_finance.py.
"""
import argparse
import copy
import json
import math
import subprocess
import sys

sys.dont_write_bytecode = True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", default="/home/user/skyhook")
    ap.add_argument("--fixture", help="also write the results (minus the 40-year run flows) here")
    args = ap.parse_args()
    sys.path.insert(0, args.repo)
    try:
        import openpyxl  # noqa: F401
        from finance import skyhook_finance as F
    except Exception as e:  # missing checkout or openpyxl
        print(json.dumps({"skip": f"{type(e).__name__}: {e}"}))
        sys.exit(3)

    ladder = F.load_ladder_from_workbook()
    tiers = F.load_tiers_from_params()

    def per_event(s, f, fiber):
        return f * F.fiber_mass_t(s) * 1000.0 * (s.construction_launch_per_kg + (fiber or 0.0)) / 1e6

    def repl_flows(s, years, f, life, fiber, convention):
        base = F.net_cash_flows_M(s, years=years)
        per = per_event(s, f, fiber)
        out = []
        for year, cf in enumerate(base, start=1):
            ops_year = year - F.OPS_START_YEAR + 1
            cost = 0.0
            if ops_year >= 1 and per > 0:
                if convention == "rolling":
                    cost = per / life
                else:  # lumpy: events at t = (OPS_START_YEAR - 1) + k*life, booked in year ceil(t)
                    t0 = F.OPS_START_YEAR - 1
                    k = 1
                    while t0 + k * life <= year + 1e-9 * life:
                        t = t0 + k * life
                        if t > year - 1 + 1e-9 * life:
                            cost += per
                        k += 1
            out.append(cf - cost)
        return out

    def payback(flows):
        cum = 0.0
        for i, cf in enumerate(flows, start=1):
            cum += cf
            if cum > 0:
                return i
        return None

    def npv(flows, rate):
        return sum(cf / (1.0 + rate) ** t for t, cf in enumerate(flows, start=1))

    cases = []
    for col in F.SCENARIOS:
        for tier in sorted(tiers, key=tiers.get):
            s = F.scenario_for_tier(ladder[col], tier)
            summ = F.summarize(s)
            base_cum = {}
            row = {
                "column": col, "tier": tier,
                "mass_ratio": summ["mass_ratio_x"], "fiber_t": summ["fiber_mass_t"],
                "capex_M": summ["total_capex_M"], "payback": summ["payback_year"],
                "npv10_M": summ["npv_10pct_M"],
                "revenue_M": summ["annual_revenue_M"], "var_M": summ["annual_marginal_cost_M"],
                "flows15": F.net_cash_flows_M(s, years=15),
                "runs": [],
            }
            pb = summ["payback_year"]
            if pb is not None:
                for Y in range(pb, pb + 4):
                    base_cum[Y] = sum(F.net_cash_flows_M(s, years=Y))
                row["closed_form"] = {
                    str(Y): per_event(s, 1.0, None) * (Y - F.OPS_START_YEAR + 1) / c
                    for Y, c in base_cum.items() if c > 0
                }
            for f, life, fiber, conv in [
                (1.0, 8.0, None, "rolling"), (0.96875, 12.5, None, "rolling"), (1.0, 8.0, 300.0, "rolling"),
                (0.5, 3.0, 1000.0, "rolling"), (1.0, 28.0, None, "rolling"), (1.0, 29.0, None, "rolling"),
                (1.0, 8.0, None, "lumpy"), (1.0, 13.5, None, "lumpy"), (0.9, 6.25, 200.0, "lumpy"),
                (1.0, 2.0, None, "lumpy"),
            ]:
                fl = repl_flows(s, 40, f, life, fiber, conv)
                row["runs"].append({
                    "f": f, "life": life, "fiber": fiber, "convention": conv,
                    "payback": payback(fl), "npv10_M": npv(fl[:15], 0.10),
                    "cum15_M": sum(fl[:15]), "flows40": fl,
                })
            cases.append(row)
    out = {"skyhook_commit_note": "base flows from finance/skyhook_finance.py net_cash_flows_M",
           "erf": {str(x): math.erf(x) for x in (0.1, 0.5, 1.0, 1.7325, 2.0, 2.4257, 3.0, 4.5)},
           "cases": cases}
    if args.fixture:
        head = subprocess.run(["git", "-C", args.repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        fx = copy.deepcopy(out)
        fx["skyhook_commit"] = head
        fx["generated_by"] = "crosscheck.py --fixture (the 40-year flows of each replacement run are dropped to keep it small)"
        for c in fx["cases"]:
            for r in c["runs"]:
                r.pop("flows40")
        with open(args.fixture, "w", encoding="utf-8") as fh:
            json.dump(fx, fh, indent=1)
            fh.write("\n")
    print(json.dumps(out))


if __name__ == "__main__":
    main()
