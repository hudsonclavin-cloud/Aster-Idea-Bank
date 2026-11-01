#!/usr/bin/env python3
"""Independent oracle for idea 48 (Catch). Not imported by the page; its output oracle/entry-oracle.json is a test fixture.

Run (a throw-away venv with numpy, scipy, ambiance):
    <venv>/bin/python -I ideas/48-catch/oracle/entry-oracle.py

Shared with the kernel on purpose (oracle/cases.json, written by `build-data.mjs --oracle-cases`): the initial states,
the vehicles, Aster's GM and radius, pck00010's polar radius and rotation, the 1976 atmosphere as the standard defines it,
Sutton & Graves's coefficient. Independent: the equations (Vinh's planet-relative 3-DOF set in spherical coordinates,
not the kernel's inertial Cartesian one), the integrator (scipy DOP853, rtol 1e-10, events for the peaks), the
atmosphere code (the `ambiance` package below 81 km; above it the 1976 layer formula written here from the standard's
71-86 km layer: base 71 km geopotential, 214.65 K, -2 K/km), the corridor and peak searches, and for the Moon a
three-body integration (Earth and Moon on circles about their barycentre) against the kernel's patched conics.
"""
import json, math, os, sys
import numpy as np
from scipy.integrate import solve_ivp
from ambiance import Atmosphere

HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(HERE, 'cases.json')))
K = C['constants']
MU, RE, RC, OM, G0, TOP, KSG = K['mu'], K['re'], K['rc'], K['omega'], K['g0'], K['atm_top_m'], K['k_sg']
R0 = 6356766.0; GMR = 9.80665 * 0.0289644 / 8.31432  # 1976 standard: r0, g0 M0 / R*  (K/m)

_HT = np.arange(-5000.0, 81000.0 + 1e-6, 10.0)          # ambiance tabulated every 10 m once (its scalar calls are slow);
_AT = Atmosphere(_HT); _LR = np.log(_AT.density); _AS = _AT.speed_of_sound   # log-linear between: < 1e-6 relative
def atm(h):
    """density (kg/m^3) and speed of sound (m/s) at geometric altitude h; nothing above the standard's 86 km table top"""
    if h >= TOP: return 0.0, None
    if h <= 81000.0:
        hh = max(h, -5000.0); return float(math.exp(np.interp(hh, _HT, _LR))), float(np.interp(hh, _HT, _AS))
    H = R0 * h / (R0 + h)                        # geopotential
    Hb, Tb, L = 71000.0, 214.65, -0.002
    a71 = Atmosphere(R0 * Hb / (R0 - Hb))        # base pressure from ambiance at the layer base
    pb = float(a71.pressure[0])
    T = Tb + L * (H - Hb)
    p = pb * (Tb / T) ** (GMR / L)
    rho = p / (287.05287 * T)
    return rho, math.sqrt(1.4 * 287.05287 * T)

def cd_of(veh, M):
    c = veh['cd']
    if isinstance(c, (int, float)): return float(c)
    return float(np.interp(M if M is not None else 1e9, c['mach'], c['value']))

def surf(phi):  # spheroid radius at geocentric latitude phi
    return RA * RC / math.sqrt((RC * math.cos(phi)) ** 2 + (RA * math.sin(phi)) ** 2)
RA = RE

def to_rel(r, v):
    """inertial Cartesian -> (r, lon, lat, V, gamma, psi) planet-relative; psi from east toward north"""
    r = np.array(r, float); v = np.array(v, float)
    w = np.array([-OM * r[1], OM * r[0], 0.0]); vr = v - w
    rn = np.linalg.norm(r); lat = math.asin(r[2] / rn); lon = math.atan2(r[1], r[0])
    up = r / rn; east = np.array([-math.sin(lon), math.cos(lon), 0.0]); north = np.cross(up, east)
    V = np.linalg.norm(vr); g = math.asin(np.dot(vr, up) / V); psi = math.atan2(np.dot(vr, north), np.dot(vr, east))
    return [rn, lon, lat, V, g, psi]

def rhs_factory(veh, sigma):
    m, A, cl = veh['mass_kg'], veh['area_m2'], veh['cl'] or 0.0
    cs, sn = math.cos(sigma), math.sin(sigma)
    def f(t, y):
        r, th, ph, V, g, ps = y
        h = r - surf(ph); rho, a = atm(h)
        M = V / a if a else None
        qd = 0.5 * rho * V * V
        D = qd * cd_of(veh, M) * A / m; L = qd * cl * A / m
        gr = MU / (r * r)
        cg, sg, cp, sp, cps, sps = math.cos(g), math.sin(g), math.cos(ph), math.sin(ph), math.cos(ps), math.sin(ps)
        dr = V * sg
        dth = V * cg * cps / (r * cp)
        dph = V * cg * sps / r
        dV = -D - gr * sg + OM * OM * r * cp * (sg * cp - cg * sp * sps)
        dg = (L * cs - gr * cg + V * V * cg / r + 2 * OM * V * cp * cps + OM * OM * r * cp * (cg * cp + sg * sp * sps)) / V
        dps = (L * sn / cg - V * V * cg * cps * math.tan(ph) / r + 2 * OM * V * (math.tan(g) * cp * sps - sp) - OM * OM * r * sp * cp * cps / cg) / V
        return [dr, dth, dph, dV, dg, dps]
    return f

