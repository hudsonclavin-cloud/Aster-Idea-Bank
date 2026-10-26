// Tests for Tip Match. From the bank root: node --test ideas/01-tip-match/tip-match.test.mjs
// Node built-ins only. Pins: the rev_a.json snapshot's own stated numbers (C3, apogee, release
// speed, v_orb, V_c, the 2.9 km/s escape threshold), skyhook_physics.py's R_EARTH_KM, independent
// arithmetic written here without the kernel, closed forms, limits, and the CLI's saved output.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TipMatch = require(path.join(here, 'tip-match.js'));
const REV_A = require(path.join(here, 'snapshots', 'rev_a.data.js'));
const revA = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', 'rev_a.json'), 'utf8'));
const sidecar = JSON.parse(fs.readFileSync(path.join(here, 'snapshots', 'rev_a.json.provenance.json'), 'utf8'));
const physicsPy = fs.readFileSync(path.join(here, 'snapshots', 'skyhook_physics.py'), 'utf8');

const K = TipMatch.create(REV_A.data, REV_A.provenance);
const C = K.constants;
const AS_OF = '2026-10-26';
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const round = (x, d) => Number(x.toFixed(d));
const log = (...a) => console.log('   ', ...a);

// ------------------------------------------------------------------ snapshots are what they claim
test('the data module is byte-for-byte the rev_a.json snapshot, and the sidecars are intact', () => {
  assert.deepEqual(REV_A.data, revA, 'rev_a.data.js must deep-equal snapshots/rev_a.json');
  assert.deepEqual(REV_A.provenance, sidecar, 'rev_a.data.js must embed the rev_a.json sidecar verbatim');
  assert.match(sidecar.commit, /^[0-9a-f]{40}$/);
  assert.equal(sidecar.path, 'params/rev_a.json');
  assert.equal(sidecar.readMatchesCommitted, true, 'the snapshot was read from a clean checkout');
  // every file under snapshots/ hashes to what its own sidecar recorded (no silent edits)
  const dir = path.join(here, 'snapshots');
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.provenance.json')) continue;
    const side = JSON.parse(fs.readFileSync(path.join(dir, `${f}.provenance.json`), 'utf8'));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
    assert.equal(sha, side.writtenSha256, `${f} differs from what its sidecar recorded`);
    assert.equal(side.repo, 'https://github.com/hudsonclavin-cloud/skyhook');
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'rev_a.json'))).digest('hex');
  assert.equal(sha, sidecar.sourceSha256, 'rev_a.json copy equals the source bytes');
});

// ------------------------------------------------------------------ constants
test('constants: r_tip is read from the canon note, R_E follows, and matches skyhook_physics.py:40', () => {
  assert.equal(K.ok, true);
  assert.equal(C.r_tip_km, 7301, 'kinematics._c3_note states r_tip=7301 km');
  assert.equal(C.earth_radius_km, 7301 - revA.orbital.com_altitude_km - revA.geometry.tether_half_length_km);
  const m = /^R_EARTH_KM\s*=\s*([\d.]+)/m.exec(physicsPy);
  assert.ok(m, 'skyhook_physics.py snapshot defines R_EARTH_KM');
  assert.equal(C.earth_radius_km, Number(m[1]), 'Earth radius equals the physics module literal');
  assert.equal(C.r_com_km, 6981);
  assert.equal(C.r_low_km, 6661);
  assert.equal(C.mu_km3s2, revA.orbital.mu_earth_m3s2 / 1e9);
  assert.equal(C.tiers.reference.v_tip_kms, revA.kinematics.v_tip_kms);
  assert.equal(C.tiers.cislunar.v_tip_kms, revA.kinematics.cislunar_revenue_gated_option.v_tip_kms);
  assert.equal(C.tiers.phase3.v_tip_kms, revA.kinematics.phase3_growth_option.v_tip_kms);
  assert.equal(C.guardrail_tip_over_vc, 1.3, 'mass_ratio._ratio_note names the 1.3x guardrail');
  near(C.v_c_kms, revA.materials.V_c_kms, 0.005, 'V_c = sqrt(2σ/ρ) reproduces materials.V_c_kms to its rounding');
});

