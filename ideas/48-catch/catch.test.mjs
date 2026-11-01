// Idea 48 (Catch): tests. node --test ideas/48-catch/catch.test.mjs (Node built-ins only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const { K, deps, chain } = require('./load.cjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const relNear = (a, b, tol, msg) => assert.ok(Math.abs(a / b - 1) <= tol, `${msg}: ${a} vs ${b} (rel ${Math.abs(a / b - 1)}, tol ${tol})`);
const ORACLE = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle/entry-oracle.json'), 'utf8'));
const CASES = JSON.parse(fs.readFileSync(path.join(HERE, 'oracle/cases.json'), 'utf8'));
const DEG = Math.PI / 180;

// One run of the chain's defaults, shared (a run takes about a second).
const R0 = K.run(K.defaults(), null);

test('snapshots: sidecars, byte-identical copies of earlier modules, the wrapped handoff, the sources', () => {
  const dir = path.join(HERE, 'snapshots');
  for (const f of fs.readdirSync(dir).filter((f) => !f.endsWith('.provenance.json'))) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    for (const k of ['repo', 'path', 'commit']) assert.ok(side[k], `${f} sidecar has ${k}`);
    if (side.writtenSha256) assert.equal(sha(fs.readFileSync(path.join(dir, f))), side.writtenSha256, `${f} still hashes to its sidecar`);
  }
  const same = [['isa.js', 'ideas/35-max-q/snapshots/isa.js'], ['earth.js', 'ideas/35-max-q/snapshots/earth.js'], ['de440-constants.js', 'ideas/47-way-home/snapshots/de440-constants.js'],
    ['erfa-iau2006.js', 'ideas/47-way-home/snapshots/erfa-iau2006.js'], ['tip-match.js', 'ideas/01-tip-match/tip-match.js'], ['rev_a.data.js', 'ideas/01-tip-match/snapshots/rev_a.data.js'],
    ['aster.data.js', 'ideas/01-tip-match/snapshots/aster.data.js']];
  for (const [a, b] of same) assert.equal(sha(fs.readFileSync(path.join(dir, a))), sha(fs.readFileSync(path.join(BANK, b))), `${a} is byte-identical to ${b}`);
  const h47 = JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/47-way-home/handoff.json'), 'utf8'));
  assert.deepEqual(deps.chain.handoff, h47, 'the wrapped handoff is idea 47\'s, JSON-equal');
  assert.equal(deps.chain.digest.sha256, sha(JSON.stringify(h47)), 'digest is node:crypto sha256 of JSON.stringify');
  // every number taken from a document sits in its quote
  const S = deps.sources;
  for (const q of S.quotes.filter((q) => q.key !== 'prose')) assert.ok(q.quote.length > 10, q.key);
  assert.equal(S.stardust.peak_g_bet, 32.89); assert.equal(S.genesis.peak_g_bet, 27.0); assert.equal(S.osirisrex.pred_peak_g, 32);
  assert.ok(S.quotes.some((q) => q.key === 'stardust.peak_g_bet' && q.quote.includes('32.89 Earth g')));
  assert.ok(S.quotes.some((q) => q.key === 'sutton_graves.K_air' && q.quote.includes('.1113')));
  assert.equal(S.moon.a_m, 384.4e6); assert.equal(S.moon.radius_m, 1737.4e3);
  // the spheroid: pck00010's line, parsed
  assert.match(deps.radii.line, /6378\.1366\s+6378\.1366\s+6356\.7519/);
  assert.equal(deps.radii.c_m, 6356751.9);
});

