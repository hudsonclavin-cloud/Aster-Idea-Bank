#!/usr/bin/env python3
"""Independent oracle for idea 38 (Burn Out): finite departure burns flown with scipy, not with the kernel.

Reads oracle/cases.json (written by build-cases.mjs from the kernel's own scenarios) and writes oracle/oracle.json.
Nothing here imports or ports the JavaScript kernel; it shares only the inputs. Run in a throw-away venv:

    python3 -m venv <scratchpad>/venv && <scratchpad>/venv/bin/pip install numpy scipy
    <scratchpad>/venv/bin/python -I ideas/38-burn-out/oracle/burn_oracle.py

What it computes:
  planar   a constant-thrust burn from a circular orbit about a point mass to a target energy, in the plane:
           (1) tangential steering (thrust along the velocity), DOP853 at rtol 1e-12 with the cutoff as an event;
           (2) the steering law the kernel optimises (thrust turned from the velocity by a + b (t/tf - 1/2)), optimised here
               with SLSQP (minimum burn time, which at constant thrust is minimum propellant, subject to the energy);
           (3) the best any steering can do: the turn angle as a piecewise-linear function of t/tf at 4, 8 and 16 knots,
               the same minimisation (direct transcription); the knot doubling shows convergence. A circular start about
               a point mass is symmetric under rotation, so the asymptote's direction is free and minimum time to the
               energy is the whole problem.
  j2case   the kernel's solved tangential burn for the chain's departure (with its small constant yaw), in 3-D with J2
           written out independently, DOP853 at rtol 1e-12, from the same ignition state, cut off on the energy conserved
           under point mass + J2: cutoff time, state and mass; then the coast out to 20 Earth radii and the asymptote there.
  (--keep-planar reuses the planar results already in oracle.json, which take about ten minutes.)
  multi    N tangential perigee burns, planar, point mass, by the kernel's splitting rule (apogee raised to equal shares of
           the impulsive delta-v, each later burn started half its rocket-equation duration before perigee), with the
           coasts done ANALYTICALLY (Kepler's equation) instead of numerically.
"""
import json
import math
import os
import sys
import time

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = json.load(open(os.path.join(HERE, 'cases.json')))
MU = CASES['mu']
RTOL, ATOL = 1e-12, 1e-9


def energy2(y):
    return 0.5 * (y[2] ** 2 + y[3] ** 2) - MU / math.hypot(y[0], y[1])


def rhs2(F, mdot, steer):
    def f(t, y):
        x, yy, vx, vy, m = y
        r3 = (x * x + yy * yy) ** 1.5
        ux, uy = steer(t, y)
        a = F / m
        return [vx, vy, -MU * x / r3 + a * ux, -MU * yy / r3 + a * uy, -mdot]
    return f


def tangential(t, y):
    v = math.hypot(y[2], y[3])
    return y[2] / v, y[3] / v


def turned(delta_of):
    """Thrust turned from the velocity toward the local 'up' (r's part normal to v) by delta(t)."""
    def s(t, y):
        vx, vy = y[2], y[3]
        v = math.hypot(vx, vy)
        vh = (vx / v, vy / v)
        rd = y[0] * vh[0] + y[1] * vh[1]
        ux, uy = y[0] - rd * vh[0], y[1] - rd * vh[1]
        n = math.hypot(ux, uy)
        up = (ux / n, uy / n)
        d = delta_of(t)
        return math.cos(d) * vh[0] + math.sin(d) * up[0], math.cos(d) * vh[1] + math.sin(d) * up[1]
    return s


def circular(r0):
    return [r0, 0.0, 0.0, math.sqrt(MU / r0)]


def burn_to_energy(y0, m0, F, mdot, steer, Ef, tmax=2e4):
    ev = lambda t, y: energy2(y) - Ef
    ev.terminal, ev.direction = True, 1
    sol = solve_ivp(rhs2(F, mdot, steer), (0, tmax), list(y0) + [m0], method='DOP853', rtol=RTOL, atol=ATOL, events=ev)
    return sol.t_events[0][0], sol.y_events[0][0]


