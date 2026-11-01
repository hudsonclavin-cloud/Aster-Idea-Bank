"""Idea 47 (Way Home), independent review oracles; writes oracle/review-oracles.json (home.test.mjs test 11 reads it).
    node ideas/47-way-home/build-data.mjs --review-inputs <dir>; <venv>/bin/python -I ideas/47-way-home/oracle/review-oracles.py <dir>
Needs numpy, scipy, lamberthub and the network (JPL Horizons, cached in <dir>). Shares no code with ideas 39, 40, 47:
 1. NHATS's 61 return legs on JPL Horizons states (asteroid at NHATS's date 0h TDB, Earth at arrival), Gooding's Lambert.
 2. The chain's patched conic on JPL's Apophis and Earth.
 3. The chain's two burns flown through Horizons' Sun, planets and Moon (cubic Hermite between rows, 1 h for the Earth
    and Moon), DE440 GMs, the Earth's J2 about ICRF z, the Sun's first-order relativity (on and off), scipy's DOP853.
"""
import json, sys, os, math, hashlib, datetime, urllib.request, urllib.parse
import numpy as np
from scipy.integrate import solve_ivp
from lamberthub import gooding1990

D = sys.argv[1]
I = json.load(open(os.path.join(D, 'inputs.json')))
HERE = os.path.dirname(os.path.abspath(__file__))
H = 'https://ssd.jpl.nasa.gov/api/horizons.api'
SHA = {}

def horizons(name, **q):
    fn = os.path.join(D, name + '.json')
    if not os.path.exists(fn):
        p = {'format': 'json', 'EPHEM_TYPE': "'VECTORS'", 'VEC_TABLE': "'2'", 'OUT_UNITS': "'KM-S'", 'REF_PLANE': "'FRAME'", 'REF_SYSTEM': "'ICRF'",
             'TIME_TYPE': "'TDB'", 'CSV_FORMAT': "'YES'"}
        p.update({k: "'" + v + "'" for k, v in q.items()})
        open(fn, 'wb').write(urllib.request.urlopen(H + '?' + urllib.parse.urlencode(p), timeout=300).read())
    b = open(fn, 'rb').read(); SHA[name] = hashlib.sha256(b).hexdigest()
    r = json.loads(b)['result']
    rows = r[r.index('$$SOE') + 5:r.index('$$EOE')].strip().split('\n')
    a = np.array([[float(x) for x in (l.split(',')[0:1] + l.split(',')[2:8])] for l in rows])
    return a[:, 0], a[:, 1:4] * 1e3, a[:, 4:7] * 1e3

MU = I['mu_sun_aster_m3_s2']; MUE = I['mu_earth_aster_m3_s2']; RE = I['de440']['earthRadius_m']
# ---------------------------------------------------------------- 1. NHATS legs on JPL states
cols = [c.split(' ')[0] for c in I['nhats_columns']]
legs = [dict(zip(cols, r)) for r in I['nhats']]
def jd0(date, add):
    d = datetime.date.fromisoformat(date)
    return 2440587.5 + (datetime.datetime(d.year, d.month, d.day) - datetime.datetime(1970, 1, 1)).total_seconds() / 86400 + add
rows = []
for des in sorted(set(l['des'] for l in legs)):
    L = [l for l in legs if l['des'] == des]
    for l in L: l['jdep'] = jd0(l['launch'], l['dur_out'] + l['dur_at']); l['jarr'] = l['jdep'] + l['dur_ret']
    key = des.replace(' ', '_'); cmd = (des + ';') if des.isdigit() else ('DES=' + des + ';')
    tA, rA, vA = horizons('nhats-' + key + '-dep', COMMAND=cmd, CENTER='500@10', TLIST=' '.join('%.6f' % x for x in sorted(set(l['jdep'] for l in L))), TLIST_TYPE='JD')
    tE, rE, vE = horizons('nhats-' + key + '-earth', COMMAND='399', CENTER='500@10', TLIST=' '.join('%.6f' % x for x in sorted(set(l['jarr'] for l in L))), TLIST_TYPE='JD')
    for l in L:
        i = int(np.argmin(abs(tA - l['jdep']))); j = int(np.argmin(abs(tE - l['jarr'])))
        best = None
        for low in (True, False):
            v1, v2 = gooding1990(MU, rA[i], rE[j], l['dur_ret'] * 86400.0, M=0, prograde=True, low_path=low)
            dv = float(np.linalg.norm(v1 - vA[i])); vi = v2 - vE[j]
            if best is None or dv < best[0]: best = (dv, float(np.linalg.norm(vi)), math.degrees(math.asin(vi[2] / np.linalg.norm(vi))))
        rows.append([l['tid'], round(best[0], 4), round(best[1], 3), round(best[2], 5)])
