#!/usr/bin/env python3
"""The independent review's own oracle for idea 43 (Lumpy): numbers recomputed from the primary sources without the
kernel, its snapshots or the builder's oracle.py.

    python3 -I ideas/43-lumpy/oracle/review.py <directory with the downloads of fetch-sources.sh>

Needs a throw-away venv with spiceypy, numpy, scipy and polyhedral-gravity (as oracle.py). Writes oracle/review.json.
What it recomputes, each from the downloaded DSK, CK, PCK and Horizons files directly:

  Apophis   mass properties of the unchanged radar DSK (signed tetrahedra, numpy eigenvalues); the plate under idea 42's
            stand-off with the attitude taken from SPICE's own CK interpolation (pxform J2000 -> APOPHIS_CK), not from
            the kernel's Euler integration; that plate's gravity (polyhedral-gravity, Tsoulis's line integrals); the point
            mass at the same distance from the uniform-density centre of mass, and from the DSK origin; how wrong a point
            mass is along the long axis; the spin's share of the surface acceleration with the spin vector differentiated
            from SPICE's attitude; and one 12-hour orbit flown under the shape with SPICE's attitude and scipy's DOP853.
  Bennu     OSIRIS-REx in Orbital B under a point mass and under the FULL 12,288-plate DSK, from freshly downloaded Horizons
            vectors, with idea 42's sunlight table (snapshots/orbit-b-sunlight.js: the one input shared with the kernel).

G, the GMs and idea 42's stand-off come from files (approach-sources.js, geophysics.js, ideas/42-closing-in/handoff.json),
never typed here.
"""
import hashlib, json, os, re, sys
import numpy as np
import spiceypy as sp
import polyhedral_gravity as pg
from scipy.integrate import solve_ivp

D = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(HERE)


def js_data(path):
    return json.loads(re.search(r'var D = (\{.*\});', open(path).read(), re.S).group(1))


G = js_data(os.path.join(FOLDER, 'snapshots', 'approach-sources.js'))['nist']['G_m3_kg_s2']
Z = js_data(os.path.join(FOLDER, 'snapshots', 'geophysics.js'))['scheeres2020']['zonals']['GM (m3/s2)']
SUN = js_data(os.path.join(FOLDER, 'snapshots', 'orbit-b-sunlight.js'))
H42 = json.load(open(os.path.join(FOLDER, '..', '42-closing-in', 'handoff.json')))


def sha(name):
    return hashlib.sha256(open(os.path.join(D, name), 'rb').read()).hexdigest()


def load_dsk(name):
    h = sp.dasopr(os.path.join(D, name)); dla = sp.dlabfs(h); nv, npl = sp.dskz02(h, dla)
    v = np.array(sp.dskv02(h, dla, 1, nv)) * 1000.0; p = np.array(sp.dskp02(h, dla, 1, npl)) - 1
    sp.dascls(h)
    return v, p


def mass(v, p):
    a, b, c = v[p[:, 0]], v[p[:, 1]], v[p[:, 2]]
    det = np.einsum('ij,ij->i', a, np.cross(b, c)); V = det.sum() / 6
    s = a + b + c; com = (det[:, None] * s).sum(0) / 24 / V
    M2 = sum(np.einsum('i,ij,ik->jk', det, X, X) for X in (a, b, c)) + np.einsum('i,ij,ik->jk', det, s, s)
    M2 /= 120.0                                       # the integral of x x^T over the solid, about the DSK origin
    Mc = M2 - V * np.outer(com, com); I = np.trace(Mc) * np.eye(3) - Mc
    ev, evec = np.linalg.eigh(I)
    return V, com, ev, evec


def poly(vc, p, rho):
    return pg.GravityEvaluable(pg.Polyhedron((vc.tolist(), p.tolist()), float(rho), integrity_check=pg.PolyhedronIntegrity.DISABLE))


out = {'sources_sha256': {}, 'G_m3_kg_s2': G}
for k in ['naif0012.tls', 'orx_shape_v04.tf', 'orx_v15.tf', 'apophis_npa_220101_330101_nominal_pravec_v1.bc', 'bennu_v17.tpc']:
    sp.furnsh(os.path.join(D, k)); out['sources_sha256'][k] = sha(k)

