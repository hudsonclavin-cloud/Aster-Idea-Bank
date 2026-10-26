// node --test ideas/11-hole-stack/holestack.test.mjs   (from the bank root; Node built-ins only)
//
// What these pin, and to what outside this deposit's own code:
//   - the snapshots are byte-exact (sha256 against the provenance sidecars and, when present, the checkout);
//   - the proposal's hand-worked M6 stack, number by number, from the M6 row of fasteners_metric.json;
//   - the ISO 724 / hexagon / 90° closed forms the table's own columns state;
//   - every H12/H13 band against PartForge's SHIPPED dbFit() (verbatim copy), and the refusals exactly
//     where dbFit has no answer;
//   - every emitted FLIGHT row through PartForge's SHIPPED parseFlight() and every OpenSCAD module
//     through its flightLint(), over all 2,304 input combinations;
//   - every OpenSCAD parameter against an independent recomputation written in this file;
//   - the first dry run's own FLIGHT rows (tests/dryrun) against the H13 band;
//   - the findings about the source repo (threadCheck vs the table's engagement, the hint line, the
//     doctrine's nut pocket and tapped-hole wording, the unlabelled fields) against PartForge's own code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const H = require(path.join(here, 'holestack.js'));
const FM = require(path.join(here, 'snapshots', 'fasteners_metric.js'));
const FITS = require(path.join(here, 'snapshots', 'fits.js'));
const PF = require(path.join(here, 'snapshots', 'partforge-code.js'));
const PD = require(path.join(here, 'snapshots', 'provenance-doctrine.js'));
const fm = FM.json, fits = FITS.json;
const D = H.makeData(fm, fits, PF);
const REPO = '/home/user/Partforge';
const haveRepo = fs.existsSync(path.join(REPO, 'index.html'));
const sidecar = (f) => JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f + '.provenance.json'), 'utf8'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const row = (k) => fm.rows.find((r) => r.key === k);
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const COS30 = Math.sqrt(3) / 2;

function* combos() {
  for (const size of D.keys) for (const head of H.HEADS) for (const series of H.SERIES) for (const washer of [false, true])
    for (const far of H.FARS) for (const model_at of ['d1', 'drill']) yield { size, head, series, washer, far, model_at, plate_t: 60, part_t: 60 };
}

test('snapshots are byte-exact copies of the PartForge files they name', () => {
  for (const [mod, file] of [[FM, 'fasteners_metric.js'], [FITS, 'fits.js']]) {
    const sc = sidecar(file);
    assert.equal(sha(mod.text), sc.sourceSha256, `${file}: embedded text hashes to the sidecar's sourceSha256`);
    assert.equal(mod.sha256, sc.sourceSha256);
    assert.equal(sc.commit.slice(0, 7), '0974a62');
    if (haveRepo) assert.equal(mod.text, fs.readFileSync(path.join(REPO, mod.path), 'utf8'), `${file} equals the checkout's ${mod.path}`);
  }
  for (const f of ['dryrun-retainer-fixed.scad', 'dryrun-endcap.scad']) {
    const sc = sidecar(f);
    assert.equal(sc.mode, 'copy');
    assert.equal(sha(fs.readFileSync(path.join(here, 'snapshots', f))), sc.sourceSha256);
  }
  // the verbatim code: each cut must still be in index.html exactly (when the checkout is here)
  if (haveRepo) {
    const lines = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8').split('\n');
    const mine = fs.readFileSync(path.join(here, 'snapshots', 'partforge-code.js'), 'utf8');
    for (const c of PF.CUTS) {
      if (/\(string\)$/.test(c.what)) continue;
      const block = lines.slice(c.a - 1, c.b).join('\n');
      assert.ok(mine.includes(block), `index.html ${c.a}-${c.b} (${c.what}) is in partforge-code.js unedited`);
    }
    assert.equal(PF.DOCTRINE.standardSizes, lines[PF.DOCTRINE.standardSizesLine - 1]);
    const pdl = fs.readFileSync(path.join(REPO, PD.path), 'utf8').split('\n');
    assert.deepEqual(PD.lines, pdl.slice(PD.firstLine - 1, PD.firstLine - 1 + PD.lines.length));
  }
});

