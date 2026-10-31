// Tests for idea 39, Lambert's Road. Run from the bank root: node --test ideas/39-lamberts-road/lambert.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { K, C, EARTH, BODIES, REFS, LambertsRoad: L } = require(path.join(here, 'load.cjs'));
const req = (f) => require(path.join(here, f));
const DAY = 86400, DEG = Math.PI / 180;
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const rel = (a, b) => norm(sub(a, b)) / norm(b);
const km = (v) => v.map((x) => x * 1000);
function stats(a) { const s = a.slice().sort((x, y) => x - y); return { n: s.length, med: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] }; }

test('snapshots: every file matches its sidecar, and the constants are the verbatim Aster files\' own', () => {
  const dir = path.join(here, 'snapshots');
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.provenance.json')) continue;
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    assert.ok(side.repo && side.path && side.commit, f + ' sidecar keys');
    if (side.writtenSha256) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'), side.writtenSha256, f);
    n++;
  }
  assert.ok(n >= 14);
  const kep = fs.readFileSync(path.join(dir, 'aster-keplerian.ts.txt'), 'utf8'), dv = fs.readFileSync(path.join(dir, 'aster-delta-v.ts.txt'), 'utf8');
  assert.match(kep, /GM_SUN_M3_S2 = 1\.32712440018e20;/);
  assert.equal(C.gmSun_m3_s2, 1.32712440018e20);
  assert.match(dv, /EARTH_MU_KM3_PER_S2 = 398_600\.4418;/);
  assert.equal(C.earthMu_m3_s2, 398600.4418e9);
  assert.equal(C.parkingRadius_m, 6578137);
  assert.equal(C.obliquity_arcsec, 84381.448);
  assert.equal(C.tdbMinusUtc_s, 69.184);
  assert.deepEqual([C.sites.cape.iMinDeg, C.sites.cape.dlaCeilingDeg, C.sites.vandenberg.iMinDeg, C.sites.vandenberg.dlaCeilingDeg], [28.5, 57, 70, 90]);
  assert.equal(C.encounterAu, 0.05);
  // Aster's own UTC -> TDB (utc-to-tdb.ts): seconds since J2000 = unix seconds - 946728000 + 69.184
  assert.equal(K.parseUtc('2026-01-01'), Date.UTC(2026, 0, 1) / 1000 - 946728000 + 69.184);
});

test('Lambert: Aster\'s pinned cells (M = 0, 1, 2, both branches) to 1e-12, and T_min(M = 2) as Aster\'s spec states it', () => {
  const P = req('snapshots/aster-lambert-pinned-cells.json');
  let n = 0;
  for (const c of P.cells) {
    const r = L.lambert(km(c.r1Km), km(c.r2Km), c.tofSeconds, c.muKm3S2 * 1e9, { revs: [c.M] });
    if (!c.expected || !c.expected.ok) {
      assert.equal(r.sols.length, 0, c.id + ': no solution below T_min');
      const spec = fs.readFileSync(path.join(here, 'snapshots/aster-lambert-pinned-cells.spec.md'), 'utf8');
      const tmin = Number(/dimensional `T_min\(M=2\)` \(([\d.]+) s\)/.exec(spec)[1]);
      assert.ok(Math.abs(r.tmin[2] - tmin) / tmin < 1e-12, 'T_min ' + r.tmin[2] + ' vs ' + tmin);
      assert.ok(c.tofSeconds < r.tmin[2]);
      continue;
    }
    for (const b of c.expected.branches) {
      const s = r.sols.find((q) => q.branch === b.branch);
      assert.ok(s && s.converged, c.id + ' ' + b.branch);
      assert.ok(Math.abs(s.x - b.x) < 1e-12, c.id + ' x');
      assert.ok(rel(s.v1, km(b.v1Kmps)) < 1e-12 && rel(s.v2, km(b.v2Kmps)) < 1e-12, c.id + ' ' + b.branch + ' velocities');
      n++;
    }
    if (c.poliastroCheck) { const s = r.sols.find((q) => q.branch === c.expected.selectedBranch); assert.ok(rel(s.v1, km(c.poliastroCheck.v1Kmps)) < 1e-12, c.id + ' vs poliastro'); }
  }
  assert.equal(n, 5);
});

