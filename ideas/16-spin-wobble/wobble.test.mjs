// wobble.test.mjs: node --test ideas/16-spin-wobble/wobble.test.mjs   (Node built-ins only, ~10 s)
//
// What is pinned to something outside this code: golden.json (the twin's own golden run: its mean
// tip speed, mean centripetal acceleration and checkpoint tip speeds), the twin port itself (run
// from the byte-identical snapshot, gated against golden with verify.mjs's tolerances), rev_a.json's
// rotation_period_min, Gauss's constant, a midpoint quadrature and an RK4 integration that share no
// code with the closed form, the n -> 0 and n/omega -> 0 limits, and the program's own sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { derive, render } from './build-data.mjs';
import { runStudy, runTwin, loadTwin, overlayFile } from './study.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const W = require('./wobble.js');
const CANON = require('./snapshots/canon.data.js');
const OVERLAY = require('./snapshots/twin-overlay.js');
const snapPath = (f) => path.join(here, 'snapshots', f);
const REV_A = JSON.parse(fs.readFileSync(snapPath('rev_a.json'), 'utf8'));
const GOLDEN = JSON.parse(fs.readFileSync(snapPath('golden.json'), 'utf8'));
const C = W.readCanon(CANON);
const REF = W.fromCanon(C, { tier: 'reference' });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

let studyPromise = null;
const study = () => (studyPromise ??= runStudy());

// ------------------------------------------------------------------------------------ snapshots
test('every snapshot hashes to its own sidecar; copies equal their source; sidecars name the commit', () => {
  const files = fs.readdirSync(snapPath('')).filter((f) => !f.endsWith('.provenance.json'));
  assert.ok(files.length >= 8, `expected the six copies and two derived files, found ${files.length}`);
  for (const f of files) {
    const side = JSON.parse(fs.readFileSync(snapPath(`${f}.provenance.json`), 'utf8'));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(snapPath(f))).digest('hex');
    assert.equal(sha, side.writtenSha256, `${f} changed since its sidecar was written`);
    assert.match(side.commit, /^[0-9a-f]{40}$/);
    assert.equal(side.repo, 'https://github.com/hudsonclavin-cloud/skyhook');
    assert.equal(side.readMatchesCommitted, true);
    if (side.mode === 'copy') assert.equal(side.writtenSha256, side.sourceSha256, `${f} is not byte-identical to ${side.path}`);
  }
});

test('canon.data.js re-derives byte for byte from the snapshots, and quotes the program verbatim', () => {
  assert.equal(fs.readFileSync(snapPath('canon.data.js'), 'utf8'), render(derive()));
  assert.deepEqual(CANON.revA, REV_A);
  assert.equal(CANON.rEarthKm.value, 6371);
  assert.equal(CANON.rEarthKm.line, 21);
  const lines = (f) => fs.readFileSync(snapPath(f), 'utf8').split('\n');
  const where = { glossary: 'glossary.md', docstring: 'tether_dynamics.py', catch: 'tether_dynamics.py', periapsis: 'VISUAL_QA.md' };
  for (const q of CANON.claims) {
    const src = lines(where[q.id]).slice(q.lineFrom - 1, q.lineTo).map((l) => l.trim()).join(' ');
    assert.ok(src.includes(q.text), `${q.id} quote is not verbatim at ${q.file}:${q.lineFrom}-${q.lineTo}`);
  }
  assert.deepEqual(CANON.claims.map((q) => [q.id, q.lineFrom, q.lineTo]),
    [['glossary', 24, 24], ['docstring', 259, 264], ['catch', 353, 354], ['periapsis', 37, 39]]);
});

