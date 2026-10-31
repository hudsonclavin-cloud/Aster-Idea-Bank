#!/usr/bin/env python3
"""Oracle generator for idea 32 (Bell). NOT shipped with the page and never imported by it.

Runs NASA's own CEA (the `cea` package, v3.3.4, Apache-2.0, https://github.com/nasa/cea) in a throw-away
venv and writes oracle/cea-nozzle.json, which bell.test.mjs compares the JavaScript nozzle kernel against.

For each condition (propellant pair from idea 31's oracle/pairs.py, O/F, chamber pressure) CEA's
infinite-area-combustor rocket problem is solved three ways:
  eq    shifting equilibrium all the way (CEA default)
  frz1  composition frozen at the chamber (CEA n_frz=1): the throat is frozen too, so c* changes
  frz2  composition frozen at the throat (CEA n_frz=2): shifting to the throat, frozen after it
with the product species restricted to the 43 gas species idea 31's kernel uses (from idea 31's
oracle/species-survey.json), which isolates solver error from species-truncation error. Stations: the
throat, one assigned pressure ratio pc/p (500) and six supersonic area ratios. A second, 'full' run (every
product CEA would consider, condensed included) records the shifting-equilibrium scalars, so the cost of
the 43-species cut at the nozzle exit is measured too, and which stations condense.

Run from the bank root, with a venv that has `pip install cea==3.3.4`:
  <venv>/bin/python -I -B ideas/32-bell/oracle/cea_nozzle.py
"""
import json, os, sys, math, datetime
import numpy as np
import cea

HERE = os.path.dirname(os.path.abspath(__file__))
M31 = os.path.join(HERE, '..', '..', '31-mixture', 'oracle')
sys.path.insert(0, M31)
from pairs import PAIRS  # noqa: E402  (idea 31's oracle-only propellant list)

SELECTED = json.load(open(os.path.join(M31, 'species-survey.json')))['selected']
PI_P = (500.0,)
SUPAR = (1.5, 4.0, 12.0, 40.0, 120.0, 400.0)
CONDENSED = ('C(gr)', 'H2O(L)', 'H2O(cr)')
KEYS = ['eps', 'P', 'T', 'M', 'gamma_s', 'mach', 'Ivac', 'Isp']
UNITS = 'eps 1 (Ae/At), P Pa, T K, M kg/mol, gamma_s 1, mach 1, Ivac and Isp m/s (Isp = exit velocity, i.e. ambient = exit pressure; CEA C_F = Isp / cstar); cstar m/s once per mode'


def sig(x, n=8):
    x = float(x)
    if x == 0 or not math.isfinite(x):
        return x
    return float(f'{x:.{n}g}')


def setup(pair, prod_names=None):
    names = [r[0] for r in pair['ox']] + [r[0] for r in pair['fuel']]
    T = np.array([r[2] for r in pair['ox']] + [r[2] for r in pair['fuel']])
    ow = np.array([r[1] for r in pair['ox']] + [0.0] * len(pair['fuel']))
    fw = np.array([0.0] * len(pair['ox']) + [r[1] for r in pair['fuel']])
    reac = cea.Mixture(names)
    prod = cea.Mixture(names, products_from_reactants=True)
    if prod_names:
        allowed = set(prod.species_names)
        prod = cea.Mixture([n for n in prod_names if n in allowed])
    return T, ow, fw, reac, prod


def solve(pair, of, pc_bar, mode, prod_names):
    T, ow, fw, reac, prod = setup(pair, prod_names)
    solver = cea.RocketSolver(prod, reactants=reac)
    sol = cea.RocketSolution(solver)
    w = reac.of_ratio_to_weights(ow, fw, of)
    hc = reac.calc_property(cea.ENTHALPY, w, T) / cea.R
    kw = dict(supar=list(SUPAR), hc=hc, iac=True)
    if mode == 'frz1':
        kw['n_frz'] = 1
    elif mode == 'frz2':
        kw['n_frz'] = 2
    solver.solve(sol, w, pc_bar, list(PI_P), **kw)
    return sol