test('finding F1 still holds in the snapshot: orbital.com_radius_km (6988) implies a 6378 km Earth and does not reproduce the file\'s C3; v_orb_kms 7.55 follows 6988, not 6981', () => {
  assert.equal(C.com_radius_km_as_stated, 6988);
  assert.notEqual(C.com_radius_km_as_stated, C.r_com_km, 'the stated CoM radius disagrees with r_tip − half-length');
  const vOrb6988 = Math.sqrt(C.mu_km3s2 / 6988);
  const c3With6988 = (vOrb6988 + C.tiers.reference.v_tip_kms) ** 2 - (2 * C.mu_km3s2) / C.r_tip_km;
  assert.ok(Math.abs(c3With6988 - revA.kinematics.c3_kms2) > 0.05, `C3 with r_com = 6988 is ${c3With6988.toFixed(3)}, not the file's ${revA.kinematics.c3_kms2}`);
  assert.equal(round(vOrb6988, 2), revA.orbital.v_orb_kms, 'the file\'s v_orb_kms 7.55 is what 6988 km gives');
  assert.equal(round(C.v_orb_kms, 2), 7.56, 'with the 6371 km Earth the kernel and physics module use, v_orb rounds to 7.56');
  log(`F1: v_orb(6988) = ${vOrb6988.toFixed(4)}, v_orb(6981) = ${C.v_orb_kms.toFixed(4)}; C3 with 6988 = ${c3With6988.toFixed(3)}`);
});

test('constants: a canon without the r_tip note, or missing a key, makes the kernel refuse rather than remember', () => {
  const noNote = JSON.parse(JSON.stringify(revA));
  noNote.kinematics._c3_note = 'nothing here';
  const k1 = TipMatch.create(noNote, sidecar);
  assert.equal(k1.ok, false);
  assert.equal(k1.refusal.code, 'not_found');
  const e1 = k1.energy({ vinf_kms: 1, tier: 'reference', as_of: AS_OF });
  assert.equal(e1.value, null);
  assert.equal(e1.refusal.code, 'not_found');
  const noMu = JSON.parse(JSON.stringify(revA));
  delete noMu.orbital.mu_earth_m3s2;
  const k2 = TipMatch.create(noMu, sidecar);
  assert.equal(k2.ok, false);
  assert.match(k2.refusal.reason, /orbital\.mu_earth_m3s2/);
});

// ------------------------------------------------------------------ reconciliation with the canon's stated numbers
test('reconciliation: release C3, apogee and release speed for all three tiers match rev_a.json to its own rounding', () => {
  const cases = [
    ['reference', revA.kinematics.c3_kms2, revA.kinematics.apogee_altitude_km, revA.kinematics.v_upper_release_kms],
    ['cislunar', revA.kinematics.cislunar_revenue_gated_option.c3_kms2, revA.kinematics.cislunar_revenue_gated_option.apogee_altitude_km, revA.kinematics.cislunar_revenue_gated_option.v_upper_release_kms],
    ['phase3', revA.kinematics.phase3_growth_option.c3_kms2, null, revA.kinematics.phase3_growth_option.v_upper_release_kms],
  ];
  for (const [key, c3, apogee, release] of cases) {
    const e = K.tierEnergy(key);
    assert.equal(round(e.c3_kms2, 2), c3, `${key} C3 to 2 dp`);
    near(e.v_tip_inertial_kms, release, 0.0065, `${key} upper release speed within half a hundredth plus the file's v_orb rounding`);
    if (key !== 'phase3') assert.equal(round(e.v_tip_inertial_kms, 2), release, `${key} upper release speed to 2 dp`);
    if (apogee === null) {
      assert.equal(e.bound, false);
      assert.equal(e.apogee_altitude_km, null, 'hyperbolic release has no apogee (null, never Infinity)');
    } else {
      assert.equal(e.bound, true);
      assert.equal(Math.round(e.apogee_altitude_km), apogee, `${key} apogee to the km`);
    }
    log(`${key}: C3 ${e.c3_kms2.toFixed(4)} (file ${c3}), apogee ${e.apogee_altitude_km === null ? 'none' : e.apogee_altitude_km.toFixed(1)} (file ${apogee}), release ${e.v_tip_inertial_kms.toFixed(4)} (file ${release})`);
  }
});

