// Tests for Shadow Lint. Node built-ins only; from the bank root:
//   node --test ideas/07-shadow-lint/shadow.test.mjs
// WRITE_EXAMPLE=1 rewrites example.txt from the CLI instead of comparing against it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require(path.join(here, 'shadow.js'));
const PF = require(path.join(here, 'snapshots', 'flight-decl.js')); // PartForge's own parseFlight, cut from index.html
const snaps = path.join(here, 'snapshots');
const data = { metric: require(path.join(snaps, 'fasteners_metric.excerpt.js')), un: require(path.join(snaps, 'fasteners_un.excerpt.js')), motors: require(path.join(snaps, 'motor_perf.excerpt.js')), grades: require(path.join(snaps, 'grade_sy.excerpt.js')) };
const { PAIRS } = require(path.join(here, 'pairs.js'));
const read = (f) => fs.readFileSync(path.join(snaps, f), 'utf8');
const FIXTURES = fs.readdirSync(snaps).filter((f) => f.endsWith('.scad')).sort();
const sidecarOf = (f) => JSON.parse(fs.readFileSync(path.join(snaps, f + '.provenance.json'), 'utf8'));
const REAL = FIXTURES.filter((f) => sidecarOf(f).mode === 'copy');   // the files copied from the PartForge checkout
const lint = (f) => S.lint(read(f), data, f);
const input = (L, rowName, key) => { const r = L.result.rows.find((x) => x.name === rowName); assert.ok(r, `row "${rowName}" exists`); const i = r.inputs.find((x) => x.key === key); assert.ok(i, `input ${key} on "${rowName}"`); return i; };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const CLI = path.join(here, 'shadow-lint.mjs');
const run = (...args) => { const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd: path.resolve(here, '..', '..') }); return { code: r.status, out: r.stdout, err: r.stderr }; };

// Wrap a declaration object as the commented block the model emits (as PartForge's own test does).
const block = (obj, body = 'tess_tol = 0.01;\ncube(10);\n') => '// FLIGHT-BEGIN\n' + JSON.stringify(obj, null, 1).split('\n').map((l) => '// ' + l).join('\n') + '\n// FLIGHT-END\n' + body;

// ------------------------------------------------------------------------------- snapshots
test('every snapshot still hashes to what its sidecar recorded; copies equal their source bytes', () => {
  const files = fs.readdirSync(snaps).filter((f) => !f.endsWith('.provenance.json'));
  assert.equal(files.length, 19, `${files.length} snapshot files`);
  for (const f of files) {
    const side = JSON.parse(fs.readFileSync(path.join(snaps, f + '.provenance.json'), 'utf8'));
    assert.match(side.commit, /^[0-9a-f]{40}$/, f + ' sidecar commit');
    assert.ok(side.repo && side.path, f + ' sidecar repo/path');
    assert.equal(sha(fs.readFileSync(path.join(snaps, f))), side.writtenSha256, f + ' bytes unchanged since snapshot');
    if (side.mode === 'copy') { assert.equal(side.sourceSha256, side.writtenSha256, f + ' copy equals source'); assert.equal(side.readMatchesCommitted, true, f + ' read bytes matched the committed blob'); }
    else assert.equal(side.mode, 'derived', f + ' is a derived file with a sidecar');
  }
});

test('findings.js equals a fresh computation over the snapshots (the page cannot drift from the code)', () => {
  const F = require(path.join(here, 'findings.js'));
  const strip = (L) => (L.refusal ? L : { label: L.label, result: L.result });
  for (const f of FIXTURES) assert.deepEqual(F.fixtures[f], JSON.parse(JSON.stringify(strip(lint(f)))), 'fixture ' + f);
  assert.equal(Object.keys(F.fixtures).length, FIXTURES.length);
  PAIRS.forEach(([a, b, relation], i) => {
    const { A, B, ...d } = S.diffAttempts(read(a), read(b), data, [a, b]);
    assert.deepEqual(F.pairs[i], JSON.parse(JSON.stringify({ relation, ...d })), 'pair ' + a + ' → ' + b);
  });
  assert.match(F.pairs[2].relation, /^two independent runs, not a retry/);
  assert.equal(F.generated.commit, JSON.parse(fs.readFileSync(path.join(snaps, 'bulkhead.scad.provenance.json'), 'utf8')).commit);
});

test('the synthetic retry differs from the template only inside the FLIGHT block, by force_N 20000 → 12000', () => {
  const a = read('motor-retainer.scad'), b = read('motor-retainer.retry.scad');
  assert.notEqual(a, b);
  assert.equal(S.geometryText(a), S.geometryText(b), 'code outside comments is byte-identical');
  const la = a.split('\n'), lb = b.split('\n');
  const changed = la.map((l, i) => [l, lb[i]]).filter(([x, y]) => x !== y);
  assert.equal(changed.length, 1);
  assert.equal(changed[0][0].replace('"force_N":20000', '"force_N":12000'), changed[0][1]);
});

// ------------------------------------------------------------------------------- parser agreement
const SUBSET = (f) => ({ material: f.material, process: f.process, tolerance_class: f.tolerance_class, tess_tol_mm: f.tess_tol_mm, hazard: f.hazard, tier_declared: f.tier_declared,
  critical: f.critical, od: f.od, bores: f.bores, holes: f.holes, revolve: f.revolve, gauges: f.gauges, loads: f.loads, dropped: f.dropped, demoted: f.demoted });

test('the parser agrees with PartForge\'s parseFlight on every fixture (fields the evaluator reads, and flightCounts)', () => {
  for (const f of FIXTURES) {
    const mine = S.parseFlight(read(f)), theirs = PF.parseFlight(read(f));
    assert.ok(mine && theirs && !mine.malformed && !theirs.malformed, f + ' parses in both');
    assert.deepEqual(SUBSET(mine), SUBSET(theirs), f + ' field for field');
    assert.deepEqual(S.flightCounts(mine), PF.flightCounts(theirs), f + ' flightCounts');
  }
});

