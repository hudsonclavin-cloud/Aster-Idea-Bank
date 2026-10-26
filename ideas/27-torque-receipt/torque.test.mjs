// Torque Receipt tests. Run from the bank root: node --test ideas/27-torque-receipt/torque.test.mjs
// Numbers are pinned to things outside this folder's code: PartForge's own table columns and their
// definitions, the roadmap evaluation's worked counter-example (docs/roadmap-evaluation.md:403),
// the dry-run end cap fixture (tests/dryrun/endcap.scad), PartForge's threadCheck test vector
// (tests/flight-eng.test.mjs:246), the inch table's own worked torque example (fasteners_un notes
// (6)), hand-worked protrusion stacks and closed-form round trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TR = require('./torque.js');
const data = require('./node-data.cjs')(here);
const ctx = TR.makeContext(data);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const sidecar = (f) => JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f + '.provenance.json'), 'utf8'));
const evalLine = (n) => data.evaluation.lines.find((l) => l.line === n).text;
const M8_25_LUB = { size: 'M8', grade: '8.8', torque_Nm: 25, condition: 'lubricated', K_pick: 'mid' };

test('snapshots are the exact source text their sidecars name, all at one commit', () => {
  for (const [f, key] of [['fasteners_metric.js', 'fasteners_metric'], ['design_factors_nasa.js', 'design_factors_nasa'], ['endcap.js', 'endcap']]) {
    const sc = sidecar(f);
    const sha = crypto.createHash('sha256').update(data[key].text).digest('hex');
    assert.equal(sha, sc.sourceSha256, `${f} text hashes to the source file's sha256`);
    assert.equal(data[key].text.length > 1000, true);
    assert.equal(sc.commit, data.code.commit, `${f} read at the same commit as the code cut`);
  }
  const code = fs.readFileSync(path.join(here, 'snapshots', 'partforge-code.js'), 'utf8');
  for (const s of ['function threadCheck({ size, engagement_mm, bolt_sigma_u_MPa, internal_sigma_u_MPa, internal_material_class }) {', 'function boltShear(', "const GRADE_SY = { '8.8':640"]) assert.ok(code.includes(s), `code cut contains ${s}`);
  assert.equal(sidecar('evaluation-excerpt.js').path, 'docs/roadmap-evaluation.md');
});

test('the nut factors, scatter and target band read from the tables agree with the evaluation\'s own summary of them (roadmap-evaluation.md:398)', () => {
  const l398 = evalLine(398);
  const m = /nut factors K = ([\d.]+) dry \/ ([\d.]+)-([\d.]+) lubricated, the \+\/-(\d+)% scatter figure and the ([\d.]+)-([\d.]+)x proof target/.exec(l398);
  assert.ok(m, 'line 398 still states the four facts');
  assert.equal(ctx.metricK.dry.lo, +m[1]);
  assert.equal(ctx.metricK.lubricated.lo, +m[2]);
  assert.equal(ctx.metricK.lubricated.hi, +m[3]);
  assert.equal(ctx.ruleScatter, +m[4] / 100);
  assert.equal(ctx.band.lo, +m[5]);
  assert.equal(ctx.band.hi, +m[6]);
  // NASA rows: lubricated 25 %, as received 35 %, protrusion two pitches, as the quotes say in words.
  assert.match(ctx.uLub.quote, /25 percent/);
  assert.equal(ctx.uLub.preload_uncertainty, 0.25);
  assert.match(ctx.uDry.quote, /35 percent/);
  assert.equal(ctx.uDry.preload_uncertainty, 0.35);
  assert.match(ctx.protrusionRow.quote, /twice the thread pitch/);
  assert.equal(ctx.protrusionRow.protrusion_min_pitches, 2);
  // The inch table says something different for lubricated threads: a finding, pinned.
  assert.deepEqual([ctx.unK.lubricated.lo, ctx.unK.lubricated.hi], [0.15, 0.17]);
  assert.notDeepEqual([ctx.unK.lubricated.lo, ctx.unK.lubricated.hi], [ctx.metricK.lubricated.lo, ctx.metricK.lubricated.hi]);
});