test('finding F2 still holds in the snapshot: the Phase 3 v_upper_release_kms 11.05 is the rounded 7.55 + 3.5, while the other two tiers use the unrounded v_orb', () => {
  const stated = revA.kinematics.phase3_growth_option.v_upper_release_kms;
  const computed = K.tierEnergy('phase3').v_tip_inertial_kms;
  assert.equal(stated, 11.05);
  assert.equal(round(computed, 2), 11.06, 'v_orb(6981) + 3.5 rounds to 11.06');
  assert.equal(round(revA.orbital.v_orb_kms + revA.kinematics.phase3_growth_option.v_tip_kms, 2), stated, 'the file\'s figure is its rounded v_orb plus the tip speed');
  assert.equal(round(K.tierEnergy('reference').v_tip_inertial_kms, 2), revA.kinematics.v_upper_release_kms, 'reference 10.06 uses the unrounded v_orb');
  assert.equal(round(K.tierEnergy('cislunar').v_tip_inertial_kms, 2), revA.kinematics.cislunar_revenue_gated_option.v_upper_release_kms, 'cislunar 10.36 uses the unrounded v_orb');
  assert.notEqual(round(revA.orbital.v_orb_kms + revA.kinematics.v_tip_kms, 2), revA.kinematics.v_upper_release_kms, '(7.55 + 2.5 would give 10.05, not the file\'s 10.06)');
  log(`F2: phase3 release computed ${computed.toFixed(4)}, file ${stated}`);
});

test('reconciliation: the tip speed for C3 = 0 is the 2.9 km/s rev_a.json market_thresholds and the Phase 3 note state', () => {
  const v = K.zeroTrimTipSpeed(0);
  assert.equal(round(v, 1), revA.market_thresholds.escape_C3_0_tip_speed_kms);
  assert.match(revA.kinematics.phase3_growth_option.note, /Escape \(C3=0\) is reached at ~2\.9 km\/s/);
  // and the same number from the kernel's energy path: C3 of a tether with that tip speed is zero
  const vTipInertial = C.v_orb_kms + v;
  near(vTipInertial ** 2 - (2 * C.mu_km3s2) / C.r_tip_km, 0, 1e-9, 'C3 at the escape tip speed');
  log(`escape tip speed ${v.toFixed(4)} km/s`);
});

test('reconciliation: rotation period and tip acceleration from the same constants match the file (sanity that the tier speeds are read right)', () => {
  const t = C.tiers.reference.v_tip_kms;
  near((2 * Math.PI * C.half_length_km) / t / 60, revA.geometry.rotation_period_min, 0.05, 'rotation period, min');
  near((t * 1e3) ** 2 / (C.half_length_km * 1e3) / 9.80665, revA.kinematics.tip_acceleration_g, 0.005, 'tip acceleration, g');
});

// ------------------------------------------------------------------ the inbound numbers
test('hand-worked: v∞ = 3 km/s against the reference tip, arithmetic written here without the kernel', () => {
  const mu = revA.orbital.mu_earth_m3s2 / 1e9; // 398600 km³/s²
  const rTip = 6371 + 610 + 320; // from the canon's own note, as skyhook_physics.py does
  const rCom = 6371 + 610;
  const vOrb = Math.sqrt(mu / rCom); // 7.5563…
  const vTip = vOrb + 2.5; // 10.0563…
  const vPay = Math.sqrt(9 + (2 * mu) / rTip); // sqrt(9 + 109.1905…) = 10.8715…
  const trim = vPay - vTip; // 0.8152…
  const env = K.energy({ vinf_kms: 3, tier: 'reference', as_of: AS_OF });
  near(env.value.geometry.v_orb_kms.value, vOrb, 1e-12, 'v_orb');
  near(env.value.upper_tip.v_payload_kms.value, vPay, 1e-12, 'payload speed');
  near(env.value.upper_tip.trim_dv_kms.value, trim, 1e-12, 'trim');
  near(env.value.upper_tip.trim_dv_ms.value, trim * 1000, 1e-9, 'trim in m/s');
  assert.equal(round(vPay, 4), 10.8715);
  assert.equal(round(trim, 4), 0.8152);
  log(`v∞ = 3: payload ${vPay.toFixed(4)}, tip ${vTip.toFixed(4)}, trim ${trim.toFixed(4)} km/s`);
});