test('the rules the tool applies are read out of the table\'s own column text', () => {
  assert.deepEqual(D.rules.grade, { fine: 12, medium: 13, coarse: 14 }, 'columns.clearance_*_mm say (H12) / (H13) / (H14)');
  assert.equal(D.rules.cboreAllowance, 0.4, 'columns.cbore_d_mm: "Any value >= shcs_head_d_knurled_mm + 0.4 works"');
  assert.equal(D.rules.cboreDepthAllowance, 0.5, 'columns.cbore_depth_flush_mm: "= shcs_head_h_mm (k max) + 0.5"');
  assert.equal(D.rules.cskAngle, 90, 'columns.csk_head_d_mm: "at 90 deg"');
  assert.deepEqual(D.rules.engPitches, [1, 2], 'columns.min_engagement_6061T6_8_8_mm: "Add 1-2 pitches"');
  // break the text and the rule disappears, so the tool refuses instead of inventing it
  const fm2 = JSON.parse(FM.text); fm2.columns.cbore_d_mm = 'counterbore tool sizes';
  const r = H.build({ size: 'M6' }, H.makeData(fm2, fits, PF));
  assert.ok(r.refusals.some((q) => q.feature === 'counterbore' && q.code === 'insufficient_data'));
  assert.equal(r.flight.clamp.bores.length, 0);
});

test('M6, socket head, medium, no washer: the proposal\'s worked stack, number by number', () => {
  const m6 = row('M6');
  const r = H.build({ size: 'M6', head: 'socket', series: 'medium', plate_t: 12, far: 'through' }, D);
  assert.equal(r.ok, true);
  const f = Object.fromEntries(r.features.map((x) => [x.id, x]));
  // clearance: ISO 273 medium 6.6, H13 = IT13 of the 6-10 mm step = 220 um → 6.600..6.820
  assert.equal(m6.clearance_medium_mm, 6.6);
  assert.equal(f.clearance.band.it_um, 220);
  assert.equal(f.clearance.band.stepName, '6-10');
  assert.ok(close(f.clearance.band.lo, 6.6) && close(f.clearance.band.hi, 6.82, 1e-12));
  assert.equal(r.flight.clamp.holes[0].d_mm, 6.71);
  assert.equal(r.flight.clamp.holes[0].tol_mm, 0.11);
  assert.equal(r.flight.clamp.holes[0].tol_src, 'source');
  assert.match(r.flight.clamp.holes[0].tol_ref, /^ISO 273:1979 medium M6 6\.6, H13; ISO 286 IT13 6-10 mm = 220 um/);
  // counterbore: knurled dk 10.22 + 0.4 = 10.62 minimum, depth 6.5; the recall tool size 11 shown, not used
  assert.ok(close(f.counterbore.band.lo, 10.62, 1e-12));
  assert.equal(f.counterbore.depth, 6.5);
  assert.equal(f.counterbore.recallShown.value, 11);
  assert.equal(f.counterbore.recallShown.conf, 'recall');
  assert.deepEqual(r.flight.clamp.bores[0], { name: 'M6 SHCS counterbore (min 10.62)', d_mm: 10.75, tol_mm: 0.13, at_mm: [0, 0], axis: 'z', from_mm: 12, to_mm: 5.5, tol_src: 'default' });
  assert.ok(!/(^|[^.\d])11(\.0+)?[^.\d]/.test(r.scad.replace(/\/\/[^\n]*/g, '')), 'the recall tool size 11 appears in no code, only in a comment');
  assert.equal(r.flight.clamp.holes[0].from_mm, 5.5);
  assert.equal(r.flight.clamp.holes[0].to_mm, 0);
});

test('M6 with a washer: depth 8.1 as the proposal says, and the diameter opens to the washer (the proposal kept 10.62)', () => {
  const r = H.build({ size: 'M6', washer: true }, D);
  const cb = r.features.find((x) => x.id === 'counterbore');
  assert.ok(close(cb.depth, 8.1, 1e-12), '6.5 + washer_t_mm 1.6');
  assert.equal(cb.band.lo, 12, 'washer_od_mm 12 > 10.62: a 12 mm washer cannot enter a 10.62 mm counterbore');
  assert.equal(r.flight.clamp.bores[0].d_mm, 12.13);
  assert.ok(r.checks.some((c) => /cbore_d_mm 11 \[recall\] is smaller than the washer OD 12/.test(c.text)));
  // the table's own counterbore tool is smaller than the washer at 11 sizes and equal at M5
  const cmp = fm.rows.map((x) => Math.sign(x.cbore_d_mm - x.washer_od_mm));
  assert.equal(cmp.filter((s) => s < 0).length, 11);
  assert.deepEqual(fm.rows.filter((x) => x.cbore_d_mm === x.washer_od_mm).map((x) => x.key), ['M5']);
});

