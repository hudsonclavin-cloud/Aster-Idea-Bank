"""Independent oracle for idea 40's chain numbers (added in the independent review). It shares no code with coast.js:
JPL's DE440s SPK through jplephem (not the page's Chebyshev fits of Horizons), scipy's DOP853 (not the page's DP5(4)),
a geocentric third-body form for the spacecraft, finite-difference Newton for both aims. Inputs: idea 39's committed
handoff (departure and arrival epochs, v-infinity, Aster's Apophis elements) and the constants this module snapshots
(GMs from DE440's header, Aster's Sun and Earth GMs, parking radius, obliquity). TCM-1 is 10 days after departure (the
page's default, on its 2-hour grid). Run with a throw-away venv (numpy, scipy, jplephem) and de440s.bsp from
https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de440s.bsp:
  python -I de440-chain.py <ideas/39-lamberts-road/handoff.json> <de440s.bsp> > de440-chain.json
"""
import json, sys, math, re, os, hashlib
import numpy as np, scipy
from scipy.integrate import solve_ivp
from jplephem.spk import SPK

here = os.path.dirname(os.path.abspath(__file__))
def snap(f): return json.loads(re.search(r'var D = (\{.*\});', open(os.path.join(here, '..', 'snapshots', f)).read()).group(1))
DE, AC = snap('de440-constants.js'), snap('aster-constants.js')
h39 = json.load(open(sys.argv[1])); K = SPK.open(sys.argv[2]); DAY = 86400.0
GM = dict(DE['gm_m3_s2']); GM['sun'], GM['earth'] = AC['gmSun_m3_s2'], AC['earthMu_m3_s2']
J2E, RE, C, RP = DE['earthJ2'], DE['earthRadius_m'], DE['c_m_s'], AC['parkingRadius_m']
SEG = dict(mercury=(0, 1), venus=(0, 2), mars=(0, 4), jupiter=(0, 5), saturn=(0, 6), uranus=(0, 7), neptune=(0, 8), sun=(0, 10))
BODIES = ['moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']

def pv(n, jd):   # barycentric km, km/day
    if n in ('earth', 'moon'):
        a, b = K[0, 3].compute_and_differentiate(jd); c, d = K[3, 399 if n == 'earth' else 301].compute_and_differentiate(jd); return a + c, b + d
    return K[SEG[n]].compute_and_differentiate(jd)
def helio(n, t):   # heliocentric m, m/s at TDB s past J2000
    jd = 2451545.0 + t / DAY; p, v = pv(n, jd); ps, vs = pv('sun', jd); return (p - ps) * 1e3, (v - vs) * 1e3 / DAY
def schw(r, v):   # the Sun's Schwarzschild term, PPN beta = gamma = 1
    rn = np.linalg.norm(r); return GM['sun'] / (C * C * rn ** 3) * ((4 * GM['sun'] / rn - v @ v) * r + 4 * (r @ v) * v)
def third(r, s, mu): d = s - r; return mu * (d / np.linalg.norm(d) ** 3 - s / np.linalg.norm(s) ** 3)
def f_geo(t, y):   # spacecraft about the Earth: point mass + J2 (ICRF z) + Sun, Moon, planets as third bodies + relativity
    r, v = y[:3], y[3:]; rn = np.linalg.norm(r); z2 = r[2] ** 2 / rn ** 2; fj = -1.5 * J2E * GM['earth'] * RE ** 2 / rn ** 5
    a = -GM['earth'] * r / rn ** 3 + fj * np.array([r[0] * (1 - 5 * z2), r[1] * (1 - 5 * z2), r[2] * (3 - 5 * z2)])
    rE, vE = helio('earth', t); a = a + third(r, -rE, GM['sun'])
    for b in BODIES: a = a + third(r, helio(b, t)[0] - rE, GM[b])
    return np.concatenate([v, a + schw(r + rE, v + vE) - schw(rE, vE)])
def f_helio(t, y):   # asteroid about the Sun: Earth, Moon, planets direct and indirect + relativity
    r, v = y[:3], y[3:]; a = -GM['sun'] * r / np.linalg.norm(r) ** 3 + schw(r, v)
    for b in ['earth'] + BODIES: p = helio(b, t)[0]; d = r - p; a = a - GM[b] * (d / np.linalg.norm(d) ** 3 + p / np.linalg.norm(p) ** 3)
    return np.concatenate([v, a])
