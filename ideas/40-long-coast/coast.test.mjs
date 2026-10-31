// Long Coast tests: node --test ideas/40-long-coast/coast.test.mjs (from the bank root). Node built-ins only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K, deps, LongCoast } = require(path.join(here, 'load.cjs'));
const DAY = 86400, AU = deps.constants.au_m;
const T = deps.truth;
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const st = (row) => ({ t: (row[0] - 2451545) * DAY, x: row.slice(1).map((v) => v * 1000) });
const H39 = fs.readFileSync(path.join(here, '..', '39-lamberts-road', 'handoff.json'), 'utf8');
let CHAIN = null;   // the chain's run on idea 39's committed sample, computed once
function chain() { if (!CHAIN) { const src = K.importLambertsRoad(H39); CHAIN = { src, R: K.run(src, K.defaults()) }; } return CHAIN; }

test('Snapshots: every file matches its sidecar; the DE440 constants are the header\'s, converted', () => {
  const dir = path.join(here, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((x) => !x.endsWith('.provenance.json'))) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    assert.ok(side.repo && side.path && side.commit, f);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'), side.writtenSha256, f);
  }
  const D = deps.de440, au = D.raw.AU * 1000, conv = au * au * au / (DAY * DAY);
  assert.equal(D.c_m_s, 299792458);
  for (const [k, g] of [['jupiter', 'GM5'], ['mercury', 'GM1'], ['venus', 'GM2'], ['mars', 'GM4'], ['saturn', 'GM6'], ['uranus', 'GM7'], ['neptune', 'GM8']]) assert.ok(Math.abs(D.gm_m3_s2[k] / (D.raw[g] * conv) - 1) < 1e-14, k);
  assert.ok(Math.abs((D.gm_m3_s2.earth + D.gm_m3_s2.moon) / (D.raw.GMB * conv) - 1) < 1e-14);
  assert.ok(Math.abs(D.gm_m3_s2.earth / D.gm_m3_s2.moon - D.raw.EMRAT) < 1e-9);
  // the Sun's and the Earth's GM are Aster's (the chain's), not DE440's: 1.7e-10 and 1.6e-8 apart
  assert.equal(K.GM.earth, deps.constants.earthMu_m3_s2);
  assert.ok(Math.abs(D.gm_m3_s2.sun / deps.constants.gmSun_m3_s2 - 1) < 3e-10);
  // the stations are the 301 Rev. P Table 2 coordinates; spin radius of DSS-14 is 5203.997 km (the same table's
  // geocentric section gives 5203996.968 m)
  const s14 = deps.nav.stations.list[0].xyz_m;
  assert.ok(Math.abs(Math.hypot(s14[0], s14[1]) - 5203996.968) < 0.5);
});

test('Integrator: fifth order on a closed form, and Kepler to metres over the chain\'s 677 days', () => {
  // y' = y from y(0) = 1 to t = 2: e^2. With fixed steps the error falls 2^5 = 32 when the step halves (measured 29.3
  // from 20 to 40 steps, 30.6 from 40 to 80: a fifth-order method approaching its asymptote).
  const f = (t, y) => [y[0]];
  const err = (n) => { let y = [1], h = 2 / n; for (let i = 0; i < n; i++) y = LongCoast.dopri(f, i * h, y, (i + 1) * h, { rtol: 1, atol: [1e9], nErr: 1, h }).y; return Math.abs(y[0] - Math.exp(2)); };
  const r = err(40) / err(80);
  assert.ok(r > 28 && r < 34, 'order ratio ' + r);
  // the Sun alone, against idea 39's Kepler propagator (its universal-variable closed form)
  const s0 = st(T.bodies['99942'].states['2026-Jul-02']), fm = K.forceModel({ earth: false, moon: false, planets: false, earthJ2: false, relativity: false });
  const p = K.propagate(s0.x, s0.t, s0.t + 677 * DAY, fm), q = deps.LambertsRoad.propagate(s0.x.slice(0, 3), s0.x.slice(3), 677 * DAY, deps.constants.gmSun_m3_s2);
  assert.ok(d3(p.x, q.r) < 10, d3(p.x, q.r));
  assert.ok(d3(p.x.slice(3), q.v) < 1e-5);
});

test('Horizons oracle: six real asteroids, 678 days of n-body against JPL\'s integration', () => {
  // states from JPL Horizons (JPL's own n-body integration with relativity, 16 big asteroids, and for Apophis, Ryugu
  // its Yarkovsky parameters); propagated here from the chain's departure day to its arrival day
  const want = { '99942': 0.6, '101955': 5, '162173': 2.5, '433': 2, '65803': 3, '2000 SG344': 0.6 };
  const fm = K.forceModel(), got = {};
  for (const des of Object.keys(want)) {
    const a = st(T.bodies[des].states['2026-Jul-02']), b = st(T.bodies[des].states['2028-May-10']);
    const p = K.propagate(a.x, a.t, b.t, fm);
    got[des] = d3(p.x, b.x) / 1e3;
    assert.ok(got[des] < want[des], des + ' ' + got[des] + ' km');
  }
  assert.ok(got['99942'] > 0.3, 'Apophis 0.45 km (the gap is JPL\'s Yarkovsky and asteroid perturbers)');
  // the forces matter: without the Moon Apophis is 256 km off, without relativity 37 km, with the Sun alone 39,166 km
  const a = st(T.bodies['99942'].states['2026-Jul-02']), b = st(T.bodies['99942'].states['2028-May-10']);
  const off = (fmo) => d3(K.propagate(a.x, a.t, b.t, K.forceModel(fmo)).x, b.x) / 1e3;
  assert.ok(Math.abs(off({ moon: false }) - 256) < 5);
  assert.ok(Math.abs(off({ relativity: false }) - 36.8) < 2);
  assert.ok(Math.abs(off({ moon: false, planets: false, relativity: false, earthJ2: false }) - 39166) < 50);
});