test('the parser agrees with parseFlight on edge cases: absence, malformed JSON, unknown checks, caps, demotion (revolve too), digit keys, booleans', () => {
  for (const code of ['cube(1);', '// FLIGHT-BEGIN\n// {"a":}\n// FLIGHT-END', '// FLIGHT-BEGIN\n// [1,2]\n// FLIGHT-END']) {
    const m = S.parseFlight(code), t = PF.parseFlight(code);
    assert.deepEqual(m, t, JSON.stringify(code));
  }
  const decl = { material: '6061-T6', process: 'cnc_lathe',
    critical: Array.from({ length: 30 }, (_, i) => ({ name: 'c' + i, module: 'main()', axis: 'z', nominal_mm: 10, tol_mm: 0.1, tol_src: 'source' })),
    od: [{ name: 'OD', d_mm: 50, tol_mm: 0.05, at_mm: [0, 0], axis: 'z', from_mm: 0, to_mm: 5, tol_src: 'source', tol_ref: 'ISO 286' }],
    bores: [{ name: 'bad', d_mm: 10, tol_mm: 0.1, axis: 'z', from_mm: 5, to_mm: 5 }],
    holes: [{ name: 'h', d_mm: 4.5, tol_mm: 0.1, pattern: 'circle', n: 4, bc_d_mm: 40, axis: 'z', from_mm: 0, to_mm: 5 }, { name: 'l', d_mm: 3.3, tol_mm: 0.1, at_mm: [[1, 2], [3, 4]], axis: 'z', from_mm: 1, to_mm: 4 }],
    revolve: [{ type: 'vonkarman', L_mm: 300, R_mm: 50, tip_at_mm: 0, tol_src: 'source' }, { type: 'conical', L_mm: 200, R_mm: 40, tip_at_mm: 10, direction: 1, tol_src: 'user' }],
    gauges: [{ module: 'go_plug', expect: 'blocked', why: 'the pocket is 4 mm deep' }, { module: '1bad' }],
    loads: [{ check: 'bolt_shear', name: 'b', size: 'M4', n: 4, force_N: 1000, plate_t_mm: 5, threads_in_shear: false, I_mm4: 12, 'excite_Hz': [80, 200], inputs_src: 'source' },
      { check: 'buckling', name: 'nope', force_N: 1 }, { check: 'thread', name: 't', size: 'M4', engagement_mm: 3, inputs_src: 'source', inputs_ref: 'the team' }] };
  const code = block(decl);
  const m = S.parseFlight(code), t = PF.parseFlight(code);
  assert.deepEqual(SUBSET(m), SUBSET(t));
  assert.equal(m.critical.length, 24, 'capped at FLIGHT_CAP');
  assert.equal(m.demoted, 24 + 1 + 1, '24 criticals and one revolve claiming source without a ref, plus the bolt_shear row, are demoted');
  assert.equal(t.demoted, m.demoted);
  assert.equal(m.revolve[0].tol_src, 'default', 'the revolve source claim without a reference is demoted, as PartForge does');
  assert.equal(m.revolve[1].direction, 1);
  assert.equal(m.gauges[0].expect, 'interfere');
  assert.equal(m.loads.length, 2, 'the unknown check is dropped');
  assert.equal(m.dropped, 3, 'one bad bore, one bad gauge module and one unknown check');
  assert.equal(m.loads[0].inputs_src, 'default');
  assert.equal(m.loads[1].inputs_src, 'source');
  // Finding F1: booleans become strings, so index.html:5809's `l.threads_in_shear === false` can never hold.
  assert.equal(t.loads[0].threads_in_shear, 'false');
  assert.equal(typeof t.loads[0].threads_in_shear, 'string');
  // (iii) of the evaluation's foundation C: a key with a digit is dropped; an array is flattened to a string
  assert.equal('I_mm4' in t.loads[0], false);
  assert.equal(t.loads[0].excite_Hz, '80,200');
  assert.equal(m.critical[0].module, 'main', 'module() parentheses stripped');
});

test('F2: the six-run rings claim inputs_src "source" with a motor key but no inputs_ref, and PartForge\'s parser demotes them to default', () => {
  for (const f of ['ring1.scad', 'ring3.scad', 'ring4.scad', 'ring6-after-doctrine-fix.scad']) {
    const raw = JSON.parse(read(f).match(/\/\/\s*FLIGHT-BEGIN\s*\n([\s\S]*?)\/\/\s*FLIGHT-END/)[1].split('\n').map((l) => l.replace(/^\s*\/\/ ?/, '')).join('\n'));
    assert.equal(raw.loads[0].inputs_src, 'source', f + ' declares source');
    assert.equal(raw.loads[0].inputs_ref, undefined, f + ' gives no inputs_ref');
    assert.equal(raw.loads[0].motor, 'Loki L2050');
    const t = PF.parseFlight(read(f));
    assert.equal(t.loads[0].inputs_src, 'default', f + ' demoted by parseFlight');
    assert.equal(t.demoted, 1);
    assert.equal(lint(f).result.rows[0].inputs_src, 'default');
  }
});