test('Lambert: 75 cases against hapsira (Izzo) and lamberthub (Gooding 1990), across all three forms of T(x)', () => {
  const O = req('oracle/lambert-oracle.json');
  const region = { battin: 0, lagrange: 0, lancaster: 0, hyperbolic: 0, multi: 0 };
  let worstH = 0, worstG = 0;
  for (const c of O.cases) {
    const r = L.lambert(c.r1, c.r2, c.tof, O.mu_m3_s2, { revs: [c.M] });
    const s = r.sols.find((q) => q.branch === (c.M === 0 ? 'single' : c.lowpath ? 'right' : 'left'));
    assert.ok(s && s.converged, c.id + ' converged');
    for (const [lib, key] of [['hapsira', 'H'], ['gooding', 'G']]) {
      const ref = c.res[lib];
      assert.ok(!ref.error, c.id + ' ' + lib + ' solved');
      const e = Math.max(rel(s.v1, ref.v1), rel(s.v2, ref.v2));
      assert.ok(e < 1e-11, c.id + ' vs ' + lib + ': ' + e);
      if (key === 'H') worstH = Math.max(worstH, e); else worstG = Math.max(worstG, e);
    }
    const d = Math.abs(s.x - 1);
    if (c.M > 0) region.multi++; else if (s.x > 1.2) region.hyperbolic++; else if (d < 0.01) region.battin++; else if (d < 0.2) region.lagrange++; else region.lancaster++;
  }
  assert.equal(O.cases.length, 75);
  assert.ok(region.battin >= 3 && region.lagrange >= 10 && region.hyperbolic >= 5 && region.multi >= 20 && region.lancaster >= 20, JSON.stringify(region));
  assert.ok(worstH < 1e-12 && worstG < 1e-12, worstH + ' ' + worstG);
});

test('Lambert closed forms: Kepler round trip, Lambert\'s minimum-energy ellipse, the parabolic divide, a Hohmann half-orbit', () => {
  const mu = C.gmSun_m3_s2, AU = C.au_m;
  // (1) a solution coasted by an independent propagator (Kepler in delta-E) for the flight time arrives at r2
  const O = req('oracle/lambert-oracle.json');
  for (const c of O.cases.filter((q, i) => i % 7 === 0)) {
    const r = L.lambert(c.r1, c.r2, c.tof, mu, { revs: [c.M] }), s = r.sols.find((q) => q.branch === (c.M === 0 ? 'single' : c.lowpath ? 'right' : 'left'));
    const p = L.propagate(c.r1, s.v1, c.tof, mu);
    if (!p) continue;   // hyperbolic about the Sun: the elliptic propagator refuses
    assert.ok(rel(p.r, c.r2) < 1e-9 && rel(p.v, s.v2) < 1e-9, c.id + ' round trip ' + rel(p.r, c.r2));
  }
  // (2) Lambert's theorem: the minimum-energy transfer has a = s/2 and takes t_m = sqrt(a^3/mu)(pi - beta + sin beta),
  // sin(beta/2) = sqrt((s - c)/s), for a transfer angle under 180 deg; Izzo's x is 0 there.
  const r1 = [AU, 0, 0], r2 = [1.3 * AU * Math.cos(2), 1.3 * AU * Math.sin(2), 0.05 * AU];
  const c = norm(sub(r2, r1)), s = (norm(r1) + norm(r2) + c) / 2, am = s / 2, beta = 2 * Math.asin(Math.sqrt((s - c) / s));
  const tm = Math.sqrt(am ** 3 / mu) * (Math.PI - beta + Math.sin(beta));
  const q = L.lambert(r1, r2, tm, mu).sols[0], el = L.elementsOf(r1, q.v1, mu);
  assert.ok(Math.abs(q.x) < 1e-12, 'x ' + q.x);
  assert.ok(Math.abs(el.a - am) / am < 1e-12, 'a ' + el.a + ' vs ' + am);
  // (3) the parabolic divide (Euler/Lambert): t_p = sqrt(2/mu)/3 (s^1.5 - (s - c)^1.5); slower is an ellipse, faster a hyperbola
  const tp = Math.sqrt(2 / mu) / 3 * (s ** 1.5 - (s - c) ** 1.5);
  const slow = L.elementsOf(r1, L.lambert(r1, r2, tp * 1.001, mu).sols[0].v1, mu), fast = L.elementsOf(r1, L.lambert(r1, r2, tp * 0.999, mu).sols[0].v1, mu);
  assert.ok(slow.a > 0 && fast.a < 0 && Math.abs(1 / slow.a) < 1e-2 / AU && Math.abs(1 / fast.a) < 1e-2 / AU && Math.abs(slow.e - 1) < 0.003 && Math.abs(fast.e - 1) < 0.003, slow.a / AU + ' ' + fast.a / AU);   // measured +326 and -325 au, e 1 -+ 0.0027
  // (4) Hohmann: 1 au to 1.5 au, half the transfer ellipse's period, 0.001 deg short of 180 (the plane must exist):
  // the departure speed is sqrt(mu/r1) sqrt(2 r2 / (r1 + r2)) (vis-viva at perihelion)
  const ra = 1.5 * AU, th = Math.PI - 1e-5, at = (AU + ra) / 2;
  const H = L.lambert([AU, 0, 0], [ra * Math.cos(th), ra * Math.sin(th), 0], Math.PI * Math.sqrt(at ** 3 / mu), mu).sols[0];
  const vh = Math.sqrt(mu / AU) * Math.sqrt(2 * ra / (AU + ra));
  assert.ok(Math.abs(norm(H.v1) - vh) / vh < 1e-6, norm(H.v1) + ' vs ' + vh);
  // (5) T_min: dT/dx = 0 there, and one second less has no solution, one more has two
  const T = L.tMin(1, 0.3), d = (L.x2tof(T.x + 1e-6, 1, 0.3) - L.x2tof(T.x - 1e-6, 1, 0.3)) / 2e-6;
  assert.ok(Math.abs(d) < 1e-6, 'dT/dx at T_min ' + d);
  const geo = L.lambert(r1, r2, 400 * DAY, mu, { revs: [1] });
  assert.equal(L.lambert(r1, r2, geo.tmin[1] * (1 - 1e-6), mu, { revs: [1] }).sols.length, 0);
  assert.equal(L.lambert(r1, r2, geo.tmin[1] * (1 + 1e-4), mu, { revs: [1] }).sols.filter((z) => z.converged).length, 2);
  // (6) degenerate geometry is refused, not solved
  assert.equal(L.lambert(r1, [2 * AU, 0, 0], 100 * DAY, mu).refusal.code, 'out_of_envelope');
  assert.equal(L.lambert(r1, r2, -5, mu).refusal.code, 'invalid_input');
});