test('M6 far ends: tapped at D1 4.917 / drill 5.0 / stainless 5.2; nut pocket 11.547 sharp, 11.05 min, 5.2 deep; nyloc 6.0 [recall]', () => {
  const t = H.build({ size: 'M6', far: 'tapped', part_t: 16 }, D).features.find((x) => x.id === 'tapped');
  assert.equal(t.D1, 4.917); assert.equal(t.drill, 5); assert.equal(t.Le, 9.5);
  assert.deepEqual(t.need, [10.5, 11.5]);
  const tr = H.build({ size: 'M6', far: 'tapped', part_t: 16 }, D).flight.tapped.holes[0];
  assert.deepEqual([tr.d_mm, tr.tol_mm, tr.from_mm, tr.to_mm, tr.tol_src], [5.047, 0.13, 16, 0, 'default'], 'D1 4.917 + the cnc_mill default, through 16 mm');
  assert.equal(H.build({ size: 'M6', far: 'tapped', drill: 'stainless' }, D).features.find((x) => x.id === 'tapped').drill, 5.2);
  const n = H.build({ size: 'M6', far: 'nut', plate_t: 16 }, D).features.find((x) => x.id === 'nut');
  assert.equal(n.acSharp, 11.547); assert.equal(n.acMin, 11.05); assert.equal(n.depth, 5.2);
  assert.ok(close(n.model, 10.13, 1e-12), 'pocket AF = s max 10 + the cnc_mill default 0.13');
  assert.ok(close(n.ac, 10.13 / COS30, 1e-12) && n.ac >= n.acSharp);
  const ny = H.build({ size: 'M6', far: 'nyloc', plate_t: 16 }, D).features.find((x) => x.id === 'nut');
  assert.equal(ny.depth, 6); assert.equal(ny.fields[3].conf, 'recall');
  assert.match(H.flightBlock(H.build({ size: 'M6', far: 'nyloc', plate_t: 16 }, D), 'clamp'), /"why":"nyloc M6 at s max 10, h 6 \[recall\] enters"/);
});

test('the M3 countersink: 6.72 at 90 deg, and the cone depth by hand', () => {
  const r = H.build({ size: 'M3', head: 'countersunk', plate_t: 6 }, D);
  const c = r.features.find((x) => x.id === 'countersink');
  assert.equal(c.model, 6.72);
  // medium 3.4, IT13 of 3-6 mm = 180 um → hole modelled at 3.49; 90 deg cone: (6.72 - 3.49) / 2
  assert.ok(close(c.depth, (6.72 - 3.49) / 2, 1e-12));
  assert.equal(r.flight.clamp.gauges[0].module, 'gauge_m3_csk_go');
  assert.match(r.scad, /module gauge_m3_csk_go\(\)/);
  assert.ok(close(r.flight.clamp.holes[0].from_mm, 6 - 1.615, 1e-9), 'the clearance row starts where the cone meets the hole, so no CMM station sits in the cone');
});

test('closed forms the table states hold on all 12 rows (D1, sharp corners, 90 deg head, flush depth, counterbore rule)', () => {
  for (const r of fm.rows) {
    assert.equal(r3(r.d_mm - 1.08253 * r.pitch_mm), r.minor_D1_mm, `${r.key} D1 = d - 1.08253p (ISO 724, columns.minor_D1_mm)`);
    assert.equal(r3(r.d_mm - 1.22687 * r.pitch_mm), r.minor_d_mm, `${r.key} d3 = d - 1.22687p`);
    assert.equal(r3(r.nut_af_mm / COS30), r.nut_ac_sharp_mm, `${r.key} sharp across corners = s / cos 30`);
    assert.ok(close(r.cbore_depth_flush_mm, r.shcs_head_h_mm + 0.5, 1e-12), `${r.key} flush depth = k + 0.5`);
    assert.ok(r.cbore_d_mm >= r.shcs_head_d_knurled_mm + 0.4 - 1e-12, `${r.key} the recall tool size satisfies the table's own rule`);
    if (r.csk_head_d_mm != null) assert.ok(close(r.csk_head_h_mm, (r.csk_head_d_mm - r.d_mm) / 2, 1e-9), `${r.key} 90 deg head: k = (dk - d) / 2`);
    assert.equal(Math.round(100 * (r.d_mm - r.tap_drill_mm) / (1.299 * r.pitch_mm)), r.tap_drill_pct_thread, `${r.key} % thread (Machinery's Handbook formula quoted in the column)`);
  }
  function r3(x) { return Math.round(x * 1000) / 1000; }
});