test('Horizons oracle: Apophis through its 2029 Earth encounter (38,000 km)', () => {
  const A = T.apophis2029.daily, fm = K.forceModel();
  const run = (a, b) => { const s0 = st(A[a]), s1 = st(A[b]); return d3(K.propagate(s0.x, s0.t, s1.t, fm).x, s1.x) / 1e3; };
  assert.ok(run('2029-03-01', '2029-04-01') < 0.1);
  const through = run('2029-03-01', '2029-05-01');
  assert.ok(through > 1 && through < 6, through);   // 3.7 km: the encounter multiplies a 30 m pre-encounter difference
  assert.ok(run('2029-03-01', '2029-07-01') < 30);
  // Horizons' closest approach in its hourly records: 38,411 km on 2029-04-13 22:00 TDB
  let best = Infinity; for (const h of T.apophis2029.hourly) { const s = st(h), E = K.k39.earthState(s.t); best = Math.min(best, d3(s.x, E.r)); }
  assert.ok(Math.abs(best / 1e3 - 38411) < 2);
});

test('The target where it really is: Aster\'s elements integrated n-body against JPL, and two-body as idea 39 had it', () => {
  const fm = K.forceModel();
  const nb = {}, tb = {};
  for (const b of deps.catalog.list) {
    const s = st(T.bodies[b.designation].states['2028-May-10']);
    nb[b.designation] = d3(K.targetState(b, s.t, fm, 'nbody').r, s.x) / 1e3;
    tb[b.designation] = d3(K.targetState(b, s.t, fm, 'two_body').r, s.x) / 1e3;
  }
  for (const k of Object.keys(nb)) { assert.ok(nb[k] < 8, k + ' n-body ' + nb[k]); assert.ok(tb[k] > 7e4, k + ' two-body ' + tb[k]); }
  assert.ok(nb['99942'] < 1 && Math.abs(tb['99942'] - 87222) < 100, nb['99942'] + ' ' + tb['99942']);
});

test('Horizons oracle: a spacecraft (OSIRIS-APEX, JPL\'s predict) needs sunlight; one fitted number carries to another arc', () => {
  const A = T.osirisApex.arcs;
  const walk = (rows, k) => { const fm = K.forceModel({ srp_m2_kg: k, cr: 1 }); let s = st(rows[0]), x = s.x, t = s.t, worst = 0; for (let i = 1; i < rows.length; i++) { const b = st(rows[i]), p = K.propagate(x, t, b.t, fm); x = p.x; t = b.t; worst = Math.max(worst, d3(p.x, b.x)); } return worst / 1e3; };
  // fit Cr A/m on the 2026 arc by golden section
  let lo = 0, hi = 0.05; const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 30; i++) { const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo); if (walk(A.fit, m1) < walk(A.fit, m2)) hi = m2; else lo = m1; }
  const k = (lo + hi) / 2;
  assert.ok(k > 0.012 && k < 0.016, 'Cr A/m ' + k);
  const noSun1 = walk(A.fit, 0), fit1 = walk(A.fit, k), noSun2 = walk(A.check, 0), fit2 = walk(A.check, k);
  assert.ok(noSun1 > 8000 && fit1 < 600, noSun1 + ' ' + fit1);
  assert.ok(noSun2 > 20000 && fit2 < 3000, noSun2 + ' ' + fit2);   // carried to the 2027-28 arc unfitted
  // its residual acceleration is of the order of Lucy's stochastic acceleration (1e-9 m/s^2)
  const days = (A.fit[A.fit.length - 1][0] - A.fit[0][0]), resid = 2 * fit1 * 1e3 / (days * DAY) ** 2;
  assert.ok(resid > 1e-10 && resid < 1e-8, resid);
});

test('Ephemerides: the Moon against hourly Horizons; the Earth\'s series acceleration against the dynamical one', () => {
  const M = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'moon-hourly-excerpt.json'), 'utf8'));
  for (const w of Object.values(M.windows)) {
    let worst = 0;
    for (const r of w.records) worst = Math.max(worst, d3(K.chebPos(K.EPH.moon, (r[0] - 2451545) * DAY), r.slice(1).map((v) => v * 1000)));
    assert.ok(worst < 4500 && worst <= w.maxPos_m + 1, worst);
  }
  // the Chebyshev Earth's own acceleration wiggles ~2e-8 m/s^2 about the Sun-Moon-planets one (why the geocentric
  // frame integrates against the series, not the model)
  const t = 836272869.184, aS = K.accelEarth(t), aM = K.accelEarthModel(t, K.forceModel());
  const dd = d3(aS, aM); assert.ok(dd > 5e-9 && dd < 5e-8, dd);
  assert.ok(d3(aS, [0, 0, 0]) > 5e-3);
});

