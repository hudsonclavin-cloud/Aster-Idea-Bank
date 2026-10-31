#!/usr/bin/env python3
"""Independent oracle for idea 35 (Max Q): re-flies oracle/cases.json and writes oracle/ascent-oracle.json.

Not shipped and not imported by the page. Independent of ascent.js in every place it can be:
  * equations of motion in the ROTATING Earth-fixed frame (Coriolis and centrifugal terms explicit), where ascent.js
    integrates in an inertial frame; states converted to inertial only for output;
  * scipy's DOP853 (adaptive 8th order, rtol 1e-11) where ascent.js uses fixed-step RK4;
  * the 1976 standard atmosphere from the `ambiance` package (its own layer table), where ascent.js uses PartForge's
    isa(); above ambiance's top (80 km geopotential) its last layer is continued to 86 km geometric with ambiance's
    own constants, as the 1976 standard does;
  * its own mass bookkeeping from idea 34's handoff (shed, jettisons, engine cutoffs, separations, coasts);
  * max Q and Mach 1 from DOP853's dense output on a 1 ms grid.
Shared with ascent.js, by design: the constants (snapshots/earth.js, which is Aster's), the drag table
(snapshots/saturn-v-axial-force.js), the engines and masses (idea 34's handoffs in snapshots/data-json.js) and the steering laws as stated in
words in README.md.

  python3 -I ascent_oracle.py     (with numpy, scipy and ambiance; a throw-away venv)
"""
import json, math, os, re, sys
import numpy as np
from scipy.integrate import solve_ivp
from ambiance import Atmosphere
from ambiance.ambiance import CONST as AMB

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
P0 = 101325.0
_ISA = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'snapshots', 'isa.js')).read()
_R0, _HMAX = (float(re.search(k + r' = ([\d.]+);', _ISA).group(1)) for k in ('ISA_R0', 'ISA_H_MAX'))
ATM_TOP = _R0 * _HMAX / (_R0 - _HMAX)  # the top of the page's isa() table, geometric (shared on purpose: the cut-off is a model choice)


def load_js_object(path):
    txt = open(path).read()
    return json.loads(re.search(r'var D = (\{[\s\S]*?\});\n  if', txt).group(1))


def load_aero(path):
    txt = open(path).read()
    out = {}
    for key in ('forebody', 'total'):
        blk = re.search(key + r':\s*\{([\s\S]*?)\}', txt).group(1)
        arr = lambda k: np.array([float(v) for v in re.search(k + r':\s*\[([^\]]*)\]', blk).group(1).split(',')])
        out[key] = (arr('mach'), arr('ca'))
    out['D'] = float(re.search(r'referenceDiameterFt:\s*([\d.]+)', txt).group(1)) * 0.3048
    return out


EARTH = load_js_object(os.path.join(ROOT, 'snapshots', 'earth.js'))
DATA = json.loads(re.search(r'/\*JSON\*/([\s\S]*)/\*END\*/', open(os.path.join(ROOT, 'snapshots', 'data-json.js')).read()).group(1))
AERO = load_aero(os.path.join(ROOT, 'snapshots', 'saturn-v-axial-force.js'))
MU, RE, OMEGA = EARTH['mu_m3_s2'], EARTH['radius_m'], EARTH['omega_rad_s']

# The 1976 standard atmosphere as the `ambiance` package defines it: its layer table (geopotential base height, base
# temperature, lapse rate, base pressure) and constants, evaluated here directly because constructing an
# ambiance.Atmosphere per call is far too slow for an integrator; checked against ambiance.Atmosphere below. Above
# ambiance's top layer base (80 km geopotential) the same layer is continued to 86 km geometric, as the 1976 standard does.
_LAY = [row[:4] for row in AMB.LAYER_SPEC_PROP if row[0] >= 0]
_G0, _R, _KAPPA, _RE0 = AMB.g_0, AMB.R, AMB.kappa, AMB.r


