// Tests for idea 42 (Closing In). node --test ideas/42-closing-in/closing.test.mjs
// Every number pinned here comes from outside the kernel: AAS 19-035's tables, JPL Horizons, JPL SBDB, NSSDCA, the
// Python ANH3BP oracle (oracle/anh3bp-oracle.json), closed forms worked here, or idea 41's own parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const { K, sample41 } = require('./load.cjs');
const DAY = 86400, AM_APEX = 1 / 81.119;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const norm = (v) => Math.hypot(...v);
const src41 = K.importSignal(sample41());
const chain = K.run(src41, K.defaults());

test('snapshots: sha256 matches each sidecar; the kernels are ideas 39 and 40 committed files, byte for byte', () => {
  const dir = path.join(HERE, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((x) => !x.endsWith('.provenance.json'))) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
    assert.equal(sha, side.writtenSha256, f + ' was changed after its sidecar was written');
    for (const k of ['repo', 'path', 'commit']) assert.ok(side[k], f + ' sidecar lacks ' + k);
  }
  assert.ok(fs.readFileSync(path.join(dir, 'lambert.js')).equals(fs.readFileSync(path.join(HERE, '..', '39-lamberts-road', 'lambert.js'))), 'lambert.js is idea 39\'s');
  assert.ok(fs.readFileSync(path.join(dir, 'coast.js')).equals(fs.readFileSync(path.join(HERE, '..', '40-long-coast', 'coast.js'))), 'coast.js is idea 40\'s');
  assert.deepEqual(sample41(), JSON.parse(fs.readFileSync(path.join(HERE, '..', '41-signal', 'handoff.json'), 'utf8')), 'the wrapped 41 sample is idea 41\'s committed handoff');
});

test('closed forms: rocket equation, a braking burn\'s length, NEAR\'s specific impulse, sunlight, the Hill radius', () => {
  // NEAR Shoemaker (NSSDCA): 1450 m/s from 318 kg of propellant on 487 kg dry -> 1450 / (g0 ln(805/487)) = 294.20 s
  close(K.nearIsp(), 1450 / (9.80665 * Math.log(805 / 487)), 1e-9, 'NEAR effective Isp');
  close(K.nearIsp(), 294.20, 0.01, 'NEAR Isp worked by hand');
  // finite burn: duration x mass flow = propellant; distance against an independent RK4 of dv/dt = -F/m, dm/dt = -F/ve
  const m0 = 2000, F = 450, isp = 294.2, dv = 4000, v0 = 4150, fb = K.finiteBurn(m0, dv, F, isp, v0), ve = isp * 9.80665;
  close(fb.propellant_kg, m0 * (1 - Math.exp(-dv / ve)), 1e-9, 'propellant');
  close(fb.duration_s * F / ve, fb.propellant_kg, 1e-6, 'duration x mdot');
  let v = v0, m = m0, s = 0; const n = 20000, h = fb.duration_s / n;
  const f = (vv, mm) => [-F / mm, -F / ve];
  for (let i = 0; i < n; i++) {
    const k1 = f(v, m), k2 = f(v + h / 2 * k1[0], m + h / 2 * k1[1]), k3 = f(v + h / 2 * k2[0], m + h / 2 * k2[1]), k4 = f(v + h * k3[0], m + h * k3[1]);
    const dvv = h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); s += h * (v + dvv / 2); v += dvv; m += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  }
  close(v, v0 - dv, 1e-6, 'speed after the burn');
  close(fb.distance_m, s, 1e-3 * s / 1000, 'braking distance (closed form vs RK4)');
  // solar pressure at 1 au = L / (4 pi au^2 c) (idea 40's formula) and AAS 24-063's G1 = 1e8 kg km^3/s^2/m^2 (1e17 SI)
  close(K.P1AU, 3.828e26 / (4 * Math.PI * 149597870700 ** 2 * 299792458), 1e-15, 'P at 1 au');
  close(K.P1AU * K.AU ** 2 / 1e17, 1.0157, 0.0005, 'P au^2 is 1.6% above the G1 Scheeres rounds to 1e8');
  // Hill radius of Bennu at 1 au, by hand: au (GM / (3 GM_sun))^(1/3)
  const reg = K.regimes(4.8904, 149597870700, 0, 1);
  close(reg.hill_radius_m, 149597870700 * Math.cbrt(4.8904 / (3 * 1.32712440018e20)), 1e-6, 'Hill radius');
  close(reg.hill_radius_m / 1000, 34.517, 0.001, 'Bennu\'s Hill radius at 1 au, km (by hand: cbrt(1.2283e-20) au)');
});

