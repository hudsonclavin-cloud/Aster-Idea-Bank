#!/usr/bin/env python3
"""Independent oracle for idea 36 (Closed Loop). Writes oracle/guidance-oracle.json from oracle/cases.json.

Written separately from closedloop.js (numpy and scipy only; scipy's DOP853 integrator; its own mass bookkeeping from
the vehicle data in cases.json). Never imported by the page. Run in a throw-away venv:
    python3 -m venv <scratch>/venv && <scratch>/venv/bin/pip install numpy scipy
    <scratch>/venv/bin/python -I ideas/36-closed-loop/oracle/guidance_oracle.py

Three checks:
  flat      Minimum-time ascent over a flat Earth in uniform gravity, constant thrust, no air, to an altitude with no
            vertical speed and a given horizontal speed, downrange free. The optimality conditions (costates on x
            and y constant, on vx constant, on vy linear in time) make the thrust direction (1, b - c t) normalised:
            the linear tangent law. Solved two ways: (i) the law, shooting on b, c and T; (ii) a direct optimisation
            over a piecewise-linear pitch with no assumed form. Both must agree; the kernel's UPFG is held to them.
  replay    The AS-512 upper stages from the start of guidance, re-flown on the thrust directions the kernel commanded
            (each held in inertial space as the kernel holds it), with this file's own integrator and its own event and
            mass bookkeeping from idea 34's vehicle data: the state and mass at the kernel's cutoff time.
  optimum   The least S-IVB burn that reaches the same target (radius, zero flight-path angle, speed, plane) from the
            same state with the same stages, by direct optimisation (SLSQP) over piecewise-linear inertial pitch and
            yaw on K nodes; K = 8, 16, 24, each warm-started from the last, to show it has converged. What UPFG gives away is the kernel's burn minus this.
"""
import json
import math
import os
import sys
import time

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import least_squares, minimize

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = json.load(open(os.path.join(HERE, 'cases.json')))
RTOL, ATOL = 1e-11, 1e-6


def unit(a):
    return a / np.linalg.norm(a)


# ============================================================== flat
def flat_case(c, direct=True):
    g, Ft, mdt, m0 = c['g'], c['engines'] * c['thrustPerEngine_N'], c['engines'] * c['mdotPerEngine_kg_s'], c['m0_kg']
    y0, vx0, vy0, yT, vxT = c['y0_m'], c['vx0_m_s'], c['vy0_m_s'], c['yT_m'], c['vxT_m_s']

    def fly(direction, T):
        def f(t, s):
            ux, uy = direction(t)
            a = Ft / (m0 - mdt * t)
            return [s[2], s[3], a * ux, a * uy - g]
        sol = solve_ivp(f, (0, T), [0.0, y0, vx0, vy0], method='DOP853', rtol=1e-12, atol=1e-9)
        return sol.y[:, -1]

    # (i) the linear tangent law
    def law(b, cc):
        def d(t):
            k = b - cc * t
            n = math.sqrt(1 + k * k)
            return 1 / n, k / n
        return d

    def res(p):
        b, cc, T = p
        s = fly(law(b, cc), T)
        return [(s[1] - yT) / 1000, s[3] / 100, (s[2] - vxT) / 100]
    sol = least_squares(res, [0.5, 0.005, 60.0], xtol=1e-15, ftol=1e-15, gtol=1e-15, max_nfev=2000)
    b, cc, T = sol.x
    lin = {'T_s': T, 'b': b, 'c_per_s': cc, 'pitch0_deg': math.degrees(math.atan(b)), 'pitchT_deg': math.degrees(math.atan(b - cc * T)),
           'residual': float(np.max(np.abs(sol.fun))), 'propellant_kg': mdt * T}

    if not direct:
        return {'linear_tangent': lin}
    # (ii) direct: piecewise-linear pitch on K nodes over [0, T], T free, minimise T
    K = 24

    def pw(th, T):
        ts = np.linspace(0, T, K)
        def d(t):
            p = float(np.interp(t, ts, th))
            return math.cos(p), math.sin(p)
        return d

    def cons(x):
        th, T = x[:K], x[K] * 100
        s = fly(pw(th, T), T)
        return np.array([(s[1] - yT) / 1000, s[3] / 100, (s[2] - vxT) / 100])
    th0 = np.full(K, 0.35)
    x0 = np.concatenate([th0, [0.6]])
    r = minimize(lambda x: x[K], x0, method='SLSQP', constraints=[{'type': 'eq', 'fun': cons}], options={'maxiter': 500, 'ftol': 1e-14, 'eps': 1e-8})
    direct = {'T_s': r.x[K] * 100, 'converged': bool(r.success), 'message': r.message, 'K': K, 'max_constraint': float(np.max(np.abs(cons(r.x)))),
              'pitch0_deg': math.degrees(r.x[0]), 'pitchT_deg': math.degrees(r.x[K - 1])}
    return {'linear_tangent': lin, 'direct': direct}