test('Earth: the Chebyshev fit against Horizons between the daily records, and Aster\'s own daily Hermite (the C0 question)', () => {
  const H = req('snapshots/horizons-earth-9h.js');
  const herm = K.hermiteEphemeris(H.asterDaily);
  let cp = 0, cv = 0, hp = 0, hv = 0;
  for (const r of H.records) {
    const t = (r[0] - 2451545) * DAY, a = K.earthState(t), b = herm(t);
    cp = Math.max(cp, norm(sub(a.r, km(r.slice(1, 4))))); cv = Math.max(cv, norm(sub(a.v, km(r.slice(4, 7)))));
    hp = Math.max(hp, norm(sub(b.r, km(r.slice(1, 4))))); hv = Math.max(hv, norm(sub(b.v, km(r.slice(4, 7)))));
  }
  // at whole days the fetched records are Aster's exactly
  for (const r of H.asterDaily) { const f = H.records.find((q) => q[0] === r[0]); if (f) assert.deepEqual(f, r); }
  assert.equal(H.records.length, 81);
  // measured at these 81 epochs: Chebyshev 17.8 m and 1.12 mm/s; Aster's daily Hermite 87.8 m and 3.14 mm/s
  assert.ok(cp < 25 && cv < 1.3e-3, 'cheb ' + cp + ' m ' + cv + ' m/s');
  assert.ok(hp > 80 && hp < 95 && hv > 3.0e-3 && hv < 3.3e-3, 'hermite ' + hp + ' m ' + hv + ' m/s');
  // the fit is 9,786 numbers for 15 years, against Aster's 32,874; its worst residual at any daily record is recorded
  assert.equal(EARTH.fit.numbers, 9786);
  assert.equal(EARTH.fit.hermiteNumbers, 32874);
  assert.ok(EARTH.fit.maxPos_km < 0.5 && EARTH.fit.maxVel_m_s < 0.0015);
  // outside the span: no state, and the cell refuses
  assert.equal(K.earthState(K.parseUtc('2041-01-02')), null);
  assert.equal(K.cell(K.findBody('99942'), K.parseUtc('2041-01-02'), 300 * DAY).refusal.applies_to, 'departure_date');
});