test('the SAM frame (AAS 19-035 p. 4) and Table 1\'s phase angles', () => {
  const D = K.horizons.orex.daily, A = { r: D.bennuHelio[0].slice(0, 3), v: D.bennuHelio[0].slice(3) }, F = K.samAxes(A);
  for (const [a, b, want] of [['x', 'x', 1], ['y', 'y', 1], ['z', 'z', 1], ['x', 'y', 0], ['x', 'z', 0], ['y', 'z', 0]]) close(F[a][0] * F[b][0] + F[a][1] * F[b][1] + F[a][2] * F[b][2], want, 1e-12, a + '.' + b);
  close(F.x.reduce((s, x, i) => s + x * A.r[i], 0) / norm(A.r), -1, 1e-12, 'x points at the Sun');
  const h = [A.r[1] * A.v[2] - A.r[2] * A.v[1], A.r[2] * A.v[0] - A.r[0] * A.v[2], A.r[0] * A.v[1] - A.r[1] * A.v[0]];
  close(F.z.reduce((s, x, i) => s + x * h[i], 0) / norm(h), -1, 1e-12, 'z against the orbital angular momentum');
  // the phase angle of each Table 1 row from its latitude and longitude: acos(cos lat cos lon)
  const T = K.sources.aas19035.table1, off = [];
  for (const r of T) { const a = K.samAngles(K.fromSam(r[2] * 1000, r[3], r[4], A), A); close(a.lat_deg, r[3], 1e-9, 'lat'); close(a.lon_deg, r[4], 1e-9, 'lon'); off.push(Math.abs(a.phase_deg - r[6])); }
  // five rows within the table's rounding; AAM-1's printed 58.0 deg is 57.75 from its own 20.5/55.3 (a finding)
  assert.deepEqual(off.map((x) => x < 0.06), [false, true, true, true, true, true, true, true]);
  close(off[0], 0.224, 0.001, 'AAM-1 phase discrepancy');
});

test('oracle: the H-G law reproduces Horizons\' APmag (Bennu from OSIRIS-REx, Apophis from the Earth)', () => {
  const c = K.hgCheck();
  assert.equal(c[0].rows + c[1].rows, 77);
  for (const q of c) assert.ok(q.worst_mag < 0.001, q.label + ' worst ' + q.worst_mag);
  assert.ok(c[1].phase_deg[1] > 100 && c[0].phase_deg[0] < 4, 'phase angles from 3 to 105 deg are covered');
  const v = K.orexFirstImageV();
  close(v.V, 13.084, 0.001, 'Bennu at OSIRIS-REx\'s first PolyCam image (Horizons APmag 13.084)');
  close(v.range_m / 1e9, 2.2, 0.01, 'about 2.2 million km (AAS 19-035: ~2,184,000 km)');
});

test('oracle: each Approach maneuver measured from Horizons\' reconstructed trajectory equals AAS 19-035 Table 3', () => {
  const T3 = Object.fromEntries(K.sources.aas19035.table3.map((r) => [r[0], r]));
  const tol = { 'AAM-1': 0.002, 'AAM-2': 0.001, 'AAM-3': 0.001, 'AAM-3a': 0.0006, 'AAM-4': 0.0003, M0P: 0.0003 };
  for (const ev of Object.keys(tol)) {
    const m = K.measuredDv(ev, 3, AM_APEX);
    close(m.dv_m_s, T3[ev][3], tol[ev], ev + ' measured vs Table 3 estimated');
  }
  // over 12 h either side the Sun's tide adds ~0.07 m/s at 175,000 km: the raw velocity difference misses AAM-1 by that,
  // the ballistic model takes it out (the model is doing work, not the data alone)
  const o = K.burnRows('AAM-1'), raw = norm(o[12].rel.slice(3).map((x, i) => x - o[-12].rel[3 + i]));
  assert.ok(Math.abs(raw - T3['AAM-1'][3]) > 0.05, 'raw difference ' + raw);
  close(K.measuredDv('AAM-1', 12, AM_APEX).dv_m_s, T3['AAM-1'][3], 0.005, 'AAM-1 from 12 h either side');
});