def loads(veh, y):
    r, th, ph, V, g, ps = y
    rho, a = atm(r - surf(ph))
    M = V / a if a else None
    qd = 0.5 * rho * V * V
    D = qd * cd_of(veh, M) * veh['area_m2'] / veh['mass_kg']; L = qd * (veh['cl'] or 0.0) * veh['area_m2'] / veh['mass_kg']
    return math.hypot(D, L) / G0, KSG * math.sqrt(rho / veh['rn_m']) * V ** 3

def fly(case, y0, sigma_vinh, t_end=3000.0, v_stop=1500.0, need_loads=True):
    veh = case['vehicle']; f = rhs_factory(veh, sigma_vinh)
    def ev_exit(t, y): return (y[0] - surf(y[2])) - (TOP + 200.0)
    ev_exit.terminal = True; ev_exit.direction = 1
    def ev_slow(t, y): return y[3] - v_stop
    ev_slow.terminal = True; ev_slow.direction = -1
    def ev_ground(t, y): return y[0] - surf(y[2])
    ev_ground.terminal = True; ev_ground.direction = -1
    sol = solve_ivp(f, (0, t_end), y0, method='DOP853', rtol=1e-10, atol=1e-6, events=[ev_exit, ev_slow, ev_ground], dense_output=True, max_step=2.0)
    out = {'end': 'exit' if len(sol.t_events[0]) else ('slow' if len(sol.t_events[1]) else ('ground' if len(sol.t_events[2]) else 'time'))}
    if need_loads:
        ts = np.linspace(sol.t[0], sol.t[-1], int((sol.t[-1] - sol.t[0]) / 0.01) + 2)
        Y = sol.sol(ts)
        LQ = [loads(veh, Y[:, i]) for i in range(len(ts))]
        G = np.array([x[0] for x in LQ]); Q = np.array([x[1] for x in LQ])
        def refine(idx, k):   # golden section on the dense solution around the sampled maximum
            a, b = ts[max(0, idx - 1)], ts[min(len(ts) - 1, idx + 1)]
            for _ in range(40):
                m1, m2 = a + 0.382 * (b - a), a + 0.618 * (b - a)
                if loads(veh, sol.sol(m1))[k] > loads(veh, sol.sol(m2))[k]: b = m2
                else: a = m1
            t = (a + b) / 2; return t, loads(veh, sol.sol(t))[k]
        tg, pg = refine(int(np.argmax(G)), 0); tq, pq = refine(int(np.argmax(Q)), 1)
        out.update({'peak_g': pg, 't_peak_g': tg, 'peak_q_W_m2': pq, 't_peak_q': tq, 'heat_J_m2': float(np.trapezoid(Q, ts))})
    if out['end'] == 'exit':
        # back to inertial, then the two-body apoapsis
        r, th, ph, V, g, ps = sol.y[:, -1]
        up = np.array([math.cos(ph) * math.cos(th), math.cos(ph) * math.sin(th), math.sin(ph)])
        east = np.array([-math.sin(th), math.cos(th), 0.0]); north = np.cross(up, east)
        vr = V * (math.cos(g) * (math.cos(ps) * east + math.sin(ps) * north) + math.sin(g) * up)
        R = r * up; vi = vr + np.array([-OM * R[1], OM * R[0], 0.0])
        en = vi @ vi / 2 - MU / r
        if en < 0:
            a = -MU / (2 * en); h = np.cross(R, vi); e = math.sqrt(max(0, 1 - (h @ h) / (MU * a)))
            out['apo_alt'] = a * (1 + e) - RE
        else: out['apo_alt'] = float('inf')
    return out, sol

def time_at(sol, t):
    y = sol.sol(t); r, th, ph, V, g, ps = y
    rho, a = atm(r - surf(ph)); return {'alt': float(r - surf(ph)), 'mach': float(V / a) if a else None}