test('twin-overlay.js is what study.mjs --write produces now (the recorded run is not stale)', async () => {
  const s = await study();
  const m = { exports: {} };
  new Function('module', overlayFile(s, CANON))(m);
  const a = m.exports, b = OVERLAY;
  assert.equal(a.samples.length, b.samples.length);
  for (let i = 0; i < a.samples.length; i++) for (let j = 0; j < 3; j++) near(a.samples[i][j], b.samples[i][j], 2e-3, `sample ${i}.${j}`);
  assert.deepEqual(a.verticals.map((x) => x.k), b.verticals.map((x) => x.k));
  for (let i = 0; i < a.verticals.length; i++) near(a.verticals[i].t, b.verticals[i].t, 1e-3, 'vertical time');
  assert.equal(a.periapsis.length, b.periapsis.length);
  near(a.maxResidual, b.maxResidual, 1e-3, 'max residual');
  assert.equal(b.gate.pass, true);
});

// ------------------------------------------------------------------------------------ canon and refusals
test('reads the tiers, geometry and both radius conventions from rev_a.json; refuses when any is missing', () => {
  assert.equal(C.ok, true);
  assert.deepEqual(C.tiers.map((t) => [t.id, t.vKms]), [['reference', REV_A.kinematics.v_tip_kms],
    ['cislunar', REV_A.kinematics.cislunar_revenue_gated_option.v_tip_kms], ['phase3', REV_A.kinematics.phase3_growth_option.v_tip_kms]]);
  assert.equal(C.radii.twin.km, 6371 + REV_A.orbital.com_altitude_km);
  assert.equal(C.radii.file.km, REV_A.orbital.com_radius_km);
  for (const bad of [null, {}, { revA: null }, undefined]) {
    const r = W.readCanon(bad);
    assert.equal(r.ok, false);
    assert.equal(r.refusal.code, 'not_found');
  }
  const drop = (p) => { const x = structuredClone(CANON); let o = x.revA; for (const k of p.slice(0, -1)) o = o[k]; delete o[p.at(-1)]; return x; };
  for (const p of [['orbital', 'mu_earth_m3s2'], ['geometry', 'tether_half_length_km'], ['kinematics', 'phase3_growth_option', 'v_tip_kms'], ['orbital', 'com_radius_km']]) {
    const r = W.readCanon(drop(p));
    assert.equal(r.ok, false, p.join('.'));
    assert.ok(r.refusal.reason.includes(p.join('.')), `reason names ${p.join('.')}`);
    assert.ok(r.refusal.what_would_help.length > 10);
    assert.equal(Object.values(r.refusal).some((v) => typeof v === 'number'), false, 'a refusal carries no numbers');
  }
  const noR = structuredClone(CANON); delete noR.rEarthKm;
  assert.equal(W.readCanon(noR).refusal.code, 'not_found');
});

test('refuses inputs where the closed form does not apply, and says what would help', () => {
  const base = { mu: C.mu, R: C.radii.twin.km * 1e3, L: 320e3, v0: 2500, theta0: 0, rEarth: C.rEarthKm * 1e3 };
  const refused = (p) => { const r = W.model(p); assert.equal(r.ok, false, JSON.stringify(p)); assert.ok(r.refusal.reason && r.refusal.what_would_help); return r.refusal; };
  for (const k of ['mu', 'R', 'L', 'v0', 'theta0']) for (const v of [NaN, Infinity, '2500', undefined, null]) refused({ ...base, [k]: v });
  for (const k of ['mu', 'R', 'L', 'v0']) for (const v of [0, -1]) refused({ ...base, [k]: v });
  assert.match(refused({ ...base, L: 610e3 }).reason, /below the ground/);
  assert.equal(W.model({ ...base, L: 609e3 }).ok, true);
  const n = Math.sqrt(base.mu / base.R ** 3);
  assert.match(refused({ ...base, v0: 0.99 * n * base.L }).reason, /no faster than the orbital rate/);
  // circulation needs (v0/L - n)^2 > 3 n^2 cos^2(theta0): for a vertical spin-up, v0 > n L (1 + sqrt 3)
  const vLib = n * base.L * (1 + Math.sqrt(3));
  assert.match(refused({ ...base, v0: vLib * 0.999 }).reason, /librates/);
  assert.equal(W.model({ ...base, v0: vLib * 1.001 }).ok, true);
  assert.equal(W.model({ ...base, v0: vLib * 0.999, theta0: Math.PI / 2 }).ok, true, 'a horizontal spin-up at that speed still goes over the top');
  assert.equal(W.fromCanon(C, { tier: 'nope' }).refusal.code, 'not_found');
  assert.equal(W.fromCanon(C, { radius: 'nope' }).refusal.code, 'not_found');
  assert.equal(W.fromCanon(C, { LKm: NaN }).refusal.code, 'out_of_envelope');
  assert.equal(W.fromCanon(W.readCanon(null), {}).ok, false);
});