test('Asteroid: Aster\'s anchor states reproduced at the element epoch; two-body against JPL\'s integration (the reality gap)', () => {
  let worst = 0;
  for (const b of BODIES.list) {
    const s = K.bodyState(b, K.jdTdbToTdb(b.anchor.epochTdbJd));
    worst = Math.max(worst, norm(sub(s.r, km(b.anchor.positionKm))));
    assert.ok(norm(sub(s.v, km(b.anchor.velocityKmPerS))) < 1e-6, b.designation);
  }
  assert.ok(worst < 0.05, 'anchor position ' + worst + ' m');   // measured 5.9 mm: the ecliptic->ICRF rotation and Kepler are Aster's
  const D = req('snapshots/drift-truth.js');
  const gap = (des, jd) => { const T = D.bodies.find((q) => q.designation === des), r = T.records.find((q) => Math.abs(q[0] - jd) < 1e-6); return norm(sub(K.bodyState(K.findBody(des), (jd - 2451545) * DAY).r, km(r.slice(1, 4)))) / 1000; };
  // Apophis near the chain's arrival (2028-05-10): the nearest JPL record kept is JD 2461881.5 (2028-04-20)
  const before = gap('99942', 2461881.5), after = gap('99942', 2462259.5), eros = gap('433', 2463407.5);
  assert.ok(Math.abs(before - 93012) < 5, 'Apophis 2028-04-20 two-body off by ' + before + ' km');     // measured 93,012 km
  assert.ok(after > 4e6, 'Apophis 2029-05-03, after the encounter: ' + after + ' km');                  // measured 4.43 million km
  assert.ok(Math.abs(eros - 101775) < 5, 'Eros 2032-06-23: ' + eros + ' km');                            // measured 101,775 km
  // five days after the element epoch the two agree to 6 km (the same Horizons state, before the perturbations act)
  assert.ok(gap('99942', 2461167.5) < 10);
  // JPL's encounter (drift-truth closeApproaches, from the CAD API): 2029-04-13 at 38,011 km; two-body finds it 3 h later at 42,639 km
  const ap = D.bodies.find((q) => q.designation === '99942').closeApproaches[0];
  const e = K.encounters(K.findBody('99942'), K.parseUtc('2026-05-01'), K.parseUtc('2030-01-01'));
  assert.equal(e.length, 1);
  assert.ok(Math.abs(e[0].t - (ap.jdTdb - 2451545) * DAY) < 6 * 3600, 'encounter time');
  assert.ok(e[0].distance_m / 1000 > ap.distKm && e[0].distance_m / 1000 < 50000, 'two-body ' + e[0].distance_m / 1000 + ' km vs JPL ' + ap.distKm);
});

test('Aster\'s DLA cell, the chain\'s asymptote: reproduced to 1e-12 with Aster\'s Earth, to 0.2 mm/s with this page\'s', () => {
  const rc = REFS.cells[0], b = K.findBody(rc.designation);
  assert.equal(K.utcOf(rc.depTdb), '2026-07-02T14:00:00.000Z');
  const viaAster = K.cell(b, rc.depTdb, rc.tofDays * DAY, { revs: [1], earth: K.hermiteEphemeris(REFS.earthRecords) }).sols.find((q) => q.branch === 'left');
  const viaPage = K.cell(b, rc.depTdb, rc.tofDays * DAY, { revs: [1] }).sols.find((q) => q.branch === 'left');
  assert.ok(norm(sub(viaAster.vinfDep, rc.vinfDep_m_s)) < 1e-8, 'Aster Earth: ' + norm(sub(viaAster.vinfDep, rc.vinfDep_m_s)));   // measured 2.5e-10 m/s
  assert.ok(Math.abs(viaAster.dlaDeg - rc.dlaDeg) < 1e-9);
  assert.ok(norm(sub(viaAster.vinfDep, rc.poliastroVinfDep_m_s)) < 1e-8, 'vs poliastro');
  const dp = norm(sub(viaPage.vinfDep, rc.vinfDep_m_s));
  assert.ok(dp > 1e-5 && dp < 2e-4, 'page Earth: ' + dp);   // measured 0.116 mm/s
  assert.ok(Math.abs(viaPage.c3 / 1e6 - 0.51136) < 1e-4 && viaPage.band === 'AMBER');
});

test('Aster\'s screening cache: the best M = 0 window of all 61 bodies reproduced to a millimetre per second', () => {
  let n = 0, wd = 0, wa = 0;
  for (const b of BODIES.list) {
    const w = b.cache && b.cache.best;
    if (!w) continue;
    const q = K.cell(b, K.parseUtc(w.launchDate), w.tofDays * DAY, { revs: [0] }).sols[0];
    wd = Math.max(wd, Math.abs(q.vInfDep - w.vInfDep * 1000)); wa = Math.max(wa, Math.abs(q.vInfArr - w.vInfArr * 1000));
    n++;
  }
  assert.equal(n, 61);
  assert.ok(wd < 1e-3 && wa < 1e-4, wd + ' ' + wa);   // measured 0.88 and 0.056 mm/s: the Earth interpolation, nothing else
});

