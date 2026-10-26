// Tests for the catch-window kernel. Node built-ins only. From the bank root:
//   node --test ideas/09-two-seconds-at-bottom/catchwindow.test.mjs
//
// What is pinned to things outside this code: the snapshots' own sha256 sidecars; constants regexed
// from the physics-module snapshot; the canon's stated tip accelerations, ground-relative speeds,
// rotation period and release speed; the twin's golden t = 0 state (r = 6661 km, 5056.311 m/s);
// hand-worked closed forms computed here from the raw constants without calling the kernel; and an
// exact two-body integration of the same scene; and the twin's golden run against the libration
// model. README › Tests lists what each sabotage breaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CW = require(path.join(here, 'catchwindow.js'));
const CANON = require(path.join(here, 'snapshots', 'canon.data.js'));
const { derive, render, pyConstant } = await import(path.join(here, 'build-data.mjs'));

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b} (rel ${Math.abs(a - b) / Math.abs(b)})`);
const within = (a, b, abs, msg) => assert.ok(Math.abs(a - b) <= abs, `${msg}: ${a} vs ${b} (abs ${Math.abs(a - b)})`);

const K = CW.create(CANON);
assert.ok(K.ok, 'kernel creates from the canon');
const C = K.constants;
const REV = readJson('snapshots/rev_a.json');
const E = 10; // the founding document's +-10 m envelope (docs/project_instructions.md:124, program site 4.3)
const VT = 1; // and its ~1 m/s
const ref = K.evaluate({ tier: 'reference', envelopeM: E, velTolMps: VT, holdS: 10, requirementWindowsS: [3, 10] });
assert.ok(ref.ok);

// ------------------------------------------------------------------ snapshots
test('every file under snapshots/ still hashes to what its own sidecar recorded, and sidecars are complete', () => {
  const dir = path.join(here, 'snapshots');
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.provenance.json'));
  assert.ok(files.length >= 4, `expected rev_a.json, skyhook_physics.py, golden.json, canon.data.js; got ${files.join(', ')}`);
  for (const f of files) {
    const side = readJson(`snapshots/${f}.provenance.json`);
    assert.equal(sha256(fs.readFileSync(path.join(dir, f))), side.writtenSha256, `${f} matches its sidecar`);
    assert.match(side.commit, /^[0-9a-f]{40}$/, `${f} sidecar has a full commit`);
    assert.equal(side.readMatchesCommitted, true, `${f} was read from a clean checkout`);
    assert.equal(side.repo, 'https://github.com/hudsonclavin-cloud/skyhook');
  }
  // the three copies are byte-identical to their sources' recorded hashes
  for (const f of ['rev_a.json', 'skyhook_physics.py', 'golden.json']) {
    const side = readJson(`snapshots/${f}.provenance.json`);
    assert.equal(side.mode, 'copy');
    assert.equal(side.writtenSha256, side.sourceSha256, `${f} is a whole copy`);
  }
  assert.equal(readJson('snapshots/canon.data.js.provenance.json').mode, 'derived');
});

test('canon.data.js re-derives byte for byte from the snapshots and deep-equals rev_a.json', () => {
  const regenerated = render(derive());
  assert.equal(fs.readFileSync(path.join(here, 'snapshots', 'canon.data.js'), 'utf8'), regenerated, 'derived file is current');
  assert.deepEqual(CANON.revA, REV);
  assert.equal(CANON.revAProvenance.sourceSha256, sha256(fs.readFileSync(path.join(here, 'snapshots', 'rev_a.json'))));
  // the same regex on the physics-module snapshot gives the same constants and lines
  const py = fs.readFileSync(path.join(here, 'snapshots', 'skyhook_physics.py'), 'utf8');
  assert.deepEqual(pyConstant(py, 'R_EARTH_KM'), CANON.physicsModule.R_EARTH_KM);
  assert.deepEqual(pyConstant(py, 'G_STD'), CANON.physicsModule.G_STD);
  assert.deepEqual(pyConstant(py, 'v_earth_rot'), CANON.physicsModule.v_earth_rot_kms);
  assert.throws(() => pyConstant(py, 'NO_SUCH_CONSTANT'));
});

test('the constants the kernel uses are the canon’s, by key', () => {
  assert.equal(C.mu, REV.orbital.mu_earth_m3s2);
  assert.equal(C.comAltitudeKm, REV.orbital.com_altitude_km);
  assert.equal(C.halfLengthKm, REV.geometry.tether_half_length_km);
  assert.equal(C.tiers.reference.vTipKms, REV.kinematics.v_tip_kms);
  assert.equal(C.tiers.cislunar.vTipKms, REV.kinematics.cislunar_revenue_gated_option.v_tip_kms);
  assert.equal(C.tiers.phase3.vTipKms, REV.kinematics.phase3_growth_option.v_tip_kms);
  assert.equal(C.earthRadiusKm, 6371, 'R_EARTH_KM from physics/skyhook_physics.py line 40');
  assert.equal(CANON.physicsModule.R_EARTH_KM.line, 40);
  assert.equal(C.earthRotKmsEq3a, 0.465, 'EQ-3a literal');
  assert.equal(CANON.physicsModule.v_earth_rot_kms.line, 109);
  assert.equal(C.g0, 9.80665);
  assert.equal(C.rComKm, 6981, 'the radius the module, the twin and the file’s C3 notes use');
  assert.equal(C.comRadiusKmStated, 6988, 'the file’s own orbital.com_radius_km (finding F1 of idea 01)');
});

// ------------------------------------------------------------------ reconciliation with the canon
test('reproduces the canon’s stated tip accelerations, ground-relative speeds, rotation period and release speed', () => {
  const rows = K.tierTable({ envelopeM: E, velTolMps: VT, holdS: 10 });
  for (const r of rows) {
    const g = r.kin.aCentripetalG;
    const stated = r.stated.tipAccelG;
    const decimals = String(stated).includes('.') ? String(stated).split('.')[1].length : 0;
    assert.equal(Number(g.toFixed(decimals)), stated, `${r.key} tip acceleration ${g} rounds to the file’s ${stated}`);
    if (r.stated.groundrelKms !== null) {
      assert.equal(Number((r.kin.eq3a.speed / 1e3).toFixed(2)), r.stated.groundrelKms, `${r.key} ground-relative speed (EQ-3a)`);
    }
  }
  assert.equal(Number(ref.kin.periodMin.toFixed(1)), REV.geometry.rotation_period_min, 'rotation period 13.4 min');
  assert.equal(Number((ref.kin.vUpperInertialTop / 1e3).toFixed(2)), REV.kinematics.v_upper_release_kms, 'upper release 10.06 km/s');
  assert.equal(ref.kin.tipAltitudeKm, REV.geometry.tip_altitude_lower_km, 'tip altitude 290 km');
});

test('the twin’s golden t = 0 state is the same scene: lower tip at r_com - L moving v_orb - v_tip', () => {
  const g = CANON.golden;
  assert.equal(g.meta.config.v_tip_kms, C.tiers.reference.vTipKms);
  assert.equal(g.meta.config.half_length_km, C.halfLengthKm);
  assert.equal(g.meta.config.com_altitude_km, C.comAltitudeKm);
  const [x, y, vx, vy] = g.t0.lowerTip;
  assert.equal(x, ref.kin.rTipKm * 1e3, 'lower tip radius 6661 km');
  assert.equal(y, 0);
  assert.equal(vx, 0);
  close(vy, ref.kin.vTipInertialBottom, 1e-12, 'lower tip inertial speed 5056.311 m/s');
  const hub = g.t0.hub;
  assert.equal(hub[0], C.rComKm * 1e3);
  close(hub[3], ref.kin.vOrb, 1e-12, 'hub speed is v_orb at 6981 km');
  close(g.t0.upperTip[3], ref.kin.vUpperInertialTop, 1e-12, 'upper tip speed v_orb + v_tip');
  // and the exact-scene integrator starts from the identical state
  const ex = K.exact(ref.kin);
  assert.deepEqual(ex.tipPos(0), [x, y]);
  const v0 = ex.tipVel(0);
  within(v0[0], vx, 1e-9, 'tip vx(0)');
  close(v0[1], vy, 1e-12, 'tip vy(0)');
});

test('two Earth radii in the canon change a_rel by less than 0.02 % (this deposit is insensitive to F1)', () => {
  const alt = K.evaluate({ tier: 'reference', rComKm: C.comRadiusKmStated, envelopeM: E, velTolMps: VT, holdS: 10 });
  assert.ok(alt.ok);
  close(alt.kin.aRel, ref.kin.aRel, 2e-4, 'a_rel with com_radius_km 6988');
  // the file's v_orb 7.55 is what 6988 gives; 6981 gives 7.56 (the F1 inconsistency, observed not fixed)
  assert.equal(Number((alt.kin.vOrb / 1e3).toFixed(2)), REV.orbital.v_orb_kms);
  assert.equal(Number((ref.kin.vOrb / 1e3).toFixed(2)), 7.56);
  // both round the reference ground-relative speed to the file's 4.59
  assert.equal(Number((alt.kin.eq3a.speed / 1e3).toFixed(2)), REV.kinematics.v_lower_tip_groundrel_kms);
});

// ------------------------------------------------------------------ hand-worked closed forms
test('a_rel at Rev A is the hand-worked sum v^2/L - mu/R^2 + mu/(R-L)^2, 20.34 m/s^2 = 2.07 g', () => {
  const mu = REV.orbital.mu_earth_m3s2;
  const L = REV.geometry.tether_half_length_km * 1e3;
  const R = (6371 + REV.orbital.com_altitude_km) * 1e3;
  const v = REV.kinematics.v_tip_kms * 1e3;
  const byHand = (v * v) / L - mu / (R * R) + mu / ((R - L) * (R - L));
  close(ref.kin.aRel, byHand, 1e-12, 'a_rel');
  within(ref.kin.aCentripetal, 19.53125, 1e-9, 'v^2/L = 6.25e6 / 3.2e5');
  within(ref.kin.gHub, 8.1790, 1e-4, 'g at the hub, mu / (6981 km)^2');
  within(ref.kin.gTip, 8.9838, 1e-4, 'g at the tip, mu / (6661 km)^2');
  within(ref.kin.aRel, 20.34, 0.005, 'a_rel 20.34 to two decimals');
  within(ref.kin.aRelG, 2.07, 0.005, '2.07 g');
  // g is the module's G_STD exactly, not a retyped 9.81
  assert.equal(ref.kin.aRelG, ref.kin.aRel / CANON.physicsModule.G_STD.value, 'aRelG = aRel / G_STD');
  assert.equal(ref.kin.aCentripetalG, ref.kin.aCentripetal / CANON.physicsModule.G_STD.value, 'aCentripetalG = v^2/L / G_STD');
  // the proposal's 20.3 (judges recomputed 20.34) within 0.1 %
  close(ref.kin.aRel, 20.34, 1e-3, 'proposal figure');
  // the tip itself accelerates outward at omega^2 L - g_hub, and the gradient term is ~0.80
  within(ref.kin.aTipInertial, ref.kin.aCentripetal - ref.kin.gHub, 1e-12, 'tip inertial acceleration');
  within(ref.kin.aTipInertial, 11.352, 5e-4, 'about 11.35 m/s^2 outward');
  within(ref.kin.gravityGradient, 0.8048, 5e-4, 'g_tip - g_hub');
  close(ref.kin.gravityGradientLinear, ref.kin.gravityGradient, 0.08, 'linearised 2 mu L / R^3 is within 8 %');
});

test('passive windows: +-0.99 s inside +-10 m, +-0.049 s inside +-1 m/s; velocity binds; totals under 3 s and 0.2 s', () => {
  const p = ref.passive;
  within(p.tPos, Math.sqrt((2 * E) / ref.kin.aRel), 1e-12, 't_pos closed form');
  within(p.tPos, 0.9917, 5e-4, 't_pos');
  within(p.tVel, 0.04917, 5e-5, 't_vel');
  assert.equal(p.binding, 'velocity');
  assert.ok(p.totalPos < 3, `position window ${p.totalPos} s is below the 3 s requirement`);
  assert.ok(p.totalPos > 1.9 && p.totalPos < 2.0, 'the title: two seconds at the bottom');
  assert.ok(p.totalVel < 0.2, `velocity window ${p.totalVel} s`);
  within(p.speedAtEnvelopeEdge, Math.sqrt(2 * ref.kin.aRel * E), 1e-12, 'speed at the envelope edge');
  within(p.speedAtEnvelopeEdge, 20.17, 0.01, '~20 m/s when the vehicle leaves +-10 m');
  within(p.separationAtVelTol, 0.0246, 1e-4, '2.5 cm of separation when the velocity tolerance is spent');
  within(p.bestPassive.totalS, 4 * Math.sqrt(E / ref.kin.aRel), 1e-12, 'best passive = 4 sqrt(e/a)');
  within(p.bestPassive.totalS, 2.805, 2e-3, 'even the grazing trajectory gets 2.8 s');
  within(p.bestPassive.edgeSpeedMps, 28.5, 0.05, 'and arrives at 28.5 m/s');
});

test('scaling: t_pos goes as sqrt(envelope), t_vel linearly, both as 1/sqrt(a) and 1/a', () => {
  const a = ref.kin.aRel;
  const p10 = CW.passive({ aRel: a, envelopeM: 10, velTolMps: 1 });
  const p40 = CW.passive({ aRel: a, envelopeM: 40, velTolMps: 3 });
  close(p40.tPos / p10.tPos, 2, 1e-12, 'x4 envelope doubles t_pos');
  close(p40.tVel / p10.tVel, 3, 1e-12, 'x3 tolerance triples t_vel');
  const p4a = CW.passive({ aRel: 4 * a, envelopeM: 10, velTolMps: 1 });
  close(p4a.tPos / p10.tPos, 0.5, 1e-12, 'x4 acceleration halves t_pos');
  close(p4a.tVel / p10.tVel, 0.25, 1e-12, 'and quarters t_vel');
});

test('held window: 2.07 g for the whole window, 61 m/s for 3 s and 203 m/s for 10 s; 4.4 % of the catch speed', () => {
  const h = ref.held;
  assert.equal(h.accel, ref.kin.aRel);
  within(h.deltaV, 10 * ref.kin.aRel, 1e-9, 'dv = a T');
  within(h.deltaV, 203.4, 0.05, '203 m/s for 10 s');
  within(ref.requirement[0].held.deltaV, 61.0, 0.05, '61 m/s for 3 s');
  // against EQ-3a's catch speed, hand-worked from the raw constants: 203.36 / 4591.31
  const mu = REV.orbital.mu_earth_m3s2;
  const R = (6371 + REV.orbital.com_altitude_km) * 1e3;
  const L = REV.geometry.tether_half_length_km * 1e3;
  const v = REV.kinematics.v_tip_kms * 1e3;
  const aByHand = (v * v) / L - mu / (R * R) + mu / ((R - L) * (R - L));
  const catchByHand = Math.sqrt(mu / R) - v - 465;
  close(h.fractionOfCatchSpeed, (10 * aByHand) / catchByHand, 1e-6, 'fraction of the EQ-3a catch speed');
  close(h.fractionOfCatchSpeed, 203.36 / 4591.31, 1e-5, '203.36 / 4591.31');
  within(h.reelExcursionM, 0.5 * ref.kin.aRel * 25, 1e-9, 'reel excursion over +-5 s');
  within(h.reelPeakSpeedMps, 101.7, 0.05, 'reel peak line speed');
});

test('what the 3 s and 10 s requirements would need passively: +-22.9 m at 30.5 m/s and +-254 m at 102 m/s', () => {
  const [r3, r10] = ref.requirement;
  assert.equal(r3.totalS, 3);
  within(r3.passive.envelopeM, 22.88, 0.01, 'envelope for a passive 3 s');
  within(r3.passive.edgeSpeedMps, 30.5, 0.05, 'edge speed for a passive 3 s');
  within(r10.passive.envelopeM, 254.2, 0.1, 'envelope for a passive 10 s');
  within(r10.passive.edgeSpeedMps, 101.7, 0.05, 'edge speed for a passive 10 s');
  // the site's catch sketch injects a 30 m/s mismatch: that is 1.5 s of free fall here
  within(30 / ref.kin.aRel, 1.475, 2e-3, '30 m/s is reached 1.48 s after the match');
});

test('window grows monotonically with half-length at fixed tip speed, and no half-length gives a passive 3 s', () => {
  const pts = K.windowVsLength({ vTipKms: 2.5, envelopeM: E, velTolMps: VT, lMinKm: 50, lMaxKm: 609, n: 100 });
  assert.ok(pts.length >= 95);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].tPos > pts[i - 1].tPos, `t_pos increases from L=${pts[i - 1].LKm} to ${pts[i].LKm}`);
    assert.ok(pts[i].aRel < pts[i - 1].aRel, 'a_rel decreases with L');
    assert.ok(pts[i].tipAltitudeKm > 0, 'tip stays above ground');
  }
  const ceil = K.passiveCeiling({ vTipKms: 2.5, envelopeM: E, velTolMps: VT });
  assert.ok(ceil.ok);
  within(ceil.atHalfLengthKm, 610, 1e-9);
  within(ceil.totalPos, 2.594, 2e-3, 'tip at sea level: 2.59 s');
  assert.ok(ceil.totalPos < 3, 'even with the tip at sea level the passive +-10 m window is under 3 s');
  assert.ok(ceil.totalVel < 0.2, 'and the +-1 m/s window under 0.2 s');
  for (const v of [2.5, 2.8, 3.5]) {
    const c = K.passiveCeiling({ vTipKms: v, envelopeM: E, velTolMps: VT });
    assert.ok(c.totalPos < 3, `tier ${v}: ceiling ${c.totalPos} s`);
  }
});

test('tiers: a_rel and hold dv rise with tip speed, windows shrink; stated speeds reconcile', () => {
  const rows = K.tierTable({ envelopeM: E, velTolMps: VT, holdS: 10 });
  assert.deepEqual(rows.map((r) => r.key), ['reference', 'cislunar', 'phase3']);
  assert.deepEqual(rows.map((r) => r.vTipKms), [2.5, 2.8, 3.5]);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].kin.aRel > rows[i - 1].kin.aRel);
    assert.ok(rows[i].held.deltaV > rows[i - 1].held.deltaV);
    assert.ok(rows[i].passive.tPos < rows[i - 1].passive.tPos);
    assert.ok(rows[i].passive.tVel < rows[i - 1].passive.tVel);
  }
  within(rows[2].kin.aRel, 39.09, 0.01, 'Phase 3 a_rel');
  within(rows[2].held.deltaV, 390.9, 0.1, 'Phase 3 hold dv for 10 s');
  within(rows[1].kin.eq3a.speed / 1e3, 4.29, 0.005, 'cislunar ground-relative, which the file does not state');
});

// ------------------------------------------------------------------ Earth rotation convention
test('EQ-3a’s 0.465 km/s is the equatorial surface speed; the Earth-fixed velocity at the tip is 21 m/s lower; the ground track is a third, slower quantity', () => {
  within(CW.OMEGA_EARTH, 7.2921e-5, 1e-9, 'omega_E from the 23.9345 h sidereal day');
  close(ref.kin.coRotationEquatorSurface / 1e3, C.earthRotKmsEq3a, 2e-3, 'omega_E x 6378.137 km = 465.1 m/s vs the 0.465 literal');
  within(ref.kin.earthFixed.coRotation, 485.7, 0.3, 'co-rotation at 6661 km');
  within(ref.kin.eq3a.speed / 1e3, 4.5913, 5e-4, 'EQ-3a: inertial minus the equatorial surface speed');
  within(ref.kin.earthFixed.speed / 1e3, 4.5706, 5e-4, 'velocity relative to the rotating Earth at the tip (= co-rotating airspeed)');
  within(ref.kin.eq3a.speed - ref.kin.earthFixed.speed, 20.7, 0.3, 'the gap');
  // the sub-point (ground-track) speed, hand-worked: (v / r_tip - omega_E) * R_E with the module's 6371 km
  const vIn = ref.kin.vTipInertialBottom;
  within(ref.kin.subPoint.speed, (vIn / 6661e3 - CW.OMEGA_EARTH) * 6371e3, 1e-9, 'sub-point speed formula');
  within(ref.kin.subPoint.speed / 1e3, 4.3716, 5e-4, 'ground track about 4.37 km/s, not the 4.59 of EQ-3a');
  assert.ok(ref.kin.subPoint.speed < ref.kin.earthFixed.speed - 150, 'the ground track is well below both');
  assert.equal(CW.EARTH_REF.volumetricMeanRadiusKm, C.earthRadiusKm, 'the module’s 6371 is the volumetric mean radius');
});

// ------------------------------------------------------------------ exact two-body check
test('exact two-body integration: separation a t^2/2 and relative speed a t hold to 3e-4 at 10 s, exit time at +-10 m to 1e-4', () => {
  const ex = K.exact(ref.kin);
  for (const [t, tol] of [[1, 2e-5], [5, 1e-4], [10, 3e-4]]) {
    const r = ex.passiveAt(t, 0.002);
    close(r.sepM, 0.5 * ref.kin.aRel * t * t, tol, `separation at ${t} s`);
    close(r.relSpeedMps, ref.kin.aRel * t, tol, `relative speed at ${t} s`);
  }
  const r10 = ex.passiveAt(10, 0.002);
  within(r10.sepM, 1016.6, 0.3, 'about a kilometre after 10 s');
  const tExit = ex.passiveExitTime(E, 0.001);
  close(tExit, ref.passive.tPos, 1e-4, 'exit from +-10 m');
  // the closed form is an upper bound by a hair: the real separation lags a t^2/2 (ratio < 1)
  assert.ok(r10.sepM < 0.5 * ref.kin.aRel * 100);
});

test('exact hold delta-v over a symmetric window matches a_rel T to 1e-4 at 10 s and the thrust magnitude barely moves', () => {
  const ex = K.exact(ref.kin);
  for (const [T, tol] of [[3, 1e-5], [10, 1e-4], [20, 2e-4]]) {
    const h = ex.holdDeltaV(T, 2000);
    close(h.deltaV, ref.kin.aRel * T, tol, `exact dv for ${T} s`);
    within(h.thrustAtMatch, ref.kin.aRel, 1e-9, 'thrust at the match instant is a_rel');
    close(h.thrustAtEdge, ref.kin.aRel, 5e-4, `thrust at +-${T / 2} s`);
  }
});

// ------------------------------------------------------------------ spin modulation and the meaning of v_tip
test('the libration model reproduces the twin’s golden run: 600 s mean tip speed to 1e-4, checkpoint speeds to 2e-3, phase to 0.1 degree', () => {
  const m = K.modulation();
  assert.ok(m.ok);
  assert.equal(m.golden.applicable, true, 'reference tier at the canon L is the golden configuration');
  const G = readJson('snapshots/golden.json');
  close(m.golden.model.meanSpeed, G.mean_tip_speed_mps, 1e-4, 'model 600 s mean vs the golden 2462.64 m/s');
  close(m.golden.model.meanCentripetal, G.mean_tip_centripetal_accel_mps2, 3e-4, 'model 600 s mean centripetal vs the golden 18.956 m/s^2');
  const n = G.meta.config.n_nodes;
  for (const s of m.golden.model.samples) {
    const c = G.checkpoints[String(s.t)];
    close(s.speed, c.tip_speed_rel_com, 2e-3, `tip speed at ${s.t} s`);
    if (s.t === 0) continue;
    const st = c.state;
    const hub = st.slice((4 * (n - 1)) / 2, (4 * (n - 1)) / 2 + 4);
    const ang = Math.atan2(st[1] - hub[1], st[0] - hub[0]) - Math.atan2(-hub[1], -hub[0]);
    const twinDeg = (((ang * 180) / Math.PI) % 360 + 360) % 360;
    within(((s.thetaDeg % 360) + 360) % 360, twinDeg, 0.1, `pitch angle from the local vertical at ${s.t} s`);
  }
});

test('the 600 s golden mean is not a rotation mean; the rotation mean (closed form) is 1.71 % below the vertical speed, inside the glossary’s 1.5-2 %', () => {
  const m = K.modulation();
  // the closed-form AGM mean equals the numerically integrated mean over exactly one orbit-frame rotation
  const thdA = ref.kin.omega - m.orbitalRate;
  const one = m.libration.integrate(thdA, m.orbitFrameRotationS, m.orbitFrameRotationS / 20000, []);
  close(one.meanSpeed, m.vertical.rotationMeanMps, 1e-6, 'rotation mean: closed form vs integration');
  within(m.meanBelowVerticalFraction, 0.01714, 5e-5, 'rotation mean 1.71 % below the vertical speed');
  assert.ok(m.meanBelowVerticalFraction > 0.015 && m.meanBelowVerticalFraction < 0.02, 'docs/glossary.md: ~1.5-2 %');
  within(m.peakToTroughFraction, 0.0341, 1e-4, 'peak to trough 3.4 % of the vertical speed');
  // 600 s is 0.746 inertial rotations and 1.26 modulation cycles, so the golden mean is a 600 s mean
  within(m.golden.rotationsCovered, 0.746, 1e-3, 'rotations covered by the golden run');
  within(m.golden.modulationCyclesCovered, 1.26, 5e-3, 'modulation cycles covered');
  assert.ok(m.golden.model.meanSpeed / m.vertical.rotationMeanMps - 1 > 2e-3, 'the 600 s mean sits above the rotation mean by more than 0.2 %');
});

test('if v_tip is the rotation mean, a_rel at Rev A is 21.00 m/s^2 (+3.25 %); the range is 20.34 to 21.00', () => {
  const m = K.modulation();
  close(m.mean.rotationMeanMps, 2500, 1e-9, 'the solved spin has a rotation mean of exactly v_tip');
  within(m.mean.vAtVerticalMps, 2541.98, 0.01, 'the tip then passes the vertical at 2542 m/s');
  assert.equal(m.vertical.aRel, ref.kin.aRel, 'read at the vertical, a_rel is the page’s');
  within(m.mean.aRel, (2541.979 ** 2) / 320e3 - ref.kin.gHub + ref.kin.gTip, 1e-3, 'a_rel at the vertical speed, by hand');
  within(m.mean.aRel, 20.997, 1e-3, '21.00 m/s^2');
  within(m.aRelIncreaseFraction, 0.03253, 5e-5, '+3.25 %');
  within(m.envelopeWindowShorteningFraction, 0.01588, 5e-5, 'envelope windows 1.59 % shorter');
  assert.deepEqual(m.aRelRange, [m.vertical.aRel, m.mean.aRel]);
  // the ratio of the golden 600 s mean would have given 20.93: inside the range, but not a rotation mean
  const via600 = (2500 * 2500) / 2462.640694087045;
  const aVia600 = (via600 * via600) / 320e3 - ref.kin.gHub + ref.kin.gTip;
  within(aVia600, 20.933, 1e-3, 'the 600 s ratio gives 20.93');
  assert.ok(aVia600 > m.vertical.aRel && aVia600 < m.mean.aRel);
});

test('away from the golden configuration the modulation scales with Omega^2/omega^2 and no golden check is claimed', () => {
  const base = K.modulation();
  const cases = [
    { name: 'Phase 3 at the canon L', opts: { vTipKms: C.tiers.phase3.vTipKms }, maxIncrease: 0.02 },
    { name: 'reference at L = 100 km', opts: { halfLengthKm: 100 }, maxIncrease: 0.005 },
  ];
  for (const c of cases) {
    const m = K.modulation(c.opts);
    assert.ok(m.ok, c.name);
    assert.equal(m.golden.applicable, false, `${c.name}: not the twin's configuration`);
    assert.equal(m.golden.model, undefined, `${c.name}: no model-vs-twin line`);
    assert.ok(m.aRelIncreaseFraction > 0 && m.aRelIncreaseFraction < c.maxIncrease, `${c.name}: +${m.aRelIncreaseFraction}`);
    // small-modulation limit: the mean depression goes as (3/4) Omega^2 / theta_v'^2 times theta_v'/omega
    const kin = K.kinematics({ vTipKms: m.vTipKms, halfLengthKm: m.halfLengthKm });
    const thd = kin.omega - m.orbitalRate;
    const approx = ((0.75 * m.orbitalRate * m.orbitalRate) / (thd * thd)) * (thd / kin.omega);
    close(m.meanBelowVerticalFraction, approx, 0.06, `${c.name}: depression vs its small-k limit`);
    assert.ok(m.meanBelowVerticalFraction < base.meanBelowVerticalFraction, `${c.name}: less modulation than the reference`);
  }
  // the reviewer's figures for the page's old, unscaled caveat: +2.99 % and +3.05 %; scaled, they are about +1.6 % and +0.3 %
  within(K.modulation({ vTipKms: C.tiers.phase3.vTipKms }).aRelIncreaseFraction, 0.0161, 5e-4, 'Phase 3');
  within(K.modulation({ halfLengthKm: 100 }).aRelIncreaseFraction, 0.00293, 5e-5, 'L = 100 km');
  // the canon's own com_radius_km is not the twin's configuration either
  assert.equal(K.modulation({ rComKm: C.comRadiusKmStated }).golden.applicable, false);
  // a spin too slow to pass the horizontal librates and has no rotation mean
  assert.equal(K.modulation({ vTipKms: 0.3 }).refusal.code, 'out_of_envelope');
});

