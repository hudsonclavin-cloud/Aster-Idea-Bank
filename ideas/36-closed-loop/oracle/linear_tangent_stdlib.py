#!/usr/bin/env python3
"""A second, standard-library-only oracle for idea 36 (Closed Loop), added by the independent review.

Writes oracle/envelope-oracle.json. No numpy, no scipy, no venv: runs in about ten seconds with plain python3 -I.

What it computes. The flat-Earth burn of oracle/cases.json ("gentle": three J-2s from 150 km, 6,000 m/s horizontal and
100 m/s vertical, to a chosen height with no vertical speed and 7,000 m/s horizontal, downrange free, uniform gravity
g0, no air) for a family of climbs from 5 to 20 km (the "gentle" and "steep" cases are its two ends). For each, the
minimum-time steering is the linear tangent, tan(pitch) = b - c t (the costates on vx and vy are constant and linear in
time when downrange is free); this script finds b, c and the burn time T* by Newton shooting on its own fixed-step RK4
(20,000 steps), each climb started from the one before (continuation). The sweep is the angle the optimal thrust turns
through, pitch(0) - pitch(T*).

What it is for. (1) An independent check of guidance_oracle.py's T* for "gentle" and "steep" (different integrator,
different solver, different language level). (2) The envelope test in closedloop.test.mjs: across the family the
kernel's UPFG must never beat T* and must never claim a cutoff it did not reach; where it does converge, how late it is
is what the README reports.

Run from the bank root:  python3 -I ideas/36-closed-loop/oracle/linear_tangent_stdlib.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = json.load(open(os.path.join(HERE, 'cases.json')))
BASE = CASES['flat']['gentle']
CLIMBS_M = [5000, 8000, 10000, 12000, 14000, 16000, 18000, 20000]
N_STEPS = 20000


def fly(c, b, cc, T):
    F = c['engines'] * c['thrustPerEngine_N']
    md = c['engines'] * c['mdotPerEngine_kg_s']
    m0, g = c['m0_kg'], c['g']
    h = T / N_STEPS
    s = [0.0, c['y0_m'], c['vx0_m_s'], c['vy0_m_s']]

    def f(t, s):
        a = F / (m0 - md * t)
        th = math.atan(b - cc * t)
        return [s[2], s[3], a * math.cos(th), a * math.sin(th) - g]
    t = 0.0
    for _ in range(N_STEPS):
        k1 = f(t, s)
        k2 = f(t + h / 2, [s[j] + h / 2 * k1[j] for j in range(4)])
        k3 = f(t + h / 2, [s[j] + h / 2 * k2[j] for j in range(4)])
        k4 = f(t + h, [s[j] + h * k3[j] for j in range(4)])
        s = [s[j] + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]) for j in range(4)]
        t += h
    return s


def residual(c, p):
    s = fly(c, *p)
    return [s[1] - c['yT_m'], s[3], s[2] - c['vxT_m_s']]


def solve3(A, r):
    M = [A[i][:] + [-r[i]] for i in range(3)]
    for i in range(3):
        piv = max(range(i, 3), key=lambda q: abs(M[q][i]))
        M[i], M[piv] = M[piv], M[i]
        for q in range(i + 1, 3):
            f = M[q][i] / M[i][i]
            M[q] = [M[q][j] - f * M[i][j] for j in range(4)]
    x = [0.0, 0.0, 0.0]
    for i in (2, 1, 0):
        x[i] = (M[i][3] - sum(M[i][j] * x[j] for j in range(i + 1, 3))) / M[i][i]
    return x


def shoot(c, p):
    for it in range(40):
        r = residual(c, p)
        cols = []
        for k in range(3):
            q = p[:]
            d = 1e-7 * max(1.0, abs(p[k]))
            q[k] += d
            rr = residual(c, q)
            cols.append([(rr[i] - r[i]) / d for i in range(3)])
        A = [[cols[k][i] for k in range(3)] for i in range(3)]
        x = solve3(A, r)
        lam = 1.0
        while lam > 1e-3:  # damped Newton: never step to a negative time or a worse residual
            q = [p[i] + lam * x[i] for i in range(3)]
            if q[2] > 0 and max(map(abs, residual(c, q))) < max(map(abs, r)) * (1 - 1e-4 * lam) + 1e-9:
                break
            lam /= 2
        p = q
        if max(abs(v) for v in x) * lam < 1e-11:
            break
    return p, residual(c, p), it + 1


def main():
    out = {'generated': 'python3 -I ideas/36-closed-loop/oracle/linear_tangent_stdlib.py', 'method': 'Newton shooting on (b, c, T) for tan(pitch) = b - c t, fixed-step RK4 with %d steps, continuation in the climb' % N_STEPS,
           'base': 'cases.json flat.gentle with yT_m = y0_m + climb', 'cases': []}
    p = [0.8, 0.014, 54.0]
    for climb in CLIMBS_M:
        c = dict(BASE)
        c['yT_m'] = BASE['y0_m'] + climb
        p, r, its = shoot(c, p)
        b, cc, T = p
        p0, pT = math.degrees(math.atan(b)), math.degrees(math.atan(b - cc * T))
        out['cases'].append({'climb_m': climb, 'yT_m': c['yT_m'], 'T_s': T, 'b': b, 'c_per_s': cc, 'pitch0_deg': p0, 'pitchT_deg': pT, 'sweep_deg': p0 - pT,
                             'max_residual': max(map(abs, r)), 'newton_iterations': its})
        print('climb %5.0f m: T* %.6f s, pitch %.3f -> %.3f deg (sweep %.1f), residual %.1e' % (climb, T, p0, pT, p0 - pT, max(map(abs, r))))
    with open(os.path.join(HERE, 'envelope-oracle.json'), 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()