test('the three numbers in the pitch: reference trim at v∞ = 0 is 0.393 km/s, cislunar 0.093, Phase 3 v∞* is 3.613', () => {
  const ref = K.energy({ vinf_kms: 0, tier: 'reference', as_of: AS_OF }).value;
  const cis = K.energy({ vinf_kms: 0, tier: 'cislunar', as_of: AS_OF }).value;
  const p3 = K.tierEnergy('phase3');
  near(ref.upper_tip.trim_dv_kms.value, 0.393, 0.002, 'reference trim at parabolic arrival');
  near(cis.upper_tip.trim_dv_kms.value, 0.093, 0.002, 'cislunar trim at parabolic arrival');
  near(p3.vinf_star_kms, 3.613, 0.005, 'Phase 3 zero-trim v∞*');
  assert.equal(K.tierEnergy('reference').vinf_star_kms, null, 'reference C3 < 0: no zero-trim v∞');
  assert.equal(K.tierEnergy('cislunar').vinf_star_kms, null, 'cislunar C3 < 0: no zero-trim v∞');
  // parabolic speed at r_tip exceeds both bound tiers' tip speeds: no hyperbolic arrival can be met
  const vPar = Math.sqrt((2 * C.mu_km3s2) / C.r_tip_km);
  assert.ok(vPar > K.tierEnergy('reference').v_tip_inertial_kms && vPar > K.tierEnergy('cislunar').v_tip_inertial_kms);
  log(`ref trim ${ref.upper_tip.trim_dv_kms.value.toFixed(4)}, cis trim ${cis.upper_tip.trim_dv_kms.value.toFixed(4)}, v∞* ${p3.vinf_star_kms.toFixed(4)}`);
});

test('closed form: at v∞* the Phase 3 trim is zero to round-off, and the match flag turns on only inside the tolerance', () => {
  const star = K.tierEnergy('phase3').vinf_star_kms;
  const at = K.energy({ vinf_kms: star, tier: 'phase3', as_of: AS_OF }).value;
  near(at.upper_tip.trim_dv_ms.value, 0, 1e-6, 'trim at v∞*');
  assert.equal(at.match.energy_matched, true);
  // slope d(trim)/d(v∞) = v∞ / v_payload ≈ 0.327 at v∞*; 1 m/s of trim is about 3 m/s of v∞
  const slope = star / at.upper_tip.v_payload_kms.value;
  const just = K.energy({ vinf_kms: star + (0.9 / 1000) / slope, tier: 'phase3', tolerance_ms: 1, as_of: AS_OF }).value;
  const over = K.energy({ vinf_kms: star + (1.1 / 1000) / slope, tier: 'phase3', tolerance_ms: 1, as_of: AS_OF }).value;
  assert.equal(just.match.energy_matched, true, 'inside 1 m/s');
  assert.equal(over.match.energy_matched, false, 'outside 1 m/s');
  assert.equal(K.energy({ vinf_kms: star + 0.5, tier: 'phase3', tolerance_ms: 1e6, as_of: AS_OF }).value.match.energy_matched, true, 'a huge tolerance matches anything');
  assert.equal(K.energy({ vinf_kms: 3.61, tier: 'phase3', tolerance_ms: 1, as_of: AS_OF }).value.match.energy_matched, true, '3.61 km/s is within 1 m/s of v∞*');
  assert.equal(K.energy({ vinf_kms: 3.61, tier: 'phase3', tolerance_ms: 0.5, as_of: AS_OF }).value.match.energy_matched, false, 'but not within 0.5 m/s');
  assert.equal(K.energy({ vinf_kms: 0, tier: 'reference', tolerance_ms: 1, as_of: AS_OF }).value.match.energy_matched, false);
  log(`slope at v∞*: ${slope.toFixed(4)} (1 m/s trim ↔ ${(1 / slope).toFixed(2)} m/s of v∞)`);
});

