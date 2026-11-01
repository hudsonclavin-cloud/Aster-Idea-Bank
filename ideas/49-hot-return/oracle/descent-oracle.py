#!/usr/bin/env python3
"""Independent oracle for idea 49 (Hot Return). Not imported by the page; its output oracle/descent-oracle.json is a test
fixture.

Run (a throw-away venv with numpy, scipy, ambiance):
    <venv>/bin/python -I ideas/49-hot-return/oracle/descent-oracle.py

Shared with the kernel on purpose (oracle/cases.json, written by `build-data.mjs --oracle-cases`): the state at the
G-switch, the masses, drag areas and switch settings, the capsules' C_A tables, Aster's GM and radius, pck00010's polar
radius and rotation, the Sutton & Graves and Suttles coefficients, B', the emissivity line, and the hypersonic flight's
time, altitude and air-relative speed every second.

Independent: the equations of the descent (Cartesian in the frame turning with the Earth, Coriolis and centrifugal terms
written out, where the kernel flies inertial Cartesian with the air turning), the integrator (scipy DOP853 at rtol 1e-10
with terminal events, where the kernel takes fixed 0.1 s RK4 steps and interpolates events), the atmosphere (the
`ambiance` package below 81 km and the 1976 standard's 71-86 km layer written here, where the kernel calls PartForge's
isa() through idea 48), the canopy filling (integrated as one continuous ramp, where the kernel flies 0.05 s pieces of
constant drag area), the heating (re-evaluated from the oracle's own density and temperature and integrated with
Simpson's rule per pass, where the kernel takes trapezoids at 0.1 s), and the wall temperature (scipy brentq).
"""
import json, math, os
import numpy as np
from scipy.integrate import solve_ivp, simpson
from scipy.optimize import brentq
from ambiance import Atmosphere

HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(HERE, 'cases.json')))
K = C['constants']
MU, RE, RC, OM, G0, TOP, KSG = K['mu'], K['re'], K['rc'], K['omega'], K['g0'], K['atm_top_m'], K['k_sg']
SIG, A, BP, GAM = K['sigma'], K['suttles'], K['b_prime'], K['gamma']
R0 = 6356766.0; RAIR = 287.05287; GMR = 9.80665 * 0.0289644 / 8.31432    # 1976 standard: r0, R_air, g0 M0 / R*

_HT = np.arange(-2000.0, 81000.0 + 1e-6, 5.0)       # ambiance tabulated every 5 m once; log-linear between
_AT = Atmosphere(_HT)
_LR, _LP, _AS, _TT = np.log(_AT.density), np.log(_AT.pressure), _AT.speed_of_sound, _AT.temperature
def atm(h):
    """density, pressure, speed of sound, temperature at geometric altitude h (m); nothing above the 86 km table top"""
    if h >= TOP: return 0.0, 0.0, None, None
    if h <= 81000.0:
        hh = max(h, -2000.0)
        return (float(math.exp(np.interp(hh, _HT, _LR))), float(math.exp(np.interp(hh, _HT, _LP))), float(np.interp(hh, _HT, _AS)), float(np.interp(hh, _HT, _TT)))
    H = R0 * h / (R0 + h); Hb, Tb, L = 71000.0, 214.65, -0.002
    pb = float(Atmosphere(R0 * Hb / (R0 - Hb)).pressure[0]); T = Tb + L * (H - Hb)
    p = pb * (Tb / T) ** (GMR / L)
    return p / (RAIR * T), p, math.sqrt(GAM * RAIR * T), T

def alt(r):
    rn = np.linalg.norm(r); s = r[2] / rn; c2 = 1 - s * s
    return rn - RE * RC / math.sqrt(RC * RC * c2 + RE * RE * s * s)

def cd_of(cd, M):
    if isinstance(cd, (int, float)): return float(cd)
    return float(np.interp(M if M is not None else 1e9, cd['mach'], cd['value']))

