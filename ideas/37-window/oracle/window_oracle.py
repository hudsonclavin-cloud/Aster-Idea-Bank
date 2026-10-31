#!/usr/bin/env python3
"""Window's independent oracle (idea 37). Reads oracle/cases.json (written by oracle/build-cases.mjs from the kernel) and
writes oracle/oracle.json, which window.test.mjs compares the kernel against. Never imported by the page.

Run once in a throw-away venv (pyerfa 2.0.1.5 wraps ERFA 2.0.1, the C library derived from the IAU's SOFA):
    python3 -m venv /tmp/venv37 && /tmp/venv37/bin/pip install pyerfa numpy scipy
    /tmp/venv37/bin/python -I ideas/37-window/oracle/window_oracle.py

1. Earth orientation. For each epoch: ERFA's own UTC -> TAI -> TT (its own leap-second table, not NAIF's), UT1 = UTC as
   the kernel assumes; era00, gmst06 and pmat06 (the kernel's model), and the full IAU 2006/2000A celestial-to-terrestrial
   matrix c2t06a (nutation included, no polar motion). The pad's direction in GCRS both ways: the angle between them is
   what leaving out nutation costs, split into the part along the pad's daily motion (as seconds of launch time) and the
   rest (a tilt of the pole).
2. The window, brute force. The plane through the pad (direction from c2t06a, the full model) and the asymptote; its
   azimuth measured from the true (CIP) north; every opening and closing edge of the kernel's no-J2 window found again
   here by bisection to a millisecond. No J2 on either side: this checks the geometry and the Earth orientation.
3. The coast. The kernel's insertion state propagated to the kernel's departure time with scipy's DOP853 (rtol 1e-12)
   under the same force model (point mass + J2, the J2 acceleration taken here as the numerical gradient of the zonal
   potential, not the kernel's formula): the kernel's RK4 position, velocity and plane against it. Then again with J3 and
   J4 (WGS-84, the same NAIF block): how far the zonal terms the kernel leaves out move the plane and the departure point.
"""
import json
import math
import os

import erfa
import numpy as np
from scipy.integrate import solve_ivp

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = json.load(open(os.path.join(HERE, 'cases.json')))
DAS2R = math.pi / 648000.0


def utc_parts(iso):
    y, mo, d = int(iso[0:4]), int(iso[5:7]), int(iso[8:10])
    hh, mm, ss = int(iso[11:13]), int(iso[14:16]), float(iso[17:19])
    return erfa.dtf2d('UTC', y, mo, d, hh, mm, ss)


def scales_from_unix(t):
    """UTC 2-part JD, TT and UT1 (= UTC) from Unix seconds, through ERFA's own leap seconds."""
    day = math.floor(t / 86400.0)
    u1, u2 = 2440587.5 + day, (t - day * 86400.0) / 86400.0
    a1, a2 = erfa.utctai(u1, u2)
    t1, t2 = erfa.taitt(a1, a2)
    b1, b2 = erfa.utcut1(u1, u2, 0.0)
    return (u1, u2), (t1, t2), (b1, b2)


def unit(v):
    return v / np.linalg.norm(v)


def site_itrs(lat_deg, lon_deg):
    p, l = math.radians(lat_deg), math.radians(lon_deg)
    return np.array([math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p)])


