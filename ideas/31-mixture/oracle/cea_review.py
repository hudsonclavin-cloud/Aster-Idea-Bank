#!/usr/bin/env python3
"""Second oracle fixture for idea 31 (Mixture), written by the independent reviewer. NOT shipped with the page.

The builder's oracle (cea_oracle.py) compares the kernel with NASA CEA 3.3.4 at 1, 20 and 200 bar on a fixed O/F
grid. This script calls CEA with its own call sequence (written from the `cea` package API, not copied) and adds
what that grid did not cover:

  edges       every pair at three O/F inside its range at 0.1 bar and 300 bar, the ends of the chamber-pressure
              envelope the kernel now enforces; 'restricted' (the kernel's 43 species) and 'full' (every product
              CEA considers, condensed included)
  offgrid     twelve hand-picked points between the grid lines (O/F and pressure the builder's grid never hit)
  graphite    where CEA first deposits C(gr) in the chamber or at the throat, by bisection on O/F, for LOX/RP-1
              and LOX/CH4 at 1, 10, 100 and 300 bar (the boundary the page states)
  nozzle_graphite  the highest O/F at which CEA deposits C(gr) anywhere down to a 1000:1 pressure ratio for
              LOX/RP-1 at 1, 10, 30, 100 and 300 bar (what module 32 inherits)

Run (from the bank root, in a throw-away venv with `pip install cea==3.3.4`):
  <venv>/bin/python -I -B ideas/31-mixture/oracle/cea_review.py
"""
import json, os, sys, datetime
import numpy as np
import cea

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pairs import PAIRS  # noqa: E402

SEL = json.load(open(os.path.join(HERE, "species-survey.json")))["selected"]
COND = ("C(gr)", "H2O(L)", "H2O(cr)")


def solve(ox, fu, of, pc_bar, restricted, pis=(10.0,)):
    names = [r[0] for r in ox] + [r[0] for r in fu]
    temps = np.array([r[2] for r in ox] + [r[2] for r in fu], dtype=float)
    o_w = np.array([r[1] for r in ox] + [0.0] * len(fu))
    f_w = np.array([0.0] * len(ox) + [r[1] for r in fu])
    reac = cea.Mixture(names)
    prod = cea.Mixture(names, products_from_reactants=True)
    if restricted:
        allowed = set(prod.species_names)
        prod = cea.Mixture([s for s in SEL if s in allowed])
    solver = cea.RocketSolver(prod, reactants=reac)
    sol = cea.RocketSolution(solver)
    w = reac.of_ratio_to_weights(o_w, f_w, of)
    solver.solve(sol, w, pc_bar, list(pis), hc=reac.calc_property(cea.ENTHALPY, w, temps) / cea.R, iac=True)
    assert sol.converged
    return sol


def g(x):
    return float(f"{float(x):.9g}")


def condensed(sol, stations):
    return any(float(np.asarray(sol.mole_fractions[c])[i]) > 0 for c in COND if c in sol.mole_fractions for i in stations)


COLUMNS = ["pair", "of", "pc_Pa", "condensed_in_chamber_or_throat",
           "restricted [T, M, gamma_s, cp_eq, s, cstar, throat P, throat T]", "full [T, cstar]"]


def record(key, ox, fu, of, pc_bar):
    """One row in COLUMNS order (compact: the folder has a size budget)."""
    full = solve(ox, fu, of, pc_bar, False)
    cond = condensed(full, (0, 1))
    if cond:
        return [key, of, pc_bar * 1e5, True, None, None]
    res = solve(ox, fu, of, pc_bar, True)
    return [key, of, pc_bar * 1e5, False,
            [g(res.T[0]), g(res.M[0] / 1000), g(res.gamma_s[0]), g(res.cp_eq[0] * 1000), g(res.entropy[0] * 1000),
             g(res.c_star[0]), g(res.P[1] * 1e5), g(res.T[1])],
            [g(full.T[0]), g(full.c_star[0])]]


def side(rows):
    return [list(r) for r in rows]


def boundary(ox, fu, pc_bar, lo, hi, stations, pis=(10.0,)):
    gr = lambda of: condensed(solve(ox, fu, of, pc_bar, False, pis), stations)
    assert gr(lo) and not gr(hi), (pc_bar, lo, hi)
    for _ in range(30):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if gr(mid) else (lo, mid)
    return [g(lo), g(hi)]


def main():
    edges = []
    for key, p in PAIRS.items():
        lo, hi = p["of"]
        for of in (lo + 0.25 * (hi - lo), lo + 0.5 * (hi - lo), lo + 0.75 * (hi - lo)):
            for pc in (0.1, 300.0):
                edges.append(record(key, p["ox"], p["fuel"], round(of, 6), pc))
    lox = [("O2(L)", 1.0, 90.17)]
    offgrid_cases = [
        ("LOX/RP-1", 2.6, 100.0), ("N2O4/MMH", 2.17, 70.0), ("LOX/CH4", 3.21, 300.0), ("LOX/LH2", 6.03, 206.0),
        ("HTP-98/RP-1", 7.3, 45.0), ("LOX/Ethanol-75", 1.3, 2.5), ("LOX/RP-1", 1.16, 300.0), ("N2O4/A-50", 1.6, 12.0),
        ("LOX/CH4", 1.2, 50.0), ("LOX/RP-1", 8.0, 100.0), ("LOX/LH2", 1.0, 1.0), ("N2O4/UDMH", 2.9, 150.0),
    ]
    offgrid = [record(k, PAIRS[k]["ox"], PAIRS[k]["fuel"], of, pc) for k, of, pc in offgrid_cases]
    graphite = []
    for fuel_key, fuel in (("RP-1", [("RP-1", 1.0, 298.15)]), ("CH4(L)", [("CH4(L)", 1.0, 111.643)])):
        for pc in (1.0, 10.0, 100.0, 300.0):
            graphite.append({"fuel": fuel_key, "pc_Pa": pc * 1e5, "of": boundary(lox, fuel, pc, 0.5, 1.5, (0, 1))})
    nozzle = [{"pc_Pa": pc * 1e5, "of": boundary(lox, [("RP-1", 1.0, 298.15)], pc, 1.0, 3.0, (0, 1, 2, 3, 4), (10.0, 100.0, 1000.0))}
              for pc in (1.0, 10.0, 30.0, 100.0, 300.0)]
    out = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "oracle": f"cea {cea.__version__} (NASA, pip package 'cea'), RocketSolver iac=True; reviewer's script oracle/cea_review.py",
           "units": "SI: T K, M kg/mol, cp J/(kg K), s J/(kg K), cstar m/s, pressures Pa", "columns": COLUMNS,
           "edges": edges, "offgrid": offgrid, "graphite_chamber_or_throat": graphite, "nozzle_graphite_lox_rp1_to_1000": nozzle}
    with open(os.path.join(HERE, "cea-review.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(edges)} edge points ({sum(e[3] for e in edges)} condensed), {len(offgrid)} off-grid, "
          f"{len(graphite)} graphite boundaries, {len(nozzle)} nozzle boundaries")


if __name__ == "__main__":
    main()
