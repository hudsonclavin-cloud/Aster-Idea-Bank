// Tests for Taper Is Not Mass. Node built-ins only; python3 (standard library) where present.
// From the bank root: node --test ideas/15-taper-is-not-mass/taper.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require('./model.js');
const REV_A = require('./snapshots/rev_a.data.js');
const snap = (f) => path.join(here, 'snapshots', f);
const json = JSON.parse(fs.readFileSync(snap('rev_a.json'), 'utf8'));
const lines = (f) => fs.readFileSync(snap(f), 'utf8').split('\n');
const LOG = lines('DECISION_LOG.md');
const GLOSS = lines('glossary.md');
const canon = M.readCanon(REV_A);
const LB = json.mass_ratio.integrated_tether_to_payload_both_arms;
const sigma = json.materials.tensile_strength_GPa;
const rho = json.materials.density_kgm3;
const SF = json.materials.safety_factor;
const Vc = M.characteristicVelocityKms(sigma, rho);
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const clone = (o) => JSON.parse(JSON.stringify(o));
const hasPython = spawnSync('python3', ['-c', 'pass']).status === 0;
const SKYHOOK = '/home/user/skyhook';
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('snapshots: rev_a.data.js wraps rev_a.json unchanged, and every snapshot matches its sidecar', () => {
  assert.deepEqual(REV_A.data, json);
  for (const f of ['rev_a.json', 'skyhook_physics.py', 'DECISION_LOG.md', 'glossary.md']) {
    const side = JSON.parse(fs.readFileSync(snap(f + '.provenance.json'), 'utf8'));
    assert.equal(side.commit.slice(0, 7), '34935cb', f);
    assert.equal(sha256(snap(f)), side.writtenSha256, f + ' bytes changed since the snapshot');
    assert.equal(side.sourceSha256, side.writtenSha256, f + ' is a whole-file copy');
  }
  const side = JSON.parse(fs.readFileSync(snap('rev_a.data.js.provenance.json'), 'utf8'));
  assert.equal(side.mode, 'derived');
  assert.equal(sha256(snap('rev_a.data.js')), side.writtenSha256);
  assert.equal(REV_A.provenance.sourceSha256, side.sourceSha256);
});