// ------------------------------------------------------------------------------- classification pins (the fixtures)
test('bulkhead: plate_t_mm 12.7 is witnessed by critical "plate thickness" 12.70; n 2 by the U-bolt holes; #8-32 by its tap drill; engagement 10 by the tapped span', () => {
  const L = lint('bulkhead.scad');
  const pt = input(L, 'U-bolt recovery shock', 'plate_t_mm');
  assert.equal(pt.class, 'WITNESSED');
  assert.match(pt.witness[0], /^critical "plate thickness" plate\/z 12\.70 ±0\.05 \(user\)/);
  assert.equal(pt.witness.length, 4, 'also three through-hole spans of 12.7');
  const n = input(L, 'U-bolt recovery shock', 'n');
  assert.equal(n.class, 'WITNESSED');
  assert.equal(n.witness.length, 1);
  assert.match(n.witness[0], /holes "U-bolt 1\/4-20" list × 2, Ø7 — a clearance for 1\/4-20 \(between major 6\.35 and close 6\.747 \/ normal 7\.144 \/ loose 7\.541\) \(fasteners_un likely\)/);
  assert.equal(input(L, 'U-bolt recovery shock', 'size').class, 'WITNESSED');
  assert.equal(input(L, 'U-bolt recovery shock', 'force_N').class, 'UNWITNESSED');
  assert.equal(input(L, 'U-bolt recovery shock', 'sf_min').class, 'POLICY');
  assert.match(input(L, 'U-bolt recovery shock', 'sf_min').note, /doctrine default for bolt_shear is 2\.0/);
  const sz = input(L, 'terminal block screws', 'size');
  assert.equal(sz.class, 'WITNESSED');
  assert.match(sz.witness[0], /holes "terminal block #8-32 tap drill" list × 2, Ø3\.45 — the 75% tap drill 3\.454 for #8-32 \(fasteners_un likely\)/);
  const en = input(L, 'terminal block screws', 'engagement_mm');
  assert.equal(en.class, 'DERIVABLE');
  assert.match(en.witness[0], /spans 2\.7→12\.7 = 10\.00, Ø3\.45 is the 75% tap drill 3\.454 for #8-32/);
  // the grade and the tapped material are inputs the check reads by name (GRADE_SY at :5804, FLIGHT_MATERIALS at :5772)
  const gr = input(L, 'U-bolt recovery shock', 'grade');
  assert.equal(gr.class, 'UNWITNESSED');
  assert.match(gr.note, /^grade A2-70 → bolt σy 450 MPa in the evaluator's GRADE_SY \(index\.html:5804\)/);
  assert.equal(input(L, 'terminal block screws', 'internal_material').class, 'UNWITNESSED');
  // the thread check never reads sf_min (index.html:5775): listed as not read, not counted as a threshold
  const thr = L.result.rows[1];
  assert.deepEqual(thr.unread.map((u) => [u.key, u.value]), [['sf_min', 2]]);
  assert.match(thr.unread[0].note, /thread check ignores it: it sets sf_min 1\.0/);
  assert.ok(!thr.inputs.some((i) => i.key === 'sf_min'));
  assert.deepEqual(thr.missing.map((m) => [m.key, m.effect]), [['bolt_sigma_u_MPa', 'assumed']]);
  assert.match(thr.missing[0].text, /assumes a bolt UTS of 800 MPa \(index\.html:5773\)/);
  assert.deepEqual(L.result.totals, { WITNESSED: 4, DERIVABLE: 1, UNWITNESSED: 3, POLICY: 1 });
  assert.deepEqual(L.result.inventionSurface, ['U-bolt recovery shock.grade', 'U-bolt recovery shock.force_N', 'terminal block screws.internal_material']);
  assert.deepEqual(L.result.rows[0].other, {});
});

test('endcap: ri 47.98 = 95.96/2 and t 2.77 = (101.50 − 95.96)/2 are derivable; the 17.4 face plate is not; M8 thread is in the mating part; the M8 pattern witnesses n', () => {
  const L = lint('endcap.scad');
  const ri = input(L, 'shoulder wall at O-ring groove root', 'ri_mm');
  assert.equal(ri.class, 'DERIVABLE');
  assert.equal(ri.witness[0], 'bore "o-ring groove bottom diameter" Ø95.96/2 = 47.98');
  const t = input(L, 'shoulder wall at O-ring groove root', 't_mm');
  assert.equal(t.class, 'DERIVABLE');
  assert.equal(t.witness[0], 'wall (101.5 − 95.96)/2 = 2.77 from od "shoulder OD" and bore "o-ring groove bottom diameter"');
  // ... and both carry the groove caveat: the bore (z 11.15–15.9) lies strictly inside the shoulder OD (z 5.4–25.4),
  // which is how an external O-ring groove declared as a bore looks (PartForge's CMM rejects it: tests/dryrun/cases.json)
  assert.match(t.note, /^caveat: bore "o-ring groove bottom diameter" \(z 11\.15–15\.9\) lies strictly inside od "shoulder OD" \(z 5\.4–25\.4\), the signature of an external groove declared as a bore; if it is one, this number is the groove depth/);
  assert.match(ri.note, /groove-root radius, not the inside of a pressurised wall/);
  assert.equal(input(L, 'shoulder wall at O-ring groove root', 'P_MPa').class, 'UNWITNESSED');
  const ri2 = input(L, 'flange face plate at MEOP', 'ri_mm');
  assert.equal(ri2.class, 'DERIVABLE');
  assert.equal(ri2.witness[0], 'bore "lightening pocket bore" Ø80/2 = 40.00');
  assert.equal(ri2.note, '', 'the pocket opens at z 0, the face of the flange: no groove caveat');
  const t2 = input(L, 'flange face plate at MEOP', 't_mm');
  assert.equal(t2.class, 'UNWITNESSED');
  assert.ok(Math.abs(t2.nearest.delta - 2.6) < 1e-9, 'nearest candidate is 2.6 away (shoulder length 20)');
  assert.match(t2.note, /nearest critical "shoulder length"/);
  // the flange OD (0–5.4) and the groove bore (11.15–15.9) do not overlap axially, so they form no wall;
  // the flange OD and the lightening pocket (0–8) do, and that wall is (127 − 80)/2 = 23.5
  const walls = S.candidates(L.flight).walls;
  assert.ok(!walls.some((w) => w.name === 'flange OD − o-ring groove bottom diameter'), 'no wall between flange OD and the groove bore');
  assert.ok(walls.some((w) => w.name === 'flange OD − lightening pocket bore' && Math.abs(w.value - 23.5) < 1e-9), 'the flange–pocket wall exists');
  assert.deepEqual(walls.map((w) => w.name).sort(), ['flange OD − lightening pocket bore', 'shoulder OD − lightening pocket bore', 'shoulder OD − npt port tap drill', 'shoulder OD − o-ring groove bottom diameter'].sort(), 'the four coaxial, axially overlapping OD/bore pairs');
  assert.deepEqual(walls.filter((w) => w.caveat).map((w) => w.name), ['shoulder OD − o-ring groove bottom diameter'], 'only the groove bore carries the caveat');
  assert.equal(input(L, 'M8 bolts into aluminium tank flange', 'size').class, 'UNWITNESSED');
  assert.match(input(L, 'M8 bolts into aluminium tank flange', 'size').note, /tapped part is probably the mating part/);
  assert.equal(input(L, 'M8 bolts into aluminium tank flange', 'engagement_mm').class, 'UNWITNESSED');
  const n = input(L, 'M8 bolt pattern pressure retention', 'n');
  assert.equal(n.class, 'WITNESSED');
  assert.match(n.witness[0], /holes "M8 bolt pattern clearance" circle × 8, Ø9 — the medium clearance 9 for M8 \(fasteners_metric likely\)/);
  const pt = input(L, 'M8 bolt pattern pressure retention', 'plate_t_mm');
  assert.equal(pt.class, 'DERIVABLE');
  assert.match(pt.witness[0], /holes "M8 bolt pattern clearance" spans 0→25\.4 = 25\.40/);
  assert.equal(input(L, 'M8 bolt pattern pressure retention', 'force_N').class, 'UNWITNESSED');
  assert.equal(input(L, 'M8 bolt pattern pressure retention', 'grade').class, 'UNWITNESSED');
  assert.equal(L.result.inventionSurface.length, 8);
});

test('coupler: plate_t_mm 3.2 is derivable two ways (wall and pin span); n 3 is unwitnessed because only one pin per end is declared; the #2-56 row is recall and says so', () => {
  const L = lint('coupler.scad');
  const pt = input(L, '3 nylon shear pins at separation', 'plate_t_mm');
  assert.equal(pt.class, 'DERIVABLE');
  assert.equal(pt.witness[0], 'wall (149.3 − 142.9)/2 = 3.20 from od "coupler OD" and bore "bore"');
  assert.match(pt.witness[1], /holes "shear pin, aft, 0°" spans 74\.65→71\.45 = 3\.20/);
  assert.equal(pt.witness.length, 4);
  const n = input(L, '3 nylon shear pins at separation', 'n');
  assert.equal(n.class, 'UNWITNESSED');
  assert.match(n.note, /^no hole row has 3 entries; the clearance-size rows for #2-56 have/);
  const sz = input(L, '3 nylon shear pins at separation', 'size');
  assert.equal(sz.class, 'WITNESSED');
  assert.match(sz.witness[0], /\(fasteners_un recall\)/, 'a recall row is presented as recall');
  assert.equal(data.un.rows.find((r) => r.key === '#2-56').confidence, 'recall');
  assert.equal(input(L, '3 nylon shear pins at separation', 'bolt_sigma_y_MPa').class, 'UNWITNESSED');
  assert.equal(input(L, '3 nylon shear pins at separation', 'sf_min').value, 1);
  assert.deepEqual(L.result.rows[0].missing, [], 'bolt_sigma_y_MPa stands in for the grade (index.html:5805): no gap');
});

test('fin: root 300, tip 100, span 140, thick 6.35 are witnessed by the critical extents; v_max and alt are not', () => {
  const L = lint('fin.scad');
  for (const [k, w] of [['root_mm', 'critical "root chord" fin/x 300.00 ±0.2 (default)'], ['tip_mm', 'critical "tip chord at the tip flat" tip_chord_gauge/x 100.00 ±0.2 (default)'], ['span_mm', 'critical "semi-span" fin/y 140.00 ±0.2 (default)'], ['thick_mm', 'critical "plate thickness" fin/z 6.35 ±0.05 (default)']]) {
    const i = input(L, 'fin at max Q', k);
    assert.equal(i.class, 'WITNESSED', k);
    assert.equal(i.witness[0], w, k);
  }
  assert.equal(input(L, 'fin at max Q', 'v_max_m_s').class, 'UNWITNESSED');
  assert.equal(input(L, 'fin at max Q', 'alt_m').class, 'UNWITNESSED');
  assert.equal(input(L, 'fin at max Q', 'sf_min').class, 'POLICY');
  assert.match(input(L, 'fin at max Q', 'sf_min').note, /1\.5/);
  assert.deepEqual(L.result.inventionSurface, ['fin at max Q.v_max_m_s', 'fin at max Q.alt_m']);
  assert.deepEqual(L.result.rows[0].missing.map((m) => [m.key, m.effect]), [['sweep_mm', 'assumed']]);
});

test('retainers and centering ring: n 8 ↔ the M6 holes; the thread check into the mating part is unwitnessed; the ring picks the M4 row, not the 4 lightening holes', () => {
  for (const [f, row, hole] of [['motor-retainer.scad', 'thrust bolts', 'M6 retention bolts'], ['retainer.scad', 'M6 thrust bolts 8 off', 'M6 bolt clearance holes'], ['retainer-fixed.scad', 'M6 thrust bolts 8 off', 'M6 bolt clearance holes']]) {
    const L = lint(f);
    const n = input(L, row, 'n');
    assert.equal(n.class, 'WITNESSED', f);
    assert.equal(n.value, 8);
    assert.match(n.witness[0], new RegExp('^holes "' + hole + '" circle × 8'), f);
    const thr = L.result.rows.find((r) => r.check === 'thread');
    assert.equal(thr.inputs.find((i) => i.key === 'size').class, 'UNWITNESSED', f + ' thread size');
    assert.equal(thr.inputs.find((i) => i.key === 'engagement_mm').class, 'UNWITNESSED', f + ' engagement');
    if (f !== 'motor-retainer.scad') assert.match(input(L, row, 'shear_plane').note, /gross area πd²\/4 instead of the tensile stress area/, f + ' shank in the shear plane');
  }
  const mr = lint('motor-retainer.scad');
  assert.match(input(mr, 'thrust bolts', 'plate_t_mm').witness[0], /^critical "plate thickness" plate\/z 10\.00/);
  const cr = lint('centering-ring.scad');
  const n = input(cr, 'thrust bolts', 'n');
  assert.equal(n.class, 'WITNESSED');
  assert.equal(n.witness.length, 1);
  assert.match(n.witness[0], /^holes "M4 retention bolts" circle × 4, Ø4\.5 — the medium clearance 4\.5 for M4/);
  assert.ok(!n.witness[0].includes('lightening'));
});

test('the four ring runs: plate_t_mm 8 witnessed by a critical; n witnessed by the size-compatible bolt row; force_N 3331 unwitnessed and equal to the Loki L2050 certified peak', () => {
  const expect = { 'ring1.scad': ['thrust bolts', 'M5', 8], 'ring3.scad': ['airframe mounting holes', 'M4', 6], 'ring4.scad': ['perimeter mounting holes', 'M3', 6], 'ring6-after-doctrine-fix.scad': ['mounting bolt circle', 'M5', 8] };
  const loki = data.motors.rows.find((r) => r.name === 'L2050' && r.mfr === 'Loki');
  assert.equal(loki.max_thrust_N, 3331);
  assert.equal(loki.max_thrust_src, 'certified');
  assert.equal(loki.confidence, 'likely');
  for (const [f, [hole, size, count]] of Object.entries(expect)) {
    const L = lint(f);
    const row = L.result.rows[0];
    assert.equal(row.check, 'bolt_shear');
    const pt = row.inputs.find((i) => i.key === 'plate_t_mm');
    assert.equal(pt.class, 'WITNESSED', f);
    assert.equal(pt.value, 8);
    assert.match(pt.witness[0], /^critical ".*" \w+\/z 8\.00/, f);
    const n = row.inputs.find((i) => i.key === 'n');
    assert.equal(n.class, 'WITNESSED', f);
    assert.equal(n.value, count, f);
    assert.match(n.witness[0], new RegExp('^holes "' + hole + '" circle × ' + count + ', .* for ' + size + ' '), f);
    const fN = row.inputs.find((i) => i.key === 'force_N');
    assert.equal(fN.class, 'UNWITNESSED', f);
    assert.equal(fN.value, 3331);
    assert.match(fN.note, /certified peak of Loki L2050 \(3331 N, certified, motor_perf likely\) — a data witness, not a geometric one; the declared value equals that peak/, f);
    assert.equal(row.inputs.find((i) => i.key === 'grade').class, 'UNWITNESSED', f + ' grade');
  }
  const r1 = read('ring1.scad');
  const above = S.lint(r1.replace('"force_N":3331', '"force_N":4000'), data).result.rows[0].inputs.find((i) => i.key === 'force_N');
  assert.match(above.note, /the declared value is above that peak \(a floor, never a ceiling\)$/);
  const below = S.lint(r1.replace('"force_N":3331', '"force_N":3000'), data).result.rows[0].inputs.find((i) => i.key === 'force_N');
  assert.match(below.note, /the declared value is below that peak, so the evaluator refuses the row \(index\.html:5792\)$/);
});

test('force_N, P_MPa, v_max_m_s, alt_m and strengths are unwitnessed on every fixture row that carries them', () => {
  let seen = 0;
  for (const f of FIXTURES) {
    const L = lint(f);
    if (L.refusal) continue;
    for (const r of L.result.rows) for (const i of r.inputs) if (['force_N', 'P_MPa', 'v_max_m_s', 'alt_m', 'bolt_sigma_y_MPa', 'bolt_sigma_u_MPa'].includes(i.key)) { seen++; assert.equal(i.class, 'UNWITNESSED', f + ' ' + r.name + ' ' + i.key); assert.equal(i.witness.length, 0); }
  }
  assert.equal(seen, 17, `${seen} such inputs checked across the fixtures`);
  // and the inputs the checks read by name: 11 grades, 6 tapped materials, 3 shanks in the shear plane
  const byName = {};
  for (const f of FIXTURES) { const L = lint(f); if (L.refusal) continue; for (const r of L.result.rows) for (const i of r.inputs) if (['grade', 'material', 'shear plane'].includes(i.kind)) { assert.equal(i.class, 'UNWITNESSED'); byName[i.kind] = (byName[i.kind] || 0) + 1; } }
  assert.deepEqual(byName, { grade: 11, material: 6, 'shear plane': 3 });
});

test('refusals: no loads rows, no FLIGHT block, malformed JSON, an empty loads array', () => {
  assert.equal(lint('av-sled.scad').refusal.code, 'insufficient_data');
  assert.equal(S.lint('cube(1);', data, 'x').refusal.code, 'not_found');
  assert.equal(S.lint('// FLIGHT-BEGIN\n// {"material":}\n// FLIGHT-END\n', data).refusal.code, 'invalid_input');
  const empty = S.lint(block({ material: '6061-T6', loads: [] }), data);
  assert.equal(empty.refusal.code, 'insufficient_data');
  assert.ok(empty.refusal.what_would_help.length > 20);
});

// ------------------------------------------------------------------------------- hand-worked declaration
const HAND = { material: '6061-T6', process: 'cnc_lathe',
  critical: [{ name: 'plate', module: 'plate', axis: 'z', nominal_mm: 5.0, tol_mm: 0.05, tol_src: 'user' }],
  od: [{ name: 'OD', d_mm: 50, tol_mm: 0.05, at_mm: [0, 0], axis: 'z', from_mm: 0, to_mm: 5 }, { name: 'boss', d_mm: 30, tol_mm: 0.05, at_mm: [0, 0], axis: 'z', from_mm: 5, to_mm: 9 }],
  bores: [{ name: 'bore', d_mm: 40, tol_mm: 0.05, at_mm: [0, 0], axis: 'z', from_mm: 5, to_mm: 0 }, { name: 'offset bore', d_mm: 20, tol_mm: 0.05, at_mm: [10, 0], axis: 'z', from_mm: 5, to_mm: 0 }],
  holes: [{ name: 'bolts', d_mm: 4.5, tol_mm: 0.1, pattern: 'circle', n: 4, bc_d_mm: 45, axis: 'z', from_mm: 0, to_mm: 5 }, { name: 'taps', d_mm: 3.3, tol_mm: 0.1, pattern: 'list', at_mm: [[0, 20], [0, -20]], axis: 'z', from_mm: 1, to_mm: 4 }],
  loads: [{ check: 'bolt_shear', name: 'b', size: 'M4', grade: '8.8', n: 4, force_N: 1000, plate_t_mm: 5.0, sf_min: 2.0 },
    { check: 'hoop', name: 'h', P_MPa: 1, ri_mm: 20, t_mm: 5.0 },
    { check: 'thread', name: 't', size: 'M4', engagement_mm: 3 }] };

test('hand-worked declaration: every rule fires where it should (critical, span, wall, radius, count, clearance, tap drill)', () => {
  const L = S.lint(block(HAND), data, 'hand');
  const b = L.result.rows[0], h = L.result.rows[1], t = L.result.rows[2];
  const pt = b.inputs.find((i) => i.key === 'plate_t_mm');
  assert.equal(pt.class, 'WITNESSED');
  // critical 5 (witness), wall (50−40)/2 = 5 (overlapping 0–5), spans: OD 0→5, bore 5→0, offset bore 5→0, bolts 0→5
  assert.equal(pt.witness.length, 1 + 1 + 4);
  assert.ok(!pt.witness.some((w) => w.includes('boss')), 'the boss (5–9) does not overlap the bore (0–5): no wall from it');
  assert.ok(!pt.witness.some((w) => w.includes('offset bore') && w.startsWith('wall')), 'the offset bore is not coaxial: no wall from it');
  assert.equal(b.inputs.find((i) => i.key === 'n').class, 'WITNESSED');
  assert.match(b.inputs.find((i) => i.key === 'n').witness[0], /^holes "bolts" circle × 4, Ø4\.5 — the medium clearance 4\.5 for M4/);
  assert.equal(b.inputs.find((i) => i.key === 'size').class, 'WITNESSED');
  assert.equal(b.inputs.find((i) => i.key === 'force_N').class, 'UNWITNESSED');
  assert.equal(b.inputs.find((i) => i.key === 'sf_min').class, 'POLICY');
  assert.deepEqual(b.other, {});
  assert.equal(b.inputs.find((i) => i.key === 'grade').class, 'UNWITNESSED');
  assert.equal(h.inputs.find((i) => i.key === 'ri_mm').class, 'DERIVABLE');
  assert.equal(h.inputs.find((i) => i.key === 'ri_mm').witness[0], 'bore "bore" Ø40/2 = 20.00');
  assert.equal(h.inputs.find((i) => i.key === 't_mm').class, 'WITNESSED');
  assert.equal(h.inputs.find((i) => i.key === 'P_MPa').class, 'UNWITNESSED');
  assert.deepEqual(h.missing.map((m) => [m.key, m.effect]), [['sf_min', 'assumed']], 'no sf_min: the doctrine default 2.0 is assumed');
  assert.equal(t.inputs.find((i) => i.key === 'size').class, 'WITNESSED');
  assert.match(t.inputs.find((i) => i.key === 'size').witness[0], /^holes "taps" list × 2, Ø3\.3 — the tap drill 3\.3 for M4 \(fasteners_metric likely\)/);
  const en = t.inputs.find((i) => i.key === 'engagement_mm');
  assert.equal(en.class, 'DERIVABLE');
  assert.match(en.witness[0], /^holes "taps" spans 1→4 = 3\.00, Ø3\.3 is the tap drill 3\.3 for M4/);
  // bolt_shear: size, n, plate_t_mm; hoop: t_mm; thread: size → 5 witnessed; ri_mm and engagement_mm derivable;
  // force_N, grade and P_MPa unwitnessed; one sf_min
  assert.deepEqual(L.result.totals, { WITNESSED: 5, DERIVABLE: 2, UNWITNESSED: 3, POLICY: 1 });
});

test('tolerance edges: 5.04 is inside the critical\'s ±0.05; 5.06 misses it but the bolt holes\' span (±0.1) still derives it; 5.11 misses everything; a count nobody declared; a missing required input', () => {
  const mk = (pt) => S.lint(block({ ...HAND, loads: [{ check: 'bolt_shear', name: 'b', size: 'M4', n: 5, force_N: 1, plate_t_mm: pt }] }), data).result.rows[0];
  assert.equal(mk(5.04).inputs.find((i) => i.key === 'plate_t_mm').class, 'WITNESSED');
  const edge = mk(5.06).inputs.find((i) => i.key === 'plate_t_mm');
  assert.equal(edge.class, 'DERIVABLE');
  assert.deepEqual(edge.witness, ['holes "bolts" spans 0→5 = 5.00'], 'only the hole row, whose tolerance is 0.1, still reaches 5.06');
  const far = mk(5.11).inputs.find((i) => i.key === 'plate_t_mm');
  assert.equal(far.class, 'UNWITNESSED');
  assert.ok(Math.abs(far.nearest.delta - 0.11) < 1e-9);
  const n = mk(5).inputs.find((i) => i.key === 'n');
  assert.equal(n.class, 'UNWITNESSED');
  assert.match(n.note, /^no hole row has 5 entries; the clearance-size rows for M4 have holes "bolts" circle × 4/);
  const miss = S.lint(block({ ...HAND, loads: [{ check: 'hoop', name: 'h', P_MPa: 1, ri_mm: 20 }] }), data).result.rows[0];
  assert.deepEqual(miss.missing.map((m) => [m.key, m.effect]), [['t_mm', 'refused'], ['sf_min', 'assumed']]);
  // a count that matches a row of the wrong diameter
  const wrongD = S.lint(block({ ...HAND, loads: [{ check: 'bolt_shear', name: 'b', size: 'M8', n: 4, force_N: 1, plate_t_mm: 5 }] }), data).result.rows[0].inputs.find((i) => i.key === 'n');
  assert.equal(wrongD.class, 'UNWITNESSED');
  assert.match(wrongD.note, /count matches holes "bolts" circle × 4, Ø4\.5 but no row with that count is a clearance size for M8/);
  // an unknown numeric key feeds no check: listed as not read, and not counted in the invention surface
  const unk = S.lint(block({ ...HAND, loads: [{ check: 'bolt_shear', name: 'b', size: 'M4', n: 4, force_N: 1, plate_t_mm: 5, kt: 3 }] }), data).result;
  assert.ok(!unk.rows[0].inputs.some((i) => i.key === 'kt'));
  assert.deepEqual(unk.rows[0].unread.map((u) => u.key), ['kt']);
  assert.ok(!unk.inventionSurface.includes('b.kt'));
});

test('tolerance edges have teeth: a bore radius gets half the diameter tolerance; a value exactly one tolerance away still matches; planform sees extents only; engagement ignores OD spans', () => {
  const hoop = (ri) => S.lint(block({ ...HAND, loads: [{ check: 'hoop', name: 'h', P_MPa: 1, ri_mm: ri, t_mm: 5 }] }), data).result.rows[0].inputs.find((i) => i.key === 'ri_mm');
  assert.equal(hoop(20.02).class, 'DERIVABLE', 'Ø40 ±0.05 → r 20 ±0.025: 20.02 is inside');
  assert.equal(hoop(20.03).class, 'UNWITNESSED', '20.03 is outside ±0.025 (it would be inside ±0.05)');
  // 12.75 − 12.7 is 0.05000000000000071 in floating point: the rule says "within tolerance", so it must still match
  const one = { material: '6061-T6', critical: [{ name: 'plate', module: 'plate', axis: 'z', nominal_mm: 12.7, tol_mm: 0.05 }],
    holes: [{ name: 'bolts', d_mm: 4.5, tol_mm: 0.1, pattern: 'circle', n: 4, bc_d_mm: 45, axis: 'z', from_mm: 0, to_mm: 3 }] };
  const edge = S.lint(block({ ...one, loads: [{ check: 'bolt_shear', name: 'b', size: 'M4', grade: '8.8', n: 4, force_N: 1, plate_t_mm: 12.75 }] }), data).result.rows[0].inputs.find((i) => i.key === 'plate_t_mm');
  assert.equal(edge.class, 'WITNESSED');
  assert.equal(S.lint(block({ ...one, loads: [{ check: 'bolt_shear', name: 'b', size: 'M4', grade: '8.8', n: 4, force_N: 1, plate_t_mm: 12.76 }] }), data).result.rows[0].inputs.find((i) => i.key === 'plate_t_mm').class, 'UNWITNESSED');
  // a planform number equal only to a hole span (3) is not a planform witness
  const fin = S.lint(block({ ...one, loads: [{ check: 'flutter', name: 'f', root_mm: 3, tip_mm: 1, span_mm: 2, thick_mm: 12.7, v_max_m_s: 100, alt_m: 0 }] }), data).result.rows[0];
  assert.equal(fin.inputs.find((i) => i.key === 'root_mm').class, 'UNWITNESSED');
  assert.equal(fin.inputs.find((i) => i.key === 'thick_mm').class, 'WITNESSED');
  // engagement 4 equals only the boss OD's span (5→9); an OD is not a threaded hole
  const en = S.lint(block({ ...HAND, loads: [{ check: 'thread', name: 't', size: 'M4', engagement_mm: 4 }] }), data).result.rows[0].inputs.find((i) => i.key === 'engagement_mm');
  assert.equal(en.class, 'UNWITNESSED');
  assert.ok(!/boss/.test(en.note), 'the OD span is not named as a candidate');
});

test('strings and gaps: a numeric string is read as +value (as the evaluator does); garbage, absences and the plate_t_mm null bug are said per key', () => {
  // the reviewer's case: every number of a bolt_shear row written as a string
  const strs = S.lint(block({ ...HAND, loads: [{ check: 'bolt_shear', name: 'b', size: 'M4', grade: '8.8', n: '4', force_N: '12000', plate_t_mm: '5', sf_min: '1.0' }] }), data).result;
  const r = strs.rows[0];
  assert.deepEqual(r.other, {}, 'nothing numeric hides under "other keys"');
  assert.equal(r.inputs.find((i) => i.key === 'n').class, 'WITNESSED');
  assert.equal(r.inputs.find((i) => i.key === 'n').value, 4);
  const fN = r.inputs.find((i) => i.key === 'force_N');
  assert.equal(fN.class, 'UNWITNESSED'); assert.equal(fN.value, 12000); assert.equal(fN.declared, '12000');
  assert.match(fN.note, /declared as the string "12000"; the evaluator reads \+value = 12000/);
  assert.equal(r.inputs.find((i) => i.key === 'plate_t_mm').class, 'WITNESSED');
  assert.equal(r.inputs.find((i) => i.key === 'sf_min').class, 'POLICY');
  assert.deepEqual(strs.totals, { WITNESSED: 3, DERIVABLE: 0, UNWITNESSED: 2, POLICY: 1 });
  assert.deepEqual(strs.inventionSurface, ['b.grade', 'b.force_N']);
  // garbage for a required key is a hole the evaluator refuses, not a silent zero
  const bad = S.lint(block({ ...HAND, loads: [{ check: 'hoop', name: 'h', P_MPa: 'abc', ri_mm: 20, t_mm: 5, sf_min: 2 }] }), data).result.rows[0];
  assert.ok(!bad.inputs.some((i) => i.key === 'P_MPa'));
  assert.deepEqual(bad.missing.map((m) => [m.key, m.declared, m.effect]), [['P_MPa', 'abc', 'refused']]);
  assert.match(bad.missing[0].text, /^declared "abc", which the evaluator does not read as a positive number; the evaluator refuses this row without it \(index\.html:5756\)/);
  // per-key absences: n → 1 bolt; plate_t_mm → bearing SF 0 (F7); no grade → refused; flutter alt_m → sea level
  const gaps = S.lint(block({ ...HAND, loads: [{ check: 'bolt_shear', name: 'b', size: 'M4', force_N: 1000 }, { check: 'flutter', name: 'f', root_mm: 5, tip_mm: 2, span_mm: 3, thick_mm: 5, v_max_m_s: 100, sf_min: 1.5 }] }), data).result;
  const g0 = Object.fromEntries(gaps.rows[0].missing.map((m) => [m.key, m]));
  assert.deepEqual(Object.keys(g0).sort(), ['grade', 'n', 'plate_t_mm', 'sf_min']);
  assert.equal(g0.n.effect, 'assumed'); assert.match(g0.n.text, /silently assumes 1 bolt/);
  assert.equal(g0.plate_t_mm.effect, 'fails'); assert.match(g0.plate_t_mm.text, /bearing SF 0, so the row fails with SF 0 \(index\.html:5810 with :887–897/);
  assert.equal(g0.grade.effect, 'refused'); assert.match(g0.grade.text, /neither a known grade nor bolt_sigma_y_MPa \(index\.html:5804–5808\)/);
  const g1 = Object.fromEntries(gaps.rows[1].missing.map((m) => [m.key, m]));
  assert.equal(g1.alt_m.effect, 'assumed'); assert.match(g1.alt_m.text, /assumes sea level/);
  // a grade the evaluator does not know is refused; n 2.4 is read as 2
  const odd = S.lint(block({ ...HAND, loads: [{ check: 'bolt_shear', name: 'b', size: 'M4', grade: '9.9', n: 4.4, force_N: 1, plate_t_mm: 5 }] }), data).result.rows[0];
  assert.deepEqual(odd.missing.filter((m) => m.key === 'grade').map((m) => m.effect), ['refused']);
  assert.equal(odd.inputs.find((i) => i.key === 'n').value, 4);
  assert.match(odd.inputs.find((i) => i.key === 'n').note, /declared 4\.4; the evaluator reads it as 4/);
});

test('GRADE_SY is the evaluator\'s own line, cut verbatim from index.html and parsed entry for entry', () => {
  const g = data.grades;
  assert.equal(g.line, 5804);
  assert.match(g.source_line, /^const GRADE_SY = \{ '8\.8':640, '10\.9':940, '12\.9':1100, '2':393,/);
  const parsed = Object.fromEntries([...g.source_line.matchAll(/'([^']+)':(\d+)/g)].map((m) => [m[1], +m[2]]));
  assert.deepEqual(g.GRADE_SY, parsed);
  assert.equal(Object.keys(parsed).length, 12);
});

test('thread sizes normalise and the fastener bands behave', () => {
  assert.equal(S.sizeKey('M6x1'), 'M6'); assert.equal(S.sizeKey('m6'), 'M6'); assert.equal(S.sizeKey('M2.5'), 'M2.5');
  assert.equal(S.sizeKey('#8-32'), '#8-32'); assert.equal(S.sizeKey('8-32'), '#8-32'); assert.equal(S.sizeKey('1/4-20'), '1/4-20'); assert.equal(S.sizeKey('nonsense'), null);
  const idx = S.fastenerIndex(data);
  assert.equal(idx.M6.major_mm, 6); assert.equal(idx['1/4-20'].major_mm, 6.35);
  assert.ok(S.clearanceFor(idx.M6, 6.4, 0.1) && S.clearanceFor(idx.M6, 6.6, 0.1) && S.clearanceFor(idx.M6, 7.0, 0.1));
  assert.equal(S.clearanceFor(idx.M6, 5.8, 0.1), null, 'below the major diameter is not a clearance');
  assert.equal(S.clearanceFor(idx.M6, 7.2, 0.1), null, 'above the coarse clearance plus tolerance is not a clearance');
  assert.ok(S.clearanceFor(idx.M6, 7.08, 0.1), '7.08 ±0.1 reaches the coarse clearance 7.0: the hole tolerance widens the band');
  assert.equal(S.clearanceFor(idx.M6, 7.08, 0.05), null, '7.08 ±0.05 does not');
  assert.match(S.tapFor(idx.M6, 5.0, 0.05).label, /^the tap drill 5 for M6/);
  assert.equal(S.tapFor(idx.M6, 6.4, 0.05), null);
  assert.match(S.tapFor(idx['#8-32'], 3.45, 0.1).label, /75% tap drill 3\.454/);
  assert.equal(S.lint(block({ ...HAND, loads: [{ check: 'bolt_shear', name: 'b', size: '7/16-20', n: 4, force_N: 1, plate_t_mm: 5 }] }), data).result.rows[0].inputs.find((i) => i.key === 'n').class, 'WITNESSED', 'an unknown size falls back to a count-only witness');
  // every excerpt row keeps its confidence field, and the metric excerpt has all 12 rows, the UN excerpt all 16;
  // the per-row source string (identical across a table) is kept once, and the licence note travels with the excerpt
  assert.equal(data.metric.rows.length, 12); assert.equal(data.un.rows.length, 16);
  for (const r of [...data.metric.rows, ...data.un.rows, ...data.motors.rows]) assert.match(r.confidence, /^(certain|likely|recall)$/);
  assert.match(data.un.rows_source, /ASME B1\.1-2003/); assert.match(data.metric.rows_source, /ISO 261/);
  assert.match(data.un.license_note, /cq_warehouse is Apache-2\.0/); assert.match(data.motors.rows[0].source, /thrustcurve-db 4\.0\.1 \(ISC/);
  assert.deepEqual(data.un.rows.filter((r) => r.confidence === 'recall').map((r) => r.key), ['#2-56', '#12-24', '1/2-13', '1/2-20'], 'four UN rows are recall; the fixtures touch only #2-56');
  assert.deepEqual(data.un.rows.filter((r) => r.source).map((r) => r.key), ['#12-24'], 'the one UN row whose source text differs keeps its own');
  assert.equal(data.metric.rows.filter((r) => r.source).length, 0, 'every metric row shares rows_source');
});

// ------------------------------------------------------------------------------- the differ
test('synthetic retry: one input moved while the geometry is byte-identical → exactly one finding', () => {
  const D = S.diffAttempts(read('motor-retainer.scad'), read('motor-retainer.retry.scad'), data, ['a', 'b']);
  assert.equal(D.geometry.identical, true);
  assert.equal(D.geometry.identicalFiles, false);
  assert.deepEqual(D.moved.map((m) => [m.key, m.from, m.to, m.before, m.after, m.verdict]), [['force_N', 20000, 12000, 'UNWITNESSED', 'UNWITNESSED', 'suspicious']]);
  assert.deepEqual(D.floor.lost, []);
  assert.equal(D.findings.length, 1);
  assert.equal(D.findings[0].code, 'input_moved_geometry_unchanged');
  assert.equal(D.findings[0].text, 'bolt_shear "thrust bolts": force_N 20000 → 12000 while the geometry is byte-identical — a load lowered: the check got easier and nothing in the geometry changed (UNWITNESSED → UNWITNESSED)');
  assert.deepEqual(D.declarations, []);
});

test('the real pair retainer → retainer-fixed: geometry changed, inputs unchanged, and the hand-corrected file loses an od entry against the contract floor', () => {
  const D = S.diffAttempts(read('retainer.scad'), read('retainer-fixed.scad'), data, ['retainer.scad', 'retainer-fixed.scad']);
  assert.equal(D.geometry.identical, false);
  assert.ok(D.geometry.added > 0 && D.geometry.removed > 0);
  assert.deepEqual(D.moved, []);
  assert.deepEqual(D.floor.lost, [{ category: 'od', from: 2, to: 1 }]);
  assert.equal(D.floor.now.gauges, 2);
  assert.equal(D.findings.length, 1);
  assert.equal(D.findings[0].code, 'floor_loss');
  assert.ok(D.declarations.some((d) => d.kind === 'bores' && d.name === 'nozzle capture pocket bore' && d.key === 'from_mm' && d.from === 4 && d.to === 0));
});

const verdicts = (D) => D.moved.map((m) => [m.key, m.verdict]);

test('the differ judges direction: what makes a check easier is flagged; a correction is listed as expected; an unread key has no effect', () => {
  const a = read('motor-retainer.scad');
  const same = S.diffAttempts(a, a, data);
  assert.equal(same.geometry.identicalFiles, true); assert.deepEqual(same.findings, []); assert.deepEqual(same.moved, []);
  // easier → finding
  const sf = S.diffAttempts(a, a.replace('"sf_min":2.0', '"sf_min":1.5'), data);
  assert.equal(sf.findings.length, 1); assert.match(sf.findings[0].text, /sf_min 2 → 1\.5 .* the acceptance threshold lowered: the check got easier/);
  const grade = S.diffAttempts(a, a.replace('"grade":"8.8"', '"grade":"12.9"'), data);
  assert.equal(grade.findings.length, 1); assert.match(grade.findings[0].text, /grade 8\.8 → 12\.9 .* a stronger bolt \(σy 640 → 1100 MPa, grade 8\.8 → grade 12\.9\): the check got easier/);
  const wit = S.diffAttempts(a, a.replace('"plate_t_mm":10,', '"plate_t_mm":12,'), data);
  assert.equal(wit.findings.length, 1);
  assert.match(wit.findings[0].text, /plate_t_mm 10 → 12 while the geometry is byte-identical — a witnessed input lost its witness \(WITNESSED → UNWITNESSED\)/);
  const uts = S.diffAttempts(a, a.replace('"engagement_mm":12,', '"engagement_mm":12,"bolt_sigma_u_MPa":500,'), data);
  assert.deepEqual(verdicts(uts), [['bolt_sigma_u_MPa', 'suspicious']], 'a 500 MPa bolt against the assumed 800 makes the strip check easier');
  // harder or a correction → expected, no finding
  const harder = S.diffAttempts(a, a.replace('"sf_min":2.0', '"sf_min":2.5').replace('"force_N":20000', '"force_N":24000').replace('"grade":"8.8"', '"grade":"5"'), data);
  assert.deepEqual(verdicts(harder), [['grade', 'expected'], ['force_N', 'expected'], ['sf_min', 'expected']]);
  assert.deepEqual(harder.findings, []);
  const src = S.diffAttempts(a, a.replace('"inputs_src":"default"},\n//           {"check":"thread"', '"inputs_src":"source","inputs_ref":"team test 2026-09"},\n//           {"check":"thread"'), data);
  assert.equal(src.geometry.identical, true);
  assert.deepEqual(verdicts(src), [['inputs_src', 'expected'], ['inputs_ref', 'expected']], 'provenance added never decides pass or fail');
  assert.deepEqual(src.findings, []);
  // a key the thread check does not read
  const unread = S.diffAttempts(read('bulkhead.scad'), read('bulkhead.scad').replace('"internal_material":"6061-T6","sf_min":2.0', '"internal_material":"6061-T6","sf_min":1.0'), data);
  assert.deepEqual(verdicts(unread), [['sf_min', 'no_effect']]);
  assert.deepEqual(unread.findings, []);
  // removal is judged by what the evaluator does instead: no force_N → refused (flagged); no n → 1 bolt (harder)
  const noForce = S.diffAttempts(a, a.replace('"force_N":20000,', ''), data);
  assert.deepEqual(verdicts(noForce), [['force_N', 'suspicious']]);
  const noN = S.diffAttempts(a, a.replace('"grade":"8.8","n":8,', '"grade":"8.8",'), data);
  assert.deepEqual(verdicts(noN), [['n', 'expected']], 'the evaluator assumes 1 bolt: a harder check');
  // a dropped row → floor loss and a suspicious row
  const dropped = S.diffAttempts(a, a.replace(/,\n\/\/\s*\{"check":"thread"[^\n]*\]/, ']'), data);
  assert.deepEqual(dropped.floor.lost, [{ category: 'loads', from: 2, to: 1 }]);
  assert.ok(dropped.findings.some((f) => f.code === 'floor_loss'));
  assert.deepEqual(dropped.moved.filter((m) => m.key === '(row)').map((m) => [m.to, m.verdict]), [['removed', 'suspicious']]);
  // a moved input with changed geometry: listed with its direction, not flagged
  const geo = S.diffAttempts(a, a.replace('"force_N":20000', '"force_N":12000') + '\ncube(1);\n', data);
  assert.equal(geo.geometry.identical, false);
  assert.deepEqual(verdicts(geo), [['force_N', 'suspicious']]);
  assert.deepEqual(geo.findings, [], 'a moved input with changed geometry is reported, not flagged');
  assert.match(S.renderDiff(geo), /no findings: the geometry changed, so moved inputs are listed with their direction, not flagged/);
});

test('the recorded first-attempt failure, replayed: adding the missing grade, raising force_N to the motor peak and adding a reference are expected corrections, not findings', () => {
  const ring = read('ring1.scad');
  const noGrade = ring.replace(',"grade":"8.8"', '');
  assert.notEqual(noGrade, ring);
  assert.deepEqual(S.lint(noGrade, data).result.rows[0].missing.map((m) => [m.key, m.effect]), [['grade', 'refused']], 'attempt 1 as the runs README records it: no bolt grade');
  const fix = S.diffAttempts(noGrade, ring, data);
  assert.equal(fix.geometry.identical, true);
  assert.deepEqual(verdicts(fix), [['grade', 'expected']]);
  assert.match(fix.moved[0].why, /^the evaluator refused the row without a known grade or bolt_sigma_y_MPa \(index\.html:5806–5808\); it now uses σy 640 MPa \(grade 8\.8\)/);
  assert.deepEqual(fix.findings, []);
  const floor = S.diffAttempts(ring.replace('"force_N":3331', '"force_N":3000'), ring, data);
  assert.deepEqual(verdicts(floor), [['force_N', 'expected']]);
  assert.match(floor.moved[0].why, /^raised to the certified peak of Loki L2050 \(3331 N\), the floor the evaluator demands \(index\.html:5792\)/);
  assert.deepEqual(floor.findings, []);
  const ref = S.diffAttempts(ring, ring.replace('"inputs_src":"source"', '"inputs_src":"source","inputs_ref":"motor_perf.json Loki L2050"'), data);
  assert.deepEqual(ref.findings, []);
  // the other way round would be flagged
  assert.equal(S.diffAttempts(ring, noGrade, data).findings.length, 1);
  assert.equal(S.diffAttempts(ring, ring.replace('"motor":"Loki L2050"', '"motor":""'), data).findings.length, 1, 'dropping the motor drops the floor');
  // and on the fin: a higher altitude means thinner air and a higher computed flutter speed
  const fin = read('fin.scad');
  assert.deepEqual(verdicts(S.diffAttempts(fin, fin.replace('"alt_m":3000', '"alt_m":6000'), data)), [['alt_m', 'suspicious']]);
  assert.deepEqual(verdicts(S.diffAttempts(fin, fin.replace('"alt_m":3000', '"alt_m":0'), data)), [['alt_m', 'expected']]);
});

test('geometry text strips both comment styles and whitespace; the line diff counts an LCS', () => {
  const g = S.geometryText('/* SPEC\n block */\n// FLIGHT-BEGIN\n// {}\n// FLIGHT-END\n  cube( 10 );   // size\n\n\tsphere(1);\n');
  assert.equal(g, 'cube( 10 );\nsphere(1);');
  assert.deepEqual(S.lineDiff('a\nb\nc', 'a\nc\nd'), { added: 1, removed: 1, common: 2 });
  assert.deepEqual(S.lineDiff('', ''), { added: 0, removed: 0, common: 0 });
});

// ------------------------------------------------------------------------------- the CLI and example.txt
test('CLI exit codes: --help 0, usage 3, unreadable 2, refusal 2, lint 0, findings 1; --json is an envelope', () => {
  const help = run('--help'); assert.equal(help.code, 0); assert.match(help.out, /^shadow-lint — for every number a FLIGHT loads row feeds its check/, 'usage starts at its first line');
  assert.equal(run().code, 3);
  assert.equal(run('a', 'b', 'c').code, 3);
  assert.equal(run('--bogus', 'x').code, 3);
  const nf = run('ideas/07-shadow-lint/snapshots/does-not-exist.scad'); assert.equal(nf.code, 2); assert.match(nf.out, /refused \(invalid_input\)/);
  const sled = run('ideas/07-shadow-lint/snapshots/av-sled.scad'); assert.equal(sled.code, 2); assert.match(sled.out, /insufficient_data/);
  const bulk = run('ideas/07-shadow-lint/snapshots/bulkhead.scad'); assert.equal(bulk.code, 0); assert.match(bulk.out, /WITNESSED/);
  const pair = run('ideas/07-shadow-lint/snapshots/motor-retainer.scad', 'ideas/07-shadow-lint/snapshots/motor-retainer.retry.scad'); assert.equal(pair.code, 1); assert.match(pair.out, /input_moved_geometry_unchanged/);
  const real = run('ideas/07-shadow-lint/snapshots/retainer.scad', 'ideas/07-shadow-lint/snapshots/retainer-fixed.scad'); assert.equal(real.code, 1); assert.match(real.out, /floor_loss/);
  const j = JSON.parse(run('--json', 'ideas/07-shadow-lint/snapshots/bulkhead.scad').out);
  assert.equal(j.ok, true); assert.equal(j.tool, 'shadow-lint'); assert.equal(j.confidence, 'derived');
  assert.deepEqual(j.value.totals, { WITNESSED: 4, DERIVABLE: 1, UNWITNESSED: 3, POLICY: 1 });
  assert.ok(j.provenance.some((p) => /index\.html @ 0974a62 \(excerpt: derived by build-data\.mjs: index\.html line 5804/.test(p.source)), 'GRADE_SY provenance');
  assert.ok(j.provenance.length >= 4 && j.provenance.some((p) => /fasteners_un\.json @ 0974a62/.test(p.source)));
  const jr = JSON.parse(run('--json', 'ideas/07-shadow-lint/snapshots/av-sled.scad').out);
  assert.equal(jr.ok, false); assert.equal(jr.value, null); assert.equal(jr.refusal.code, 'insufficient_data');
  const jd = JSON.parse(run('--json', 'ideas/07-shadow-lint/snapshots/motor-retainer.scad', 'ideas/07-shadow-lint/snapshots/motor-retainer.retry.scad').out);
  assert.equal(jd.value.findings.length, 1); assert.equal(jd.value.geometry.identical, true);
});

test('example.txt is the saved output of the CLI on the fixtures, byte for byte', () => {
  const cmds = [['snapshots/bulkhead.scad'], ['snapshots/endcap.scad'], ['snapshots/coupler.scad'], ['snapshots/ring1.scad'], ['snapshots/motor-retainer.scad', 'snapshots/motor-retainer.retry.scad'], ['snapshots/retainer.scad', 'snapshots/retainer-fixed.scad'], ['snapshots/av-sled.scad']];
  let text = '';
  for (const c of cmds) {
    const args = c.map((f) => 'ideas/07-shadow-lint/' + f);
    const r = run(...args);
    text += '$ node ideas/07-shadow-lint/shadow-lint.mjs ' + args.join(' ') + '\n' + r.out + '(exit ' + r.code + ')\n\n';
  }
  const file = path.join(here, 'example.txt');
  if (process.env.WRITE_EXAMPLE) fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('the README states the file counts and the headline numbers, over the real files only', () => {
  const md = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  assert.equal(REAL.length, 13); assert.deepEqual(FIXTURES.filter((f) => !REAL.includes(f)), ['motor-retainer.retry.scad']);
  const sum = (files, fn) => files.reduce((n, f) => { const L = lint(f); return n + (L.refusal ? 0 : fn(L.result)); }, 0);
  const total = sum(REAL, (r) => Object.values(r.totals).reduce((a, b) => a + b, 0));
  const surface = sum(REAL, (r) => r.inventionSurface.length);
  const policy = sum(REAL, (r) => r.totals.POLICY);
  assert.ok(md.includes(`${REAL.length} files from the PartForge checkout`), `README says ${REAL.length} files from the PartForge checkout`);
  assert.ok(md.includes(`${total} inputs`), `README says ${total} inputs`);
  assert.ok(md.includes(`${surface} of them`), `README says ${surface} of them are unwitnessed`);
  assert.ok(md.includes(`${policy} policy thresholds`), `README says ${policy} policy thresholds`);
  for (const s of ['47.98', '2.77', '3.2', '3331', '12.70', '20000 → 12000']) assert.ok(md.includes(s), 'README mentions ' + s);
});
