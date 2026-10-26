// Tests for Twenty Percent Line. Node built-ins only, plus python3 for the two oracle tests
// (CPython's math.erf, and Skyhook's own physics/skyhook_physics.py), which skip without it.
// From the bank root: node --test ideas/20-twenty-percent-line/twenty.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(here, 'model.js'));
const D = require(path.join(here, 'page-data.js'));
const snap = (p) => path.join(here, 'snapshots', p);
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const R = M.readInputs(D);
const I = R.inputs;
const REV = readJSON(snap('rev_a.json'));
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const base = { tierKey: 'reference', pKm: 0, where: 'tip', fs: I.fs, cap: I.cap, mode: 'none', beta: 0, hmpe: 'sk99' };
const run = (over) => M.compute(I, { ...base, ...over });
const clone = (x) => JSON.parse(JSON.stringify(x));
const hasPy = spawnSync('python3', ['--version']).status === 0;

// ---------------------------------------------------------------------------------------------
// An independent integrator: RK4 on the tension ODE with the sizing rules written directly
// (area = the larger of what each active constraint needs), mass by integrating rho*A. No erf, no
// closed form, no use of model.js's arm(). Sections are given hub to tip in km.
function odeArm(sectionsKm, { vkms, fs, cap, mode, beta, P, H }, L, stepsPerUnit = 20000) {
  const k = (fib) => ((vkms * 1000) / Math.sqrt((2 * fib.sigmaGPa * 1e9) / fib.rho)) ** 2;
  const kP = k(P);
  const kH = k(H);
  const a = (mat, t) => {
    if (mat === 'P' || mode === 'none') return (2 * (mat === 'P' ? kP : kH) * t) / fs;
    if (mode === 'every') return (2 * kH * t) / Math.min(fs, cap);
    return Math.max((2 * kH * t) / fs, (2 * kH * (t - (1 - beta))) / cap);
  };
  let t = 1;
  let mass = 0;
  for (let i = sectionsKm.length - 1; i >= 0; i--) {
    const [mat, s0, s1] = sectionsKm[i];
    const u0 = s0 / L;
    const u1 = s1 / L;
    const n = Math.max(20, Math.ceil((u1 - u0) * stepsPerUnit));
    const h = (u1 - u0) / n;
    let u = u1;
    // y = [t, mass]; dy/du = [-a t-dependent * u, a]; integrate u downward
    const f = (uu, tt) => [a(mat, tt) * uu, a(mat, tt)];
    for (let j = 0; j < n; j++) {
      const k1 = f(u, t);
      const k2 = f(u - h / 2, t + (h / 2) * k1[0]);
      const k3 = f(u - h / 2, t + (h / 2) * k2[0]);
      const k4 = f(u - h, t + h * k3[0]);
      t += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      mass += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      u -= h;
    }
  }
  return { mass, tHub: t };
}
// The layouts written out by hand (not via model.layout), for the integrator.
function handLayout(L, z, p, where) {
  if (where === 'tip') {
    return {
      lower: [['H', 0, Math.max(0, L - z - p)], ['P', Math.max(0, L - z - p), L]].filter((s) => s[2] - s[1] > 1e-9),
      upper: [['H', 0, L - p], ['P', L - p, L]].filter((s) => s[2] - s[1] > 1e-9),
    };
  }
  const pl = Math.min(p, L - z);
  return {
    lower: [['P', 0, pl], ['H', pl, L - z], ['P', L - z, L]].filter((s) => s[2] - s[1] > 1e-9),
    upper: [['P', 0, p], ['H', p, L]].filter((s) => s[2] - s[1] > 1e-9),
  };
}

// ---------------------------------------------------------------------------------------------
test('snapshots: page-data.js is the snapshots, and each snapshot matches its sidecar at 34935cb', () => {
  assert.deepEqual(D.revA, REV);
  assert.deepEqual(D.revAProvenance, readJSON(snap('rev_a.json.provenance.json')));
  const files = ['rev_a.json', 'skyhook_physics.py', ...fs.readdirSync(snap('lines')).filter((f) => f.endsWith('.json') && !f.endsWith('.provenance.json')).map((f) => `lines/${f}`)];
  assert.equal(files.length, 7);
  for (const f of files) {
    const side = readJSON(snap(`${f}.provenance.json`));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(snap(f))).digest('hex');
    assert.equal(sha, side.writtenSha256, `${f} sha256`);
    assert.match(side.commit, /^34935cb/, `${f} commit`);
    assert.equal(side.repo, 'https://github.com/hudsonclavin-cloud/skyhook');
    if (f.startsWith('lines/')) {
      const j = readJSON(snap(f));
      assert.equal(j.source, side.path);
      assert.deepEqual(D.lines[j.source], j.lines, `${f} in page-data.js`);
    }
  }
});