// ------------------------------------------------------------------------------------ the closed form
test('AGM reproduces Gauss\'s constant, and the AGM mean equals an independent quadrature of dtheta/theta\'', () => {
  near(1 / W.agm(1, Math.SQRT2), 0.8346268416740731, 1e-15, 'Gauss constant');
  for (const m of [REF, W.fromCanon(C, { tier: 'phase3' }), W.fromCanon(C, { theta0Deg: 90 }), W.fromCanon(C, { LKm: 600, theta0Deg: 33 })]) {
    const N = 40000; let T = 0;
    for (let i = 0; i < N; i++) T += Math.PI / N / m.relRate((i + 0.5) * Math.PI / N);
    near(m.halfPeriod, T, 1e-10 * T, 'half period vs midpoint quadrature');
    near(m.vMean, m.inputs.L * (m.n + Math.PI / T), 1e-9, 'time mean vs quadrature');
  }
});

test('an RK4 integration of theta\'\' = -3n^2 sin cos lands on the closed form: extremes, verticals, mean, energy', () => {
  for (const m of [REF, W.fromCanon(C, { theta0Deg: 90 }), W.fromCanon(C, { tier: 'cislunar', theta0Deg: 45 })]) {
    const dt = 0.05;
    const steps = Math.round((4 * m.halfPeriod + 1) / dt);
    const r = W.integrate(m, { dt, steps, sampleEvery: 1 });
    near(r.minV, m.vHorizontal, 1e-6, 'slowest');
    near(r.maxV, m.vVertical, 1e-6, 'fastest');
    // the k-th vertical comes k half-periods after the (virtual) vertical before the spin-up angle
    const N = 20000;
    let tau = 0; // time from theta = 0 to theta0 along the same solution, by midpoint quadrature
    for (let q = 0; q < N; q++) tau += m.inputs.theta0 / N / m.relRate((q + 0.5) * m.inputs.theta0 / N);
    assert.equal(r.verticalCrossings.length, 4);
    r.verticalCrossings.forEach((t, i) => near(t, (i + 1) * m.halfPeriod - tau, 1e-4, `vertical ${i + 1}`));
    // energy integral
    near(r.rate * r.rate + 3 * m.n * m.n * Math.sin(r.theta) ** 2, m.C, 1e-12 * m.C, 'first integral');
  }
  // the time mean over exactly one modulation period from a vertical
  const dt = REF.halfPeriod / 200000;
  const r = W.integrate(REF, { dt, steps: 200000 });
  near(r.meanV, REF.vMean, 1e-6, 'mean over one period');
});

test('limits: no gravity gradient, no modulation; small n/omega, the first-order form; the docstring form misses 1/(1 - n/omega)', () => {
  const noG = W.model({ mu: 1e-30, R: 7e6, L: 320e3, v0: 2500, theta0: 0 });
  near(noG.dipFromVertical, 0, 1e-12, 'dip with mu -> 0');
  near(noG.vMean, 2500, 1e-9, 'mean with mu -> 0');
  for (const LKm of [1, 0.1]) {
    const m = W.fromCanon(C, { LKm });
    assert.ok(Math.abs(m.dipFromVertical / m.firstOrderDip - 1) < 2 * m.nu, `first order within O(nu) at L = ${LKm} km`);
    assert.ok(Math.abs(-m.meanVsV0 / m.firstOrderMeanDip - 1) < 2 * m.nu);
  }
  near(REF.dipFromVertical / REF.programDip, 1.184, 0.001, 'exact over 1.5 n^2/omega^2 at Rev A');
  near(REF.firstOrderDip / REF.programDip, 1 / (1 - REF.nu), 1e-12, 'first order = program form / (1 - nu)');
});