test('JPL\'s own mission-design maps (independent ephemerides, orbit solutions and solver): the gap, and where it explodes', () => {
  const J = req('snapshots/jpl-mdesign.js');
  const out = {};
  for (const [key, des] of [['apophis', '99942'], ['bennu', '101955']]) {
    const b = K.findBody(des), dv = [], dla = [], post = [];
    let refused = 0;
    for (const [mjd, tof, vd, va, dec] of J[key].sample) {
      const t = (mjd + 2400000.5 - 2451545) * DAY, c = K.cell(b, t, tof * DAY, { revs: [0, 1, 2, 3] }), q = c.sols[c.best];
      if (key === 'apophis' && mjd + tof >= 62239) {     // arrival after Apophis's 2029-04-13 encounter (MJD 62239)
        post.push(Math.abs(q.vInfDep / 1000 - vd));
        if (K.targetRefusals(b, t, t + tof * DAY).some((r) => r.applies_to === 'target_ephemeris' || r.applies_to === 'arrival_geometry')) refused++;
        continue;
      }
      const th = ((c.theta / DEG) % 180 + 180) % 180;
      if (Math.min(th, 180 - th) < 10) continue;          // the 0/180-deg ridge, where the plane is ill-set
      dv.push(Math.abs(q.vInfDep / 1000 - vd) * 1000); dla.push(Math.abs(q.dlaDeg - dec));
    }
    out[key] = { dv: stats(dv), dla: stats(dla), post: post.length ? stats(post) : null, refused };
  }
  const A = out.apophis, B = out.bennu;
  assert.equal(A.dv.n, 140); assert.equal(B.dv.n, 138);
  assert.ok(A.dv.med > 1 && A.dv.med < 3 && A.dv.p90 < 8, JSON.stringify(A.dv));       // measured median 1.86, p90 6.0 m/s
  assert.ok(A.dla.med < 0.02 && A.dla.p90 < 0.1, JSON.stringify(A.dla));              // 0.011 and 0.063 deg
  assert.ok(B.dv.med > 4 && B.dv.med < 9 && B.dv.p90 < 30, JSON.stringify(B.dv));       // 6.5 and 23 m/s (JPL used Bennu orbit 97, Aster's is later)
  assert.equal(A.post.n, 60); assert.equal(A.refused, 60);                              // every post-encounter cell is refused here...
  assert.ok(A.post.med > 3, 'post-encounter median ' + A.post.med + ' km/s');          // ...and is off by 6.0 km/s (median) from JPL's
});

test('Encounters flag the porkchop: Apophis\'s raw minimum is the 2029 flyby, the reliable one is not', () => {
  const R = K.run(K.defaults(), null), g = R.grid;
  assert.equal(g.encounters.length, 1);
  assert.ok(g.flagged > 500, 'flagged ' + g.flagged);
  const arr = (p) => p.depTdb + p.tofS;
  assert.ok(Math.abs(arr(g.rawMin) - g.encounters[0].t) < 2 * DAY, 'raw minimum arrives at the encounter');
  assert.ok(g.rawMin.c3 < 0.002e6 && g.min.c3 > 0.05e6, g.rawMin.c3 + ' ' + g.min.c3);
  assert.ok(arr(g.min) < g.encounters[0].t);
  const k = g.rawMin.j * g.nDep + g.rawMin.i;
  assert.equal(g.unreliable[k], 1);
  // the soi used: Laplace, a (mu_E/mu_S)^0.4 at 1 au
  assert.ok(Math.abs(K.soi_m - C.au_m * Math.pow(398600.4418 / 1.32712440018e11, 0.4)) < 1);
  // selecting the raw minimum is refused for the encounter
  const S = Object.assign(K.defaults(), { selection: { depTdb: g.rawMin.depTdb, tofS: g.rawMin.tofS, M: 1, branch: 'left' } });
  const R2 = K.run(S, null, { grid: false });
  assert.ok(R2.refusals.some((r) => r.applies_to === 'target_ephemeris' || r.applies_to === 'arrival_geometry'));
});