test('monotone: trim grows strictly with v∞ for every tier, following sqrt(v∞² + v_par²) − v_par exactly', () => {
  const vPar = Math.sqrt((2 * C.mu_km3s2) / C.r_tip_km);
  for (const tier of C.tierOrder) {
    let prev = -Infinity;
    const trim0 = K.energy({ vinf_kms: 0, tier, as_of: AS_OF }).value.upper_tip.trim_dv_kms.value;
    for (let v = 0; v <= 8.0001; v += 0.05) {
      const e = K.energy({ vinf_kms: v, tier, as_of: AS_OF }).value;
      const trim = e.upper_tip.trim_dv_kms.value;
      assert.ok(v === 0 || trim > prev, `${tier}: trim not increasing at v∞ = ${v}`);
      near(trim - trim0, Math.sqrt(v * v + vPar * vPar) - vPar, 1e-12, `${tier} closed form at ${v}`);
      prev = trim;
    }
  }
});

test('lower tip: every arrival from beyond Earth passes the lower-tip radius faster than any tier\'s lower tip moves', () => {
  const vParLow = Math.sqrt((2 * C.mu_km3s2) / C.r_low_km);
  near(vParLow, 10.94, 0.005, 'parabolic speed at 290 km');
  for (const tier of C.tierOrder) {
    for (const v of [0, 0.5, 2, 5, 8]) {
      const L = K.energy({ vinf_kms: v, tier, as_of: AS_OF }).value.lower_tip;
      assert.equal(L.verdict, 'not reachable');
      assert.ok(L.gap_kms.value > 5, `${tier} at ${v}: gap ${L.gap_kms.value}`);
      assert.ok(L.v_payload_kms.value >= vParLow - 1e-12);
    }
  }
  near(K.energy({ vinf_kms: 0, tier: 'reference', as_of: AS_OF }).value.lower_tip.v_tip_inertial_kms.value, 5.056, 0.001, 'reference lower tip, v_orb − 2.5');
});

test('zero-trim tip speed: the inverse of the energy condition, with the V_c ratio and the 1.3× guardrail from the canon', () => {
  for (const v of [0, 1, 3, 3.6127, 5, 8]) {
    const z = K.energy({ vinf_kms: v, tier: 'reference', as_of: AS_OF }).value.zero_trim;
    // a tether with exactly that tip speed meets v∞ with zero trim
    const vTipInertial = C.v_orb_kms + z.tip_speed_needed_kms.value;
    near(vTipInertial, Math.sqrt(v * v + (2 * C.mu_km3s2) / C.r_tip_km), 1e-12, `inverse at ${v}`);
    near(z.over_vc.value, z.tip_speed_needed_kms.value / C.v_c_kms, 1e-12, 'ratio to V_c');
    assert.equal(z.beyond_guardrail, z.over_vc.value > 1.3);
  }
  const atStar = K.energy({ vinf_kms: K.tierEnergy('phase3').vinf_star_kms, tier: 'phase3', as_of: AS_OF }).value.zero_trim;
  near(atStar.tip_speed_needed_kms.value, 3.5, 1e-9, 'at v∞* the needed tip speed is the Phase 3 tip speed');
  assert.equal(K.energy({ vinf_kms: 5, tier: 'reference', as_of: AS_OF }).value.zero_trim.beyond_guardrail, true, 'v∞ = 5 needs > 1.3 V_c');
  assert.equal(K.energy({ vinf_kms: 0, tier: 'reference', as_of: AS_OF }).value.zero_trim.beyond_guardrail, false);
});

