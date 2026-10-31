#!/usr/bin/env python3
"""Independent oracles for idea 43 (Lumpy). Writes oracle/oracle.json, which the node tests compare against.

    python3 oracle.py <directory with the downloads of fetch-sources.sh>

Needs (a throw-away venv): polyhedral-gravity (Schuhmacher, Blazquez, Gratl, Izzo and Bauer 2024, JOSS: the
polyhedral gravity model of Tsoulis and Petrovic 2001, a line-integral formulation in C++, independent of Werner and
Scheeres's), harmonica (Fatiando a Terra: the closed-form gravity of a right rectangular prism, Nagy et al. 2000),
spiceypy (NAIF's CSPICE: pxform, q2m, the CK's own samples) and numpy/scipy.

Nothing here is imported by the page or the kernel; the kernel never sees these numbers except through the tests.
"""
import base64, json, math, os, re, sys
import numpy as np
import polyhedral_gravity as pg
import harmonica as hm
import spiceypy as sp
from scipy.special import lpmv, roots_legendre

SRC = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
G = 6.6743e-11            # NIST CODATA 2022 (the value idea 42's approach-sources.js carries)


def src(n):
    return os.path.join(SRC, n)


def js_data(path):
    t = open(path).read()
    return json.loads(re.search(r'var D = (\{.*\});\n', t, re.S).group(1))


def shipped(key):
    S = js_data(os.path.join(HERE, '..', 'snapshots', 'shapes.js'))[key]
    v = np.frombuffer(base64.b64decode(S['vertices_b64']), dtype='<i4').astype(float).reshape(-1, 3) / 1000.0
    f = np.frombuffer(base64.b64decode(S['faces_b64']), dtype='<u2').astype(np.int64).reshape(-1, 3)
    return v, f


def dsk(name):
    h = sp.dasopr(src(name)); dla = sp.dlabfs(h); nv, npl = sp.dskz02(h, dla)
    v = np.array(sp.dskv02(h, dla, 1, nv)) * 1000.0; p = np.array(sp.dskp02(h, dla, 1, npl)) - 1; sp.dascls(h)
    return v, p


def poly(v, f, rho):
    # the library's own orientation check casts rays and flags hundreds of plates even on NAIF's untouched DSKs; the meshes
    # are checked here instead (every directed edge once, reverse present; positive volume), so the check is disabled
    return pg.Polyhedron((v, f), rho, normal_orientation=pg.NormalOrientation.OUTWARDS, integrity_check=pg.PolyhedronIntegrity.DISABLE)


def closed(f):
    e = {}
    for a, b, c in f:
        for x, y in ((a, b), (b, c), (c, a)):
            e[(x, y)] = e.get((x, y), 0) + 1
    return all(n == 1 and e.get((y, x)) == 1 for (x, y), n in e.items())


def massprops(v, f):
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    d = np.einsum('ij,ij->i', a, np.cross(b, c))
    V = d.sum() / 6
    cen = ((a + b + c) * d[:, None]).sum(0) / (24 * V)
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum()
    return V, cen, area


def evaluate(P, pts):
    out = pg.evaluate(P, [list(map(float, p)) for p in pts], parallel=True)
    U = [o[0] for o in out]; g = [list(o[1]) for o in out]
    T = [[o[2][0], o[2][3], o[2][4], o[2][1], o[2][5], o[2][2]] for o in out]     # library order xx yy zz xy xz yz -> xx xy xz yy yz zz
    return U, g, T


def sh_quadrature(P, R0, nmax, rq, nlat=24, nlon=48):
    """Normalised Stokes coefficients from the potential sampled on a sphere of radius rq (outside the Brillouin sphere):
    C_nm = (rq/R0)^n (rq / GM) (1/4pi) sum U(rq, lat, lon) Pbar_nm(sin lat) cos(m lon) dOmega, Gauss-Legendre in sin(lat)."""
    x, w = roots_legendre(nlat)
    lon = np.arange(nlon) * 2 * np.pi / nlon
    pts, ww, sl, ll = [], [], [], []
    for xi, wi in zip(x, w):
        cl = math.sqrt(1 - xi * xi)
        for lj in lon:
            pts.append([rq * cl * math.cos(lj), rq * cl * math.sin(lj), rq * xi]); ww.append(wi * 2 * np.pi / nlon); sl.append(xi); ll.append(lj)
    U = np.array([o[0] for o in pg.evaluate(P, pts, parallel=True)])
    ww, sl, ll = np.array(ww), np.array(sl), np.array(ll)
    GM = (U * ww).sum() * rq / (4 * np.pi)
    C, S = {}, {}
    for n in range(nmax + 1):
        for m in range(n + 1):
            N = math.sqrt((1 if m == 0 else 2) * (2 * n + 1) * math.factorial(n - m) / math.factorial(n + m))
            Pnm = lpmv(m, n, sl) * (-1) ** m                      # scipy includes the Condon-Shortley phase; removed
            base = (rq / R0) ** n * rq / GM / (4 * np.pi) / N * (2 * n + 1) / 1.0
            # orthogonality: (1/4pi) int Pbar_nm^2 cos^2 = 1/(2n+1) * ... with Pbar = N P; so C = (2n+1) <U, Pbar cos> / ... :
            # U = GM/rq sum (R0/rq)^n Pbar (C cos + S sin); <Pbar_nm cos, Pbar_nm cos> over the sphere /4pi = 1 (full normalisation)
            Pb = N * Pnm
            C['%d,%d' % (n, m)] = float((rq / R0) ** n * rq / GM * (U * Pb * np.cos(m * ll) * ww).sum() / (4 * np.pi))
            S['%d,%d' % (n, m)] = float((rq / R0) ** n * rq / GM * (U * Pb * np.sin(m * ll) * ww).sum() / (4 * np.pi))
    return GM, C, S