test('closed forms: Allen-Eggers, a lifting skip, Sutton-Graves, vis-viva, Kepler', () => {
  // Allen & Eggers (NACA TR 1381): flat, no gravity, exponential air: peak deceleration VE^2 sin(gamma) / (2 e H)
  const veh = K.vehicle('stardust'); veh.cd = 1.5;
  for (const g of [-5, -8.2, -15, -30]) {
    const X = { rho0: 1.225, H: 7000, top: 150000, gravity: false, a: 300, flat: true, up0: [0, 0, 1] };
    const x = { r: [0, 0, K.RE + 150000], v: [12000 * Math.cos(g * DEG), 0, 12000 * Math.sin(g * DEG)] };
    const f = K.fly(x, veh, { atm: X, dt: 0.02, vStop: 100 });
    relNear(f.peak_g, K.allenEggers(12000, g, 7000).peak / K.G0, 5e-5, `Allen-Eggers at ${g} deg`);
  }
  // a lifting skip, flat, no gravity: dV/V = -dgamma/(L/D), so V_exit = V_E exp(-2|gamma_E|/(L/D)) (Vinh et al. 1980)
  const L = K.vehicle('apollo'); const LD = L.cl / L.cd;
  for (const g of [-2, -4]) {
    const X = { rho0: 1.225, H: 7000, top: 150000, gravity: false, a: 300, flat: true, up0: [0, 0, 1] };
    const x = { r: [0, 0, K.RE + 150000], v: [11000 * Math.cos(g * DEG), 0, 11000 * Math.sin(g * DEG)] };
    const f = K.fly(x, L, { atm: X, dt: 0.02, vStop: 100, bankDeg: 0 });
    assert.equal(f.end, 'exit', 'it skips');
    const V = Math.hypot(f.v[0], f.v[1], f.v[2]);
    relNear(V, 11000 * Math.exp(-2 * Math.abs(g) * DEG / LD), 2e-4, `lifting skip exit speed at ${g} deg`);
    near(Math.atan2(f.v[2], f.v[0]) / DEG, -g, 0.02, 'exit angle mirrors the entry angle');
  }
  // Sutton & Graves's air coefficient, Table II, with Newtonian p_s = rho V^2 and h_s = V^2/2: k = K / (2 sqrt(1 atm))
  near(K.K_SG, 0.1113 / (2 * Math.sqrt(101325)), 1e-15, 'k from K');
  near(K.K_SG, 1.7483e-4, 5e-8, 'k by hand');
  // propulsive capture by hand: vis-viva at perigee
  const c3 = 5857.7452 ** 2, rp = K.RE + 407000;
  near(K.propulsive(c3, rp, rp).dv, Math.sqrt(c3 + 2 * K.MU / rp) - Math.sqrt(K.MU / rp), 1e-9, 'capture into a circle');
  // the arrival hyperbola at an entry angle: radius, speed, angle, energy, asymptote, perigee, B
  const a = K.importWayHome(chain());
  for (const g of [-3, -6.5, -12]) {
    const H = K.hyperbolaEntry(a.vinfVec, a.hHat, g, a.rEI);
    const r = Math.hypot(...H.r), v = Math.hypot(...H.v);
    near(r, a.rEI, 1e-6, 'at the entry radius');
    near(v, Math.sqrt(a.vinf ** 2 + 2 * K.MU / a.rEI), 1e-9, 'vis-viva speed');
    near(K.angles(H.r, H.v).fpa, g, 1e-9, 'the flight-path angle asked for');
    const el = K.elements(H.r, H.v);
    // incoming asymptote of the computed conic equals the given v-infinity direction
    const P = el.ev.map((x) => x / el.e), hh = el.h.map((x) => x / el.hn), Q = [hh[1] * P[2] - hh[2] * P[1], hh[2] * P[0] - hh[0] * P[2], hh[0] * P[1] - hh[1] * P[0]];
    const S = P.map((p, i) => p / el.e + Q[i] * Math.sqrt(el.e ** 2 - 1) / el.e), S0 = a.vinfVec.map((x) => x / a.vinf);
    near(S[0] * S0[0] + S[1] * S0[1] + S[2] * S0[2], 1, 1e-12, 'asymptote direction');
    near(el.rp, H.rp, 1e-3, 'perigee'); near(K.bOfPerigee(a.vinf, H.rp), H.B, 1e-3, 'B from the perigee');
  }
  // Kepler: the analytic coast to a radius against RK4 through the same two-body force (fly() with no air)
  const rP = K.RE + 300000, vP = Math.sqrt(K.MU * (2 / rP - 2 / (rP + K.RE + 35786000)));
  const el = K.elements([rP, 0, 0], [0, vP, 0]);
  const c = K.coastTo([rP, 0, 0], [0, vP, 0], el.p, false);   // r = p: true anomaly 90 deg
  near(Math.atan2(c.r[1], c.r[0]) / DEG, 90, 1e-9, 'true anomaly 90 deg at r = p');
  const num = K.fly({ r: [rP, 0, 0], v: [0, vP, 0] }, K.vehicle('stardust'), { atm: { rho0: 0, H: 7000, top: 1e12, sphere: true }, dt: 1, tStop: c.dt, vStop: -1, tMax: 1e6 });
  near(Math.hypot(num.r[0] - c.r[0], num.r[1] - c.r[1], num.r[2] - c.r[2]), 0, 1, 'RK4 lands where Kepler says (m)');
});