test('Aster\'s delta-v stack and DLA band, and the near-180-deg refusal', () => {
  const c3 = 0.5114e6, mu = 398600.4418e9, r = 6578137;
  assert.ok(Math.abs(K.injectionDv(c3) - (Math.sqrt(c3 + 2 * mu / r) - Math.sqrt(mu / r))) < 1e-9);
  const s = K.dvStack(c3, 4209);
  assert.ok(Math.abs(s.total_oneway_m_s - (K.injectionDv(c3) + 4209 + 150) * 1.1) < 1e-9);
  assert.ok(Math.abs(s.total_return_m_s - (K.injectionDv(c3) + 2 * 4209 + 150) * 1.1) < 1e-9);
  assert.deepEqual([K.band(28.5), K.band(28.6), K.band(-57), K.band(57.1), K.band(80, 'vandenberg'), K.band(null)], ['GREEN', 'AMBER', 'AMBER', 'RED', 'AMBER', null]);
  assert.equal(K.dlaDeg([0.5, 0, 0]), null);   // below Aster's 1 m/s guard
  assert.ok(Math.abs(K.dlaDeg([1000, 0, 1000]) - 45) < 1e-12);
  // a transfer within 5 deg of 180 is refused as plane-sensitive
  const b = K.findBody('99942'), g = K.run(Object.assign(K.defaults(), { nDep: 60, nTof: 40 }), null).grid;
  let found = null;
  for (let k = 0; k < g.val.length && !found; k++) {
    if (!(g.fam[k] === 0)) continue;
    const c = K.cell(b, g.deps[k % g.nDep], g.tofs[Math.floor(k / g.nDep)], { revs: [0] });
    if (Math.abs(c.theta / DEG - 180) < 3) found = { depTdb: g.deps[k % g.nDep], tofS: g.tofs[Math.floor(k / g.nDep)], M: 0, branch: 'single' };
  }
  assert.ok(found, 'a near-180 cell exists in the default window');
  const R = K.run(Object.assign(K.defaults(), { selection: found }), null, { grid: false });
  assert.ok(R.refusals.some((q) => q.applies_to === 'transfer_plane'));
});

test('refine: Nelder-Mead lands on a local minimum (one day either way costs more)', () => {
  const b = K.findBody('101955'), S = Object.assign(K.defaults(), { target: '101955', depStartUtc: '2026-01-01', depEndUtc: '2027-01-01', tofMinDays: 150, tofMaxDays: 700, revs: [0] });
  const R = K.run(S, null), g = R.grid, f = K.famOf(g.min.fam);
  const bounds = { depStart: g.deps[0], depEnd: g.deps[g.nDep - 1], tofMin: g.tofs[0], tofMax: g.tofs[g.nTof - 1] };
  const m = K.refine(b, { depTdb: g.min.depTdb, tofS: g.min.tofS, M: f.M, branch: f.branch }, 'c3', bounds);
  assert.ok(m.value <= g.min.value + 1e-6, m.value + ' vs grid ' + g.min.value);
  const at = (d, t) => K.cell(b, d, t, { revs: [0] }).sols[0].c3;
  if (!m.onEdge) for (const [dd, dt] of [[DAY, 0], [-DAY, 0], [0, DAY], [0, -DAY]]) assert.ok(at(m.depTdb + dd, m.tofS + dt) >= m.value - 1e-6);
});

test('Chain: idea 38\'s committed sample (a stage that cannot depart) imports; its refusals travel; the transfer is Aster\'s cell', () => {
  const h38 = JSON.parse(fs.readFileSync(path.join(here, '..', '38-burn-out', 'handoff.json'), 'utf8'));
  const ch = K.importBurnOut(h38);
  assert.ok(!ch.refusal && ch.cellRef && !ch.departure);
  const R = K.run(K.defaults(), { chain: ch });
  assert.equal(R.selection.source, 'aster_cell');
  assert.ok(R.refusals.filter((r) => r.from === '38-burn-out').length >= 4);
  assert.ok(R.refusals.some((r) => r.from === '33-engine-deck') && R.refusals.some((r) => r.from === '37-window'));
  assert.ok(R.refusals.some((r) => r.applies_to === 'chain_departure' && !r.from));
  // what is refused: another module's handoff, garbage, an edited v-infinity or a moved epoch
  assert.equal(K.importBurnOut('{nope').refusal.code, 'invalid_input');
  assert.match(K.importBurnOut(h38.inputs.window_handoff).refusal.reason, /37-window/);
  assert.ok(!K.parseHandoff(h38).refusal);
  // and idea 38's own committed kernel, re-flying its whole chain, accepts the same file (this page checks only consistency)
  const L38 = require(path.join(here, '..', '38-burn-out', 'load.cjs'));
  assert.ok(!L38.B.parseHandoff(h38).refusal);
});

