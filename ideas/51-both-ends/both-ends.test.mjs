// node --test ideas/51-both-ends/both-ends.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DATA = require('./snapshots/data.js');
const { create } = require('./both-ends.js');
const B = create(DATA);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, want ${b} ± ${tol}`);
const clone = (x) => JSON.parse(JSON.stringify(x));

test('Skyhook canon: release C3, release speed and tip g of all three tiers are reproduced from mu, R, altitude, half-length and tip speed', () => {
  for (const k of ['reference', 'cislunar', 'phase3']) {
    const t = B.tier(k);
    near(t.c3Max, t.stated.c3, 0.005, `${k} C3`);
    near(t.vRelease, t.stated.vRelease, 0.007, `${k} release speed`); // the canon adds v_tip to a rounded 7.55: 11.05 where sqrt(mu/R)+3.5 is 11.056
    near(t.tipG, t.stated.tipG, 0.01, `${k} tip g`);
    // the canon's ground-relative lower-tip speed is the inertial one less the equatorial 0.465 km/s
    if (t.stated.vLowGroundRel !== undefined) near(t.vLow - t.stated.vLowGroundRel, 0.465, 0.005, `${k} lower tip`); // the cislunar block states none
  }
  near(B.tier('reference').rUp, 7301, 1e-9, 'upper-tip radius the canon notes quote');
});

test('reboost energy as ideas 14 and 30 published it: a full reference swing is 43.03 MJ/kg, of which 2 v_orb v_tip (skyhook_finance.py:215) is 37.78', () => {
  const t = B.tier('reference');
  near((t.c3Max - t.c3Min) / 2, 43.03, 0.005);
  near(2 * t.vOrb * t.vTip, 37.78, 0.005);
});

test('idea 01 Tip Match is reproduced: 0.393 and 0.093 km/s short of a parabola, v-infinity* 3.613 km/s, 20 faster and 108 slower', () => {
  near(B.end(B.tier('reference'), 0).trimKmps, 0.393, 0.0005);
  near(B.end(B.tier('cislunar'), 0).trimKmps, 0.093, 0.0005);
  near(Math.sqrt(B.tier('phase3').c3Max), 3.613, 0.0005);
  const c = B.census('phase3', 'entry-125');
  assert.equal(c.bodies, 128);
  assert.equal(c.catchFree, 108);
  assert.equal(c.bodies - c.catchFree, 20);
});

test('Aster injection formula reproduces every NHATS dv_dep_park at the 400 km parking orbit, inside the records\' rounding', () => {
  near(B.mission('101955', 'phase3').outbound.nhatsInjectionModelKmps, 3.9608, 0.00005, 'Bennu by hand');
  let worst = 0;
  for (const r of DATA.nhats.records) {
    const m = B.mission(r, 'reference');
    worst = Math.max(worst, Math.abs(m.outbound.nhatsInjectionModelKmps - m.outbound.nhatsInjectionKmps));
  }
  assert.ok(worst < 0.0006, `worst ${worst}`);
  // and Aster's own 200 km parking orbit costs more, as idea 05 found (30 to 48 m/s)
  const m = B.mission('101955', 'reference');
  near(m.outbound.asterInjectionKmps - m.outbound.nhatsInjectionKmps, 0.037, 0.001);
});

test('payloadAtC3: anchors exact, linear between, refused outside (Aster launch-vehicles.ts behaviour)', () => {
  const fhr = DATA.aster.vehicles.find((v) => v.name === 'Falcon Heavy' && v.config === 'Recovery');
  const f9 = DATA.aster.vehicles.find((v) => v.name === 'Falcon 9 FT' && v.config === 'ASDS');
  assert.equal(B.payloadAtC3(fhr, 10), 5130);
  assert.equal(B.payloadAtC3(fhr, 55), 650);
  assert.equal(B.payloadAtC3(fhr, 15), (5130 + 3845) / 2);
  assert.deepEqual(B.payloadAtC3(f9, 10.01), { kind: 'beyond-curve' });
  assert.deepEqual(B.payloadAtC3(fhr, -0.1), { kind: 'beyond-curve' });
  assert.deepEqual(B.payloadAtC3(fhr, NaN), { kind: 'non-finite-c3' });
  assert.equal(DATA.aster.vehicles.length, 8);
});

test('rocket path equals Aster deliveredMassKg in sample-return mode, worked by hand for Bennu on Falcon Heavy Recovery', () => {
  const m = B.mission('101955', 'reference');
  const fhr = m.rocket.find((v) => v.name === 'Falcon Heavy' && v.config === 'Recovery');
  const injected = 5130 + ((17.629 - 10) / 10) * (3845 - 5130);
  near(fhr.injectedKg, injected, 1e-9);
  const dvMps = 1501 + 1533 + 150 + 0.05 * (1501 + 1533); // rendezvous + departure + stationkeeping + 5 % margin
  near(fhr.homeKg, injected * Math.exp(-dvMps / (9.80665 * 320)), 1e-6);
  assert.equal(m.rocket.filter((v) => v.refused === 'beyond-curve').length, 2); // both Falcon 9 curves stop at C3 10
});

test('tip state: geometry at the top and bottom, energy monotonic in swing angle, phaseForC3 is its inverse', () => {
  const t = B.tier('phase3');
  near(B.stateAt(t.vTip, 0).r, t.rCom + t.L, 1e-9);
  near(B.stateAt(t.vTip, 180).r, t.rCom - t.L, 1e-9);
  near(B.stateAt(t.vTip, 180).v, t.vOrb - t.vTip, 1e-12);
  near(B.stateAt(t.vTip, 90).v, Math.hypot(t.vOrb, t.vTip), 1e-12);
  let prev = Infinity;
  for (let th = 0; th <= 180; th += 1) {
    const c3 = B.stateAt(t.vTip, th).c3;
    assert.ok(c3 < prev);
    prev = c3;
  }
  for (const th of [0.5, 17, 60, 123.4, 179]) near(B.phaseForC3(t, B.stateAt(t.vTip, th).c3), th, 1e-9);
  assert.equal(B.phaseForC3(t, t.c3Max + 1e-6), null);
});

test('each end conserves energy: a swing hand-over has exactly the asked C3, a burn at the top makes up exactly the shortfall, and the two meet at C3max', () => {
  const t = B.tier('phase3');
  const mu = B.constants.muS;
  const sw = B.end(t, 5);
  assert.equal(sw.mode, 'swing');
  assert.equal(sw.trimKmps, 0);
  near(sw.vKmps ** 2 - (2 * mu) / sw.rKm, 5, 1e-9);
  const tp = B.end(t, 30);
  assert.equal(tp.mode, 'top-plus-burn');
  near((tp.vKmps + tp.trimKmps) ** 2 - (2 * mu) / tp.rKm, 30, 1e-9);
  near(B.end(t, t.c3Max + 1e-9).trimKmps, 0, 1e-9);
  near(B.end(t, t.c3Max).thetaDeg, 0, 1e-6);
});

test('tether mass chain by hand for Bennu at Phase 3, and the energy ledger follows the masses', () => {
  const m = B.mission('101955', 'phase3');
  const ve = (9.80665 * 320) / 1000;
  const t = m.tier;
  const trimOut = Math.sqrt(17.629 + (2 * 398600) / 7301) - t.vRelease;
  near(m.outbound.trimKmps, trimOut, 1e-12);
  const m1 = 5000 * Math.exp((-trimOut * 1.05) / ve);
  const m2 = m1 * Math.exp(-(1.501 * 1.05 + 0.15) / ve);
  const m4 = m2 * Math.exp((-1.533 * 1.05) / ve);
  const m5 = m4 * Math.exp((-m.inbound.trimKmps * 1.05) / ve);
  near(m.tether.caughtKg, m5, 1e-6);
  near(m.tether.releasedKg - m.tether.caughtKg, m.tether.propellantKg, 1e-9);
  // both ends at the top of the swing: energy returned / energy lent = mass caught / mass thrown
  near(m.energy.returnedFraction, m5 / 5000, 1e-12);
  near(m.energy.netGJ, m.energy.throwGJ - m.energy.catchGJ, 1e-9);
  near(m.energy.throwMJkg, 58.14, 0.005);
});

test('a sample is added at the asteroid and carried home; too heavy a catch is refused as out of envelope', () => {
  const a = B.mission('2000 SG344', 'phase3', { sampleKg: 0 });
  const b = B.mission('2000 SG344', 'phase3', { sampleKg: 500 });
  assert.ok(b.tether.caughtKg > a.tether.caughtKg && b.tether.caughtKg < a.tether.caughtKg + 500);
  assert.equal(b.tether.leavingKg, b.tether.atAsteroidKg + 500);
  const big = B.mission('2000 SG344', 'phase3', { sampleKg: 9000 });
  assert.equal(big.tether.overClass, true);
  assert.equal(big.refused[0].code, 'out_of_envelope');
});

test('refusals: unknown body, tier and reading, bad sample mass, a record with a missing field; every mission carries the five standing refusals', () => {
  assert.equal(B.mission('no such body', 'phase3').code, 'not_found');
  assert.equal(B.mission('101955', 'phase9').code, 'not_found');
  assert.equal(B.mission('101955', 'phase3', { reading: 'x' }).code, 'not_found');
  assert.equal(B.mission('101955', 'phase3', { sampleKg: -1 }).code, 'insufficient_data');
  assert.equal(B.mission('101955', 'phase3', { sampleKg: NaN }).code, 'insufficient_data');
  const broken = clone(DATA.nhats.records[0]);
  broken.v_arr_earth = null;
  assert.equal(B.mission(broken, 'phase3').code, 'insufficient_data');
  const slow = clone(DATA.nhats.records[0]);
  slow.v_arr_earth = '9.0';
  assert.equal(B.mission(slow, 'phase3').code, 'out_of_envelope');
  const m = B.mission('101955', 'reference');
  assert.deepEqual(m.refused.map((r) => r.topic), ['Plane', 'Phase and date', 'Getting to the lower tip', 'The catch itself', 'Price']);
  assert.equal(DATA.skyhook.rev_a.orbital.inclination_deg, undefined); // the reason the plane is refused
  for (const r of m.refused) assert.ok(r.missing && r.wouldHelp);
});

test('census headline numbers (128 NHATS round trips, entry read at 125 km)', () => {
  const ref = B.census('reference');
  const cis = B.census('cislunar');
  const p3 = B.census('phase3');
  assert.deepEqual([ref.throwFree, ref.catchFree, cis.throwFree, cis.catchFree], [0, 0, 0, 0]);
  assert.deepEqual([p3.throwFree, p3.catchFree, p3.bothFree], [120, 108, 106]);
  near(ref.throwTrim.median, 0.636, 0.0005);
  near(ref.asterInjection.median, 3.456, 0.0005);
  near(p3.returnedFraction.median, 0.706, 0.0005);
  // the 200 km reading moves the catch count but not the throw
  const p3b = B.census('phase3', 'reentry-200');
  assert.equal(p3b.throwFree, 120);
  assert.ok(p3b.catchFree < 108);
});

test('create() refuses a data module with a missing constant instead of computing with NaN', () => {
  const bad = clone(DATA);
  delete bad.skyhook.rev_a.geometry.tether_half_length_km;
  assert.throws(() => create(bad), /tether_half_length_km/);
  assert.throws(() => create({}), /data module/);
});