// ------------------------------------------------------------------ refusals
test('refuses structured, never a placeholder number', () => {
  assert.equal(CW.create(null).refusal.code, 'not_found');
  assert.equal(CW.create({}).refusal.code, 'not_found');
  const noMu = JSON.parse(JSON.stringify(CANON));
  delete noMu.revA.orbital.mu_earth_m3s2;
  const r = CW.create(noMu);
  assert.equal(r.refusal.code, 'not_found');
  assert.match(r.refusal.reason, /orbital\.mu_earth_m3s2/);
  const noPy = JSON.parse(JSON.stringify(CANON));
  delete noPy.physicsModule.R_EARTH_KM;
  assert.equal(CW.create(noPy).refusal.code, 'not_found');

  assert.equal(K.evaluate({ tier: 'lunar', envelopeM: E, velTolMps: VT, holdS: 10 }).refusal.code, 'not_found');
  const under = K.evaluate({ tier: 'reference', halfLengthKm: 610, envelopeM: E, velTolMps: VT, holdS: 10 });
  assert.equal(under.refusal.code, 'out_of_envelope');
  assert.match(under.refusal.reason, /below the ground/);
  assert.equal(K.evaluate({ tier: 'reference', halfLengthKm: 700, envelopeM: E, velTolMps: VT, holdS: 10 }).refusal.code, 'out_of_envelope');
  assert.ok(K.evaluate({ tier: 'reference', halfLengthKm: 609, envelopeM: E, velTolMps: VT, holdS: 10 }).ok, '609 km is still above ground');
  for (const bad of [0, -1, NaN, Infinity, '10', undefined, null]) {
    assert.equal(K.evaluate({ tier: 'reference', envelopeM: bad, velTolMps: VT, holdS: 10 }).refusal.code, 'out_of_envelope', `envelope ${String(bad)}`);
    assert.equal(K.evaluate({ tier: 'reference', envelopeM: E, velTolMps: bad, holdS: 10 }).refusal.code, 'out_of_envelope', `tolerance ${String(bad)}`);
    assert.equal(K.evaluate({ tier: 'reference', envelopeM: E, velTolMps: VT, holdS: bad }).refusal.code, 'out_of_envelope', `hold ${String(bad)}`);
    assert.equal(K.evaluate({ vTipKms: bad, envelopeM: E, velTolMps: VT, holdS: 10 }).refusal.code, 'out_of_envelope', `tip speed ${String(bad)}`);
  }
  for (const r2 of [K.evaluate({ tier: 'x' }), K.evaluate({ tier: 'reference', envelopeM: -1, velTolMps: 1, holdS: 1 })]) {
    assert.equal(r2.ok, false);
    assert.ok(r2.refusal.reason.length > 10);
    assert.ok(typeof r2.refusal.what_would_help === 'string');
    assert.equal(r2.kin, undefined, 'no numbers ride along with a refusal');
  }
});