test('oracle: the planner, started from the flown state, reproduces each designed maneuver (Table 3 nominal)', () => {
  const T3 = Object.fromEntries(K.sources.aas19035.table3.map((r) => [r[0], r[2]]));
  const cases = [['AAM-1', 'AAM-2', 0.2], ['AAM-2', 'AAM-3', 0.05], ['AAM-3', 'AAM-3a', 0.02], ['AAM-3a', 'AAM-4', 0.002], ['AAM-4', 'M0P', 0.005], ['M0P', 'Arrival', 0.0015]];
  const got = {};
  for (const [ev, nx, tol] of cases) { const p = K.plannedDv(ev, nx, AM_APEX); got[ev] = p.dv_m_s; close(p.dv_m_s, T3[ev], tol, ev + ' planned vs designed'); }
  close(got['AAM-1'], 351.191, 0.002, 'AAM-1 (pinned: 0.03% under the design)');
  close(got['AAM-3a'], 0.0609, 0.0003, 'AAM-3a, the clean-up of AAM-3\'s execution error');
});

test('oracle: the as-flown Bennu case lands on Table 1 after 61 days, and its ballistic gaps are what they are', () => {
  const R = K.run(K.orexCase(), K.defaults());
  const b = R.burns[0];
  close(b.range_m / 1000, 175000, 175, 'AAM-1 range');
  close(b.lat_deg, 20.5, 0.1, 'AAM-1 solar latitude'); close(b.lon_deg, 55.3, 0.15, 'AAM-1 solar longitude');
  close(b.speed_before_m_s, 491.3, 0.05, 'pre-burn speed (Table 1: 491.3 m/s)');
  close(b.dv_m_s, 351.2984, 0.05, 'AAM-1 from 1 Aug (Table 3 nominal)');
  close(R.burns[1].speed_before_m_s, 141, 0.5, 'AAM-2 pre-burn speed (Table 1: 141)'); close(R.burns[2].speed_before_m_s, 5.2, 0.05, 'AAM-3 (5.2)');
  // the gap to reality: 61 days from 3 million km, and the last 17 days from 150 km
  close(K.ballistic(0, 61, AM_APEX, 4.8904).final_m / 1000, 135.67, 1, '61-day miss with OSIRIS-APEX\'s area per mass, km');
  close(K.ballistic(0, 61, 0, 4.8904).final_m / 1000, 404.6, 2, 'without sunlight, km');
  close(K.ballistic(104, 121, AM_APEX, 4.8904).final_m, 4423, 50, 'Nov 13-30 miss, m (the navigation team predicted to 500 m over two weeks)');
  close(K.ballistic(104, 121, 0, 4.8904).final_m / 1000, 65.27, 0.5, 'without sunlight, km');
});

test('oracle: OSIRIS-REx\'s first orbit (Orbital A, Horizons) gives back Bennu\'s SBDB mass', () => {
  for (const h of [48, 120, 240]) {
    const f = K.fitOrbitA(h);
    assert.ok(!f.failed);
    assert.ok(Math.abs(f.GM_m3_s2 / 4.8904 - 1) < 0.01, h + ' h: GM ' + f.GM_m3_s2 + ' vs SBDB 4.8904 (Chesley et al. 2020)');
    assert.ok(f.rms_m < 30, h + ' h: rms ' + f.rms_m);
    assert.ok(Math.abs(f.am_m2_kg * 81.119 - 1) < 0.05, h + ' h: area per mass ' + f.am_m2_kg + ' vs OSIRIS-APEX\'s 1/81.119');
  }
  close(K.fitOrbitA(240).GM_m3_s2, 4.9107, 0.002, '10-day fit (pinned)');
});