# ---------------------------------------------------------------------------------------------------------- Apophis
fa = 'apophis_g_25000mm_rad_obj_0000n00000_v001.bds'; out['sources_sha256'][fa] = sha(fa)
v, p = load_dsk(fa); V, com, ev, evec = mass(v, p); vc = v - com
GM = H42['outputs']['body']['value']['GM_m3_s2']; rho = GM / (G * V)
E = poly(vc, p, rho)
ss = H42['outputs']['standoff_state']['value']; t = ss['tdb_s_past_j2000']
C = np.array(sp.pxform('J2000', 'APOPHIS_CK', t)); d = C @ np.array(ss['r_m']); d /= np.linalg.norm(d)
best, bt = -1, -1e30
for fi, (i, j, k) in enumerate(p):                   # Moeller-Trumbore from the centre of mass: the outermost crossing
    A_, e1, e2 = vc[i], vc[j] - vc[i], vc[k] - vc[i]; pv = np.cross(d, e2); det = e1 @ pv
    if abs(det) < 1e-12: continue
    tv = -A_; u = tv @ pv / det
    if u < 0 or u > 1: continue
    qv = np.cross(tv, e1); w = d @ qv / det
    if w < 0 or u + w > 1: continue
    tt = e2 @ qv / det
    if tt > bt: bt, best = tt, fi
fc = vc[p[best]].mean(0); g_site = np.array(E([fc.tolist()])[0][1])
# the spin from SPICE's attitude: [w x] = -dC/dt C^T (C takes J2000 into the body), central differences
def omega(tt, h=1.0):
    Cp, Cm, C0 = (np.array(sp.pxform('J2000', 'APOPHIS_CK', tt + s)) for s in (h, -h, 0.0))
    W = -((Cp - Cm) / (2 * h)) @ C0.T
    return np.array([W[2, 1], W[0, 2], W[1, 0]])
w0 = omega(t); wd = (omega(t + 60.0) - omega(t - 60.0)) / 120.0
FC = vc[p].mean(1); gg = np.array([r[1] for r in E(FC.tolist())])
acc = gg - np.cross(w0, np.cross(w0, FC)) - np.cross(wd, FC)
N = np.cross(vc[p[:, 1]] - vc[p[:, 0]], vc[p[:, 2]] - vc[p[:, 0]]); Ar = np.linalg.norm(N, axis=1) / 2; N /= (2 * Ar)[:, None]
slope = np.degrees(np.arccos(np.clip(-(N * acc).sum(1) / np.linalg.norm(acc, axis=1), -1, 1)))
long_axis = evec[:, 0]
pme = {}
for sgn in (1, -1):
    rows = []
    for kk in (1.0, 2.0, 4.0):
        x = sgn * long_axis * kk * np.linalg.norm(vc, axis=1).max(); gx = np.array(E([x.tolist()])[0][1]); pm = -GM * x / np.linalg.norm(x) ** 3
        rows.append(float(np.linalg.norm(pm - gx) / np.linalg.norm(gx)))
    pme['+' if sgn > 0 else '-'] = rows
# one orbit flown under the shape for 12 h, the attitude from SPICE at every step
r0 = 1.54 * np.linalg.norm(vc, axis=1).max(); x0 = [r0, 0.0, 0.0]; v0 = [0.0, 0.0, float(np.sqrt(GM / r0))]
def rhs(tt, y):
    Ct = np.array(sp.pxform('J2000', 'APOPHIS_CK', tt)); a = Ct.T @ np.array(E([list(Ct @ y[:3])])[0][1])
    return np.r_[y[3:], a]
