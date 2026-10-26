// Tests for the Momentum Ledger. Run from the bank root: node --test ideas/30-momentum-ledger/ledger.test.mjs
// Pins come from outside this code wherever one exists: params/rev_a.json's printed C3, apogee and tip altitude;
// finance/reboost_bound.py's golden (tests/test_analysis_layer.py:77) and its whole published grid
// (finance/REBOOST_BOUND_FINDINGS.md); and Skyhook's own 17-node tether model (tools/twin/physics.js), run
// through a catch and a throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const K = require('./ledger.js');
const D = require('./data.js');
const TC = require('./twin-check.js');
const twinModule = await import('./snapshots/twin-physics.mjs');
const twinClassic = require('./snapshots/twin-classic.js').SkyhookTwin;
const revA = JSON.parse(fs.readFileSync(path.join(HERE, 'snapshots/rev_a.json'), 'utf8'));
const mxer = JSON.parse(fs.readFileSync(path.join(HERE, 'snapshots/service_mxer_draft.json'), 'utf8'));
const RE = parseFloat(D.values['skyhook_physics.r_earth_km'].text);
const HUB = Number(D.values['tether_dynamics.hub_mass_kg'].text);
const MU = revA.orbital.mu_earth_m3s2;
const DAY = 86400;

const sys = (o = {}) => K.system(revA, Object.assign({ tier: 'reference', derate: '0.3', hubKg: HUB, earthRadiusKm: RE }, o));
const rel = (a, b) => Math.abs(a / b - 1);

// ---------------------------------------------------------------------------------------------
test('the snapshot inputs are what the cited lines say', () => {
  assert.equal(RE, 6371);
  assert.equal(HUB, 200e3);
  assert.deepEqual(D.revA, revA, 'data.js carries rev_a.json unchanged');
  for (const [key, v] of Object.entries(D.values)) {
    const file = Object.values(D.lines).find((b) => b.path === v.path);
    assert.ok(file && file.lines[String(v.line)].includes(v.text), `${key} appears on ${v.path}:${v.line}`);
  }
  const fromFile = (name) => JSON.parse(fs.readFileSync(path.join(HERE, 'snapshots', name), 'utf8'));
  for (const [name, block] of Object.entries(D.lines)) assert.deepEqual(fromFile(`${name}.lines.json`), block);
  assert.deepEqual(fromFile('workbook-ladder.json'), D.workbook);
});

test('twin-classic.js is twin-physics.mjs with only the six export keywords removed', () => {
  const esm = fs.readFileSync(path.join(HERE, 'snapshots/twin-physics.mjs'), 'utf8');
  const cls = fs.readFileSync(path.join(HERE, 'snapshots/twin-classic.js'), 'utf8');
  const body = cls.slice(cls.indexOf('(function (root) {\n') + '(function (root) {\n'.length, cls.indexOf('\nroot.SkyhookTwin'));
  assert.equal(body, esm.replace(/^export ((?:const|function|class) )/gm, '$1'));
  assert.equal((esm.match(/^export /gm) || []).length, 6);
});