def rows(sol):
    out = []
    for i in range(1, sol.num_pts):  # skip the chamber (index 0)
        out.append([sig(sol.ae_at[i]), sig(sol.P[i] * 1e5), sig(sol.T[i]), sig(sol.M[i] / 1000.0), sig(sol.gamma_s[i]),
                    sig(sol.Mach[i]), sig(sol.Isp_vacuum[i]), sig(sol.Isp[i])])
    return out


def conditions():
    # one O/F per pair (two for LOX/RP-1) at 10 and 100 bar, plus idea 31's envelope ends
    out = []
    for key, pair in PAIRS.items():
        lo, hi = pair['of']
        # LOX/RP-1 twice: at 0.3 of its range CEA deposits graphite deep in the nozzle, at 0.6 it does not
        fr = (0.3, 0.6) if key == 'LOX/RP-1' else (0.5,)
        for f in fr:
            for pc in (10.0, 100.0):
                out.append((key, sig(lo + f * (hi - lo), 6), pc))
    # pressure envelope ends of idea 31 (0.1 and 300 bar) and the published RP-1311 cases
    out += [('LOX/LH2', 6.0, 1.0), ('LOX/LH2', 6.0, 300.0), ('N2O4/MMH', 2.0, 0.1), ('N2O4/MMH', 2.0, 300.0)]
    return out


def main():
    cases = []
    for key, of, pc in conditions():
        pair = PAIRS[key]
        rec = {'pair': key, 'of': of, 'pc': pc * 1e5, 'stations': ['throat'] + ['pi%g' % p for p in PI_P] + ['eps%g' % e for e in SUPAR]}
        for mode in ('eq', 'frz1', 'frz2'):
            s = solve(pair, of, pc, mode, SELECTED)
            if not s.converged:
                rec[mode] = {'converged': False}
                continue
            rec[mode] = {'cstar': sig(s.c_star[1]), 'rows': rows(s)}
        full = solve(pair, of, pc, 'eq', None)
        cond = {}
        for c in CONDENSED:
            if c in full.mole_fractions:
                m = [sig(v, 4) for v in np.asarray(full.mole_fractions[c])[1:]]
                if max(m) > 0:
                    cond[c] = m
        rec['full_eq'] = {'eps': [sig(v) for v in full.ae_at[1:]], 'Ivac': [sig(v) for v in full.Isp_vacuum[1:]]}
        if cond:
            rec['full_eq']['condensed'] = cond
        cases.append(rec)
        print(key, of, pc, 'condensed at' if cond else 'ok', list(cond))
    rp = []
    for name, pair, of, pc, mode in (
            ('RP-1311 Example 8', {'ox': [('O2(L)', 1.0, 90.17)], 'fuel': [('H2(L)', 1.0, 20.27)]}, 5.55157, 53.3172, 'eq'),
            ('RP-1311 Example 12', {'ox': [('N2O4(L)', 1.0, 298.15)], 'fuel': [('CH6N2(L)', 1.0, 298.15)]}, 2.5, 68.947, 'eq'),
            ('RP-1311 Example 12', {'ox': [('N2O4(L)', 1.0, 298.15)], 'fuel': [('CH6N2(L)', 1.0, 298.15)]}, 2.5, 68.947, 'frz2')):
        s = solve(pair, of, pc, mode, SELECTED)
        rp.append({'name': name, 'of': of, 'pc': pc * 1e5, 'mode': mode, 'cstar': sig(s.c_star[1]), 'rows': rows(s)})
    fx = {'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
          'oracle': f'cea {cea.__version__} (NASA, pip package cea), RocketSolver iac=True; R = {cea.R} J/(kmol K)',
          'species': 'restricted to the 43 gas species of ideas/31-mixture/oracle/species-survey.json selected (full_eq: every product CEA considers, condensed included)',
          'keys': KEYS, 'units': UNITS, 'pressure_ratios': PI_P, 'area_ratios': SUPAR, 'stationsPerCase': 1 + len(PI_P) + len(SUPAR),
          'cases': cases, 'rp1311_today': rp}
    with open(os.path.join(HERE, 'cea-nozzle.json'), 'w') as f:
        json.dump(fx, f, separators=(',', ':'))
    print(len(cases), 'conditions')


if __name__ == '__main__':
    main()