test('torque_guide_8_8_dry_Nm, all 12 sizes, reproduced to 3 sf from its own definition with As x Sp; the 3-sf proof column misses five', () => {
  const rows = TR.guideTable(ctx);
  assert.equal(rows.length, 12);
  const misses = [];
  for (const r of rows) {
    assert.equal(r.sf3, r.guide_Nm, `${r.key}: K 0.20 x 0.7 x As x Sp x d = ${r.recomputed_Nm} -> ${r.sf3}, table ${r.guide_Nm}`);
    assert.ok(r.frac_back >= 0.697 && r.frac_back <= 0.703, `${r.key}: guide / (0.2 d) / proof column = ${r.frac_back.toFixed(4)}`);
    if (r.fromColumn_sf3 !== r.guide_Nm) misses.push(r.key);
  }
  assert.deepEqual(misses, ['M2.5', 'M6', 'M8', 'M10', 'M12']);
  // M20 uses the d > 16 proof stress, read from the grade note.
  assert.equal(rows.find((r) => r.key === 'M20').proof_MPa, 600);
});

test('proof-load columns agree with As x proof stress to within 0.5 % (3-sf rounding), 4 grades x 12 sizes', () => {
  let worst = 0;
  for (const row of ctx.metric.rows) {
    const size = TR.findSize(ctx, row.key);
    for (const g of ['8.8', '10.9', '12.9', 'A2-70']) {
      const r = TR.receipt(ctx, { size: row.key, grade: g, torque_Nm: 1, condition: 'dry' });
      assert.ok(r.ok, `${row.key} ${g}`);
      const col = r.grade.proofLoadColumn.N;
      const rel = Math.abs(col - r.grade.proofLoad_N) / r.grade.proofLoad_N;
      worst = Math.max(worst, rel);
      assert.ok(rel < 0.005, `${row.key} ${g}: column ${col} vs As x Sp ${r.grade.proofLoad_N}`);
      assert.equal(r.grade.proofLoad_N, r.grade.proof_MPa * size.As_mm2);
    }
  }
  assert.ok(worst > 0.001, 'the comparison is not vacuous');
});

test('the evaluation\'s counter-example reproduces from the tables (roadmap-evaluation.md:403)', () => {
  const l403 = evalLine(403);
  const m = /(\d+) N\.m on lubricated (M\d+) ([\d.]+) with K=([\d.]+) gives F_i = ([\d.]+) kN against a ([\d.]+) kN proof load \(At ([\d.]+) mm2, (\d+) MPa\), so at F_i,max = ([\d.]+) F_i the bolt stress is (\d+) MPa and the proof SF is ([\d.]+)/.exec(l403);
  assert.ok(m, 'line 403 still carries the worked example');
  const r = TR.receipt(ctx, { size: m[2], grade: m[3], torque_Nm: +m[1], condition: 'lubricated', K_pick: 'mid' });
  assert.equal(r.tightening.K, +m[4], 'mid of the table\'s lubricated range is the evaluation\'s K');
  assert.equal((r.sections.preload.F_nom_N / 1000).toFixed(1), m[5]);
  assert.equal((r.grade.proofLoadColumn.N / 1000).toFixed(1), m[6]);
  assert.equal(String(r.size.As_mm2), m[7]);
  assert.equal(String(r.grade.proof_MPa), m[8]);
  assert.equal(1 + r.tightening.u, +m[9]);
  assert.equal(Math.round(r.sections.assembly.sigma_MPa), +m[10]);
  assert.equal(r.sections.assembly.sf_proof.toFixed(2), m[11]);
  // And the receipt's own exact values.
  close(r.sections.preload.F_nom_N, 25 / (0.15 * 0.008), 1e-9, 'F = T/(K d)');
  close(r.sections.assembly.sigma_MPa, 711.5209, 1e-3, 'sigma at F_max');
});