test('oracle: the kernel against the ANH3BP integrated in Python (AAS 24-063 eqs. 1-3, scipy DOP853)', () => {
  const C = require('./oracle/cases.json'), O = require('./oracle/anh3bp-oracle.json');
  const tol = { 'apophis-terminator-3km': 0.003, 'apophis-standoff-drift': 0.003, 'apophis-closing-1000km': 0.05, 'bennu-orbit-a': 0.001 };
  C.cases.forEach((c, i) => {
    const ctx = { mu: c.mu, radius: 0, astAt: K.conic(c.ast_r, c.ast_v, c.t0), am: c.am, cr: c.cr, shadow: false };
    const f = K.fly(c.t0, c.rho0.concat(c.v0), c.t1, ctx), d = norm(f.y.slice(0, 3).map((x, j) => x - O.results[i].rho1_m[j]));
    assert.ok(d < tol[c.name], c.name + ': ' + d + ' m apart');
    assert.ok(norm(f.y.slice(0, 3).map((x, j) => x - c.rho0[j])) > 100, c.name + ' moved');
  });
  // the oracle's beta for the chain is the kernel's regimes() number
  close(O.results[0].beta, chain.regimes.beta, 1e-6 * chain.regimes.beta, 'beta~');
});

test('physics: the dark-side equilibrium holds still, hover costs match their deadband flight, orbits around Bennu', () => {
  // a circular orbit for the asteroid: the ANH3BP equilibrium 1/x^2 = beta + 3x holds a particle still in the rotating frame
  const d = 1.5e11, vc = Math.sqrt(K.MU_SUN / d), mu = 2.68, ctx = { mu, radius: 170, astAt: K.conic([d, 0, 0], [0, vc, 0], 0), am: AM_APEX, cr: 1, shadow: false };
  const reg = K.regimes(mu, d, AM_APEX, 1), x = reg.dark_equilibrium_m / reg.du_m;
  close(1 / (x * x), reg.beta + 3 * x, 1e-9, 'equilibrium condition');
  const w = vc / d, th = w * 3 * DAY, drift = (s) => { const p0 = [reg.dark_equilibrium_m * s, 0, 0], f = K.fly(0, p0.concat([0, w * p0[0], 0]), 3 * DAY, ctx); return norm(f.y.slice(0, 3).map((q, i) => q - [p0[0] * Math.cos(th), p0[0] * Math.sin(th), 0][i])); };
  assert.ok(drift(1) < 0.1, 'at the equilibrium, 3 days: ' + drift(1) + ' m');
  assert.ok(drift(1.01) > 30, '1% further out falls away (a saddle): ' + drift(1.01) + ' m');
  // the chain's stand-off: a deadband flown 60 days costs what the control acceleration predicts, within 15%
  const db = K.deadband(chain.ap.standoff.t, chain.ap.standoff.r, chain.ap.ctx, 1000, 60);
  close(db.dv_per_day_m_s / db.predicted_per_day_m_s, 1, 0.05, 'deadband vs control acceleration averaged over the flight');
  assert.ok(db.predicted_per_day_m_s > 1.1 * db.predicted_at_start_per_day_m_s, 'sunlight grows toward perihelion: the start alone underestimates');
  close(chain.hover.dv_per_day_m_s * 1000, 6.78, 0.02, 'hover at 18.6 km, mm/s per day (pinned)');
  // the hover cost is the size of (need - natural), and sunlight dominates at 18.6 km
  assert.ok(chain.hover.srp_m_s2 > 9 * chain.hover.gravity_m_s2, 'sunlight ' + chain.hover.srp_m_s2 + ' vs gravity ' + chain.hover.gravity_m_s2);
  // orbit scan at Bennu: OSIRIS-REx flew terminator orbits at 1.6-2.1 km (Orbital A) and 0.9 km (Orbital B); circular ones there survive 30 days
  const bennu = K.run(K.orexCase(), Object.assign(K.defaults(), { scan: true }));
  const live = bennu.scan.filter((r) => r.terminator.fate === 'survived').map((r) => r.r_m);
  assert.ok(Math.min(...live) < 900 && Math.max(...live) > 2100, 'survivors ' + live.map((x) => (x / 1000).toFixed(2)).join(', '));
  assert.ok(bennu.scan[bennu.scan.length - 1].terminator.fate === 'escape', 'at the Hill radius the orbit escapes');
});