test('Departure: the synthesised hyperbola leaves along idea 39\'s asymptote; near the Earth the geocentric frame converges', () => {
  const { src } = chain(), R39 = src.R39, opts = K.departureOptions(R39), pc = opts.patched_conic;
  const vinf = K.asymptoteOf(pc.rGeo, pc.vGeo);
  assert.ok(d3(vinf, R39.transfer.sol.vinfDep) < 1e-9 * 715);
  assert.ok(Math.abs(Math.hypot(...pc.rGeo) - deps.constants.parkingRadius_m) < 1e-6);
  assert.ok(Math.abs(pc.hyperbola.inclinationDeg - K.k39.dlaDeg(R39.transfer.sol.vinfDep)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...pc.vGeo) - Math.sqrt(715.0930385598904 ** 2 + 2 * deps.constants.earthMu_m3_s2 / deps.constants.parkingRadius_m)) < 1e-6);
  assert.ok(opts.planned_37 && !opts.flown_38);
  // the departure to arrival at four tolerances agrees to 50 m (the heliocentric form alone scattered 4-19 km)
  const x0 = K.helio(pc), fm = K.forceModel(), ref = K.propagate(x0, pc.tdb, R39.transfer.arrTdb, fm);
  for (const rtol of [1e-11, 1e-13]) assert.ok(d3(K.propagate(x0, pc.tdb, R39.transfer.arrTdb, fm, { rtol }).x, ref.x) < 50);
  // node-by-node (with the STM) and in one go agree
  const nodes = []; for (let t = pc.tdb; t < pc.tdb + 10 * DAY; t += 7200) nodes.push(t); nodes.push(pc.tdb + 10 * DAY);
  assert.ok(d3(K.propagateNodes(x0, nodes, fm).X.at(-1), K.propagate(x0, pc.tdb, pc.tdb + 10 * DAY, fm).x) < 1);
});

test('STM against finite differences, from the periapsis to the arrival (J2 gradient included)', () => {
  const { src } = chain(), pc = K.departureOptions(src.R39).patched_conic, x0 = K.helio(pc), fm = K.forceModel(), t1 = src.R39.transfer.arrTdb;
  const Q = K.propagateNodes(x0, [pc.tdb, t1], fm), Phi = Q.Phi[0];
  for (const j of [0, 3, 4, 5]) {
    const e = j < 3 ? 10 : 0.01, x1 = x0.slice(); x1[j] += e;
    const p = K.propagate(x1, pc.tdb, t1, fm);
    for (const i of [0, 1, 2]) { const fd = (p.x[i] - Q.X[1][i]) / e, an = Phi[i * 6 + j]; assert.ok(Math.abs(fd - an) < 0.02 * Math.abs(an) + 1e-3 * Math.hypot(Phi[j], Phi[6 + j], Phi[12 + j]), `${i},${j} ${fd} ${an}`); }
  }
});

test('Measurements: range, Doppler and Delta-DOR partials against differences; the diurnal Doppler signature (Hamilton-Melbourne)', () => {
  const t = 836272869.184 + 30 * DAY, E = K.k39.earthState(t), x = [E.r[0] + 3e10, E.r[1] - 2e10, E.r[2] + 1e10, E.v[0] + 400, E.v[1] - 300, E.v[2] + 200];
  const st14 = K.STATIONS[0], m0 = K.rangeDoppler(st14, t, x, E);
  for (let j = 0; j < 6; j++) {
    const e = j < 3 ? 100 : 1e-3, x1 = x.slice(); x1[j] += e; const m1 = K.rangeDoppler(st14, t, x1, E);
    assert.ok(Math.abs((m1.range - m0.range) / e - m0.hRange[j]) < 1e-6);
    assert.ok(Math.abs((m1.rangeRate - m0.rangeRate) / e - m0.hDoppler[j]) < 1e-9 + 1e-6 * Math.abs(m0.hDoppler[j]));
  }
  // Delta-DOR measures the geometric delay B.u/c against a quasar: in angle, B.u over the baseline's projection on the
  // plane of the sky, whose partial is that projection's unit vector over the range
  const dd = K.ddor(['DSS-14', 'DSS-43'], t, x, E), A14 = K.stationState(K.STATIONS[0], t), B43 = K.stationState(K.STATIONS[1], t);
  const bl = [B43.r[0] - A14.r[0], B43.r[1] - A14.r[1], B43.r[2] - A14.r[2]];
  const g = (y) => { const r = [y[0] - E.r[0], y[1] - E.r[1], y[2] - E.r[2]], n = Math.hypot(...r); return (bl[0] * r[0] + bl[1] * r[1] + bl[2] * r[2]) / n / dd.baselineProjection_m; };
  for (let j = 0; j < 3; j++) { const x1 = x.slice(); x1[j] += 1000; const x2 = x.slice(); x2[j] -= 1000; assert.ok(Math.abs((g(x1) - g(x2)) / 2000 - dd.h[j]) < 1e-6 * Math.hypot(...dd.h)); }
  // a distant spacecraft: over a day the station's range rate swings by +- omega r_s cos(dec) (Hamilton and Melbourne
  // 1966, as in Thornton and Border section 3.2): 5204.0 km spin radius x 7.292e-5 rad/s x cos(dec)
  const far = [E.r[0] + 1e14, E.r[1] + 2e13, E.r[2] + 5e13, E.v[0], E.v[1], E.v[2]], rho = [1e14, 2e13, 5e13], dec = Math.asin(rho[2] / Math.hypot(...rho));
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 288; k++) { const tt = t + k * 300, Ek = K.k39.earthState(tt), xs = [Ek.r[0] + rho[0], Ek.r[1] + rho[1], Ek.r[2] + rho[2], Ek.v[0], Ek.v[1], Ek.v[2]], rr = K.rangeDoppler(st14, tt, xs, Ek).rangeRate; lo = Math.min(lo, rr); hi = Math.max(hi, rr); }
  const amp = (hi - lo) / 2, want = 2 * Math.PI * (1 + deps.erfa.era.c1) / DAY * Math.hypot(st14.xyz[0], st14.xyz[1]) * Math.cos(dec);
  assert.ok(Math.abs(amp / want - 1) < 1e-3, amp + ' ' + want);
});

