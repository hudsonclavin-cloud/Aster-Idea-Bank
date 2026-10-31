#!/usr/bin/env python3
"""Oracle for idea 42: the augmented normalised Hill three-body problem (ANH3BP) as AAS 24-063 writes it (eqs. 1-3,
after Scheeres and Marzari 2002), integrated with SciPy's DOP853 in the true anomaly f of the asteroid's elliptic orbit,
in the rotating, pulsating frame A (x from the Sun to the body, z along its orbital angular momentum).

It is a different formulation from the kernel's (Hill's linearised tide in a pulsating rotating frame, against the
kernel's exact solar tide in a non-rotating frame), a different integrator and a different language; on the same
initial states the two should agree to the size of what Hill's problem drops, (distance / Sun distance) ~ 1e-8 of the
tide. Run with numpy and scipy (a throw-away venv); writes anh3bp-oracle.json beside it.
    python3 anh3bp_oracle.py cases.json anh3bp-oracle.json
"""
import json, sys, math
import numpy as np
from scipy.integrate import solve_ivp

def kepler_E(M, e):
    E = M if e < 0.8 else math.pi
    for _ in range(100):
        d = (E - e * math.sin(E) - M) / (1 - e * math.cos(E)); E -= d
        if abs(d) < 1e-15: break
    return E

def run(case, muS, srpK):
    ra = np.array(case['ast_r'], float); va = np.array(case['ast_v'], float)
    h = np.cross(ra, va); hn = np.linalg.norm(h); zh = h / hn
    evec = np.cross(va, h) / muS - ra / np.linalg.norm(ra); e = np.linalg.norm(evec)
    p = hn * hn / muS; a = p / (1 - e * e); n = math.sqrt(muS / a ** 3)
    xp = evec / e; yp = np.cross(zh, xp)
    f0 = math.atan2(np.dot(ra, yp), np.dot(ra, xp))
    E0 = 2 * math.atan(math.sqrt((1 - e) / (1 + e)) * math.tan(f0 / 2)); M0 = E0 - e * math.sin(E0)
    M1 = M0 + n * (case['t1'] - case['t0']); E1 = kepler_E(M1, e)
    f1 = 2 * math.atan2(math.sqrt(1 + e) * math.sin(E1 / 2), math.sqrt(1 - e) * math.cos(E1 / 2))
    while f1 < f0: f1 += 2 * math.pi
    mu = case['mu']; eps = (mu / muS) ** (1 / 3)
    beta = srpK * case['cr'] * case['am'] / (muS * eps)            # beta~ = G1 / (B muS eps), G1 = srpK cr, B = 1/(A/m)
    def axes(f):
        dh = math.cos(f) * xp + math.sin(f) * yp
        return dh, np.cross(zh, dh), zh
    def dist(f): return p / (1 + e * math.cos(f))
    def Omega(f): return math.sqrt(muS * p) / dist(f) ** 2
    def dprime(f): return dist(f) ** 2 * e * math.sin(f) / p     # eq. (1c)
    # initial state in A, scaled (eqs. 3a-3b)
    X, Y, Z = axes(f0); R0 = np.array(case['rho0'], float); V0 = np.array(case['v0'], float)
    w = Omega(f0) * Z
    Rdot = V0 - np.cross(w, R0)                                     # velocity seen in the rotating frame
    RA = np.array([R0 @ X, R0 @ Y, R0 @ Z]); RdA = np.array([Rdot @ X, Rdot @ Y, Rdot @ Z])
    d0 = dist(f0); r0 = RA / (eps * d0); rp0 = (RdA / (eps * Omega(f0)) - dprime(f0) * r0) / d0
    def rhs(f, s):
        r = s[:3]; rp = s[3:]; rn = np.linalg.norm(r); k = 1 / (1 + e * math.cos(f))
        zx = np.array([-rp[1], rp[0], 0.0])                         # z-hat x r'
        acc = -2 * zx - np.array([0, 0, r[2]]) + k * (-r / rn ** 3 + np.array([beta + 3 * r[0], 0, 0]))
        return np.concatenate([rp, acc])
    sol = solve_ivp(rhs, (f0, f1), np.concatenate([r0, rp0]), method='DOP853', rtol=1e-13, atol=1e-15)
    r1 = sol.y[:3, -1]; X1, Y1, Z1 = axes(f1); R1 = eps * dist(f1) * (r1[0] * X1 + r1[1] * Y1 + r1[2] * Z1)
    return {'name': case['name'], 'rho1_m': R1.tolist(), 'f0': f0, 'f1': f1, 'beta': beta, 'du_m_at_t0': eps * d0, 'steps': int(sol.t.size)}

def main():
    src, dst = sys.argv[1], sys.argv[2]
    C = json.load(open(src))
    out = [run(c, C['muSun'], C['srpK']) for c in C['cases']]
    import scipy
    json.dump({'oracle': 'ANH3BP, AAS 24-063 eqs. (1)-(3) (Scheeres and Marzari 2002), scipy ' + scipy.__version__ + ' DOP853 rtol 1e-13', 'results': out}, open(dst, 'w'), indent=1)
    for o in out: print(o['name'], ['%.3f' % x for x in o['rho1_m']], 'beta %.4f' % o['beta'], 'steps', o['steps'])

if __name__ == '__main__':
    main()