test('reality: flown capsules (NASA reconstructions and predictions) and the spheroid that makes them agree', () => {
  const R = K.reality(), row = (id) => R.rows.find((r) => r.id === id);
  relNear(row('stardust_g').model, 32.89, 0.006, 'Stardust peak deceleration against the BET');            // measured -0.34 %
  near(row('stardust_drogue').model, 31.03, 0.05, 'Stardust altitude 137.9 s after entry against radar');    // measured +0.6 m
  relNear(row('genesis_g').model, 27.0, 0.006, 'Genesis peak deceleration against the BET');               // measured +0.27 %
  relNear(row('orex_g').model, 32, 0.025, 'OSIRIS-REx peak deceleration against the prediction');          // measured -1.71 %
  assert.ok(row('orex_g').heading_range[0] < 32 && row('orex_g').heading_range[1] > 31.4, 'the unknown heading spans the prediction');
  relNear(row('orex_q').model, 720, 0.03, 'OSIRIS-REx convective peak against the predicted total');      // measured -1.94 %
  near(row('orex_tq').model, 53.854, 4, 'OSIRIS-REx peak heating time against the infrared video');         // measured -3.13 s
  // on a sphere (the air's altitude above 6378.1366 km everywhere) the same flights miss by much more: the spheroid matters
  const A = K.arrivalFromFlight('stardust'), sphere = K.fly(A.x0, K.vehicle('stardust'), { atm: null, dt: 0.1, vStop: 300 });
  const X = { sphere: true }, fS = K.fly(A.x0, K.vehicle('stardust'), { atm: X, dt: 0.1, vStop: 300 });
  assert.ok(Math.abs(fS.peak_g / 32.89 - 1) > 0.05, 'sphere: Stardust more than 5 % off');
  near(sphere.peak_g, row('stardust_g').model, 1e-9, 'default is the spheroid');
  const O = K.arrivalFromFlight('osirisrex'), fO = K.fly(O.x0, K.vehicle('osirisrex'), { atm: X, dt: 0.1, vStop: 300 });
  assert.ok(fO.t_peak_q < 45, 'sphere: OSIRIS-REx peak heating 10 s early');
});