def fly_fixed_time(y0, m0, F, mdot, delta_of, tf, n=400):
    """Fixed-step RK4 over [0, tf] in n steps with the thrust turned from the velocity by delta_of(t): used inside the
    optimiser, where a smooth, fast function of the controls matters more than the last digit (DOP853 checks the
    tangential burns; the optimiser's tangential start is checked against it in the output)."""
    h = tf / n
    x, y, vx, vy, m = y0[0], y0[1], y0[2], y0[3], m0
    a_F = F

    def d(t, x, y, vx, vy, m):
        r2 = x * x + y * y
        r3 = r2 * math.sqrt(r2)
        v = math.sqrt(vx * vx + vy * vy)
        hx, hy = vx / v, vy / v
        rd = x * hx + y * hy
        ux, uy = x - rd * hx, y - rd * hy
        un = math.sqrt(ux * ux + uy * uy)
        ux, uy = ux / un, uy / un
        dd = delta_of(t)
        c, s_ = math.cos(dd), math.sin(dd)
        a = a_F / m
        return vx, vy, -MU * x / r3 + a * (c * hx + s_ * ux), -MU * y / r3 + a * (c * hy + s_ * uy), -mdot

    t = 0.0
    for _ in range(n):
        k1 = d(t, x, y, vx, vy, m)
        k2 = d(t + h / 2, x + h / 2 * k1[0], y + h / 2 * k1[1], vx + h / 2 * k1[2], vy + h / 2 * k1[3], m + h / 2 * k1[4])
        k3 = d(t + h / 2, x + h / 2 * k2[0], y + h / 2 * k2[1], vx + h / 2 * k2[2], vy + h / 2 * k2[3], m + h / 2 * k2[4])
        k4 = d(t + h, x + h * k3[0], y + h * k3[1], vx + h * k3[2], vy + h * k3[3], m + h * k3[4])
        x += h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
        y += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
        vx += h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])
        vy += h / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3])
        m += h / 6 * (k1[4] + 2 * k2[4] + 2 * k3[4] + k4[4])
        t += h
    return [x, y, vx, vy, m]


def planar_case(c):
    r0, m0, F, mdot = c['r0'], c['m0'], c['F'], c['mdot']
    Ef = c['c3'] / 2
    ve = F / mdot
    y0 = circular(r0)
    vc = y0[3]
    dv_imp = math.sqrt(c['c3'] + 2 * MU / r0) - vc
    out = {'id': c['id'], 'dv_impulsive': dv_imp, 'tw0': F / (m0 * 9.80665)}
    t0 = time.time()
    tf, yf = burn_to_energy(y0, m0, F, mdot, tangential, Ef)
    out['tangential'] = {'tf': tf, 'mf': yf[4], 'dv': ve * math.log(m0 / yf[4]), 'loss': ve * math.log(m0 / yf[4]) - dv_imp,
                         'r_cut': math.hypot(yf[0], yf[1])}

    def optimise(nk, x0=None):
        """Minimum tf over knots of delta (rad) at t/tf = 0..1 (nk >= 2; nk = 2 is the kernel's linear law)."""
        knots = np.linspace(0, 1, nk)

        def unpack(x):
            return x[:-1], x[-1]

        def cons(x):
            d, T = unpack(x)
            kd = [float(q) for q in d]
            if nk == 2:
                f = lambda t: kd[0] + (kd[1] - kd[0]) * t / T
            else:
                f = lambda t: float(np.interp(t / T, knots, kd))
            return (energy2(fly_fixed_time(y0, m0, F, mdot, f, T)) - Ef) / 1e3

        if x0 is None:
            x0 = np.concatenate([np.zeros(nk), [tf]])
        res = minimize(lambda x: x[-1] / tf, x0, method='SLSQP', constraints=[{'type': 'eq', 'fun': cons}],
                       options={'ftol': 1e-12, 'maxiter': 200, 'eps': 1e-6})
        d, T = unpack(res.x)
        mf = m0 - mdot * T
        return {'knots': nk, 'tf': T, 'mf': mf, 'dv': ve * math.log(m0 / mf), 'loss': ve * math.log(m0 / mf) - dv_imp,
                'delta_deg': [float(x) * 180 / math.pi for x in d], 'constraint': float(cons(res.x)), 'success': bool(res.success)}, res.x

    out['tangential']['rk4_energy_error'] = energy2(fly_fixed_time(y0, m0, F, mdot, lambda t: 0.0, tf)) - Ef
    lin, _ = optimise(2)
    print(c['id'], 'linear done', round(time.time() - t0, 1), 's', flush=True)
    out['linear'] = lin
    best = []
    prev = None
    for nk in (4, 8, 16):
        x0 = None
        if prev is not None:
            kn_prev = np.linspace(0, 1, len(prev) - 1)
            x0 = np.concatenate([np.interp(np.linspace(0, 1, nk), kn_prev, prev[:-1]), [prev[-1]]])
        r, prev = optimise(nk, x0)
        best.append(r)
        print(c['id'], nk, 'knots', round(time.time() - t0, 1), 's', 'loss %.4f' % r['loss'], flush=True)
    out['optimal'] = best
    out['seconds'] = time.time() - t0
    return out