# ============================================================== AS-512 propagation
A = CASES['as512']
MU = A['mu_m3_s2']
SII, SIVB = A['sII'], A['sIVB']
TGT = A['target']
NHAT = np.array(TGT['n'])


def schedule():
    """The oracle's own event list from the vehicle data: [(t, kind, value)] after guidance start, and the S-IVB ignition
    time. The S-II burn clock at guidance start is computed here from its ignition time."""
    t0 = A['t0_s']
    bc0 = t0 - SII['ignition_s']
    md = SII['mdotPerEngine_kg_s']
    n = SII['engines']
    burned = 0.0
    tcur = 0.0
    evs = sorted(SII['engineOut'], key=lambda e: e['t'])
    # propellant burned up to bc0 (engine counts change on the burn clock)
    for e in evs:
        if e['t'] < bc0:
            burned += n * md * (e['t'] - tcur)
            tcur = e['t']
            n -= e['count']
    burned += n * md * (bc0 - tcur)
    left = SII['propellant_kg'] - burned
    out = []
    t = t0
    for e in evs:
        if e['t'] <= bc0:
            continue
        te = SII['ignition_s'] + e['t']
        dP = n * md * (te - t)
        if dP >= left:
            break
        left -= dP
        out.append((te, 'engines', n - e['count']))
        t = te
        n -= e['count']
    tdep = t + left / (n * md)
    out.append((tdep, 'sII-cutoff', None))
    tign = tdep + A['coast_s']
    out.append((tign, 'sIVB-ignition', None))
    for j in SIVB['jettisons']:
        out.append((tign + j['t'], 'jettison', j['mass']))
    return out, tdep, tign


EVENTS, T_DEP, T_IGN = schedule()


def stage_state(t):
    """Engines lit, thrust and flow per engine at time t (between events)."""
    if t < T_DEP:
        n = SII['engines']
        for (te, kind, val) in EVENTS:
            if kind == 'engines' and te <= t + 1e-12:
                n = val
        return n, SII['thrustPerEngine_N'], SII['mdotPerEngine_kg_s']
    if t < T_IGN:
        return 0, 0.0, 0.0
    return SIVB['engines'], SIVB['thrustPerEngine_N'], SIVB['mdotPerEngine_kg_s']


def mass_drops(t_from, t_to):
    """Mass dropped at events in (t_from, t_to]."""
    d = 0.0
    for (te, kind, val) in EVENTS:
        if t_from < te <= t_to + 1e-12:
            if kind == 'sII-cutoff':
                d += SII['dry_kg'] + SII['remaining_kg']
            elif kind == 'sIVB-ignition':
                d += SIVB['shed_kg']
            elif kind == 'jettison':
                d += val
    return d


