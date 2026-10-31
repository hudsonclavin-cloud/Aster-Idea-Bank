#!/usr/bin/env python3
"""Independent reviewer's oracle for idea 32 (Bell). NOT shipped with the page and never imported by it.

Written by the independent reviewer from the `cea` package API (cea==3.3.4, NASA, Apache-2.0), not from
oracle/cea_nozzle.py, so a mistake shared by the builder's fixture script and the kernel would show here. It
solves CEA's infinite-area-combustor rocket problem at conditions the builder's fixture does not contain: the
Table I operating points of the F-1, RL10A-3-3, J-2 and AJ10-137 (mixture ratio, chamber pressure in psia and
area ratio as snapshots/sp8120-table1.js transcribes them; bell.test.mjs checks they are the same numbers) and
this module's sample (LOX/RP-1, O/F 2.6, 100 bar, area ratio 16). Each is run shifting (CEA default) and frozen at
the chamber (n_frz = 1), with every product CEA considers ('full') and with idea 31's 43 species ('43').

Run from the bank root, with a venv that has `pip install cea==3.3.4`:
  <venv>/bin/python -I -B ideas/32-bell/oracle/review_cea_check.py
"""
import json, os, math
import numpy as np
import cea

HERE = os.path.dirname(os.path.abspath(__file__))
SELECTED = json.load(open(os.path.join(HERE, '..', '..', '31-mixture', 'oracle', 'species-survey.json')))['selected']
PSI = 0.45359237 * 9.80665 / 0.0254 ** 2  # Pa per psi, exact by definition

LOX = [('O2(L)', 1.0, 90.17)]
RP1 = [('RP-1', 1.0, 298.15)]
LH2 = [('H2(L)', 1.0, 20.27)]
NTO = [('N2O4(L)', 1.0, 298.15)]
A50 = [('N2H4(L)', 0.5, 298.15), ('C2H8N2(L),UDMH', 0.5, 298.15)]
# name, preset id (idea 31), oxidizer, fuel, O/F, chamber pressure in Pa, area ratio
CASES = [
    ('F-1', 'lox-rp1', LOX, RP1, 2.27, 1126 * PSI, 16.0),
    ('RL10A-3-3', 'lox-lh2', LOX, LH2, 5.0, 400 * PSI, 57.0),
    ('J-2', 'lox-lh2', LOX, LH2, 5.5, 725 * PSI, 27.5),
    ('AJ10-137', 'nto-a50', NTO, A50, 1.6, 97 * PSI, 62.5),
    ('sample', 'lox-rp1', LOX, RP1, 2.6, 100e5, 16.0),
]


def sig(x, n=10):
    x = float(x)
    return x if (x == 0 or not math.isfinite(x)) else float(f'{x:.{n}g}')


def run(ox, fu, of, pc_pa, eps, n_frz, restrict):
    names = [n for n, _, _ in ox] + [n for n, _, _ in fu]
    T = np.array([t for *_, t in ox] + [t for *_, t in fu], float)
    ow = np.array([w for _, w, _ in ox] + [0.0] * len(fu), float)
    fw = np.array([0.0] * len(ox) + [w for _, w, _ in fu], float)
    reac = cea.Mixture(names)
    prod = cea.Mixture(names, products_from_reactants=True)
    if restrict:
        allowed = set(prod.species_names)
        prod = cea.Mixture([s for s in SELECTED if s in allowed])
    solver = cea.RocketSolver(prod, reactants=reac)
    sol = cea.RocketSolution(solver)
    w = reac.of_ratio_to_weights(ow, fw, of)
    hc = reac.calc_property(cea.ENTHALPY, w, T) / cea.R
    kw = dict(supar=[eps], hc=hc, iac=True)
    if n_frz:
        kw['n_frz'] = n_frz
    solver.solve(sol, w, pc_pa / 1e5, [2.0], **kw)  # one dummy pressure ratio (CEA needs one); the last point is the area ratio
    i = sol.num_pts - 1
    return {'converged': bool(sol.converged), 'cstar': sig(sol.c_star[1]), 'eps': sig(sol.ae_at[i]), 'P': sig(sol.P[i] * 1e5),
            'T': sig(sol.T[i]), 'mach': sig(sol.Mach[i]), 'Ivac': sig(sol.Isp_vacuum[i]), 'u': sig(sol.Isp[i])}


def main():
    out = []
    for name, preset, ox, fu, of, pc, eps in CASES:
        rec = {'name': name, 'preset': preset, 'of': of, 'pc_Pa': sig(pc), 'eps': eps}
        for tag, nf in (('eq', None), ('frz1', 1)):
            for sp in ('full', '43'):
                rec[tag + '_' + sp] = run(ox, fu, of, pc, eps, nf, sp == '43')
        out.append(rec)
        print(name, 'ok')
    fx = {'oracle': f'cea {cea.__version__} (NASA, pip package cea), RocketSolver iac=True; independent reviewer script',
          'units': 'P Pa, T K, cstar/Ivac/u m/s (u = exit velocity), eps 1; stations are CEA\'s converged area ratio (eps field), not exactly the requested one',
          'cases': out}
    with open(os.path.join(HERE, 'review-cea-check.json'), 'w') as f:
        json.dump(fx, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