def j2_case(c):
    mu, J2, R = c['mu'], c['J2'], c['RJ2']
    F, mdot, yaw = c['F'], c['mdot'], c['yaw']

    def grav(r):
        rn = np.linalg.norm(r)
        z = r[2]
        # gradient of the J2 zonal potential V = -mu J2 R^2 P2(z/r) / r^3, written out independently
        fac = 1.5 * J2 * mu * R * R / rn ** 5
        q = 5 * z * z / (rn * rn)
        return -mu * r / rn ** 3 + np.array([fac * r[0] * (q - 1), fac * r[1] * (q - 1), fac * r[2] * (q - 3)])

    def etot(y):
        r = np.array(y[0:3])
        rn = np.linalg.norm(r)
        s = r[2] / rn
        return 0.5 * (y[3] ** 2 + y[4] ** 2 + y[5] ** 2) - mu / rn + mu * J2 * R * R * (3 * s * s - 1) / 2 / rn ** 3

    def f(t, y):
        r = np.array(y[0:3])
        v = np.array(y[3:6])
        n = np.cross(r, v)
        n = n / np.linalg.norm(n)
        u = math.cos(yaw) * v / np.linalg.norm(v) + math.sin(yaw) * n
        a = grav(r) + F / y[6] * u
        return list(v) + list(a) + [-mdot]

    def ev(t, y):
        return etot(y) - c['E']
    ev.terminal, ev.direction = True, 1
    sol = solve_ivp(f, (0, 5000), list(c['r']) + list(c['v']) + [c['m0']], method='DOP853', rtol=RTOL, atol=1e-9, events=ev)
    y = sol.y_events[0][0]
    out = {'id': c['id'], 'tf': float(sol.t_events[0][0]), 'r': [float(x) for x in y[0:3]], 'v': [float(x) for x in y[3:6]], 'm': float(y[6])}

    # the coast after cutoff out to farRadius, then the osculating hyperbola's asymptote and C3
    def fc(t, yy):
        return list(yy[3:6]) + list(grav(np.array(yy[0:3])))

    def far(t, yy):
        return np.linalg.norm(yy[0:3]) - c['farRadius']
    far.terminal, far.direction = True, 1
    s2 = solve_ivp(fc, (0, 1e7), list(y[0:6]), method='DOP853', rtol=RTOL, atol=1e-6, events=far)
    yf = s2.y_events[0][0]
    r, v = np.array(yf[0:3]), np.array(yf[3:6])
    h = np.cross(r, v)
    ev_ = np.cross(v, h) / mu - r / np.linalg.norm(r)
    e = np.linalg.norm(ev_)
    eh, hh = ev_ / e, h / np.linalg.norm(h)
    nu = math.acos(-1 / e)
    shat = math.cos(nu) * eh + math.sin(nu) * np.cross(hh, eh)
    out['far'] = {'t': float(s2.t_events[0][0]), 'c3': float(np.dot(v, v) - 2 * mu / np.linalg.norm(r)), 's_hat': [float(x) for x in shat], 'energy_conserved': float(2 * etot(yf))}
    return out