test('every clearance band equals PartForge\'s shipped dbFit(), and the refusals fall exactly where dbFit has no answer', () => {
  let bands = 0, refused = 0;
  for (const k of D.keys) for (const s of H.SERIES) {
    const g = D.rules.grade[s], dc = row(k)['clearance_' + s + '_mm'];
    const shipped = PF.dbFit(dc, 'H', g, 'h', g);
    const r = H.build({ size: k, series: s, plate_t: 60 }, D);
    const f = r.features.find((x) => x.id === 'clearance');
    if (shipped) {
      bands++;
      assert.ok(f.band, `${k} ${s} has a band`);
      assert.ok(close(f.band.lo, shipped.hole[0], 1e-12) && close(f.band.hi, shipped.hole[1], 1e-12), `${k} ${s}: ${f.band.lo}..${f.band.hi} vs dbFit ${shipped.hole}`);
      assert.equal(f.band.it_um, shipped.it_hole_um);
      assert.equal(r.flight.clamp.holes.length, 1);
    } else {
      refused++;
      assert.equal(f.band, null, `${k} ${s} is refused`);
      assert.ok(r.refusals.some((q) => q.feature === 'clearance band' && q.code === 'insufficient_data'));
      assert.equal(r.flight.clamp.holes.length, 0, 'no FLIGHT row without a band');
    }
  }
  assert.equal(bands, 22); assert.equal(refused, 14, '12 coarse (no IT14 in fits.json) + M2 and M2.5 fine (IT12 withheld for 1-3 mm)');
  const m2 = H.build({ size: 'M2', series: 'fine' }, D).refusals.find((q) => q.feature === 'clearance band');
  assert.match(m2.reason, /withholds IT12 for the 1-3 mm step: "formula gives 85 um, the published table gives 100 um"/);
  const m6c = H.build({ size: 'M6', series: 'coarse' }, D).refusals.find((q) => q.feature === 'clearance band');
  assert.match(m6c.reason, /tabulates IT5–IT13 for the 6-10 mm step; IT14 is not in the table/);
  assert.deepEqual(Object.keys(fits.rows.find((x) => x.key === 'iso286_6-10').it_um), ['5', '6', '7', '8', '9', '10', '11', '12', '13'], 'the proposal\'s 360 um IT14 is not in fits.json');
});

test('all 2,304 combinations: PartForge\'s parseFlight drops and demotes nothing, flightLint is clean, and no recall field stands behind a cited row', () => {
  let builds = 0, blocks = 0, sourceRows = 0, defaultRows = 0, gauges = 0;
  for (const inp of combos()) {
    const r = H.build(inp, D); builds++;
    assert.deepEqual(PF.flightLint(r.scad), [], `${JSON.stringify(inp)} lint`);
    for (const part of ['clamp', 'tapped']) {
      const b = H.flightBlock(r, part);
      if (!b) continue;
      blocks++;
      const f = PF.parseFlight(b);
      assert.ok(f && !f.malformed, 'parses');
      assert.equal(f.dropped, 0); assert.equal(f.demoted, 0);
      sourceRows += f.provenance.dims.source; defaultRows += f.provenance.dims.default; gauges += f.gauges.length;
      for (const e of [...f.holes, ...f.bores]) {
        assert.ok(e.tol_mm >= 2 * f.tess_tol_mm, `tol_mm ${e.tol_mm} >= 2 × tess_tol_mm (the bores rule in the doctrine)`);
        if (e.tol_src === 'source') assert.ok(e.tol_ref.length > 0 && e.tol_ref.length <= 140);
        else assert.equal(e.tol_ref, '');
      }
    }
    for (const b of r.flight.basis) {
      if (b.tol_src !== 'source') continue;
      for (const field of b.fields) {
        assert.ok(H.citable(D, r.row, field), `${b.name}: ${field} is ${H.fieldConf(D, r.row, field)} / ${H.fieldBasis(D, field).kind}`);
        assert.notEqual(H.fieldConf(D, r.row, field), 'recall');
      }
    }
  }
  assert.equal(builds, 2304, '12 sizes × 4 heads × 3 series × washer × 4 far ends × 2 tapped-hole models');
  assert.ok(blocks >= builds, 'every build that keeps a feature emits a block');
  assert.equal(sourceRows, 22 * 4 * 2 * 4 * 2, 'cited rows = the 22 clearance bands × heads × washer × far ends × model_at, nothing else');
  assert.ok(defaultRows > 0 && gauges > 0);
});