def propagate(t0, s0, t1, direction):
    """Integrate [r, v, m] from t0 to t1 with no event inside, thrust along direction(t, r, v)."""
    n, F, md = stage_state(0.5 * (t0 + t1))

    def f(t, s):
        r, v, m = s[:3], s[3:6], s[6]
        rn = np.linalg.norm(r)
        acc = -MU * r / rn ** 3
        if n > 0:
            acc = acc + (n * F / m) * direction(t, r, v)
        return np.concatenate([v, acc, [-n * md]])
    if t1 <= t0:
        return s0
    sol = solve_ivp(f, (t0, t1), s0, method='DOP853', rtol=RTOL, atol=ATOL)
    return sol.y[:, -1]


def fly(t_end, steer_factory, cuts):
    """From guidance start to t_end, cutting integration at every event and at the times in cuts; at each cut the
    steering is rebuilt from the state there (steer_factory(t, r, v, t_next) -> direction function)."""
    t = A['t0_s']
    s = np.concatenate([A['r0_m'], A['v0_m_s'], [A['m0_kg']]])
    marks = sorted(set([te for (te, _, _) in EVENTS if t < te < t_end] + [c for c in cuts if t < c < t_end] + [t_end]))
    log = []
    for tm in marks:
        r, v = s[:3], s[3:6]
        direction = steer_factory(t, r, v, tm)
        s = propagate(t, s, tm, direction)
        drop = mass_drops(t, tm)
        if drop:
            s = s.copy()
            s[6] -= drop
        log.append((tm, float(np.linalg.norm(s[:3])), float(s[6])))
        t = tm
    return s, log


# ---- replay of the kernel's commands
CMDS = A['kernelCommands']
CMD_T = [c[0] for c in CMDS]


def hold_factory(t, r, v, t_mark):
    """The kernel's way of holding a commanded direction u: idea 35's 'linear' steering in the plane of r and u, pitch
    from u . r_hat, turned down by (v . down)/|r| per second until the next command (or one cycle after the last)."""
    i = max(k for k in range(len(CMDS)) if CMD_T[k] <= t + 1e-9)
    u = np.array(CMDS[i][1:])
    t_next = CMD_T[i + 1] if i + 1 < len(CMDS) else None
    dt = (t_next - t) if t_next is not None else A['cycle_s']
    np_ = unit(np.cross(r, u))
    rh = unit(r)
    down = np.cross(np_, rh)
    p0 = math.asin(max(-1.0, min(1.0, float(np.dot(u, rh)))))
    p1 = p0 - float(np.dot(v, down)) / np.linalg.norm(r) * dt
    tu0, tu1 = t, t + dt

    def direction(tt, rr, vv):
        f = min(1.0, max(0.0, (tt - tu0) / (tu1 - tu0)))
        p = p0 + (p1 - p0) * f
        upP = unit(rr - np_ * np.dot(rr, np_))
        dn = np.cross(np_, upP)
        return math.cos(p) * dn + math.sin(p) * upP
    return direction


def replay():
    tc = A['kernelCutoff_s']
    s, log = fly(tc, hold_factory, CMD_T)
    r, v, m = s[:3], s[3:6], s[6]
    rn, vn = float(np.linalg.norm(r)), float(np.linalg.norm(v))
    return {'t_s': tc, 'r_m': r.tolist(), 'v_m_s': v.tolist(), 'mass_kg': float(m), 'radius_m': rn, 'speed_m_s': vn,
            'flight_path_angle_deg': math.degrees(math.asin(float(np.dot(r, v)) / rn / vn)), 'sII_cutoff_s': T_DEP, 'sIVB_ignition_s': T_IGN,
            'mass_after_sII_cutoff_kg': next(mm for (tt, _, mm) in log if abs(tt - T_DEP) < 1e-9),
            'mass_at_sIVB_ignition_kg': next(mm for (tt, _, mm) in log if abs(tt - T_IGN) < 1e-9),
            'energy_m2_s2': vn * vn / 2 - MU / rn}


# ---- direct optimum
E1 = unit(np.array(A['r0_m']))
E3 = NHAT
E2 = np.cross(E3, E1)