// Idea 38's own committed kernel flies the chain's AS-512 departure with a 25 t payload: the departure that closes.
function closingH38() {
  const L38 = require(path.join(here, '..', '38-burn-out', 'load.cjs'));
  const B = L38.B, st = B.importWindow(L38.WIN), set = Object.assign(B.defaults(), { payloadKg: 25000, sweep: false, capability: false });
  return B.makeHandoff({ window: st }, set, B.compute({ window: st }, set), { produced: '2026-10-31T12:00:00Z' });
}

test('Chain: a departure that closes (idea 38\'s kernel, 25 t) is flown on: the miss if uncorrected, and the re-aim', () => {
  const h38 = closingH38(), ch = K.importBurnOut(h38);
  assert.ok(!ch.refusal && ch.departure && ch.cellRef);
  assert.equal(ch.departure.utc, '2026-07-02T04:06:59.700Z');
  const R = K.run(K.defaults(), { chain: ch }), F = R.flown;
  assert.ok(F && F.reaim);
  // idea 38 leaves 9.9 h before 14:00 UTC, the epoch Aster's asymptote is for; flown as it is, it is 318,455 km from
  // Apophis at the planned arrival (closest 287,332 km, 9.2 h early); re-aimed from its own epoch to the same arrival
  // it needs a 3.31 m/s correction, C3 0.5142 instead of 0.5114.
  assert.ok(Math.abs((R.selection.depTdb - ch.departure.tdb) / 3600 - 9.884) < 0.01);
  assert.ok(Math.abs(F.missAtArrival_m / 1e3 - 318455) < 50, F.missAtArrival_m);
  assert.ok(Math.abs(F.closest.distance_m / 1e3 - 287332) < 50, F.closest.distance_m);
  assert.equal(K.utcOf(F.closest.tdb).slice(0, 13), '2028-05-09T09');
  assert.ok(Math.abs(F.reaim.correction_m_s - 3.312) < 0.01, F.reaim.correction_m_s);
  assert.ok(Math.abs(F.reaim.c3Needed / 1e6 - 0.51424) < 1e-4);
  const h = K.buildHandoff(R, '2026-10-31T12:00:00Z');
  assert.ok(h.outputs.chain_departure.value.reaimed.correction_magnitude_m_s > 3);
  assert.ok(!K.parseHandoff(JSON.parse(JSON.stringify(h))).refusal);
  // edits to idea 38's handoff are refused
  const e1 = JSON.parse(JSON.stringify(h38)); e1.outputs.v_infinity.value.vector_m_s[0] += 1;
  assert.match(K.importBurnOut(e1).refusal.reason, /magnitude|RLA|asymptote/);
  const e2 = JSON.parse(JSON.stringify(h38)); e2.outputs.hyperbolic_departure_state.value.tdb_s_past_j2000 += 60;
  assert.match(K.importBurnOut(e2).refusal.reason, /UTC and TDB|cutoff/);
  const e4 = JSON.parse(JSON.stringify(h38)); e4.outputs.v_infinity.value.magnitude_m_s += 1;   // the vector left alone
  assert.match(K.importBurnOut(e4).refusal.reason, /magnitude/);
  const e3 = JSON.parse(JSON.stringify(h38)); e3.inputs.window_handoff.outputs.asymptote.value.s_hat_j2000 = [1, 0, 0];
  assert.match(K.importBurnOut(e3).refusal.reason, /asymptote/);
});

test('Handoff: the committed sample is what the kernel makes; it round-trips; edits are refused; every output is labelled', async () => {
  const { sample } = await import(path.join(here, 'build-sample.mjs'));
  const h38 = JSON.parse(fs.readFileSync(path.join(here, '..', '38-burn-out', 'handoff.json'), 'utf8'));
  const committed = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(sample(h38).handoff)), committed);
  assert.deepEqual(committed.inputs.burnout_handoff, h38);
  for (const [k, o] of Object.entries(committed.outputs)) assert.ok(o.units && ['measured', 'derived', 'assumed'].includes(o.confidence) && o.source, k);
  assert.equal(committed.outputs.transfer.value.departure_utc, '2026-07-02T14:00:00.000Z');
  assert.equal(committed.outputs.transfer.value.revolutions, 1);
  assert.ok(Math.abs(committed.outputs.transfer.value.time_of_flight_s / DAY - 677.1770833) < 1e-6);
  assert.ok(Math.abs(committed.outputs.v_infinity_departure.value.c3_m2_s2 / 1e6 - 0.511358) < 1e-5);
  // the v-infinities are the spacecraft's velocity less the body's, at each end
  const O = committed.outputs, dep = O.heliocentric_departure_state.value, arr = O.heliocentric_arrival_state.value;
  assert.ok(norm(sub(sub(dep.v_m_s, dep.earth_v_m_s), O.v_infinity_departure.value.vector_m_s)) < 1e-9);
  assert.ok(norm(sub(sub(arr.v_m_s, arr.target_v_m_s), O.v_infinity_arrival.value.vector_m_s)) < 1e-9);
  assert.ok(Math.abs(norm(O.v_infinity_arrival.value.vector_m_s) - O.v_infinity_arrival.value.magnitude_m_s) < 1e-9);
  const p = K.parseHandoff(committed);
  assert.ok(!p.refusal, p.refusal && p.refusal.reason);
  const e1 = JSON.parse(JSON.stringify(committed)); e1.outputs.v_infinity_arrival.value.magnitude_m_s += 0.5;
  assert.match(K.parseHandoff(e1).refusal.reason, /v_infinity_arrival/);
  const e2 = JSON.parse(JSON.stringify(committed)); e2.refusals.pop();
  assert.match(K.parseHandoff(e2).refusal.reason, /refusals/);
  const e3 = JSON.parse(JSON.stringify(committed)); e3.inputs.settings.target = '101955';
  assert.ok(K.parseHandoff(e3).refusal);
  assert.equal(K.parseHandoff('{').refusal.code, 'invalid_input');
});