test('the dry-run end cap: its own note, rows and numbers are read from the fixture, and the receipt flags it', () => {
  const e = TR.readEndcap(ctx);
  assert.deepEqual([e.size, e.torque_Nm, e.grade, e.lubricated], ['M8', 25, '8.8', true]);
  assert.deepEqual([e.lines.torque, e.lines.bolt_shear, e.lines.thread, e.lines.hole, e.lines.perBolt], [51, 49, 48, 43, 11]);
  assert.equal(e.bolt_shear.check, 'bolt_shear');
  assert.equal(e.Fext_N, 48641 / 8);
  const per = /= ([\d ]+) N per bolt/.exec(e.perBoltText);
  assert.equal(Number(per[1].replace(/ /g, '')), Math.round(e.Fext_N), 'fixture line 11 says 6 080 N per bolt');
  assert.equal(e.stack_mm, 25.4);
  const r = TR.receipt(ctx, TR.endcapInput(ctx));
  assert.equal(r.headline.state, 'over');
  assert.equal(r.sections.assembly.word, 'past yield');
  close(r.sections.preload.ratio_proof, 20833.333 / 21228, 1e-6, 'nominal / proof');
  assert.equal(r.sections.preload.state, 'warn');
  assert.equal(r.sections.service.word, 'upper bound past UTS');
  close(r.sections.service.sigma_MPa, (26041.6667 + 6080.125) / 36.6, 1e-3, 'service stress, C = 1');
  close(r.sections.window.T_mid_Nm, 0.15 * 0.7 * 580 * 36.6 * 0.008, 1e-9, 'torque for 70 % of proof at K 0.15');
  close(r.sections.window.T_cap_Nm, 0.15 * (580 * 36.6 / 1.25) * 0.008, 1e-9, 'torque cap');
  // What PartForge reports today for the same joint, through its own boltShear and GRADE_SY.
  const today = TR.endcapToday(ctx);
  assert.equal(today.sy, 640);
  assert.equal(today.passes, true);
  assert.equal(today.sf.toFixed(2), '2.22');
  // Same torque, dry: the 25 N·m sits where a DRY joint wants it (the table's dry guide is 23.8).
  const sweep = TR.conditionSweep(ctx, TR.endcapInput(ctx));
  const dry = sweep.find((s) => s.key === 'dry');
  close(dry.ratio, 15625 / 21228, 1e-6, 'dry nominal / proof');
  assert.ok(dry.ratio >= 0.65 && dry.ratio <= 0.75, 'dry nominal inside the target band');
  assert.equal(dry.state, 'ok');
  assert.equal(sweep.find((s) => s.key === 'lubricated').state, 'over');
});

test('PartForge\'s own threadCheck vector (tests/flight-eng.test.mjs:246) through the tapped path', () => {
  const r = TR.receipt(ctx, { size: 'M6', grade: '8.8', torque_Nm: 9.79, condition: 'dry', Fext_N: 0, joint: 'tapped', engagement_mm: 9, material: '6061-T6' });
  const tc = r.sections.engagement.tc;
  close(tc.At_mm2, 20.1, 0.1, 'At(M6x1) = 20.1 mm2');
  assert.equal(tc.Le_min_rule_mm, 12);
  assert.equal(tc.ok_rule, false);
  close(tc.F_strip_N, 0.5 * 310 * 0.5 * Math.PI * 6 * 9, 1e-9, 'F_strip = 0.5 su 0.5 pi d Le');
  close(tc.F_bolt_N, tc.At_mm2 * 800, 1e-9, 'F_bolt = At x UTS 800');
  assert.equal(r.sections.engagement.state, 'warn');
  assert.equal(r.sections.engagement.tableMin.mm, 9.5);
  // A screw too short to reach the declared engagement is held to what it reaches.
  const s = TR.receipt(ctx, { size: 'M6', grade: '8.8', torque_Nm: 9.79, condition: 'dry', Fext_N: 0, joint: 'tapped', engagement_mm: 12, material: '6061-T6', screw_len_mm: 20, stack_mm: 10, washer_head: true });
  close(s.sections.engagement.Le_mm, 20 - 10 - 1.6, 1e-9, 'reach = L - stack - washer');
});