def atmosphere(h):
    """(P, rho, a) at geometric height h, m; zero density and pressure from 86 km up."""
    if h >= ATM_TOP:
        return 0.0, 0.0, None
    h = max(h, 0.0)
    H = _RE0 * h / (_RE0 + h)
    i = len(_LAY) - 1
    while i > 0 and H < _LAY[i][0]:
        i -= 1
    Hb, Tb, L, Pb = _LAY[i]
    T = Tb + L * (H - Hb)
    P = Pb * math.exp(-_G0 * (H - Hb) / (_R * Tb)) if L == 0 else Pb * (Tb / T) ** (_G0 / (_R * L))
    return P, P / (_R * T), math.sqrt(_KAPPA * _R * T)


_hs = np.linspace(0, 81000, 163)
_amb = Atmosphere(_hs)
for _k, _h in enumerate(_hs):
    _P, _rho, _a = atmosphere(_h)
    assert abs(_P / _amb.pressure[_k] - 1) < 1e-9 and abs(_rho / _amb.density[_k] - 1) < 1e-9 and abs(_a / _amb.speed_of_sound[_k] - 1) < 1e-9, _h


def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def rotz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


W = None  # omega vector of the current case


def fly(case):
    global W
    h34 = DATA[case['data']]
    veh, engines, plan = h34['inputs']['vehicle'], h34['inputs']['engines'], case['plan']
    omega = OMEGA if plan.get('rotation', True) is not False else 0.0
    W = np.array([0.0, 0.0, omega])
    lat, az = math.radians(plan['site']['latitudeDeg']), math.radians(plan['azimuthDeg'])
    r0 = np.array([RE * math.cos(lat), 0.0, RE * math.sin(lat)])
    up0 = unit(r0); east0 = unit(np.array([-up0[1], up0[0], 0.0])); north0 = np.cross(up0, east0)
    n0 = unit(np.cross(r0, math.cos(az) * north0 + math.sin(az) * east0))  # launch plane normal, inertial, fixed
    S = math.pi * plan['diameter'] ** 2 / 4
    curve = AERO['total'] if plan['drag'] == 'total' else AERO['forebody']
    drag_on = plan['drag'] != 'none' and plan['dragScale'] > 0
    # flown burns: up to the first burn followed by a restart of the same stage
    flown = []
    for si, s in enumerate(veh['stages']):
        stop = False
        for bi in range(len(s['burns'])):
            flown.append((si, bi))
            if bi < len(s['burns']) - 1:
                stop = True; break
        if stop:
            break
    liftoff = sum(s['dry'] + s['remaining'] + sum(b['propellant'] + b.get('shed', 0) + b.get('coast', 0) + sum(j['mass'] for j in b.get('jettisons', [])) for b in s['burns']) for s in veh['stages']) + veh['payload']['mass']
    y = np.concatenate([r0, np.zeros(3), [liftoff], np.zeros(6)])  # rotating frame: r, v_rel, m, budget
    t = 0.0
    hist = []  # (t, q, h, M) on a fine grid, first stage

    def make_fun(ctx):
        def fun(tt, yy):
            r, v, m = yy[0:3], yy[3:6], yy[6]
            rn = np.linalg.norm(r); h = rn - RE
            P, rho, a = atmosphere(h)
            g = -MU / rn ** 3 * r
            n = rotz(-omega * tt) @ n0  # the inertial plane seen from the rotating frame
            upP = unit(r - np.dot(r, n) * n); down = np.cross(n, upP)
            mode = ctx['mode']
            if ctx['engines'] == 0 or mode == 'vertical':
                u = unit(r)
            elif mode == 'kick':
                th = ctx['kick'] * min(1.0, max(0.0, (tt - ctx['tp']) / ctx['tk']))
                u = math.cos(th) * upP + math.sin(th) * down
            elif mode in ('pitch', 'linear'):
                p = ctx['p0'] if mode == 'pitch' else ctx['p0'] + (ctx['p1'] - ctx['p0']) * min(1.0, max(0.0, (tt - ctx['tu0']) / (ctx['tu1'] - ctx['tu0'])))
                u = math.cos(p) * down + math.sin(p) * upP
            else:
                vp = v - np.dot(v, n) * n
                u = unit(vp) if np.linalg.norm(vp) > 1e-6 else upP
            Fv = ctx['Fvac'] if ctx['engines'] else 0.0
            Fp = P * ctx['Ae'] if ctx['engines'] else 0.0
            F = Fv - Fp
            vr = np.linalg.norm(v)
            Dm = 0.0
            if drag_on and rho > 0 and vr > 0:
                M = vr / a
                Dm = 0.5 * rho * vr * vr * S * float(np.interp(M, curve[0], curve[1])) * plan['dragScale'] / m
            vrh = v / vr if vr > 1e-9 else u
            cent = -np.cross(W, np.cross(W, r))
            acc = g + (F / m) * u - Dm * vrh - 2 * np.cross(W, v) + cent
            return np.concatenate([v, acc, [-ctx['mdot']], [Fv / m, Fp / m, Dm, -np.dot(g, vrh), (F / m) * (1 - np.dot(u, vrh)), np.dot(vrh, cent)]])
        return fun

    def advance(t, y, t1, ctx, event=None, first_stage=False):
        if t1 <= t + 1e-12:
            return t, y, False
        fun = make_fun(ctx)
        ev = None
        if event is not None:
            ev = lambda tt, yy: event(tt, yy)
            ev.terminal = True; ev.direction = 1
        sol = solve_ivp(fun, (t, t1), y, method='DOP853', rtol=1e-11, atol=np.concatenate([[1e-4] * 3, [1e-7] * 3, [1e-6], [1e-7] * 6]), dense_output=True, events=ev)
        if first_stage:
            ts = np.arange(math.ceil(t * 1000) / 1000, sol.t[-1], 0.001)
            if len(ts):
                Y = sol.sol(ts)
                for k in range(len(ts)):
                    r, v = Y[0:3, k], Y[3:6, k]; h = np.linalg.norm(r) - RE
                    P, rho, a = atmosphere(h)
                    vr = np.linalg.norm(v)
                    hist.append((ts[k], 0.5 * rho * vr * vr, h, vr / a if a else None))
        hit = ev is not None and len(sol.t_events[0]) > 0
        return sol.t[-1], sol.y[:, -1].copy(), hit

    cutoffs = []
    cur = -1; carried = 0.0; kick_done = False; kick_end = None; tu0 = tu1 = None
    for (si, bi) in flown:
        s = veh['stages'][si]; b = s['burns'][bi]; e = engines[s['engine']]
        if si != cur:
            if cur >= 0:
                sp = veh['stages'][cur]
                y[6] -= sp['dry'] + sp['remaining'] + carried; carried = 0.0
                c = plan['stagingCoast'][si - 1]
                if c > 0:
                    t, y, _ = advance(t, y, t + c, {'engines': 0, 'mdot': 0.0, 'Fvac': 0.0, 'Ae': 0.0, 'mode': 'gravity'})
            cur = si
        y[6] -= b.get('shed', 0)
        k = plan['flowScale'][si]
        dk = e['deck_vacuum']; ch1 = dk['mass_flow_chamber'][dk['throttle'].index(1)]
        thr = plan.get('throttle') if si == 0 else None
        bps = [(j['t'], 'jettison', j) for j in b.get('jettisons', [])] + [(o['t'], 'out', o) for o in b.get('engineOut', [])]
        if thr:
            bps += [(thr['start'], 'thr', None), (thr['end'], 'thr', None)]
        if si == 0:
            bps += [(plan['pitchStart'], 'steer', None), (plan['pitchStart'] + plan['kickDuration'], 'steer', None)]
        bps.sort(key=lambda x: x[0])
        tB0 = t; n = s['count']; left = b['propellant']; done = set()
        if si > 0 and tu0 is None:
            tu0 = t
            T = 0.0
            for (sj, bj) in flown:
                if sj > 0 and (plan['upper'].get('over') != 'first' or sj == 1):
                    # an upper burn's duration at constant flow: propellant / (engine flow at 100 %), cutoffs counted
                    bb = veh['stages'][sj]['burns'][bj]; ee = engines[veh['stages'][sj]['engine']]
                    rate = veh['stages'][sj]['count'] * ee['mass_flow_kg_s'] * plan['flowScale'][sj]; P = bb['propellant']; tt0 = 0.0; nn = veh['stages'][sj]['count']
                    for o in sorted(bb.get('engineOut', []), key=lambda x: x['t']):
                        dP = nn * ee['mass_flow_kg_s'] * plan['flowScale'][sj] * (o['t'] - tt0)
                        if dP >= P: break
                        P -= dP; tt0 = o['t']; nn -= o['count']
                    T += tt0 + P / (nn * ee['mass_flow_kg_s'] * plan['flowScale'][sj])
                    if bj == 0 and sj > 1: T += plan['stagingCoast'][sj - 1]
            tu1 = tu0 + T
        def apply_bp(q):
            nonlocal n
            bt, kind, obj = bps[q]
            done.add(q)
            if kind == 'jettison':
                y[6] -= obj['mass']
            elif kind == 'out':
                n -= obj['count']
            return kind, bt

        while left > 1e-9 * b['propellant']:
            tc = t - tB0
            for q in range(len(bps)):  # every event due now, two at one instant included
                if q not in done and bps[q][0] <= tc + 1e-9:
                    kind, bt = apply_bp(q)
                    if kind == 'steer' and plan['kickDeg'] == 0 and abs(bt - plan['pitchStart']) < 1e-9:
                        kick_done = True
            tau = thr['level'] if (thr and thr['start'] - 1e-9 <= tc < thr['end'] - 1e-9) else 1.0
            Fvac = float(np.interp(tau, dk['throttle'], dk['thrust_vac'])) * k
            mdot = e['mass_flow_kg_s'] * float(np.interp(tau, dk['throttle'], dk['mass_flow_chamber'])) / ch1 * k
            if si == 0:
                mode = 'vertical' if tc < plan['pitchStart'] - 1e-9 else ('gravity' if kick_done else 'kick')
            else:
                um = plan['upper']['mode']; mode = 'pitch' if um == 'hold' else um
            ctx = {'engines': n, 'Fvac': n * Fvac, 'mdot': n * mdot, 'Ae': n * e['exit_area_m2'], 'mode': mode, 'tp': plan['pitchStart'], 'tk': plan['kickDuration'],
                   'kick': math.radians(plan['kickDeg']), 'p0': math.radians(plan['upper'].get('startDeg', 0)), 'p1': math.radians(plan['upper'].get('endDeg', 0)), 'tu0': tu0, 'tu1': tu1}
            nxt = next(((bt, kind, obj, q) for q, (bt, kind, obj) in enumerate(bps) if q not in done and bt > tc + 1e-9), None)
            tout = left / (n * mdot)
            is_bp = nxt is not None and nxt[0] < tc + tout - 1e-9
            t_end = tB0 + (nxt[0] if is_bp else tc + tout)
            event = None
            if mode == 'kick':
                t_ramp = tB0 + plan['pitchStart'] + plan['kickDuration']
                def event(tt, yy, t_ramp=t_ramp):
                    if tt < t_ramp - 1e-9:
                        return -1.0
                    r, v = yy[0:3], yy[3:6]
                    nn_ = rotz(-omega * tt) @ n0
                    upP = unit(r - np.dot(r, nn_) * nn_); down = np.cross(nn_, upP)
                    vp = v - np.dot(v, nn_) * nn_
                    return math.atan2(np.dot(vp, down), np.dot(vp, upP)) - math.radians(plan['kickDeg'])
            m_before = y[6]
            t, y, hit = advance(t, y, t_end, ctx, event, first_stage=(si == 0))
            left -= m_before - y[6]
            if hit:
                kick_done = True; kick_end = t
                continue
            if is_bp:
                kind, bt = apply_bp(nxt[3])
                if kind == 'steer' and plan['kickDeg'] == 0 and abs(bt - plan['pitchStart']) < 1e-9:
                    kick_done = True
            else:
                left = 0.0
        for q, (bt, kind, obj) in enumerate(bps):
            if q not in done and kind == 'jettison':
                carried += obj['mass']
        cutoffs.append(state_out(t, y, omega) | {'stage': s['label'], 'burn': bi + 1})
    # events in the first stage
    H = np.array([x[0] for x in hist]); Q = np.array([x[1] for x in hist])
    i = int(np.argmax(Q))
    mach = [(x[0], x[3]) for x in hist if x[3] is not None]
    m1 = None
    for j in range(1, len(mach)):
        if mach[j - 1][1] < 1 <= mach[j][1]:
            f = (1 - mach[j - 1][1]) / (mach[j][1] - mach[j - 1][1]); m1 = mach[j - 1][0] + f * (mach[j][0] - mach[j - 1][0]); break
    fin = cutoffs[-1]
    return {'name': case['name'], 'mach1_t': m1, 'maxq_t': float(H[i]), 'maxq_q': float(Q[i]), 'maxq_h': float(hist[i][2]), 'kick_end_t': kick_end,
            'cutoffs': cutoffs, 'final': fin, 'orbit': orbit(np.array(fin['r_inertial']), np.array(fin['v_inertial'])),
            'losses_rel': {'ideal': float(y[7]), 'pressure': float(y[8]), 'drag': float(y[9]), 'gravity': float(y[10]), 'steering': float(y[11]), 'centrifugal': float(y[12])}}