test('the provenance mechanics: field confidence, basis and citability come from the table, not from the row label', () => {
  const m6 = row('M6');
  assert.equal(m6.confidence, 'likely', 'the M6 row label');
  assert.equal(H.fieldConf(D, m6, 'cbore_d_mm'), 'recall', 'field_confidence overrides the row label');
  assert.equal(H.citable(D, m6, 'cbore_d_mm'), false);
  assert.equal(H.fieldConf(D, m6, 'clearance_medium_mm'), 'likely', 'a core field takes the row label');
  assert.equal(H.citable(D, m6, 'clearance_medium_mm'), true);
  assert.equal(H.fieldConf(D, m6, 'cbore_depth_flush_mm'), 'unlabelled');
  assert.equal(H.citable(D, m6, 'tap_drill_mm'), false, 'likely, but trade practice: not a standard');
  assert.equal(H.citable(D, m6, 'nut_ac_sharp_mm'), false, 'certain, but computed');
  assert.equal(H.fieldBasis(D, 'csk_head_d_mm').kind, 'recall');
  // the nine supplementary fields the table's notes (9) promise a confidence for and never give one
  const core = new Set(fm.core_fields);
  const supp = Object.keys(fm.columns).filter((c) => !['key', 'confidence', 'field_confidence', 'disputed', 'source'].includes(c) && !core.has(c));
  const never = supp.filter((c) => fm.rows.every((x) => !(x.field_confidence && c in x.field_confidence)));
  assert.deepEqual(never, ['tap_drill_pct_thread', 'tap_drill_stainless_mm', 'tap_drill_stainless_pct_thread', 'us_tap_drill', 'us_clearance_drill', 'cbore_depth_flush_mm', 'din934_nut_af_mm', 'torque_guide_8_8_dry_Nm', 'min_engagement_6061T6_8_8_mm']);
  assert.match(fm.notes, /field_confidence lists every supplementary field/);
});

test('every OpenSCAD parameter equals an independent recomputation, and every quoted field value matches the table', () => {
  const tolOf = (p) => PF.FLIGHT_PROCESSES[p].tol_general_mm;
  const it = (d, g) => { const s = fits.rows.find((x) => d > x.from_mm && d <= x.to_mm); return s && s.it_um[String(g)]; };
  const G = { fine: 12, medium: 13, coarse: 14 };
  let checked = 0;
  for (const inp of combos()) {
    const r = H.build(inp, D), k = r.key, id = k.toLowerCase().replace('.', '_'), R = row(k), tol = tolOf('cnc_mill');
    const params = {};
    for (const m of r.scad.matchAll(/^(\w+) = ([\d.]+);/gm)) params[m[1]] = +m[2];
    const ITv = it(R['clearance_' + inp.series + '_mm'], G[inp.series]);
    const want = { [id + '_clear_d']: ITv ? R['clearance_' + inp.series + '_mm'] + ITv / 2000 : R['clearance_' + inp.series + '_mm'], [id + '_plate_t']: 60, tess_tol: 0.01, cut_ext: 1 };
    if (inp.head === 'socket') {
      want[id + '_cbore_d'] = Math.max(R.shcs_head_d_knurled_mm + 0.4, inp.washer ? R.washer_od_mm : 0) + tol;
      want[id + '_cbore_depth'] = R.shcs_head_h_mm + 0.5 + (inp.washer ? R.washer_t_mm : 0);
    }
    if (inp.head === 'countersunk' && !inp.washer && R.csk_head_d_mm != null) { want[id + '_csk_d'] = R.csk_head_d_mm; want[id + '_csk_k'] = R.csk_head_h_mm; }
    if ((inp.far === 'nut' || (inp.far === 'nyloc' && R.locknut_h_mm != null))) {
      want[id + '_nut_af'] = R.nut_af_mm + tol; want[id + '_nut_af_max'] = R.nut_af_mm;
      want[id + '_nut_h'] = inp.far === 'nut' ? R.nut_h_mm : R.locknut_h_mm;
    }
    if (inp.far === 'tapped') {
      want[id + '_part_t'] = 60;
      want[id + '_tap_d'] = (inp.model_at === 'd1' ? R.d_mm - 1.08253 * R.pitch_mm : R.tap_drill_mm) + tol;
    }
    for (const [name, v] of Object.entries(want)) {
      if (inp.head === 'countersunk' && inp.washer && /csk/.test(name)) continue;
      assert.ok(name in params, `${JSON.stringify(inp)}: ${name} emitted`);
      assert.ok(Math.abs(params[name] - v) <= 0.0006, `${JSON.stringify(inp)}: ${name} = ${params[name]}, recomputed ${v}`);
      checked++;
    }
    assert.deepEqual(Object.keys(params).sort(), Object.keys(want).filter((n) => !(inp.head === 'countersunk' && inp.washer && /csk/.test(n))).sort(), `${JSON.stringify(inp)}: no parameter beyond the recomputed ones`);
    // "field value [conf]" in the comments: the value is the table's and the label is the field's
    for (const m of r.scad.matchAll(/\b([a-z][a-z0-9_]*_(?:mm|thread))\s+([\d.]+)\s+\[(certain|likely|recall|unlabelled)\]/g)) {
      assert.ok(close(+m[2], R[m[1]], 1e-9), `${k} comment quotes ${m[1]} ${m[2]}, table has ${R[m[1]]}`);
      assert.equal(m[3], H.fieldConf(D, R, m[1]));
    }
    // numerals in the code outside the parameter block are the hexagon's and fn_tol's, nothing else
    const code = r.scad.split('// --- end parameters ---')[1].replace(/\/\/[^\n]*/g, '').replace(/^function fn_tol.*$/m, '');
    for (const m of code.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) assert.ok(['0', '2', '5', '30', '60'].includes(m[1]), `${k}: unexpected numeral ${m[1]} in code`);
  }
  assert.equal(checked, 15168, 'parameters checked');
});

