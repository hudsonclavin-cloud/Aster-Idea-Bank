// Tests for Stack Ledger. Run from the bank root: node --test ideas/06-stack-ledger/stack.test.mjs
// Node built-ins only. Pins: PartForge's own published dbFit()/dbFitThermal() numbers (tests/flight-db.test.mjs
// :119-160 at 0974a62), fits.json's worked example in its notes, the evaluation's Ø120-180 band
// (docs/roadmap-evaluation.md:746) and its two-±0.05 RSS figure (:668), materials_thermal.json's "about 0.1 mm"
// note, ISO 286's closed forms recomputed by hand from the step means, hand-worked stacks, every refusal,
// the CLI's exit codes, example.txt as a replayable record, and the snapshots' integrity against their
// sidecars and (when the checkout is present) against the repository itself.
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
const S = require(path.join(here, 'snapshots', 'partforge.js'));
const L = require(path.join(here, 'stack.js'));
const E = require(path.join(here, 'examples.js'));
const { extractFitBlock, extractDbData, parseTemplate, STOCK_KEYS } = await import(path.join(here, 'build-data.mjs'));
const ctx = L.create(S, { tables: 'snapshots', commit: S.provenance.commit, verbatim: `${S.verbatim.firstLine}-${S.verbatim.lastLine}` });
const examples = E.build(S);
const REPO = '/home/user/Partforge';
const repoPresent = fs.existsSync(path.join(REPO, 'index.html')) && fs.existsSync(path.join(REPO, '.git'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const snap = (name) => fs.readFileSync(path.join(here, 'snapshots', name));
const sidecar = (name) => JSON.parse(fs.readFileSync(path.join(here, 'snapshots', `${name}.provenance.json`), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const run = (id) => L.stackUp(ctx, E.byId(examples, id).stack);
const stack = (contributors, require_) => L.stackUp(ctx, { gap_name: 't', contributors, require: require_ });
const one = (c) => L.resolve(ctx, c, 0);
const CLI = path.join(here, 'stack-ledger.mjs');
const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: path.resolve(here, '..', '..') });

// ---------------------------------------------------------------------------------------------
// 1. The snapshots are what they say they are.
// ---------------------------------------------------------------------------------------------
test('snapshot: the four whole-file copies match their sidecars byte for byte, from a clean checkout', () => {
  for (const name of ['fits.json', 'materials_thermal.json', 'bulkhead.scad', 'coupler.scad']) {
    const bytes = snap(name), sc = sidecar(name);
    assert.equal(sc.mode, 'copy', `${name} mode`);
    assert.equal(sha256(bytes), sc.sourceSha256, `${name} source sha256`);
    assert.equal(sha256(bytes), sc.writtenSha256, `${name} written sha256`);
    assert.equal(bytes.length, sc.sourceBytes);
    assert.equal(sc.readMatchesCommitted, true, `${name} read from a clean checkout`);
    assert.equal(sc.commit, S.provenance.commit);
  }
});

test('snapshot: the two derived files match their sidecars and the module records every source', () => {
  for (const name of ['stock_excerpt.json', 'partforge.js']) {
    const sc = sidecar(name);
    assert.equal(sc.mode, 'derived', `${name} mode`);
    assert.equal(sha256(snap(name)), sc.writtenSha256, `${name} written sha256`);
    assert.equal(sc.readMatchesCommitted, true);
  }
  assert.equal(sidecar('stock_excerpt.json').path, 'data/tables/stock.json');
  assert.equal(sidecar('stock_excerpt.json').sourceSha256, S.provenance.stock.sha256, 'stock.json sha256 recorded in the module equals the sidecar');
  assert.equal(sidecar('partforge.js').path, 'index.html');
  assert.equal(sidecar('partforge.js').sourceSha256, S.provenance.index_html.sha256, 'index.html sha256 recorded in the module equals the sidecar');
  assert.equal(S.provenance.fits.sourceSha256, sidecar('fits.json').sourceSha256);
  assert.equal(S.provenance.materials_thermal.sourceSha256, sidecar('materials_thermal.json').sourceSha256);
  assert.equal(S.provenance.bulkhead_scad.sourceSha256, sidecar('bulkhead.scad').sourceSha256);
  assert.equal(S.provenance.coupler_scad.sourceSha256, sidecar('coupler.scad').sourceSha256);
  assert.equal(S.provenance.stock.excerptSha256, sha256(snap('stock_excerpt.json')));
  assert.equal(S.provenance.stock.rowsTotal, 192);
  assert.deepEqual(S.provenance.stock.rowsKept, STOCK_KEYS);
  // The verbatim block's recorded sha256 is the sha256 of the text between the markers in the module itself.
  const mod = snap('partforge.js').toString('utf8');
  const a = mod.indexOf('// ---- BEGIN verbatim'), b = mod.indexOf('// ---- END verbatim');
  const text = mod.slice(mod.indexOf('\n', a) + 1, b);
  assert.equal(sha256(text), S.verbatim.sha256);
  assert.deepEqual([S.verbatim.firstLine, S.verbatim.lastLine], [4994, 5024]);
  assert.deepEqual(S.provenance.index_html.verbatimLines, [4994, 5024]);
  assert.ok(/function dbFit\(/.test(text) && /function dbMaterialThermal\(/.test(text) && /function dbFitThermal\(/.test(text));
});

test('snapshot: the module embeds the folder copies exactly', () => {
  assert.deepEqual(S.fits, JSON.parse(snap('fits.json').toString('utf8')));
  assert.deepEqual(S.materialsThermal, JSON.parse(snap('materials_thermal.json').toString('utf8')));
  assert.deepEqual(S.stockExcerpt, JSON.parse(snap('stock_excerpt.json').toString('utf8')));
  assert.equal(S.fits.rows.length, 13);
  assert.equal(S.fits.disputed.length, 5, 'five withheld values');
  assert.ok(S.fits.disputed.every((d) => d.step === '1-3'));
  assert.equal(S.materialsThermal.rows.length, 21);
  for (const r of S.materialsThermal.rows) assert.ok(['likely', 'recall'].includes(r.confidence), `${r.key} ${r.confidence}`);
  assert.deepEqual(S.stockExcerpt.rows.map((r) => r.key), STOCK_KEYS);
  for (const r of S.stockExcerpt.rows) assert.ok(['likely', 'recall'].includes(r.tolerance_confidence) && ['likely', 'recall'].includes(r.confidence), `${r.key} keeps its confidence fields`);
  assert.equal(S.stockExcerpt.notes, JSON.parse(snap('stock_excerpt.json').toString('utf8')).notes);
  for (const [k, file] of [['bulkhead', 'bulkhead.scad'], ['coupler', 'coupler.scad']]) {
    const parsed = parseTemplate(snap(file).toString('utf8'), `tests/templates/${file}`);
    assert.deepEqual(S.templates[k].flight, parsed.flight);
    assert.deepEqual(S.templates[k].header, parsed.header);
    assert.deepEqual(S.templates[k].params, parsed.params);
  }
});

test('snapshot vs checkout: verbatim block, tables and derivation are fresh (skipped without the repo)', { skip: !repoPresent && 'no PartForge checkout at /home/user/Partforge' }, () => {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const block = extractFitBlock(html);
  assert.equal(sha256(block.text), S.verbatim.sha256, 'verbatim text equals the checkout character for character');
  assert.deepEqual([block.firstLine, block.lastLine], [4994, 5024]);
  assert.ok(/^function dbFit\(/m.test(html.split('\n')[4996]), 'dbFit() is defined on index.html line 4997');
  assert.ok(/^function dbFitThermal\(/m.test(html.split('\n')[5017]), 'dbFitThermal() is defined on index.html line 5018');
  for (const [name, rel] of [['fits.json', 'data/tables/fits.json'], ['materials_thermal.json', 'data/tables/materials_thermal.json'], ['bulkhead.scad', 'tests/templates/bulkhead.scad'], ['coupler.scad', 'tests/templates/coupler.scad']]) {
    assert.ok(snap(name).equals(fs.readFileSync(path.join(REPO, rel))), `${name} equals the checkout`);
  }
  const live = JSON.parse(fs.readFileSync(path.join(REPO, 'data/tables/stock.json'), 'utf8'));
  assert.equal(live.rows.length, 192);
  for (const r of S.stockExcerpt.rows) assert.deepEqual(r, live.rows.find((x) => x.key === r.key), `${r.key} verbatim`);
  assert.equal(live.rows.find((x) => x.key === 'bar_6061_i_6.000_ext'), undefined, 'the proposal\'s "_ext twin" of the 6 in bar does not exist');
  const chk = spawnSync(process.execPath, [path.join(here, 'build-data.mjs'), REPO, '--check'], { encoding: 'utf8' });
  assert.equal(chk.status, 0, `build-data.mjs --check: ${chk.stdout}${chk.stderr}`);
});

// ---------------------------------------------------------------------------------------------
// 2. The shipped functions reproduce the numbers PartForge publishes.
// ---------------------------------------------------------------------------------------------
test('dbFit() reproduces PartForge tests/flight-db.test.mjs:119-127 and :160, and fits.json\'s own worked example', () => {
  const a = S.dbFit(50, 'H', 7, 'g', 6);
  assert.equal(a.hole[1].toFixed(3), '50.025');
  assert.equal(a.shaft[0].toFixed(3), '49.975');
  assert.equal(a.shaft[1].toFixed(3), '49.991');
  assert.equal(a.clearance[0].toFixed(3), '0.009');
  assert.equal(a.clearance[1].toFixed(3), '0.050');
  assert.equal(a.step, '30-50 mm');
  assert.ok(/Ø50 H7\/g6 → H7 = 25 µm so the bore is 50.000\/50.025; g6 es = -9 and IT6 = 16 so the shaft is 49.991\/49.975; clearance 0.009 to 0.050 mm/.test(S.fits.notes), 'the worked example is in the table notes');
  assert.deepEqual([S.dbFit(600, 'H', 7, 'g', 6), S.dbFit(50, 'H', 7, 'p', 6), S.dbFit(0, 'H', 7, 'h', 6)], [null, null, null], 'off the table returns nothing rather than a guess');
  const k = S.dbFit(50, 'H', 9, 'k', 9);
  assert.deepEqual(k.shaft.map((x) => x.toFixed(4)), ['50.0000', '50.0620'], "k's deviation is zero outside grades 4 to 7");
});

test('dbFit() reproduces the evaluation\'s Ø120-180 band (roadmap-evaluation.md:746): i 2.52 µm, IT7 40, g6 -14/-39', () => {
  const f = S.dbFit(150, 'H', 7, 'g', 6);
  assert.deepEqual(f.hole.map((x) => x.toFixed(3)), ['150.000', '150.040']);
  assert.deepEqual(f.shaft.map((x) => x.toFixed(3)), ['149.961', '149.986']);
  assert.deepEqual(f.clearance.map((x) => x.toFixed(3)), ['0.014', '0.079']);
  assert.equal(f.it_hole_um, 40);
  assert.equal(f.it_shaft_um, 25);
  assert.equal(f.dev_um, -14);
  assert.equal(S.fits.rows.find((r) => r.from_mm === 120).i_um, 2.522);
});

test('dbFitThermal() reproduces flight-db.test.mjs:148-152 and materials_thermal.json\'s "about 0.1 mm" note (it is 0.078)', () => {
  near(S.dbFitThermal(101.6, '6061-T6', 'G10-FR4', -60).d_mm, -0.0585216, 1e-9, '6061 bore on a G10 plug, 60 K drop');
  const g = S.dbFitThermal(101.6, 'G10-FR4', '6061-T6', -80);
  near(g.d_mm, 0.0780288, 1e-9, 'G10 coupler on a 6061 plug, 40 C pad to -40 C');
  assert.equal(g.confidence, 'recall', 'G10 is a recall row, so the pair is recall');
  assert.ok(/gains about 0\.1 mm of clearance going from a 40 °C pad to −40 °C/.test(S.materialsThermal.notes), 'the note says about 0.1 mm');
  assert.ok(Math.abs(g.d_mm - 0.1) > 0.02, 'the prose rounds: the function gives 0.078, not 0.1');
  assert.equal(Math.abs(S.dbFitThermal(101.6, '6061-T6', '6061-T6', -60).d_mm), 0, 'like for like is exactly zero');
  assert.equal(S.dbFitThermal(50, '6061-T6', 'unobtainium', -60), null);
  assert.equal(S.dbFitThermal(101.6, '304', '6061-T6', -60).confidence, 'likely');
});

test('hand-worked ISO 286 closed forms recomputed from each step mean agree with the snapshot (steps above 3 mm)', () => {
  // ISO 286-1: i = 0.45·∛D + 0.001·D on D = √(from·to); IT5..IT13 = 7, 10, 16, 25, 40, 64, 100, 160, 250 × i;
  // d = -16·D^0.44, e = -11·D^0.41, f = -5.5·D^0.41, g = -2.5·D^0.34, h = 0, k = +0.6·∛D (grades 4-7), n = +5·D^0.34.
  // The standard rounds the larger grades and deviations to round numbers. Measured against this snapshot the
  // closed forms sit within 1.12 µm for IT5-IT8 (held here to ±1.5 µm), within 4.4 % for IT9-IT13 (the largest is
  // IT12 at 6-10 mm, 150 µm against 143.7; held to 5 %), within 1 µm for g, k and n, and within 2.4 % for d, e and f
  // (held to 4 %). The 1-3 mm step is excluded: it is where the standard's table departs from the formulas, which
  // is why fits.json withholds five values there.
  const K = { 5: 7, 6: 10, 7: 16, 8: 25, 9: 40, 10: 64, 11: 100, 12: 160, 13: 250 };
  let checked = 0;
  for (const r of S.fits.rows) {
    const D = Math.sqrt(r.from_mm * r.to_mm);
    near(r.mean_mm, D, 0.0006, `${r.key} mean`);
    const i = 0.45 * Math.cbrt(D) + 0.001 * D;
    near(r.i_um, i, 0.0006, `${r.key} i`);
    if (r.from_mm < 3) continue;
    for (const [g, k] of Object.entries(K)) {
      if (r.it_um[g] == null) continue;
      const want = k * i;
      if (Number(g) <= 8) near(r.it_um[g], want, 1.5, `${r.key} IT${g}`);
      else near(r.it_um[g], want, 0.05 * want, `${r.key} IT${g}`);
      checked++;
    }
    near(r.shaft_es_um.g, -2.5 * D ** 0.34, 1.0, `${r.key} g`);
    near(r.shaft_es_um.k, 0.6 * Math.cbrt(D), 1.0, `${r.key} k`);
    near(r.shaft_es_um.n, 5 * D ** 0.34, 1.0, `${r.key} n`);
    assert.equal(r.shaft_es_um.h, 0);
    near(r.shaft_es_um.d, -16 * D ** 0.44, 0.04 * 16 * D ** 0.44, `${r.key} d`);
    near(r.shaft_es_um.e, -11 * D ** 0.41, 0.04 * 11 * D ** 0.41, `${r.key} e`);
    near(r.shaft_es_um.f, -5.5 * D ** 0.41, 0.04 * 5.5 * D ** 0.41, `${r.key} f`);
  }
  assert.ok(checked >= 100, `checked ${checked} IT values`);
  // Two steps fully by hand, to the digit: 120-180 and 30-50.
  near(0.45 * Math.cbrt(146.969) + 0.146969, 2.522, 0.0006);
  assert.equal(Math.round(16 * 2.522), 40);
  assert.equal(Math.round(10 * 2.522), 25);
  assert.equal(Math.round(-2.5 * 146.969 ** 0.34), -14);
  near(0.45 * Math.cbrt(38.73) + 0.03873, 1.561, 0.0006);
  assert.equal(Math.round(16 * 1.561), 25);
  assert.equal(Math.round(10 * 1.561), 16);
  assert.equal(Math.round(-2.5 * 38.73 ** 0.34), -9);
});

// ---------------------------------------------------------------------------------------------
// 3. Stack arithmetic: closed forms and hand-worked chains.
// ---------------------------------------------------------------------------------------------
test('two ±0.05 contributors: worst case ±0.10, RSS 0.0707 (29 % narrower, N=2 has no basis) — the evaluation\'s figure (:668)', () => {
  const r = run('two-plus-minus');
  assert.equal(r.verdict, 'CLEARS');
  near(r.worst.min, -0.1, 1e-12); near(r.worst.max, 0.1, 1e-12); near(r.worst.nominal, 0, 1e-12);
  near(r.rss.half, 0.05 * Math.SQRT2, 1e-12);
  near(r.rss.half, 0.070711, 1e-6);
  near(r.rss.width_ratio, Math.SQRT1_2, 1e-12);
  assert.equal(r.rss.n, 2);
  assert.equal(r.rss.basis_ok, false);
  near(r.rss.centre, 0, 1e-12);
  const t = L.ledgerText(r);
  assert.ok(t.includes('29% narrower'), t);
  assert.ok(t.includes('no statistical basis below N=4'));
  assert.ok(t.includes('information only'));
  assert.ok(r.flags.some((f) => /the RSS band starts 0\.029 above the worst-case minimum of the same 2 contributors/.test(f)), 'false comfort 0.1 - 0.0707');
});

test('RSS is centred on the mid-limit means, not the nominal: H7/g6 offset is 0.0465 mm at Ø150 and 0.0295 at Ø50', () => {
  const at = (mm) => stack([{ kind: 'fit', name: 'f', size_mm: mm, hole: ['H', 7], shaft: ['g', 6] }], { min_mm: 0 });
  const r150 = at(150), r50 = at(50);
  near(r150.worst.nominal, 0, 1e-12, 'nominal clearance of a fit is zero');
  near(r150.rss.centre, (0.014 + 0.079) / 2, 1e-9);
  near(r150.rss.offset_from_nominal, 0.0465, 1e-9, 'Ø150');
  near(r50.rss.offset_from_nominal, 0.0295, 1e-9, 'Ø50: the evaluation\'s "roughly 0.03 mm" is this one');
  assert.ok(/\+0\.046 from the nominal sum/.test(L.ledgerText(r150)));
});

test('a dir = -1 contributor with asymmetric limits: min and max are taken from the signed band, not from Σ dir·low', () => {
  const r = stack([
    { kind: 'declared', name: 'B', nominal_mm: 10.5, plus_mm: 0.1, minus_mm: 0.2, tol_src: 'user', tol_ref: 't', dir: 1 },
    { kind: 'declared', name: 'A', nominal_mm: 10.0, plus_mm: 0.3, minus_mm: 0.1, tol_src: 'user', tol_ref: 't', dir: -1 },
  ], { min_mm: 0 });
  near(r.worst.min, 10.3 - 10.3, 1e-12, 'min = B_low - A_high');
  near(r.worst.max, 10.6 - 9.9, 1e-12, 'max = B_high - A_low');
  near(r.worst.nominal, 0.5, 1e-12);
  assert.notEqual(Math.abs(r.worst.min - (10.3 - 9.9)) < 1e-9, true, 'the naive Σ dir·low would give 0.4');
  const A = r.contributors[1];
  near(A.signed.low, -10.3, 1e-12); near(A.signed.high, -9.9, 1e-12); near(A.signed.mid, -10.1, 1e-12); near(A.signed.half, 0.2, 1e-12);
  near(r.rss.centre, 10.45 - 10.1, 1e-12, 'centre is the sum of signed mids, 0.35, not the nominal 0.5');
});

test('bulkhead in coupler, declarations supplied: -0.030 / 0.170 worst case, FAIL on the anodise; bare it clears at 20 C', () => {
  const r = run('bulkhead-declared');
  assert.equal(r.verdict, 'FAIL');
  near(r.worst.min, 146.27 - 146.25 - 0.05, 1e-9);
  near(r.worst.max, 146.33 - 146.15 - 0.01, 1e-9);
  near(r.worst.nominal, 0.1, 1e-9);
  near(r.rss.centre, 0.1 - 0.03, 1e-9);
  near(r.rss.half, Math.sqrt(0.03 ** 2 + 0.05 ** 2 + 0.02 ** 2), 1e-12);
  near(r.rss.low, 0.07 - 0.0616441, 1e-6);
  assert.equal(r.rss.n, 3);
  assert.equal(r.thermal, null);
  assert.ok(/minimum gap -0\.030 is 0\.030 below the required minimum 0\.000/.test(r.verdict_reasons[0]));
  assert.ok(r.flags.some((f) => /false comfort/.test(f)));
  assert.ok(r.flags.some((f) => /tool default/.test(f)), 'the template\'s bulkhead OD is tol_src default');
  near(r.margins.to_min, -0.03, 1e-9);
  const bare = L.stackUp(ctx, { ...E.byId(examples, 'bulkhead-declared').stack, contributors: E.byId(examples, 'bulkhead-declared').stack.contributors.filter((c) => c.kind !== 'coating') });
  assert.equal(bare.verdict, 'CLEARS', 'a screening verdict, never PASS');
  near(bare.worst.min, 0.02, 1e-9);
  assert.ok(bare.verdict_reasons.some((x) => /screening only, not a pass/.test(x)));
  assert.ok(bare.verdict_reasons.some((x) => /rests on 1 tool default \(bulkhead OD/.test(x)), 'the CLEARS names the tool default it rests on (evaluation :752)');
});

test('the bare bulkhead clears only for a coupler hoop CTE of 16.8-25.9 um/m/K: the window the example states, through the shipped dbFitThermal()', () => {
  const ex = E.byId(examples, 'bulkhead-declared');
  const bareWith = (alpha) => L.stackUp(ctx, { ...ex.stack, contributors: [...ex.stack.contributors.filter((c) => c.kind !== 'coating'),
    { kind: 'thermal', name: 't', D_mm: 146.2, hole_mat: 'Fiberglass-laminate', shaft_mat: '6061-T6', dT_K: [-60, 20], hoop_cte: { hole: { cte_um_m_K: alpha, src: 'test' } } }] });
  // Closed form: 0.020 + (a - 23.6)e-6 x 146.2 x dT >= 0 at dT = +20 and at dT = -60.
  const lo = 23.6 - 0.02 / (146.2e-6 * 20), hi = 23.6 + 0.02 / (146.2e-6 * 60);
  near(lo, 16.76005, 1e-5); near(hi, 25.87998, 1e-5);
  for (const [a, min] of [[10, -0.0198], [14, -0.0081], [22, 0.0153], [30, -0.0361]]) near(bareWith(a).worst.min, min, 1e-4, `hoop CTE ${a}`);
  assert.equal(bareWith(16.7).verdict, 'FAIL'); assert.equal(bareWith(16.8).verdict, 'CLEARS');
  assert.equal(bareWith(25.8).verdict, 'CLEARS'); assert.equal(bareWith(25.9).verdict, 'FAIL');
  assert.ok(ex.why.includes('between 16.8 and 25.9 um/m/K') && /clears only at 20 C/.test(ex.why) && ex.why.includes('minimum is 0.020 mm'), ex.why);
});

test('6061 plug in a 304 bore, H7/g6 at 101.6: the hot pad closes the fit\'s 0.012 minimum, worst case -0.0008, FAIL', () => {
  const r = run('plug-in-steel-bore');
  const fit = r.contributors[0], th = r.contributors[1];
  near(fit.low, 0.012, 1e-9); near(fit.high, 0.069, 1e-9);
  assert.equal(fit.detail.it_hole_um, 35); assert.equal(fit.detail.it_shaft_um, 22); assert.equal(fit.detail.dev_um, -12);
  const perK = (17.3 - 23.6) * 1e-6 * 101.6;
  near(th.detail.at_low, perK * -60, 1e-12, 'at -60 K');
  near(th.detail.at_high, perK * 20, 1e-12, 'at +20 K');
  near(th.low, -0.0128016, 1e-9); near(th.high, 0.0384048, 1e-9);
  assert.equal(th.confidence, 'likely');
  near(r.worst.min, 0.012 - 0.0128016, 1e-9);
  near(r.worst.max, 0.069 + 0.0384048, 1e-9);
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.rss.n, 1, 'the thermal term is not in the RSS');
  near(r.thermal.low, th.low, 1e-12); near(r.thermal.high, th.high, 1e-12);
  assert.ok(th.flags.some((f) => /deterministic, not a tolerance/.test(f)));
  // N=1: the RSS band is the fit's own band, so there is no narrowing and no false comfort; the 0.0128 between the RSS
  // low and the worst-case minimum is the thermal shift, which the envelope puts back like for like.
  near(r.rss.low, r.rss.mfg_worst.min, 1e-12); near(r.rss.width_ratio, 1, 1e-12);
  assert.ok(!r.flags.some((f) => /false comfort/.test(f)), r.flags.join(' | '));
  near(r.rss.envelope.low, r.worst.min, 1e-12); near(r.rss.envelope.high, r.worst.max, 1e-12);
  assert.ok(/plus the thermal shift at both ends, to set beside the worst case: -0\.001 \.\. 0\.107/.test(L.ledgerText(r)));
});

test('false comfort compares RSS with the worst case of the same contributors; the thermal shift is never counted as narrowing', () => {
  const two = [
    { kind: 'declared', name: 'a', nominal_mm: 1, tol_mm: 0.05, tol_src: 'user', tol_ref: 't', dir: 1 },
    { kind: 'declared', name: 'b', nominal_mm: 0, tol_mm: 0.05, tol_src: 'user', tol_ref: 't', dir: 1 },
  ];
  const th = { kind: 'thermal', name: 't', D_mm: 101.6, hole_mat: '304', shaft_mat: '6061-T6', dT_K: [-60, 20] };
  const a = stack(two, { min_mm: 0 }), b = stack([...two, th], { min_mm: 0 });
  near(b.rss.low - b.rss.mfg_worst.min, 0.1 - 0.05 * Math.SQRT2, 1e-12, 'the same 0.029 with and without the thermal term');
  near(b.worst.min - a.worst.min, -0.0128016, 1e-9, 'the thermal term moves the worst case');
  near(b.rss.envelope.low, b.rss.low - 0.0128016, 1e-9); near(b.rss.envelope.high, b.rss.high + 0.0384048, 1e-9);
  const fc = (r) => r.flags.find((f) => /false comfort/.test(f));
  assert.equal(fc(a), fc(b), 'identical note: 0.029, not 0.029 + 0.013');
  // every thermal-only stack: no note at all
  for (const id of ['plug-in-steel-bore', 'motor-tube-in-ring']) assert.ok(!run(id).flags.some((f) => /false comfort/.test(f)), id);
});

test('bar as pin: fits.json H7 hole over the as-supplied bar_6061_i_0.250 row, asymmetric, FAIL both ways', () => {
  const r = run('bar-as-pin');
  const hole = r.contributors[0], bar = r.contributors[1], th = r.contributors[2];
  near(hole.low, 6.35, 1e-9); near(hole.high, 6.365, 1e-9); assert.equal(hole.detail.it_um, 15);
  near(bar.low, 6.274, 1e-9); near(bar.high, 6.388, 1e-9); near(bar.nominal, 6.35, 1e-9);
  assert.equal(bar.detail.tol_plus_mm, 0.038); assert.equal(bar.detail.tol_minus_mm, 0.076);
  assert.equal(bar.confidence, 'likely');
  assert.equal(bar.provenance.tol_src, 'table');
  near(r.worst.min, 6.35 - 6.388, 1e-9); near(r.worst.max, 6.365 - 6.274, 1e-9);
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.verdict_reasons.length, 2);
  assert.ok(th.low === 0 && th.high === 0 && !Object.is(th.low, -0), 'like for like is exactly +0, not -0');
  assert.ok(th.flags.some((f) => /temperature-neutral/.test(f)));
  assert.ok(bar.flags.some((f) => /every diameter, face and bore that matters gets machined/.test(f)));
});

test('motor tube in a centring ring, H8/f7 at 54: CLEARS, like-for-like thermal exactly zero, RSS at N=1', () => {
  const r = run('motor-tube-in-ring');
  assert.equal(r.verdict, 'CLEARS');
  near(r.worst.min, 0.030, 1e-9); near(r.worst.max, 0.106, 1e-9);
  assert.equal(r.contributors[0].detail.it_hole_um, 46); assert.equal(r.contributors[0].detail.it_shaft_um, 30); assert.equal(r.contributors[0].detail.dev_um, -30);
  assert.equal(r.rss.n, 1); assert.equal(r.rss.basis_ok, false);
  near(r.thermal.low, 0, 0); near(r.thermal.high, 0, 0);
  near(r.margins.to_min, 0.01, 1e-9); near(r.margins.to_max, 0.044, 1e-9);
});

test('the RSS set is the manufacturing kinds only; thermal is deterministic and kept out', () => {
  assert.deepEqual(L.MFG_KINDS, ['declared', 'fit', 'iso', 'stock', 'coating']);
  assert.ok(!L.MFG_KINDS.includes('thermal'));
  const r = stack([
    { kind: 'declared', name: 'a', nominal_mm: 1, tol_mm: 0.1, tol_src: 'user', tol_ref: 't', dir: 1 },
    { kind: 'thermal', name: 't', D_mm: 100, hole_mat: '304', shaft_mat: '6061-T6', dT_K: [-60, 20] },
  ], { min_mm: 0 });
  assert.equal(r.rss.n, 1);
  near(r.rss.half, 0.1, 1e-12);
  assert.ok(r.thermal && r.thermal.low < 0 && r.thermal.high > 0);
  near(r.worst.min, 0.9 + r.thermal.low, 1e-12);
});

// ---------------------------------------------------------------------------------------------
// 4. Refusals: what the tables refuse, the kernel refuses, with the table's reasons.
// ---------------------------------------------------------------------------------------------
test('fit refusals: sizes off the table, interference letters, js, non-H holes, withheld and absent grades', () => {
  const fit = (mm, h, s, extra) => one({ kind: 'fit', name: 'f', size_mm: mm, hole: h, shaft: s, ...extra });
  assert.equal(fit(600, ['H', 7], ['g', 6]).refused.code, 'off_table');
  assert.ok(/500 mm/.test(fit(600, ['H', 7], ['g', 6]).refused.reason));
  assert.equal(fit(500.001, ['H', 7], ['g', 6]).refused.code, 'off_table');
  assert.equal(fit(500, ['H', 7], ['g', 6]).refused, null, '500 exactly is the last step');
  assert.equal(fit(1, ['H', 7], ['g', 6]).refused.code, 'off_table', 'the 1-3 step is exclusive at 1');
  assert.equal(fit(1.0001, ['H', 7], ['g', 6]).refused, null);
  for (const l of ['p', 'r', 's', 't', 'u']) {
    const r = fit(50, ['H', 7], [l, 6]);
    assert.equal(r.refused.code, 'letter_not_in_table', l);
    assert.ok(/delta rule/.test(r.refused.reason), l);
  }
  const js = fit(50, ['H', 7], ['js', 6]);
  assert.equal(js.refused.code, 'letter_not_in_table');
  assert.ok(/IT6\/2 = 0\.0080 mm/.test(js.refused.what_would_help), js.refused.what_would_help);
  assert.equal(fit(50, ['H', 7], ['a', 7]).refused.code, 'letter_not_in_table');
  assert.equal(fit(50, ['G', 7], ['g', 6]).refused.code, 'hole_letter');
  for (const g of [9, 10, 11, 12]) {
    const r = fit(2, ['H', g], ['g', g]);
    assert.equal(r.refused.code, 'withheld', `IT${g} at 1-3`);
    assert.ok(/formula gives/.test(r.refused.reason), r.refused.reason);
  }
  assert.ok(/formula gives 22 um, the published table gives 25 um/.test(fit(2, ['H', 9], ['g', 9]).refused.reason));
  const n = fit(2, ['H', 7], ['n', 6]);
  assert.equal(n.refused.code, 'withheld');
  assert.ok(/shaft n|n deviation/.test(n.refused.reason));
  assert.equal(fit(2, ['H', 7], ['g', 6]).refused, null, 'IT7/IT6 at 1-3 are carried');
  assert.equal(fit(50, ['H', 4], ['g', 4]).refused.code, 'grade_not_in_table');
  assert.equal(fit(50, ['H', 14], ['g', 14]).refused.code, 'grade_not_in_table');
  const k9 = fit(50, ['H', 9], ['k', 9]);
  assert.equal(k9.refused, null);
  assert.ok(k9.flags.some((f) => /deviation is zero at grade 9/.test(f)));
  assert.deepEqual(k9.detail.shaft.map((x) => x.toFixed(4)), ['50.0000', '50.0620']);
  assert.equal(fit(50, ['H', 7], 'g6').refused.code, 'invalid_input');
  assert.equal(fit(-5, ['H', 7], ['g', 6]).refused.code, 'invalid_input');
  const tr = fit(25, ['H', 7], ['n', 6]);
  assert.ok(tr.detail.transition && tr.low < 0 && tr.flags.some((f) => /transition fit/.test(f)), 'H7/n6 crosses zero');
});

test('iso (single feature) refusals and limits', () => {
  const iso = (c) => one({ kind: 'iso', name: 'i', dir: 1, ...c });
  const h = iso({ size_mm: 6.35, feature: 'hole', letter: 'H', grade: 7 });
  near(h.low, 6.35, 1e-9); near(h.high, 6.365, 1e-9); near(h.nominal, 6.35, 1e-9);
  const s = iso({ size_mm: 50, feature: 'shaft', letter: 'g', grade: 6 });
  near(s.low, 49.975, 1e-9); near(s.high, 49.991, 1e-9); assert.equal(s.detail.dev_um, -9);
  assert.equal(iso({ size_mm: 50, feature: 'hole', letter: 'G', grade: 7 }).refused.code, 'hole_letter');
  assert.equal(iso({ size_mm: 50, feature: 'shaft', letter: 'p', grade: 6 }).refused.code, 'letter_not_in_table');
  assert.equal(iso({ size_mm: 50, feature: 'bore', letter: 'H', grade: 7 }).refused.code, 'invalid_input');
  assert.equal(iso({ size_mm: 2, feature: 'hole', letter: 'H', grade: 11 }).refused.code, 'withheld');
  assert.equal(iso({ size_mm: 50, feature: 'hole', letter: 'H', grade: 7.5 }).refused.code, 'invalid_input');
});

test('thermal refusals: every placeholder CTE (laminates, polymers, graphite) as hole or shaft, until a hoop CTE with a source is supplied', () => {
  const rows = S.materialsThermal.rows;
  // What the table itself says: LIMITS (1) calls the laminate and polymer values placeholders, verbatim.
  assert.ok(S.materialsThermal.notes.includes(L.LIMITS_1), 'LIMITS (1) is quoted verbatim');
  assert.ok(/For laminates this is the in-plane or along-fibre value/.test(S.materialsThermal.columns.cte_um_m_K));
  // The accepted rows are exactly the eleven PartForge's own tests/flight-db.test.mjs:143 treats as metals ...
  const METALS = /6061|7075|2024|304|316|4130|Ti-6Al|brass|copper|Inconel|17-4/;
  const accepted = rows.filter((r) => !L.PLACEHOLDER_CTE_KEYS.includes(r.key)).map((r) => r.key);
  assert.deepEqual(accepted, rows.filter((r) => METALS.test(r.key)).map((r) => r.key));
  assert.equal(accepted.length, 11);
  assert.equal(L.PLACEHOLDER_CTE_KEYS.length, 10);
  for (const k of L.PLACEHOLDER_CTE_KEYS) assert.ok(rows.some((r) => r.key === k), `${k} is a row`);
  // ... and every row :146 says "depends on layup or print direction" is refused, Nylon and Ultem included.
  for (const r of rows.filter((x) => /CF-|G10|Fiberglass|Phenolic|Nylon|Ultem/.test(x.key))) assert.ok(L.PLACEHOLDER_CTE_KEYS.includes(r.key), r.key);
  // Each refused row's own note names a direction (laminates, printed parts, graphite) or the row is a polymer under LIMITS (1).
  for (const [key, group] of Object.entries(L.PLACEHOLDER_CTE)) {
    const row = rows.find((r) => r.key === key);
    if (group === 'laminate') assert.ok(/IN-PLANE|ALONG THE FIBRES|Hoop and axial α differ|Never machine a fit/.test(row.note), `${key}: ${row.note}`);
    if (group === 'print') assert.ok(/print/.test(row.note), `${key}: ${row.note}`);
    if (group === 'grain') assert.ok(/grain direction/.test(row.note), `${key}: ${row.note}`);
    if (group === 'polymer') assert.ok(['PEEK', 'PA12-SLS', 'Delrin-POM'].includes(key));
    assert.equal(row.confidence, 'recall', `${key} is a recall row`);
    for (const side of ['hole', 'shaft']) {
      const c = { kind: 'thermal', name: 't', D_mm: 100, hole_mat: side === 'hole' ? key : '6061-T6', shaft_mat: side === 'shaft' ? key : '6061-T6', dT_K: [-60, 20] };
      const r = one(c);
      assert.equal(r.refused && r.refused.code, 'cte_placeholder', `${key} as ${side}`);
      if (row.note) assert.ok(r.refused.reason.includes(row.note), 'the refusal quotes the row note');
      if (group !== 'grain') assert.ok(r.refused.reason.includes(L.LIMITS_1), 'and LIMITS (1)');
      assert.ok(new RegExp(`hoop_cte\\.${side}`).test(r.refused.what_would_help));
    }
  }
  const ov = one({ kind: 'thermal', name: 't', D_mm: 146.2, hole_mat: 'Fiberglass-laminate', shaft_mat: '6061-T6', dT_K: [-60, 20], hoop_cte: { hole: { cte_um_m_K: 22, src: 'test data sheet' } } });
  assert.equal(ov.refused, null);
  assert.equal(ov.confidence, 'user');
  near(ov.detail.at_low, (22 - 23.6) * 1e-6 * 146.2 * -60, 1e-12, 'the shipped formula runs on the user value');
  assert.ok(ov.flags.some((f) => /hole hoop CTE supplied by the user \(22 um\/m\/K\): test data sheet/.test(f)));
  assert.ok(/Fiberglass-laminate \(overridden by the user hoop CTE\), 6061-T6 \[likely\]/.test(ov.provenance.text), ov.provenance.text);
  const nylon = one({ kind: 'thermal', name: 't', D_mm: 20, hole_mat: 'CF-Nylon', shaft_mat: '6061-T6', dT_K: [-60, 20], hoop_cte: { hole: { cte_um_m_K: 30, src: 'measured across the beads' } } });
  assert.equal(nylon.refused, null, 'the override lifts a printed row too');
  assert.equal(one({ kind: 'thermal', name: 't', D_mm: 146.2, hole_mat: 'Fiberglass-laminate', shaft_mat: '6061-T6', dT_K: [-60, 20], hoop_cte: { hole: { cte_um_m_K: 22 } } }).refused.code, 'invalid_input', 'no src, no override');
  assert.equal(one({ kind: 'thermal', name: 't', D_mm: 100, hole_mat: 'unobtainium', shaft_mat: '6061-T6', dT_K: -60 }).refused.code, 'unknown_material');
  assert.ok(one({ kind: 'thermal', name: 't', D_mm: 100, hole_mat: 'unobtainium', shaft_mat: '6061-T6', dT_K: -60 }).refused.what_would_help.includes('Ti-6Al-4V'));
  assert.equal(one({ kind: 'thermal', name: 't', D_mm: 0, hole_mat: '304', shaft_mat: '6061-T6', dT_K: -60 }).refused.code, 'invalid_input');
  assert.equal(one({ kind: 'thermal', name: 't', D_mm: 100, hole_mat: '304', shaft_mat: '6061-T6', dT_K: 'cold' }).refused.code, 'invalid_input');
  const single = one({ kind: 'thermal', name: 't', D_mm: 101.6, hole_mat: '304', shaft_mat: '6061-T6', dT_K: -60 });
  near(single.low, single.high, 0, 'a single dT is a shift, not a band');
  near(single.low, (17.3 - 23.6) * 1e-6 * 101.6 * -60, 1e-12);
  assert.ok(single.flags.some((f) => /range excludes dT = 0/.test(f)));
  const brass = one({ kind: 'thermal', name: 't', D_mm: 20, hole_mat: 'C360-brass', shaft_mat: '6061-T6', dT_K: [-60, 20] });
  assert.equal(brass.confidence, 'recall');
  assert.ok(brass.flags.some((f) => /recall row\(s\): C360-brass/.test(f)));
  assert.equal(one({ kind: 'thermal', name: 't', D_mm: 20, hole_mat: '304', shaft_mat: '6061-T6', dT_K: [-60, 20], dir: 2 }).refused.code, 'invalid_input');
});

test('a hoop CTE override on one side does not hide a recall row on the other: the weaker side decides the confidence', () => {
  const ov = { hole: { cte_um_m_K: 20, src: 'data sheet X' } };
  const onBrass = one({ kind: 'thermal', name: 't', D_mm: 50, hole_mat: 'G10-FR4', shaft_mat: 'C360-brass', dT_K: [-60, 20], hoop_cte: ov });
  assert.equal(onBrass.confidence, 'recall');
  assert.ok(onBrass.flags.some((f) => /recall row\(s\): C360-brass - not cited/.test(f)), onBrass.flags.join(' | '));
  const r = stack([{ kind: 'declared', name: 'gap', nominal_mm: 0.2, tol_mm: 0.01, tol_src: 'user', tol_ref: 'm', dir: 1 },
    { kind: 'thermal', name: 'G10 on brass', D_mm: 50, hole_mat: 'G10-FR4', shaft_mat: 'C360-brass', dT_K: [-60, 20], hoop_cte: ov }], { min_mm: 0 });
  assert.ok(r.flags.some((f) => /1 contributor rests on recall rows \(G10 on brass\)/.test(f)), 'counted in the global recall note');
  assert.ok(r.verdict_reasons.some((x) => /rests on 1 recall row/.test(x)));
  const on6061 = one({ kind: 'thermal', name: 't', D_mm: 50, hole_mat: 'G10-FR4', shaft_mat: '6061-T6', dT_K: [-60, 20], hoop_cte: ov });
  assert.equal(on6061.confidence, 'user', 'a likely row and a user value print as user');
});

test('no ISO fit class on a composite or phenolic tube: fits.json LIMITS (5) and the doctrine (index.html:1454), whatever the CTE', () => {
  assert.deepEqual(L.COMPOSITE_TUBE_KEYS, ['G10-FR4', 'CF-laminate', 'Fiberglass-laminate', 'Phenolic']);
  assert.ok(/THESE ARE FOR MACHINED METAL\. A composite or phenolic tube is not round, not constant, and not to an IT grade/.test(S.fits.notes));
  const g10 = E.byId(examples, 'plug-in-g10-coupler').stack;
  assert.deepEqual(run('plug-in-g10-coupler').refusals.map((x) => x.code), ['fit_on_composite', 'cte_placeholder']);
  const withHoop = JSON.parse(JSON.stringify(g10));
  withHoop.contributors[1].hoop_cte = { hole: { cte_um_m_K: 14, src: 'ILLUSTRATIVE' } };
  const r1 = L.stackUp(ctx, withHoop);
  assert.deepEqual(r1.refusals.map((x) => x.code), ['fit_on_composite'], 'the hoop CTE lifts the thermal refusal, not the fit one');
  assert.ok(/do not use a fit class at all/.test(r1.refusals[0].reason) && /three clockings/.test(r1.refusals[0].what_would_help));
  assert.equal(r1.contributors[1].refused, null);
  // The honest form: the coupler bore measured, the metal plug an ISO g6 shaft. It evaluates.
  const measured = { ...withHoop, contributors: [
    { kind: 'declared', name: 'G10 coupler ID, measured', nominal_mm: 101.7, tol_mm: 0.04, tol_src: 'user', tol_ref: 'three clockings', dir: 1 },
    { kind: 'iso', name: 'plug g6', size_mm: 101.6, feature: 'shaft', letter: 'g', grade: 6, dir: -1 },
    withHoop.contributors[1]] };
  const r2 = L.stackUp(ctx, measured);
  assert.equal(r2.refusals.length, 0, JSON.stringify(r2.refusals));
  assert.ok(r2.evaluable && ['CLEARS', 'FAIL'].includes(r2.verdict));
  // A composite shaft refuses an iso shaft and a fit, not an iso hole; a non-composite pair refuses nothing.
  const sh = (c) => stack([c, { kind: 'thermal', name: 't', D_mm: 50, hole_mat: '6061-T6', shaft_mat: 'Phenolic', dT_K: [-60, 20], hoop_cte: { shaft: { cte_um_m_K: 30, src: 's' } } }], { min_mm: 0 });
  assert.equal(sh({ kind: 'iso', name: 'h', size_mm: 50, feature: 'shaft', letter: 'g', grade: 6, dir: -1 }).refusals[0].code, 'fit_on_composite');
  assert.equal(sh({ kind: 'fit', name: 'f', size_mm: 50, hole: ['H', 7], shaft: ['g', 6] }).refusals[0].code, 'fit_on_composite');
  assert.equal(sh({ kind: 'iso', name: 'h', size_mm: 50, feature: 'hole', letter: 'H', grade: 7, dir: 1 }).refusals.length, 0);
  assert.equal(stack([{ kind: 'fit', name: 'f', size_mm: 101.6, hole: ['H', 7], shaft: ['g', 6] }, { kind: 'thermal', name: 't', D_mm: 101.6, hole_mat: '304', shaft_mat: '6061-T6', dT_K: [-60, 20] }], { min_mm: 0 }).refusals.length, 0);
});

test('stock refusals: recall rows claimed as source, unknown rows, wrong surfaces; limits read as the table gives them', () => {
  const st = (c) => one({ kind: 'stock', name: 's', dir: -1, ...c });
  const rec = st({ key: 'bar_6061_i_6.000', surface: 'od', tol_src: 'source', tol_ref: 'ASTM B221' });
  assert.equal(rec.refused.code, 'recall_as_source');
  assert.ok(/never presented|cannot be presented as a cited source/.test(rec.refused.reason));
  const recOk = st({ key: 'bar_6061_i_6.000', surface: 'od' });
  assert.equal(recOk.refused, null);
  assert.equal(recOk.confidence, 'recall');
  near(recOk.low, 151.282, 1e-9); near(recOk.high, 153.518, 1e-9);
  assert.ok(recOk.flags.some((f) => /recall row: not cited/.test(f)));
  assert.ok(recOk.flags.some((f) => /disputed tolerance: compiled \+\/-0\.044 in vs alternative \+\/-0\.034 in/.test(f)));
  const lk = st({ key: 'bar_6061_i_0.250', surface: 'od', tol_src: 'source', tol_ref: 'mill cert 123' });
  assert.equal(lk.refused, null); assert.equal(lk.provenance.tol_src, 'source'); assert.equal(lk.confidence, 'likely');
  const lkNoRef = st({ key: 'bar_6061_i_0.250', surface: 'od', tol_src: 'source' });
  assert.equal(lkNoRef.provenance.tol_src, 'table');
  assert.ok(lkNoRef.flags.some((f) => /demoted/.test(f)));
  const unk = st({ key: 'bar_7075_i_1.000', surface: 'od' });
  assert.equal(unk.refused.code, 'unknown_stock_row');
  assert.ok(unk.refused.what_would_help.includes('tube_6061_i_6.000x0.125_ext') && /--repo/.test(unk.refused.what_would_help));
  assert.equal(st({ key: 'bar_6061_i_0.250', surface: 'id' }).refused.code, 'stock_surface');
  assert.equal(st({ key: 'plate_6061_i_0.500', surface: 'od' }).refused.code, 'stock_surface');
  assert.equal(st({ key: 'tube_6061_i_6.000x0.125', surface: 'thickness' }).refused.code, 'stock_surface');
  const pl = st({ key: 'plate_6061_i_0.500', surface: 'thickness' });
  near(pl.low, 12.065, 1e-9); near(pl.high, 13.335, 1e-9); assert.equal(pl.confidence, 'likely');
  const id = st({ key: 'tube_6061_i_6.000x0.125', surface: 'id' });
  near(id.low, 145.058, 1e-9); near(id.high, 147.042, 1e-9); near(id.nominal, 146.05, 1e-9);
  assert.ok(id.flags.some((f) => /\+\/-0\.712 mm from nominal \(ovality_individual_dia_tol_mm\)/.test(f)));
  const od = st({ key: 'tube_6061_i_6.000x0.125', surface: 'od' });
  near(od.low, 152.044, 1e-9); near(od.high, 152.756, 1e-9);
  const ext = st({ key: 'tube_6061_i_6.000x0.125_ext', surface: 'id' });
  assert.equal(ext.confidence, 'recall'); near(ext.low, 144.525, 1e-9); near(ext.high, 147.575, 1e-9);
  assert.equal(run('stock-recall-as-source').verdict, 'REFUSED');
  // The row-level half of the guard: a row whose own confidence is recall stays uncitable even when its tolerance
  // column says likely (the doctrine at index.html:1454 never cites a recall line).
  const tubeRow = S.stockExcerpt.rows.find((r) => r.key === 'tube_6061_i_6.000x0.125');
  assert.deepEqual([tubeRow.confidence, tubeRow.tolerance_confidence], ['recall', 'likely']);
  const rowOnly = st({ key: 'tube_6061_i_6.000x0.125', surface: 'id', tol_src: 'source', tol_ref: 'ASTM B210', dir: 1 });
  assert.equal(rowOnly.refused && rowOnly.refused.code, 'recall_as_source');
  assert.ok(/row confidence "recall"/.test(rowOnly.refused.reason));
});

test('stock over the app\'s embedded projection (no tolerance_confidence, id_nominal_mm, ovality, disputed detail): degrades with notes, never silently', () => {
  // The four columns tools/db/embed.mjs:83 does not carry, and its disputed -> true (:84), applied to the excerpt.
  const project = (r) => { const x = { ...r }; for (const k of ['tolerance_confidence', 'tolerance_note', 'id_nominal_mm', 'ovality_individual_dia_tol_mm']) delete x[k]; if (x.disputed) x.disputed = true; return x; };
  S.useTables({ stock: { ...S.stockExcerpt, rows: S.stockExcerpt.rows.map(project) } });
  try {
    const st = (c) => one({ kind: 'stock', name: 's', dir: -1, ...c });
    const id = st({ key: 'tube_6061_i_6.000x0.125', surface: 'id' });
    assert.equal(id.refused, null);
    near(id.low, 145.058, 1e-9); near(id.high, 147.042, 1e-9); near(id.nominal, 146.05, 1e-9);
    assert.ok(id.flags.some((f) => /no id_nominal_mm: nominal ID taken as dim_mm - 2 x wall_mm = 146\.050/.test(f)));
    assert.ok(id.flags.some((f) => /no ovality_individual_dia_tol_mm/.test(f)) && !id.flags.some((f) => /\+\/--/.test(f)), 'no "+/--" from a missing number');
    assert.ok(id.flags.some((f) => /no tolerance_confidence .* the row confidence "recall" prints/.test(f)));
    assert.equal(id.confidence, 'recall', 'falls back to the row confidence, which at 0974a62 is never stronger than the tolerance\'s');
    const bar = st({ key: 'bar_6061_i_6.000', surface: 'od' });
    assert.ok(bar.flags.some((f) => /disputed tolerance: this copy of the table keeps only the flag/.test(f)));
    assert.equal(st({ key: 'bar_6061_i_6.000', surface: 'od', tol_src: 'source', tol_ref: 'ASTM B221' }).refused.code, 'recall_as_source');
    assert.equal(st({ key: 'tube_6061_i_6.000x0.125', surface: 'id', tol_src: 'source', tol_ref: 'ASTM B210' }).refused.code, 'recall_as_source');
    const r = run('bar-as-pin');
    near(r.worst.min, -0.038, 1e-9); near(r.worst.max, 0.091, 1e-9); assert.equal(r.verdict, 'FAIL');
  } finally {
    S.useTables(null);
  }
});

test('coating refusals: no value, zero, negative; ranges reorder; surfaces 1 or 2; closes the gap by default', () => {
  const co = (c) => one({ kind: 'coating', name: 'c', ...c });
  const none = co({});
  assert.equal(none.refused.code, 'coating_undeclared');
  assert.ok(/roughly 0\.005 to 0\.025 mm per surface/.test(none.refused.what_would_help));
  assert.ok(/Anodise adds roughly 0\.005 to 0\.025 mm per surface on a Type II coating/.test(S.fits.notes), 'fits.json note (6) is the source of the range');
  assert.equal(co({ per_side_mm: 0 }).refused.code, 'coating_undeclared');
  assert.equal(co({ per_side_mm: -0.01 }).refused.code, 'coating_undeclared');
  assert.equal(co({ per_side_mm: '0.01' }).refused.code, 'coating_undeclared');
  assert.equal(co({ per_side_mm: [0.01, 0.02, 0.03] }).refused.code, 'coating_undeclared');
  const rng = co({ per_side_mm: [0.025, 0.005], src: 'x' });
  near(rng.low, 0.01, 1e-12); near(rng.high, 0.05, 1e-12);
  assert.equal(rng.dir, -1);
  near(rng.signed.low, -0.05, 1e-12); near(rng.signed.high, -0.01, 1e-12);
  assert.equal(rng.confidence, 'user');
  const one1 = co({ per_side_mm: 0.02, surfaces: 1 });
  near(one1.low, 0.02, 1e-12); near(one1.high, 0.02, 1e-12);
  assert.equal(one1.confidence, 'default');
  assert.ok(one1.flags.some((f) => /no src/.test(f)));
  assert.equal(co({ per_side_mm: 0.02, surfaces: 3 }).refused.code, 'invalid_input');
  assert.equal(co({ per_side_mm: 0.02, dir: 1 }).signed.low, 0.04);
});

test('declared refusals: no tolerance, ±0, negatives, bad dir; source without reference demotes to default', () => {
  const d = (c) => one({ kind: 'declared', name: 'd', ...c });
  const nt = d({ nominal_mm: 146.3, dir: 1 });
  assert.equal(nt.refused.code, 'no_tolerance');
  assert.ok(/three clockings/.test(nt.refused.what_would_help));
  assert.equal(d({ nominal_mm: 1, plus_mm: 0, minus_mm: 0, dir: 1 }).refused.code, 'no_tolerance');
  assert.equal(d({ nominal_mm: 1, plus_mm: -0.1, minus_mm: 0.1, dir: 1 }).refused.code, 'no_tolerance');
  assert.equal(d({ nominal_mm: 1, tol_mm: 0.1 }).refused.code, 'invalid_input', 'dir is required');
  assert.equal(d({ nominal_mm: 1, tol_mm: 0.1, dir: 2 }).refused.code, 'invalid_input');
  assert.equal(d({ nominal_mm: '1', tol_mm: 0.1, dir: 1 }).refused.code, 'invalid_input');
  const src = d({ nominal_mm: 1, tol_mm: 0.1, dir: 1, tol_src: 'source' });
  assert.equal(src.confidence, 'default');
  assert.ok(src.flags.some((f) => /demoted to default, as PartForge parseFlight\(\) does/.test(f)));
  const srcRef = d({ nominal_mm: 1, tol_mm: 0.1, dir: 1, tol_src: 'source', tol_ref: 'CMM report 7' });
  assert.equal(srcRef.confidence, 'source'); assert.equal(srcRef.provenance.tol_ref, 'CMM report 7');
  assert.equal(d({ nominal_mm: 1, tol_mm: 0.1, dir: 1, tol_src: 'vendor' }).confidence, 'default', 'any other word is default, as TOL_SRC normalises');
  const asym = d({ nominal_mm: 10, plus_mm: 0.3, minus_mm: 0.1, dir: 1, tol_src: 'user' });
  near(asym.low, 9.9, 1e-12); near(asym.high, 10.3, 1e-12); near(asym.signed.mid, 10.1, 1e-12);
  assert.equal(asym.flags.length, 0);
});

test('stack-level refusals and the not-gated state; a refused stack prints no gap', () => {
  assert.equal(L.stackUp(ctx, null).verdict, 'REFUSED');
  // A stack-level refusal is not counted as a contributor.
  for (const [bad, word] of [[null, 'the stack is refused \\(invalid_input\\)'], [[], 'the stack is refused \\(invalid_input\\)'], [{ contributors: [] }, 'the stack is refused \\(no_contributors\\)'],
    [{ contributors: [{ kind: 'declared', name: 'a', nominal_mm: 1, tol_mm: 0.1, tol_src: 'user', tol_ref: 't', dir: 1 }], require: { min_mm: 1, max_mm: 0 } }, 'the requirement is refused \\(invalid_input\\)']]) {
    const r = L.stackUp(ctx, bad);
    assert.ok(new RegExp(word).test(r.verdict_reasons[0]), r.verdict_reasons[0]);
    assert.ok(!/could not be sourced/.test(r.verdict_reasons[0]), r.verdict_reasons[0]);
  }
  assert.equal(stack([], { min_mm: 0 }).refusals[0].code, 'no_contributors');
  assert.equal(L.stackUp(ctx, { contributors: 'x' }).refusals[0].code, 'no_contributors');
  assert.equal(stack([{ kind: 'wedge', name: 'w', dir: 1 }], {}).refusals[0].code, 'unknown_kind');
  assert.equal(stack(['x'], {}).refusals[0].code, 'invalid_input');
  const two = [{ kind: 'declared', name: 'a', nominal_mm: 1, tol_mm: 0.1, tol_src: 'user', tol_ref: 't', dir: 1 }];
  assert.equal(stack(two, { min_mm: 1, max_mm: 0 }).refusals[0].code, 'invalid_input');
  assert.equal(stack(two, { min_mm: 'zero' }).refusals[0].code, 'invalid_input');
  assert.equal(L.stackUp(ctx, { contributors: two, units: 'in', require: {} }).refusals[0].code, 'invalid_input');
  const ng = stack(two, {});
  assert.equal(ng.verdict, 'NO_REQUIREMENT');
  assert.ok(ng.worst && ng.evaluable);
  assert.ok(/NOT GATED/.test(L.ledgerText(ng)));
  const r = run('bulkhead-as-declared');
  assert.equal(r.verdict, 'REFUSED');
  assert.deepEqual(r.refusals.map((x) => x.code), ['no_tolerance', 'coating_undeclared', 'cte_placeholder']);
  assert.equal(r.worst, null); assert.equal(r.rss, null); assert.equal(r.evaluable, false);
  const t = L.ledgerText(r);
  assert.ok(!/WORST CASE/.test(t) && !/^RSS {2,}/m.test(t) && !/^THERMAL/m.test(t) && /REFUSED/.test(t) && /what would help/.test(t), 'no partial numbers');
  assert.ok(/no gap is printed because a partial sum would be a placeholder number/.test(t));
  const c = run('coupler-as-declared');
  assert.deepEqual(c.refusals.map((x) => x.code), ['no_tolerance', 'coating_undeclared']);
  assert.deepEqual(run('plug-in-g10-coupler').refusals.map((x) => x.code), ['fit_on_composite', 'cte_placeholder']);
});

test('non-finite arithmetic is refused, never gated: overflowing limits and overflowing sums', () => {
  const big = { kind: 'declared', name: 'huge', nominal_mm: 1e308, tol_mm: 1e308, tol_src: 'user', tol_ref: 't', dir: 1 };
  const a = stack([big, { ...big, name: 'huge 2' }], { min_mm: 0 });
  assert.equal(a.verdict, 'REFUSED'); assert.equal(a.worst, null);
  assert.ok(a.refusals.every((x) => x.code === 'invalid_input') && /not finite/.test(a.refusals[0].reason));
  assert.deepEqual(a.refusals.map((x) => x.index), [0, 1], 'each overflowing contributor is refused by name, not only the sum');
  const fin = { kind: 'declared', name: 'big', nominal_mm: 1e308, tol_mm: 1e307, tol_src: 'user', tol_ref: 't', dir: 1 };
  const b = stack([fin, { ...fin, name: 'big 2' }], { min_mm: 0 });
  assert.equal(b.verdict, 'REFUSED', 'each limit finite, the sum not');
  assert.deepEqual(b.refusals.map((x) => [x.index, x.code]), [[-1, 'invalid_input']]);
  assert.ok(/the stack is refused/.test(b.verdict_reasons[0]));
  const t = L.ledgerText(b);
  assert.ok(!/WORST CASE|NaN|Infinity/.test(t) && !/CLEARS|FAIL/.test(t.split('VERDICT')[1]), t);
  const hot = stack([{ kind: 'thermal', name: 'x', D_mm: 1e300, hole_mat: '304', shaft_mat: '6061-T6', dT_K: [-1e300, 1e300] }], { min_mm: 0 });
  assert.equal(hot.verdict, 'REFUSED'); assert.equal(hot.refusals[0].code, 'invalid_input'); assert.equal(hot.refusals[0].index, 0);
  assert.equal(stack([big], { min_mm: Infinity }).refusals.some((x) => x.name === 'require'), true, 'an infinite requirement is not a number either');
});

// ---------------------------------------------------------------------------------------------
// 5. The examples read the templates; the text says what it must; the CLI behaves.
// ---------------------------------------------------------------------------------------------
test('the examples are built from the snapshotted templates, not retyped', () => {
  assert.equal(new Set(examples.map((e) => e.id)).size, 9);
  const B = S.templates.bulkhead, C = S.templates.coupler;
  const bOD = B.flight.critical.find((c) => c.name === 'bulkhead OD');
  assert.deepEqual([bOD.nominal_mm, bOD.tol_mm, bOD.tol_src], [146.2, 0.05, 'default']);
  const ex1 = E.byId(examples, 'bulkhead-as-declared').stack;
  assert.equal(ex1.contributors[0].nominal_mm, 146.3, 'coupler ID read from the NOTE line');
  assert.ok(B.header.some((h) => h.tag === 'NOTE' && /^Coupler ID 146\.30 mm \(5\.760 in\) assumed/.test(h.text)));
  assert.deepEqual([ex1.contributors[1].nominal_mm, ex1.contributors[1].tol_mm, ex1.contributors[1].tol_src, ex1.contributors[1].dir], [146.2, 0.05, 'default', -1]);
  assert.ok(ex1.contributors[2].name.includes(B.flight.mfg.finish) && /bare or type II clear anodize/.test(B.flight.mfg.finish));
  assert.equal(ex1.contributors[3].shaft_mat, '6061-T6');
  assert.equal(B.params.find((p) => p.name === 'plate_od').value, '146.20');
  const cOD = C.flight.od.find((c) => c.name === 'coupler OD');
  assert.deepEqual([cOD.d_mm, cOD.tol_mm, cOD.tol_src], [149.3, 0.05, 'default']);
  const ex3 = E.byId(examples, 'coupler-as-declared').stack;
  assert.equal(ex3.contributors[0].nominal_mm, 149.6, 'airframe ID read from the NOTE line');
  assert.ok(C.header.some((h) => h.tag === 'NOTE' && /^Airframe ID 149\.60 mm \(5\.890 in\) assumed/.test(h.text)));
  assert.ok(/bare or type II anodize; the OD is a sliding fit/.test(C.flight.mfg.finish));
  assert.ok(S.fits.fits.some((f) => f.name === 'H8/f7' && /motor tube in a centring ring/.test(f.use)));
  for (const ex of examples) assert.ok(ex.why.length > 60 && ex.title && ex.stack.contributors.length >= 1, ex.id);
});

test('ledger text carries the words the page and the CLI must say', () => {
  for (const ex of examples) {
    const t = L.ledgerText(L.stackUp(ctx, ex.stack));
    assert.ok(t.startsWith('STACK LEDGER  '));
    assert.ok(/verbatim from index\.html:4994-5024/.test(t));
    assert.ok(/Measurable on a mesh: none/.test(t));
    assert.ok(/RSS is information only/.test(t));
    assert.ok(!/\bPASS\b/.test(t), `${ex.id} never says PASS`);
    assert.ok(!/\bPASS\b/.test(ex.why + ex.title), `${ex.id}: nor does its menu text`);
    const r = L.stackUp(ctx, ex.stack);
    if (r.verdict === 'CLEARS') assert.ok(/VERDICT {6}CLEARS \(screening\) - .*screening only, not a pass/.test(t), t);
  }
  const t = L.ledgerText(run('plug-in-steel-bore'));
  assert.ok(/THERMAL      -0\.013 \.\. \+0\.038 over the declared dT range/.test(t), t);
  assert.ok(/dbFitThermal\(101\.600, 304, 6061-T6, dT\) = \(alpha_hole 17\.3 - alpha_shaft 23\.6\)/.test(t));
  assert.ok(/VERDICT      FAIL - minimum gap -0\.001 is 0\.001 below/.test(t));
});

test('CLI: exit codes 0 CLEARS / 1 FAIL / 2 refused or not gated / 3 usage, --json, --list, --help', () => {
  assert.equal(cli(['--help']).status, 0);
  assert.ok(/exit codes: 0 CLEARS/.test(cli(['--help']).stdout));
  assert.ok(!/\bPASS\b/.test(cli(['--help']).stdout));
  assert.equal(cli(['--example', 'two-plus-minus', '--embedded']).status, 3, '--embedded needs --repo');
  const list = cli(['--list']);
  assert.equal(list.status, 0);
  assert.equal(list.stdout.trim().split('\n').length, 9);
  assert.equal(cli(['--example', 'two-plus-minus']).status, 0);
  assert.equal(cli(['--example', 'motor-tube-in-ring']).status, 0);
  assert.equal(cli(['--example', 'bar-as-pin']).status, 1);
  assert.equal(cli(['--example', 'bulkhead-declared']).status, 1);
  assert.equal(cli(['--example', 'plug-in-g10-coupler']).status, 2);
  assert.equal(cli(['--example', 'bulkhead-as-declared']).status, 2);
  assert.equal(cli(['--example', 'no-such-example']).status, 3);
  assert.equal(cli([]).status, 3);
  assert.equal(cli(['--bogus']).status, 3);
  assert.equal(cli(['/nonexistent/stack.json']).status, 3);
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'stack-ledger-'));
  try {
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '{not json');
    const rb = cli([bad]);
    assert.equal(rb.status, 3); assert.ok(/not JSON/.test(rb.stderr));
    const ng = path.join(tmp, 'nogate.json');
    fs.writeFileSync(ng, JSON.stringify({ gap_name: 'g', contributors: [{ kind: 'fit', name: 'f', size_mm: 50, hole: ['H', 7], shaft: ['g', 6] }] }));
    const rn = cli([ng]);
    assert.equal(rn.status, 2); assert.ok(/NOT GATED/.test(rn.stdout));
    const ok = path.join(tmp, 'pass.json');
    fs.writeFileSync(ok, JSON.stringify(E.byId(examples, 'two-plus-minus').stack));
    assert.equal(cli([ok]).status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const j = cli(['--example', 'bar-as-pin', '--json']);
  assert.equal(j.status, 1);
  const parsed = JSON.parse(j.stdout);
  const direct = run('bar-as-pin');
  delete parsed.result.meta; delete direct.meta;
  assert.deepEqual(parsed.result, JSON.parse(JSON.stringify(direct)), '--json is the kernel\'s result');
});

test('CLI --repo: live tables from the checkout give the same ledgers as the snapshots (skipped without the repo)', { skip: !repoPresent && 'no PartForge checkout' }, () => {
  for (const ex of examples) {
    const a = cli(['--example', ex.id, '--json', '--repo', REPO]);
    const b = cli(['--example', ex.id, '--json']);
    assert.equal(a.status, b.status, ex.id);
    const ra = JSON.parse(a.stdout).result, rb = JSON.parse(b.stdout).result;
    assert.ok(/live checkout/.test(ra.meta.tables) && ra.meta.commit === S.provenance.commit);
    delete ra.meta; delete rb.meta;
    assert.deepEqual(ra, rb, ex.id);
  }
  assert.equal(cli(['--example', 'two-plus-minus', '--repo', '/nonexistent']).status, 3);
});

test('the kernel over the app\'s own embedded tables (index.html DB-DATA block): same numbers, notes where columns are missing (skipped without the repo)', { skip: !repoPresent && 'no PartForge checkout' }, () => {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const { data } = extractDbData(html);
  const full = JSON.parse(fs.readFileSync(path.join(REPO, 'data/tables/stock.json'), 'utf8'));
  // The finding, pinned: the projection drops four columns the kernel prints and keeps disputed only as a flag.
  assert.equal(data.stock.rows.length, 192);
  for (const k of ['tolerance_confidence', 'tolerance_note', 'id_nominal_mm', 'ovality_individual_dia_tol_mm']) {
    assert.equal(data.stock.rows.filter((r) => k in r).length, 0, `${k} absent from the embedded stock rows`);
    assert.ok(full.rows.some((r) => r[k] != null), `${k} present in data/tables/stock.json`);
  }
  assert.equal(data.stock.rows.filter((r) => r.disputed === true).length, full.rows.filter((r) => Array.isArray(r.disputed) && r.disputed.length).length);
  // The fallback the kernel uses for the missing nominal ID is exact on the full table, every tube and pipe row.
  const tubes = full.rows.filter((r) => r.id_nominal_mm != null);
  assert.equal(tubes.length, 113);
  for (const r of tubes) near(r.dim_mm - 2 * r.wall_mm, r.id_nominal_mm, 1e-9, r.key);
  // Row confidence is never stronger than the tolerance's, so falling back to it never promotes a recall tolerance.
  assert.equal(full.rows.filter((r) => r.confidence !== 'recall' && r.tolerance_confidence === 'recall').length, 0);
  // Every example, through the CLI over the embedded block, gives the same verdict, limits and refusal codes.
  for (const ex of examples) {
    const a = cli(['--example', ex.id, '--json', '--repo', REPO, '--embedded']);
    const b = cli(['--example', ex.id, '--json']);
    assert.equal(a.status, b.status, ex.id);
    const ra = JSON.parse(a.stdout).result, rb = JSON.parse(b.stdout).result;
    assert.ok(/embedded DB-DATA block, index\.html:\d+-\d+/.test(ra.meta.tables), ra.meta.tables);
    assert.deepEqual([ra.verdict, ra.worst, ra.rss, ra.thermal, ra.refusals.map((x) => x.code)], [rb.verdict, rb.worst, rb.rss, rb.thermal, rb.refusals.map((x) => x.code)], ex.id);
  }
  // And a tube ID, which over the shipped projection used to be refused for want of id_nominal_mm.
  S.useTables({ fits: data.fits, materials_thermal: data.materials_thermal, stock: data.stock });
  try {
    const id = one({ kind: 'stock', name: 's', key: 'tube_6061_i_6.000x0.125', surface: 'id', dir: 1 });
    assert.equal(id.refused, null);
    near(id.low, 145.058, 1e-9); near(id.high, 147.042, 1e-9); near(id.nominal, 146.05, 1e-9);
    assert.equal(S.dbFit(50, 'H', 7, 'g', 6).confidence, 'likely', 'the shim spreads the hoisted shared fields back, as index.html:4992 does');
  } finally {
    S.useTables(null);
  }
});

test('example.txt is a real record: every "$" command in it replays to the same text today', () => {
  const txt = fs.readFileSync(path.join(here, 'example.txt'), 'utf8');
  const blocks = txt.split(/^\$ /m).filter(Boolean);
  assert.ok(blocks.length >= 6, `${blocks.length} commands`);
  let replayed = 0;
  for (const b of blocks) {
    const [cmdLine, ...rest] = b.split('\n');
    const body = rest.join('\n');
    const m = /^node ideas\/06-stack-ledger\/stack-ledger\.mjs (.*)$/.exec(cmdLine.trim());
    assert.ok(m, cmdLine);
    const args = m[1].split(/\s+/);
    if (args.includes('--repo') && !repoPresent) continue;
    const r = cli(args);
    const expect = `${r.stdout}(exit ${r.status})\n`;
    assert.equal(body.trimEnd(), expect.trimEnd(), `replay of: ${cmdLine}`);
    replayed++;
  }
  assert.ok(replayed >= 6);
  assert.ok(/VERDICT      FAIL - minimum gap -0\.030/.test(txt) && /REFUSED cte_placeholder/.test(txt) && /REFUSED fit_on_composite/.test(txt) && /29% narrower/.test(txt) && /--embedded/.test(txt));
  assert.ok(!/\bPASS\b/.test(txt), 'the record never says PASS');
});

test('the README states the numbers the kernel computes', () => {
  const md = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  for (const s of ['0.0707', '29 %', '0.078', '0.0465', '0.0295', '4994', '5024', '4997', '5018', '−0.030', '0.170', '−0.0008', '−0.038', '0.091', 'bar_6061_i_6.000_ext', '0.0585', 'N=4',
    '16.8 and 25.9', '16.76', '25.88', '−0.0198', '−0.0361', 'CLEARS', 'cte_placeholder', 'fit_on_composite', '`:666`', '`:5477`', '360,828', '9 of the 192', 'embed.mjs:83']) {
    assert.ok(md.includes(s), `README mentions ${s}`);
  }
  for (const s of ['true of eleven rows', 'whole file, 356 KB', 'gives twice the allowed', ':5465` and `:5480']) assert.ok(!md.includes(s), `README no longer says ${s}`);
  // The test and check counts the README states are the ones this file and ui-check.mjs have.
  const nTests = (fs.readFileSync(path.join(here, 'stack.test.mjs'), 'utf8').match(/^test\(/gm) || []).length;
  assert.ok(md.includes(`(${nTests} tests,`), `README states ${nTests} tests`);
  assert.ok(/\[(Certain|Likely|Speculative)\]/.test(md));
});