test('the Rev A numbers the README and page quote', () => {
  near(REF.n, 1.082411e-3, 1e-9, 'n');
  near(REF.nu * REF.nu * 100, 1.920, 5e-4, 'n^2/omega^2 % (MORNING_REPORT.md:38 says ~1.9 %)');
  near(REF.vVertical, 2500, 1e-9, 'vertical = spin-up value for a vertical spin-up');
  near(REF.vHorizontal, 2414.75, 0.005, 'slowest');
  near(REF.dipFromVertical * 100, 3.410, 5e-4, 'dip');
  near(REF.firstOrderDip * 100, 3.342, 5e-4, 'first order');
  near(REF.programDip * 100, 2.879, 5e-4, 'docstring form');
  near(REF.vMean, 2457.16, 0.005, 'rotation mean');
  near(REF.meanVsV0 * 100, -1.714, 5e-4, 'mean depression');
  near(REF.halfPeriod, 476.27, 0.005, 'vertical to vertical');
  near(REF.halfPeriodNoGradient, 466.80, 0.005, 'without the gradient');
  near(2 * REF.halfPeriod / 60, 15.88, 0.005, 'a tip returns to the bottom, min');
  const H = W.fromCanon(C, { theta0Deg: 90 });
  near(H.vVertical, 2582.00, 0.005, 'horizontal spin-up: vertical speed');
  near(H.vHorizontal, 2500, 1e-9, 'horizontal spin-up: horizontal speed = spin-up value');
  near(H.meanVsV0 * 100, 1.632, 5e-4, 'horizontal spin-up: mean elevation');
  near(H.halfPeriod, 458.12, 0.005, 'horizontal spin-up: vertical to vertical');
  const tiers = ['reference', 'cislunar', 'phase3'].map((t) => W.fromCanon(C, { tier: t }));
  assert.deepEqual(tiers.map((m) => +(m.dipFromVertical * 100).toFixed(3)), [3.410, 2.660, 1.645]);
  assert.deepEqual(tiers.map((m) => +(m.meanVsV0 * 100).toFixed(3)), [-1.714, -1.335, -0.825]);
  assert.deepEqual(tiers.map((m) => +m.halfPeriod.toFixed(2)), [476.27, 416.06, 321.72]);
  assert.deepEqual(tiers.map((m) => +(m.programDip * 100).toFixed(2)), [2.88, 2.30, 1.47], 'the proposal\'s per-tier figures are the docstring form');
});

test('canon reconciliation: rev_a.json\'s 13.4 min is the inertial period, not the time between bottoms', () => {
  assert.equal(+(REF.inertialPeriod / 60).toFixed(1), REV_A.geometry.rotation_period_min);
  assert.ok(2 * REF.halfPeriod / 60 - REV_A.geometry.rotation_period_min > 2.4);
});

test('half-length scaling at fixed tip speed is not L^2: 160 -> 320 km multiplies the dip by 4.39', () => {
  const a = W.fromCanon(C, { LKm: 160 }), b = W.fromCanon(C, { LKm: 320 });
  const ratio = b.dipFromVertical / a.dipFromVertical;
  near(ratio, 4.39, 0.005, 'exact ratio');
  assert.ok(Math.abs(ratio - 4) > 0.25, 'an L^2 law within 1 % would give 4.00 +/- 0.04');
  near(ratio, 4 * (1 - a.nu) / (1 - b.nu), 0.08, 'first-order ratio (4.32)');
  const sweep = W.sweepHalfLength({ mu: C.mu, R: C.radii.twin.km * 1e3, v0: 2500, theta0: 0, rEarth: C.rEarthKm * 1e3 }, [50e3, 320e3, 609e3, 611e3]);
  assert.deepEqual(sweep.map((x) => x.ok), [true, true, true, false]);
  assert.equal(sweep[3].code, 'out_of_envelope');
  assert.ok(sweep[0].exact < sweep[1].exact && sweep[1].exact < sweep[2].exact);
});