test('erf: matches CPython math.erf on [0, 6] to 2e-15, is odd, and A&S 7.1.26 is within its 1.5e-7', (t) => {
  const xs = Array.from({ length: 121 }, (_, i) => i * 0.05);
  let maxAS = 0;
  for (const x of xs) {
    assert.ok(M.erf(-x) === -M.erf(x));
    maxAS = Math.max(maxAS, Math.abs(M.erfAS(x) - M.erf(x)));
  }
  assert.ok(maxAS <= 1.5e-7, `A&S error ${maxAS}`);
  assert.equal(M.erf(0), 0);
  assert.equal(M.erf(7), 1);
  if (!hasPython) return t.skip('python3 not available');
  const r = spawnSync('python3', ['-I', '-B', '-c', 'import math,json,sys; print(json.dumps([math.erf(x) for x in json.load(sys.stdin)]))'], { input: JSON.stringify(xs), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const py = JSON.parse(r.stdout);
  let worst = 0;
  xs.forEach((x, i) => { worst = Math.max(worst, Math.abs(M.erf(x) - py[i])); });
  assert.ok(worst <= 2e-15, `max |erf - math.erf| = ${worst}`);
});

test('EQ-4 from σ and ρ reproduces the file\'s rounded V_c_kms, specific strength and v_tip/V_c', () => {
  assert.equal(canon.rounded.length, 3);
  for (const r of canon.rounded) assert.equal(r.status, 'matches as rounded', r.key);
  assert.equal(Math.round(Vc * 100) / 100, json.materials.V_c_kms);
  assert.equal(Math.round(json.kinematics.v_tip_kms / Vc * 100) / 100, json.mass_ratio.tip_speed_to_Vc_ratio);
});

test('reconciliation: all 14 mass-ratio and fibre-mass values in rev_a.json re-derive within 5e-4', () => {
  const ladderKeys = Object.keys(LB).filter((k) => /_derate$|_fiber_mass_t$/.test(k));
  const parsed = canon.ladder.filter((r) => !r.duplicate).map((r) => r.key.split('.').pop());
  assert.deepEqual(parsed.slice().sort(), ladderKeys.slice().sort(), 'every ladder key is parsed, none invented');
  assert.equal(canon.ladder.length, 14);
  assert.equal(canon.ladder.filter((r) => r.duplicate).length, 4);
  for (const r of canon.ladder) {
    assert.equal(r.status, 'reproduces', `${r.key}: ${r.computed} vs ${r.canonValue}`);
    assert.ok(r.relErr <= 5e-4);
  }
  // The headline pins, by name, to the file's own numbers.
  const at = (k) => canon.ladder.find((r) => r.key.endsWith('.' + k));
  assert.ok(rel(at('conservative_30pct_derate').computed, LB.conservative_30pct_derate) < 5e-4);
  assert.ok(rel(at('optimistic_0pct_derate').computed, LB.optimistic_0pct_derate) < 5e-4);
  assert.ok(rel(at('baseline_15pct_derate').computed, LB.baseline_15pct_derate) < 5e-4);
  assert.ok(rel(at('cislunar_2p8kms_30pct_derate').computed, LB.cislunar_2p8kms_30pct_derate) < 5e-4);
  assert.ok(rel(at('phase3_3p5kms_30pct_derate').computed, LB.phase3_3p5kms_30pct_derate) < 5e-4);
  assert.ok(rel(at('conservative_30pct_fiber_mass_t').computed, LB.conservative_30pct_fiber_mass_t) < 5e-4);
  // Where the inputs came from.
  assert.equal(at('conservative_30pct_derate').derate, json.materials.derate_fraction);
  assert.equal(at('phase3_3p5kms_30pct_derate').vTipKms, json.kinematics.phase3_growth_option.v_tip_kms);
  assert.equal(at('cislunar_2p8kms_30pct_derate').vTipKms, json.kinematics.cislunar_revenue_gated_option.v_tip_kms);
  assert.equal(canon.SF, json.materials.safety_factor);
  assert.equal(canon.payloadKg, LB.payload_mass_kg_for_tonnage);
  assert.equal(canon.tiers.map((t) => t.vTipKms).join(','), [json.kinematics.v_tip_kms, json.kinematics.cislunar_revenue_gated_option.v_tip_kms, json.kinematics.phase3_growth_option.v_tip_kms].join(','));
  assert.equal(canon.guardrail.ratio, Number(/(\d+\.\d+)x mass-growth/.exec(json.mass_ratio._ratio_note)[1]));
  assert.deepEqual(canon.notes, []);
});

test('the file\'s rounded V_c_kms (2 decimals) would miss every ladder rung by more than 5e-4 but less than the repo\'s 2 %', () => {
  const rungs = canon.ladder.filter((r) => r.kind === 'ratio' && !r.duplicate);
  assert.equal(rungs.length, 5);
  for (const r of rungs) {
    const e = rel(M.massRatioOfX(M.xParam(r.vTipKms, json.materials.V_c_kms, r.SF, r.derate)), r.canonValue);
    assert.ok(e > 5e-4 && e < 0.02, `${r.key}: ${e}`);
  }
});

test('DECISION_LOG.md:12 — the old 440× is EQ-6 at 3.5 km/s, SF 2.5, 0 % derate: 440.3996', () => {
  const printed = Number(/\*\*(\d+\.\d+)×/.exec(LOG[11])[1]);
  const v = json.kinematics.phase3_growth_option.v_tip_kms;
  const g = M.massRatioOfX(M.xParam(v, Vc, SF, 0));
  assert.equal(Math.round(g * 1e4) / 1e4, printed);
  assert.equal(Math.round(g), 440);
  // and not the conservative case
  assert.ok(rel(M.massRatioOfX(M.xParam(v, Vc, SF, json.materials.derate_fraction)), 440) > 5);
});

test('glossary.md:48 and DECISION_LOG.md:20 — taper 8.2 and 20.1 reproduce from σ, ρ; not from the V_c = 2.73 they state', () => {
  const g = GLOSS[47];
  const [t0q, t3q] = [Number(/taper ~= (\d+\.\d)/.exec(g)[1]), Number(/it is ~=(\d+\.\d)/.exec(g)[1])];
  assert.ok(/V_c = 2\.73 km\/s/.test(g), 'the glossary states the rounded V_c');
  const vr = json.kinematics.v_tip_kms;
  const d = json.materials.derate_fraction;
  const t0 = M.taperOfX(M.xParam(vr, Vc, SF, 0));
  const t3 = M.taperOfX(M.xParam(vr, Vc, SF, d));
  assert.equal(Math.round(t0 * 10) / 10, t0q);
  assert.equal(Math.round(t3 * 10) / 10, t3q);
  const r0 = M.taperOfX(M.xParam(vr, json.materials.V_c_kms, SF, 0));
  const r3 = M.taperOfX(M.xParam(vr, json.materials.V_c_kms, SF, d));
  assert.notEqual(Math.round(r0 * 10) / 10, t0q);
  assert.notEqual(Math.round(r3 * 10) / 10, t3q);
  assert.ok(/peak area taper is ~8\.2 \(no derate\)/.test(LOG[19]));
});

test('DECISION_LOG.md:10 — the audit\'s 23.64 % and SF 3.274 come out only if 440× meant two arms × EQ-5', () => {
  const line = LOG[9];
  const dq = Number(/(\d+\.\d+)% derate/.exec(line)[1]);
  const sq = Number(/SF (\d+\.\d+) at zero/.exec(line)[1]);
  const v = json.kinematics.phase3_growth_option.v_tip_kms;
  assert.equal(Math.round(M.derateForTaperTarget(440, v, Vc, SF, 2) * 1e4) / 100, dq);
  assert.equal(Math.round(M.sfForTaperTarget(440, v, Vc, 0, 2) * 1e3) / 1e3, sq);
  assert.notEqual(Math.round(M.derateForTaperTarget(440, v, Vc, SF, 1) * 1e4) / 100, dq, 'one arm does not give it');
  // and its "~360× per arm" is one EQ-5 at 30 %
  assert.equal(Math.round(M.taperOfX(M.xParam(v, Vc, SF, json.materials.derate_fraction)) / 10) * 10, 360);
});

test('identity: M/m ÷ taper = 2√π·x·erf(x), and M/m = 2 arms × 2x² × the profile\'s mean, by quadrature (no erf)', () => {
  for (const x of [0.05, 0.2, 0.5224, 0.9, 1.4496, 1.7326, 2.4, 3.1]) {
    assert.ok(rel(M.massRatioOfX(x) / M.taperOfX(x), M.gapOfX(x)) < 1e-14);
    assert.ok(rel(M.gapOfX(x), 2 * Math.sqrt(Math.PI) * x * M.erf(x)) < 1e-15);
    // Simpson's rule over one arm, u = r/L in [0, 1], of A(u)/A_tip = exp(x²(1 - u²)).
    const n = 4000;
    let s = M.profile(x, 0) + M.profile(x, 1);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * M.profile(x, i / n);
    const mean = s / (3 * n);
    assert.ok(rel(2 * 2 * x * x * mean, M.massRatioOfX(x)) < 1e-10, `x=${x}`);
    assert.ok(rel(mean, M.meanAreaOfX(x)) < 1e-10);
    assert.equal(M.profile(x, 0), M.taperOfX(x));
    assert.equal(M.profile(x, 1), 1);
  }
  const ev = M.evaluate({ vTipKms: json.kinematics.v_tip_kms, derate: json.materials.derate_fraction, SF, sigmaGPa: sigma, rhoKgm3: rho, payloadKg: LB.payload_mass_kg_for_tonnage });
  assert.ok(rel(ev.massRatio, LB.conservative_30pct_derate) < 5e-4);
  assert.ok(rel(ev.fibreMassT, LB.conservative_30pct_fiber_mass_t) < 5e-4);
  assert.ok(rel(ev.taperNoDerate, M.taperOfX(M.xParam(json.kinematics.v_tip_kms, Vc, SF, 0))) < 1e-15);
  assert.equal(Math.round(ev.gap * 100) / 100, 6.05);
});

test('crossover: the curves meet once, at x* = 0.5224; below it the taper exceeds the mass ratio', () => {
  const xs = M.crossoverX();
  assert.ok(Math.abs(M.gapOfX(xs) - 1) < 1e-12);
  assert.equal(Math.round(xs * 1e4) / 1e4, 0.5224);
  for (const x of [0.05, 0.2, 0.4, xs - 1e-3]) assert.ok(M.massRatioOfX(x) < M.taperOfX(x), `x=${x}`);
  for (const x of [xs + 1e-3, 0.8, 1.5, 3]) assert.ok(M.massRatioOfX(x) > M.taperOfX(x), `x=${x}`);
  // The proposal's "EQ-6 > EQ-5 at every slider grid point" is false: the slider's low corner.
  const lo = M.evaluate({ vTipKms: 0.5, derate: 0, SF: 1, sigmaGPa: sigma, rhoKgm3: rho });
  assert.ok(lo.massRatio < lo.taper && lo.x < xs);
  // Rev A sits well above it (Skyhook's tests/test_rev_a_physics.py:156 guard holds there).
  assert.ok(M.xParam(json.kinematics.v_tip_kms, Vc, SF, 0) > xs);
});

test('limits: x → 0 gives taper 1, M/m ≈ 4x²; large x gives M/m ÷ taper → 2√π·x', () => {
  assert.equal(M.taperOfX(0), 1);
  assert.equal(M.massRatioOfX(0), 0);
  for (const x of [1e-4, 1e-3, 1e-2]) assert.ok(rel(M.massRatioOfX(x), 4 * x * x) < 2 * x * x);
  for (const x of [4, 5, 6]) assert.ok(rel(M.gapOfX(x), 2 * Math.sqrt(Math.PI) * x) < 1e-6);
  assert.ok(rel(M.meanAreaOfX(1e-9), 1) < 1e-12);
});

test('oracle: Skyhook\'s own physics/skyhook_physics.py (snapshot) agrees with model.js to 1e-12', (t) => {
  if (!hasPython) return t.skip('python3 not available');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taper15-'));
  try {
    fs.mkdirSync(path.join(tmp, 'physics'));
    fs.mkdirSync(path.join(tmp, 'params'));
    fs.copyFileSync(snap('skyhook_physics.py'), path.join(tmp, 'physics', 'skyhook_physics.py'));
    fs.copyFileSync(snap('rev_a.json'), path.join(tmp, 'params', 'rev_a.json'));
    const pts = [];
    for (const v of [0.5, 1.2, 2.5, 2.8, 3.5, 4]) for (const sf of [1, 2.5, 5]) for (const d of [0, 0.15, 0.3, 0.5]) pts.push([v, sf, d]);
    const py = `
import importlib.util, json, sys, io, contextlib
spec = importlib.util.spec_from_file_location("skyhook_physics", sys.argv[1])
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
p = s.PARAMS["materials"]
vc = s.characteristic_velocity_kms(p["tensile_strength_GPa"], p["density_kgm3"])
out = {"vc": vc, "rows": [[s.integrated_mass_ratio(v, vc, sf, d), s.taper_ratio(v, vc, sf)] for v, sf, d in json.load(sys.stdin)]}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    out["verify"] = s.verify_rev_a()
print(json.dumps(out))`;
    const r = spawnSync('python3', ['-I', '-B', '-c', py, path.join(tmp, 'physics', 'skyhook_physics.py')], { input: JSON.stringify(pts), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(rel(Vc, out.vc) < 1e-15);
    pts.forEach(([v, sf, d], i) => {
      const x = M.xParam(v, Vc, sf, d);
      assert.ok(rel(M.massRatioOfX(x), out.rows[i][0]) < 1e-12, `EQ-6 at ${v},${sf},${d}`);
      assert.ok(rel(M.taperOfX(M.xParam(v, Vc, sf, 0)), out.rows[i][1]) < 1e-12, `EQ-5 at ${v},${sf}`);
    });
    assert.ok(Object.values(out.verify).every(Boolean), 'the snapshot passes its own verify_rev_a()');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('materials: SK99 is refused (no density in canon), T1100G reads its density from the note string', () => {
  const sk = canon.materials.find((m) => /SK99/.test(m.name));
  assert.equal(sk.sigmaGPa, json.materials.alternative_fibers.Dyneema_SK99_GPa);
  assert.equal(sk.rhoKgm3, undefined);
  assert.equal(sk.refusal.code, 'insufficient_data');
  assert.deepEqual(sk.refusal.missing, ['density']);
  assert.ok(/no density/.test(sk.refusal.reason) && /Custom fibre/.test(sk.refusal.whatWouldHelp));
  const t1 = canon.materials.find((m) => /T1100G/.test(m.name));
  assert.equal(t1.rhoSource, 'note');
  assert.equal(t1.rhoKgm3, Number(/density (\d+) kg/.exec(json.materials.alternative_fibers._t1100g_note)[1]));
  assert.equal(t1.refusal, undefined);
  assert.equal(canon.materials[0].name, json.materials.primary_fiber);
  // A keyed density would be preferred over a note.
  const j = clone(json);
  j.materials.alternative_fibers.Dyneema_SK99_density_kgm3 = 1000;
  const c2 = M.readCanon({ data: j });
  const sk2 = c2.materials.find((m) => /SK99/.test(m.name));
  assert.equal(sk2.rhoKgm3, 1000);
  assert.equal(sk2.rhoSource, 'key');
});

test('refusals: no canon, a missing key, bad inputs and overflow each refuse instead of showing a number', () => {
  for (const bad of [undefined, null, {}, { data: null }]) {
    const c = M.readCanon(bad);
    assert.equal(c.ok, false);
    assert.equal(c.refusal.code, 'no_canon');
    assert.equal(c.ladder, undefined);
    assert.deepEqual(M.checkClaims(c), []);
  }
  const j = clone(json);
  delete j.materials.density_kgm3;
  const c = M.readCanon({ data: j });
  assert.equal(c.primary.refusal.code, 'insufficient_data');
  assert.ok(c.ladder.length === 14 && c.ladder.every((r) => r.status === 'refused' && r.computed === undefined));
  assert.equal(c.rounded.length, 0);
  assert.ok(M.checkClaims(c).every((r) => r.status === 'refused'));
  const j2 = clone(json);
  delete j2.kinematics.cislunar_revenue_gated_option.v_tip_kms;
  delete j2.mass_ratio._ratio_note;
  const c2 = M.readCanon({ data: j2 });
  assert.equal(c2.tiers.length, 2);
  assert.equal(c2.guardrail, null);
  assert.equal(c2.notes.length, 2);
  const base = { vTipKms: 2.5, derate: 0.3, SF: 2.5, sigmaGPa: sigma, rhoKgm3: rho };
  const cases = [
    [{ sigmaGPa: 0 }, 'insufficient_data'], [{ rhoKgm3: NaN }, 'insufficient_data'], [{ sigmaGPa: -1 }, 'insufficient_data'],
    [{ derate: 1 }, 'out_of_envelope'], [{ derate: -0.01 }, 'out_of_envelope'], [{ vTipKms: -1 }, 'invalid_input'],
    [{ SF: 0 }, 'invalid_input'], [{ sigmaGPa: 0.001, vTipKms: 4 }, 'out_of_envelope']
  ];
  for (const [patch, code] of cases) {
    const r = M.evaluate({ ...base, ...patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.equal(r.refusal.code, code, JSON.stringify(patch));
    assert.equal(r.massRatio, undefined);
    assert.ok(r.refusal.whatWouldHelp.length > 10);
  }
  assert.equal(M.evaluate(null).ok, false);
});

test('tamper: the badges are computed — σ 5.7 GPa turns all 14 rows to "differs"; one edited value flags only itself', () => {
  const j = clone(json);
  j.materials.tensile_strength_GPa = 5.7;
  const c = M.readCanon({ data: j });
  assert.equal(c.ladder.filter((r) => r.status === 'differs').length, 14);
  const j2 = clone(json);
  j2.mass_ratio.integrated_tether_to_payload_both_arms.conservative_30pct_derate = 121.9;
  const c2 = M.readCanon({ data: j2 });
  const bad = c2.ladder.filter((r) => r.status !== 'reproduces');
  assert.equal(bad.length, 1);
  assert.ok(bad[0].key.endsWith('conservative_30pct_derate'));
});

test('history: every quote is verbatim at its cited line, and the verdicts are what the page shows', () => {
  const files = { 'docs/DECISION_LOG.md': LOG, 'docs/glossary.md': GLOSS };
  for (const cl of M.CLAIMS) {
    assert.ok(files[cl.file][cl.line - 1].includes(cl.quote), `${cl.id} not verbatim at ${cl.file}:${cl.line}`);
    for (const q of cl.quoted) assert.ok(cl.quote.includes(q.text), `${cl.id}: ${q.text}`);
  }
  const res = Object.fromEntries(M.checkClaims(canon).map((r) => [r.claim.id, r]));
  for (const id of ['audit360', 'audit440', 'ghost440', 'log20', 'gloss48']) assert.equal(res[id].status, 'exact', id);
  const cr = res.creep72;
  assert.equal(cr.status, 'no');
  assert.equal(cr.results[0].verdict, 'close');
  assert.equal(cr.results[1].verdict, 'no');
  assert.deepEqual(cr.results[1].alternatives.map((a) => [a.derate, Math.round(a.value * 100) / 100]), [[0, 484.06], [0.15, 1104.53], [0.3, 3515.24]]);
  assert.ok(cr.results[1].alternatives.every((a) => M.verdict(a.value, cr.results[1].q) === 'no'), 'no ladder rung gives ~800×');
  // The claim's own inputs appear in its words.
  assert.ok(/SF ≈ 5/.test(LOG[71]) && /3\.5 km\/s/.test(LOG[9]) && /3\.5,/.test(LOG[11]));
  // verdict rules
  assert.equal(M.verdict(359.1, { text: '~360', value: 360 }), 'exact');
  assert.equal(M.verdict(40.32, { text: '~41×', value: 41 }), 'close');
  assert.equal(M.verdict(20.12, { text: '20.1', value: 20.1 }), 'exact');
  assert.equal(M.verdict(19.99, { text: '20.1', value: 20.1 }), 'close');
});

// The finding about Skyhook's program site (DEVIATIONS item 8): its calculator's formula, quoted
// verbatim, run as-is. Its "Tether ÷ payload mass" row is one arm, at d = 1 - derate.
const SITE = {
  file: 'tools/sims/skyhook_program_site.html',
  lad: [1135, '  var LAD={Conservative:{d:.6,loss:1800,launch:2500,eff:.15,kwh:.08},Baseline:{d:.72,loss:1500,launch:1500,eff:.2,kwh:.06},Optimistic:{d:.85,loss:1200,launch:800,eff:.3,kwh:.04}};'],
  f1: [1158, '    var Vc=Math.sqrt(2*mt[0]*lad.d/mt[1]), Vw=Vc/Math.sqrt(SF), x=vt/Vw;'],
  f2: [1159, '    var taper=Math.exp(x*x), mr=Math.sqrt(Math.PI)*x*Math.exp(x*x)*erf(x), tm=2*mr*pl;']
};
test('Skyhook program site calculator: its ladder is 40/28/15 % derate and its "Tether ÷ payload mass" is one arm', (t) => {
  const src = path.join(SKYHOOK, SITE.file);
  if (fs.existsSync(src)) {
    const L = fs.readFileSync(src, 'utf8').split('\n');
    for (const [n, text] of [SITE.lad, SITE.f1, SITE.f2]) assert.equal(L[n - 1], text, `line ${n} moved or changed`);
  } else {
    t.diagnostic('Skyhook checkout absent: running the quoted lines without re-checking them');
  }
  const lad = vm.runInNewContext(SITE.lad[1] + '; LAD');
  const out = {};
  for (const mode of ['Conservative', 'Baseline', 'Optimistic']) {
    const ctx = { Math, erf: M.erfAS, mt: [sigma * 1e9, rho], lad: lad[mode], SF, vt: json.kinematics.v_tip_kms * 1e3, pl: LB.payload_mass_kg_for_tonnage };
    vm.runInNewContext(SITE.f1[1] + SITE.f2[1] + '; this.r = { mr: mr, tm: tm, taper: taper, x: x };', ctx);
    const derate = 1 - lad[mode].d;
    const oneArm = M.massRatioOfX(M.xParam(json.kinematics.v_tip_kms, Vc, SF, derate), 1);
    assert.ok(rel(ctx.r.mr, oneArm) < 1e-6, mode);
    out[mode] = { mr: Math.round(ctx.r.mr), t: Math.round(ctx.r.tm / 1000), x: Math.round(ctx.r.x * 1000) / 1000, derate };
  }
  assert.deepEqual(out.Conservative, { mr: 109, t: 1092, x: 1.871, derate: 0.4 });
  assert.equal(out.Baseline.mr, 55);
  assert.equal(out.Baseline.t, 552);
  assert.equal(out.Optimistic.mr, 32);
  assert.equal(out.Optimistic.t, 322);
  assert.ok(Math.abs(out.Optimistic.derate - 0.15) < 1e-12, 'the site\'s "Optimistic" is the canon\'s baseline derate');
  assert.ok(rel(out.Optimistic.t, LB.baseline_15pct_fiber_mass_t) < 2e-3);
  // Its working-ratio flag (x > 1.35, :1179) fires at the canon reference too.
  assert.ok(M.xParam(json.kinematics.v_tip_kms, Vc, SF, json.materials.derate_fraction) > 1.35);
});

test('the page and model hold no canon number of their own; the README states what the code computes', () => {
  const leaves = [];
  (function walk(o) {
    for (const v of Object.values(o)) {
      if (typeof v === 'number') leaves.push(v);
      else if (v && typeof v === 'object') walk(v);
    }
  })({ m: json.materials, r: json.mass_ratio, k: [json.kinematics.v_tip_kms, json.kinematics.cislunar_revenue_gated_option.v_tip_kms, json.kinematics.phase3_growth_option.v_tip_kms] });
  const lits = [...new Set(leaves.filter((v) => !Number.isInteger(v) || v >= 100).map(String))];
  lits.push(/(\d+\.\d+)x mass-growth/.exec(json.mass_ratio._ratio_note)[1]);
  assert.ok(lits.includes('121.83') && lits.includes('1560') && lits.includes('2.5') && lits.includes('1.3'));
  const model = fs.readFileSync(path.join(here, 'model.js'), 'utf8');
  const cut = model.slice(0, model.indexOf('// CLAIMS:begin')) + model.slice(model.indexOf('// CLAIMS:end'));
  const sources = { 'index.html': fs.readFileSync(path.join(here, 'index.html'), 'utf8'), 'app.js': fs.readFileSync(path.join(here, 'app.js'), 'utf8'), 'model.js (outside CLAIMS)': cut };
  for (const [name, text] of Object.entries(sources)) {
    for (const lit of lits) {
      const re = new RegExp('(?<![\\d.])' + lit.replace('.', '\\.') + '(?![\\d])');
      assert.ok(!re.test(text), `${name} contains the canon literal ${lit}`);
    }
  }
  const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  const xs = M.crossoverX();
  const ev = M.evaluate({ vTipKms: json.kinematics.v_tip_kms, derate: json.materials.derate_fraction, SF, sigmaGPa: sigma, rhoKgm3: rho });
  for (const s of [xs.toFixed(4), ev.gap.toFixed(2), ev.taper.toFixed(2), '484.06', '1,104.53', '3,515.24', '440.3996', '23.64', '3.274']) {
    assert.ok(readme.includes(s), `README should say ${s}`);
  }
});