test('the independent oracle (Vinh\'s equations, scipy DOP853, ambiance; three-body Moon)', () => {
  const O = ORACLE.cases, R = K.reality();
  const map = { stardust: R.flights.stardust.flight, genesis: R.flights.genesis.flight, osirisrex: R.flights.osirisrex.flight };
  for (const id of Object.keys(map)) {
    const f = map[id], o = O[id];
    relNear(f.peak_g, o.peak_g, 1e-4, `${id} peak g`);
    relNear(f.peak_q, o.peak_q_W_m2, 2e-4, `${id} peak q`);
    relNear(f.heat_J_m2, o.heat_J_m2, 2e-3, `${id} heat load`);
    near(f.t_peak_g, o.t_peak_g, 0.05, `${id} time of peak g`);
    near(f.t_peak_q, o.t_peak_q, 0.05, `${id} time of peak q`);
  }
  near(R.rows.find((r) => r.id === 'stardust_drogue').model * 1000, O.stardust.at_137_9.alt, 1, 'Stardust at 137.9 s');
  // the chain's corridor edges: the oracle's own bisection for the target apoapsis
  for (const id of ['chain_aero_down', 'chain_aero_up', 'chain_aero_mid']) near(O[id].gamma_kernel_deg, O[id].gamma_oracle_deg, 1e-4, `${id} entry angle`);
  const d = R0.options.direct; relNear(d.loads.peak_g, O.chain_direct.peak_g, 5e-4, 'chain direct entry peak g');
  // the kernel's cases.json is the run it was made from
  near(CASES.cases.find((c) => c.id === 'chain_aero_mid').gamma_deg, R0.options.aerocapture.corridor.mid_deg, 1e-9, 'cases.json is current');
  // lunar flyby: patched conics against three bodies
  const L = ORACLE.lunar;
  for (let i = 0; i < CASES.lunar.patched.length; i++) {
    const p = CASES.lunar.patched[i], o = L.find((x) => Math.abs(x.vinf - Math.sqrt(p.c3_before)) < 1);
    assert.ok(Math.abs(p.c3 - o.c3_after_3body) < 0.3e6, `C3 after one flyby at ${Math.sqrt(p.c3_before)} m/s: patched ${p.c3} vs three-body ${o.c3_after_3body}`);
  }
  relNear(K.lunarThreshold(K.MOON.a_m, K.MOON.radius_m), ORACLE.lunar_threshold_3body_m_s, 0.03, 'capture threshold, patched vs three-body');
});

