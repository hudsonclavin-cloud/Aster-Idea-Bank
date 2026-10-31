#!/usr/bin/env python3
"""Oracle generator for idea 33 (Engine Deck). NOT shipped with the page and never imported by it.

Idea 31's equilibrium kernel was compared with NASA CEA for rocket chambers (O/F inside each preset's range,
0.1 to 300 bar). This module also uses it for turbine drive gas, which is new territory: fuel-rich LOX/LH2
gas-generator and preburner gas (O/F 0.6 to 1.4, up to 410 bar, i.e. the SSME's 5880 psia preburners) and
oxidizer-rich LOX/RP-1 and LOX/methane preburner gas, each expanded isentropically through a turbine pressure
ratio. This script runs NASA's own CEA (pip package `cea`, v3.3.4, Apache-2.0, https://github.com/nasa/cea) on
those states and writes oracle/cea-turbine.json, which engine.test.mjs compares the JavaScript kernel against.

For each (propellant, O/F, inlet pressure): an HP equilibrium (adiabatic gas generator) and, for each pressure
ratio, an SP equilibrium at p_in / PR (shifting isentropic expansion), with the product species restricted to
the gas species idea 31's kernel uses (idea 31's oracle/species-survey.json 'selected'). A second HP+SP run with
every product CEA would consider (condensed included) records whether a condensed phase forms. Also one TP state
(the J-2 oxidizer-turbine inlet, 760 F and 89.5 psia, at the gas-generator mixture ratio) and its expansion.

Run from the bank root, with a venv that has `pip install cea==3.3.4`:
  <venv>/bin/python -I -B ideas/33-engine-deck/oracle/cea_turbine.py
"""
import json, os, math, datetime
import numpy as np
import cea

HERE = os.path.dirname(os.path.abspath(__file__))
M31 = os.path.join(HERE, '..', '..', '31-mixture', 'oracle')
SELECTED = json.load(open(os.path.join(M31, 'species-survey.json')))['selected']
CONDENSED = ('C(gr)', 'H2O(L)', 'H2O(cr)')
PSI = 0.45359237 * 9.80665 / 0.0254 ** 2  # Pa per psi, exact definitions

PAIRS = {
    'lox-lh2': (['O2(L)', 'H2(L)'], [90.17, 20.27], [1.0, 0.0], [0.0, 1.0]),
    'lox-rp1': (['O2(L)', 'RP-1'], [90.17, 298.15], [1.0, 0.0], [0.0, 1.0]),
    'lox-ch4': (['O2(L)', 'CH4(L)'], [90.17, 111.643], [1.0, 0.0], [0.0, 1.0]),
}
CASES = [
    # (pair, O/F list, inlet pressures in bar, pressure ratios)
    ('lox-lh2', [0.6, 0.8, 1.0, 1.2, 1.4], [6.0, 45.0, 103.0, 405.0], [1.4, 1.6, 2.5, 7.3, 20.0]),
    ('lox-rp1', [30.0, 40.0, 60.0], [100.0, 300.0], [1.5, 2.0]),
    ('lox-ch4', [20.0, 40.0], [100.0, 300.0], [1.5, 2.0]),
]


def sig(x, n=10):
    x = float(x)
    return x if (x == 0 or not math.isfinite(x)) else float(f'{x:.{n}g}')


def mixtures(pair, restrict):
    names, T, ow, fw = PAIRS[pair]
    reac = cea.Mixture(names)
    prod = cea.Mixture(names, products_from_reactants=True)
    if restrict:
        allowed = set(prod.species_names)
        prod = cea.Mixture([n for n in SELECTED if n in allowed])
    return reac, prod, np.array(T), np.array(ow), np.array(fw)


def state(sol):
    return {'T': sig(sol.T), 'h': sig(sol.enthalpy * 1e3), 's': sig(sol.entropy * 1e3), 'M': sig(sol.M / 1e3),
            'cp_fr': sig(sol.cp_fr * 1e3), 'gamma_s': sig(sol.gamma_s)}


def condensed(sol):
    return [k for k, v in sol.mole_fractions.items() if k in CONDENSED and v > 0]


def run(pair, of, p_bar, prs, restrict):
    reac, prod, T, ow, fw = mixtures(pair, restrict)
    w = reac.of_ratio_to_weights(ow, fw, of)
    h0 = reac.calc_property(cea.ENTHALPY, w, T) / cea.R
    solver = cea.EqSolver(prod, reactants=reac)
    sol = cea.EqSolution(solver)
    solver.solve(sol, cea.HP, h0, p_bar, w)
    if not sol.converged:
        return {'converged': False}
    inlet = state(sol)
    out = {'inlet': inlet, 'condensed_in': condensed(sol), 'expansions': []}
    s_over_R = sol.entropy * 1e3 / cea.R
    for pr in prs:
        e = cea.EqSolution(solver)
        solver.solve(e, cea.SP, s_over_R, p_bar / pr, w)
        st = state(e) if e.converged else None
        out['expansions'].append({'pr': pr, 'converged': bool(e.converged), 'outlet': st,
                                  'dh_is': sig(inlet['h'] - st['h']) if st else None, 'condensed': condensed(e) if e.converged else None})
    return out


def tp_case(pair, of, T, p_bar, pr):
    reac, prod, Tr, ow, fw = mixtures(pair, True)
    w = reac.of_ratio_to_weights(ow, fw, of)
    solver = cea.EqSolver(prod, reactants=reac)
    sol = cea.EqSolution(solver)
    solver.solve(sol, cea.TP, T, p_bar, w)
    inlet = state(sol)
    e = cea.EqSolution(solver)
    solver.solve(e, cea.SP, sol.entropy * 1e3 / cea.R, p_bar / pr, w)
    return {'pair': pair, 'of': of, 'T': T, 'p_Pa': sig(p_bar * 1e5), 'pr': pr, 'inlet': inlet, 'outlet': state(e), 'dh_is': sig(inlet['h'] - e.enthalpy * 1e3)}


def main():
    cases = []
    for pair, ofs, ps, prs in CASES:
        for of in ofs:
            for p in ps:
                r = run(pair, of, p, prs, True)
                full = run(pair, of, p, prs, False)
                r.update({'pair': pair, 'of': of, 'p_Pa': sig(p * 1e5)})
                r['full_condensed_in'] = full.get('condensed_in')
                r['full_condensed_out'] = [x['condensed'] for x in full.get('expansions', [])]
                cases.append(r)
    # J-2 oxidizer turbine inlet (SP-8107 Table III): 760 F at 89.5 psia, at two gas-generator mixture ratios
    tp = [tp_case('lox-lh2', of, (760 + 459.67) / 1.8, 89.5 * PSI / 1e5, 2.5) for of in (0.8, 0.95)]
    doc = {
        'oracle': f'cea {cea.__version__} (NASA, pip package cea); EqSolver HP, SP and TP; R = {cea.R} J/(kmol K)',
        'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'units': 'T K; h J/kg; s J/(kg K); M kg/mol; cp_fr J/(kg K); p Pa; dh_is = h_in - h_out (J/kg) along the shifting isentrope',
        'species': 'gas products restricted to idea 31 oracle/species-survey.json selected; full_* fields: every CEA product, condensed included',
        'cases': cases, 'tp': tp,
    }
    path = os.path.join(HERE, 'cea-turbine.json')
    json.dump(doc, open(path, 'w'), separators=(',', ':'))
    print('wrote', path, len(cases), 'HP cases,', sum(len(c.get('expansions', [])) for c in cases), 'expansions,', len(tp), 'TP cases')


if __name__ == '__main__':
    main()