test('chain: idea 41\'s committed sample passes idea 41\'s own parser, and this module reads its arrival', () => {
  const S41 = require('../41-signal/load.cjs');
  const p = S41.K.parseHandoff(sample41());
  assert.ok(!p.refusal, JSON.stringify(p.refusal));
  assert.ok(!src41.refusal);
  assert.equal(K.utcOf(src41.arrival.t), '2028-05-09T18:15:00.000Z');
  close(norm(src41.arrival.v), 4156.094209, 1e-5, 'arrival v-infinity');
  close(norm(src41.arrival.rho), 21.7, 0.1, 'idea 40\'s aim: 21.7 m from the centre');
  close(src41.link.rtlt_s, 687.627903, 1e-6, 'round trip light time');
  close(src41.knowledgeSigma_m, 6129.986, 0.001, 'idea 40\'s knowledge');
});

test('chain: the Apophis approach (defaults), pinned', () => {
  const R = chain, B = R.burns;
  assert.deepEqual(B.map((b) => b.name), ['AAM-1', 'AAM-2', 'AAM-3', 'AAM-3a', 'AAM-4', 'M0P', 'Stand-off']);
  close(B[0].range_m / 1000, 175000, 0.01, 'AAM-1 at 175,000 km');
  close((src41.arrival.t - B[0].t) / 3600, 11.70, 0.01, 'hours before the nominal arrival');
  close(B[0].dv_m_s, 4012.166, 0.01, 'AAM-1 dv'); close(B[1].dv_m_s, 137.762, 0.01, 'AAM-2 dv');
  close(R.mass.burns_dv_m_s, 4155.33, 0.05, 'approach dv');
  close(R.mass.required_propellant_kg, 1654.3, 0.5, 'propellant on NEAR\'s 487 kg');
  close(B[0].duration_s / 3600, 2.75, 0.01, 'AAM-1 burn at 450 N, h');
  close(B[0].distance_m / 1000, 25755, 5, 'km covered while braking');
  assert.equal(K.utcOf(R.ap.standoff.t).slice(0, 16), '2028-07-11T06:33');
  close(R.regimes.hill_radius_m / 1000, 23.98, 0.01, 'Hill radius, km');
  close(R.detection.leadToFirstBurn_s / DAY, 11.21, 0.05, 'days from first sight to AAM-1');
  close(R.knowledge.asteroid_m, 1235.1, 0.1, 'Apophis 1-sigma at the arrival (Horizons)');
  assert.deepEqual(R.refusals.map((r) => r.applies_to).sort(), ['body_mass', 'gravity_field', 'spacecraft', 'tankage']);
});

test('chain: refusals that travel, and the ones the settings raise', () => {
  // as-built tanks: NEAR's 318 kg cannot brake 4.2 km/s
  const asb = K.run(src41, Object.assign(K.defaults(), { tanks: 'asbuilt' }));
  assert.equal(asb.refusal.applies_to, 'tankage'); assert.equal(asb.refusal.code, 'out_of_envelope');
  // a stay through Apophis's April 2029 Earth pass brings in the Earth's tide
  const stay = K.run(src41, Object.assign(K.defaults(), { stayDays: 300 }));
  assert.ok(stay.refusals.some((r) => r.applies_to === 'planets'), 'planets refusal');
  // a stand-off outside the Hill sphere, a 10 m box (burns every few hours), a custom engine with no Isp
  assert.ok(K.run(src41, Object.assign(K.defaults(), { standoff_m: 40000 })).refusals.some((r) => r.applies_to === 'standoff'));
  assert.ok(K.run(src41, Object.assign(K.defaults(), { box_m: 10 })).refusals.some((r) => r.applies_to === 'station_keeping'));
  assert.equal(K.run(src41, Object.assign(K.defaults(), { craft: 'custom' })).refusal.code, 'insufficient_data');
  // a 3 kN engine with the custom spacecraft: no tankage problem when its tanks suffice
  const big = K.run(src41, Object.assign(K.defaults(), { craft: 'custom', isp_s: 320, dry_kg: 1000, propellant_kg: 5000, tanks: 'asbuilt' }));
  assert.ok(!big.refusal && !big.refusals.some((r) => r.applies_to === 'tankage'));
  // GM cases: AAS 24-063's range moves the Hill radius as its cube root
  const lo = K.run(src41, Object.assign(K.defaults(), { gmCase: 'min' })), hi = K.run(src41, Object.assign(K.defaults(), { gmCase: 'max' }));
  close(hi.regimes.hill_radius_m / lo.regimes.hill_radius_m, Math.cbrt(4.37 / 1.36), 1e-9, 'Hill radius scales as GM^(1/3)');
  // ten bad settings, each refused, never computed
  for (const bad of [{ dry_kg: -1 }, { isp_s: 'x' }, { template: 'zig' }, { standoff_m: 1 }, { box_m: 0 }, { am_m2_kg: 1 }, { gm: 'guess' }, { stayDays: -2 }, { tanks: 'full' }, { scan: 'yes' }]) {
    const r = K.run(src41, Object.assign(K.defaults(), bad));
    assert.equal(r.refusal && r.refusal.code, 'invalid_input', JSON.stringify(bad));
  }
});