def kepler_elements(y):
    x, yy, vx, vy = y[:4]
    r = math.hypot(x, yy)
    h = x * vy - yy * vx
    E = energy2(y)
    a = -MU / (2 * E)
    ex = (vy * h) / MU - x / r
    ey = (-vx * h) / MU - yy / r
    e = math.hypot(ex, ey)
    return a, e, math.atan2(ey, ex), h


def state_at_mean_anomaly(a, e, w, M):
    Ea = M
    for _ in range(60):
        Ea = Ea - (Ea - e * math.sin(Ea) - M) / (1 - e * math.cos(Ea))
    nu = 2 * math.atan2(math.sqrt(1 + e) * math.sin(Ea / 2), math.sqrt(1 - e) * math.cos(Ea / 2))
    p = a * (1 - e * e)
    r = p / (1 + e * math.cos(nu))
    th = w + nu
    vr = math.sqrt(MU / p) * e * math.sin(nu)
    vt = math.sqrt(MU / p) * (1 + e * math.cos(nu))
    return [r * math.cos(th), r * math.sin(th), vr * math.cos(th) - vt * math.sin(th), vr * math.sin(th) + vt * math.cos(th)]


def multi_case(c):
    N, r0, m0, F, mdot = c['N'], c['r0'], c['m0'], c['F'], c['mdot']
    ve = F / mdot
    Ef = c['c3'] / 2
    y = circular(r0)
    vc = y[3]
    dv_imp = math.sqrt(c['c3'] + 2 * MU / r0) - vc
    share = dv_imp / N
    m = m0
    burns = []
    for k in range(1, N + 1):
        Ek = (vc + k * share) ** 2 / 2 - MU / r0 if k < N else Ef
        tb, yf = burn_to_energy(y, m, F, mdot, tangential, Ek)
        burns.append({'duration': tb, 'mf': yf[4], 'dv': ve * math.log(m / yf[4])})
        m = yf[4]
        if k == N:
            break
        a, e, w, h = kepler_elements(list(yf[:4]))
        n = math.sqrt(MU / a ** 3)
        rp = a * (1 - e)
        vp = math.sqrt(MU * (2 / rp - 1 / a))
        Enext = (vc + (k + 1) * share) ** 2 / 2 - MU / r0 if k + 1 < N else Ef
        dvn = math.sqrt(2 * (Enext + MU / rp)) - vp
        d = m * (1 - math.exp(-dvn / ve)) / mdot
        # ignition half the burn before the next perigee: mean anomaly 2 pi - n d/2, coasted analytically
        y = state_at_mean_anomaly(a, e, w, -n * d / 2)
    dv = sum(b['dv'] for b in burns)
    return {'id': c['id'], 'N': N, 'burns': burns, 'mf': m, 'dv': dv, 'loss': dv - dv_imp, 'dv_impulsive': dv_imp}


def main():
    t0 = time.time()
    out = {'generator': 'oracle/burn_oracle.py', 'python': sys.version.split()[0], 'numpy': np.__version__,
           'scipy': __import__('scipy').__version__, 'rtol': RTOL}
    keep = '--keep-planar' in sys.argv and os.path.exists(os.path.join(HERE, 'oracle.json'))
    out['planar'] = json.load(open(os.path.join(HERE, 'oracle.json')))['planar'] if keep else [planar_case(c) for c in CASES['planar']]
    out['j2case'] = j2_case(CASES['j2case'])
    out['multi'] = [multi_case(c) for c in CASES['multi']]
    out['seconds'] = time.time() - t0
    json.dump(out, open(os.path.join(HERE, 'oracle.json'), 'w'), indent=1)
    for p in out['planar']:
        print(p['id'], 'tw %.3f' % p['tw0'], 'loss tangential %.4f linear %.4f optimal %s' % (
            p['tangential']['loss'], p['linear']['loss'], ' '.join('%.4f' % o['loss'] for o in p['optimal'])))
    print('j2', out['j2case']['tf'], out['j2case']['m'])
    for mm in out['multi']:
        print(mm['id'], 'loss %.4f' % mm['loss'])
    print('seconds', round(out['seconds'], 1))


if __name__ == '__main__':
    main()