test('build_data.py --check: snapshots and data.js match the Skyhook checkout', { skip: !fs.existsSync('/home/user/skyhook/.git') }, () => {
  const r = spawnSync('python3', ['-B', path.join(HERE, 'build_data.py'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /up to date/);
});

// ---------------------------------------------------------------------------------------------
test('reconciliation: the kernel reproduces the canon release C3, apogee and tip altitude for every tier', () => {
  const k = revA.kinematics;
  const ref = K.energy(sys());
  assert.equal(Math.round(ref.c3 / 1e6 * 100) / 100, k.c3_kms2); // -8.06
  assert.equal(Math.round(ref.apogeeAltKm), k.apogee_altitude_km); // 85,222
  const cis = K.energy(sys({ tier: 'cislunar' }));
  assert.equal(Math.round(cis.c3 / 1e6 * 100) / 100, k.cislunar_revenue_gated_option.c3_kms2); // -1.94
  assert.equal(Math.round(cis.apogeeAltKm), k.cislunar_revenue_gated_option.apogee_altitude_km); // 397,819
  const p3 = K.energy(sys({ tier: 'phase3' }));
  assert.equal(Math.round(p3.c3 / 1e6 * 100) / 100, k.phase3_growth_option.c3_kms2); // +13.05
  assert.equal(p3.apogeeAltKm, Infinity);
  const s = sys();
  assert.equal((s.R - s.L - s.RE) / 1e3, revA.geometry.tip_altitude_lower_km); // 290
  // On a 6,378 km Earth (the one com_radius_km 6988 implies) the C3 misses the canon: idea 01's finding.
  const s78 = sys({ earthRadiusKm: revA.orbital.com_radius_km - revA.orbital.com_altitude_km });
  assert.notEqual(Math.round(K.energy(s78).c3 / 1e6 * 100) / 100, k.c3_kms2);
});

test('energy per kg: orbital-energy gain = momentum view + lift term, by hand at the reference tier', () => {
  const s = sys();
  const e = K.energy(s);
  const R = (6371 + 610) * 1e3, L = 320e3, v = Math.sqrt(3.986e14 / R), vt = 2500;
  const byHand = 2 * v * vt + 3.986e14 * (1 / (R - L) - 1 / (R + L));
  assert.ok(rel(e.perKg, byHand) < 1e-12);
  assert.ok(rel(e.kinetic, ((v + vt) ** 2 - (v - vt) ** 2) / 2) < 1e-12);
  assert.ok(rel(e.perKg, e.kinetic + e.potential) < 1e-12);
  assert.equal((e.perKg / 1e6).toFixed(2), '43.03'); // MJ/kg
  assert.equal((e.kinetic / 1e6).toFixed(2), '37.78'); // finance/skyhook_finance.py:215's figure
  assert.equal((e.perKg / 3.6e6).toFixed(2), '11.95'); // kWh/kg
  assert.ok(rel(e.perThrow, 5000 * e.perKg) < 1e-15);
  // and n * dH (mean motion times the payload's angular-momentum gain) agrees with it to 0.1 %: idea 14's check
  assert.ok(rel(Math.sqrt(MU / R ** 3) * e.angularMomentumPerKg, e.perKg) < 1e-3);
});

test('reconciliation: the same kernel on the DRAFT in-space fork reproduces reboost_bound.py\'s golden 1.056547e11 J', () => {
  const golden = Number(D.values['test_analysis_layer.golden_dE_j'].text);
  const tol = Number(D.values['test_analysis_layer.golden_rel'].text);
  const sx = K.mxerSystem(mxer, RE, MU);
  const e = K.energy(sx);
  assert.ok(rel(e.perThrow, golden) < tol, `${e.perThrow} vs ${golden}`);
  assert.ok(rel(e.perThrow, golden) < 1e-6, 'and to its printed precision');
  const rGeo = Number(D.values['reboost_bound.r_geo_km'].text.replace(/_/g, ''));
  assert.ok(rel(K.reboostBoundEnergy(mxer, RE, MU, rGeo), golden) < 1e-6, 'reboost_bound.py\'s own route');
  assert.ok(rel(D.reboostBoundFindings.dE_throw_j, golden) < 1e-12);
});

test('reconciliation: recoverySeconds reproduces all 24 rows of reboost_bound.py\'s published grid, labels included', () => {
  const sx = K.mxerSystem(mxer, RE, MU);
  const E = K.energy(sx).perThrow;
  const payloadT = mxer.payload_class.reference_payload_t;
  const interval = (tyr) => 365.25 / (tyr / payloadT) * DAY; // reboost_bound.py:141-143
  const rows = K.grid(E, { etas: [0.3, 0.5, 0.7], duties: [0.3, 0.5], powersW: [50e3, 100e3, 250e3, 500e3], intervalsS: [interval(56), interval(24)], margin: 0 });
  const pub = D.reboostBoundFindings.grid;
  assert.equal(rows.length, 24);
  assert.equal(pub.length, 24);
  for (const p of pub) {
    const r = rows.find((x) => x.eta === p.eta && x.duty === p.duty && x.P === p.power_kw * 1e3);
    assert.equal(r.tRecDays.toFixed(1), p.t_rec_days.toFixed(1), JSON.stringify(p));
    const label = { both: 'both', '24 only': '76.1 d only', neither: 'neither' }[p.support];
    assert.equal(r.support, label, JSON.stringify(p));
  }
  for (const p of D.reboostBoundFindings.minPower56) {
    const P = K.requiredPower(E, p.eta, p.duty, interval(56), 0);
    assert.equal((P / 1e3).toFixed(1), p.power_kw.toFixed(1), JSON.stringify(p));
  }
  assert.equal(Number(D.values['test_analysis_layer.golden_pmin_55_kw'].text), 150.0);
  assert.ok(rel(K.requiredPower(E, 0.5, 0.5, interval(56), 0) / 1e3, 150.0) < 0.01);
  assert.ok(rel(K.requiredPower(E, 0.3, 0.3, interval(56), 0) / 1e3, 416.6) < 0.01);
});

// ---------------------------------------------------------------------------------------------
test('recovery: monotone in power, efficiency and duty; requiredPower inverts it with the margin', () => {
  const E = K.energy(sys()).perThrow;
  let prev = Infinity;
  for (const P of [50e3, 250e3, 1e6, 1e7]) { const t = K.recoverySeconds(E, P, 0.26, 0.5); assert.ok(t < prev); prev = t; }
  assert.ok(K.recoverySeconds(E, 1e6, 0.4, 0.5) < K.recoverySeconds(E, 1e6, 0.26, 0.5));
  assert.ok(K.recoverySeconds(E, 1e6, 0.26, 0.5) < K.recoverySeconds(E, 1e6, 0.26, 0.3));
  for (const T of [5, 10, 1]) {
    const P = K.requiredPower(E, 0.26, 0.5, T * DAY, 0.3);
    assert.ok(rel(1.3 * K.recoverySeconds(E, P, 0.26, 0.5), T * DAY) < 1e-12);
  }
  // the numbers the README quotes: 250 kW at 26 % and duty 1 takes 38.3 days; the 5-10 day rule at 26 % / duty 0.5 needs 2.49-4.98 MW
  assert.equal((K.recoverySeconds(E, 250e3, 0.26, 1) / DAY).toFixed(1), '38.3');
  assert.equal((K.requiredPower(E, 0.26, 0.5, 10 * DAY, 0.3) / 1e6).toFixed(2), '2.49');
  assert.equal((K.requiredPower(E, 0.26, 0.5, 5 * DAY, 0.3) / 1e6).toFixed(2), '4.98');
  // the workbook's conservative cadence (1 catch/day at 15 %) at duty 0.5 with the margin: 43.2 MW
  const wb = D.workbook.rows;
  assert.equal((K.requiredPower(E, wb['6'].Conservative, 0.5, DAY / wb['11'].Conservative, 0.3) / 1e6).toFixed(1), '43.2');
});

test('ledger: one throw at the reference (30 % derate, 200 t hub)', () => {
  const s = sys();
  const l = K.ledger(s);
  assert.equal((l.M / 1e3).toFixed(1), '809.1'); // 200 t hub + 609.1 t canon fibre
  assert.equal((l.da / 1e3).toFixed(1), '64.4');
  assert.equal((l.perigeeDrop / 1e3).toFixed(1), '124.9');
  assert.equal((l.apogeeDrop / 1e3).toFixed(1), '3.9');
  assert.equal((l.tipLowestAfter / 1e3).toFixed(1), '165.1');
  assert.equal(l.dvEquiv.toFixed(1), '35.2');
  assert.equal(l.throw.throwPointIs, 'apogee');
  assert.ok(Math.abs(l.throw.hResidual) < 1e-4, 'angular momentum: the flip model agrees with conservation to 1e-4');
  // energy bookkeeping closes: the tether's specific-energy loss times its mass is the payload's gain
  assert.ok(rel(l.throw.dEpsTether * s.M, K.energy(s).perThrow) < 1e-12);
  // the proposal's impulsive model, implemented as written, gives the proposal's numbers
  assert.equal(l.impulsive.dv.toFixed(1), '30.8');
  assert.equal(Math.round(l.impulsive.da / 1e3), 57);
  assert.equal(Math.round(l.impulsive.perigeeDrop / 1e3), 114);
  assert.equal(Math.round(l.impulsive.tipLowestAfter / 1e3), 176);
});

test('ledger limits: a heavier system loses less, as 1/M; no payload, no loss', () => {
  const d1 = K.ledger(sys({ hubKg: 1e9 })).da, d2 = K.ledger(sys({ hubKg: 2e9 })).da;
  assert.ok(rel(d1 / d2, 2) < 1e-3, 'da halves when M doubles (M >> m)');
  assert.ok(K.ledger(sys({ hubKg: 1e12 })).da < 1);
  assert.ok(K.ledger(sys({ payloadKg: 1e-6 })).da < 1e-3);
  let prev = Infinity;
  for (const hub of [0, 100e3, 200e3, 500e3, 2000e3]) { const d = K.ledger(sys({ hubKg: hub })).da; assert.ok(d < prev); prev = d; }
  // Ballast helps (project_instructions.md:118): so does derate, the other way round: the light tether is the hardest to keep up
  assert.ok(K.ledger(sys({ derate: '0' })).tipLowestAfter < K.ledger(sys({ derate: '0.15' })).tipLowestAfter);
  assert.ok(K.ledger(sys({ derate: '0.15' })).tipLowestAfter < K.ledger(sys({ derate: '0.3' })).tipLowestAfter);
});

test('throws to a floor: integers, non-increasing in the floor, refused at the design tip altitude', () => {
  const s = sys();
  let prev = Infinity;
  for (const f of [50, 100, 150, 200, 250, 289]) {
    for (const ph of ['apogee', 'perigee']) assert.ok(Number.isInteger(K.catchesToFloor(s, f * 1e3, ph).count));
    const c = K.catchesToFloor(s, f * 1e3, 'apogee').count;
    assert.ok(c <= prev);
    prev = c;
  }
  assert.equal(K.catchesToFloor(s, 200e3, 'apogee').count, 0);
  assert.equal(K.catchesToFloor(s, 150e3, 'apogee').count, 1);
  assert.equal(K.catchesToFloor(s, 150e3, 'perigee').count, 2);
  const r = K.catchesToFloor(s, 290e3, 'apogee');
  assert.equal(r.refused, true);
  assert.equal(r.code, 'out_of_envelope');
  // each throw in the trail kept the tip above the floor; the next one would not have
  const t = K.catchesToFloor(s, 100e3, 'perigee');
  for (const x of t.trail) assert.ok(x.tipLowest >= 100e3);
  assert.ok(t.next.tipLowest < 100e3);
});

test('minimum hub for a floor: the boundary is where the tip lands on the floor', () => {
  const opts = { tier: 'reference', derate: '0.3', earthRadiusKm: RE };
  const h = K.minHubForFloor(revA, opts, 200e3);
  assert.equal(Math.round(h / 1e3), 517);
  const at = K.ledger(sys({ hubKg: h })).tipLowestAfter;
  assert.ok(at >= 200e3 && at - 200e3 < 1);
  assert.ok(K.ledger(sys({ hubKg: h - 1e3 })).tipLowestAfter < 200e3);
  assert.equal(K.minHubForFloor(revA, opts, 100e3), 0, 'the fibre alone keeps the tip above 100 km');
  assert.equal(K.minHubForFloor(revA, opts, 290e3).refused, true);
});

// ---------------------------------------------------------------------------------------------
// Skyhook's own model. One run per configuration, shared by the assertions below.
const TWIN_CASES = [
  { tier: 'reference', derate: '0.3', hubKg: 200e3 },
  { tier: 'reference', derate: '0', hubKg: 200e3 },
  { tier: 'cislunar', derate: '0.3', hubKg: 200e3 }
];
const twinRuns = TWIN_CASES.map((c) => {
  const s = sys(c);
  return { c, s, r: TC.run(twinModule, revA, { vTipKms: s.vTip / 1e3, derate: Number(c.derate), hubKg: c.hubKg, payloadKg: s.m, dt: 0.1 }) };
});

test('twin: Skyhook\'s 17-node model builds the same system mass as the canon and conserves energy through the catch and throw', () => {
  for (const { s, r } of twinRuns) {
    assert.ok(rel(r.M, s.M) < 1e-3, `${r.M} vs ${s.M}`);
    assert.ok(rel(r.tetherEnergyLossPerKgPayload, r.payloadGainPerKg) < 1e-6, 'what the payload gains the tether loses');
    assert.ok(r.energyDriftRel < 1e-8);
  }
});

test('twin: the loaded-release ledger matches the twin\'s semi-major axis at release to 0.1 % and its release C3 to 0.03', () => {
  for (const { c, r } of twinRuns) {
    const sl = sys(Object.assign({}, c, { release: 'loaded' }));
    const l = K.ledger(sl);
    assert.ok(rel(l.da, r.daAtRelease) < 1e-3, `${c.tier} ${c.derate}: ${l.da} vs ${r.daAtRelease}`);
    assert.ok(Math.abs(K.energy(sl).c3 - r.payloadC3) / 1e6 < 0.03, `${K.energy(sl).c3} vs ${r.payloadC3}`);
  }
  // At the reference the payload leaves at C3 -8.74, not the canon -8.06: the canon assumes an infinitely heavy tether.
  assert.equal((twinRuns[0].r.payloadC3 / 1e6).toFixed(2), '-8.74');
});

test('twin: the canon ledger is within 2.5 % of the twin\'s orbit-mean da and closer on the tip than the impulsive model', () => {
  for (const { s, r } of twinRuns) {
    const l = K.ledger(s);
    const e = (l.da - r.da) / r.da;
    assert.ok(e > 0 && e < 0.025, `canon ledger da ${l.da} vs twin ${r.da}`);
    const ei = (l.impulsive.da - r.da) / r.da;
    assert.ok(ei < -0.08, `impulsive da ${l.impulsive.da} misses the twin by ${(ei * 100).toFixed(1)} %`);
    assert.ok(Math.abs(l.tipLowestAfter - r.lowestNodeAltM) < 10e3, `tip ${l.tipLowestAfter} vs twin lowest node ${r.lowestNodeAltM}`);
    assert.ok(Math.abs(l.tipLowestAfter - r.lowestNodeAltM) <= Math.abs(l.impulsive.tipLowestAfter - r.lowestNodeAltM));
  }
});

test('twin: the classic copy the page runs gives the same numbers as the verbatim module', () => {
  const s = sys();
  const a = TC.run(twinClassic, revA, { vTipKms: 2.5, derate: 0.3, hubKg: HUB, payloadKg: s.m, dt: 0.1 });
  assert.deepEqual(a, twinRuns[0].r);
});

// ---------------------------------------------------------------------------------------------
test('refusals: no $/kg, no fibre mass the canon does not print, no overload, no nonsense inputs', () => {
  const p = K.pricePerKg(revA);
  assert.equal(p.refused, true);
  assert.equal(p.code, 'insufficient_data');
  for (const k of Object.keys(revA.economics).filter((k) => !k.startsWith('_'))) assert.ok(p.reason.includes(k));
  const withPrice = JSON.parse(JSON.stringify(revA));
  withPrice.economics.electricity_per_kwh = 0.08;
  assert.notEqual(K.pricePerKg(withPrice).code, 'insufficient_data', 'the refusal is read from the canon, not hard-wired');
  const c15 = sys({ tier: 'cislunar', derate: '0.15' });
  assert.equal(c15.refused, true);
  assert.equal(c15.code, 'insufficient_data');
  assert.equal(sys({ payloadKg: 5001 }).code, 'out_of_envelope');
  assert.equal(sys({ hubKg: -1 }).code, 'invalid_input');
  assert.equal(sys({ payloadKg: 0 }).code, 'invalid_input');
  const E = K.energy(sys()).perThrow;
  assert.equal(K.recoverySeconds(E, 0, 0.26, 0.5).code, 'invalid_input');
  assert.equal(K.recoverySeconds(E, 1e6, 1.2, 0.5).code, 'invalid_input');
  assert.equal(K.recoverySeconds(E, 1e6, 0.26, 0).code, 'invalid_input');
  assert.equal(K.energy(c15), c15, 'a refusal passes through unchanged');
  assert.equal(K.ledger(c15), c15);
});

test('the DRAFT in-space fork\'s own ledger: one 5 t throw at its perigee drops its apogee by 2,184 km', () => {
  const sx = K.mxerSystem(mxer, RE, MU);
  const l = K.mxerLedger(sx);
  assert.ok(rel(l.vAtPerigee / 1e3, mxer.tether_com_orbit.v_perigee_kms) < 1e-6, 'vis-viva at perigee reproduces the draft\'s v_perigee');
  assert.equal(Math.round(l.apogeeDrop / 1e3), 2184);
  assert.equal(Math.round(l.da / 1e3), 1107);
  assert.equal(l.throw.throwPointIs, 'perigee');
});