def main():
    sp.furnsh(src('naif0012.tls'))
    out = {'generator': 'oracle/oracle.py', 'libraries': {'polyhedral_gravity': pg.__version__, 'harmonica': hm.__version__, 'spiceypy': sp.__version__, 'cspice': sp.tkvrsn('TOOLKIT')}, 'G': G}
    rng = np.random.default_rng(43)

    # ------------------------------------------------------------------ 1. the shipped shapes, DSK frame, against Tsoulis
    out['field'] = {}
    for key in ('apophis', 'bennu'):
        v, f = shipped(key)
        assert closed(f)
        V, cen, area = massprops(v, f)
        rmax = np.linalg.norm(v, axis=1).max()
        pts = []
        for k in (1.02, 1.5, 2, 4, 10):
            for ax in np.eye(3):
                pts.append(list(ax * k * rmax)); pts.append(list(-ax * k * rmax))
        for _ in range(12):
            d = rng.normal(size=3); d /= np.linalg.norm(d); pts.append(list(d * rmax * rng.uniform(1.0, 3.0)))
        for _ in range(6):
            d = rng.normal(size=3); d /= np.linalg.norm(d); pts.append(list(d * rmax * rng.uniform(0.0, 0.3)))   # inside
        fc = v[f].mean(1)
        for i in range(0, len(f), 211):
            pts.append(list(fc[i]))                                                            # on the surface (plate centroids)
        P = poly(v, f, 1.0 / G)                                                                # G rho = 1
        U, g, T = evaluate(P, pts)
        out['field'][key] = {'frame': 'DSK (no shift)', 'Grho': 1.0, 'volume_m3': V, 'centroid_m': list(cen), 'area_m2': area, 'rmax_m': rmax, 'points': pts, 'U': U, 'g': g, 'H': T}

    # ------------------------------------------------------------------ 2. Bennu: the published 12288-plate DSK against the shipped 3072-plate subsample
    v32, f32 = dsk('bennu_g_12600mm_alt_obj_0000n00000_v021.bds')
    v16, f16 = shipped('bennu')
    V32, c32, a32 = massprops(v32, f32)
    GMp = 4.890450                                                                             # Scheeres et al. 2020 Table 1, particle field
    P32 = poly(v32, f32, GMp / (G * V32)); P16 = poly(v16, f16, GMp / (G * massprops(v16, f16)[0]))
    shell = []
    for k in (1.05, 1.5, 2.0):
        for _ in range(40):
            d = rng.normal(size=3); d /= np.linalg.norm(d); shell.append(list(d * 290.0 * k))
    U32, g32, _ = evaluate(P32, shell); U16, g16, _ = evaluate(P16, shell)
    rel = [float(np.linalg.norm(np.array(a) - np.array(b)) / np.linalg.norm(np.array(a))) for a, b in zip(g32, g16)]
    sh = {}
    for name, (vv, ff) in (('q32', (v32, f32)), ('q16', (v16, f16))):
        Vx = massprops(vv, ff)[0]
        Pq = poly(vv, ff, GMp / (G * Vx))
        GMq, C, S = sh_quadrature(Pq, 290.0, 4, 2.2 * 290.0)
        sh[name] = {'GM': GMq, 'C': C, 'S': S, 'J': [-C['%d,0' % n] for n in range(5)]}
    # surface environment on the full DSK: gravity, the spin, slope, weighted by plate area (Barnouin et al. 2019's quantities)
    sp.furnsh(src('bennu_v17.tpc'))
    t0 = (2458653.5 - 2451545.0) * 86400.0
    pm = [float(x) for x in re.search(r'BODY2101955_PM\s*=\s*\(([^)]*)\)', open(src('bennu_v17.tpc')).read()).group(1).split()]
    wz = (pm[1] + 2 * pm[2] * t0 / 86400.0) * math.pi / 180 / 86400.0
    surf = {}
    for name, (vv, ff) in (('q32', (v32, f32)), ('q16', (v16, f16))):
        Vx = massprops(vv, ff)[0]; Pq = poly(vv, ff, GMp / (G * Vx))
        a, b, c = vv[ff[:, 0]], vv[ff[:, 1]], vv[ff[:, 2]]
        cen = (a + b + c) / 3; nn = np.cross(b - a, c - a); ar = 0.5 * np.linalg.norm(nn, axis=1); nn /= (2 * ar)[:, None]
        res = pg.evaluate(Pq, cen.tolist(), parallel=True)
        g = np.array([r[1] for r in res])
        acc = g + (wz ** 2) * np.c_[cen[:, 0], cen[:, 1], np.zeros(len(cen))]
        am = np.linalg.norm(acc, axis=1)
        slope = np.degrees(np.arccos(np.clip(-(nn * acc).sum(1) / am, -1, 1)))
        def wstat(x):
            o = np.argsort(x); cw = np.cumsum(ar[o]); med = x[o][np.searchsorted(cw, cw[-1] / 2)]
            return {'mean': float((ar * x).sum() / ar.sum()), 'median': float(med), 'min': float(x.min()), 'max': float(x.max())}
        surf[name] = {'plates': int(len(ff)), 'gravity': wstat(np.linalg.norm(g, axis=1)), 'accel': wstat(am), 'slope': wstat(slope), 'normal_accel': wstat(-(nn * acc).sum(1))}
    out['bennu'] = {'GM_particle': GMp, 'q32': {'volume_m3': V32, 'centroid_m': list(c32), 'area_m2': a32, 'plates': int(len(f32)), 'vertices': int(len(np.unique(np.round(v32, 6), axis=0)))},
                    'subsample_g_relative': {'r_1.05x290': [min(rel[:40]), max(rel[:40])], 'r_1.5x290': [min(rel[40:80]), max(rel[40:80])], 'r_2x290': [min(rel[80:]), max(rel[80:])]},
                    'harmonics_dsk_origin_R0_290': sh, 'surface_t0_tdb': t0, 'spin_rad_s': wz, 'surface': surf}

    # ------------------------------------------------------------------ 3. closed form: a uniform rectangular prism (harmonica, Nagy et al. 2000)
    box = [-100.0, 100.0, -50.0, 50.0, -25.0, 25.0]                                            # west east south north bottom top (m)
    rho = 2000.0
    bp = [[0, 0, 300], [250, 120, -40], [-30, 400, 10], [500, -500, 500], [120, 0, 0]]
    coords = (np.array([p[0] for p in bp]), np.array([p[1] for p in bp]), np.array([p[2] for p in bp]))
    pr = {}
    for fld in ('potential', 'g_e', 'g_n', 'g_z'):
        pr[fld] = [float(x) for x in hm.prism_gravity(coords, box, rho, field=fld)]
    # harmonica: potential in J/kg; accelerations in mGal, g_z positive downward (the point above the box shows it)
    out['prism'] = {'box_wesnbt_m': box, 'density': rho, 'points': bp, 'harmonica': pr, 'units': 'potential J/kg; g_e, g_n, g_z mGal (1e-5 m/s^2), g_z downward', 'G_used_by_harmonica': 'harmonica.constants.GRAVITATIONAL_CONST = %r' % hm.constants.GRAVITATIONAL_CONST if hasattr(hm, 'constants') else 'see harmonica'}

    # ------------------------------------------------------------------ 4. attitude: SPICE itself
    att = {'bennu_pxform': []}
    for t in (5.98e8, 6.14174400e8, 6.5e8):
        att['bennu_pxform'].append({'tdb': t, 'C': list(np.array(sp.pxform('J2000', 'IAU_BENNU', t)).ravel())})
    A = js_data(os.path.join(HERE, '..', 'snapshots', 'attitude.js'))['apophis']
    att['apophis_q2m'] = {'q': A['knots'][0][1:5], 'C': list(np.array(sp.q2m(A['knots'][0][1:5])).ravel())}
    # the CK's own samples 1, 5 and 10 days after the shipped knot nearest the chain's stand-off (2028-07-11 06:33 TDB)
    h = sp.dafopr(src('apophis_npa_220101_330101_nominal_pravec_v1.bc')); sp.dafbfs(h); ep, rec = [], []
    while sp.daffna():
        dc, ic = sp.dafus(sp.dafgs(), 2, 6); b, e = int(ic[4]), int(ic[5]); n = int(sp.dafgda(h, e, e)[0])
        rec.append(np.array(sp.dafgda(h, b, b + 7 * n - 1)).reshape(n, 7)); ep.append(np.array(sp.dafgda(h, b + 7 * n, b + 8 * n - 1)) / 1000.0)
    sp.dafcls(h); ep = np.concatenate(ep); rec = np.concatenate(rec)
    kn = [k[0] for k in A['knots']]; tstand = 900182062.6823841
    k0 = min(range(len(kn)), key=lambda i: abs(kn[i] - tstand))
    att['apophis_ck'] = []
    sp.furnsh(src('orx_v15.tf')); sp.furnsh(src('apophis_npa_220101_330101_nominal_pravec_v1.bc'))
    for days in (0, 1, 5, 10, -10):
        j = int(np.argmin(np.abs(ep - (kn[k0] + days * 86400))))
        # SPICE itself, at a sample's own tick (no interpolation): J2000 into APOPHIS_CK, and the angular velocity in J2000
        C, av, clk = sp.ckgpav(-2099942000, float(ep[j] * 1000.0), 0.0, 'J2000')   # the sample's own (fractional) tick
        C = np.array(C)
        att['apophis_ck'].append({'from_knot': k0, 'tdb': float(ep[j]), 'C': list(C.ravel()), 'w_body': list(C @ np.array(av)), 'pxform': list(np.array(sp.pxform('J2000', 'APOPHIS_CK', float(ep[j]))).ravel())})
    out['attitude'] = att

    # ------------------------------------------------------------------ 5. Bennu's equilibria with the independent field and numpy's eigenvalues
    v, f = shipped('bennu'); Vb, cb, _ = massprops(v, f); vc = v - cb                       # centred on the uniform centre of mass, as the kernel
    Pe = poly(vc, f, GMp / (G * Vb)); GMb = GMp
    w2 = wz * wz; rs = (GMb / w2) ** (1 / 3); eqs = []
    for s in range(24):
        th = 2 * math.pi * s / 24; x = np.array([rs * math.cos(th), rs * math.sin(th), 0.0]); ok = False
        for it in range(40):
            U, g, T = pg.evaluate(Pe, list(x), parallel=False)
            H = np.array([[T[0], T[3], T[4]], [T[3], T[1], T[5]], [T[4], T[5], T[2]]])
            F = np.array(g) + w2 * np.array([x[0], x[1], 0.0]); J = H + w2 * np.diag([1, 1, 0])
            dx = np.linalg.solve(J, F); x = x - dx
            if np.linalg.norm(x) > 4 * rs or np.linalg.norm(x) < 0.5 * rs: break        # diverged, or fell to the centre
            if np.linalg.norm(dx) < 1e-9: ok = True; break
        if not ok or any(np.linalg.norm(x - q['x']) < 1 for q in eqs): continue
        U, g, T = pg.evaluate(Pe, list(x), parallel=False)
        H = np.array([[T[0], T[3], T[4]], [T[3], T[1], T[5]], [T[4], T[5], T[2]]]) + w2 * np.diag([1, 1, 0])
        W = np.array([[0, -wz, 0], [wz, 0, 0], [0, 0, 0]])
        M = np.block([[np.zeros((3, 3)), np.eye(3)], [H, -2 * W]])
        lam = np.linalg.eigvals(M)
        eqs.append({'x': x, 'lam': lam})
    out['equilibria'] = {'GM': GMb, 'spin_rad_s': wz, 'points': [{'x': list(q['x']), 'r_m': float(np.linalg.norm(q['x'])), 'lon_deg': float(math.degrees(math.atan2(q['x'][1], q['x'][0]))),
                          'eig_re': [float(z.real) for z in q['lam']], 'eig_im': [float(z.imag) for z in q['lam']], 'max_re': float(max(z.real for z in q['lam']))} for q in eqs]}
    out['equilibria']['points'].sort(key=lambda q: q['lon_deg'])

    path = os.path.join(HERE, 'oracle.json')
    def trim(o):   # 14 significant digits: the tests compare to 1e-10 at best
        if isinstance(o, float): return float('%.14g' % o)
        if isinstance(o, list): return [trim(x) for x in o]
        if isinstance(o, dict): return {k: trim(v) for k, v in o.items()}
        return o
    json.dump(trim(out), open(path, 'w'), separators=(',', ':'))
    print('wrote', path, os.path.getsize(path), 'bytes')
    print('subsample |dg|/|g|:', out['bennu']['subsample_g_relative'])
    print('J q32', sh['q32']['J'], 'J q16', sh['q16']['J'])
    print('surface q32', surf['q32']); print('surface q16', surf['q16'])
    print('equilibria', [(round(q['r_m'], 1), round(q['lon_deg'], 1), round(q['max_re'], 8)) for q in out['equilibria']['points']])


if __name__ == '__main__':
    main()