test('refusals name what is missing and what would help', () => {
  const one = (inp, feature) => { const r = H.build(inp, D); const q = r.refusals.find((x) => x.feature === feature); assert.ok(q, `${JSON.stringify(inp)} refuses ${feature}`); assert.ok(q.reason && q.help && q.code); return { r, q }; };
  let { r, q } = one({ size: 'M7' }, 'size');
  assert.equal(q.code, 'not_found'); assert.match(q.help, /M2, M2\.5, M3, M4, M5, M6, M8, M10, M12, M14, M16, M20/); assert.equal(r.scad, ''); assert.equal(r.flight.clamp, null);
  ({ q } = one({ size: 'M8x1' }, 'size')); assert.match(q.reason, /fine pitch.*M8×1\.25/);
  assert.equal(H.build({ size: 'M6x1' }, D).key, 'M6');
  ({ q } = one({ size: 'M2', head: 'countersunk' }, 'countersink')); assert.match(q.reason, /csk_head_d_mm is null for M2: "null = size not in ISO 10642 \(M2, M2\.5\)"/);
  ({ q } = one({ size: 'M14', head: 'button' }, 'button head')); assert.match(q.reason, /button_head_d_mm is null for M14/);
  ({ q } = one({ size: 'M2.5', far: 'nyloc' }, 'nut pocket')); assert.match(q.reason, /locknut_h_mm is null for M2\.5/);
  one({ size: 'M6', head: 'countersunk', washer: true }, 'washer');
  ({ q } = one({ size: 'M6', plate_t: 6 }, 'counterbore')); assert.match(q.reason, /6\.5 mm deep .* not less than the 6 mm plate/);
  ({ q } = one({ size: 'M6', far: 'nut', plate_t: 11 }, 'nut pocket')); assert.match(q.reason, /6\.5 mm \+ pocket 5\.2 mm leave no plate/);
  ({ q } = one({ size: 'M6', far: 'tapped', tap_end: 'blind', part_t: 11 }, 'tapped hole')); assert.match(q.reason, /11\.5 mm\) does not fit in a 11 mm part/);
  ({ q } = one({ size: 'M6', plate_t: -3 }, 'input')); assert.equal(q.code, 'invalid_input');
  one({ size: 'M6', process: 'lathe_magic' }, 'input');
});