def hyperbola_entry(vinfVec, hHat, gdeg, rEI):
    vinfVec = np.array(vinfVec); hHat = np.array(hHat)
    vinf = np.linalg.norm(vinfVec); S = vinfVec / vinf; S = S - (S @ hHat) * hHat; S /= np.linalg.norm(S)
    vE = math.sqrt(vinf ** 2 + 2 * MU / rEI); g = math.radians(gdeg); h = rEI * vE * math.cos(g)
    e = math.sqrt(1 + vinf ** 2 * h ** 2 / MU ** 2); p = h * h / MU
    # perifocal: the incoming asymptote direction is (1/e) P + sqrt(e^2-1)/e Q, Q = hHat x P
    w = np.cross(hHat, S); P = S / e - w * math.sqrt(e * e - 1) / e; Q = np.cross(hHat, P)
    nu = -math.acos(min(1.0, (p / rEI - 1) / e)); k = math.sqrt(MU / p)
    return rEI * (math.cos(nu) * P + math.sin(nu) * Q), k * (-math.sin(nu) * P + (e + math.cos(nu)) * Q)

def coast_in(r, v, rT):
    """two-body coast to radius rT inbound, by integrating (independent of the kernel's anomaly formulas)"""
    def f(t, y): rr = np.linalg.norm(y[:3]); return np.concatenate([y[3:], -MU * y[:3] / rr ** 3])
    def ev(t, y): return np.linalg.norm(y[:3]) - rT
    ev.terminal = True; ev.direction = -1
    s = solve_ivp(f, (0, 1e5), np.concatenate([r, v]), method='DOP853', rtol=1e-12, atol=1e-6, events=ev)
    return s.y[:3, -1], s.y[3:, -1], s.t[-1]

out = {'tool': 'oracle/entry-oracle.py', 'scipy': __import__('scipy').__version__, 'numpy': np.__version__, 'cases': {}}
for case in C['cases']:
    if case['kind'] == 'peak':
        rT = None
        r, v = np.array(case['r']), np.array(case['v'])
        # coast to the atmosphere's top first (no air above it, in both models)
        rr = np.linalg.norm(r); lat = math.asin(r[2] / rr)
        r1, v1, t1 = coast_in(r, v, surf(lat) + TOP + 2000.0) if rr - surf(lat) > TOP + 2000.0 else (r, v, 0.0)
        res, sol = fly(case, to_rel(r1, v1), -math.radians(case['bank_deg']), v_stop=300.0 if case['id'] != 'chain_direct' else 1500.0)
        res['t_peak_g'] += t1; res['t_peak_q'] += t1
        if case['id'] == 'stardust':
            res['at_137_9'] = time_at(sol, 137.9 - t1)
        out['cases'][case['id']] = res
        print(case['id'], {k: res[k] for k in ('peak_g', 'peak_q_W_m2', 't_peak_g', 't_peak_q', 'heat_J_m2', 'end')}, res.get('at_137_9'), flush=True)
    else:
        # aerocapture: the oracle's own entry angle for the target apoapsis at this bank, by bisection
        def apo(gdeg):
            r, v = hyperbola_entry(case['vinfVec'], case['hHat'], gdeg, case['rEI'])
            rr = np.linalg.norm(r); lat = math.asin(r[2] / rr)
            r1, v1, t1 = coast_in(r, v, surf(lat) + TOP + 2000.0)
            res, _ = fly(case, to_rel(r1, v1), -math.radians(case['bank_deg']), need_loads=False)
            return res.get('apo_alt', -float('inf')), res
        g0 = case['gamma_deg']; lo, hi = g0 + 0.02, g0 - 0.02   # lo: shallower (apo above target)
        for _ in range(24):
            m = (lo + hi) / 2
            if apo(m)[0] > case['apo_target_m']: lo = m
            else: hi = m
        gam = (lo + hi) / 2; a_k, _ = apo(g0)
        r, v = hyperbola_entry(case['vinfVec'], case['hHat'], g0, case['rEI']); rr = np.linalg.norm(r)
        r1, v1, t1 = coast_in(r, v, surf(math.asin(r[2] / rr)) + TOP + 2000.0)
        res_k, _ = fly(case, to_rel(r1, v1), -math.radians(case['bank_deg']))
        out['cases'][case['id']] = {'gamma_oracle_deg': gam, 'gamma_kernel_deg': g0, 'apo_at_kernel_gamma_m': a_k, 'peak_g_at_kernel_gamma': res_k['peak_g'], 'peak_q_at_kernel_gamma': res_k['peak_q_W_m2']}
        print(case['id'], out['cases'][case['id']], flush=True)

# ------------------------------------------------------------------ the Moon: three-body flyby against patched conics
MUM, MUEM, AM, RM = K['mu_moon'], K['mu_em'], K['moon_a_m'], K['moon_r_m']
MUE = MUEM - MUM   # the Earth's own GM as DE440 splits the system (the kernel uses Aster's Earth GM for geocentric energy)
n = math.sqrt(MUEM / AM ** 3)
def bodies(t):
    ang = n * t; u = np.array([math.cos(ang), math.sin(ang), 0.0])
    rE = -(MUM / MUEM) * AM * u; rMo = (MUE / MUEM) * AM * u
    vt = np.array([-math.sin(ang), math.cos(ang), 0.0]) * n * AM
    return rE, rMo, -(MUM / MUEM) * vt, (MUE / MUEM) * vt
