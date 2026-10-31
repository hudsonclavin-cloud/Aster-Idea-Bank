#!/usr/bin/env python3
"""Oracle for idea 39's Lambert solver: two independent libraries on the same inputs.

  hapsira 0.18.0   hapsira.core.iod.izzo   (the maintained fork of poliastro, the library Aster validated against;
                                            same method, Izzo 2015, independent code)
  lamberthub 1.0.0 lamberthub.gooding1990  (R. H. Gooding, "A procedure for the solution of Lambert's orbital
                                            boundary-value problem", Celest. Mech. 48 (1990) 145-165: a different
                                            method, Lancaster-Blanchard with Halley iterations on a different variable)

Run in a throw-away venv (never by the page, never by the tests):
  python3 -m venv <scratch>/venv39 && <scratch>/venv39/bin/pip install numpy scipy numba astropy jplephem
  <scratch>/venv39/bin/pip install --no-deps hapsira lamberthub
  <scratch>/venv39/bin/python -I ideas/39-lamberts-road/oracle/lambert_oracle.py

Writes oracle/lambert-oracle.json next to this file: every case's inputs (SI) and both libraries' v1, v2.
Cases: Aster's five pinned cells (tests/fixtures/v2/lambert-multi-rev-pinned-cells.json, read from cases.json which
build-cases.mjs copies them into); 40 seeded random heliocentric geometries (short hyperbolic and long flights,
transfer angles from 1 to 359 deg, zero, one and two revolutions on both branches); and 30 direct transfers timed
near the parabolic flight time of their geometry (Lambert's/Euler's t_p), 0.97-1.03 t_p and 1.05-1.6 t_p, so that
Izzo's time-of-flight function is exercised in Battin's series and Lagrange's form as well as Lancaster's.
"""
import json, math, os, sys, random
import numpy as np
from hapsira.core.iod import izzo as hz_izzo
import hapsira, lamberthub
from lamberthub import gooding1990

HERE = os.path.dirname(os.path.abspath(__file__))
MU = 1.32712440018e20  # Aster's GM_SUN (snapshots/aster-constants.js); the oracle only needs a consistent value
AU = 149597870700.0


def solve_all(r1, r2, tof, M, lowpath):
    out = {}
    try:
        v1, v2 = hz_izzo(MU, np.array(r1), np.array(r2), tof, M, True, lowpath, 100, 1e-12)
        out['hapsira'] = {'v1': list(map(float, v1)), 'v2': list(map(float, v2))}
    except Exception as e:  # no solution for this M, or not converged
        out['hapsira'] = {'error': type(e).__name__ + ': ' + str(e)[:120]}
    try:
        v1, v2 = gooding1990(MU, np.array(r1), np.array(r2), tof, M=M, prograde=True, low_path=lowpath, maxiter=60, atol=1e-13, rtol=1e-13)
        out['gooding'] = {'v1': list(map(float, v1)), 'v2': list(map(float, v2))}
    except Exception as e:
        out['gooding'] = {'error': type(e).__name__ + ': ' + str(e)[:120]}
    return out