def optimum(K, x_start=None):
    t0 = A['t0_s']

    def steer_of(x):
        th, ps, tb = x[:K], x[K:2 * K], x[2 * K] * 100
        t_end = T_IGN + tb
        nodes = np.linspace(t0, t_end, K)

        def factory(t, r, v, t_mark):
            def direction(tt, rr, vv):
                a = float(np.interp(tt, nodes, th))
                b = float(np.interp(tt, nodes, ps))
                return math.cos(b) * (math.cos(a) * E2 + math.sin(a) * E1) + math.sin(b) * E3
            return direction
        return factory, t_end, nodes

    def end_state(x):
        factory, t_end, nodes = steer_of(x)
        s, _ = fly(t_end, factory, list(nodes))
        return s

    def cons(x):
        s = end_state(x)
        r, v = s[:3], s[3:6]
        rn, vn = np.linalg.norm(r), np.linalg.norm(v)
        return np.array([(rn - TGT['rd_m']) / 1000, float(np.dot(r, v)) / rn / vn - math.sin(TGT['gammaD_rad']), (vn - TGT['vd_m_s']) / 10,
                         float(np.dot(r, NHAT)) / rn * 100, float(np.dot(v, NHAT)) / vn * 100])
    if x_start is None:
        x_start = np.concatenate([np.linspace(math.radians(25), math.radians(-30), K), np.zeros(K), [1.30]])
    r = minimize(lambda x: x[2 * K], x_start, method='SLSQP', constraints=[{'type': 'eq', 'fun': cons}],
                 options={'maxiter': 300, 'ftol': 1e-12, 'eps': 1e-7})
    s = end_state(r.x)
    tb = r.x[2 * K] * 100
    return {'K': K, 'converged': bool(r.success), 'message': r.message, 'iterations': int(r.nit), 'sIVB_burn_s': tb,
            'sIVB_propellant_kg': tb * SIVB['engines'] * SIVB['mdotPerEngine_kg_s'], 'max_constraint': float(np.max(np.abs(cons(r.x)))),
            'final_mass_kg': float(s[6]), 'x': r.x.tolist()}


def refine(x, K_from, K_to):
    """Resample a K_from solution onto K_to nodes (a warm start for the finer grid)."""
    th, ps, tb = x[:K_from], x[K_from:2 * K_from], x[2 * K_from]
    a, b = np.linspace(0, 1, K_from), np.linspace(0, 1, K_to)
    return np.concatenate([np.interp(b, a, th), np.interp(b, a, ps), [tb]])


def main():
    out = {'generated': 'python3 -I ideas/36-closed-loop/oracle/guidance_oracle.py', 'numpy': np.__version__, 'scipy': __import__('scipy').__version__,
           'integrator': 'scipy solve_ivp DOP853, rtol %g, atol %g' % (RTOL, ATOL)}
    t = time.time()
    out['flat'] = {'gentle': flat_case(CASES['flat']['gentle']), 'steep': flat_case(CASES['flat']['steep'], direct=False)}
    write(out)
    print('flat', out['flat'], '%.1f s' % (time.time() - t), flush=True)
    t = time.time()
    out['replay'] = replay()
    write(out)
    print('replay', {k: out['replay'][k] for k in ('radius_m', 'speed_m_s', 'mass_kg', 'sII_cutoff_s')}, '%.1f s' % (time.time() - t), flush=True)
    opt = []
    x = None
    Kprev = None
    for K in (8, 16, 24):
        t = time.time()
        o = optimum(K, refine(np.array(x), Kprev, K) if x is not None else None)
        print('optimum K=%d' % K, {k: o[k] for k in ('converged', 'sIVB_propellant_kg', 'max_constraint', 'iterations')}, '%.1f s' % (time.time() - t), flush=True)
        x, Kprev = o['x'], K
        o.pop('x')
        opt.append(o)
        out['optimum'] = opt
        write(out)


def write(out):
    with open(os.path.join(HERE, 'guidance-oracle.json'), 'w') as f:
        json.dump(out, f, indent=1, default=float)
        f.write('\n')


if __name__ == '__main__':
    sys.exit(main())