test('Earth-radius sensitivity: moving R_E to 6378.137 km consistently shifts the reference C3 by ~0.03 km²/s², not the ~0.1 the proposal said', () => {
  const alt = JSON.parse(JSON.stringify(revA));
  alt.kinematics._c3_note = alt.kinematics._c3_note.replace('r_tip=7301 km', 'r_tip=7308.137 km');
  const K2 = TipMatch.create(alt, sidecar);
  assert.equal(K2.constants.earth_radius_km, 6378.137);
  const dC3 = K2.tierEnergy('reference').c3_kms2 - K.tierEnergy('reference').c3_kms2;
  const dTrim = K2.energy({ vinf_kms: 0, tier: 'reference', as_of: AS_OF }).value.upper_tip.trim_dv_ms.value - K.energy({ vinf_kms: 0, tier: 'reference', as_of: AS_OF }).value.upper_tip.trim_dv_ms.value;
  assert.ok(dC3 > 0.02 && dC3 < 0.04, `ΔC3 = ${dC3}`);
  assert.ok(Math.abs(dTrim) < 2, `Δtrim = ${dTrim} m/s`);
  // moving only r_tip while keeping v_orb at 6981 is the inconsistent version that gives ~0.1
  const inconsistent = (C.v_orb_kms + 2.5) ** 2 - (2 * C.mu_km3s2) / 7308.137 - K.tierEnergy('reference').c3_kms2;
  assert.ok(inconsistent > 0.09 && inconsistent < 0.12, `inconsistent shift ${inconsistent}`);
  log(`ΔC3 consistent ${dC3.toFixed(4)}, inconsistent ${inconsistent.toFixed(4)}; Δtrim ${dTrim.toFixed(2)} m/s`);
});

// ------------------------------------------------------------------ refusals
test('refusals: a missing, non-finite, non-numeric or negative v∞, a bad tolerance or an unknown tier yield refusal envelopes, never numbers', () => {
  const bad = [
    [undefined, 'insufficient_data'],
    [null, 'insufficient_data'],
    ['', 'insufficient_data'],
    [NaN, 'insufficient_data'],
    [Infinity, 'insufficient_data'],
    ['3', 'insufficient_data'],
    [-0.001, 'out_of_envelope'],
    [-5, 'out_of_envelope'],
  ];
  for (const [v, code] of bad) {
    const e = K.energy({ vinf_kms: v, tier: 'reference', as_of: AS_OF });
    assert.equal(e.value, null, `v∞ = ${String(v)} must not produce a value`);
    assert.equal(e.refusal.code, code, `v∞ = ${String(v)} code`);
    assert.ok(e.refusal.reason.length > 10 && e.refusal.what_would_help.length > 10);
    assert.deepEqual(TipMatch.validateEnvelope(e), [], `refusal envelope for ${String(v)} is valid`);
  }
  const t = K.energy({ vinf_kms: 1, tier: 'mars', as_of: AS_OF });
  assert.equal(t.refusal.code, 'not_found');
  for (const tol of [NaN, -1, Infinity, '1']) {
    const e = K.energy({ vinf_kms: 1, tier: 'reference', tolerance_ms: tol, as_of: AS_OF });
    assert.equal(e.value, null);
    assert.equal(e.refusal.code, 'out_of_envelope');
  }
  assert.equal(K.energy({ vinf_kms: 0, tier: 'reference', as_of: AS_OF }).value !== null, true, 'v∞ = 0 (parabolic) is valid');
});

test('plane and phase are structured refusals with what_would_help; the Aster-cache source is refused as not_found', () => {
  const plane = K.plane({ as_of: AS_OF });
  const phase = K.phase({ as_of: AS_OF });
  for (const e of [plane, phase]) {
    assert.equal(e.value, null);
    assert.equal(e.refusal.code, 'insufficient_data');
    assert.ok(e.refusal.what_would_help.length > 40);
    assert.deepEqual(TipMatch.validateEnvelope(e), []);
  }
  assert.match(plane.refusal.reason, /lambert-screen-cache\.ts/);
  assert.match(phase.refusal.reason, /13\.4 min/, 'phase refusal quotes the canon rotation period');
  const src = K.vinfSource('aster-cache', { as_of: AS_OF });
  assert.equal(src.refusal.code, 'not_found');
  assert.match(src.refusal.reason, /vInfArr is arrival at the asteroid/);
  assert.equal(K.vinfSource('typed'), null);
  assert.equal(K.vinfSource('wat', { as_of: AS_OF }).refusal.code, 'not_found');
  // the energy value carries the same two refusals as conditions
  const v = K.energy({ vinf_kms: 1, tier: 'reference', as_of: AS_OF }).value;
  assert.deepEqual(v.conditions.map((c) => `${c.condition}:${c.status}`), ['energy:computed', 'plane:refused', 'phase:refused']);
  assert.equal(v.conditions[1].refusal.code, 'insufficient_data');
  assert.equal(v.conditions[2].refusal.code, 'insufficient_data');
});