test('Kalman, Gates and the delta-v statistics against closed forms', () => {
  // a scalar update is P - P h h^T P / (h P h + s^2)
  const P = LongCoast.meye(6).map((v) => v * 4), Pe = LongCoast.mzero(6), h = [0.6, 0.8, 0, 0, 0, 0];
  K.kalman(P, Pe, h, 1);
  assert.ok(Math.abs(P[0] - (4 - 0.36 * 16 / 5)) < 1e-12 && Math.abs(P[1] + 0.48 * 16 / 5) < 1e-12 && Math.abs(Pe[0] - 0.36 * 16 / 5) < 1e-12);
  // |dv| for dv ~ N(0, s^2 I) is Maxwell: mean 2 s sqrt(2/pi), 99th percentile s sqrt(chi2_3(0.99) = 11.3449)
  const s = 2, S = [s * s, 0, 0, 0, s * s, 0, 0, 0, s * s], ex = K.gatesOf(K.EXEC.lucy);
  const r = K.dvStats([0, 0, 0], S, ex, 20000, LongCoast.rng(1));
  assert.ok(Math.abs(r.mean_m_s / (2 * s * Math.sqrt(2 / Math.PI)) - 1) < 0.01, r.mean_m_s);
  assert.ok(Math.abs(r.p99_m_s / (s * Math.sqrt(11.3449)) - 1) < 0.02, r.p99_m_s);
  // Gates: a spherical preset (sigma_s = sigma_p, sigma_r = sigma_a) gives a spherical execution error (his section III
  // remark), of variance (sigma_r^2 + sigma_s^2 E[V^2] / 3)... per axis: sigma_a^2 (2/3) + sigma_r^2 (1/3) + ...
  const L = r.execCov, tr3 = (L[0] + L[4] + L[8]) / 3;
  for (const i of [0, 4, 8]) assert.ok(Math.abs(L[i] / tr3 - 1) < 0.02);
  const V2 = 3 * s * s, want = (ex.r ** 2 + ex.a ** 2 * 2) / 3 + (ex.s ** 2 * V2 + ex.p ** 2 * 2 * V2) / 3;
  assert.ok(Math.abs(tr3 / want - 1) < 0.02, tr3 + ' ' + want);
  // a deterministic burn along x under EM-1's model: along x, scale factor plus fixed; across, misalignment plus fixed
  const em = K.gatesOf(K.EXEC.em1), r2 = K.dvStats([10, 0, 0], [1e-12, 0, 0, 0, 1e-12, 0, 0, 0, 1e-12], em, 2000, LongCoast.rng(2)).execCov;
  assert.ok(Math.abs(r2[0] - (em.s ** 2 * 100 + em.r ** 2)) < 1e-9 && Math.abs(r2[4] - (em.p ** 2 * 100 + em.a ** 2)) < 1e-9);
});

test('Linear covariance against a nonlinear Monte Carlo: TCM-1 for injection errors, known perfectly', () => {
  // EM-1's injection errors at the chain's re-aimed periapsis; TCM-1 ten days out, solved exactly for each sample by
  // the n-body targeting, against the linear G P G^T the analysis uses (perfect knowledge: P_est = P_true)
  const { R } = chain(), dep = R.departureFlown, x0 = K.helio(dep), fm = K.forceModel(), t1 = R.tcms[0].tdb, tA = R.arrival.tdb, rT = R.arrival.targetR;
  const P0 = K.injectionCov('coveap', { r: dep.rGeo, v: dep.vGeo });
  const p1 = K.propagateNodes(x0, [dep.tdb, t1], fm), A = K.propagateNodes(p1.X[1], [t1, tA], fm), Phi1 = p1.Phi[0], Psi = A.Phi[0];
  const P1 = LongCoast.sandwich(Phi1, P0, 6);
  const Prv = [0, 1, 2].flatMap((i) => [3, 4, 5].map((j) => Psi[i * 6 + j])), Prr = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => Psi[i * 6 + j]));
  const Ainv = LongCoast.mmul(LongCoast.inv3(Prv), Prr, 3, 3, 3), G = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) G.push(j < 3 ? -Ainv[i * 3 + j] : (i === j - 3 ? -1 : 0));
  const Sdv = LongCoast.mmul(LongCoast.mmul(G, P1, 3, 6, 6), LongCoast.mT(G, 3, 6), 3, 6, 3), rmsLin = Math.sqrt(Sdv[0] + Sdv[4] + Sdv[8]);
  // sample: x0 + L z, propagate, aim
  const L6 = []; { const M = P0.slice(); for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++) { let s = M[i * 6 + j]; for (let k = 0; k < j; k++) s -= L6[i * 6 + k] * L6[j * 6 + k]; L6[i * 6 + j] = i === j ? Math.sqrt(Math.max(s, 0)) : s / (L6[j * 6 + j] || 1); } for (let i = 0; i < 36; i++) if (L6[i] === undefined) L6[i] = 0; }
  const rand = LongCoast.rng(7); let ss = 0, n = 0;
  for (let k = 0; k < 40; k++) {
    const z = Array.from({ length: 6 }, () => rand.n()), dx = [0, 1, 2, 3, 4, 5].map((i) => [0, 1, 2, 3, 4, 5].reduce((a, j) => a + L6[i * 6 + j] * z[j], 0));
    const p = K.propagate(x0.map((v, i) => v + dx[i]), dep.tdb, t1, fm), a = K.aim(t1, p.x, tA, rT, fm);
    assert.ok(!a.refusal); ss += a.dv[0] ** 2 + a.dv[1] ** 2 + a.dv[2] ** 2; n++;
  }
  const rmsMc = Math.sqrt(ss / n);
  // 40 samples of a 3-D Gaussian: the RMS is within ~20 % of its value 99 % of the time
  assert.ok(Math.abs(rmsMc / rmsLin - 1) < 0.25, rmsMc + ' ' + rmsLin);
});