test('the first dry run\'s own clearance rows, read by PartForge\'s parseFlight, against the H13 band', () => {
  const ret = PF.parseFlight(fs.readFileSync(path.join(here, 'snapshots', 'dryrun-retainer-fixed.scad'), 'utf8'));
  const end = PF.parseFlight(fs.readFileSync(path.join(here, 'snapshots', 'dryrun-endcap.scad'), 'utf8'));
  const m6 = ret.holes.find((h) => /M6 bolt clearance/.test(h.name));
  const m8 = end.holes.find((h) => /M8 bolt pattern clearance/.test(h.name));
  for (const [h, key] of [[m6, 'M6'], [m8, 'M8']]) {
    assert.equal(h.tol_src, 'source'); assert.match(h.tol_ref, /^ISO 273 medium clearance/);
    assert.equal(h.tol_mm, 0.1);
    const ours = H.build({ size: key, plate_t: 30 }, D).features.find((x) => x.id === 'clearance');
    assert.equal(h.d_mm, row(key).clearance_medium_mm, 'the dry run declared the nominal ±0.1');
    // the dry run's band admits 0.1 below the ISO 273 minimum and rejects the top of H13
    assert.ok(close(h.d_mm - h.tol_mm, ours.band.lo - 0.1, 1e-9));
    assert.ok(h.d_mm + h.tol_mm < ours.band.hi);
  }
  const ours6 = H.build({ size: 'M6' }, D).flight.clamp.holes[0];
  assert.deepEqual([ours6.d_mm, ours6.tol_mm], [6.71, 0.11]);
  const ours8 = H.build({ size: 'M8', plate_t: 30 }, D).flight.clamp.holes[0];
  assert.deepEqual([ours8.d_mm, ours8.tol_mm], [9.11, 0.11], 'M8 medium 9.0 sits in the 6-10 mm step too: IT13 220 um');
});

test('finding: PartForge\'s own thread check (verbatim threadCheck) fails the table\'s minimum engagement at all 12 sizes', () => {
  const mat = PF.FLIGHT_MATERIALS['6061-T6'];
  assert.equal(mat.su, 310);
  assert.equal(PF.matClass(mat), 'aluminum'); assert.equal(PF.ENGAGEMENT_RULE.aluminum, 2.0);
  let fails = 0;
  for (const r of fm.rows) {
    const tc = PF.threadCheck({ size: r.key, engagement_mm: r.min_engagement_6061T6_8_8_mm, bolt_sigma_u_MPa: 800, internal_sigma_u_MPa: mat.su, internal_material_class: PF.matClass(mat) });
    if (!(tc.ok_strip && tc.ok_rule)) fails++;
  }
  assert.equal(fails, 12);
  const t = H.build({ size: 'M6', far: 'tapped', part_t: 16 }, D).features.find((x) => x.id === 'tapped');
  assert.equal(t.appCheck.ok, false);
  assert.ok(close(t.appCheck.Le_req_mm, 11.020163, 1e-6), 'M6: At 20.123 × 800 / (0.5 × 310 × 0.5π × 6)');
  assert.equal(t.appCheck.rule_mm, 12);
  assert.equal(t.appCheckAtLength.ok, true, '16 mm passes the app');
});