def prop(f, y0, t0, t1): return solve_ivp(f, (t0, t1), y0, method='DOP853', rtol=1e-12, atol=1e-9).y[:, -1]
def kepler(el, t):   # Aster's ecliptic J2000 elements to an ICRF state
    a, e, mu = el['a_m'], el['e'], GM['sun']; M = el['mean_anomaly_rad'] + math.sqrt(mu / a ** 3) * (t - (el['epoch_tdb_jd'] - 2451545.0) * DAY)
    E = M
    for _ in range(60): E -= (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
    nu = 2 * math.atan2(math.sqrt(1 + e) * math.sin(E / 2), math.sqrt(1 - e) * math.cos(E / 2)); p = a * (1 - e * e); r = p / (1 + e * math.cos(nu))
    Rz = lambda x: np.array([[math.cos(x), -math.sin(x), 0], [math.sin(x), math.cos(x), 0], [0, 0, 1]])
    Rx = lambda x: np.array([[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]])
    Q = Rx(AC['obliquity_rad']) @ Rz(el['node_rad']) @ Rx(el['i_rad']) @ Rz(el['argp_rad'])
    return Q @ np.array([r * math.cos(nu), r * math.sin(nu), 0]), Q @ (np.array([-math.sin(nu), e + math.cos(nu), 0]) * math.sqrt(mu / p))
def hyperbola(vinf):   # periapsis on the parking radius, least-inclined (prograde) plane, outgoing asymptote vinf
    vi = np.linalg.norm(vinf); s = vinf / vi; e = np.cross([0, 0, 1.0], s); e /= np.linalg.norm(e); n = np.cross(s, e); n /= np.linalg.norm(n)
    th = math.acos(-1 / (1 + RP * vi * vi / GM['earth'])); p = s * math.cos(th) - np.cross(n, s) * math.sin(th)
    return np.concatenate([p * RP, np.cross(n, p) * math.sqrt(vi * vi + 2 * GM['earth'] / RP)])
def fly(yg, t0, t1): y = prop(f_geo, yg, t0, t1); rE, vE = helio('earth', t1); return y[:3] + rE, y[3:] + vE
def newton(miss, x, h, tol):   # finite-difference Newton with backtracking on a 3-vector
    d = miss(x)
    for it in range(30):
        if np.linalg.norm(d) < tol: break
        J = np.column_stack([(miss(x + h * np.eye(3)[j]) - d) / h for j in range(3)]); st = -np.linalg.solve(J, d); lam = 1.0
        for _ in range(12):
            dn = miss(x + lam * st)
            if np.linalg.norm(dn) < np.linalg.norm(d): break
            lam /= 2
        x, d = x + lam * st, dn
    return x, float(np.linalg.norm(d)), it

T, V = h39['outputs']['transfer']['value'], h39['outputs']['v_infinity_departure']['value']
el = h39['outputs']['target']['value']['elements_ecliptic_j2000']
tDep, tArr = T['departure_tdb_s_past_j2000'], T['arrival_tdb_s_past_j2000']; tTcm = tDep + 10 * DAY; v39 = np.array(V['vector_m_s'])
t0 = (el['epoch_tdb_jd'] - 2451545.0) * DAY; tg = prop(f_helio, np.concatenate(kepler(el, t0)), t0, tArr); rT = tg[:3]
y1 = prop(f_geo, hyperbola(v39), tDep, tTcm)
rU, _ = fly(hyperbola(v39), tDep, tArr)
dv, dvMiss, dvIt = newton(lambda d: fly(np.concatenate([y1[:3], y1[3:] + d]), tTcm, tArr)[0] - rT, np.zeros(3), 1e-2, 10)
vin, viMiss, viIt = newton(lambda v: fly(hyperbola(v), tDep, tArr)[0] - rT, v39.copy(), 1e-3, 1000)
rA, vA = fly(hyperbola(vin), tDep, tArr)
vp = lambda v: math.sqrt(v @ v + 2 * GM['earth'] / RP)
print(json.dumps({
  'oracle': 'JPL DE440s (jplephem ' + __import__('jplephem').__version__ + '), scipy ' + scipy.__version__ + ' DOP853 rtol 1e-12; no code shared with coast.js',
  'ephemeris': {'url': 'https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de440s.bsp', 'sha256': hashlib.sha256(open(sys.argv[2], 'rb').read()).hexdigest()},
  'inputs': {'from': '39-lamberts-road handoff.json (committed)', 'departure_tdb_s_past_j2000': tDep, 'arrival_tdb_s_past_j2000': tArr, 'tcm1_tdb_s_past_j2000': tTcm, 'vinf_m_s': v39.tolist()},
  'target_r_m': rT.tolist(), 'target_v_m_s': tg[3:].tolist(), 'target_two_body_shift_m': float(np.linalg.norm(rT - kepler(el, tArr)[0])),
  'uncorrected_miss_m': float(np.linalg.norm(rU - rT)),
  'tcm1_as_given_dv_m_s': dv.tolist(), 'tcm1_residual_miss_m': dvMiss, 'tcm1_iterations': dvIt,
  'reaim_vinf_m_s': vin.tolist(), 'reaim_residual_miss_m': viMiss, 'reaim_iterations': viIt,
  'reaim_c3_m2_s2': float(vin @ vin), 'reaim_dla_deg': math.degrees(math.asin(vin[2] / np.linalg.norm(vin))), 'reaim_rla_deg': math.degrees(math.atan2(vin[1], vin[0])) % 360,
  'reaim_periapsis_speed_change_m_s': vp(vin) - vp(v39), 'arrival_vinf_m_s': float(np.linalg.norm(vA - tg[3:]))}, indent=1))