# ---------------------------------------------------------------- the descent, in the frame turning with the Earth
W = np.array([0.0, 0.0, OM])
def rhs_factory(mass, cds_fn):
    def f(t, y):
        r, v = y[:3], y[3:]
        h = alt(r); rho, p, a, T = atm(h)
        V = np.linalg.norm(v); M = V / a if a else None
        cds = cds_fn(t, M)
        rn = np.linalg.norm(r)
        acc = -MU * r / rn ** 3 - 2 * np.cross(W, v) - np.cross(W, np.cross(W, r))
        if rho > 0 and V > 0: acc = acc - 0.5 * rho * V * cds / mass * v
        return np.concatenate([v, acc])
    return f

def sensed_g(y, mass, cds):
    r, v = y[:3], y[3:]; rho, p, a, T = atm(alt(r)); V = np.linalg.norm(v)
    return 0.5 * rho * V * V * cds / mass / G0

def leg(y0, t0, mass, cds_fn, events, tmax=20000.0, peak_cds=None):
    sol = solve_ivp(rhs_factory(mass, cds_fn), (t0, t0 + tmax), y0, method='DOP853', rtol=1e-10, atol=1e-6, events=events, dense_output=True, max_step=0.5)
    te = None; ye = sol.y[:, -1]
    for i, ev in enumerate(sol.t_events):
        if len(ev):
            if te is None or ev[0] < te: te, ye = ev[0], sol.y_events[i][0]
    if te is None: te = sol.t[-1]
    pk = 0.0
    if peak_cds is not None:
        ts = np.linspace(t0, te, max(50, int((te - t0) / 0.002)))
        for tt in ts:
            yy = sol.sol(tt); pk = max(pk, sensed_g(yy, mass, peak_cds(tt, None)))
    return te, ye, pk

def ev_ground(gnd):
    e = lambda t, y: alt(y[:3]) - gnd; e.terminal = True; e.direction = -1; return e
def ev_pressure(P):
    e = lambda t, y: atm(alt(y[:3]))[1] - P; e.terminal = True; e.direction = 1; return e
def ev_time(T):
    e = lambda t, y: t - T; e.terminal = True; e.direction = 1; return e

def descend(c):
    T = c['trigger']; r = np.array(T['r']); v = np.array(T['v']) - np.cross(W, np.array(T['r']))
    y, t, m = np.concatenate([r, v]), T['t'], c['mass_kg']
    body_cd, area = c['cd'], c['area_m2']
    body = lambda tt, M: cd_of(body_cd, M) * area
    out = {}
    if c['mode'] == 'none':
        te, ye, _ = leg(y, t, m, body, [ev_ground(c['ground_alt_m'])])
        out['land_t'] = te; out['land_speed'] = float(np.linalg.norm(ye[3:])); return out
    fd, fm = K['fill_drogue_s'], K['fill_main_s']
    if c['mode'] == 'nominal':
        td = t + c['drogue_timer_s']
        t, y, _ = leg(y, t, m, body, [ev_time(td), ev_ground(c['ground_alt_m'])])
        out['drogue_t'] = t
        rho, p, a, Tm = atm(alt(y[:3])); cds0 = cd_of(body_cd, np.linalg.norm(y[3:]) / a) * area; cds1 = c['drogue_cds_m2']; t0 = t
        ramp = lambda tt, M, t0=t0: cds0 + (cds1 - cds0) * min(1.0, max(0.0, (tt - t0) / fd))
        t, y, pk = leg(y, t, m, ramp, [ev_time(t0 + fd)], peak_cds=ramp)
        out['drogue_open_g'] = pk
        evs = [ev_pressure(c['baro_Pa']), ev_ground(c['ground_alt_m'])]
        if c['main_timer_s'] is not None:
            tref = out['drogue_t'] if c['main_timer_from'] == 'drogue' else T['t']
            evs.append(ev_time(tref + c['main_timer_s']))
        t, y, _ = leg(y, t, m, lambda tt, M: cds1, evs)
        cds0 = cds1
    else:   # no drogue: the body to the main's baroswitch or timer
        evs = [ev_pressure(c['baro_Pa']), ev_ground(c['ground_alt_m'])]
        if c['main_timer_s'] is not None: evs.append(ev_time(T['t'] + c['main_timer_s']))
        t, y, _ = leg(y, t, m, body, evs)
        rho, p, a, Tm = atm(alt(y[:3])); cds0 = cd_of(body_cd, np.linalg.norm(y[3:]) / a) * area
    out['main_t'] = t
    cds1 = c['main_cds_m2']; t0 = t
    ramp = lambda tt, M, t0=t0, cds0=cds0: cds0 + (cds1 - cds0) * min(1.0, max(0.0, (tt - t0) / fm))
    t, y, pk = leg(y, t, m, ramp, [ev_time(t0 + fm)], peak_cds=ramp)
    out['main_open_g'] = pk
    te, ye, _ = leg(y, t, m, lambda tt, M: cds1, [ev_ground(c['ground_alt_m'])])
    out['land_t'] = te; out['land_speed'] = float(np.linalg.norm(ye[3:]))
    return out