test('protrusion: hand-worked M6 stacks against two pitches', () => {
  const base = { size: 'M6', grade: '8.8', torque_Nm: 9.79, condition: 'dry', Fext_N: 0, joint: 'nut', stack_mm: 10, washer_nut: true };
  const p20 = TR.receipt(ctx, { ...base, screw_len_mm: 20 }).sections.protrusion;
  close(p20.protrusion_mm, 3.2, 1e-9, '20 - (10 + 1.6 + 5.2)');
  assert.equal(p20.need_mm, 2);
  assert.equal(p20.state, 'ok');
  close(p20.minLen_mm, 18.8, 1e-9, 'shortest screw that clears two pitches');
  const p18 = TR.receipt(ctx, { ...base, screw_len_mm: 18 }).sections.protrusion;
  assert.equal(p18.state, 'warn');
  close(p18.shortBy_mm, 0.8, 1e-9, 'short by');
  const p16 = TR.receipt(ctx, { ...base, screw_len_mm: 16 }).sections.protrusion;
  close(p16.protrusion_mm, -0.8, 1e-9, '16 mm ends inside the nut');
  assert.equal(p16.state, 'over');
  const both = TR.receipt(ctx, { ...base, screw_len_mm: 20, washer_head: true }).sections.protrusion;
  close(both.protrusion_mm, 1.6, 1e-9, 'a second washer takes 1.6 mm');
  const nyloc = TR.receipt(ctx, { ...base, screw_len_mm: 20, nut: 'nyloc' }).sections.protrusion;
  close(nyloc.protrusion_mm, 20 - 10 - 1.6 - 6.0, 1e-9, 'nylon-insert nut height 6.0');
  assert.equal(nyloc.recallInput, true, 'locknut_h_mm is a recall field and is flagged');
  const un = TR.receipt(ctx, { size: '1/4-20', grade: 'J429-5', torque_Nm: 10, condition: 'dry', Fext_N: 0, joint: 'nut', screw_len_mm: 25.4, stack_mm: 12.7, washer_nut: true }).sections.protrusion;
  close(un.need_mm, 2 * 1.27, 1e-12, 'two pitches of 1/4-20');
  assert.equal(un.recallInput, true, 'the inch nut and washer are recall');
});

test('closed forms and round trips', () => {
  const r = TR.receipt(ctx, { ...M8_25_LUB, Fext_N: 0 });
  close(r.sections.preload.F_max_N / r.sections.preload.F_min_N, 1.25 / 0.75, 1e-12, 'F_max / F_min = (1 + u)/(1 - u)');
  const twice = TR.receipt(ctx, { ...M8_25_LUB, torque_Nm: 50 });
  close(twice.sections.preload.F_nom_N, 2 * r.sections.preload.F_nom_N, 1e-9, 'F proportional to T');
  for (const [size, grade, cond] of [['M8', '8.8', 'lubricated'], ['M5', '12.9', 'dry'], ['M20', '8.8', 'antiseize'], ['1/2-13', 'J429-8', 'moly']]) {
    const w = TR.receipt(ctx, { size, grade, torque_Nm: 1, condition: cond }).sections.window;
    const atMid = TR.receipt(ctx, { size, grade, torque_Nm: w.T_mid_Nm, condition: cond });
    close(atMid.sections.preload.ratio_proof, 0.7, 1e-12, `${size} ${grade}: T_mid lands at 0.70 proof`);
    const atCap = TR.receipt(ctx, { size, grade, torque_Nm: w.T_cap_Nm, condition: cond });
    close(atCap.sections.assembly.sf_proof, 1, 1e-12, `${size} ${grade}: T_cap puts F_max exactly at proof`);
  }
  // K pick: low K means more preload for the same torque.
  const lo = TR.receipt(ctx, { ...M8_25_LUB, K_pick: 'low' }), hi = TR.receipt(ctx, { ...M8_25_LUB, K_pick: 'high' });
  close(lo.sections.preload.F_nom_N, 25 / (0.14 * 0.008), 1e-9, 'K 0.14');
  close(hi.sections.preload.F_nom_N, 25 / (0.16 * 0.008), 1e-9, 'K 0.16');
  // Service with no external load equals assembly.
  close(r.sections.service.sigma_MPa, r.sections.assembly.sigma_MPa, 1e-12, 'F_ext = 0');
});

