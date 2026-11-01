#!/usr/bin/env python3
"""Oracle generator for idea 46 (Split). NOT shipped with the page and never imported by it.

Runs NASA's own CEA (the `cea` package, v3.3.4, Apache-2.0, https://github.com/nasa/cea) in a throw-away venv and
writes oracle/cea-split.json, which split.test.mjs compares idea 46's propellant performance against. Idea 46 does
not compute any chemistry itself: it calls idea 31's equilibrium kernel and idea 32's nozzle kernel, unmodified. What
is new here are the conditions it calls them at, and this oracle checks those:

  liquid  LOX/LH2 at their boiling points (O2(L) 90.17 K, H2(L) 20.27 K), RL10A-3-3 chamber pressure 400 psia and
          area ratio 57 (SP-8120 Table I), O/F 2.5 to the water's own 7.9367: the cryogenic route
  gas     gaseous O2 and H2 at 293.15 K, same chamber and nozzle: the high-pressure gas route
  steam   water vapour at the heater temperature (1023.15, 1500, 2000, 2500 K), 10 bar, area ratio 10: the steam
          route; and at area ratio 50 for 1023.15 K, where a full CEA run (condensed water allowed) shows where the
          equilibrium expansion condenses

Each is solved shifting (CEA default) and frozen at the chamber (n_frz=1), with products restricted to the nine H/O
gas species idea 31 carries (from its oracle/species-survey.json), so solver error is isolated from species error.
Vacuum Isp is CEA's Isp_vacuum at the area ratio (ideal: no divergence loss).

Run from the bank root, with a venv that has `pip install cea==3.3.4`:
  <venv>/bin/python -I -B ideas/46-split/oracle/cea_split.py
"""
import json, os, math, datetime
import numpy as np
import cea

HERE = os.path.dirname(os.path.abspath(__file__))
SURVEY = os.path.join(HERE, '..', '..', '31-mixture', 'oracle', 'species-survey.json')
SELECTED = json.load(open(SURVEY))['selected']
HO = [s for s in SELECTED if all(ch in 'HO0123456789' for ch in s.replace('(', '').replace(')', ''))]
PSI = 6894.757293168
PC_RL10 = 400 * PSI / 1e5   # bar
R_ST = 0.5 * 31.9988 / 2.01588  # the water's own O/F from idea 31's thermo.inp molar masses (O2, H2)
OFS = [2.5, 3.0, 4.0, 5.0, 6.0, 7.0, R_ST]
STEAM_T = [1023.15, 1500.0, 2000.0, 2500.0]
PI_P = [2.0]


def sig(x, n=9):
    x = float(x)
    return x if (x == 0 or not math.isfinite(x)) else float(f'{x:.{n}g}')


def run(names, temps, ow, fw, of, pc_bar, supar, n_frz=None, full=False):
    reac = cea.Mixture(names)
    prod = cea.Mixture(names, products_from_reactants=True)
    if not full:
        allowed = set(prod.species_names)
        prod = cea.Mixture([n for n in HO if n in allowed])
    solver = cea.RocketSolver(prod, reactants=reac)
    sol = cea.RocketSolution(solver)
    w = reac.of_ratio_to_weights(np.array(ow), np.array(fw), of) if of is not None else np.array(ow)
    hc = reac.calc_property(cea.ENTHALPY, w, np.array(temps)) / cea.R
    kw = dict(supar=list(supar), hc=hc, iac=True)
    if n_frz:
        kw['n_frz'] = n_frz
    solver.solve(sol, w, pc_bar, PI_P, **kw)  # CEA needs one assigned pressure ratio; the supersonic station is the last
    i = sol.num_pts - 1
    return {'Tc': sig(sol.T[0]), 'cstar': sig(sol.c_star[i]), 'eps': sig(sol.ae_at[i]), 'Te': sig(sol.T[i]), 'Pe': sig(sol.P[i] * 1e5), 'Ivac': sig(sol.Isp_vacuum[i]), 'converged': bool(sol.converged)}


def pair(state):
    if state == 'liquid':
        return ['O2(L)', 'H2(L)'], [90.17, 20.27]
    return ['O2', 'H2'], [293.15, 293.15]


def main():
    out = {'generator': 'oracle/cea_split.py', 'cea_version': '3.3.4', 'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
           'products': HO, 'units': 'Tc K, cstar m/s, eps 1, Te K, Pe Pa, Ivac m/s (ideal, no divergence loss)', 'rl10': {'pc_bar': PC_RL10, 'eps': 57}, 'cases': []}
    for state in ('liquid', 'gas'):
        names, temps = pair(state)
        for of in OFS:
            row = {'route': state, 'of': of, 'pc_Pa': PC_RL10 * 1e5, 'eps': 57}
            for mode, nf in (('shifting', None), ('frozen', 1)):
                try:
                    row[mode] = run(names, temps, [1.0, 0.0], [0.0, 1.0], of, PC_RL10, [57.0], nf)
                except Exception as e:  # noqa: BLE001
                    row[mode] = {'error': str(e)[:200]}
            out['cases'].append(row)
    for T in STEAM_T:
        for eps in (10.0, 50.0) if T == 1023.15 else (10.0,):
            row = {'route': 'steam', 'T_heat': T, 'pc_Pa': 10e5, 'eps': eps}
            for mode, nf in (('shifting', None), ('frozen', 1)):
                try:
                    row[mode] = run(['H2O'], [T], [1.0], None, None, 10.0, [eps], nf)
                except Exception as e:  # noqa: BLE001
                    row[mode] = {'error': str(e)[:200]}
            if eps == 50.0:
                # every product CEA would consider, condensed water included: does the equilibrium expansion condense?
                try:
                    reac = cea.Mixture(['H2O'])
                    prod = cea.Mixture(['H2O'], products_from_reactants=True)
                    solver = cea.RocketSolver(prod, reactants=reac)
                    sol = cea.RocketSolution(solver)
                    w = np.array([1.0])
                    hc = reac.calc_property(cea.ENTHALPY, w, np.array([T])) / cea.R
                    solver.solve(sol, w, 10.0, PI_P, supar=[eps], hc=hc, iac=True)
                    i = sol.num_pts - 1
                    names = list(prod.species_names)
                    mf = sol.mole_fractions
                    def frac(n):
                        try:
                            v = mf[n]
                            return sig(v[i] if hasattr(v, '__len__') else v)
                        except Exception:  # noqa: BLE001
                            return None
                    row['full_shifting'] = {'eps': sig(sol.ae_at[i]), 'Te': sig(sol.T[i]), 'Ivac': sig(sol.Isp_vacuum[i]), 'converged': bool(sol.converged), 'species': names,
                                            'exit_condensed': {n: frac(n) for n in names if '(' in n}}
                except Exception as e:  # noqa: BLE001
                    row['full_shifting'] = {'error': str(e)[:200]}
            out['cases'].append(row)
    path = os.path.join(HERE, 'cea-split.json')
    with open(path, 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print('wrote', path, len(out['cases']), 'cases')


if __name__ == '__main__':
    main()