test('snapshots: every quoted line is verbatim at its line number in the Skyhook commit (skips without the checkout)', (t) => {
  const repo = '/home/user/skyhook';
  if (!fs.existsSync(path.join(repo, '.git'))) { t.skip('no Skyhook checkout'); return; }
  let n = 0;
  for (const [file, lines] of Object.entries(D.lines)) {
    const text = execFileSync('git', ['show', `${D.linesCommit}:${file}`], { cwd: repo, encoding: 'utf8' }).split('\n');
    for (const [k, v] of Object.entries(lines)) { assert.equal(v, text[Number(k) - 1], `${file}:${k}`); n++; }
  }
  assert.equal(n, 27);
});

test('inputs: every number is read from the snapshots, and the prose numbers parse exactly', () => {
  assert.equal(R.ok, true);
  assert.deepEqual(R.refusals, []);
  assert.equal(I.pbo.sigmaGPa, REV.materials.tensile_strength_GPa);
  assert.equal(I.pbo.rho, REV.materials.density_kgm3);
  assert.equal(I.sk99.sigmaGPa, REV.materials.alternative_fibers.Dyneema_SK99_GPa);
  assert.equal(I.sk99.rho, 970); // docs/project_instructions.md:67, not canon
  assert.equal(I.sk99.mp001Rho, 970); // MP-001:22 "0.97 g/cm³" agrees
  assert.equal(I.sk99.rowSigmaAgrees, true);
  assert.equal(I.sk99.canon, false);
  assert.equal(I.fs, (1 - REV.materials.derate_fraction) / REV.materials.safety_factor);
  assert.equal(I.Lkm, REV.geometry.tether_half_length_km);
  assert.deepEqual(I.tiers.map((x) => x.vkms), [REV.kinematics.v_tip_kms, REV.kinematics.cislunar_revenue_gated_option.v_tip_kms, REV.kinematics.phase3_growth_option.v_tip_kms]);
  assert.equal(I.zylonTipKm, 20); // project_instructions.md:108
  assert.equal(I.cap, 0.2); // DECISION_LOG.md:70
  assert.deepEqual(I.item10SF, { capPct: 20, SF: 5 });
  assert.deepEqual(I.item10Quote, { from: 41, to: 800 });
  assert.equal(I.dm20Ratio, 50);
  assert.equal(I.ggModPct, 4);
  assert.deepEqual(I.aramidCreep, [3, 5]);
  assert.equal(I.bareTipsCited, true);
  assert.equal(I.halfTurnCited, true);
  assert.deepEqual(I.ladder.map((l) => l.key).sort(), Object.keys(REV.mass_ratio.integrated_tether_to_payload_both_arms).filter((k) => /_\d+pct_derate$/.test(k)).sort());
});

test('erf and erfc agree with CPython math.erf / math.erfc on [0, 6] (skips without python3)', (t) => {
  if (!hasPy) { t.skip('no python3'); return; }
  const out = execFileSync('python3', ['-I', '-c', 'import math,json;print(json.dumps([[i*0.05,math.erf(i*0.05),math.erfc(i*0.05)] for i in range(121)]))'], { encoding: 'utf8' });
  let e1 = 0;
  let e2 = 0;
  for (const [z, ef, ec] of JSON.parse(out)) {
    e1 = Math.max(e1, Math.abs(M.erf(z) - ef));
    e2 = Math.max(e2, rel(Math.exp(-z * z) * M.erfcx(z), ec));
  }
  assert.ok(e1 < 2e-15, `erf ${e1}`);
  assert.ok(e2 < 1e-12, `erfc ${e2}`);
  // gauss(a, b) = e^{b^2}[erf(b) - erf(a)] on both branches
  for (const [a, b] of [[0.3, 1.1], [2.3, 2.9], [3.5, 4.2], [0, 4.5]]) {
    const ref = Math.exp(b * b) * (M.erf(b) - M.erf(a));
    assert.ok(rel(M.gauss(a, b), ref) < 1e-9, `gauss ${a} ${b}`);
  }
});