test('chain: edited or wrong handoffs are refused', () => {
  const edit = (f) => { const h = JSON.parse(JSON.stringify(sample41())); f(h); return K.importSignal(h); };
  const AS = (h) => h.inputs.long_coast_handoff.outputs.arrival_state.value;
  assert.ok(edit((h) => { AS(h).v_m_s[0] += 1; }).refusal, 'v-infinity no longer spacecraft minus target');
  assert.ok(edit((h) => { h.outputs.arrival_link.value.owlt_s *= 1.001; }).refusal, 'light time off');
  assert.ok(edit((h) => { h.refusals = h.refusals.filter((r) => r.applies_to !== 'uplink'); }).refusal, 'own refusal dropped');
  assert.ok(edit((h) => { AS(h).r_m[0] += 2e5; }).refusal, 'arrival 200 km from the target');
  const h40 = K.importSignal(sample41().inputs.long_coast_handoff);
  assert.match(h40.refusal.what_would_help, /idea 41/);
  assert.equal(K.importSignal('{not json').refusal.code, 'invalid_input');
});

test('handoff: the committed sample is what its inputs give, every output is labelled, edits are refused', () => {
  const h = JSON.parse(fs.readFileSync(path.join(HERE, 'handoff.json'), 'utf8'));
  assert.equal(h.from, '42-closing-in');
  const p = K.parseHandoff(h);
  assert.ok(!p.refusal, JSON.stringify(p.refusal));
  for (const [k, o] of Object.entries(h.outputs)) { assert.ok(o.units && o.source, k); assert.ok(['measured', 'derived', 'assumed'].includes(o.confidence), k); }
  assert.ok(h.refusals.filter((r) => r.from === '41-signal').length === 3 && h.refusals.filter((r) => r.from === '40-long-coast').length === 3, 'upstream refusals carried');
  const again = K.buildHandoff(chain, h.produced);
  assert.deepEqual(JSON.parse(JSON.stringify(again.outputs)), h.outputs, 'the defaults build the sample');
  const bad = (f) => { const q = JSON.parse(JSON.stringify(h)); f(q); return K.parseHandoff(q).refusal; };
  assert.ok(bad((q) => { q.outputs.standoff_state.value.r_m[0] *= 1 + 1e-5; }), 'stand-off moved');
  assert.ok(bad((q) => { q.outputs.body.value.GM_m3_s2 = 3; }), 'GM changed');
  assert.ok(bad((q) => { q.outputs.mass.value.standoff_kg *= 1.001; }), 'mass changed');
  assert.ok(bad((q) => { q.refusals.pop(); }), 'refusal dropped');
  assert.ok(bad((q) => { q.inputs.settings.box_m = 2000; }), 'setting changed');
  // the as-flown case round-trips without a 41 handoff
  const o = K.buildHandoff(K.run(K.orexCase(), K.defaults()), '2026-10-31T12:00:00Z');
  assert.ok(!K.parseHandoff(JSON.parse(JSON.stringify(o))).refusal);
});

