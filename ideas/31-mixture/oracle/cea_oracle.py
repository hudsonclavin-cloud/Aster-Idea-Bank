#!/usr/bin/env python3
"""Oracle generator for idea 31 (Mixture). NOT shipped with the page and never imported by it.

Runs NASA's own CEA (the `cea` package, v3.3.4, Apache-2.0, https://github.com/nasa/cea) in a throw-away
venv and writes two fixtures that mixture.test.mjs compares the JavaScript kernel against:

  oracle/species-survey.json  every gas product CEA considers for C/H/O/N reactants, with the largest mole
                              fraction it reaches anywhere in the survey grid (10 propellant pairs x 25 O/F
                              x Pc 1/10/30/100/300 bar, at the chamber, the throat and pressure ratios
                              10/100/1000). build-data.mjs keeps the species above THRESHOLD.
  oracle/cea-oracle.json      rocket (infinite-area combustor) results at 6 O/F x 3 Pc per pair, twice:
                              'full' = CEA with every product it would consider (condensed included), the
                              stand-in for reality (scalars only); 'restricted' = CEA limited to the species set the kernel
                              uses, which isolates solver error from species-truncation error. Plus RP-1311
                              Example 8 at its exact inputs, and the points where CEA deposits graphite.

Run (from the bank root, with a venv that has `pip install cea`):
  <venv>/bin/python ideas/31-mixture/oracle/cea_oracle.py
"""
import json, os, sys, math, datetime
import numpy as np
import cea

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pairs import PAIRS  # noqa: E402

THRESHOLD = 1e-7          # mole-fraction floor for keeping a gas species
SURVEY_PC = (1.0, 10.0, 30.0, 100.0, 300.0)
SURVEY_PI = (10.0, 100.0, 1000.0)
CHECK_PC = (1.0, 20.0, 200.0)
CHECK_N_OF = 6
CONDENSED = ("C(gr)", "H2O(L)", "H2O(cr)")


def setup(pair, prod_names=None):
    names = [r[0] for r in pair["ox"]] + [r[0] for r in pair["fuel"]]
    T = np.array([r[2] for r in pair["ox"]] + [r[2] for r in pair["fuel"]])
    ow = np.array([r[1] for r in pair["ox"]] + [0.0] * len(pair["fuel"]))
    fw = np.array([0.0] * len(pair["ox"]) + [r[1] for r in pair["fuel"]])
    reac = cea.Mixture(names)
    prod = cea.Mixture(names, products_from_reactants=True)
    if prod_names:
        # CEA requires the product element list to equal the reactants': keep the restricted species that
        # CEA itself would consider for these reactants.
        allowed = set(prod.species_names)
        prod = cea.Mixture([n for n in prod_names if n in allowed])
    return names, T, ow, fw, reac, prod


def rocket(pair, of, pc_bar, prod_names=None, pi_p=SURVEY_PI):
    names, T, ow, fw, reac, prod = setup(pair, prod_names)
    solver = cea.RocketSolver(prod, reactants=reac)
    sol = cea.RocketSolution(solver)
    w = reac.of_ratio_to_weights(ow, fw, of)
    hc = reac.calc_property(cea.ENTHALPY, w, T) / cea.R
    solver.solve(sol, w, pc_bar, list(pi_p), hc=hc, iac=True)
    return sol


def sig(x, n=8):
    x = float(x)
    if x == 0 or not math.isfinite(x):
        return x
    return float(f"{x:.{n}g}")


STATION_KEYS = ["T", "P", "M", "gamma_s", "cp_eq", "cp_fr", "h", "s", "rho", "a"]


def station(sol, i):
    """One station of a CEA rocket solution in SI, as a list in STATION_KEYS order
    (K, Pa, kg/mol, -, J/(kg K), J/(kg K), J/kg, J/(kg K), kg/m^3, m/s)."""
    return [sig(sol.T[i]), sig(sol.P[i] * 1e5), sig(sol.M[i] / 1000.0), sig(sol.gamma_s[i]),
            sig(sol.cp_eq[i] * 1000.0), sig(sol.cp_fr[i] * 1000.0), sig(sol.enthalpy[i] * 1000.0),
            sig(sol.entropy[i] * 1000.0), sig(sol.density[i]), sig(sol.sonic_velocity[i])]