test('Refusals for settings out of the envelope, structured, never a number', () => {
  const bad = [{ target: 'nowhere' }, { depStartUtc: '2027-01-01', depEndUtc: '2026-01-01' }, { tofMinDays: -3 }, { tofMaxDays: 5000 }, { nDep: 1 }, { revs: [3] }, { objective: 'cheapest' }, { site: 'kourou' }];
  for (const b of bad) {
    const R = K.run(Object.assign(K.defaults(), b), null);
    assert.equal(R.refusal.code, 'invalid_input', JSON.stringify(b));
    assert.ok(R.refusal.what_would_help);
  }
  const R = K.run(Object.assign(K.defaults(), { depStartUtc: '2040-06-01', depEndUtc: '2041-06-01', tofMinDays: 200, tofMaxDays: 400, nDep: 20, nTof: 10 }), null);
  assert.ok(R.refusals.some((r) => r.applies_to === 'departure_date'));
  assert.ok(R.grid.unsolved > 0);
  // a body with a poorly known orbit carries the condition-code refusal
  const poor = BODIES.list.find((b) => b.conditionCode >= 7);
  assert.ok(poor);
  const Rp = K.run(Object.assign(K.defaults(), { target: poor.designation, depStartUtc: '2027-01-01', depEndUtc: '2028-01-01', nDep: 30, nTof: 20 }), null);
  assert.ok(Rp.refusals.some((r) => r.applies_to === 'target_orbit'));
});

test('The encounter study over Aster\'s whole screening cache: its numbers, and its cases re-refused by this kernel', () => {
  const st = req('snapshots/encounter-study.json');
  assert.equal(st.bodies, 41905);
  assert.equal(st.refused, 1844);
  assert.equal(st.arrivalInsideSoi + st.arrivalPastEncounter - st.refused, 36);   // 36 windows are both
  assert.equal(st.bestC3Below1Refused, 1721);
  // in this page's excerpt: of the 61 bodies with a cached window, 31 have it refused; of the 38 chosen for the lowest
  // cached C3 among well-determined bodies, 26
  let n = 0, r = 0, nl = 0, rl = 0;
  for (const b of BODIES.list) {
    const w = b.cache && b.cache.best; if (!w) continue;
    const t = K.parseUtc(w.launchDate), bad = K.targetRefusals(b, t, t + w.tofDays * DAY).some((q) => q.applies_to === 'target_ephemeris' || q.applies_to === 'arrival_geometry');
    n++; if (bad) r++; if (b.why === 'low-c3') { nl++; if (bad) rl++; }
  }
  assert.deepEqual([n, r, nl, rl], [61, 31, 38, 26]);
  // the cases it lists are refused again here, for the reason it gives (those bodies in the excerpt; Apophis is first)
  assert.equal(st.lowestRefused[0].designation, '99942');
  for (const c of st.lowestRefused) {
    const b = K.findBody(c.designation);
    if (!b) continue;
    const t = K.parseUtc(c.launchDate), rf = K.targetRefusals(b, t, t + c.tofDays * DAY);
    assert.equal(rf.some((r) => r.applies_to === 'arrival_geometry'), c.inSoi, c.designation + ' SOI');
    assert.equal(rf.some((r) => r.applies_to === 'target_ephemeris'), !!c.encounter, c.designation + ' encounter');
  }
});