test('the two radius conventions move the dip by 0.3 %', () => {
  const f = W.fromCanon(C, { radius: 'file' });
  near(f.dipFromVertical * 100, 3.399, 5e-4, 'with com_radius_km 6988');
  assert.ok(rel(f.dipFromVertical, REF.dipFromVertical) < 0.005);
});

test('a rigid line body with exact point-mass gravity and a free orbit follows the closed form, whatever the mass distribution', async () => {
  const T = await loadTwin();
  const sim = new T.TetherSim(new T.TetherConfig(REV_A));
  const dur = 4 * REF.halfPeriod;
  const check = (masses, s, label, tol) => {
    const rb = W.rigidLineBody({ mu: sim.mu, R: sim.Rcom, masses, s, w0: sim.omega, dt: 0.5, steps: Math.round(dur / 0.5), sampleEvery: 1 });
    const m = W.model({ mu: sim.mu, R: sim.Rcom, L: rb.tipArm, v0: rb.tipArm * sim.omega, theta0: 0 });
    let worst = 0;
    for (const [, th, v] of rb.samples) worst = Math.max(worst, Math.abs(v - m.tipSpeed(th)) / m.inputs.v0);
    assert.ok(worst < tol, `${label}: worst ${worst}`);
    return worst;
  };
  check(sim.m, sim.s, 'the twin\'s 17 lumps and hub', 1e-4);
  const s101 = Array.from({ length: 101 }, (_, i) => -sim.L + i * sim.L / 50);
  check(s101.map(() => 1), s101, 'a uniform rod', 1e-4);
  check(sim.m.map((x, i) => (i === 0 ? x + 5000 : x)), sim.s, 'with a 5 t payload on one tip (CoM shifted)', 1e-4);
  // the gravity gradient is what drives it: with mu tiny there is nothing to follow
  const flat = W.rigidLineBody({ mu: 1e-6, R: sim.Rcom, masses: sim.m, s: sim.s, w0: sim.omega, dt: 1, steps: 100, sampleEvery: 10 });
  for (const [, , v] of flat.samples) near(v, 2500, 1e-6, 'no gradient, constant spin');
});

// ------------------------------------------------------------------------------------ against the twin
test('the snapshot twin passes its own verify.mjs gate against golden.json, and far tighter', async () => {
  const s = await study();
  assert.equal(s.gate.pass, true);
  assert.ok(s.gate.maxRelPosErr < 1e-8, `positions ${s.gate.maxRelPosErr}`);
  assert.ok(s.gate.meanRelErr < 1e-8, `mean tip speed ${s.gate.meanRelErr}`);
  assert.ok(rel(s.gate.meanCentripetal, GOLDEN.mean_tip_centripetal_accel_mps2) < 1e-8);
});

test('golden.json reconciliation: the closed form reproduces the twin\'s 600 s mean tip speed to 4.4e-5', async () => {
  const s = await study();
  assert.equal(s.golden.goldenMean, GOLDEN.mean_tip_speed_mps);
  assert.ok(Math.abs(s.golden.rel) < 1e-4, `relative ${s.golden.rel}`);
  near(s.golden.diff, 0.108, 0.001, 'golden minus closed form, m/s');
  assert.ok(rel(s.golden.closedCentripetal, GOLDEN.mean_tip_centripetal_accel_mps2) < 2e-4, 'mean centripetal');
  for (const cp of s.golden.checkpoints) {
    assert.equal(cp.twin, GOLDEN.checkpoints[String(cp.t)].tip_speed_rel_com);
    assert.ok(rel(cp.closed, cp.twin) < 2e-3, `checkpoint ${cp.t} s within 0.2 %`);
  }
  near(GOLDEN.checkpoints['0'].tip_speed_rel_com, REF.vVertical, 1e-9, 'golden starts at the vertical value');
  // the same window is not a rotation mean: 600 s is 1.26 modulation periods
  assert.ok(Math.abs(s.golden.closedMean - REF.vMean) > 5, 'window mean differs from the rotation mean');
});