test('reconciliation: the all-PBO limit reproduces every mass-ratio rung in rev_a.json within 5e-4', () => {
  const block = REV.mass_ratio.integrated_tether_to_payload_both_arms;
  let n = 0;
  for (const l of I.ladder) {
    const tier = I.tiers.find((x) => Math.abs(x.vkms - l.vkms) < 1e-9);
    for (const where of ['tip', 'hub']) {
      for (const mode of ['none', 'every', 'between']) {
        const r = run({ tierKey: tier.key, pKm: I.Lkm, where, mode, fs: (1 - l.derate) / l.SF });
        assert.ok(rel(r.ratio, l.value) < 5e-4, `${l.key} ${where} ${mode}: ${r.ratio} vs ${l.value}`);
        const tKey = l.key.replace(/_derate$/, '_fiber_mass_t');
        assert.ok(rel(r.tonnes, block[tKey]) < 5e-4, `${tKey}`);
      }
    }
    n++;
  }
  assert.equal(n, 5);
  // the headline rung, to two decimals, is the canon's 121.83
  assert.equal(run({ pKm: I.Lkm }).ratio.toFixed(2), String(block.conservative_30pct_derate));
});

test('oracle: Skyhook\'s own skyhook_physics.py gives the single-material limits (skips without python3)', (t) => {
  if (!hasPy) { t.skip('no python3'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-oracle-'));
  try {
    fs.mkdirSync(path.join(tmp, 'physics'));
    fs.mkdirSync(path.join(tmp, 'params'));
    fs.copyFileSync(snap('skyhook_physics.py'), path.join(tmp, 'physics', 'skyhook_physics.py'));
    fs.copyFileSync(snap('rev_a.json'), path.join(tmp, 'params', 'rev_a.json'));
    const grid = [];
    for (const v of [2.0, 2.5, 2.8, 3.5]) for (const SF of [2.5, 3.5, 5]) for (const d of [0, 0.15, 0.3]) grid.push([v, SF, d]);
    const py = `import sys,json; sys.path.insert(0, ${JSON.stringify(path.join(tmp, 'physics'))}); import skyhook_physics as S
g=json.loads(sys.argv[1]); fib=json.loads(sys.argv[2]); out=[]
for name,s,r in fib:
    vc=S.characteristic_velocity_kms(s,r)
    out.append([name, vc, [S.integrated_mass_ratio(v, vc, SF, d) for v,SF,d in g]])
print(json.dumps(out))`;
    const fibs = [['P', I.pbo.sigmaGPa, I.pbo.rho], ['H', I.sk99.sigmaGPa, I.sk99.rho]];
    const res = JSON.parse(execFileSync('python3', ['-I', '-B', '-c', py, JSON.stringify(grid), JSON.stringify(fibs)], { encoding: 'utf8' }));
    let worst = 0;
    for (const [name, vc, vals] of res) {
      const fib = name === 'P' ? I.pbo : I.sk99;
      assert.ok(rel(M.fibre(fib).Vc / 1000, vc) < 1e-14);
      vals.forEach((ref, i) => {
        const [v, SF, d] = grid[i];
        const f = (1 - d) / SF;
        // whole tether of one fibre through the piecewise kernel (two one-section arms)
        const F = M.fibre(fib);
        const one = M.arm([{ mat: name, u0: 0, u1: 1 }], { vms: v * 1000, P: F, H: F, fs: f, cap: f, mode: 'none', beta: 0 });
        worst = Math.max(worst, rel(2 * one.mass, ref), rel(M.singleMaterial(fib, v, f), ref));
      });
    }
    assert.ok(worst < 1e-12, `worst ${worst}`);
    // the proposal's two all-SK99 figures
    assert.equal(M.singleMaterial(I.sk99, 2.5, I.fs).toFixed(1), '122.6');
    assert.equal(M.singleMaterial(I.sk99, 2.5, I.cap).toFixed(1), '488.1');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('independent integrator: the closed-form piecewise kernel equals RK4 quadrature of the sizing rules to 1e-6', (t) => {
  const L = I.Lkm;
  const z = I.zylonTipKm;
  const custom = { name: 'test HMPE', sigmaGPa: 3.0, rho: 975, canon: false };
  let worst = 0;
  let n = 0;
  for (const tierKey of ['reference', 'cislunar']) {
    for (const where of ['tip', 'hub']) {
      for (const mode of ['none', 'every', 'between']) {
        for (const [p, beta, fs, cap, hm] of [[0, 0, I.fs, I.cap, 'sk99'], [100, 0, I.fs, I.cap, 'sk99'], [250, 0.3, 0.34, 0.2, 'sk99'], [40, 0.1, 0.3, 0.16, 'custom']]) {
          const fib = hm === 'custom' ? custom : I.sk99;
          const r = M.compute(I, { tierKey, pKm: p, where, mode, beta, fs, cap, hmpe: hm, custom: hm === 'custom' ? { sigmaGPa: custom.sigmaGPa, rho: custom.rho } : undefined });
          const vkms = I.tiers.find((x) => x.key === tierKey).vkms;
          const lay = handLayout(L, z, p, where);
          const opts = { vkms, fs, cap, mode, beta, P: I.pbo, H: fib };
          const ode = odeArm(lay.lower, opts, L).mass + odeArm(lay.upper, opts, L).mass;
          worst = Math.max(worst, rel(r.ratio, ode));
          n++;
        }
      }
    }
  }
  assert.equal(n, 48);
  t.diagnostic(`worst relative difference ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-6, `worst ${worst}`);
});

test('layout: the construction baseline and both ways of adding PBO, hub to tip', () => {
  const L = I.Lkm;
  const z = I.zylonTipKm;
  const km = (lay) => Object.fromEntries(Object.entries(lay).map(([k, v]) => [k, v.map((s) => [s.mat, +(s.u0 * L).toFixed(9), +(s.u1 * L).toFixed(9)])]));
  assert.deepEqual(km(M.layout(L, z, 0, 'tip')), { lower: [['H', 0, L - z], ['P', L - z, L]], upper: [['H', 0, L]] });
  assert.deepEqual(km(M.layout(L, z, 0, 'hub')), { lower: [['H', 0, L - z], ['P', L - z, L]], upper: [['H', 0, L]] });
  assert.deepEqual(km(M.layout(L, z, 100, 'tip')), { lower: [['H', 0, L - z - 100], ['P', L - z - 100, L]], upper: [['H', 0, L - 100], ['P', L - 100, L]] });
  assert.deepEqual(km(M.layout(L, z, 100, 'hub')), { lower: [['P', 0, 100], ['H', 100, L - z], ['P', L - z, L]], upper: [['P', 0, 100], ['H', 100, L]] });
  assert.deepEqual(km(M.layout(L, z, L, 'hub')), { lower: [['P', 0, L]], upper: [['P', 0, L]] });
  // the baseline is the same tether whichever end is chosen
  for (const mode of ['none', 'every', 'between']) assert.equal(run({ mode, where: 'tip' }).ratio, run({ mode, where: 'hub' }).ratio);
});

test('tension is continuous across every boundary and the area steps by the working-stress ratio', () => {
  for (const mode of ['none', 'every', 'between']) {
    const r = run({ mode, pKm: 100, where: 'hub', beta: 0.2 });
    for (const a of [r.lower, r.upper]) {
      for (let i = 1; i < a.pieces.length; i++) {
        const inner = a.pieces[i - 1];
        const outer = a.pieces[i];
        const u = outer.u0;
        assert.ok(Math.abs(inner.u1 - u) < 1e-12);
        const tIn = M.tAt(inner, u, 0.2);
        const tOut = M.tAt(outer, u, 0.2);
        assert.ok(rel(tIn, tOut) < 1e-12, `${mode} t at ${u}`);
        // sigma_w * A on each side equals the tension carried (aboard)
        const fib = (pc) => (pc.mat === 'P' ? r.P : r.H);
        const Ain = M.areaAt(inner, u, fib(inner), 1, 0.2);
        const Aout = M.areaAt(outer, u, fib(outer), 1, 0.2);
        const loadIn = M.fractionAt(inner, u, 'aboard', 0.2) * fib(inner).sigma * Ain;
        const loadOut = M.fractionAt(outer, u, 'aboard', 0.2) * fib(outer).sigma * Aout;
        assert.ok(rel(loadIn, loadOut) < 1e-12, `${mode} load at ${u}`);
        if (inner.regime === 'a' && outer.regime === 'a' && inner.mat !== outer.mat) {
          assert.ok(rel(Ain / Aout, (outer.f * fib(outer).sigma) / (inner.f * fib(inner).sigma)) < 1e-12);
        }
      }
    }
  }
  // at the HMPE/PBO boundary of the baseline, SK99 at the same fraction needs sigma_P/sigma_H more area
  const r = run({});
  const h = r.lower.pieces.find((p) => p.mat === 'H');
  const p = r.lower.pieces.find((q) => q.mat === 'P');
  const ratio = M.areaAt(h, h.u1, r.H, 1, 0) / M.areaAt(p, p.u0, r.P, 1, 0);
  assert.ok(rel(ratio, REV.materials.tensile_strength_GPa / REV.materials.alternative_fibers.Dyneema_SK99_GPa) < 1e-12);
});

test('shape: capped HMPE makes mass fall as PBO is added; at equal load the boundary is nearly free (the V_c coincidence)', () => {
  for (const where of ['tip', 'hub']) {
    let prev = Infinity;
    for (let p = 0; p <= I.Lkm; p += 5) {
      const m = run({ mode: 'every', where, pKm: p }).ratio;
      assert.ok(m < prev, `every ${where} not decreasing at ${p}`);
      prev = m;
    }
    const flat = [];
    for (let p = 0; p <= I.Lkm; p += 5) flat.push(run({ mode: 'none', where, pKm: p }).ratio);
    assert.ok(Math.max(...flat) / Math.min(...flat) - 1 < 0.01, `none ${where} not flat`);
  }
  // V_c of SK99 (with the founding-document density) is within 0.1 % of Zylon's
  assert.ok(rel(M.fibre(I.sk99).Vc, M.fibre(I.pbo).Vc) < 1e-3);
  // and the flatness is the coincidence, not a property of the model: a weaker HMPE is not flat
  const weak = { hmpe: 'custom', custom: { sigmaGPa: 2.4, rho: 970 } };
  assert.ok(run({ ...weak, pKm: 0 }).ratio / run({ ...weak, pKm: I.Lkm }).ratio > 2);
});

test('marginal cost: dM/du_b = 2(X_H^2 - X_P^2)[t(u_b) + u_b M_in(u_b)], increasing outward', () => {
  const P = M.fibre(I.pbo);
  const H = M.fibre(I.sk99);
  const opts = { vms: 2500, P, H, fs: I.fs, cap: I.cap, mode: 'every', beta: 0 };
  const two = (ub) => M.arm([{ mat: 'H', u0: 0, u1: ub }, { mat: 'P', u0: ub, u1: 1 }], opts);
  const XH2 = (2500 / H.Vc) ** 2 / Math.min(I.fs, I.cap);
  const XP2 = (2500 / P.Vc) ** 2 / I.fs;
  let prevB = -Infinity;
  for (const ub of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const h = 1e-5;
    const fd = (two(ub + h).mass - two(ub - h).mass) / (2 * h);
    const a = two(ub);
    const hp = a.pieces[0];
    const B = M.tAt(hp, ub, 0) + ub * hp.mass;
    const analytic = 2 * (XH2 - XP2) * B;
    assert.ok(rel(fd, analytic) < 1e-6, `ub ${ub}: ${fd} vs ${analytic}`);
    assert.ok(B > prevB);
    prevB = B;
  }
});

test('which end: with a cap on every load PBO belongs at the tip end, with a cap between catches at the hub end', () => {
  for (const tierKey of ['reference', 'cislunar']) {
    for (const p of [20, 40, 80, 160, 240, 300]) {
      const e = [run({ tierKey, mode: 'every', pKm: p, where: 'tip' }).ratio, run({ tierKey, mode: 'every', pKm: p, where: 'hub' }).ratio];
      const b = [run({ tierKey, mode: 'between', pKm: p, where: 'tip' }).ratio, run({ tierKey, mode: 'between', pKm: p, where: 'hub' }).ratio];
      assert.ok(e[0] < e[1], `every ${tierKey} ${p}`);
      assert.ok(b[1] < b[0], `between ${tierKey} ${p}`);
    }
  }
});

test('rule equivalences: between with a full tip equals every; a cap at or above the working load equals the canon rule', () => {
  for (const where of ['tip', 'hub']) {
    for (const p of [0, 60, 200]) {
      assert.ok(rel(run({ mode: 'between', beta: 1, pKm: p, where }).ratio, run({ mode: 'every', pKm: p, where }).ratio) < 1e-12);
      assert.equal(run({ mode: 'between', cap: I.fs, pKm: p, where }).ratio, run({ mode: 'none', pKm: p, where }).ratio);
      assert.equal(run({ mode: 'every', cap: 0.35, pKm: p, where }).ratio, run({ mode: 'none', pKm: p, where }).ratio);
    }
  }
  // the between rule sits between the two others and rises with tip mass
  let prev = 0;
  for (const beta of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    const m = run({ mode: 'between', beta }).ratio;
    assert.ok(m > prev && m > run({ mode: 'none' }).ratio - 1e-9 && m <= run({ mode: 'every' }).ratio + 1e-9);
    prev = m;
  }
});

test('load fractions: aboard is the working load; between catches it is f(1 - T_L/T), crossing the cap where closed form says', () => {
  // canon rule: every HMPE metre at fs aboard, so all of it is above a lower cap (the proposal's check)
  const r = run({ mode: 'none' });
  assert.equal(r.aboard.aboveKm, r.aboard.hmpeKm);
  assert.equal(r.aboard.hmpeKm, 2 * I.Lkm - I.zylonTipKm);
  assert.ok(Math.abs(r.aboard.peak - I.fs) < 1e-15);
  // all-HMPE arm, closed form: above the cap between catches for u < u*, 1 - u*^2 = ln(1/(1 - c/f)) / X^2
  const H = M.fibre(I.sk99);
  const X2 = (2500 / H.Vc) ** 2 / I.fs;
  const ustar = Math.sqrt(1 - Math.log(1 / (1 - I.cap / I.fs)) / X2);
  const one = M.arm([{ mat: 'H', u0: 0, u1: 1 }], { vms: 2500, P: H, H, fs: I.fs, cap: I.cap, mode: 'none', beta: 0 });
  const seg = M.aboveCap(one.pieces[0], 'between', I.cap, 0);
  assert.ok(Math.abs(seg[1] - ustar) < 1e-12 && seg[0] === 0);
  assert.ok(Math.abs(M.fractionAt(one.pieces[0], ustar, 'between', 0) - I.cap) < 1e-12);
  // the hub between catches carries f (1 - 1/taper), taper = e^{X^2}
  assert.ok(rel(M.fractionAt(one.pieces[0], 0, 'between', 0), I.fs * (1 - Math.exp(-X2))) < 1e-12);
  assert.equal(M.fractionAt(one.pieces[0], 1, 'between', 0), 0);
  // every: nothing above in either state; between: nothing above between catches, all of it aboard
  const e = run({ mode: 'every' });
  assert.equal(e.aboard.aboveKm, 0);
  assert.equal(e.between.aboveKm, 0);
  const b = run({ mode: 'between' });
  assert.equal(b.between.aboveKm, 0);
  assert.equal(b.aboard.aboveKm, b.aboard.hmpeKm);
  assert.ok(Math.abs(b.between.peak - I.cap) < 1e-12);
  assert.ok(b.aboard.peak <= I.fs + 1e-12 && b.aboard.peak > I.cap);
  // payload aboard for half a rotation: matches rev_a.json's rotation period at the reference
  assert.ok(Math.abs(2 * r.aboardMin - REV.geometry.rotation_period_min) < 0.05);
});

test('DECISION_LOG item 10, recomputed: f = (1 - derate)/SF carries everything; ~800x does not reproduce', () => {
  const it = M.item10(I);
  const by = (kind, d) => it.rows.find((r) => r.kind === kind && Math.abs(r.derate - d) < 1e-9);
  // the canon rungs tick against rev_a.json
  for (const d of [0, 0.15, 0.3]) assert.ok(rel(by('canon', d).pbo, by('canon', d).ladder) < 5e-4);
  // SF 5 at 0/15/30 % derate: idea 15 (Taper Is Not Mass) published 484.06x / 1,104.53x / 3,515.24x
  assert.deepEqual([0, 0.15, 0.3].map((d) => by('item10', d).pbo.toFixed(2)), ['484.06', '1104.53', '3515.24']);
  assert.deepEqual([0, 0.15, 0.3].map((d) => +by('item10', d).f.toFixed(12)), [0.2, 0.17, 0.14]);
  // "20 % sustained" is one tether whatever the split: SF 3.5 at the canon 30 % derate is the same row
  const cap = by('cap', 0.3);
  assert.ok(Math.abs(cap.SF - 3.5) < 1e-12);
  assert.equal(cap.pbo, by('item10', 0).pbo);
  assert.equal(cap.sk99.toFixed(2), '488.14');
  assert.equal(it.rangeReproduces, true);
  // ~800x needs f = 18.07 %; at SF 5 that is a 9.67 % derate
  assert.equal(it.fFor800.toFixed(4), '0.1807');
  assert.ok(Math.abs(M.singleMaterial(I.pbo, 2.5, it.fFor800) - 800) < 1e-6);
  assert.equal((1 - 5 * it.fFor800).toFixed(4), '0.0967');
  // between-catch reading, all SK99
  assert.equal(it.sk99Between.toFixed(2), '212.21');
});

test('refusals: no canon, no density, no layout line, no cap, bad input, overflow — never a substituted number', () => {
  for (const bad of [null, {}, { revA: null }, { revA: 'x' }]) {
    const r = M.readInputs(bad);
    assert.equal(r.ok, false);
    assert.equal(r.refusals[0].code, 'no_canon');
    assert.ok(r.refusals[0].what_would_help.length > 10);
  }
  // no PBO density
  const d1 = clone(D);
  delete d1.revA.materials.density_kgm3;
  const r1 = M.readInputs(d1);
  assert.equal(r1.ok, false);
  assert.ok(!r1.inputs.pbo);
  assert.equal(M.compute(r1.inputs, base).refusal.code, 'no_canon');
  // no founding-document row: SK99 refused, custom still allowed
  const d2 = clone(D);
  delete d2.lines['docs/project_instructions.md']['67'];
  const r2 = M.readInputs(d2);
  assert.equal(r2.ok, true);
  assert.equal(r2.inputs.sk99, undefined);
  assert.equal(r2.refusals[0].code, 'insufficient_data');
  assert.equal(M.compute(r2.inputs, base).refusal.code, 'insufficient_data');
  assert.equal(M.item10(r2.inputs).rows[0].sk99, null);
  const ok2 = M.compute(r2.inputs, { ...base, hmpe: 'custom', custom: { sigmaGPa: 3.6, rho: 970 } });
  assert.ok(!ok2.refusal && rel(ok2.ratio, run({}).ratio) < 1e-15);
  // a reworded row is refused too, not guessed
  const d2b = clone(D);
  d2b.lines['docs/project_instructions.md']['67'] = '| Dyneema SK99 (UHMWPE) | ~3.6 GPa | about a tonne per cubic metre | ~3.7 MJ/kg | ~2.7 km/s |';
  assert.equal(M.readInputs(d2b).inputs.sk99, undefined);
  // no SK99 strength in the canon
  const d2c = clone(D);
  delete d2c.revA.materials.alternative_fibers.Dyneema_SK99_GPa;
  assert.equal(M.readInputs(d2c).inputs.sk99, undefined);
  // no layout line
  const d3 = clone(D);
  d3.lines['docs/project_instructions.md']['108'] = 'Construction baseline: see elsewhere.';
  const r3 = M.readInputs(d3);
  assert.equal(r3.inputs.zylonTipKm, undefined);
  assert.equal(M.compute(r3.inputs, base).refusal.code, 'insufficient_data');
  // no cap line: the canon rule still computes but reports no above-cap figures; capped rules refuse
  const d4 = clone(D);
  delete d4.lines['docs/DECISION_LOG.md']['70'];
  const r4 = M.readInputs(d4);
  assert.equal(r4.inputs.cap, undefined);
  const c4 = M.compute(r4.inputs, { ...base, cap: null });
  assert.ok(!c4.refusal && c4.aboard === null && c4.between === null);
  assert.equal(M.compute(r4.inputs, { ...base, cap: null, mode: 'every' }).refusal.code, 'insufficient_data');
  assert.equal(M.compute(r4.inputs, { ...base, cap: null, mode: 'between' }).refusal.code, 'insufficient_data');
  // custom HMPE needs both numbers
  for (const c of [{}, { sigmaGPa: '3' }, { rho: '970' }, { sigmaGPa: '-1', rho: '970' }, { sigmaGPa: 'abc', rho: '970' }]) {
    assert.equal(run({ hmpe: 'custom', custom: c }).refusal.code, 'invalid_input');
  }
  // bad controls
  for (const over of [{ fs: 0 }, { fs: 1.5 }, { mode: 'every', cap: 0 }, { beta: -0.1 }, { beta: 2 }, { pKm: -1 }, { pKm: I.Lkm + 1 }, { mode: 'x' }, { where: 'middle' }]) {
    assert.equal(run(over).refusal.code, 'invalid_input', JSON.stringify(over));
  }
  // overflow is out_of_envelope, not Infinity on the page
  const o = run({ tierKey: 'phase3', hmpe: 'custom', custom: { sigmaGPa: 0.05, rho: 970 } });
  assert.equal(o.refusal.code, 'out_of_envelope');
});

test('no literals: the page and model hold no canon or founding-document number of their own', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
  const canonNums = new Set();
  const walk = (o) => {
    for (const v of Object.values(o)) {
      if (typeof v === 'number') canonNums.add(v);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(REV.materials);
  walk(REV.mass_ratio);
  walk(REV.geometry);
  walk(REV.kinematics);
  canonNums.add(970); // founding document SK99 density
  for (const v of [122.56, 454.78, 212.11, 484.06, 488.14, 212.21]) canonNums.add(v); // results
  const tokens = [...canonNums].filter((v) => !(Number.isInteger(v) && Math.abs(v) < 10)).map((v) => String(v)); // single digits are too generic to mean anything
  for (const f of ['model.js', 'app.js', 'index.html']) {
    const src = strip(fs.readFileSync(path.join(here, f), 'utf8'));
    for (const tok of tokens) {
      const variants = new Set([tok, Number(tok).toLocaleString('en-US')]);
      for (const vt of variants) {
        const re = new RegExp(`(?<![0-9.,])${vt.replace(/[.,]/g, (c) => `\\${c}`)}(?![0-9])`);
        assert.ok(!re.test(src), `${f} contains ${vt}`);
      }
    }
  }
});

test('README: the tagline and the numbers table say what the code computes', () => {
  const md = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  const tag = md.split('\n').find((l) => l.startsWith('> '));
  const x = (v) => `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
  const t1 = (v) => `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} t`;
  const none = run({ mode: 'none' });
  const every = run({ mode: 'every' });
  const between = run({ mode: 'between' });
  for (const s of [x(none.ratio), x(every.ratio), x(between.ratio), `+${t1(every.tonnes - none.tonnes)}`]) assert.ok(tag.includes(s), `tagline lacks ${s}`);
  // the table under "How it works"
  const rows = [
    ['canon rule', 'tip', 0, 'none'], ['cap on every load', 'tip', 0, 'every'], ['cap between catches', 'tip', 0, 'between'],
    ['cap on every load', 'tip', 100, 'every'], ['cap on every load', 'hub', 100, 'every'],
    ['cap between catches', 'tip', 100, 'between'], ['cap between catches', 'hub', 100, 'between'],
  ];
  for (const [, where, p, mode] of rows) {
    const r = run({ mode, where, pKm: p });
    assert.ok(md.includes(x(r.ratio)), `README lacks ${x(r.ratio)} (${mode} ${where} ${p})`);
  }
  assert.ok(md.includes(`${Math.round(none.between.aboveKm)} km`), 'between-catch length above cap');
  assert.ok(md.includes(`${(none.between.peak * 100).toFixed(1)} %`), 'hub load between catches');
});