def survey():
    maxima = {}
    for key, pair in PAIRS.items():
        lo, hi = pair["of"]
        for of in np.linspace(lo, hi, 25):
            for pc in SURVEY_PC:
                sol = rocket(pair, float(of), pc)
                if not sol.converged:
                    raise SystemExit(f"CEA did not converge: {key} {of} {pc}")
                for sp, arr in sol.mole_fractions.items():
                    m = float(np.max(np.asarray(arr)))
                    if m > maxima.get(sp, [0.0])[0]:
                        maxima[sp] = [sig(m, 4), key, sig(of, 6), pc]
    gas = {k: v for k, v in maxima.items() if k not in CONDENSED}
    selected = sorted([k for k, v in gas.items() if v[0] >= THRESHOLD], key=lambda k: -gas[k][0])
    return {"threshold": THRESHOLD, "pc_bar": SURVEY_PC, "pressure_ratios": SURVEY_PI, "of_points_per_pair": 25,
            "considered_gas_species": len(gas), "selected": selected,
            "condensed_max": {k: maxima.get(k) for k in CONDENSED},
            "maxima": dict(sorted(gas.items(), key=lambda kv: -kv[1][0]))}


def checkpoints(selected):
    out = []
    for key, pair in PAIRS.items():
        lo, hi = pair["of"]
        for of in np.linspace(lo, hi, CHECK_N_OF):
            for pc in CHECK_PC:
                full = rocket(pair, float(of), pc, pi_p=(10.0,))
                cond = {c: [sig(x, 4) for x in np.asarray(full.mole_fractions.get(c, [0, 0]))[:2]]
                        for c in CONDENSED if c in full.mole_fractions}
                rec = {"pair": key, "of": sig(of, 8), "pc": pc * 1e5,
                       "condensed_in_chamber_or_throat": any(max(v) > 0 for v in cond.values())}
                if rec["condensed_in_chamber_or_throat"]:
                    rec["condensed"] = cond
                    out.append(rec)
                    continue
                restr = rocket(pair, float(of), pc, prod_names=selected, pi_p=(10.0,))
                assert full.converged and restr.converged
                rec["full"] = {"chamber": station(full, 0), "throat": station(full, 1), "cstar": sig(full.c_star[0])}
                rec["restricted"] = {"chamber": station(restr, 0), "throat": station(restr, 1),
                                     "cstar": sig(restr.c_star[0]),
                                     "x": {k: sig(v[0], 6) for k, v in restr.mole_fractions.items() if v[0] >= 1e-5}}
                out.append(rec)
    return out


def example8(selected):
    """RP-1311 Part II Example 8 inputs: H2(L)/O2(L), O/F 5.55157, Pc 53.3172 bar, IAC."""
    pair = {"ox": [("O2(L)", 1.0, 90.17)], "fuel": [("H2(L)", 1.0, 20.27)]}
    res = {}
    for label, names in (("full", None), ("restricted", selected)):
        s = rocket(pair, 5.55157, 53.3172, prod_names=names, pi_p=(10.0,))
        res[label] = {"chamber": station(s, 0), "throat": station(s, 1), "cstar": sig(s.c_star[0])}
    return res


def main():
    sv = survey()
    with open(os.path.join(HERE, "species-survey.json"), "w") as f:
        json.dump({"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                   "oracle": f"cea {cea.__version__} (NASA, pip package 'cea'); R = {cea.R} J/(kmol K)", **sv},
                  f, indent=1)
    sel = sv["selected"]
    fx = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
          "oracle": f"cea {cea.__version__} (NASA, pip package 'cea'), RocketSolver with iac=True",
          "station_keys": STATION_KEYS,
          "units": "SI: T K, P Pa, M kg/mol, cp J/(kg K), h J/kg, s J/(kg K), rho kg/m^3, a and cstar m/s; x mole fractions >= 1e-5",
          "species_restricted": sel, "pc_bar": CHECK_PC, "of_points_per_pair": CHECK_N_OF,
          "points": checkpoints(sel), "rp1311_example8": example8(sel)}
    with open(os.path.join(HERE, "cea-oracle.json"), "w") as f:
        json.dump(fx, f, separators=(",", ":"))
    print(f"selected {len(sel)} gas species of {sv['considered_gas_species']}; {len(fx['points'])} check points")


if __name__ == "__main__":
    main()