test('findings: the doctrine\'s nut pocket and tapped-hole wording, and its hand-typed metric sizes (a tripwire)', () => {
  const doc = PD.lines[PD.doctrineLine - PD.firstLine];
  assert.match(doc, /hex pockets to `nut_ac_min_mm` across corners/);
  assert.match(doc, /model a tapped hole at `minor_D1_mm`/);
  assert.match(doc, /counterbore to `cbore_d_mm` \(or knurled dk \+ 0\.4 mm\)/);
  // a true hexagon cut to e min across corners is narrower across flats than the nut, at every size
  assert.equal(fm.rows.filter((r) => r.nut_ac_min_mm * COS30 < r.nut_af_mm).length, 12);
  assert.ok(close(row('M6').nut_ac_min_mm * COS30, 9.5696, 1e-4));
  // the flight doctrine says the opposite about tapped holes
  assert.match(PF.DOCTRINE.standardSizes, /Model tapped holes at the tap drill/);
  assert.match(fm.columns.minor_D1_mm, /model tapped holes at D1/);
  // its hand-typed metric clearances and tap drills still agree with the table (today)
  const s = PF.DOCTRINE.standardSizes;
  const sect = (from, to) => s.slice(s.indexOf(from), to ? s.indexOf(to) : undefined);
  const pairs = (txt) => [...txt.matchAll(/(M\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/g)].map((m) => [m[1], +m[2]]);
  const med = pairs(sect('Clearance holes (ISO 273 medium)', 'fine series')), fine = pairs(sect('fine series', 'Tap drills')), tap = pairs(sect('Tap drills (metric coarse)', 'For UNIFIED'));
  assert.equal(med.length, 9); assert.equal(fine.length, 5); assert.equal(tap.length, 9);
  for (const [k, v] of med) assert.equal(v, row(k).clearance_medium_mm, `doctrine medium ${k}`);
  for (const [k, v] of fine) assert.equal(v, row(k).clearance_fine_mm, `doctrine fine ${k}`);
  for (const [k, v] of tap) assert.equal(v, row(k).tap_drill_mm, `doctrine tap ${k}`);
});

test('finding (live checkout): the shipped dbHints() line for M6 prints the recall counterbore under the row\'s [likely] tag', { skip: !haveRepo && 'no PartForge checkout' }, () => {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const a = html.indexOf('/* DB-BEGIN */'), b = html.indexOf('/* DB-END */');
  const ctx = { console }; vm.createContext(ctx);
  vm.runInContext(html.slice(a, b) + '\n;globalThis.__x = { dbHints };', ctx);
  const line = ctx.__x.dbHints('an M6 socket head cap screw in a counterbore').split('\n').find((l) => /^- M6 /.test(l));
  assert.ok(line, 'an M6 line');
  assert.match(line, /\[likely, disputed\]/, 'the row label (and the row\'s nut_h_min dispute), not the field\'s');
  assert.match(line, /counterbore Ø11/, 'cbore_d_mm, which field_confidence marks recall on every row');
  assert.match(line, /SHCS head Ø10 ×/, 'the plain-head dk, which the column says never to size a counterbore from');
  assert.ok(!/10\.22/.test(line), 'the knurled dk the column says to use is not in the line');
  assert.equal(row('M6').field_confidence.cbore_d_mm, 'recall');
  assert.match(PF.DOCTRINE.provenanceRule, /a \[certain\] or \[likely\] line is tol_src "source"/);
});

test('the SVG section and the text carry the same numbers as the result', () => {
  const r = H.build({ size: 'M6', far: 'nut', plate_t: 16 }, D);
  const s = H.svg(r);
  assert.match(s, /^<svg [^>]*viewBox="0 0 360 \d+"/);
  assert.ok(!/NaN|undefined|Infinity/.test(s));
  for (const t of ['Ø6.710 ±0.11', 'clearance H13 6.600–6.820', 'Ø10.750 ±0.13', 'counterbore 6.5 deep', 'hex 10.130 AF, 11.697 AC', 'nut pocket 5.2 deep']) assert.ok(s.includes(t), `svg shows ${t}`);
  const t = H.text(r);
  for (const x of ['Ø6.710 ±0.11 (limits 6.600–6.820)', 'nut_ac_min_mm = 11.05  [likely]', 'shown, not used: cbore_d_mm = 11  [recall]']) assert.ok(t.includes(x), `text shows ${x}`);
  for (const inp of combos()) { const z = H.svg(H.build(inp, D)); assert.ok(!/NaN|undefined|Infinity/.test(z), JSON.stringify(inp)); }
});

test('the CLI: exit 0 built, 2 refused, 3 usage; --verify runs PartForge\'s own parser', () => {
  const cli = (...a) => spawnSync('node', [path.join(here, 'hole-stack.mjs'), ...a], { encoding: 'utf8' });
  let r = cli('M6', '--far', 'nut', '--plate', '16', '--verify');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /flightLint\(OpenSCAD\): clean/);
  assert.match(r.stdout, /parseFlight\(clamp\): holes 1, bores 1, gauges 1; dropped 0, demoted 0; tol_src source 1, default 1/);
  r = cli('M7'); assert.equal(r.status, 2); assert.match(r.stdout, /M7 is not a row/);
  r = cli('M6', '--series', 'coarse'); assert.equal(r.status, 2);
  r = cli(); assert.equal(r.status, 3);
  r = cli('M6', '--bogus'); assert.equal(r.status, 3);
  r = cli('--help'); assert.equal(r.status, 0); assert.match(r.stdout, /Exit codes/);
  if (haveRepo) { r = cli('M6', '--repo', REPO, '--json'); assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).flight.clamp.holes[0].d_mm, 6.71); }
});

test('build-data --check: the snapshots are current against the checkout', { skip: !haveRepo && 'no PartForge checkout' }, () => {
  const r = spawnSync('node', [path.join(here, 'build-data.mjs'), REPO, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
