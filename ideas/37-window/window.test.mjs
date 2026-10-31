// Window (idea 37): tests. Run from the bank root: node --test ideas/37-window/window.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(here, 'load.cjs'));
const W = L.W, DEG = Math.PI / 180;
const ORACLE = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'oracle.json'), 'utf8'));
const CASES = JSON.parse(fs.readFileSync(path.join(here, 'oracle', 'cases.json'), 'utf8'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
const ms = (s) => W.parseUtc(s);

let AS = null; // the AS-512 case, as the page opens on it
function as512() {
  if (!AS) {
    const h36 = L.as512Handoff36();
    const st = W.importClosedLoop(h36);
    const set = W.defaults(st.siteId), spec = W.apophisSpec();
    AS = { h36, st, set, spec, R: W.compute(st, spec, set) };
  }
  return AS;
}

test('snapshots: idea 36\'s kernel and every file it loads are byte-identical to the committed ones; every sidecar matches', () => {
  const chain = { 'closedloop.js': 'closedloop.js' };
  for (const f of ['ascent.js', 'stack.js', 'isa.js', 'earth.js', 'as512-flight.js', 'as512-trajectory.js', 'as512-guidance.js', 'saturn-v-axial-force.js', 'data-json.js', 'aster-parking.js']) chain[f] = 'snapshots/' + f;
  for (const [mine, theirs] of Object.entries(chain)) {
    assert.deepEqual(fs.readFileSync(path.join(here, 'snapshots', mine)), fs.readFileSync(path.join(here, '..', '36-closed-loop', theirs)), mine);
  }
  let n = 0;
  for (const f of fs.readdirSync(path.join(here, 'snapshots')).filter((x) => x.endsWith('.provenance.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f), 'utf8'));
    assert.ok(p.repo && p.path && p.commit, f + ' keys');
    const data = fs.readFileSync(path.join(here, 'snapshots', f.replace('.provenance.json', '')));
    if (p.writtenSha256) { assert.equal(sha(data), p.writtenSha256, f); n++; }
  }
  assert.ok(n >= 15, 'sidecars with a written hash: ' + n);
  // the derived files are what build-data.mjs parses: Aster's two constants agree with the Aster file text
  const ts = fs.readFileSync(path.join(here, 'snapshots', 'aster-utc-to-tdb.ts.txt'), 'utf8');
  assert.match(ts, new RegExp('TDB_MINUS_UTC_SECONDS = ' + L.ASTER.tdbMinusUtc_s.toString().replace('.', '\\.') + ';'));
  assert.match(ts, new RegExp('UNIX_TO_J2000_DAYS = ' + L.ASTER.unixToJ2000Days.toString().replace('.', '\\.') + ';'));
});

test('time: NAIF\'s leap seconds against ERFA\'s own table and Aster\'s 69.184 s; refusals before 1972 and for impossible dates', () => {
  for (const e of ORACLE.earth) near(W.timeOf(ms(e.utc)).ttMinusUtc, e.ttMinusUtc_erfa, 1e-6, e.utc); // ERFA derives TT-UTC with its own table
  near(W.timeOf(ms('1972-12-07T05:33:00Z')).ttMinusUtc, 11 + 32.184, 1e-12);
  for (const d of ['2017-01-01', '2026-07-02T02:50:50Z', '2040-12-31T18:00:00Z']) {
    const T = W.timeOf(ms(d));
    near(T.ttMinusUtc, L.ASTER.tdbMinusUtc_s, 1e-12, 'Aster ' + d);
    // Aster's utcStringToTdbSeconds: UTC s since the Unix epoch - 946728000 + 69.184
    near(T.tdb, ms(d) / 1000 - L.ASTER.unixToJ2000Days * 86400 + L.ASTER.tdbMinusUtc_s, 1e-6, 'tdb ' + d);
  }
  near(W.timeOf(ms('2016-12-31T23:59:59Z')).ttMinusUtc, 36 + 32.184, 1e-12, 'one second before the last leap second');
  assert.equal(W.timeOf(ms('1971-12-31T23:00:00Z')).refusal.applies_to, 'time');
  for (const bad of ['2026-02-30', '2026-07-02T24:00', '2026-13-01', '2026-07-02T10:61', '2026-07-02T10:00:60', 'next tuesday']) assert.equal(W.parseUtc(bad), null, bad);
  assert.equal(W.parseUtc('2026-07-02T02:50:50.5Z'), Date.UTC(2026, 6, 2, 2, 50, 50, 500));
});

test('JPL 82-43 closed forms: eq. 9 is the vector form; eqs. 14 to 18, 21 and 25; Figs. 12 and 14', () => {
  // eq. (9), with its quadrant rule for an eastward launch, against the plane through the pad and the asymptote
  let worst = 0;
  for (const phi of [-30, 0, 28.3, 34.7, 51]) for (let dla = -50; dla <= 50; dla += 10) for (let da = 5; da < 360; da += 10) {
    const u = [Math.cos(phi * DEG), 0, Math.sin(phi * DEG)], s = [Math.cos(dla * DEG) * Math.cos(da * DEG), Math.cos(dla * DEG) * Math.sin(da * DEG), Math.sin(dla * DEG)];
    let a = W.azimuthToward(u, s) / DEG; if (Math.sin(a * DEG) < 0) a = (a + 180) % 360;
    worst = Math.max(worst, Math.abs(a - W.handbookAzimuth(phi, dla, da)));
  }
  assert.ok(worst < 1e-9, 'eq. 9 vs vector, worst ' + worst);
  // eqs. (15), (16), (17)/(18) from the plane
  for (const [phi, az, dla, da] of [[28.3, 70, -15, 284.26], [28.5, 91.504, -9, 120], [34.7, 158, 10, 40]]) {
    const u = [Math.cos(phi * DEG), 0, Math.sin(phi * DEG)], pl = W.planeOf(u, az * DEG), i = W.inclinationOf(pl.h);
    near(Math.cos(i), Math.cos(phi * DEG) * Math.sin(az * DEG), 1e-14, 'eq. 15');
    const dOm = -W.nodeOf(pl.h); // alpha_L = 0 here
    near(Math.sin(dOm), Math.sin(phi * DEG) * Math.sin(az * DEG) / Math.sin(i), 1e-12, 'eq. 16');
    const s = [Math.cos(dla * DEG) * Math.cos(da * DEG), Math.cos(dla * DEG) * Math.sin(da * DEG), Math.sin(dla * DEG)];
    const azS = W.azimuthToward(u, s), pl2 = W.planeOf(u, azS), th = W.angleAhead(u, s, pl2.h);
    near(Math.cos(th), Math.sin(dla * DEG) * Math.sin(phi * DEG) + Math.cos(dla * DEG) * Math.cos(phi * DEG) * Math.cos(da * DEG), 1e-12, 'eq. 17');
    near(Math.sin(th), Math.sin(da * DEG) * Math.cos(dla * DEG) / Math.sin(azS), 1e-12, 'eq. 18');
  }
  // eq. (14): beyond the latitude the eastward azimuth never comes nearer east than asin(cos dla / cos phi)
  const dla = L.APOPHIS.summary.maxDeltaDlaCell.oursDlaDeg, phi = 28.5;
  let maxAz = 0;
  for (let da = 0; da < 360; da += 0.01) maxAz = Math.max(maxAz, W.handbookAzimuth(phi, dla, da) % 180 < 90 ? W.handbookAzimuth(phi, dla, da) % 180 : 0);
  near(maxAz, Math.asin(Math.cos(dla * DEG) / Math.cos(phi * DEG)) / DEG, 1e-3, 'eq. 14');
  near(maxAz, 55.528, 0.001, 'eq. 14 for Apophis from 28.5 deg');
  // Fig. 12: for dla = 0 the two due-east launches are exactly 12 h of sidereal time apart (alpha_inf - alpha_L 90 and 270)
  near(W.handbookAzimuth(28.3, 0, 90), 90, 1e-9); near(W.handbookAzimuth(28.3, 0, 270), 90, 1e-9);
  // Fig. 14: phi 28.3, dla -15, alpha_inf 315: the first window opens at azimuth 70 with alpha_inf - alpha_L1 printed as
  // 285 deg (a figure annotation); eq. 9 gives 284.26
  const f = (x) => W.handbookAzimuth(28.3, -15, x) - 70; let lo = 270, hi = 300;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; }
  near(lo, 284.26, 0.01, 'Fig. 14'); near(lo, 285, 1, 'Fig. 14 as printed');
  // eq. (25) with the handbook's own numbers: "about 0.46 deg of westward nodal motion per revolution"
  near(W.regressionPerRev(6748e3, 28.3, 6378e3, 0.00108263), -0.46, 0.0005, 'eq. 25');
  // eq. (21) limits: a parabola's asymptote is 180 deg from perigee, a very fast hyperbola's 90
  near(W.nuInf(1e-6, 6563e3) / DEG, 180, 0.01); near(W.nuInf(1e12, 6563e3) / DEG, 90, 0.01);
});

test('Earth orientation against pyerfa: ERA, GMST and precession to round-off; leaving out nutation costs under 0.25 s and 9 arcsec', () => {
  for (const e of ORACLE.earth) {
    const T = W.orient(ms(e.utc));
    near(W.era(T.du), e.era_erfa, 2e-11, 'ERA ' + e.utc);
    near(T.gmst, e.gmst_erfa, 2e-11, 'GMST ' + e.utc);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(T.P[i][j], e.pmat06[i][j], 1e-14, 'pmat06 ' + e.utc);
    // the pad's direction in GCRS, mean model (the kernel's) against the full IAU 2006/2000A one (no polar motion)
    assert.ok(Math.abs(e.pad_along_s) <= 0.25, 'along ' + e.pad_along_s);
    assert.ok(e.pad_cross_arcsec <= 9, 'cross ' + e.pad_cross_arcsec);
  }
  // although the equation of the equinoxes reaches 14 arcsec (about 1 s of sidereal time), the pad itself moves along
  // its daily circle by at most 0.2 s: GMST from the mean equinox and the precession matrix carry the same origin
  assert.ok(Math.max(...ORACLE.earth.map((e) => Math.abs(e.eqeq_arcsec))) > 14);
  near(Math.max(...ORACLE.earth.map((e) => Math.abs(e.pad_along_s))), 0.201, 0.001);
  near(Math.max(...ORACLE.earth.map((e) => e.pad_cross_arcsec)), 8.614, 0.001);
  // Aster's only Earth orientation, the IAU WGCCRE model in its pck00010, against the same oracle: Greenwich lags by
  // 243 to 430 arcsec (16 to 29 s of launch time) from 1972 to 2040, growing
  const lag = ORACLE.earth.map((e) => { const d = W.pckGreenwichRa(W.orient(ms(e.utc))).ra - e.greenwich_ra_gcrs_deg; return (((d + 540) % 360) - 180) * 3600; });
  assert.ok(lag.every((x) => x < -240 && x > -435), lag.join(' '));
  near(lag[3], -308.9, 0.5, 'pck00010 at the Apophis launch');
});

test('the window against a brute-force scan with the full Earth model (pyerfa, no J2): edges within 1 s', () => {
  const { R } = as512();
  assert.equal(R.windowsNoJ2.length, CASES.window.kernelNoJ2.length);
  R.windowsNoJ2.forEach((w, i) => { near(w.openMs / 1000, CASES.window.kernelNoJ2[i].open, 1e-3); near(w.closeMs / 1000, CASES.window.kernelNoJ2[i].close, 1e-3); });
  for (const w of ORACLE.window) { assert.ok(Math.abs(w.open_gap_s) <= 1.0, 'open ' + w.open_gap_s); assert.ok(Math.abs(w.close_gap_s) <= 1.0, 'close ' + w.close_gap_s); }
  near(ORACLE.window[0].open_gap_s, 0.041, 0.01); near(ORACLE.window[0].close_gap_s, 0.836, 0.01);
});

test('the coast against scipy DOP853: 2 cm after an hour; J2\'s formula against the potential\'s gradient; J3 and J4 move the plane 0.0003 deg', () => {
  const { R } = as512();
  const s = R.launch;
  // the oracle integrated this very launch (cases.json is this kernel's output)
  for (let k = 0; k < 3; k++) { near(s.ins.r[k], CASES.coast.r0[k], 1e-6); near(s.ins.v[k], CASES.coast.v0[k], 1e-9); }
  near(s.ev.t, CASES.coast.T, 1e-6);
  const O = ORACLE.coast;
  assert.ok(O.j2_kernel_position_diff_m < 0.05, 'position ' + O.j2_kernel_position_diff_m);
  assert.ok(O.j2_kernel_velocity_diff_m_s < 1e-4, 'velocity ' + O.j2_kernel_velocity_diff_m_s);
  assert.ok(O.j2_kernel_plane_diff_deg < 1e-8, 'plane ' + O.j2_kernel_plane_diff_deg);
  assert.ok(Math.abs(O.j2_asymptote_out_of_plane_deg) < 1e-8, 'the asymptote is in the oracle\'s plane at departure');
  for (const d of O.j2_accel_formula_rel_diff) assert.ok(d < 1e-8, 'J2 formula ' + d);
  assert.ok(O.j234_vs_j2_plane_deg < 0.001 && Math.abs(O.j234_asymptote_out_of_plane_deg) < 0.001, 'J3, J4');
  near(O.j234_vs_j2_plane_deg, 0.000265, 0.00001);
  // the kernel's own step: 10 s against 1 s
  const a = W.propagate(s.ins.r, s.ins.v, s.ev.t, { dt: 10 }), b = W.propagate(s.ins.r, s.ins.v, s.ev.t, { dt: 1 });
  assert.ok(Math.hypot(a.r[0] - b.r[0], a.r[1] - b.r[1], a.r[2] - b.r[2]) < 0.05);
});

test('J2 over the coast: the numerical node regression against eq. 25 to 0.05 %', () => {
  const MU = W.constants.MU, ro = 6748e3, inc = 28.3 * DEG, v = Math.sqrt(MU / ro), T = 2 * Math.PI * Math.sqrt(ro ** 3 / MU);
  const s = W.propagate([ro, 0, 0], [0, v * Math.cos(inc), v * Math.sin(inc)], 10 * T, { dt: 10 });
  const h = [s.r[1] * s.v[2] - s.r[2] * s.v[1], s.r[2] * s.v[0] - s.r[0] * s.v[2], s.r[0] * s.v[1] - s.r[1] * s.v[0]];
  const perRev = Math.atan2(h[0], -h[1]) / DEG / 10, eq25 = W.regressionPerRev(ro, 28.3, W.constants.RJ2, W.constants.J2);
  near(perRev / eq25, 1, 5e-4, 'numerical ' + perRev + ' vs eq. 25 ' + eq25);
  const n = W.propagate([ro, 0, 0], [0, v * Math.cos(inc), v * Math.sin(inc)], 10 * T, { dt: 10, j2: false });
  near(Math.atan2(n.r[1] * n.v[2] - n.r[2] * n.v[1], -(n.r[2] * n.v[0] - n.r[0] * n.v[2])), 0, 1e-9, 'no J2: no regression');
});

test('the solve: idea 36\'s insertion placed exactly; the plane at departure holds the asymptote; the burn point; the vehicle re-flown', () => {
  const { st, R, set, h36 } = as512();
  // placing idea 36's insertion in the plane of its own azimuth at an instant = its state turned by the pad's RA
  const T = W.orient(ms('2026-07-02T06:00:00Z')), aL = T.gmst + set.lonDeg * DEG, u = W.padUnit(T, set.lonDeg, st.latDeg);
  const ins = h36.outputs.insertion_state.value, pl = W.planeOf(u, st.azFlownDeg * DEG), p = W.placeAscent(st.prof, u, pl.h);
  const rot = W.rotZ(ins.r_m, aL), rotv = W.rotZ(ins.v_m_s, aL);
  // to 1 cm: idea 36's plane misses the pad by 7e-8 deg (its own insertion error), 8 mm at the pad's radius
  for (let k = 0; k < 3; k++) { near(p.r[k], rot[k], 1e-2, 'r'); near(p.v[k], rotv[k], 1e-5, 'v'); }
  // AS-512's first stage flew 91.504 deg; guidance then yawed to Apollo 17's 28.526 deg plane, which leaves the pad on 91.245
  near(st.azPlanDeg, 91.504, 0); near(st.azFlownDeg, 180 - Math.asin(Math.cos(28.526 * DEG) / Math.cos(28.5 * DEG)) / DEG, 1e-6);
  // with J2 the solved launch puts the asymptote in the plane at departure, nu_inf ahead of the vehicle
  const s = R.launch, d = R.departure;
  assert.ok(Math.abs(s.betaDeg) < 1e-9, 'beta ' + s.betaDeg);
  near(W.angleAhead(d.r, s.S, s.hb) / DEG, d.nuInfDeg, 1e-6, 'burn point');
  near(d.vp * d.vp, R.asym.c3 + 2 * W.constants.MU / d.rn, 1e-3, 'vis-viva');
  near(d.eH, 1 + R.asym.c3 * d.rn / W.constants.MU, 1e-12);
  assert.ok(Math.abs(d.gammaDeg) < 0.05, 'near-circular');
  // without J2 no aim offset is needed and the plane holds the asymptote all the same
  const s0 = W.solveAt(Object.assign({}, R.env, { j2: false }), s.ms, R.flight.profile);
  assert.equal(s0.psiDeg, 0); assert.ok(Math.abs(s0.betaDeg) < 1e-8);
  near(s.psiDeg, 0.2237, 0.001, 'J2 aim offset');
  // idea 36's own sample (due east, so plan and plane azimuths agree) flown again by flyAt: the same flight to the bit
  const h36s = JSON.parse(fs.readFileSync(path.join(here, '..', '36-closed-loop', 'handoff.json'), 'utf8')), sts = W.importClosedLoop(h36s);
  near(sts.azFlownDeg, sts.azPlanDeg, 1e-6);
  const f = W.flyAt(sts.ctx, sts.azPlanDeg);
  assert.equal(f.propellant, h36s.outputs.propellant_left_in_guided_stage.value, 'propellant');
  assert.deepEqual(f.ins.r_m, h36s.outputs.insertion_state.value.r_m);
});

test('Apophis, 2026-07-02, AS-512 from Pad 39A: one 7.45 h window bounded by 35 deg; J2 moves it 54 s; 8 to 15 t of departure propellant against due east', () => {
  const { R, h36 } = as512();
  assert.ok(Math.max(...R.perf.map((p) => p.azDeg)) <= 55.528 + 1e-3, 'eq. 14');
  near(R.asym.dlaDeg, L.APOPHIS.summary.maxDeltaDlaCell.oursDlaDeg, 1e-10, 'DLA as Aster computes it');
  assert.equal(R.aster.cls, 'AMBER');
  assert.equal(R.windows.length, 1);
  const w = R.windows[0];
  near(w.openMs, Date.UTC(2026, 6, 2, 2, 50, 50, 479), 100, 'open'); near(w.closeMs, Date.UTC(2026, 6, 2, 10, 17, 53, 379), 100, 'close');
  near(w.azOpenDeg, 35, 1e-3); near(w.azCloseDeg, 35, 1e-3); assert.deepEqual(w.boundBy, ['azimuth 35 deg', 'azimuth 35 deg']);
  // J2: the launch is aimed east of the asymptote and the window moves later
  near((w.openMs - R.windowsNoJ2[0].openMs) / 1000, 53.67, 0.1); near((w.closeMs - R.windowsNoJ2[0].closeMs) / 1000, 33.46, 0.1);
  // the handbook's closed-form bias (eqs. 22, 25, 27, one pass) against the numerical edges: 7 s early
  const g = (t) => W.fastAt(R.env, t, R.flight.profile).azDeg - 35; let lo = w.openMs - 120e3, hi = w.openMs + 120e3;
  for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (g(lo) * g(m) <= 0) hi = m; else lo = m; }
  near((w.openMs - lo) / 1000, 6.33, 0.1, 'handbook opening against the numerical one');
  // the vehicle: due east idea 36 leaves 70,937 kg; inside this window between 56,250 and 62,874 kg
  const due = h36.outputs.propellant_left_in_guided_stage.value, ps = R.perf.map((p) => p.propellant);
  near(due, 70937.005, 0.01);
  assert.ok(ps.every((x) => x != null && x < due));
  near(R.flight.propellant, 56250.39, 0.05, 'at the opening'); near(Math.max(...ps), 62874, 1, 'best');
  near(R.departure.dv, 3254.9, 0.5, 'impulsive departure');
  // (independent review) what that propellant buys: 2,525 m/s at the opening against the 3,255 m/s needed, so the
  // departure is refused for this launch, and it would be even due east (2,991 m/s)
  near(R.capacity.dv, 2524.5, 0.5, 'ideal delta-v of the propellant left');
  near(R.capacity.dv, R.capacity.ve * Math.log(R.capacity.m0 / (R.capacity.m0 - R.flight.propellant)), 1e-9, 'the rocket equation');
  near(R.capacity.ve, as512().st.ctx.engines['J-2'].ispVac, 0, 'the J-2 vacuum exhaust velocity of the imported stack (idea 33\'s deck)');
  near(R.capacity.ve, 4146.0, 0.05);
  const cr = R.refusals.find((x) => x.applies_to === 'departure_propellant');
  assert.ok(cr && cr.code === 'out_of_envelope' && /cannot make this departure/.test(cr.reason), 'departure refused for want of propellant');
  near(cr.need_m_s - cr.capacity_m_s, 730.4, 0.5, 'short by');
  const east = W.flyAt(as512().st.ctx, as512().st.azFlownDeg), capE = W.capacityOf(as512().st.ctx, east);
  near(capE.dv, 2990.6, 0.5, 'due east'); assert.ok(capE.dv < R.departure.dv);
  for (const p of R.perf) { const f = W.flyAt(as512().st.ctx, p.azDeg); assert.ok(W.capacityOf(as512().st.ctx, f).dv < 2750, 'no moment of the window buys it: ' + p.azDeg); }
  // a C3 the propellant does buy: no such refusal
  const low = W.compute(as512().st, { c3_m2_s2: -2e6, rlaDeg: R.asym.rlaDeg, dlaDeg: R.asym.dlaDeg, dateUtc: '2026-07-02' }, as512().set, { perf: false, noJ2: false });
  assert.ok(!low.refusals.some((x) => x.applies_to === 'departure_propellant'), 'target mode: nothing to refuse');
  assert.equal(W.capacityRefusal({ dv: 3200, ve: 4146, mp: 1, stage: 's', engine: 'e' }, { dv: 3100 }), null);
  assert.match(W.capacityRefusal({ dv: 3100, ve: 4146, mp: 1, stage: 's', engine: 'e' }, { dv: 3150 }).reason, /marginal/);
});

test('Apollo 17 against its flight report and press kit: the window closes 6.2 min late; the scheduled azimuth; inclination; J2 over the coast', () => {
  const AP = L.AP17, T512 = L.T512;
  // the transcription, cross-checked: the hold at T-30 s plus 30 s is the press kit's 9:53 pm EST opening
  assert.equal(ms(AP.holdUtc) + 30e3, ms(AP.window.openUtc));
  assert.equal(AP.window.openEst, '21:53'); assert.equal(ms(AP.window.openUtc) - 5 * 3600e3, Date.UTC(1972, 11, 6, 21, 53));
  near(AP.insertion.inclinationDeg, T512.insertion.inclination, 0); near(AP.insertion.descendingNodeDeg, T512.insertion.descendingNode, 0);
  // Pad 39A placed from Table 4-3
  near(W.PAD39A.latDeg, 28.6058, 1e-4); near(W.PAD39A.lonDeg, -80.6054, 1e-4); assert.ok(W.PAD39A.crossRangeDeg < 0.003);
  const a = W.apollo17();
  assert.ok(Math.abs(a.fit.residualDeg[0]) < 1e-9 && Math.abs(a.fit.residualDeg[1]) < 1e-9);
  near(a.closeGap_s, 369.2, 1, 'window close vs press kit');
  near(a.openGap_s, -62.5, 1, '72.000 deg comes 62.5 s before the scheduled liftoff, whose azimuth was 72.141');
  near(a.azimuthAt(a.scheduledMs), 72.141, 1e-6); near(a.azimuthAt(a.liftoffMs), 91.504, 1e-6);
  // Table 4-3's latitudes are geodetic, so the walked-back pad latitude is too; the plane geometry needs the geocentric
  // one (independent review): on Aster's pck00010 ellipsoid 28.4443 deg, which moves the gap the other way, to +380 s
  near(W.PAD39A.geocentricLatDeg, 28.4443, 1e-4);
  near(W.apollo17(W.PAD39A.geocentricLatDeg).closeGap_s, 380.3, 1, 'with the pad\'s geocentric latitude');
  near(W.apollo17(W.PAD39A.geocentricLatDeg).inclinationAtFlownDeg, 28.481, 0.001, 'eq. 15 from the pad\'s geocentric latitude');
  near(W.apollo17(W.PAD39A.latDeg).closeGap_s, 348.2, 1, 'the geodetic latitude used as if geocentric (what the README first said)');
  near(a.inclinationAtFlownDeg, 28.536, 0.001); near(a.inclinationTable44Deg, 28.526, 0);
  // J2 from insertion (Table 4-4) to translunar injection (Table 4-5): the coast alone against the flight, burn included
  const c = W.as512Coast();
  near(c.predictedChangeDeg, -1.0225, 0.001); near(c.flightChangeDeg, -0.917, 1e-9); near(c.eq25ChangeDeg, -1.0371, 0.001);
  near(c.dnNoJ2Deg, AP.insertion.descendingNodeDeg, 1e-6, 'no J2, no motion');
});

test('independent review: the yardstick against Apollo 17\'s own translunar burn; a yawed first stage; the pad\'s geocentric latitude; Aster\'s band edges', () => {
  const { st, set, R } = as512();
  // Table 16-7: the real S-IVB went from 139,750 to 65,711 kg; at idea 33's J-2 exhaust velocity that is 3,129 m/s, at
  // least 0.9 % under the 3,155 m/s impulsive minimum Table 4-5's C3 needs from the chain's insertion radius (the burn
  // did it, so the yardstick reads low); the chain's AS-512 on Apollo 17's own azimuth carries 2,991 m/s, 138 m/s less
  const f2 = W.flyAt(st.ctx, L.AP17.azimuthFlownDeg), t = W.tliCheck(st.ctx, f2);
  near(t.flownDv, 3128.5, 0.5, 'the real burn at the deck\'s exhaust velocity');
  near(t.needDv, 3155.5, 0.5, 'impulsive need for Table 4-5\'s C3');
  near(1 - t.flownDv / t.needDv, 0.0086, 0.0005, 'the yardstick reads at least 0.9 % low');
  near(t.chain.dv, 2990.8, 0.5, 'the chain\'s AS-512 on 91.504 deg');
  near(t.chain.mp, 70930.8, 0.5);
  // the first stage flies the plane's azimuth (as the Saturn V did); yawed toward the north it keeps more inside the
  // window: plane 45 deg, first stage 39 deg: +1,685 kg; plane 55.5 deg, first stage 50.5 deg: +1,014 kg
  const flyYaw = (planAz, planeAz) => {
    const ctx = st.ctx, lat = ctx.plan.site.latitudeDeg, plan = JSON.parse(JSON.stringify(ctx.plan)); plan.azimuthDeg = planAz;
    const inc = Math.acos(Math.cos(lat * DEG) * Math.sin(planeAz * DEG)) / DEG;
    const tgt = L.C.targetOrbit({ perigeeAlt: ctx.target.perigeeAlt, apogeeAlt: ctx.target.apogeeAlt, inclinationDeg: inc, branch: 'north' }, lat);
    const r1 = L.A.fly(ctx.veh, ctx.engines, plan, { burns: 1, samples: false });
    const g = L.C.flyClosed(ctx.veh, ctx.engines, plan, { mode: 'upfg', startAfter: ctx.guidance.startAfter, cycle: ctx.guidance.cycle }, tgt, { samples: false, stage1: r1 });
    assert.ok(g.ok && g.inOrbit); return g.guided.propellantLeft;
  };
  near(flyYaw(45, 45), W.flyAt(st.ctx, 45).propellant, 1e-6, 'the same flight as flyAt');
  near(flyYaw(39, 45) - flyYaw(45, 45), 1685, 2, 'plane 45, first stage 39');
  near(flyYaw(50.5, 55.5) - flyYaw(55.5, 55.5), 1014, 2, 'plane 55.5, first stage 50.5');
  near(flyYaw(50.5, 55.5), 63959, 2);
  // the pad's geocentric latitude (28.444 deg) instead of the chain's 28.5 deg: the Apophis window (no J2) opens 0.85 s
  // and closes 13.9 s earlier
  const nj = W.dailyWindows(Object.assign({}, R.env, { j2: false }), st.prof, {}).windows[0];
  const ng = W.dailyWindows(Object.assign({}, R.env, { j2: false, latDeg: W.PAD39A.geocentricLatDeg }), st.prof, {}).windows[0];
  near((ng.openMs - nj.openMs) / 1000, -0.85, 0.1); near((ng.closeMs - nj.closeMs) / 1000, -13.9, 0.2);
  // Aster's classifyFeasibility edges (feasibility.ts: GREEN |DLA| <= iMin, AMBER <= dlaCeiling 57, else RED)
  assert.equal(W.asterBand(28.5, 'cape-canaveral').cls, 'GREEN'); assert.equal(W.asterBand(-28.5001, 'cape-canaveral').cls, 'AMBER');
  assert.equal(W.asterBand(57, 'cape-canaveral').cls, 'AMBER'); assert.equal(W.asterBand(57.0001, 'cape-canaveral').cls, 'RED');
  // eq. 15 puts the 35 deg plane at 59.73 deg, so a DLA of 58 deg that Aster screens RED has a window from the pad
  const d58 = W.compute(st, { c3_m2_s2: 10e6, rlaDeg: 100, dlaDeg: 58, dateUtc: '2026-07-02' }, set, { perf: false, noJ2: false });
  assert.equal(d58.aster.cls, 'RED'); assert.equal(d58.windows.length, 1); near(d58.windows[0].duration, 10089.6, 5);
  // eq. 25 at the Apophis plane (59.73 deg, idea 36's 6,545 km parking orbit): 0.280 deg per revolution
  near(W.regressionPerRev(6545036.6, 59.7304, W.constants.RJ2, W.constants.J2), -0.2799, 0.0005);
});

test('windows belong to the day they open on, followed to their close; a corridor open all day; the coast minimum', () => {
  const { st, set, R } = as512();
  // declination 10 deg, RLA 164 deg: one window opens the evening before (not this day's), two open on the day, the
  // second closing after midnight
  const r = W.compute(st, { c3_m2_s2: 10e6, rlaDeg: 164, dlaDeg: 10, dateUtc: '2026-07-02' }, set, { perf: false, noJ2: false });
  const day = Date.UTC(2026, 6, 2);
  assert.equal(r.windows.length, 2);
  for (const w of r.windows) assert.ok(w.openMs >= day && w.openMs < day + 86400e3, w.open);
  assert.ok(r.windows[1].closeMs > day + 86400e3, 'the evening window is followed past midnight: ' + r.windows[1].close);
  // a corridor that takes every eastward azimuth: open all day
  const all = W.compute(st, { c3_m2_s2: 10e6, rlaDeg: 164, dlaDeg: 10, dateUtc: '2026-07-02' }, Object.assign({}, set, { corridor: [0.01, 179.99] }), { perf: false, noJ2: false });
  assert.ok(!all.refusal, all.refusal && all.refusal.reason);
  // a coast of at least 2 h: the first departure opportunity is passed by, one revolution later instead
  const sl = W.compute(st, W.apophisSpec(), Object.assign({}, set, { coast: { min: 7200, max: set.coast.max } }), { perf: false, noJ2: false });
  assert.equal(sl.launch.ev.revs, 1);
  assert.ok(sl.launch.ev.t >= 7200 && sl.launch.ev.t <= set.coast.max);
  near(sl.launch.ev.t - R.launch.ev.t, 2 * Math.PI * Math.sqrt(R.flight.profile.rmag ** 3 / W.constants.MU), 90, 'one more revolution');
  // a minimum a little under the first crossing (independent review): nothing skipped, the same departure
  const s2 = W.compute(st, W.apophisSpec(), Object.assign({}, set, { coast: { min: R.launch.ev.t - 120, max: set.coast.max } }), { perf: false, noJ2: false });
  assert.equal(s2.launch.ev.revs, 0); near(s2.launch.ev.t, R.launch.ev.t, 1e-6);
});

test('refusals: no window, a target vector, outside the window, before 1972, bad settings, foreign or edited handoffs', () => {
  const { st, set } = as512();
  const r1 = W.compute(st, { c3_m2_s2: 10e6, rlaDeg: 0, dlaDeg: 70, dateUtc: '2026-07-02' }, set, { perf: false, noJ2: false });
  assert.equal(r1.refusal.applies_to, 'window'); assert.match(r1.refusal.reason, /eq\. 14/);
  // eq. 14 for DLA 70 from 28.5 deg: asin(cos 70 / cos 28.5) = 22.90 deg from north (the first version said "of east")
  assert.match(r1.refusal.reason, /only azimuths within 22\.9 deg of north or of south are reachable and those within 67\.1 deg of east are not/);
  const r2 = W.compute(st, { c3_m2_s2: -1.7e6, rlaDeg: 120, dlaDeg: -9, dateUtc: '2026-07-02' }, set, { perf: false, noJ2: false });
  assert.ok(!r2.refusal && r2.launch && !r2.departure); assert.equal(r2.refusals[0].applies_to, 'departure');
  const r3 = W.compute(st, W.apophisSpec(), Object.assign({}, set, { launchUtc: '2026-07-02T15:00:00Z' }), { perf: false, noJ2: false });
  assert.equal(r3.refusal.applies_to, 'launch_time');
  const r4 = W.compute(st, { c3_m2_s2: 10e6, rlaDeg: 0, dlaDeg: 10, dateUtc: '1969-07-16' }, set, { perf: false });
  assert.equal(r4.refusal.applies_to, 'time');
  for (const [bad, key] of [[{ corridor: [120, 35] }, 'corridor'], [{ coast: { min: 100, max: 50 } }, 'coast'], [{ lonDeg: null }, 'site'], [{ dt: 0 }, 'coast']]) {
    assert.equal(W.compute(st, W.apophisSpec(), Object.assign({}, set, bad), { perf: false }).refusal.applies_to, key, JSON.stringify(bad));
  }
  for (const spec of [{ c3_m2_s2: 1e6, rlaDeg: 0, dlaDeg: 95, dateUtc: '2026-07-02' }, { c3_m2_s2: 1e6, rlaDeg: 0, dlaDeg: 5 }, { vinf_m_s: [0, 0, 0], dateUtc: '2026-07-02' }, { vinf_m_s: [1, 'a', 2], dateUtc: '2026-07-02' }]) {
    assert.equal(W.compute(st, spec, set, { perf: false }).refusal.applies_to, 'asymptote', JSON.stringify(spec));
  }
  assert.equal(W.importClosedLoop('{not json').refusal.code, 'invalid_input');
  assert.match(W.importClosedLoop(fs.readFileSync(path.join(here, '..', '35-max-q', 'handoff.json'), 'utf8')).refusal.reason, /idea 36/);
  const ed = JSON.parse(JSON.stringify(as512().h36)); ed.outputs.insertion_state.value.r_m[0] += 1000;
  assert.equal(W.importClosedLoop(ed).refusal.code, 'invalid_input', 'idea 36 refuses its own edited handoff');
});

test('handoff: the committed sample is what the kernel makes; it carries idea 36\'s whole; it round-trips; edits are refused', async () => {
  const committed = JSON.parse(fs.readFileSync(path.join(here, 'handoff.json'), 'utf8'));
  const h36 = JSON.parse(fs.readFileSync(path.join(here, '..', '36-closed-loop', 'handoff.json'), 'utf8'));
  assert.deepEqual(committed.inputs.closed_loop_handoff, h36);
  const { sample } = await import(path.join(here, 'build-sample.mjs'));
  const { handoff, R } = sample(h36);
  assert.deepEqual(JSON.parse(JSON.stringify(handoff)), committed);
  assert.equal(committed.from, '37-window'); assert.equal(committed.version, 1);
  for (const [k, v] of Object.entries(committed.outputs)) assert.ok(v.units && ['measured', 'derived', 'assumed'].includes(v.confidence) && v.source, k);
  assert.ok(committed.refusals.some((r) => r.applies_to === 'restart' && r.from === '36-closed-loop'), 'idea 36\'s restart refusal travels on');
  // the departure epoch in TDB is the UTC one plus Aster's 69.184 s
  const dp = committed.outputs.departure_point.value;
  near(dp.tdb_s_past_j2000, ms(dp.utc) / 1000 - 946728000 + 69.184, 1e-3);
  near(committed.outputs.propellant_for_departure.value, R.flight.propellant, 1e-9);
  const back = W.parseHandoff(committed);
  assert.ok(!back.refusal, back.refusal && back.refusal.reason);
  for (const edit of [(h) => { h.outputs.launch.value.azimuth_deg += 0.001; }, (h) => { h.outputs.departure_point.value.r_m[2] += 10; }, (h) => { h.outputs.propellant_for_departure.value += 1; },
    (h) => { h.outputs.daily_windows.value[0].close_utc = '2026-07-02T11:00:00Z'; }, (h) => { h.refusals.pop(); }, (h) => { delete h.outputs.coast; }]) {
    const e = JSON.parse(JSON.stringify(committed)); edit(e);
    assert.equal(W.parseHandoff(e).refusal.code, 'invalid_input');
  }
});