def state_out(t, y, omega):
    R = rotz(omega * t)
    r = y[0:3]; vrel = y[3:6]
    ri = R @ r; vi = R @ (vrel + np.cross(np.array([0, 0, omega]), r))
    up = unit(ri)
    return {'t': float(t), 'altitude': float(np.linalg.norm(r) - RE), 'speed_inertial': float(np.linalg.norm(vi)), 'speed_rel': float(np.linalg.norm(vrel)),
            'fpa_deg': float(math.degrees(math.asin(np.dot(vi, up) / np.linalg.norm(vi)))), 'mass': float(y[6]), 'r_inertial': ri.tolist(), 'v_inertial': vi.tolist()}


def orbit(r, v):
    rn, vn = np.linalg.norm(r), np.linalg.norm(v)
    h = np.cross(r, v); E = vn * vn / 2 - MU / rn
    e = np.linalg.norm(np.cross(v, h) / MU - r / rn)
    out = {'e': float(e), 'inclination_deg': float(math.degrees(math.acos(h[2] / np.linalg.norm(h)))), 'energy': float(E)}
    if E < 0:
        a = -MU / (2 * E); out.update({'perigee_alt': float(a * (1 - e) - RE), 'apogee_alt': float(a * (1 + e) - RE)})
    return out


def main():
    cases = json.load(open(os.path.join(HERE, 'cases.json')))['cases']
    out = {'note': 'Generated by oracle/ascent_oracle.py from oracle/cases.json (scipy DOP853 in the rotating frame, ambiance 1976 atmosphere).',
           'versions': {'numpy': np.__version__, 'scipy': __import__('scipy').__version__, 'ambiance': getattr(__import__('ambiance'), '__version__', 'unknown')}, 'results': []}
    for c in cases:
        r = fly(c)
        print(c['name'], 'maxQ', round(r['maxq_t'], 3), round(r['maxq_q'], 1), 'mach1', r['mach1_t'] and round(r['mach1_t'], 3), 'final', round(r['final']['altitude'] / 1000, 3), round(r['final']['speed_inertial'], 3), round(r['final']['fpa_deg'], 4))
        out['results'].append(r)
    json.dump(out, open(os.path.join(HERE, 'ascent-oracle.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