test('validity: the tip altitude flag flips at the stated 150 km, and the ground is a refusal not a flag', () => {
  const ok = K.evaluate({ tier: 'reference', halfLengthKm: 460, envelopeM: E, velTolMps: VT, holdS: 10 });
  assert.ok(ok.ok);
  assert.equal(ok.kin.tipAltitudeKm, 150);
  assert.equal(ok.kin.validity.atmosphereClear, true);
  const low = K.evaluate({ tier: 'reference', halfLengthKm: 470, envelopeM: E, velTolMps: VT, holdS: 10 });
  assert.equal(low.kin.validity.atmosphereClear, false);
  assert.equal(low.kin.validity.tipAboveGround, true);
  assert.equal(CW.ATMOSPHERE_CLEAR_KM, 150);
});

test('closed-form validity: half-windows past 4 % of a rotation are refused, and at that bound the exact scene agrees to 0.3 %', () => {
  assert.equal(CW.CLOSED_FORM_MAX_ROTATION_FRACTION, 0.04);
  const bound = ref.kin.validity.closedFormMaxHalfWindowS;
  within(bound, 0.04 * 804.25, 0.01, 'Rev A: 32.2 s');
  const ok64 = K.evaluate({ tier: 'reference', envelopeM: E, velTolMps: VT, holdS: 64 });
  assert.ok(ok64.ok, 'a 64 s hold is inside');
  const no65 = K.evaluate({ tier: 'reference', envelopeM: E, velTolMps: VT, holdS: 65 });
  assert.equal(no65.refusal.code, 'out_of_envelope');
  assert.match(no65.refusal.reason, /rotation/);
  // the reviewer's extrapolations are now refusals, with no numbers riding along
  for (const bad of [{ envelopeM: 1e7 }, { velTolMps: 1e6 }, { holdS: 1e3 }]) {
    const r = K.evaluate(Object.assign({ tier: 'reference', envelopeM: E, velTolMps: VT, holdS: 10 }, bad));
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.refusal.code, 'out_of_envelope');
    assert.equal(r.kin, undefined);
  }
  // a requirement window past the bound is refused in its own slot while the rest is computed
  const short = K.evaluate({ tier: 'phase3', halfLengthKm: 50, envelopeM: E, velTolMps: VT, holdS: 3, requirementWindowsS: [3, 10] });
  assert.ok(short.ok, 'L = 50 km at 3.5 km/s with a 3 s hold');
  assert.ok(short.requirement[0].passive.ok && short.requirement[0].held.ok, '3 s fits a 90 s rotation');
  assert.equal(short.requirement[1].passive.refusal.code, 'out_of_envelope', '10 s does not');
  assert.equal(short.requirement[1].held.refusal.code, 'out_of_envelope');
  // at the bound the closed forms still hold to 0.3 % (exact two-body integration)
  for (const v of [2.5, 3.5]) {
    for (const LKm of [10, 100, 320, 600]) {
      const kin = K.kinematics({ vTipKms: v, halfLengthKm: LKm });
      const th = kin.validity.closedFormMaxHalfWindowS;
      const ex = K.exact(kin);
      const r = ex.passiveAt(th, Math.min(0.002, th / 200));
      close(r.sepM, 0.5 * kin.aRel * th * th, 3e-3, `separation at the bound, ${v} km/s, L ${LKm} km`);
      close(r.relSpeedMps, kin.aRel * th, 3e-3, `relative speed at the bound, ${v} km/s, L ${LKm} km`);
      close(ex.holdDeltaV(2 * th, 2000).deltaV, kin.aRel * 2 * th, 3e-3, `hold dv at the bound, ${v} km/s, L ${LKm} km`);
    }
  }
});