test('The chain: idea 39\'s committed sample flown through every force, re-aimed, navigated', () => {
  const { src, R } = chain();
  assert.ok(!src.refusal && src.targetFromCatalog);
  assert.equal(R.departure.key, 'patched_conic');
  // flown as idea 39 handed it the departure misses Apophis by 10.09 million km; TCM-1 ten days out would cost 182.0
  // m/s; re-aimed at the periapsis it costs 3.11 m/s more speed there and moves v-infinity by 168.3 m/s (C3 0.5114 ->
  // 0.5800 km^2/s^2, DLA 43.57 -> 43.29 deg, RLA 9.3 -> 26.6 deg)
  assert.ok(Math.abs(R.uncorrected.missAtArrival_m / 1e9 - 10.094) < 0.01);
  assert.ok(Math.abs(R.tcm1AsGiven.dv_m_s - 182.05) < 0.1);
  assert.ok(Math.abs(R.reaim.periapsisSpeedChange_m_s - 3.109) < 0.01 && Math.abs(R.reaim.dvinf_m_s - 168.33) < 0.1);
  assert.ok(Math.abs(R.reaim.c3 / 1e6 - 0.57996) < 1e-4 && Math.abs(R.reaim.dla - 43.285) < 0.01 && Math.abs(R.reaim.rla - 26.64) < 0.02);
  assert.equal(R.reaim.band, 'AMBER');
  // where Apophis is: 87,301 km from where idea 39's Kepler put it
  assert.ok(Math.abs(R.target.shift_m / 1e3 - 87301) < 5);
  assert.ok(R.reference.missAtArrival_m < 1000);
  // the TCM budget (EM-1 injection errors, Lucy's tracking and execution errors): TCM-1 dominates
  const B = R.budget;
  assert.ok(Math.abs(B.rows[0].p99_m_s - 110.2) < 2, B.rows[0].p99_m_s);
  assert.ok(B.rows.slice(1).every((r) => r.p99_m_s < 5));
  assert.ok(Math.abs(B.totalP99_m_s - 116.6) < 2);
  // delivery: ~18 km (3 sigma) in every direction, set by TCM-5's own execution error over its last 7 days
  assert.ok(R.delivery.dispersion.semiMajor3s_m > 15e3 && R.delivery.dispersion.semiMajor3s_m < 22e3);
  // refusals: ideas 33-39's travel (not 39's `dynamics` or 38's `post_cutoff`, which this lifts), plus this one's
  const fromCodes = R.refusals.map((r) => r.applies_to);
  assert.ok(!fromCodes.includes('dynamics') && !fromCodes.includes('post_cutoff'));
  assert.ok(R.refusals.filter((r) => r.from === '38-burn-out').length === 3 && fromCodes.includes('chain_departure'));
  for (const c of ['srp', 'target_knowledge']) assert.ok(R.refusals.some((r) => !r.from && r.applies_to === c), c);
});

test('Navigation responds as it should: no Delta-DOR widens the delivery; tracking cuts the uncertainty it maps to the arrival', () => {
  const { src, R } = chain();
  const S = K.defaults(); S.nav.ddorPerWeek = 0; const R2 = K.run(src, S, R);
  assert.ok(R2.delivery.dispersion.semiMajor3s_m > 3 * R.delivery.dispersion.semiMajor3s_m);
  const S3 = K.defaults(); S3.nav.passesPerWeek = 0; S3.nav.ddorPerWeek = 0; S3.nav.contDepDays = 0; S3.nav.contArrDays = 0;
  const R3 = K.run(src, S3, R);   // no tracking at all: TCM-1 has no estimate to act on, so the budget is refused
  assert.ok(!R3.budget && R3.refusals.some((r) => r.applies_to === 'tcm_schedule' && /before any tracking datum/.test(r.reason)));
  // the knowledge mapped to the arrival falls as tracking accumulates between TCM-1 and the arrival
  const hs = R.nav.history, k1 = hs.findIndex((h) => h.tdb > R.tcms[0].tdb + DAY), kE = hs.length - 1;
  assert.ok(hs[kE].knowledgeAtArrival_m < hs[k1].knowledgeAtArrival_m / 100);
  // a better injection (EM-1's requirement) costs less at TCM-1; perfect execution delivers far tighter
  const S4 = K.defaults(); S4.injection = 'requirement'; assert.ok(K.run(src, S4, R).budget.rows[0].p99_m_s < R.budget.rows[0].p99_m_s);
  const S5 = K.defaults(); S5.execution = 'none'; assert.ok(K.run(src, S5, R).delivery.dispersion.semiMajor3s_m < R.delivery.dispersion.semiMajor3s_m / 3);
  // the TCM-1 aim (no re-aimed injection) carries 182 m/s deterministic at TCM-1 and still reaches the target
  const S6 = K.defaults(); S6.aim = 'tcm1'; const R6 = K.run(src, S6, R);
  assert.ok(Math.abs(R6.budget.rows[0].deterministic_m_s - 182.05) < 0.1 && R6.reference.missAtArrival_m < 100);
});