test('physics, checked one by one: shadow, holding a rotating point, the hover cost at the equilibrium, each leg\'s arrival', () => {
  // the asteroid's shadow: no sunlight straight behind it (within its radius), full sunlight just outside
  const ctx = chain.ap.ctx, t = chain.ap.standoff.t, A = ctx.astAt(t), u = A.r.map((x) => x / norm(A.r)), F = K.samAxes(A);
  const srpAt = (rho) => norm(K.accel(t, rho, Object.assign({}, ctx, { parts: true })).srp);
  assert.equal(srpAt(u.map((x) => x * 2000)), 0, 'in the shadow');
  close(srpAt(u.map((x, i) => x * 2000 + F.y[i] * 1.2 * ctx.radius)), chain.regimes.srp_accel_m_s2, 0.01 * chain.regimes.srp_accel_m_s2, 'beside it');
  // the stand-off is held in the rotating SAM frame: velocity omega x r, a few mm/s
  const so = chain.ap.standoff, w = K.samAxes(ctx.astAt(so.t)).omega, want = [w[1] * so.r[2] - w[2] * so.r[1], w[2] * so.r[0] - w[0] * so.r[2], w[0] * so.r[1] - w[1] * so.r[0]];
  assert.ok(norm(so.v.map((x, i) => x - want[i])) < 1e-12, 'omega x r'); close(norm(so.v) * 1000, norm(w) * 18600 * Math.cos(22.3 * Math.PI / 180) * 1000, 1e-6, '|omega| r cos(latitude 22.3 deg), mm/s');
  // on a circular orbit, holding the dark-side equilibrium costs nothing (every frame term is needed for that)
  const d = 1.5e11, vc = Math.sqrt(K.MU_SUN / d), cctx = { mu: 2.68, radius: 170, astAt: K.conic([d, 0, 0], [0, vc, 0], 0), am: AM_APEX, cr: 1, shadow: false };
  const reg = K.regimes(2.68, d, AM_APEX, 1), h = K.hover(0, [reg.dark_equilibrium_m, 0, 0], cctx, 1000);
  assert.ok(h.accel_m_s2 < 1e-12, 'hover cost at the equilibrium ' + h.accel_m_s2 + ' (sunlight alone is ' + reg.srp_accel_m_s2 + ')');
  assert.ok(h.frame_m_s2 > 1e-10, 'and the frame term it needs is not negligible: ' + h.frame_m_s2);
  // each burn, flown on, reaches the next burn's position within 1 m (the targeting tolerance)
  const B = chain.ap.burns;
  for (let k = 0; k + 1 < B.length; k++) {
    const f = K.fly(B[k].t, B[k].r.concat(B[k].vAfter), B[k + 1].t, ctx);
    assert.ok(norm(f.y.slice(0, 3).map((x, i) => x - B[k + 1].r[i])) <= 1.0, B[k].name + ' leg misses by ' + norm(f.y.slice(0, 3).map((x, i) => x - B[k + 1].r[i])));
  }
});

test('navigation and the chain\'s numbers, checked one by one', () => {
  // the arrival offset is spacecraft minus target (idea 40's aim point), not the reverse
  const AS = sample41().inputs.long_coast_handoff.outputs.arrival_state.value;
  assert.deepEqual(src41.arrival.rho, AS.r_m.map((x, i) => x - AS.target_r_m[i]));
  // a v-infinity vector turned but kept at its magnitude is still refused
  const h = JSON.parse(JSON.stringify(sample41())), V = h.inputs.long_coast_handoff.outputs.arrival_state.value.v_infinity_arrival_m_s;
  [V[0], V[1]] = [V[1], V[0]];
  assert.ok(K.importSignal(h).refusal, 'turned v-infinity');
  // the camera: PolyCam's 13.5 urad pixel and 0.1-pixel centroids (AAS 19-035 Table 2, p. 7) at the first-image range
  close(chain.detection.lateralSigma(2184000e3), 2184000e3 * 13.5e-6 * 0.1, 1e-6, 'line-of-sight sigma at 2,184,000 km');
  close(chain.detection.lateralSigma(2184000e3), 2948.4, 0.1, 'by hand, m');
  // the Earth's tide: a stay to 26 March 2029 meets the week of 30 March, where it is 2.2% of the Sun's
  const st = K.run(src41, Object.assign(K.defaults(), { stayDays: 258 }));
  close(st.earthTide.ratio, 0.0221, 0.0005, 'tide ratio'); assert.ok(st.refusals.some((r) => r.applies_to === 'planets'), 'refused at 2%');
  close(chain.earthTide.ratio, 1.755e-4, 0.002e-4, 'the default stay\'s worst week (2028-09-15)');
});