def med(a): a = sorted(a); n = len(a); return (a[(n - 1) // 2] + a[n // 2]) / 2
gap = [abs(r[1] - l['vrel_dep_neo'] * 1000) for r, l in zip(rows, [next(x for x in legs if x['tid'] == r[0]) for r in rows])]
# ---------------------------------------------------------------- 2. the chain's patched conic on JPL states
C = I['chain']
tA, rA, vA = horizons('chain-apophis-dep', COMMAND='99942;', CENTER='500@10', TLIST='%.9f' % C['jd_dep_tdb'], TLIST_TYPE='JD')
tE, rE, vE = horizons('chain-earth-arr', COMMAND='399', CENTER='500@10', TLIST='%.9f' % C['jd_arr_tdb'], TLIST_TYPE='JD')
v1, v2 = gooding1990(MU, rA[0], rE[0], (C['jd_arr_tdb'] - C['jd_dep_tdb']) * 86400.0, M=0, prograde=True, low_path=True)
chain_pc = {'dv_m_s': float(np.linalg.norm(v1 - vA[0])), 'vinf_m_s': float(np.linalg.norm(v2 - vE[0])),
            'apophis_offset_m': float(np.linalg.norm(rA[0] - np.array(C['asteroid']['r']))), 'apophis_v_offset_m_s': float(np.linalg.norm(vA[0] - np.array(C['asteroid']['v'])))}
# ---------------------------------------------------------------- 3. the chain's burns through an independent n-body model
j0 = math.floor(C['jd_dep_tdb']) - 1; j1 = math.ceil(C['jd_perigee_tdb']) + 2
BOD = {'sun': ('10', '6h'), 'mercury': ('199', '3h'), 'venus': ('299', '6h'), 'earth': ('399', '1h'), 'moon': ('301', '1h'), 'mars': ('4', '1d'),
       'jupiter': ('5', '1d'), 'saturn': ('6', '1d'), 'uranus': ('7', '1d'), 'neptune': ('8', '1d')}
T = {k: horizons('nbody-' + k, COMMAND=v[0], CENTER='500@0', START_TIME='JD%.6f' % j0, STOP_TIME='JD%.6f' % j1, STEP_SIZE=v[1]) for k, v in BOD.items()}
G = I['de440']['gm_m3_s2']; GM = {k: G[k] for k in BOD}; J2 = I['de440']['earthJ2']; CL = I['de440']['c_m_s']
def pos(k, jd):
    t, r, v = T[k]; i = min(max(int(np.searchsorted(t, jd)) - 1, 0), len(t) - 2); h = (t[i + 1] - t[i]) * 86400; s = (jd - t[i]) * 86400 / h
    return (2*s**3 - 3*s**2 + 1) * r[i] + (s**3 - 2*s**2 + s) * h * v[i] + (-2*s**3 + 3*s**2) * r[i + 1] + (s**3 - s**2) * h * v[i + 1]
def vel(k, jd, e=1e-4): return (pos(k, jd + e) - pos(k, jd - e)) / (2 * e * 86400)
def fly(dv, gr):
    def acc(ts, y):
        jd = C['jd_dep_tdb'] + ts / 86400; x = y[:3]; a = np.zeros(3)
        for k, g in GM.items():
            d = x - pos(k, jd); rn = np.linalg.norm(d); a -= g * d / rn**3
            if k == 'earth':
                z2 = (d[2] / rn)**2; f = 1.5 * J2 * g * RE**2 / rn**5
                a -= f * np.array([d[0] * (1 - 5 * z2), d[1] * (1 - 5 * z2), d[2] * (3 - 5 * z2)])
        if gr:
            rs = x - pos('sun', jd); vr = y[3:] - vel('sun', jd); rn = np.linalg.norm(rs); g = GM['sun']
            a += g / (CL * CL * rn**3) * ((4 * g / rn - vr @ vr) * rs + 4 * (rs @ vr) * vr)
        return np.concatenate([y[3:], a])
    y0 = np.concatenate([np.array(C['asteroid']['r']) + pos('sun', C['jd_dep_tdb']), np.array(C['asteroid']['v']) + vel('sun', C['jd_dep_tdb']) + np.array(dv)])
    tend = (C['jd_perigee_tdb'] + 1.5 - C['jd_dep_tdb']) * 86400
    sol = solve_ivp(acc, (0, tend), y0, method='DOP853', rtol=1e-12, atol=1e-4, dense_output=True)
    f = lambda t: float(np.linalg.norm(sol.sol(t)[:3] - pos('earth', C['jd_dep_tdb'] + t / 86400)))
    ts = np.linspace(tend - 3 * 86400, tend, 20001); i = int(np.argmin([f(t) for t in ts])); lo, hi = ts[max(i - 1, 0)], ts[min(i + 1, len(ts) - 1)]; g = (math.sqrt(5) - 1) / 2
    while hi - lo > 0.01:
        c = hi - g * (hi - lo); d = lo + g * (hi - lo)
        if f(c) < f(d): hi = d
        else: lo = c
    tc = (lo + hi) / 2
    return {'perigee_alt_m': round(f(tc) - RE, 1), 'perigee_jd_tdb': C['jd_dep_tdb'] + tc / 86400}
nb = {'flown_gr': fly(C['dv_flown_m_s'], True), 'patched_gr': fly(C['dv_patched_m_s'], True), 'flown_no_gr': fly(C['dv_flown_m_s'], False)}
out = {'retrieved': datetime.date.today().isoformat(), 'tools': 'lamberthub gooding1990, scipy DOP853, JPL Horizons API (ICRF, TDB)',
       'nhats_columns': ['tid', 'dv_m_s', 'vinf_m_s', 'dec_deg'], 'nhats_on_jpl': rows,
       'nhats_on_jpl_vs_nhats_dv_m_s': {'median': round(med(gap), 4), 'max': round(max(gap), 4)},
       'chain_patched_on_jpl': {k: round(v, 6) for k, v in chain_pc.items()},
       'chain_nbody': nb, 'chain_page': {'perigee_alt_m': C['perigee_alt_m'], 'uncorrected_alt_m': C['uncorrected_alt_m']},
       'horizons_files': len(SHA), 'horizons_sha256': hashlib.sha256('\n'.join(SHA[k] for k in sorted(SHA)).encode()).hexdigest(), 'sha256_rule': 'sha256 of the newline-joined per-response sha256s, names sorted'}
json.dump(out, open(os.path.join(HERE, 'review-oracles.json'), 'w'), separators=(',', ':'))
print(json.dumps({k: out[k] for k in ['nhats_on_jpl_vs_nhats_dv_m_s', 'chain_patched_on_jpl', 'chain_nbody', 'chain_page']}, indent=1))
