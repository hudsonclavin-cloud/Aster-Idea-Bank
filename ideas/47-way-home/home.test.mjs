// Idea 47 (Way Home): tests. node --test ideas/47-way-home/home.test.mjs (from the bank root; about 15 s)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BANK = path.resolve(HERE, '../..');
const L = require('./load.cjs');
const K = L.K, DAY = 86400;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);
const rel = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${what}: ${a} vs ${b} (rel ${tol})`);
let CHAIN_R = null;
const chainRun = () => CHAIN_R || (CHAIN_R = K.run(K.defaults(), { split: L.chain() }));
const codes = (R) => R.refusals.filter((r) => !r.from).map((r) => r.applies_to);

test('1 snapshots: sidecars, byte-identical kernels, the chain handoff and its digest', () => {
  const dir = path.join(HERE, 'snapshots');
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.provenance.json'));
  assert.equal(files.length, 13);
  for (const f of files) {
    const side = JSON.parse(fs.readFileSync(path.join(dir, f + '.provenance.json'), 'utf8'));
    for (const k of ['repo', 'path', 'commit']) assert.ok(side[k], f + ' sidecar lacks ' + k);
    const s = sha(fs.readFileSync(path.join(dir, f)));
    assert.equal(s, side.writtenSha256 || side.sourceSha256, f + ' sha256');
  }
  const copies = { 'lambert.js': 'ideas/39-lamberts-road/lambert.js', 'coast.js': 'ideas/40-long-coast/coast.js' };
  ['aster-constants.js', 'earth-cheb.js', 'catalog-elements.js', 'aster-bodies-cheb.js', 'outer-planets-cheb.js', 'de440-constants.js', 'nav-sources.js', 'erfa-iau2006.js'].forEach((f) => { copies[f] = 'ideas/40-long-coast/snapshots/' + f; });
  for (const [f, src] of Object.entries(copies)) assert.equal(sha(fs.readFileSync(path.join(dir, f))), sha(fs.readFileSync(path.join(BANK, src))), f + ' differs from ' + src);
  assert.deepEqual(L.deps.chain, JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/46-split/handoff.json'), 'utf8')));
  const h39 = JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/39-lamberts-road/handoff.json'), 'utf8')), h40 = JSON.parse(fs.readFileSync(path.join(BANK, 'ideas/40-long-coast/handoff.json'), 'utf8'));
  assert.equal(L.deps.outbound.lamberts_road.v_infinity_arrival_m_s, h39.outputs.v_infinity_arrival.value.magnitude_m_s);
  assert.equal(L.deps.outbound.long_coast.v_infinity_arrival_m_s, h40.outputs.arrival_state.value.v_infinity_arrival_magnitude_m_s);
  // the kernel's SHA-256 against node:crypto, padding edges and non-ASCII included
  for (const t of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'Ω ≈ 1.2 km/s — Apophis 🛰', JSON.stringify(L.deps.chain)]) assert.equal(L.WayHome.sha256(t), sha(Buffer.from(t, 'utf8')));
  // NHATS quotes carry the two numbers the page uses
  const Q = L.deps.oracles.nhats_quotes;
  assert.match(Q.entry, /12 km\/s at an altitude of 125 km/); assert.equal(Q.entryLimit_m_s, 12000); assert.equal(Q.entryAltitude_m, 125000);
  assert.match(Q.method, /patched conics with Lambert solutions/);
  assert.equal(L.deps.oracles.nhats.length, 61);
});

test('2 the oracle: JPL NHATS return legs (61, four bodies) reproduced with idea 40\'s asteroid', () => {
  const X = K.reality(), st = X.nhatsStats;
  assert.equal(X.nhats.length, 61);
  assert.deepEqual(Object.keys(L.deps.oracles.nhats_bodies).sort(), ['101955', '162173', '2000 SG344', '99942']);   // Didymos and Eros are not NHATS-compliant
  assert.ok(st.dv.median < 0.5, 'departure dv median ' + st.dv.median);          // measured 0.280 m/s (NHATS prints 1 m/s)
  assert.ok(st.dv.max < 6, 'departure dv max ' + st.dv.max);                     // 5.50 m/s, Apophis after its 2029 encounter
  assert.ok(st.vinf.median < 1 && st.vinf.max < 8, 'vinf ' + JSON.stringify(st.vinf)); // 0.66 and 6.91 m/s
  assert.ok(st.dec.max < 0.03, 'declination ' + st.dec.max);                     // 0.024 deg
  const nonApophis = X.nhats.filter((q) => q.des !== '99942').map((q) => Math.abs(q.dv_m_s - q.dv_nhats_m_s));
  assert.ok(Math.max(...nonApophis) < 0.6, 'other bodies max ' + Math.max(...nonApophis));
  // braked legs: NHATS's v_arr_earth is capped at 12 km/s and its Earth return dV lowers v_inf far out (v_inf = cap + dV)
  const braked = X.nhats.filter((q) => q.braked);
  assert.ok(braked.length >= 20);
  for (const q of braked) near(q.vinf_m_s, q.vinf_nhats_m_s, 8, 'braked ' + q.tid);
  // two-body from Aster's elements (idea 39) is the wrong ephemeris for a return: Apophis's median error is km/s
  const tb = X.nhats.filter((q) => q.des === '99942').map((q) => Math.abs(q.dv_two_body_m_s - q.dv_nhats_m_s)).sort((a, b) => a - b);
  assert.ok(tb[Math.floor(tb.length / 2)] > 1000, 'two-body Apophis median ' + tb[Math.floor(tb.length / 2)]);
  // NHATS dates read as 0h TDB: twelve hours later the agreement is lost
  const t = X.nhats.find((q) => q.des === '101955'), b = K.K39.findBody('101955'), eph = K.ephemeris(b);
  const tDep = Date.parse(t.departure) / 1000 - K.constants.unixToJ2000Days * DAY + K.constants.tdbMinusUtc_s;
  const c12 = K.cell(eph, tDep + 12 * 3600, t.tof_days * DAY, [0]);
  assert.ok(Math.abs(c12.sols[0].dvMag - t.dv_nhats_m_s) > 20 * Math.abs(t.dv_m_s - t.dv_nhats_m_s) + 5);
});

test('3 the oracle: JPL\'s close approach of Apophis on 2029-04-13 from Aster\'s 2026 elements', () => {
  const A = K.reality().apophis;
  near(A.here.tdb, A.jpl.tdb, 1, 'time (s)');                         // golden section to 0.5 s; measured 0.002 s
  near(A.here.distance_m, A.jpl.distance_m, 3000, 'distance');         // 38,013.1 km against JPL's 38,011.5 km
  near(A.here.v_infinity_m_s, A.jpl.v_infinity_m_s, 0.01, 'v_inf');    // 5841.3556 against 5841.3559 m/s
  near(A.here.speed_m_s, A.jpl.v_rel_m_s, 0.2, 'v_rel');               // 7422.48 against 7422.54 m/s
});

test('4 reality: OSIRIS-REx\'s flown return from Bennu (JPL Horizons reconstruction) against the patched conic', () => {
  const X = K.reality().osirisRex;
  near(X.actual_dv_m_s, 265.7865, 0.001, 'flown departure burn');       // from Horizons, relative to Bennu
  assert.ok(X.before_dv_m_s < 0.3, 'before the burn ' + X.before_dv_m_s);
  assert.equal(X.M, 1); assert.equal(X.branch, 'left');
  near(X.lambert_dv_m_s, 272.817, 0.01, 'Lambert departure');           // +2.65 %
  rel(X.lambert_dv_m_s, X.actual_dv_m_s, 0.03, 'within 3 %');
  near(X.dv_angle_deg, 6.09, 0.05, 'direction');
  near(X.actual_vinf_m_s, 6226.82, 0.05, 'flown v_inf');
  rel(X.lambert_vinf_m_s, X.actual_vinf_m_s, 0.004, 'arrival v_inf within 0.4 %');   // -0.30 %
  near(X.lambert_dec_deg - X.actual_dec_deg, 0.127, 0.01, 'declination');
  assert.ok(X.actual_perigee_alt_m < 125000 && X.actual_perigee_alt_m > 0, 'the row read is still bound for entry');
  near(X.tof_days, 866.774, 0.01, 'flight time');
});

test('5 closed forms: Lambert reaches the Earth, entry speed, braking, Tsiolkovsky', () => {
  const b = K.K39.findBody('101955'), eph = K.ephemeris(b), t = K.K39.parseUtc('2030-10-18T22:07:00Z'), tof = 155 * DAY;
  const c = K.cell(eph, t, tof, [0, 1]), q = c.sols[0];
  const p = L.deps.LambertsRoad.propagate(c.asteroid.r, q.v1, tof, K.constants.gmSun_m3_s2);   // idea 39's Kepler
  const miss = Math.hypot(...p.r.map((x, i) => x - c.earth.r[i]));
  assert.ok(miss < 50, 'Kepler arc misses the Earth by ' + miss + ' m');
  near(Math.hypot(...q.dv.map((x, i) => x + c.asteroid.v[i] - q.v1[i])), 0, 1e-9, 'dv = v1 - v_asteroid');
  const RE = 6378136.6, mu = 398600441800000;
  assert.equal(K.RE, RE);
  near(K.entrySpeed(5000, 125000), Math.sqrt(25e6 + 2 * mu / (RE + 125000)), 1e-9, 'entry speed');
  near(K.vinfMax(12000, 125000), 4627.4037, 1e-3, 'v_inf at the 12 km/s limit');   // sqrt(12000^2 - 2 mu / 6,503,136.6 m)
  near(K.entrySpeed(K.vinfMax(12000, 125000), 125000), 12000, 1e-9, 'round trip');
  // Tsiolkovsky by hand: no boil-off, one burn, single propellant
  const B = { fuel: 100, ox: 0, of: null, species: false, ve: 3000, dry: 500, rf: 0, ro: 0, cap: null };
  const S = Object.assign(K.defaults(), { margin: 0, tcm: 0 });
  const bu = K.burnsOf(150, 4000, S);
  near(K.materialMax(B, 0, 100 * DAY, bu), 100 / (1 - Math.exp(-150 / 3000)) - 600, 1e-6, 'material by hand');
  near(K.capacity(B, 0), 3000 * Math.log(600 / 500), 1e-9, 'capacity');
  // braking: lowers v_inf to the limit, with margin; a two-burn maximum is feasible and 1 ppm more is not
  const S2 = Object.assign(K.defaults(), { margin: 0.1, tcm: 0, arrival: 'brake' }), bu2 = K.burnsOf(150, 6000, S2);
  near(bu2.dv2, (6000 - K.vinfMax(12000, 125000)) * 1.1, 1e-9, 'braking dv');
  const B2 = Object.assign({}, B, { fuel: 2000 }), m = K.materialMax(B2, 0, 100 * DAY, bu2);
  assert.ok(m > 0 && K.ledger(B2, 0, 100 * DAY, bu2, m).ok && !K.ledger(B2, 0, 100 * DAY, bu2, m * (1 + 1e-5)).ok);
  // the oxygen limits the burn when it is short: 1 kg of fuel, 4 kg of oxidizer at O/F 8 burns 0.5 kg of fuel and all 4 of oxygen
  const B3 = { fuel: 1, ox: 4, of: 8, species: true, ve: 4000, dry: 100, rf: 0, ro: 0, cap: null };
  near(K.capacity(B3, 0), 4000 * Math.log(105 / (105 - 4.5)), 1e-9, 'oxygen-limited capacity');
  // the cruise boils what the burn left: 10 kg single propellant, 0.1 kg/day, 10 days
  const B4 = { fuel: 10, ox: 0, of: null, species: false, ve: 3000, dry: 100, rf: 0.1, ro: 0, cap: null };
  const L4 = K.ledger(B4, 0, 10 * DAY, K.burnsOf(10, 3000, S), 0);
  near(L4.boiloff_cruise_kg, 1, 1e-12, 'cruise boil-off'); near(L4.fuel_arrival_kg, 10 - L4.burned_departure_kg - 1, 1e-12, 'left');
  // the B-plane by hand: periapsis on +x, motion about +z; B lies on the periapsis side, |B| = rp sqrt(1 + 2 mu / (rp vinf^2)), tp now
  const rp = 7e6, vi = 5000, vp = Math.sqrt(vi * vi + 2 * mu / rp), bp = K.bplaneOf({ r: [rp, 0, 0], v: [0, vp, 0], t: 1000 });
  near(bp.vinf, vi, 1e-6, 'v_inf'); near(bp.rp, rp, 1e-3, 'rp'); near(bp.tp, 1000, 1e-3, 'tp'); near(bp.b, rp * Math.sqrt(1 + 2 * mu / (rp * vi * vi)), 1e-3, 'b');
  const T = (() => { const S0 = bp.S, P = K.K39.eclipticPole, c = [S0[1] * P[2] - S0[2] * P[1], S0[2] * P[0] - S0[0] * P[2], S0[0] * P[1] - S0[1] * P[0]], n = Math.hypot(...c); return c.map((x) => x / n); })();
  const Rv = [bp.S[1] * T[2] - bp.S[2] * T[1], bp.S[2] * T[0] - bp.S[0] * T[2], bp.S[0] * T[1] - bp.S[1] * T[0]];
  assert.ok(bp.BT * T[0] + bp.BR * Rv[0] > 0, 'B points to the periapsis side');
  assert.ok(bp.S[1] > 0 && bp.S[0] > 0, 'incoming along +y, toward +x');
  // the execution-error correction: Lucy's 30 mm/s + 4 %, 3 sigma (idea 40)
  near(K.tcmOf(100, K.defaults()), 0.03 + 0.04 * 100, 1e-12, 'Lucy 3 sigma');
});

test('6 the chain: Apophis, riding its 2029 encounter home', () => {
  const R = chainRun();
  assert.ok(!R.refusal);
  assert.equal(R.encounters.length, 1);
  assert.equal(R.sel.source, 'ride');
  assert.ok(R.ride && Math.abs(R.ride.tdb - R.sel.arrTdb) < 3 * 3600, 'arrives within hours of the encounter');
  assert.equal(K.K39.utcOf(R.sel.depTdb).slice(0, 16), '2028-10-29T01:10');
  near(R.sel.q.dvMag, 2.4572, 1e-3, 'patched-conic departure dv');
  assert.ok(R.flight.converged && R.flight.residual_m <= 1000);
  near(R.flight.dvMag, 2.0195, 2e-3, 'flown and re-aimed dv');
  near(R.flight.uncorrected.perigee_altitude_m / 1000, 13508, 2, 'uncorrected perigee altitude (km)');
  near(R.flight.flown.perigee_altitude_m / 1000, 123.7, 1, 'flown perigee altitude (km)');
  near(R.flight.flown.v_infinity_m_s, 5857.75, 0.05, 'flown v_inf');
  near(R.entry.speed_m_s, Math.sqrt(R.flight.flown.v_infinity_m_s ** 2 + 2 * K.MU_E / (K.RE + 125000)), 1e-9, 'entry speed');
  assert.ok(R.entry.speed_m_s > 12000 && codes(R).includes('entry_speed'));
  near(R.mass.capacity_m_s, 37.408, 0.01, 'capacity after the wait');
  near(R.mass.material_max_kg, 8972.7, 1, 'material home');
  assert.equal(R.mass.limited_by, 'propellant');
  near(R.mass.material_available_kg, 246.321839 * 90 - 11.3061724, 1e-6, 'idea 45 dug');
  // the ledger balances: what was made = boiled while waiting + burned + boiled on the way + left
  const Lg = R.mass.ledger, p0 = R.src.fuel_kg + R.src.ox_kg;
  near(Lg.boiloff_wait_kg + Lg.burned_departure_kg + Lg.boiloff_cruise_kg + Lg.burned_braking_kg + Lg.fuel_arrival_kg + Lg.ox_arrival_kg, p0, 1e-9, 'mass balance');
  rel(Lg.burned_departure_kg, Lg.mass_departure_kg * (1 - Math.exp(-R.burns.dv1 / R.src.ve_m_s)), 1e-12, 'Tsiolkovsky');
  // the hydrogen limits the burn: oxygen is left over (burned at idea 46's 7.94)
  assert.ok(Lg.ox_departure_kg - Lg.burned_departure_kg * R.src.of / (1 + R.src.of) > 0.1);
  // carried refusals
  assert.equal(R.refusals.filter((r) => r.from).length, 31);
  assert.ok(R.refusals.some((r) => r.from === '46-split' && r.applies_to === 'water'));
});

test('7 the decisions: hold the coolers, brake, the slowest arrival, Aster\'s symmetric sample-return', () => {
  const Rh = K.run(Object.assign(K.defaults(), { hold: 'held' }), { split: L.chain() });
  assert.ok(Rh.mass.material_max_kg > chainRun().mass.material_max_kg * 1.3, 'held ' + Rh.mass.material_max_kg);
  near(Rh.mass.ledger.boiloff_wait_kg + Rh.mass.ledger.boiloff_cruise_kg, 0, 0, 'nothing boils when held');
  const Rb = K.run(Object.assign(K.defaults(), { arrival: 'brake' }), { split: L.chain() });
  assert.ok(codes(Rb).includes('return'), 'braking to 12 km/s is out of reach of 7 kg');
  near(Rb.entry.speed_m_s, 12000, 1e-6, 'braked entry speed');
  const Rv = K.run(Object.assign(K.defaults(), { objective: 'vinf' }), { split: L.chain() });
  assert.ok(Rv.mass.material_max_kg >= 0 && Rv.sel.q.vinfMag < chainRun().sel.q.vinfMag, 'slowest arrival that can still get home: ' + Rv.sel.q.vinfMag);
  // Aster's sample-return stack prices the return burn as the outbound arrival v_inf (delta-v.ts, departureDvFromVInf)
  const X = K.reality();
  assert.ok(chainRun().flight.dvMag / L.deps.outbound.lamberts_road.v_infinity_arrival_m_s < 1e-3);
  near(X.nhatsStats.symmetric.median, 1.0, 0.05, 'NHATS median return/arrival');
  assert.ok(X.nhatsStats.symmetric.max > 5 && X.nhatsStats.symMin < 0.06, 'spread ' + X.nhatsStats.symMin + ' to ' + X.nhatsStats.symmetric.max);
  // a cap that binds: the material is capped, and among windows that bring it all the least delta-v wins
  const c3 = L.chain(), w = c3.inputs.dig_handoff.outputs.water_rate.value; w.regolith_kg_per_day = (3000 + w.total_kg) / w.days;
  const Rc = K.run(K.defaults(), { split: c3 });
  near(Rc.mass.material_kg, 3000, 1e-6, 'capped'); assert.equal(Rc.mass.limited_by, 'material');
  assert.ok(Rc.flight.dvMag < chainRun().flight.dvMag - 0.03, 'capped choice is cheaper: ' + Rc.flight.dvMag);
  // the hold is refused where nothing could hold it, and the user's setting is kept in the export
  const g = L.chain(); g.refusals.push({ code: 'out_of_envelope', reason: 'x', what_would_help: 'y', applies_to: 'cooler20', from: '46-split' });
  const Rg = K.run(Object.assign(K.defaults(), { hold: 'held' }), { split: g });
  assert.ok(codes(Rg).includes('hold') && Rg.S.hold === 'passive' && Rg.S0.hold === 'held');
});

test('8 refusals: windows, the sphere of influence, the propellant idea 46 refused, a stand-alone craft', () => {
  const h = L.chain(); h.outputs.site.value.stay_end_utc = '2021-01-18T21:49:52.816Z';
  const R1 = K.run(K.defaults(), { split: h });
  assert.ok(codes(R1).includes('ephemeris_span') && codes(R1).includes('return'));
  assert.ok(R1.sel.depTdb >= K.SPAN.start);
  const R2 = K.run(Object.assign(K.defaults(), { waitMinDays: 4500, waitMaxDays: 4500 }), { split: L.chain() });
  assert.ok(R2.refusal && R2.refusal.applies_to === 'ephemeris_span');
  const enc = chainRun().encounters[0].tdb;
  const R3 = K.run(Object.assign(K.defaults(), { selection: { depTdb: enc - DAY, tofS: 200 * DAY, M: 0, branch: 'single' } }), { split: L.chain() });
  assert.ok(codes(R3).includes('soi_departure') && !R3.flight);
  const n = L.chain(); n.outputs.propellant.value.mass_kg = null;
  const R4 = K.run(K.defaults(), { split: n });
  assert.ok(codes(R4).includes('propellant') && !R4.mass && R4.sel, 'the cost alone is still shown');
  const cu = { body: '101955', stay_end_utc: '2030-01-01T00:00:00Z', propellant_kg: 765.32, isp_s: 423.3, dry_kg: 1196.8, boiloff_kg_per_day: 0, g0: 9.80665 };
  const R5 = K.run(Object.assign(K.defaults(), { case: 'custom', custom: cu }), null);
  assert.ok(codes(R5).includes('craft') && R5.mass.material_max_kg > 0);
  assert.ok(R5.sel.q.dvMag > 1000 && R5.sel.q.dvMag < 1300, 'Bennu ' + R5.sel.q.dvMag);
  const bads = [{ waitMinDays: -1 }, { waitMaxDays: 9000 }, { tofMinDays: 1 }, { tofMaxDays: 3000 }, { nDep: 5 }, { revs: 3 }, { objective: 'fast' }, { margin: 2 }, { tcm: -1 }, { hold: 'maybe' },
    { entryLimit_m_s: 5000 }, { entryAlt_m: 10 }, { material: -5 }, { selection: { depTdb: 'x' } }];
  for (const b of bads) { const R = K.run(Object.assign(K.defaults(), b), { split: L.chain() }); assert.ok(R.refusal && R.refusal.code === 'invalid_input', JSON.stringify(b)); }
});

test('9 idea 46\'s handoff: what is checked, what is refused', () => {
  const ok = K.importSplit(L.chain());
  assert.ok(!ok.refusal && ok.body.designation === '99942' && ok.holdAllowed);
  const edits = [
    (h) => { h.outputs.propellant.value.mass_kg += 1; },
    (h) => { h.outputs.propellant.value.oxidizer_kg *= 1.01; },
    (h) => { h.outputs.propellant.value.fuel_kg *= 1.01; h.outputs.propellant.value.mass_kg = h.outputs.propellant.value.fuel_kg + h.outputs.propellant.value.oxidizer_kg; },
    (h) => { h.outputs.propellant.value.fuel_kg += 0.01; h.outputs.propellant.value.oxidizer_kg -= 0.01; },   // total and delta-v unchanged, O/F not
    (h) => { h.outputs.dry_mass.value.total_kg -= 10; },
    (h) => { h.outputs.propellant.value.ve_m_s *= 1.01; },
    (h) => { h.version = 2; },
    (h) => { h.from = '45-dig'; },
    (h) => { h.outputs.site.value.stay_end_utc = 'soon'; },
    (h) => { h.outputs.propellant.units = 'lb'; },
  ];
  for (const e of edits) { const h = L.chain(); e(h); assert.ok(K.importSplit(h).refusal, e.toString()); }
  assert.ok(K.importSplit('garbage').refusal);
  const far = L.chain(); far.outputs.site.value.key = 'psyche'; far.outputs.site.value.body = '16 Psyche';
  assert.equal(K.importSplit(far).refusal.code, 'not_found');
  // idea 46's own reader accepts what this page bundles (the import above checks arithmetic only)
  const L46 = require(path.join(BANK, 'ideas/46-split/load.cjs'));
  assert.ok(!L46.K.parseHandoff(L.chain()).refusal);
});

test('10 the handoff: the sample is the defaults, reads back, refuses edits, travels by link', () => {
  const R = chainRun(), h = K.buildHandoff(R, '2026-11-01T20:00:00Z'), file = JSON.parse(fs.readFileSync(path.join(HERE, 'handoff.json'), 'utf8'));
  assert.deepEqual(h, file);
  for (const [k, o] of Object.entries(h.outputs)) { assert.ok(o.units && o.confidence && o.source, k); }
  assert.equal(h.outputs.earth_arrival.confidence, 'derived'); assert.equal(h.outputs.mass.confidence, 'assumed');   // idea 46's water is an upper bound
  assert.ok(h.inputs.split_handoff.pruned && h.inputs.split_handoff.sha256 === sha(Buffer.from(JSON.stringify(L.chain()))));
  const back = K.parseHandoff(JSON.stringify(file));
  assert.ok(!back.refusal, back.refusal && back.refusal.reason);
  const link = K.b64urlEncode(JSON.stringify(file)); assert.ok(!K.parseHandoff(K.b64urlDecode(link)).refusal);
  const e1 = JSON.parse(JSON.stringify(file)); e1.outputs.mass.value.material_kg *= 1.01; assert.ok(K.parseHandoff(e1).refusal);
  const e2 = JSON.parse(JSON.stringify(file)); e2.refusals.pop(); assert.ok(K.parseHandoff(e2).refusal);
  const e3 = JSON.parse(JSON.stringify(file)); e3.outputs.earth_arrival.value.v_infinity_m_s += 1; assert.ok(K.parseHandoff(e3).refusal);
  const e4 = JSON.parse(JSON.stringify(file)); e4.inputs.split_handoff.sha256 = '0'.repeat(64); assert.equal(K.parseHandoff(e4).refusal.code, 'not_found');
  const e6 = JSON.parse(JSON.stringify(file)); e6.outputs.return_transfer.value.departure_dv_m_s *= 1 + 1e-4; assert.ok(K.parseHandoff(e6).refusal, 'a patched-conic number moved by 1e-4');
  const e7 = JSON.parse(JSON.stringify(file)); e7.refusals.find((r) => r.applies_to === 'navigation').applies_to = 'asteroid_gravity'; assert.ok(K.parseHandoff(e7).refusal, 'a refusal relabelled');
  const e5 = JSON.parse(JSON.stringify(file)); e5.outputs.return_transfer.value.departure_tdb_s_past_j2000 += 1; assert.ok(K.parseHandoff(e5).refusal);
  // a handoff carrying an idea 46 handoff that is not the bundled one carries it whole, and reads back
  const g = L.chain(); g.produced = '2026-11-02T00:00:00Z';
  const hg = K.buildHandoff(K.run(K.defaults(), { split: g }), 'x');
  assert.equal(hg.inputs.split_handoff.from, '46-split'); assert.ok(!hg.inputs.split_handoff.pruned && !K.parseHandoff(hg).refusal);
  assert.ok(K.parseHandoff(L.chain()).src, 'idea 46\'s handoff is accepted as an import');
  assert.ok(K.parseHandoff({ handoff: 'long-way-round', from: '45-dig', version: 1 }).refusal);
});