# ---------------------------------------------------------------- heating along the shared hypersonic flight
def suttles(V, rho, Rn):
    if V <= 0 or rho <= 0: return 0.0
    v, p, R = V / 1000.0, rho * 1e-3, Rn * 100.0
    return math.exp(A[0] + (A[1] + A[2] * v) * math.log(p) + (A[3] + A[4] * v + A[5] * v * v) * math.log(R) + (A[6] + A[7] * v + A[8] * v * v) * math.log(v)) * 1e4

def eps(T):
    tl, el, th, eh = K['emissivity']; f = min(1.0, max(0.0, (T - tl) / (th - tl))); return el + f * (eh - el)

def heating(c):
    ser = np.array(c['series']); t, h, V = ser[:, 0], ser[:, 1], ser[:, 2]
    rho = np.array([atm(x)[0] for x in h]); Tm = np.array([atm(x)[3] or 0.0 for x in h])
    qc = KSG * np.sqrt(rho / c['rn_m']) * V ** 3
    qr = np.array([suttles(V[i], rho[i], c['rn_m']) for i in range(len(V))])
    h0 = V * V / 2 + GAM * RAIR / (GAM - 1) * Tm
    qt = qc + qr
    Tw = np.array([brentq(lambda T: eps(T) * SIG * T ** 4 - q, 1.0, 2e4, xtol=1e-6) if q > 0 else 0.0 for q in qt])
    md = np.where(Tw >= K['t_ox'], BP * qc / h0, 0.0)   # oxidation counted only on a wall at 1600 K or more
    # Simpson per contiguous block (the passes)
    cuts = [0] + [i + 1 for i in range(len(t) - 1) if t[i + 1] - t[i] > 1.5] + [len(t)]
    Qc = Qr = Mt = 0.0
    for a, b in zip(cuts[:-1], cuts[1:]):
        if b - a < 3: continue
        Qc += simpson(qc[a:b], x=t[a:b]); Qr += simpson(qr[a:b], x=t[a:b]); Mt += simpson(md[a:b], x=t[a:b])
    i = int(np.argmax(qt))
    Tw = brentq(lambda T: eps(T) * SIG * T ** 4 - qt[i], 10.0, 2e4, xtol=1e-9)
    return {'Q_conv': Qc, 'Q_rad': Qr, 'recession_m': Mt / c['shield_density'], 'peak_Tw': Tw}

res = {'note': 'idea 49 oracle: descent in the Earth-fixed frame (scipy DOP853), ambiance atmosphere, Simpson heating', 'cases': {}}
for c in C['cases']:
    d = descend(c); hh = heating(c)
    res['cases'][c['id']] = {**d, **hh}
    print(c['id'], {k: round(v, 6) if isinstance(v, float) else v for k, v in {**d, **hh}.items()})
    print('   kernel', c['kernel'])
json.dump(res, open(os.path.join(HERE, 'descent-oracle.json'), 'w'), indent=1)