sol = solve_ivp(rhs, (t, t + 12 * 3600.0), x0 + v0, method='DOP853', rtol=1e-11, atol=1e-9, t_eval=[t + 6 * 3600.0, t + 12 * 3600.0])
out['apophis'] = {
    'volume_m3': float(V), 'equivalent_diameter_m': float(2 * (3 * V / (4 * np.pi)) ** (1 / 3)), 'uniform_com_in_dsk_m': com.tolist(),
    'inertia_ratios': (ev / ev[2]).tolist(), 'brillouin_radius_m': float(np.linalg.norm(vc, axis=1).max()), 'GM_m3_s2': GM, 'density_kg_m3': float(rho),
    'site': {'epoch_tdb_s': t, 'face': int(best), 'centroid_from_com_m': fc.tolist(), 'r_from_com_m': float(np.linalg.norm(fc)), 'r_from_dsk_origin_m': float(np.linalg.norm(fc + com)),
             'gravity_m_s2': float(np.linalg.norm(g_site)), 'point_mass_at_com_m_s2': float(GM / np.linalg.norm(fc) ** 2), 'point_mass_at_dsk_origin_m_s2': float(GM / np.linalg.norm(fc + com) ** 2)},
    'spin_from_spice': {'omega_body_rad_s': w0.tolist(), 'period_h': float(2 * np.pi / np.linalg.norm(w0) / 3600),
                        'max_spin_share_of_accel': float(np.max(np.linalg.norm(acc - gg, axis=1) / np.linalg.norm(gg, axis=1))),
                        'mean_slope_deg': float((Ar * slope).sum() / Ar.sum()), 'steeper30': float(Ar[slope > 30].sum() / Ar.sum())},
    'gravity_min_max_m_s2': [float(np.linalg.norm(gg, axis=1).min()), float(np.linalg.norm(gg, axis=1).max())],
    'long_axis_body': long_axis.tolist(), 'point_mass_error_long_axis_1_2_4': pme,
    'orbit_12h': {'t0_tdb_s': t, 'x0_m': x0, 'v0_m_s': v0, 'x6h_m': sol.y[:3, 0].tolist(), 'x12h_m': sol.y[:3, 1].tolist(), 'v12h_m_s': sol.y[3:, 1].tolist(), 'attitude': 'SPICE pxform J2000 -> APOPHIS_CK (the CK itself)'}}
print('apophis', json.dumps(out['apophis']['site']), flush=True)

# ---------------------------------------------------------------------------------------------------------- Bennu, Orbital B
fb = 'bennu_g_12600mm_alt_obj_0000n00000_v021.bds'; out['sources_sha256'][fb] = sha(fb)
def rows(name):
    txt = open(os.path.join(D, name)).read().split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()
    return np.array([[float(c[0])] + [float(x) * 1000 for x in c[2:8]] for c in ([s.strip() for s in L.split(',')] for L in txt)])
R = rows('horizons-orex-orbitb.txt'); out['sources_note'] = 'Horizons text carries a generation time, so its sha256 differs per download; the vectors are what count'
R = R[R[:, 0] >= 2458653.5 - 1e-9][::4][:21]          # every 2 h from 2019-06-19 00:00 TDB, 21 rows (40 h)
v, p = load_dsk(fb); V, com, _, _ = mass(v, p); vc = v - com
def sunlight(tt):
    T = SUN['t']; k = max(0, min(len(T) - 2, int((tt - T[0]) // (T[1] - T[0])))); f = (tt - T[k]) / (T[k + 1] - T[k])
    return np.array(SUN['a'][k]) + f * (np.array(SUN['a'][k + 1]) - np.array(SUN['a'][k]))
ob = {}
for name, GMb in (('spacecraft', Z['spacecraft']), ('particle', Z['particle'])):
    Eb = poly(vc, p, GMb / (G * V))
    for model in ('pm', 'poly'):
        def f(tt, y):
            x = y[:3]
            if model == 'pm': a = -GMb * x / np.linalg.norm(x) ** 3
            else:
                Ct = np.array(sp.pxform('J2000', 'IAU_BENNU', tt)); a = Ct.T @ np.array(Eb([list(Ct @ x)])[0][1])
            return np.r_[y[3:], a + sunlight(tt)]
        dv = []
        for i in range(20):
            t0, t1 = ((R[i, 0] - 2451545.0) * 86400, (R[i + 1, 0] - 2451545.0) * 86400)
            s = solve_ivp(f, (t0, t1), R[i, 1:], method='DOP853', rtol=1e-11, atol=1e-9); dv.append(float(np.linalg.norm(s.y[3:, -1] - R[i + 1, 4:])))
        s = solve_ivp(f, ((R[0, 0] - 2451545.0) * 86400, (R[20, 0] - 2451545.0) * 86400), R[0, 1:], method='DOP853', rtol=1e-11, atol=1e-9)
        ob[name + '_' + model] = {'leg_dv_median_m_s': float(np.median(dv)), 'arc_end_m': float(np.linalg.norm(s.y[:3, -1] - R[20, 1:4])), 'plates': int(len(p)) if model == 'poly' else None}
        print(name, model, ob[name + '_' + model], flush=True)
out['bennu_orbit_b_full_dsk'] = ob
json.dump(out, open(os.path.join(HERE, 'review.json'), 'w'), indent=1)
print('wrote oracle/review.json')