test('half-length below the kernel’s 1 km minimum is refused; the file’s tip g is offered only at the file’s own L', () => {
  assert.equal(CW.MIN_HALF_LENGTH_KM, 1);
  const tiny = K.evaluate({ tier: 'reference', halfLengthKm: 0.001, envelopeM: E, velTolMps: VT, holdS: 0.01 });
  assert.equal(tiny.refusal.code, 'out_of_envelope');
  assert.match(tiny.refusal.reason, /1 km minimum/);
  assert.match(tiny.refusal.what_would_help, /between 1 km and the CoM altitude/);
  assert.ok(K.kinematics({ vTipKms: 2.5, halfLengthKm: 1 }).ok, '1 km itself is accepted');
  const at100 = K.tierTable({ halfLengthKm: 100, envelopeM: E, velTolMps: VT, holdS: 10 });
  for (const row of at100) {
    assert.equal(row.stated.tipAccelG, null, `${row.key}: the file's tip g is for 320 km, withheld at 100 km`);
    assert.equal(row.statedTipAccelAtCanonLOnly, true);
  }
  const atCanon = K.tierTable({ envelopeM: E, velTolMps: VT, holdS: 10 });
  assert.deepEqual(atCanon.map((r) => r.stated.tipAccelG), [REV.kinematics.tip_acceleration_g, REV.kinematics.cislunar_revenue_gated_option.tip_acceleration_g, REV.kinematics.phase3_growth_option.tip_acceleration_g]);
});

// ------------------------------------------------------------------ the page carries no retyped tether constant
test('index.html and app.js carry no tether constant as literal text; the canon values reach the page only through the kernel', () => {
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
  for (const s of ['6371', '6378', '6981', '6988', '6661', '7556', '5056', '320 km', '610 km', '290 km', '2.5 km/s', '2.8 km/s', '3.5 km/s', '20.3', '203 m/s', '0.99 s', '4.59', '0.465', '0.486', '3.986', '398600', '2462', '20.9', '21.0', '4371', '4570', '2541']) {
    assert.ok(!html.includes(s), `index.html contains "${s}"`);
    assert.ok(!app.includes(s), `app.js contains "${s}"`);
  }
  assert.ok(html.includes('snapshots/canon.data.js') && html.includes('catchwindow.js') && html.includes('app.js'));
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  // the only URL in app.js is the SVG XML namespace, which is an identifier, not a request
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg')/.test(app), 'app.js makes no network reference');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket/.test(app), 'app.js has no request API call');
  assert.ok(!/<script[^>]+src="https?:/.test(html), 'no external scripts');
});