# ------------------------------------------------------------------ 1. Earth orientation
earth = []
lat0, lon0 = CASES['window']['latDeg'], CASES['window']['lonDeg']
for e in CASES['epochs']:
    u1, u2 = utc_parts(e['utc'])
    a1, a2 = erfa.utctai(u1, u2)
    t1, t2 = erfa.taitt(a1, a2)
    b1, b2 = erfa.utcut1(u1, u2, 0.0)
    tt_minus_utc = ((t1 - u1) + (t2 - u2)) * 86400.0
    era = erfa.era00(b1, b2)
    gmst = erfa.gmst06(b1, b2, t1, t2)
    P = erfa.pmat06(t1, t2)
    gst = erfa.gst06a(b1, b2, t1, t2)
    rc2t = erfa.c2t06a(t1, t2, b1, b2, 0.0, 0.0)
    k = e['kernel']
    Pk = np.array(k['P'])
    # the pad in GCRS: the kernel's way (mean pole, GMST, precession only) and the full model
    mod = np.array([math.cos(math.radians(lat0)) * math.cos(k['gmst'] + math.radians(lon0)), math.cos(math.radians(lat0)) * math.sin(k['gmst'] + math.radians(lon0)), math.sin(math.radians(lat0))])
    u_k = Pk.T @ mod
    u_t = rc2t.T @ site_itrs(lat0, lon0)
    cip = erfa.pnm06a(t1, t2)[2]  # the CIP (true pole) in GCRS
    east = unit(np.cross(cip, u_t))
    d = u_k - u_t
    along = float(d @ east)
    omega = 2 * math.pi * 1.00273781191135448 / 86400.0
    earth.append({
        'utc': e['utc'], 'ttMinusUtc_erfa': tt_minus_utc, 'ttMinusUtc_kernel': e['ttMinusUtc'],
        'era_erfa': era, 'era_diff_rad': k['era'] - era,
        'gmst_erfa': gmst, 'gmst_diff_rad': (k['gmst'] - gmst + math.pi) % (2 * math.pi) - math.pi,
        'pmat06': np.array(P).tolist(), 'pmat06_max_diff': float(np.max(np.abs(Pk - np.array(P)))),
        'eqeq_arcsec': ((gst - gmst + math.pi) % (2 * math.pi) - math.pi) / DAS2R,
        'pad_angle_arcsec': math.degrees(math.atan2(np.linalg.norm(np.cross(u_k, u_t)), float(u_k @ u_t))) * 3600,
        'pad_along_s': along / math.cos(math.radians(lat0)) / omega,
        'pad_cross_arcsec': math.degrees(math.sqrt(max(0.0, float(d @ d) - along * along))) * 3600,
        'greenwich_ra_gcrs_deg': math.degrees(math.atan2(float((rc2t.T @ np.array([1.0, 0.0, 0.0]))[1]), float((rc2t.T @ np.array([1.0, 0.0, 0.0]))[0]))) % 360.0,
    })

# ------------------------------------------------------------------ 2. the window, brute force (no J2)
Wc = CASES['window']
S = np.array(Wc['S_icrf'])
cor = Wc['corridor']


def azimuth_at(t):
    _, (t1, t2), (b1, b2) = scales_from_unix(t)
    rc2t = erfa.c2t06a(t1, t2, b1, b2, 0.0, 0.0)
    u = rc2t.T @ site_itrs(lat0, lon0)
    cip = erfa.pnm06a(t1, t2)[2]
    east = unit(np.cross(cip, u))
    north = np.cross(u, east)
    h = unit(np.cross(u, S))
    dvec = np.cross(h, u)
    a = math.degrees(math.atan2(float(dvec @ east), float(dvec @ north))) % 360.0
    cands = [a, (a + 180.0) % 360.0]

    def miss(x):
        if cor[0] <= x <= cor[1]:
            return 0.0
        return min(min(abs(x - cor[0]), 360 - abs(x - cor[0])), min(abs(x - cor[1]), 360 - abs(x - cor[1])))
    return min(cands, key=miss)


def edge(t_guess, limit):
    lo, hi = t_guess - 600.0, t_guess + 600.0
    flo = azimuth_at(lo) - limit
    fhi = azimuth_at(hi) - limit
    assert flo * fhi < 0, ('no bracket', t_guess, flo, fhi)
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        fm = azimuth_at(mid) - limit
        if (fm < 0) == (flo < 0):
            lo, flo = mid, fm
        else:
            hi = mid
        if hi - lo < 1e-3:
            break
    return 0.5 * (lo + hi)


windows = []
for w in Wc['kernelNoJ2']:
    lim_o = cor[0] if abs(w['azOpen'] - cor[0]) < abs(w['azOpen'] - cor[1]) else cor[1]
    lim_c = cor[0] if abs(w['azClose'] - cor[0]) < abs(w['azClose'] - cor[1]) else cor[1]
    o = edge(w['open'], lim_o)
    c = edge(w['close'], lim_c)
    windows.append({'open_unix_s': o, 'close_unix_s': c, 'kernel_open_unix_s': w['open'], 'kernel_close_unix_s': w['close'],
                    'open_gap_s': w['open'] - o, 'close_gap_s': w['close'] - c, 'limits_deg': [lim_o, lim_c]})

# ------------------------------------------------------------------ 3. the coast
Cc = CASES['coast']
MU, RJ2 = Cc['mu'], Cc['rj2']
JN = {2: Cc['wgs84']['J2'], 3: Cc['wgs84']['J3'], 4: Cc['wgs84']['J4']}


def legendre(n, x):
    p0, p1 = 1.0, x
    if n == 0:
        return p0
    for k in range(1, n):
        p0, p1 = p1, ((2 * k + 1) * x * p1 - k * p0) / (k + 1)
    return p1