test('Chain: idea 38\'s closing departure (its own kernel, 25 t) is flown from its cutoff state; TCM-1 carries its correction', () => {
  const L38 = require(path.join(here, '..', '38-burn-out', 'load.cjs')), L39 = require(path.join(here, '..', '39-lamberts-road', 'load.cjs'));
  const B = L38.B, w = B.importWindow(L38.WIN), set = Object.assign(B.defaults(), { payloadKg: 25000, sweep: false, capability: false });
  const h38 = B.makeHandoff({ window: w }, set, B.compute({ window: w }, set), { produced: '2026-10-31T12:00:00Z' });
  const h39 = L39.K.buildHandoff(L39.K.run(L39.K.defaults(), { chain: L39.K.importBurnOut(h38) }), '2026-10-31T12:00:00Z');
  const src = K.importLambertsRoad(h39);
  assert.ok(!src.refusal);
  const R = K.run(src, K.defaults());
  assert.equal(R.departure.key, 'flown_38');
  assert.equal(R.aim, 'tcm1');
  assert.ok(Math.abs(R.departure.tdb - h38.outputs.hyperbolic_departure_state.value.tdb_s_past_j2000) < 1e-6);
  assert.ok(Math.abs(R.budget.rows[0].deterministic_m_s - 177.8) < 0.5, R.budget.rows[0].deterministic_m_s);
  assert.ok(R.refusals.some((r) => r.applies_to === 'aim'));
});