def f3(t, y):
    rE, rMo, _, _ = bodies(t); r = y[:3]
    dE = r - rE; dM = r - rMo
    return np.concatenate([y[3:], -MUE * dE / np.linalg.norm(dE) ** 3 - MUM * dM / np.linalg.norm(dM) ** 3])
def geo_c3(t, y):
    rE, _, vE, _ = bodies(t); d = y[:3] - rE; dv = y[3:] - vE
    return dv @ dv - 2 * MUE / np.linalg.norm(d)
def c3s(w, alpha, sgn, rp, T=5 * 86400.0):
    """from a Moon periapsis (radius rp, Moon-relative excess speed w, direction alpha in the Moon's plane, sense sgn):
    the geocentric C3 five days before and after, by integrating the three-body problem both ways"""
    _, rMo, _, vMo = bodies(0.0)
    vp = math.sqrt(w * w + 2 * MUM / rp)
    y0 = np.concatenate([rMo + rp * np.array([math.cos(alpha), math.sin(alpha), 0.0]), vMo + sgn * vp * np.array([-math.sin(alpha), math.cos(alpha), 0.0])])
    fw = solve_ivp(f3, (0, T), y0, method='DOP853', rtol=1e-9, atol=1e-2)
    bw = solve_ivp(f3, (0, -T), y0, method='DOP853', rtol=1e-9, atol=1e-2)
    return geo_c3(-T, bw.y[:, -1]), geo_c3(T, fw.y[:, -1])
def flyby3(vinf, rp):
    """the lowest geocentric C3 after one flyby for an arrival at vinf, searched in the three-body problem: for each
    periapsis direction and sense, the Moon-relative speed is solved so the C3 five days before is vinf^2"""
    target = vinf * vinf
    def solve_w(alpha, sgn):
        w0, w1 = 1000.0, 3000.0
        f0 = c3s(w0, alpha, sgn, rp)[0] - target; f1 = c3s(w1, alpha, sgn, rp)[0] - target
        for _ in range(8):
            if f1 == f0: break
            w2 = max(50.0, w1 - f1 * (w1 - w0) / (f1 - f0)); w0, f0 = w1, f1; w1 = w2; f1 = c3s(w1, alpha, sgn, rp)[0] - target
            if abs(f1) < 1e3: break
        return w1, abs(f1) < 1e4
    best = None
    for sgn in (1.0, -1.0):
        for alpha in np.linspace(0, 2 * math.pi, 25)[:-1]:
            w, ok = solve_w(alpha, sgn)
            if not ok: continue
            after = c3s(w, alpha, sgn, rp)[1]
            if best is None or after < best[0]: best = (after, alpha, sgn, w)
    a, b = best[1] - math.radians(15), best[1] + math.radians(15)
    for _ in range(12):   # golden-section refinement in alpha
        m1, m2 = a + (b - a) * 0.382, a + (b - a) * 0.618
        f = lambda al: c3s(solve_w(al, best[2])[0], al, best[2], rp)[1]
        if f(m1) < f(m2): b = m2
        else: a = m1
    al = (a + b) / 2; w = solve_w(al, best[2])[0]; before, after = c3s(w, al, best[2], rp)
    return {'vinf': vinf, 'c3_before_3body': before, 'c3_after_3body': after, 'w': w}
L = []
for vi in C['lunar']['vinf_m_s']:
    r = flyby3(vi, RM); L.append(r)
    print('lunar', {k: (round(v / 1e6, 4) if 'c3' in k else round(v, 2)) for k, v in r.items()}, flush=True)
# the three-body capture threshold: the largest vinf one flyby brings to C3 <= 0 (bisection around the patched value)
lo, hi = 0.8 * C['lunar']['threshold_vinf_m_s'], 1.2 * C['lunar']['threshold_vinf_m_s']
for _ in range(7):
    m = (lo + hi) / 2
    if flyby3(m, RM)['c3_after_3body'] <= 0: lo = m
    else: hi = m
out['lunar'] = L; out['lunar_threshold_3body_m_s'] = (lo + hi) / 2
print('lunar threshold (three-body)', (lo + hi) / 2, 'patched', C['lunar']['threshold_vinf_m_s'])
def clean(x):   # strict JSON: non-finite numbers become null, numpy scalars plain floats
    if isinstance(x, dict): return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list): return [clean(v) for v in x]
    if isinstance(x, (float, np.floating)): return float(x) if math.isfinite(x) else None
    return x
json.dump(clean(out), open(os.path.join(HERE, 'entry-oracle.json'), 'w'), indent=1, allow_nan=False)
print('wrote oracle/entry-oracle.json')