test('overlay: the twin follows the closed form to 8.6 % of the swing, and rules out the docstring form', async () => {
  const s = await study();
  const o = s.overlay;
  assert.ok(o.residualFraction < 0.1, `residual ${o.residualFraction}`);
  near(o.residualFraction, 0.086, 0.002, 'the README figure');
  near(o.maxBendDeg, 0.283, 0.002, 'chain bend');
  // the twin's first trough against the closed form and against 1.5 n^2/omega^2
  const firstHalf = o.samples.filter(([t]) => t < REF.halfPeriod);
  const trough = Math.min(...firstHalf.map(([, , v]) => v));
  assert.ok(rel(trough, REF.vHorizontal) < 1e-3, `twin trough ${trough} vs closed form ${REF.vHorizontal}`);
  assert.ok(rel(trough, 2500 * (1 - REF.programDip)) > 4e-3, `twin trough ${trough} is far from the docstring form's ${2500 * (1 - REF.programDip)}`);
});

test('overlay: verticals every 476.3 s, the lower tip\'s periapsis every 952.5 s, and the tip at the vertical is the spin-up value', async () => {
  const s = await study();
  const o = s.overlay;
  assert.deepEqual(o.verticals.map((x) => x.k), [1, 2, 3, 4]);
  for (const x of o.verticals) {
    near(x.t, x.k * REF.halfPeriod, 0.6, `vertical ${x.k} against the closed form`);
    assert.ok(Math.abs(x.t - x.k * REF.halfPeriodNoGradient) > 9 * x.k, `vertical ${x.k} is far from the no-gradient time`);
    near(x.v, 2500, 1.5, `tip speed at vertical ${x.k}`);
  }
  assert.equal(o.periapsis.length, 2);
  o.periapsis.forEach((p, i) => {
    near(p.t, 2 * (i + 1) * REF.halfPeriod, 0.6, `periapsis ${i + 1}`);
    assert.ok(Math.abs(p.t - (i + 1) * REF.inertialPeriod) > 140, 'not once per 804 s');
  });
  const q = CANON.claims.find((x) => x.id === 'periapsis').text;
  assert.match(q, /~804s rotation period/);
  assert.match(q, /t~952-1200s/);
  near(o.periapsis[0].t, 952, 1, 'the QA note\'s observed first catch');
  near(s.rigidBody.maxDiff, 0.074, 0.002, 'rigid body against the closed form, m/s');
});

test('what the residual is not: 50x axial stiffness keeps it; 33 nodes shrink it by under 10 %', async () => {
  const T = await loadTwin();
  const base = (await study()).overlay.maxResidual;
  const dur = (await study()).overlay.durationS;
  const stiff = runTwin(T, REV_A, { overrides: { targetStrain: 1e-4 }, dt: 0.02, duration: dur, closed: REF });
  assert.ok(rel(Math.abs(stiff.maxResid), Math.abs(base)) < 0.05, `stiff ${stiff.maxResid} vs ${base}`);
  const fine = runTwin(T, REV_A, { overrides: { nNodes: 33 }, dt: GOLDEN.meta.dt / 2, duration: dur, closed: REF });
  const shrink = 1 - Math.abs(fine.maxResid) / Math.abs(base);
  assert.ok(shrink > 0 && shrink < 0.1, `33 nodes shrink the residual by ${shrink}`);
  assert.ok(fine.maxBend > 0.004, 'the finer chain still bends');
});

// ------------------------------------------------------------------------------------ the page
test('the page carries no tether constant as literal text, loads only local scripts, and asks for nothing', () => {
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
  for (const lit of ['6371', '6981', '6988', '3.986', '398600', '2414.', '2457.', '2462', '2500', '476.2', '952.5', '804.2', '13.4', '320 km', '2.5 km/s', '3.41', '1.71', '0.1385', '7.8125']) {
    assert.ok(!html.includes(lit), `index.html contains ${lit}`);
    assert.ok(!app.includes(lit), `app.js contains ${lit}`);
  }
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ['snapshots/canon.data.js', 'snapshots/twin-overlay.js', 'wobble.js', 'app.js']);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.ok(!/fetch\(|XMLHttpRequest|import\(/.test(app));
});