test('inch: the table\'s own torque example (fasteners_un notes (6)) round-trips, and J429 strengths come from notes (7)', () => {
  const n6 = ctx.un.notes_paragraphs['6'];
  const m = /F = ([\d.]+) x (\d+) ksi x ([\d.]+) = (\d+) lbf, T = ([\d.]+) x (\d+) x ([\d.]+) = (\d+) lbf-in/.exec(n6);
  assert.ok(m, 'notes (6) worked example');
  const [F_lbf, K, D_in] = [+m[4], +m[5], +m[7]];
  close(+m[1] * +m[2] * 1000 * +m[3], F_lbf, 1, '0.75 x 153 ksi x 0.0318 in2 = 3650 lbf (to 1 lbf)');
  const T_lbfin = K * F_lbf * D_in; // 182.5, which the note rounds to 180
  assert.equal(Math.round(T_lbfin / 10) * 10, +m[8]);
  const r = TR.receipt(ctx, { size: '1/4-20', grade: 'declared', declared: { proof_MPa: 900, yield_MPa: 1055, uts_MPa: 1241, source: 'test' }, condition: 'declared', K, K_source: 'notes (6)', lubricated: false, torque_Nm: T_lbfin * TR.NM_PER_LBFIN });
  close(r.sections.preload.F_nom_N / (0.45359237 * 9.80665), F_lbf, 1e-9, 'T = K F d inverted in inch-pounds');
  close(r.sections.preload.T_lbfin, T_lbfin, 1e-9, 'lbf-in readout');
  const g5 = TR.receipt(ctx, { size: '1/4-20', grade: 'J429-5', torque_Nm: 10, condition: 'dry' });
  assert.deepEqual([g5.grade.proof_MPa, g5.grade.yield_MPa, g5.grade.uts_MPa], [586, 634, 827]);
  close(g5.grade.proofLoad_N, 586 * 20.52, 1e-9, 'As 20.52 mm2 from the row');
  const g8 = TR.receipt(ctx, { size: '1/2-13', grade: 'J429-8', torque_Nm: 10, condition: 'dry' });
  assert.deepEqual([g8.grade.proof_MPa, g8.grade.yield_MPa, g8.grade.uts_MPa], [827, 896, 1034]);
  // The notes give ksi too: the MPa in parentheses are the ksi x 6.894757 the notes state.
  close(85 * 6.894757, 586, 0.5, 'grade 5 proof 85 ksi');
});

test('PartForge\'s bolt_shear yields (GRADE_SY, index.html:5804) agree with the tables this tool reads', () => {
  const G = data.code.GRADE_SY;
  for (const g of ['8.8', '10.9', '12.9']) assert.equal(G[g], ctx.metric.grades[g].yield_MPa, `grade ${g}`);
  assert.equal(G['a2-70'], ctx.metric.grades['A2-70'].yield_MPa);
  assert.equal(G['5'], ctx.unGrades['J429-5'].yield_MPa);
  assert.equal(G['8'], ctx.unGrades['J429-8'].yield_MPa);
});