// ------------------------------------------------------------------ envelope shape (Aster mcp/src/envelope)
test('envelope shape: version, tool, weakest-link confidence, provenance with the sidecar commit, every quantity cites a source, nothing non-finite', () => {
  for (const tier of C.tierOrder) {
    for (const v of [0, 0.3, 1, 3.6127, 7.99]) {
      const e = K.energy({ vinf_kms: v, tier, tolerance_ms: 1, as_of: AS_OF });
      assert.equal(e.envelope_version, '1');
      assert.equal(e.tool, 'tip-match.energy');
      assert.equal(e.as_of, AS_OF);
      assert.ok(TipMatch.CONFIDENCES.includes(e.confidence));
      assert.equal(e.confidence, 'assumed', 'design parameters and a typed v∞ make the weakest link "assumed"');
      assert.equal(e.confidence, TipMatch.confidenceMin(e.provenance));
      const repo = e.provenance.filter((p) => p.kind === 'repo');
      assert.ok(repo.length >= 2 && repo.every((p) => p.commit === sidecar.commit && p.path === 'params/rev_a.json'));
      assert.ok(e.provenance.some((p) => p.kind === 'computation' && p.confidence === 'derived'));
      assert.ok(e.provenance.some((p) => p.kind === 'external' && p.id === 'vinf-input'));
      assert.ok(Array.isArray(e.assumptions) && e.assumptions.length >= 4);
      assert.ok(e.validity_envelope.length > 100);
      assert.equal(e.refusal, undefined);
      assert.deepEqual(TipMatch.validateEnvelope(e), []);
      const s = JSON.stringify(e);
      assert.equal(/NaN|Infinity/.test(s), false, 'serialises without NaN/Infinity');
    }
  }
});

test('the validator has teeth: it rejects an envelope with an unknown source id, a non-finite leaf, a wrong confidence or a bad refusal code', () => {
  const good = K.energy({ vinf_kms: 1, tier: 'reference', as_of: AS_OF });
  const clone = () => JSON.parse(JSON.stringify(good));
  let e = clone();
  e.value.upper_tip.trim_dv_kms.sourceIds = ['nope'];
  assert.ok(TipMatch.validateEnvelope(e).some((p) => /unknown source "nope"/.test(p)));
  e = clone();
  e.value.upper_tip.v_payload_kms.value = Infinity;
  assert.ok(TipMatch.validateEnvelope(e).some((p) => /non-finite/.test(p)));
  e = clone();
  e.confidence = 'measured';
  assert.ok(TipMatch.validateEnvelope(e).some((p) => /weakest/.test(p)));
  e = clone();
  delete e.value.input.vinf_kms.confidence;
  assert.ok(TipMatch.validateEnvelope(e).some((p) => /lacks confidence/.test(p)));
  e = clone();
  e.value = null;
  assert.ok(TipMatch.validateEnvelope(e).some((p) => /without a refusal/.test(p)));
  e = clone();
  e.refusal = { code: 'insufficient_data', reason: 'x', what_would_help: 'y' };
  assert.ok(TipMatch.validateEnvelope(e).some((p) => /must not carry a refusal/.test(p)));
  const r = K.plane({ as_of: AS_OF });
  r.refusal.code = 'maybe_later';
  assert.ok(TipMatch.validateEnvelope(r).some((p) => /refusal\.code/.test(p)));
});