test('Other bodies: the six presets fly; a body outside the six is taken with idea 39\'s elements', () => {
  const P = require(path.join(here, 'presets.js'));
  assert.equal(P.list.length, 6);
  for (const p of P.list.filter((q) => ['433', '65803', '101955'].includes(q.key))) {
    const src = K.importLambertsRoad(K.lambertsRoadFrom(p.settings)), R = K.run(src, K.defaults());
    assert.ok(R.budget && R.reaim, p.key);
    // Bennu's re-aim moves v-infinity 431 m/s on a 587 m/s cell: flagged as maybe not idea 39's transfer; Eros (41 on
    // 3,710) and Didymos (91 on 1,398) are not
    assert.equal(R.refusals.some((r) => r.applies_to === 'patched_conic'), p.key === '101955', p.key);
  }
  // a path that comes back to the Earth is caught: Apophis's own 2029 pass (Horizons), from outside a million km to 38,000
  const A = T.apophis2029, rows = [A.daily['2029-03-01'], A.daily['2029-04-01']].concat(A.hourly, [A.daily['2029-05-01']]);
  const ER = K.earthReturn(rows.map((r) => (r[0] - 2451545) * DAY), rows.map((r) => r.slice(1).map((v) => v * 1000)));
  assert.ok(ER.leftSphere && ER.ret && ER.ret.distance_m < K.k39.soi_m && Math.abs(ER.minDistance_m / 1e3 - 38411) < 2, JSON.stringify(ER));
  const L39 = require(path.join(here, '..', '39-lamberts-road', 'load.cjs'));
  const S = Object.assign(L39.K.defaults(), { target: '3200', tofMinDays: 150, tofMaxDays: 600, nDep: 30, nTof: 20 });
  const src = K.importLambertsRoad(L39.K.buildHandoff(L39.K.run(S, null), '2026-10-31T12:00:00Z'));
  assert.ok(!src.refusal && src.targetFromCatalog === false);
  // an Apophis handoff whose elements were edited is refused against Aster's values
  const h = JSON.parse(H39); h.outputs.target.value.elements_ecliptic_j2000.e += 1e-6;
  assert.match(K.importLambertsRoad(h).refusal.reason, /not Aster's/);
});

test('Handoff: the committed sample is what the kernel makes; it round-trips; edits are refused; every output is labelled', async () => {
  const { sample } = await import(path.join(here, 'build-sample.mjs'));
  const committed = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  const { handoff } = sample(JSON.parse(H39));
  assert.equal(K.numDiff(committed.outputs, handoff.outputs, 'outputs'), null);
  assert.deepEqual(committed.inputs.lamberts_road_handoff, JSON.parse(H39));
  for (const [k, v] of Object.entries(committed.outputs)) { assert.ok(v.units && v.source, k); assert.ok(['measured', 'derived', 'assumed'].includes(v.confidence), k); }
  const P = K.parseHandoff(JSON.stringify(committed));
  assert.ok(!P.refusal, P.refusal && P.refusal.reason);
  const edit = (f) => { const h = JSON.parse(JSON.stringify(committed)); f(h); return K.parseHandoff(h).refusal; };
  assert.ok(edit((h) => { h.outputs.arrival_state.value.r_m[0] += 1000; }));
  assert.ok(edit((h) => { h.outputs.tcm_budget.value.total_p99_m_s *= 1.001; }));
  assert.ok(edit((h) => { h.outputs.arrival_covariance.value.dispersion_position_sigma_rss_m *= 1.01; }));
  assert.ok(edit((h) => { h.refusals.pop(); }));
  assert.ok(edit((h) => { h.inputs.settings.nav.passesPerWeek = 7; }));
  assert.ok(edit((h) => { h.inputs.lamberts_road_handoff.outputs.transfer.value.time_of_flight_s += 60; }));
  assert.match(K.importLambertsRoad('{').refusal.reason, /JSON/);
  assert.match(K.importLambertsRoad(fs.readFileSync(path.join(here, '..', '38-burn-out', 'handoff.json'), 'utf8')).refusal.reason, /idea 39/);
});

test('Refusals for settings and envelopes: structured, never a number', () => {
  const { src } = chain();
  for (const [k, v] of [['departure', 'x'], ['aim', 'x'], ['target', 'x'], ['injection', 'x'], ['execution', 'x'], ['nodeHours', 5], ['samples', 10]]) {
    const S = K.defaults(); S[k] = v; const R = K.run(src, S); assert.equal(R.refusal.code, 'invalid_input', k);
  }
  const S1 = K.defaults(); S1.force.srp_m2_kg = 1; assert.equal(K.run(src, S1).refusal.code, 'invalid_input');
  const S2 = K.defaults(); S2.tcms = [{ name: 'X', from: 'departure', days: 700 }]; assert.match(K.run(src, S2).refusal.reason, /outside/);
  const S3 = K.defaults(); S3.tcms = [{ name: 'A', from: 'departure', days: 10 }, { name: 'B', from: 'departure', days: 10.01 }]; assert.ok(K.run(src, S3).refusals.some((r) => r.applies_to === 'tcm_schedule'));
  const S4 = K.defaults(); S4.departure = 'flown_38'; assert.ok(K.run(src, S4).refusals.some((r) => r.applies_to === 'departure'));
  const S5 = K.defaults(); S5.tcms = []; const R5 = K.run(src, S5); assert.ok(R5.refusals.some((r) => r.applies_to === 'tcm_schedule'));
  const S6 = K.defaults(); S6.tcms[0].days = 2; assert.ok(K.run(src, S6).refusals.some((r) => r.applies_to === 'tcm_schedule' && /tracking/.test(r.reason)));
});

// ---------------------------------------------------------------- added in the independent review
test('Review: process noise and momentum dumps against free-flight closed forms (q = sigma^2 x batch, Lucy Table 6)', () => {
  // no tracking, no injection error, straight-line motion (Phi = [[I, dt I], [0, I]]): white acceleration noise of PSD q
  // gives a position variance q t^3 / 3 per axis; a dump of sigma_d per axis at t_j adds sigma_d^2 (t - t_j)^2 per axis
  const t0 = 836272800, n = 481, T = [], X = [], Phi = [];
  for (let k = 0; k < n; k++) { T.push(t0 + 7200 * k); const E = K.k39.earthState(T[k]); X.push([E.r[0] + 3e9, E.r[1], E.r[2], E.v[0], E.v[1], E.v[2]]); }
  for (let k = 0; k < n - 1; k++) { const P = LongCoast.meye(6); for (let i = 0; i < 3; i++) P[i * 6 + 3 + i] = 7200; Phi.push(P); }
  const at = (S, day) => K.navigate(T, X, Phi, [], [], S, LongCoast.mzero(6)).history.find((h) => Math.abs(h.tdb - t0 - day * DAY) < 1).knowledge_m;
  const quiet = (sto, dumps) => { const S = K.defaults(); Object.assign(S.nav, { passesPerWeek: 0, ddorPerWeek: 0, contDepDays: 0, contArrDays: 0, stochastic_m_s2: sto, dumps }); return S; };
  const q = 1e-9 * 1e-9 * DAY, t = 30 * DAY;   // Lucy: 1e-12 km/s^2 (1 sigma), white, 1-day batches
  assert.ok(Math.abs(at(quiet(1e-9, false), 30) / Math.sqrt(q * t ** 3) - 1) < 1e-9);
  const sd = 0.0004 / 3; let v = 0; for (let j = 4; j < 30; j += 4) v += 3 * sd * sd * ((30 - j) * DAY) ** 2;   // 0.4 mm/s 3 sigma, every 4 days
  assert.ok(Math.abs(at(quiet(0, true), 30) / Math.sqrt(v) - 1) < 1e-9);
});

test('Review: every Kalman update uses its stated data weight squared; Delta-DOR over the projected baseline', () => {
  const { R } = chain(), S = K.defaults(), dep = R.departureFlown, trace = [], c = K.de440.c_m_s;
  K.navigate(R.reference.T, R.reference.X, R.reference.Phi, R.reference.tcmNodes, R.reference.detDv, S, K.injectionCov(S.injection, { r: dep.rGeo, v: dep.vGeo }), trace);
  const by = (ty) => trace.filter((e) => e.type === ty);
  assert.deepEqual([by('doppler').length, by('range').length, by('ddor').length], [R.nav.counts.doppler, R.nav.counts.range, R.nav.counts.ddor]);
  assert.ok(by('range').every((e) => e.s2 === 100 * 100) && by('doppler').every((e) => e.s2 === 1e-4 * 1e-4));   // Lucy: 100 m, 0.1 mm/s
  for (const e of by('ddor').filter((_, i) => i % 25 === 0)) {   // 0.2 ns of delay over the baseline's plane-of-sky projection
    const t = R.reference.T[e.k], E = K.k39.earthState(t), A = K.stationState(K.STATIONS.find((s) => s.id === e.baseline[0]), t), B = K.stationState(K.STATIONS.find((s) => s.id === e.baseline[1]), t);
    const rho = [0, 1, 2].map((i) => R.reference.X[e.k][i] - E.r[i]), u = rho.map((x) => x / Math.hypot(...rho)), b = [0, 1, 2].map((i) => B.r[i] - A.r[i]), bu = b[0] * u[0] + b[1] * u[1] + b[2] * u[2];
    const bp = Math.hypot(...b.map((x, i) => x - bu * u[i]));
    assert.ok(Math.abs(e.s2 / (0.2e-9 * c / bp) ** 2 - 1) < 1e-9);
  }
});

test('Review: tracking edges stay finite or are refused; a TCM moved on the page exports a handoff that parses', () => {
  const { src, R } = chain();
  const S1 = K.defaults(); Object.assign(S1.nav, { passesPerWeek: 0, ddorPerWeek: 0 });   // was a total of Infinity (and a hung page)
  const R1 = K.run(src, S1, R);
  assert.ok(isFinite(R1.budget.totalP99_m_s) && R1.budget.rows.slice(1).every((r) => r.p99_m_s === 0));
  assert.equal(R1.refusals.filter((r) => r.applies_to === 'tcm_schedule' && /no tracking datum after/.test(r.reason)).length, 4);
  // TCM-2's delta-v covariance in that case, zero up to round-off with negative diagonals: the factor stays finite and tiny
  const Lb = LongCoast.chol3([-1.98e-13, 6.27e-14, -6.39e-14, 6.27e-14, 4.93e-15, -4.62e-14, -6.39e-14, -4.62e-14, 5.17e-14]);
  assert.ok(Lb.every((x) => Number.isFinite(x) && Math.abs(x) < 1e-5), Lb.join(' '));
  // the approach-plane ellipse: its axes' squares sum to 9 (T.P.T + R.P.R) and multiply to 81 det, the along-track is 3 sqrt(S.P.S)
  const A = R.delivery.axes, Pd = R.nav.arrival.dispersion, qq = (u, w) => [0, 1, 2].reduce((s, i) => s + [0, 1, 2].reduce((t, j) => t + u[i] * Pd[i * 6 + j] * w[j], 0), 0), D = R.delivery.dispersion;
  assert.ok(Math.abs((D.semiMajor3s_m ** 2 + D.semiMinor3s_m ** 2) / (9 * (qq(A.T, A.T) + qq(A.R, A.R))) - 1) < 1e-9);
  assert.ok(Math.abs(D.semiMajor3s_m * D.semiMinor3s_m / (9 * Math.sqrt(qq(A.T, A.T) * qq(A.R, A.R) - qq(A.T, A.R) ** 2)) - 1) < 1e-6 && Math.abs(D.along3s_m / (3 * Math.sqrt(qq(A.S, A.S))) - 1) < 1e-9);
  const S2 = K.defaults(); S2.tcms[0].days = 3;   // was TCM-1 at 3e-157 m/s beside a refusal
  assert.ok(!K.run(src, S2, R).budget);
  for (const nav of [{ passesPerWeek: 3, ddorPerWeek: 1, cutoffDays: 14 }, { passesPerWeek: 1, ddorPerWeek: 0, contDepDays: 0, contArrDays: 0, cutoffDays: 14 }, { passesPerWeek: 0, ddorPerWeek: 7, contDepDays: 30, contArrDays: 0, cutoffDays: 14 }]) {
    const S = K.defaults(); Object.assign(S.nav, nav); const Rx = K.run(src, S, R);
    assert.ok(!Rx.budget || [Rx.budget.totalP99_m_s, Rx.delivery.dispersion.semiMajor3s_m].every(Number.isFinite), JSON.stringify(nav));
  }
  // Didymos: the re-aim cached by the page before TCM-1 moved was not the one a fresh run finds, and the export was refused
  const P = require(path.join(here, 'presets.js')).list.find((p) => p.key === '65803'), s65 = K.importLambertsRoad(K.lambertsRoadFrom(P.settings));
  const R0 = K.run(s65, K.defaults()), S3 = K.defaults(); S3.tcms[0].days = 25;
  const P3 = K.parseHandoff(K.buildHandoff(K.run(s65, S3, R0), '2026-10-31T12:00:00Z'));
  assert.ok(!P3.refusal, P3.refusal && P3.refusal.reason);
});

test('Review: the chain against an independent DE440 oracle (jplephem + scipy DOP853, oracle/de440-chain.py)', () => {
  const O = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'de440-chain.json'), 'utf8')), { src, R } = chain(), v39 = src.R39.transfer.sol.vinfDep;
  assert.equal(O.inputs.departure_tdb_s_past_j2000, R.departure.tdb); assert.equal(O.inputs.tcm1_tdb_s_past_j2000, R.tcms[0].tdb); assert.deepEqual(O.inputs.vinf_m_s, v39);
  assert.ok(Math.abs(R.uncorrected.missAtArrival_m / O.uncorrected_miss_m - 1) < 1e-5);   // 10.094 million km, 1.6 km apart
  assert.ok(d3(R.target.nbody.r, O.target_r_m) < 200 && Math.abs(R.target.shift_m - O.target_two_body_shift_m) < 1000);   // 14 m; 87,301 km
  assert.ok(d3(R.tcm1AsGiven.dv, O.tcm1_as_given_dv_m_s) < 1e-3 && d3(R.reaim.vinf, O.reaim_vinf_m_s) < 1e-3);   // both ~5e-5 m/s
  assert.ok(Math.abs(R.reaim.c3 - O.reaim_c3_m2_s2) < 1 && Math.abs(R.reaim.dla - O.reaim_dla_deg) < 1e-4 && Math.abs(R.reaim.rla - O.reaim_rla_deg) < 1e-4);
  assert.ok(Math.abs(R.reaim.periapsisSpeedChange_m_s - O.reaim_periapsis_speed_change_m_s) < 1e-3 && Math.abs(Math.hypot(...R.arrival.vinf) - O.arrival_vinf_m_s) < 0.1);
});