def main():
    cases = []
    pinned = json.load(open(os.path.join(HERE, 'cases.json')))
    for c in pinned['aster_pinned']:
        r1 = [x * 1000 for x in c['r1Km']]; r2 = [x * 1000 for x in c['r2Km']]
        M = c['M']
        paths = [True] if M == 0 else [True, False]
        for lp in paths:
            cases.append(dict(id=c['id'] + ('' if M == 0 else ('-low' if lp else '-high')), kind='aster', r1=r1, r2=r2, tof=c['tofSeconds'], M=M, lowpath=lp, res=solve_all(r1, r2, c['tofSeconds'], M, lp)))
    rng = random.Random(39)
    k = 0
    while k < 40:
        ra = rng.uniform(0.6, 3.2) * AU; rb = rng.uniform(0.6, 3.2) * AU
        th = math.radians(rng.choice([rng.uniform(1, 359), rng.uniform(170, 190), rng.uniform(1, 10), rng.uniform(350, 359)]))
        inc = math.radians(rng.uniform(-25, 25))
        r1 = [ra, 0.0, 0.0]
        r2 = [rb * math.cos(th), rb * math.sin(th) * math.cos(inc), rb * math.sin(th) * math.sin(inc)]
        # rotate the pair by a random rotation so no axis is special (the prograde test stays about the frame's z)
        a, b, g = [rng.uniform(-0.4, 0.4) for _ in range(3)]
        Rz = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
        Rx = np.array([[1, 0, 0], [0, math.cos(b), -math.sin(b)], [0, math.sin(b), math.cos(b)]])
        Rz2 = np.array([[math.cos(g), -math.sin(g), 0], [math.sin(g), math.cos(g), 0], [0, 0, 1]])
        R = Rz2 @ Rx @ Rz
        r1 = list(map(float, R @ np.array(r1))); r2 = list(map(float, R @ np.array(r2)))
        M = rng.choice([0, 0, 0, 1, 1, 2])
        tof = rng.choice([rng.uniform(5, 60), rng.uniform(60, 400), rng.uniform(400, 1500), rng.uniform(600, 2600)]) * 86400.0
        lp = rng.choice([True, False]) if M > 0 else True
        res = solve_all(r1, r2, tof, M, lp)
        if M > 0 and 'error' in res['hapsira'] and 'error' in res['gooding']:
            continue  # no M-revolution solution at this flight time; keep looking (the JS test checks T_min separately)
        cases.append(dict(id='rnd-%03d' % k, kind='random', r1=r1, r2=r2, tof=tof, M=M, lowpath=lp, res=res))
        k += 1
    k = 0
    while k < 30:
        ra = rng.uniform(0.6, 3.2) * AU; rb = rng.uniform(0.6, 3.2) * AU
        th = math.radians(rng.uniform(5, 355)); inc = math.radians(rng.uniform(-10, 10))
        r1 = [ra, 0.0, 0.0]
        r2 = [rb * math.cos(th), rb * math.sin(th) * math.cos(inc), rb * math.sin(th) * math.sin(inc)]
        c = math.dist(r1, r2); s = (ra + rb + c) / 2
        sgn = 1.0 if r2[1] >= 0 else -1.0   # prograde about z: the short way when y > 0
        tp = math.sqrt(2 / MU) / 3 * (s ** 1.5 - sgn * (s - c) ** 1.5)
        f = rng.uniform(0.97, 1.03) if k < 18 else rng.uniform(1.05, 1.6)
        tof = tp * f
        cases.append(dict(id='par-%03d' % k, kind='near-parabolic', r1=r1, r2=r2, tof=tof, M=0, lowpath=True, tp=tp, res=solve_all(r1, r2, tof, 0, True)))
        k += 1
    def rnd15(o):
        if isinstance(o, float): return float('%.15g' % o)
        if isinstance(o, list): return [rnd15(x) for x in o]
        if isinstance(o, dict): return {k: rnd15(v) for k, v in o.items()}
        return o
    cases = rnd15(cases)
    out = {
        'generated': 'ideas/39-lamberts-road/oracle/lambert_oracle.py',
        'libraries': {'hapsira': hapsira.__version__, 'lamberthub': lamberthub.__version__, 'numpy': np.__version__, 'python': sys.version.split()[0]},
        'mu_m3_s2': MU,
        'prograde': 'about the frame z axis (all three solvers)',
        'rounding': 'every number to 15 significant digits',
        'branch_map': 'lowpath True = the root nearer x = +1 (idea 39 and Aster: right); False = nearer -1 (left)',
        'cases': cases,
    }
    with open(os.path.join(HERE, 'lambert-oracle.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('cases', len(cases))


if __name__ == '__main__':
    main()