test('the chain: idea 47\'s arrival, every option, the choice and the state handed on', () => {
  const R = R0, A = R.arrival, o = R.options;
  near(A.vinf, 5857.7452, 1e-6, 'v-infinity from idea 47');
  near(A.mass_kg, 9565.40039, 1e-6, 'arrival mass'); assert.equal(A.propellant_kg, 0, 'nothing left to burn');
  near(Math.sqrt(A.vinf ** 2 + 2 * K.MU / A.rEI), 12525.9855, 1e-3, 'entry speed as idea 47 hands it on');
  assert.equal(R.vehicle.id, 'apollo'); near(K.betaOf(R.vehicle), 9565.40039 / (1.269 * 15.34), 1e-9, 'ballistic coefficient');
  // direct entry
  near(o.direct.corridor.shallow_deg, -5.8754, 0.002, 'direct: shallow edge (lift down)');
  near(o.direct.corridor.steep_deg, -11.566, 0.002, 'direct: steep edge (lift up, 40 g)');
  assert.equal(o.direct.corridor.limited_by, 'deceleration');
  near(o.direct.gamma, (o.direct.corridor.shallow_deg + o.direct.corridor.steep_deg) / 2, 1e-12, 'mid-corridor');
  near(o.direct.loads.peak_g, 39.46, 0.02, 'direct: peak g at bank 90'); assert.equal(o.direct.feasible, true);
  // aerocapture
  near(o.aerocapture.corridor.width_deg, 2.992, 0.003, 'aerocapture corridor width');
  near(o.aerocapture.dv_raw, 125.18, 0.1, 'perigee raise'); near(o.aerocapture.dv, o.aerocapture.dv_raw * 1.1, 1e-9, 'with the margin');
  near(o.aerocapture.propellant_needed, 9565.40039 * (1 - Math.exp(-o.aerocapture.dv / A.ve_m_s)), 1e-9, 'Tsiolkovsky');
  assert.equal(o.aerocapture.feasible, false);
  // skip entry
  assert.equal(o.skip.loads.n_passes, 2); near(o.skip.loads.peak_g, 8.56, 0.02, 'skip: worst pass'); assert.equal(o.skip.feasible, true);
  assert.ok(o.skip.second_entry_speed < 8000 && o.skip.second_entry_speed > 7000, 'the second pass enters from a low orbit');
  // propulsive
  near(o.propulsive.dv_raw, Math.sqrt(A.vinf ** 2 + 2 * K.MU / (K.RE + 407000)) - Math.sqrt(K.MU / (K.RE + 407000)), 1e-9, 'propulsive by hand');
  near(o.propulsive.propellant_needed, 6780.3, 0.5, 'propulsive propellant'); assert.equal(o.propulsive.feasible, false);
  const rp407 = K.RE + 407000, ra = deps.sources.moon.a_m;
  near(o.propulsive.loose.dv, 1.1 * (Math.sqrt(A.vinf ** 2 + 2 * K.MU / rp407) - Math.sqrt(2 * K.MU / rp407 - 2 * K.MU / (rp407 + ra))), 1e-9, 'loose orbit to the Moon\'s distance by hand');
  // lunar flyby
  near(o.lunar.vinf_after, 5698.4, 1, 'one flyby leaves 5.70 km/s'); near(o.lunar.threshold_vinf, 1855.24, 0.1, 'threshold');
  assert.equal(o.lunar.feasible, false);
  // Skyhook: idea 01's trims, recomputed here from Rev A by hand
  const rA = deps.revA.data, mu = rA.orbital.mu_earth_m3s2 / 1e9, rtip = 7301, vorb = Math.sqrt(mu / (rtip - 320));
  const vp = Math.sqrt((A.vinf / 1000) ** 2 + 2 * mu / rtip);
  for (const [k, vt] of [['reference', 2.5], ['cislunar', 2.8], ['phase3', 3.5]]) near(o.skyhook.tiers.find((t) => t.tier === k).trim_m_s, (vp - vorb - vt) * 1000, 1e-6, `trim ${k}`);
  near(o.skyhook.min_inclination_deg, 30.8251656, 1e-6, 'arrival plane at least the declination');
  assert.ok(o.skyhook.refusals.some((r) => r.applies_to === 'skyhook_mass'), 'mass over the canon\'s 5000 kg');
  // the choice and the state handed on
  assert.equal(R.choice, 'skip', 'auto: no propellant needed, lowest peak g');
  near(R.entry.fpa_inertial_deg, o.aerocapture.corridor.mid_deg, 1e-9, 'entry angle');
  near(R.entry.altitude_m, 125000, 1e-6, 'at the entry interface');
  near(R.retarget.perigee_alt_m, 56440, 50, 'the perigee to aim at'); near(R.retarget.perigee_alt47_m, 123664.232, 1e-6, 'idea 47\'s');
  assert.ok(R.refusals.some((r) => r.applies_to === 'retarget' && /Set module 47's aim perigee/.test(r.what_would_help)), 'retarget tells module 47 what to aim at');
  assert.equal(R.carried.length, 36, 'idea 47\'s refusals carried');
  assert.equal(K.utcOf(K.tdbOf('2029-04-13T20:18:19.436Z')), '2029-04-13T20:18:19.436Z');
});

test('idea 47\'s handoff: accepted, edits refused', () => {
  const ok = K.importWayHome(chain()); assert.ok(!ok.refusal && ok.chain, 'the bundled chain');
  const edits = [
    (h) => { h.outputs.earth_arrival.value.v_infinity_m_s *= 1.001; },
    (h) => { h.outputs.earth_arrival.value.declination_deg += 0.1; },
    (h) => { h.outputs.earth_arrival.value.entry_speed_m_s += 10; },
    (h) => { h.outputs.mass.value.mass_arrival_kg += 1; },
    (h) => { h.outputs.earth_arrival.value.perigee_altitude_m += 100; },
    (h) => { h.outputs.propulsion.value.ve_m_s += 1; },
    (h) => { h.outputs.earth_arrival.value.utc = '2029-04-13T20:28:19.436Z'; },
    (h) => { h.outputs.earth_arrival.value.perigee_state_geocentric.v_m_s[0] += 50; },
    (h) => { h.outputs.earth_arrival.units = 'km/s'; },
    (h) => { h.outputs.earth_arrival.value.v_infinity_vector_m_s = h.outputs.earth_arrival.value.v_infinity_vector_m_s.map((x) => x * 1.01); },
    (h) => { h.version = 2; },
    (h) => { h.from = '46-split'; },
  ];
  for (const e of edits) { const h = chain(); e(h); const r = K.importWayHome(h); assert.ok(r.refusal && r.refusal.code === 'invalid_input', 'refused: ' + e.toString()); }
  assert.ok(K.importWayHome('not json').refusal); assert.ok(K.importWayHome({}).refusal);
  // a consistent edit (more material, same ledger rule) is a different, valid idea 47 handoff: accepted, not the chain
  const h = chain(); h.outputs.mass.value.material_kg -= 1000; h.outputs.mass.value.mass_arrival_kg -= 1000;
  const r = K.importWayHome(h); assert.ok(!r.refusal && !r.chain, 'consistent edit accepted as imported');
});

test('decisions: limits, targets, the Skyhook at v-infinity*, a slow arrival the Moon could capture, flown capsules', () => {
  // the crew limit of the TransHab study (5 g): no direct corridor
  const crew = K.run(Object.assign(K.defaults(), { gLimit: 5 }), null);
  assert.equal(crew.options.direct.feasible, false, '5 g: no direct entry');
  // a custom arrival at idea 01's v-infinity* for the Phase 3 tier, light enough for the canon
  const vstar = K.TM.tierEnergy('phase3').vinf_star_kms * 1000;
  const sk = K.run(Object.assign(K.defaults(), { arrival: 'custom', custom: { vinf_m_s: vstar, mass_kg: 4000, propellant_kg: 0, isp_s: 423.3 } }), null);
  const tier = sk.options.skyhook.tiers.find((t) => t.tier === 'phase3');
  assert.ok(Math.abs(tier.trim_m_s) < 1e-6 && tier.matched, 'energy-matched at v-infinity*');
  assert.equal(sk.options.skyhook.mass_ok, true); assert.equal(sk.options.skyhook.feasible, false, 'plane and phase still refused');
  near(sk.options.skyhook.release.entry_speed_inertial_m_s, Math.sqrt(4056.3110699 ** 2 + 2 * K.MU * (1 / (6371000 + 125000) - 1 / 6661000)), 0.01, 'lower-tip release by hand');
  // a 1 km/s arrival: one lunar flyby could capture it (energy), phase unknown
  const lu = K.run(Object.assign(K.defaults(), { arrival: 'custom', custom: { vinf_m_s: 1000, mass_kg: 4000, propellant_kg: 0, isp_s: 423.3 } }), null);
  assert.equal(lu.options.lunar.energy_ok, true); assert.ok(lu.options.lunar.c3_after < 0);
  // Stardust as flown: a ballistic capsule cannot aerocapture; its direct corridor is wider than its delivery accuracy
  const sd = K.run(Object.assign(K.defaults(), { arrival: 'stardust' }), null);
  assert.equal(sd.vehicle.id, 'stardust'); assert.equal(sd.options.aerocapture.feasible, false);
  assert.ok(sd.options.aerocapture.refusals[0].reason.includes('ballistic'));
  assert.ok(sd.options.direct.corridor.width_deg > 2 * 0.08, 'corridor wider than +/-0.08 deg');
  assert.ok(sd.options.direct.corridor.shallow_deg > -8.21 && sd.options.direct.corridor.steep_deg < -8.21, 'Stardust\'s -8.21 deg is inside it');
  // Genesis came from L1: bound, so no v-infinity for the Moon or the tether
  const gn = K.run(Object.assign(K.defaults(), { arrival: 'genesis' }), null);
  assert.ok(gn.arrival.c3 < 0); assert.ok(gn.options.lunar.refusals[0].reason.includes('already bound')); assert.ok(gn.options.skyhook.refusals[0].reason.includes('bound'));
  // with propellant aboard, aerocapture becomes feasible and is gentler, but auto still prefers the option that burns none
  const wet = K.run(Object.assign(K.defaults(), { arrival: 'custom', custom: { vinf_m_s: 5857.7452, mass_kg: 9565.4, propellant_kg: 1000, isp_s: 423.3 } }), null);
  assert.equal(wet.options.aerocapture.feasible, true, 'aerocapture feasible with 1 t of propellant');
  assert.ok(wet.options.aerocapture.loads.peak_g < wet.options.skip.loads.peak_g, 'and gentler than the skip');
  assert.equal(wet.choice, 'skip', 'auto: least propellant first');
  // a higher target apoapsis needs a smaller raise burn
  const hi = K.run(Object.assign(K.defaults(), { targetAlt_m: 2000000 }), null);
  assert.ok(hi.options.aerocapture.dv_raw > 0 && hi.options.propulsive.dv_raw < R0.options.propulsive.dv_raw);
});

test('refusals: bad settings', () => {
  const bads = [{ arrival: 'mars' }, { choice: 'teleport' }, { vehicle: 'shuttle' }, { vehicleMass: -5 }, { fpaDeg: 3 }, { fpaDeg: -45 }, { bankDeg: 200 }, { gLimit: 0 }, { qLimit_W_cm2: -1 },
    { targetAlt_m: 100000 }, { lgaAlt_m: -1 }, { moonDist: 'far' }, { tolerance_m_s: -1 }, { tcmDays: 0 }, { margin: 3 }, { gLimit: NaN }, { fpaDeg: NaN },
    { arrival: 'custom', custom: { vinf_m_s: -1, mass_kg: 1, propellant_kg: 0, isp_s: 300 } }, { arrival: 'custom', custom: { vinf_m_s: 3000, mass_kg: 10, propellant_kg: 10, isp_s: 300 } },
    { arrival: 'custom', custom: { vinf_m_s: 3000, mass_kg: 10, propellant_kg: 1, isp_s: NaN } }];
  for (const b of bads) { const r = K.run(Object.assign(K.defaults(), b), null); assert.ok(r.refusal && r.refusal.code === 'invalid_input', 'refused: ' + JSON.stringify(b)); }
});

test('the handoff: the sample, its read-back, edits refused', () => {
  const H = JSON.parse(fs.readFileSync(path.join(HERE, 'handoff.json'), 'utf8'));
  const again = K.buildHandoff(R0, H.produced);
  assert.deepEqual(JSON.parse(JSON.stringify(again)), H, 'handoff.json is the defaults\' run');
  for (const [k, o] of Object.entries(H.outputs)) for (const f of ['units', 'confidence', 'source']) assert.ok(o[f], `${k}.${f}`);
  assert.deepEqual(H.inputs.way_home_handoff, deps.chain.digest, 'the chain carried as its digest');
  assert.equal(H.refusals.filter((r) => r.from === '48-catch').length + 36, H.refusals.length, '36 carried + own');
  assert.equal(H.outputs.capture.value.choice, 'skip');
  assert.ok(H.outputs.capture.value.answers.includes('47-way-home:out_of_envelope/entry_speed'));
  const back = K.parseHandoff(JSON.stringify(H)); assert.ok(!back.refusal, 'reads back: ' + (back.refusal && back.refusal.reason));
  const enc = K.b64urlEncode(JSON.stringify(H)); assert.ok(!K.parseHandoff(K.b64urlDecode(enc)).refusal, 'through a #h= link');
  const e1 = JSON.parse(JSON.stringify(H)); e1.outputs.screening.value.peak_g += 0.5; assert.ok(K.parseHandoff(e1).refusal, 'edited peak g refused');
  const e2 = JSON.parse(JSON.stringify(H)); e2.refusals.pop(); assert.ok(K.parseHandoff(e2).refusal, 'dropped refusal refused');
  const e3 = JSON.parse(JSON.stringify(H)); e3.inputs.way_home_handoff.sha256 = '0'.repeat(64); const r3 = K.parseHandoff(e3); assert.equal(r3.refusal.code, 'not_found', 'unknown digest');
  const e4 = JSON.parse(JSON.stringify(H)); e4.outputs.entry_interface.value.fpa_inertial_deg -= 0.01; assert.ok(K.parseHandoff(e4).refusal, 'edited entry angle refused');
  // idea 47's handoff imports through the same door
  const p47 = K.parseHandoff(chain()); assert.equal(p47.from, '47-way-home');
  assert.ok(K.parseHandoff({ handoff: 'long-way-round', from: '45-dig', version: 1 }).refusal, 'another module refused');
});