def v_pert(r, orders):
    """Zonal part of the gravitational potential, V = -(mu/r) sum Jn (R/r)^n Pn(z/r) (acceleration = +grad V)."""
    rn = math.sqrt(r[0] ** 2 + r[1] ** 2 + r[2] ** 2)
    x = r[2] / rn
    return -(MU / rn) * sum(JN[n] * (RJ2 / rn) ** n * legendre(n, x) for n in orders)


def a_pert(r, orders, h=1.0):
    g = np.zeros(3)
    for i in range(3):
        rp, rm = np.array(r, dtype=float), np.array(r, dtype=float)
        rp[i] += h
        rm[i] -= h
        g[i] = (v_pert(rp, orders) - v_pert(rm, orders)) / (2 * h)
    return g


def rhs(orders):
    def f(t, y):
        r = y[:3]
        rn = np.linalg.norm(r)
        a = -MU * r / rn ** 3 + a_pert(r, orders)
        return np.concatenate([y[3:], a])
    return f


y0 = np.array(Cc['r0'] + Cc['v0'], dtype=float)
T = Cc['T']
sol2 = solve_ivp(rhs([2]), (0.0, T), y0, method='DOP853', rtol=1e-12, atol=1e-6)
sol4 = solve_ivp(rhs([2, 3, 4]), (0.0, T), y0, method='DOP853', rtol=1e-12, atol=1e-6)
y2, y4 = sol2.y[:, -1], sol4.y[:, -1]
kr, kv = np.array(Cc['kernelR']), np.array(Cc['kernelV'])


def plane_angle_deg(ya, rb, vb):
    ha = unit(np.cross(ya[:3], ya[3:]))
    hb = unit(np.cross(rb, vb))
    return math.degrees(math.atan2(np.linalg.norm(np.cross(ha, hb)), float(ha @ hb)))


def in_plane_angle_deg(ya, yb):
    h = unit(np.cross(yb[:3], yb[3:]))
    a, b = unit(ya[:3]), unit(yb[:3])
    return math.degrees(math.atan2(float(np.cross(b, a) @ h), float(a @ b)))


Smod = np.array(Cc['S_mod'])
# the kernel's J2 formula against the numerical gradient of the potential, at the insertion and the departure point
acc_check = []
for r in [np.array(Cc['r0']), kr]:
    rn = np.linalg.norm(r)
    k = -1.5 * JN[2] * MU * RJ2 ** 2 / rn ** 5
    q = 5 * r[2] ** 2 / rn ** 2
    ak = np.array([k * r[0] * (1 - q), k * r[1] * (1 - q), k * r[2] * (3 - q)])
    an = a_pert(r, [2])
    acc_check.append(float(np.linalg.norm(ak - an) / np.linalg.norm(an)))

out = {
    'tool': 'pyerfa ' + erfa.__version__ + ' (ERFA ' + erfa.version.erfa_version + '), numpy ' + np.__version__ + ', scipy DOP853 rtol 1e-12 atol 1e-6 m',
    'earth': earth,
    'window': windows,
    'coast': {
        'T_s': T,
        'j2_kernel_position_diff_m': float(np.linalg.norm(kr - y2[:3])),
        'j2_kernel_velocity_diff_m_s': float(np.linalg.norm(kv - y2[3:])),
        'j2_kernel_plane_diff_deg': plane_angle_deg(y2, kr, kv),
        'j2_asymptote_out_of_plane_deg': math.degrees(math.asin(float(unit(np.cross(y2[:3], y2[3:])) @ Smod))),
        'j234_vs_j2_plane_deg': plane_angle_deg(y4, y2[:3], y2[3:]),
        'j234_asymptote_out_of_plane_deg': math.degrees(math.asin(float(unit(np.cross(y4[:3], y4[3:])) @ Smod))),
        'j234_vs_j2_in_plane_angle_deg': in_plane_angle_deg(y4, y2),
        'j234_vs_j2_position_m': float(np.linalg.norm(y4[:3] - y2[:3])),
        'j2_accel_formula_rel_diff': acc_check,
        'nfev': [int(sol2.nfev), int(sol4.nfev)],
    },
}
with open(os.path.join(HERE, 'oracle.json'), 'w') as fh:
    json.dump(out, fh, indent=1)
print(json.dumps({'earth_pad_along_s': [round(e['pad_along_s'], 3) for e in earth], 'window_gaps_s': [(round(w['open_gap_s'], 3), round(w['close_gap_s'], 3)) for w in windows], 'coast': out['coast']}, indent=1))