// ------------------------------------------------------------------ the page does not retype constants
test('index.html carries no tether constant as static text; the page fills them from the snapshot', () => {
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  for (const needle of ['7301', '6371', '6981', '6988', '6661', '610 km', '320 km', '290 km', '2.5 km/s', '2.8 km/s', '3.5 km/s', '0.393', '3.613']) {
    assert.equal(html.includes(needle), false, `index.html must not state "${needle}" statically`);
  }
  assert.match(html, /snapshots\/rev_a\.data\.js/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  const app = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
  for (const needle of ['7301', '6371', '6981', '2.5', '2.8', '3.5', '398600']) {
    assert.equal(new RegExp(`(^|[^\\w.])${needle.replace('.', '\\.')}([^\\w.]|$)`).test(app.replace(/\/\/.*$/gm, '')), false, `app.js must not carry the constant ${needle} in code`);
  }
});

// ------------------------------------------------------------------ CLI
const CLI = path.join(here, 'tip-match.mjs');
const runCli = (...args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8' });

test('CLI: JSON envelopes for a valid question (exit 0), refusal for a bad v∞ (exit 1), usage error (exit 2), --help (exit 0)', () => {
  const ok = runCli('--vinf', '3.61', '--tier', 'phase3', '--as-of', AS_OF);
  assert.equal(ok.status, 0, ok.stderr);
  const out = JSON.parse(ok.stdout);
  assert.deepEqual(Object.keys(out), ['energy', 'plane', 'phase']);
  assert.equal(out.energy.value.match.energy_matched, true);
  near(out.energy.value.upper_tip.trim_dv_ms.value, -0.9, 0.1, 'CLI trim at 3.61 km/s is about −0.9 m/s');
  assert.equal(out.plane.refusal.code, 'insufficient_data');
  assert.deepEqual(out.energy, K.energy({ vinf_kms: 3.61, tier: 'phase3', tolerance_ms: 1, as_of: AS_OF }), 'CLI and kernel agree exactly');
  const neg = runCli('--vinf', '-1', '--as-of', AS_OF);
  assert.equal(neg.status, 1);
  assert.equal(JSON.parse(neg.stdout).energy.refusal.code, 'out_of_envelope');
  const nan = runCli('--vinf', 'abc', '--as-of', AS_OF);
  assert.equal(nan.status, 1);
  assert.equal(JSON.parse(nan.stdout).energy.refusal.code, 'insufficient_data');
  const cache = runCli('--source', 'aster-cache', '--as-of', AS_OF);
  assert.equal(cache.status, 1);
  assert.equal(JSON.parse(cache.stdout).vinf_source.refusal.code, 'not_found');
  const none = runCli();
  assert.equal(none.status, 2);
  assert.match(none.stderr, /--vinf is required/);
  const unknown = runCli('--vinf', '1', '--bogus');
  assert.equal(unknown.status, 2);
  const help = runCli('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
});

test('example.txt is the CLI\'s real output: regenerated here and compared byte for byte', () => {
  const cmds = [
    ['--vinf', '3.61', '--tier', 'phase3', '--as-of', AS_OF, '--text'],
    ['--vinf', '0', '--tier', 'reference', '--as-of', AS_OF, '--text'],
    ['--vinf', '0', '--tier', 'cislunar', '--as-of', AS_OF, '--text'],
    ['--vinf', '-1', '--tier', 'reference', '--as-of', AS_OF, '--text'],
    ['--source', 'aster-cache', '--as-of', AS_OF, '--text'],
    ['--vinf', '3.61', '--tier', 'phase3', '--as-of', AS_OF],
  ];
  let expected = '';
  for (const args of cmds) {
    const r = runCli(...args);
    expected += `$ node ideas/01-tip-match/tip-match.mjs ${args.join(' ')}\n${r.stdout}${r.stderr}(exit ${r.status})\n\n`;
  }
  const actual = fs.readFileSync(path.join(here, 'example.txt'), 'utf8');
  assert.equal(actual, expected, 'example.txt has drifted from what the CLI prints; regenerate it');
});