test('refusals are structured and name what would help', () => {
  const feel = TR.receipt(ctx, { ...M8_25_LUB, byFeel: true, Fext_N: 100 });
  assert.equal(feel.sections.preload.status, 'refused');
  assert.equal(feel.sections.assembly.status, 'refused');
  assert.equal(feel.sections.service.status, 'refused');
  assert.equal(feel.sections.window.status, 'computed', 'the torque window survives: it says what to set');
  assert.match(feel.sections.preload.refusal.reason, /no defensible preload at all/);
  assert.equal(feel.headline.state, 'refused');
  const cases = [
    [{ ...M8_25_LUB, torque_Nm: null }, (r) => r.sections.preload.refusal.code === 'insufficient_data'],
    [{ ...M8_25_LUB, torque_Nm: -3 }, (r) => r.sections.preload.refusal.code === 'out_of_envelope'],
    [{ ...M8_25_LUB, torque_Nm: 'abc' }, (r) => r.sections.preload.status === 'refused'],
    [{ ...M8_25_LUB, size: 'M7' }, (r) => !r.ok && r.refusal.code === 'not_found' && /M8/.test(r.refusal.what_would_help)],
    [{ ...M8_25_LUB, grade: '9.8' }, (r) => !r.ok && r.refusal.code === 'not_found'],
    [{ ...M8_25_LUB, grade: '' }, (r) => !r.ok && r.refusal.missing[0] === 'grade'],
    [{ ...M8_25_LUB, size: '#8-32', grade: 'J429-5' }, (r) => !r.ok && /NOT graded to J429/.test(r.refusal.reason)],
    [{ ...M8_25_LUB, size: '1/4-20', grade: 'A574' }, (r) => !r.ok && /recall/.test(r.refusal.reason)],
    [{ ...M8_25_LUB, grade: 'declared', declared: { proof_MPa: 600, yield_MPa: 660, uts_MPa: 830 } }, (r) => !r.ok && r.refusal.missing.includes('source')],
    [{ ...M8_25_LUB, grade: 'declared', declared: { proof_MPa: 700, yield_MPa: 660, uts_MPa: 830, source: 'x' } }, (r) => !r.ok && r.refusal.code === 'out_of_envelope'],
    [{ ...M8_25_LUB, size: '1/4-20', grade: 'J429-5', condition: 'plated' }, (r) => !r.ok && /no zinc-plated K/.test(r.refusal.what_would_help)],
    [{ ...M8_25_LUB, condition: 'declared', K: 0.18 }, (r) => !r.ok && r.refusal.missing.includes('K_source')],
    [{ ...M8_25_LUB, condition: 'declared', K: 0.18, K_source: 'test' }, (r) => !r.ok && r.refusal.missing.includes('lubricated')],
    [{ ...M8_25_LUB }, (r) => r.sections.service.status === 'refused' && /Enter 0/.test(r.sections.service.refusal.reason)],
    [{ ...M8_25_LUB, Fext_N: -5 }, (r) => r.sections.service.refusal.code === 'out_of_envelope'],
    [{ ...M8_25_LUB, size: 'M2', joint: 'nut', nut: 'nyloc', screw_len_mm: 10, stack_mm: 4 }, (r) => r.sections.protrusion.status === 'refused' && /null/.test(r.sections.protrusion.refusal.reason)],
    [{ ...M8_25_LUB, joint: 'nut', stack_mm: 4 }, (r) => r.sections.protrusion.refusal.missing.includes('screw_len_mm')],
    [{ ...M8_25_LUB, joint: 'tapped', engagement_mm: 16, material: 'G10-FR4' }, (r) => r.sections.engagement.refusal.code === 'out_of_envelope'],
    [{ ...M8_25_LUB, joint: 'tapped', material: '6061-T6' }, (r) => r.sections.engagement.refusal.missing.includes('engagement_mm')],
  ];
  cases.forEach(([inp, ok], i) => {
    const r = TR.receipt(ctx, inp);
    assert.ok(ok(r), `refusal case ${i}: ${JSON.stringify(r.refusal || r.sections)}`.slice(0, 400));
  });
  // No refusal ever carries a number in place of the missing input.
  const r = TR.receipt(ctx, { ...M8_25_LUB, torque_Nm: null });
  assert.equal(r.sections.preload.F_nom_N, undefined);
});

test('nothing on a receipt says PASS; stainless dry carries the K caveat', () => {
  const all = [];
  for (const s of TR.sizes(ctx)) {
    const size = TR.findSize(ctx, s.key);
    for (const g of TR.gradesFor(ctx, size)) for (const c of TR.conditionsFor(size)) {
      const r = TR.receipt(ctx, { size: s.key, grade: g.key, torque_Nm: 5, condition: c.key, Fext_N: 100 });
      all.push(JSON.stringify(r.headline || r.refusal) + JSON.stringify(r.notes || ''));
    }
  }
  assert.ok(all.length > 100);
  assert.ok(all.every((t) => !/\bPASS(ED)?\b/.test(t.replace(/never PASS/g, ''))), 'no PASS anywhere');
  const a2 = TR.receipt(ctx, { size: 'M6', grade: 'A2-70', torque_Nm: 5, condition: 'dry' });
  assert.ok(a2.notes.some((n) => /0\.25-0\.35/.test(n) && /LESS preload/.test(n)));
});

test('the README and the page quote the numbers the kernel computes', () => {
  const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  const r = TR.receipt(ctx, TR.endcapInput(ctx));
  const want = [
    TR.fmtN(r.sections.preload.F_nom_N), TR.fmtMPa(r.sections.assembly.sigma_MPa), 'SF ' + r.sections.assembly.sf_proof.toFixed(2),
    TR.fmtNm(r.sections.window.T_mid_Nm), TR.fmtNm(r.sections.window.T_cap_Nm), TR.fmtMPa(r.sections.service.sigma_MPa),
    'SF ' + TR.endcapToday(ctx).sf.toFixed(2),
  ];
  for (const w of want) assert.ok(readme.includes(w), `README says ${w}`);
  const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  for (const s of ['snapshots/fasteners_metric.js', 'snapshots/design_factors_nasa.js', 'snapshots/fasteners_un_excerpt.js', 'snapshots/endcap.js', 'snapshots/partforge-code.js', 'snapshots/evaluation-excerpt.js', 'torque.js', 'app.js']) assert.ok(html.includes(`src="${s}"`), `page loads ${s}`);
});
