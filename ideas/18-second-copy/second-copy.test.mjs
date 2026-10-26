// node --test ideas/18-second-copy/second-copy.test.mjs   (from the bank root; Node built-ins only)
//
// Pinned outside this folder's code: flight-db.test.mjs:34, :66, :91, :119-126, dbFit() verbatim, the
// fits worked example, roadmap-evaluation.md:246, orings project_issues[2], git history, closed forms.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SC = require(path.join(here, 'second-copy.js'));
const SNAP = path.join(here, 'snapshots');
const REPO = '/home/user/Partforge';
const haveRepo = fs.existsSync(path.join(REPO, 'index.html')) && fs.existsSync(path.join(REPO, '.git'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const T = {};
for (const name of Object.keys(SC.TABLE_FILES)) T[name] = require(path.join(SNAP, `table-${name}.js`));
const IDX = require(path.join(SNAP, 'index-0974a62.js'));
const DOC = { text: IDX.doctrine.text, lineBase: IDX.doctrine.lineBase };
const GSY = { text: IDX.gradeSy.text, lineBase: IDX.gradeSy.lineBase };
const DBFIT = IDX.dbFit;
const HIST = require(path.join(SNAP, 'history.js'));
const TEMPLATES = fs.readdirSync(SNAP).filter((f) => /^tpl-.*\.scad\.js$/.test(f)).sort()
  .map((f) => { const t = require(path.join(SNAP, f)); return { name: f.replace(/^tpl-/, '').replace(/\.scad\.js$/, ''), file: t.file, text: t.text }; });
const shippedFull = SC.rebuildShipped(IDX.shipped, TEMPLATES);

const head = SC.run(T, { commit: '0974a62', doctrine: DOC, gradeSy: GSY, templates: TEMPLATES, shipped: shippedFull });
const src = (id) => head.sources.find((s) => s.id === id);
const by = (s, pred) => s.findings.filter(pred);
const verdicts = (fs_) => fs_.map((f) => f.verdict);

function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]); }

// --- snapshots
test('snapshots hash to their sidecars at PartForge 0974a62', () => {
  const files = walk(SNAP).filter((f) => !f.endsWith('.provenance.json'));
  assert.equal(files.length, 17);
  for (const f of files) {
    const side = JSON.parse(fs.readFileSync(`${f}.provenance.json`, 'utf8'));
    assert.equal(side.writtenSha256, sha(fs.readFileSync(f)), path.relative(here, f));
    assert.match(side.repo, /Partforge/);
    assert.equal(side.commit.slice(0, 7), '0974a62');
    assert.equal(side.mode, 'derived');
    assert.equal(side.readMatchesCommitted, true, f);
  }
});

test('template snapshots verbatim; shipped copies rebuild to their hashes', () => {
  for (const f of fs.readdirSync(SNAP).filter((x) => /^tpl-.*\.scad\.js$/.test(x))) {
    const t = require(path.join(SNAP, f));
    const side = JSON.parse(fs.readFileSync(path.join(SNAP, `${f}.provenance.json`), 'utf8'));
    assert.equal(sha(t.text), side.sourceSha256, f);
  }
  assert.equal(IDX.shipped.length, 7);
  assert.deepEqual(IDX.shipped.filter((s) => s.text != null || s.replace).map((s) => [s.name, Object.keys(s.replace || {})]), [['Av-bay bulkhead', ['10']]]);
  for (const s of shippedFull) assert.equal(sha(s.text), s.sha256, s.name);
  for (const k of ['doctrine', 'gradeSy', 'dbFit']) assert.equal(sha(IDX[k].text), IDX[k].sha256, k);
});

test('checkout: snapshots current, doctrine = tests/run.mjs slice, history = git', { skip: !haveRepo && 'no PartForge checkout' }, () => {
  const r = spawnSync('node', [path.join(here, 'build-data.mjs'), REPO, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // tests/run.mjs:27–30's own slice
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const a = html.indexOf('function flightSystemPrompt(){'), open_ = html.indexOf('return `', a) + 8;
  const close = html.indexOf('`;', open_);
  assert.equal(DOC.text, html.slice(open_, close));
  assert.equal(DOC.lineBase, html.slice(0, open_).split('\n').length);
  const runMjs = fs.readFileSync(path.join(REPO, 'tests', 'run.mjs'), 'utf8');
  assert.ok(runMjs.includes("const a = html.indexOf('function flightSystemPrompt(){'), open_ = html.indexOf('return `', a) + 8;"), 'tests/run.mjs slices differently now');
  for (const c of Object.keys(HIST)) {
    const old = execFileSync('git', ['show', `${c}:index.html`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
    assert.ok(old.includes(HIST[c].text), c);
    assert.equal(execFileSync('git', ['rev-parse', `${c}:index.html`], { cwd: REPO, encoding: 'utf8' }).trim(), HIST[c].blob);
  }
});

test('checkout: --repo and --snapshots give identical findings', { skip: !haveRepo && 'no PartForge checkout' }, () => {
  const a = JSON.parse(spawnSync('node', [path.join(here, 'second-copy.mjs'), '--json', '--history'], { encoding: 'utf8' }).stdout);
  const b = JSON.parse(spawnSync('node', [path.join(here, 'second-copy.mjs'), '--json', '--history', '--snapshots'], { encoding: 'utf8' }).stdout);
  assert.deepEqual(a.value.sources, b.value.sources);
  assert.deepEqual(a.value.totals, b.value.totals);
});

// --- the declared tolerance
test('agreement = correctly rounded at the literal\'s precision', () => {
  const n = SC.parseNum;
  assert.deepEqual([n('6.75'), n('−7'), n('+21'), n('.074')].map((x) => [x.value, x.decimals]), [[6.75, 2], [-7, 0], [21, 0], [0.074, 3]]);
  const close14 = 0.265625 * 25.4;                       // 17/64 in, 6.746875 mm
  assert.equal(SC.agrees(n('6.75'), close14), true);     // the doctrine's "6.75 mm the CLOSE hole"
  assert.equal(SC.agrees(n('6.746'), close14), false);   // 3 places is stricter
  assert.equal(SC.agrees(n('6.76'), close14), false);    // the old doctrine's figure
  assert.equal(SC.agrees(n('3.17'), 0.125 * 25.4), true);  // .125 in = 3.175: both roundings agree
  assert.equal(SC.agrees(n('3.18'), 0.125 * 25.4), true);
  assert.equal(SC.agrees(n('3.16'), 0.125 * 25.4), false);
  assert.equal(SC.agrees(n('9.0'), 9), true);
  assert.equal(SC.agrees(n('7'), 6.6), true);            // the rule's limit: "7" cannot tell 6.6 from 7.0
});

// --- fits
const fitLimits = (mm, hl, hg, sl, sg) => {
  const rh = SC.fitStepFor(T, mm), zh = SC.zoneUm(rh, hl, hg), zs = SC.zoneUm(rh, sl, sg);
  const hole = [mm + zh.lo / 1000, mm + zh.hi / 1000], shaft = [mm + zs.lo / 1000, mm + zs.hi / 1000];
  return { hole, shaft, clearance: [hole[0] - shaft[1], hole[1] - shaft[0]] };
};
test('zoneUm reproduces flight-db.test.mjs:119–126', () => {
  const a = fitLimits(50, 'H', 7, 'g', 6);
  assert.deepEqual([a.hole[1], a.shaft[0], a.shaft[1], a.clearance[0], a.clearance[1]].map((v) => v.toFixed(3)), ['50.025', '49.975', '49.991', '0.009', '0.050']);
  const b = fitLimits(25, 'H', 7, 'h', 6);
  assert.deepEqual(b.clearance.map((v) => v.toFixed(3)), ['0.000', '0.034']);
  const c = fitLimits(100, 'H', 8, 'f', 7);
  assert.deepEqual(c.clearance.map((v) => v.toFixed(3)), ['0.036', '0.125']);
  assert.ok(fitLimits(25, 'H', 7, 'n', 6).clearance[0] < 0);
  assert.ok(SC.zoneUm(SC.fitStepFor(T, 50), 'p', 6).unbacked, 'p refused, like dbFit()');
  assert.match(T.fits.notes, /Worked: ø50 H7\/g6 → H7 = 25 µm so the bore is 50\.000\/50\.025; g6 es = -9 and IT6 = 16 so the shaft is 49\.991\/49\.975; clearance 0\.009 to 0\.050 mm/i);
});

test('zoneUm equals dbFit() (verbatim) over every step, letter and grade', () => {
  const dbFit = new Function('dbRows', `${DBFIT.text}\nreturn dbFit;`)(() => T.fits.rows);
  let n = 0;
  for (const row of T.fits.rows) {
    for (const mm of [row.from_mm + 1e-6, Math.sqrt(row.from_mm * row.to_mm), row.to_mm]) {
      if (mm <= 1) continue;
      for (const hg of [5, 6, 7, 8, 9, 10, 11, 12, 13]) for (const sl of ['d', 'e', 'f', 'g', 'h', 'k', 'n', 'p', 's']) for (const sg of [4, 5, 6, 7, 8, 9, 11]) {
        const ref = dbFit(mm, 'H', hg, sl, sg);
        const zh = SC.zoneUm(SC.fitStepFor(T, mm), 'H', hg), zs = SC.zoneUm(SC.fitStepFor(T, mm), sl, sg);
        if (ref === null) { assert.ok(zh.unbacked || zs.unbacked, `${mm} H${hg}/${sl}${sg}: dbFit null, zoneUm not`); continue; }
        assert.ok(!zh.unbacked && !zs.unbacked, `${mm} H${hg}/${sl}${sg}`);
        assert.ok(Math.abs(ref.hole[1] - (mm + zh.hi / 1000)) < 1e-9 && Math.abs(ref.shaft[0] - (mm + zs.lo / 1000)) < 1e-9 && Math.abs(ref.shaft[1] - (mm + zs.hi / 1000)) < 1e-9, `${mm} H${hg}/${sl}${sg}`);
        n++;
      }
    }
  }
  assert.ok(n > 1500, `${n} fits compared`);
});

// --- the doctrine at 0974a62
test('doctrine: totals and the 23 metric values in order', () => {
  const d = src('doctrine');
  assert.deepEqual([d.counts.DISAGREES, d.counts.UNBACKED, d.counts.QUOTED, d.counts.AGREES, d.counts['NON-CLASS'], d.counts.MAPPED], [2, 6, 1, 78, 0, 0]);
  const metric = by(d, (f) => f.family === 'fasteners_metric');
  assert.deepEqual(metric.map((f) => `${f.key} ${f.literal} ${f.table.column}`), [
    ...'M2 2.4,M2.5 2.9,M3 3.4,M4 4.5,M5 5.5,M6 6.6,M8 9.0,M10 11.0,M12 13.5'.split(',').map((s) => `${s} clearance_medium_mm`),
    ...'M3 3.2,M4 4.3,M5 5.3,M6 6.4,M8 8.4'.split(',').map((s) => `${s} clearance_fine_mm`),
    ...'M2 1.6,M2.5 2.05,M3 2.5,M4 3.3,M5 4.2,M6 5.0,M8 6.8,M10 8.5,M12 10.2'.split(',').map((s) => `${s} tap_drill_mm`)]);
  assert.ok(metric.every((f) => f.verdict === 'AGREES' && f.line === 1493));
});

test('doctrine 1/4 in: 6.76 quoted, 6.75 and 7.14 agree; :66 sees none', () => {
  const un = by(src('doctrine'), (f) => f.family === 'fasteners_un');
  assert.deepEqual(un.map((f) => [f.literal, f.verdict, f.what]), [['6.76', 'QUOTED', 'clearance, B18.2.8 normal'], ['6.75', 'AGREES', 'clearance, B18.2.8 close'], ['7.14', 'AGREES', 'clearance, B18.2.8 normal']]);
  // tests/flight-db.test.mjs:66, verbatim
  assert.equal(/#4 3\.26|#6 3\.80|1\/4 6\.76|5\/16 8\.43/.test(DOC.text), false);
  assert.equal(/#4 3\.26|#6 3\.80|1\/4 6\.76|5\/16 8\.43/.test(HIST.ad4d587.text), true);
});

test('doctrine: 12 ISO 286 zones agree, p6 unbacked with IT6 width', () => {
  const fits = by(src('doctrine'), (f) => f.family === 'fits' && f.what.startsWith('ISO 286 zone'));
  assert.equal(fits.length, 15);
  assert.deepEqual(fits.filter((f) => f.verdict === 'UNBACKED').map((f) => f.key), ['p6 at Ø18–30', 'p6 at Ø50–80', 'p6 at Ø120–180']);
  assert.equal(fits.filter((f) => f.verdict === 'AGREES').length, 12);
  const it6 = ['iso286_18-30', 'iso286_50-80', 'iso286_120-180'].map((k) => T.fits.rows.find((r) => r.key === k).it_um['6']);
  assert.deepEqual(it6, [13, 19, 25]);
  fits.filter((f) => f.verdict === 'UNBACKED').forEach((f, i) => assert.match(f.note, new RegExp(`width ${it6[i]} µm equals the table's IT6 = ${it6[i]} µm`)));
  assert.ok(!T.fits.rows.some((r) => 'p' in r.shaft_es_um));
});

test('doctrine: 20 Parker bands agree, cross-sections in order', () => {
  const g = by(src('doctrine'), (f) => f.family === 'orings_as568');
  assert.equal(g.length, 20);
  assert.ok(g.every((f) => f.verdict === 'AGREES'));
  assert.deepEqual(g.map((f) => f.key), [].concat(...Array(5).fill(['W 1.78 mm', 'W 2.62 mm', 'W 3.53 mm', 'W 5.33 mm'])));
  assert.deepEqual([...new Set(g.map((f) => f.table.column))], ['gland_depth_L', 'groove_width_G_liquids', 'groove_width_G_vacuum_gases', 'gland_depth_F_table_4_2', 'groove_width_G_no_backup']);
});

test('doctrine: NASA, 1037, 11.6 kN, case sizes, grade names', () => {
  const d = src('doctrine');
  assert.deepEqual(by(d, (f) => f.family === 'design_factors_nasa').map((f) => [f.literal, f.table.row, f.verdict]),
    [['1.4', 'fos_metallic_protoflight', 'AGREES'], ['1.25', 'fos_metallic_protoflight', 'AGREES'], ['1.4', 'fos_metallic_prototype', 'AGREES'], ['1.0', 'fos_metallic_prototype', 'AGREES'], ['1.05', 'proof_test_factor_tanks_srm', 'AGREES']]);
  const mp = by(d, (f) => f.family === 'motor_perf');
  assert.deepEqual(mp.map((f) => [f.literal, f.verdict]), [['11.6', 'AGREES'], ['1037', 'AGREES']]);
  assert.equal(T.motor_perf.rows_count, 1037);
  assert.match(mp[0].table.display, /Cesaroni N10000 \(98 mm\) 11560 N certified/);   // flight-db.test.mjs:91 names the same motor and peak
  assert.deepEqual(by(d, (f) => f.family === 'motors').map((f) => f.literal + f.verdict), ['29AGREES', '38AGREES', '54AGREES', '75AGREES', '98AGREES', '152AGREES']);
  assert.deepEqual(by(d, (f) => f.family === 'GRADE_SY (names)').map((f) => f.key), ['8.8', '10.9', '12.9', '2', '5', '8', 'A2-70', 'A4-80']);
});

test('doctrine: the g6 example and "four vendors" disagree', () => {
  const dis = by(src('doctrine'), (f) => f.verdict === 'DISAGREES');
  assert.deepEqual(dis.map((f) => f.line), [1440, 1454]);
  assert.deepEqual(dis[0].table.value.map((v) => v.toFixed(3)), ['149.261', '149.286']);   // g6 at 120–180: es −14, IT6 25
  assert.match(dis[0].literal, /149\.300 ±0\.05 \(149\.25–149\.35\)/);
  assert.equal(dis[1].table.value, 3);
  assert.match(dis[1].table.display, /Blue Tube \(ARR\), Giant Leap, Madcow; not at 152\.4: PML PT-6\.0 ID 152\.578/);
  // PartForge's own test says the same of PML (tests/flight-db.test.mjs:34): PT-6.0 is 152.578
  assert.ok(T.airframes.rows.some((r) => r[0] === 'PML' && r[3] === 'PT-6.0' && r[1] === 152.578));
});

test('doctrine: MMT typicals unbacked, nearest tubes named', () => {
  const m = by(src('doctrine'), (f) => f.family === 'airframes' && f.key.endsWith('MMT'));
  assert.deepEqual(m.map((f) => [f.literal, f.verdict]), [['101.6 × 98.5', 'UNBACKED'], ['78.7 × 75.4', 'UNBACKED'], ['57.2 × 54.4', 'UNBACKED']]);
  assert.match(m[0].table.display, /101\.6 OD × 99\.06 ID/);
  assert.match(m[1].table.display, /76\.2 ID/);
});

test('doctrine: 119 of 272 numbers claimed (a reworded sentence shows here)', () => {
  const d = src('doctrine');
  assert.deepEqual([d.numbers, d.numbers - d.unpaired.length], [272, 119]);
});

// --- history
test('history ad4d587: UN block 15 of 16 disagree; the evaluation\'s diagnosis', () => {
  const r = SC.run(T, { history: [HIST.ad4d587] }).sources[0];
  const cl = by(r, (f) => f.family === 'fasteners_un' && /clearance/.test(f.what));
  assert.equal(cl.length, 16);
  assert.deepEqual(cl.filter((f) => f.verdict === 'AGREES').map((f) => f.key + ' ' + f.literal), ['#4 3.26']);
  assert.equal(cl.filter((f) => f.verdict === 'DISAGREES').length, 15);
  const taps = by(r, (f) => f.family === 'fasteners_un' && /tap drill/.test(f.what));
  assert.deepEqual([taps.length, taps.every((f) => f.verdict === 'AGREES')], [20, true]);
  // docs/roadmap-evaluation.md:246: "1/4 normal 6.76" vs table close; "#10 normal 5.11 is 0.201 in = the #7 drill, which is the 1/4-20 tap drill"
  const f511 = cl.find((f) => f.literal === '5.11'), f676 = cl.find((f) => f.literal === '6.76');
  assert.ok(f511.looksLike.some((x) => /^1\/4-20 75 % tap drill \(#7\)/.test(x)), f511.looksLike);
  assert.ok(f676.looksLike.some((x) => /^1\/4-20 close nominal 6\.756/.test(x)), f676.looksLike);
  assert.equal(r.counts.DISAGREES, 15);
});

test('history 3bffbe0: the six disagreeing widths are project_issues[2]\'s six', () => {
  const r = SC.run(T, { history: [HIST['3bffbe0']] }).sources[0];
  const dis = by(r, (f) => f.family === 'orings_as568' && f.verdict === 'DISAGREES').map((f) => f.literal.replace(/–/g, '-'));
  const issue = T.orings_as568.project_issues[2].issue;
  const liquids = issue.match(/liquids \(([^)]*) mm\)/)[1].split(' / ');
  const vacuum = issue.match(/vacuum widths for W [^(]*\(([^)]*) mm\)/)[1].split(' / ');
  assert.deepEqual(liquids, ['3.56-3.71', '4.70-4.90', '7.14-7.44']);
  assert.deepEqual(dis.sort(), [...liquids, ...vacuum].sort());
  assert.ok(by(r, (f) => f.literal === '3.05–3.18')[0].verdict === 'AGREES', '3.18 rounds 3.175');
});

// --- GRADE_SY
test('GRADE_SY: 4 agree, a4-80 mapped, SAE and 18-8 unbacked, comment agrees', () => {
  const g = src('GRADE_SY');
  const lit = by(g, (f) => f.family !== 'GRADE_SY (comment vs literal)');
  assert.deepEqual(lit.filter((f) => f.verdict === 'AGREES').map((f) => f.key), ['8.8', '10.9', '12.9', 'a2-70']);
  assert.deepEqual(lit.filter((f) => f.verdict === 'MAPPED').map((f) => f.key), ['a4-80']);
  assert.deepEqual(new Set(lit.filter((f) => f.verdict === 'UNBACKED').map((f) => f.key)), new Set(['2', 'grade 2', '5', 'grade 5', '8', 'grade 8', '18-8']));
  assert.deepEqual(lit.filter((f) => f.verdict === 'AGREES').map((f) => f.table.value), [640, 940, 1100, 450]);
  assert.equal(by(g, (f) => f.family === 'GRADE_SY (comment vs literal)' && f.verdict === 'AGREES').length, 9);
  assert.match(lit[0].note, /d > 16 mm/);
  assert.equal(lit[0].line, 5804);
});

test('planted GRADE_SY 8.8 = 660 disagrees with 640 and its comment', () => {
  const text = GSY.text.replace("'8.8':640", "'8.8':660");
  assert.notEqual(text, GSY.text);
  const g = SC.run(T, { gradeSy: { text, lineBase: 1 } }).sources[0];
  const dis = by(g, (f) => f.verdict === 'DISAGREES');
  assert.deepEqual(dis.map((f) => [f.key, f.literal, f.table.value]), [['8.8', '640', 660], ['8.8', '660', 640]]);
});

// --- templates
test('bulkhead: AS568-250 is W .139, so W .103 / 2.62 disagree; -159 named', () => {
  const b = src('template:bulkhead');
  const w = by(b, (f) => f.key === 'AS568-250' && /cross-section/.test(f.what));
  assert.deepEqual(w.map((f) => [f.literal, f.verdict]), [['0.103', 'DISAGREES'], ['2.62', 'DISAGREES']]);
  assert.match(w[0].looksLike[0], /-159 \(ID 4\.987 in\)/);
  const row250 = T.orings_as568.rows.find((r) => r[0] === '-250'), row159 = T.orings_as568.rows.find((r) => r[0] === '-159');
  assert.deepEqual([row250[1], row250[2], row159[1], row159[2]], [4.984, 0.139, 4.987, 0.103]);
  assert.deepEqual(by(b, (f) => f.key === 'AS568-250' && /inside diameter/.test(f.what)).map((f) => f.verdict), ['AGREES', 'AGREES', 'AGREES', 'AGREES']);
});

test('bulkhead glands: liquids .140–.146 vs .136–.142 disagrees; the rest agree', () => {
  const b = src('template:bulkhead');
  const g = by(b, (f) => f.family === 'orings_as568' && f.key === 'W .103 in');
  assert.deepEqual(g.map((f) => [f.literal, f.verdict]), [['.074–.080', 'AGREES'], ['.120–.125', 'AGREES'], ['.140–.146', 'DISAGREES'], ['0.13–0.38', 'AGREES'], ['.005–.015', 'AGREES'],
    ['.120–.125', 'AGREES'], ['3.10', 'AGREES'], ['.074–.080', 'AGREES'], ['1.96', 'AGREES']]);
  assert.deepEqual(by(b, (f) => f.key === 'Parker gland').map((f) => [f.literal, f.verdict]), [['±.003', 'UNBACKED']]);
  assert.deepEqual(by(b, (f) => f.key === 'grade 2').map((f) => [f.literal, f.verdict]), [['393', 'UNBACKED']]);
});

test('bulkhead: 6.60 and 7.00 non-class, reasons quoted', () => {
  const b = src('template:bulkhead');
  const nc = by(b, (f) => f.verdict === 'NON-CLASS');
  assert.deepEqual(nc.map((f) => [f.line, f.literal, f.note]), [
    [9, '6.60', 'stated reason: (6.35 + 0.25)'], [9, '7.00', 'no reason stated on this line'],
    [29, '6.60', 'no reason stated on this line'], [30, '7.00', 'no reason stated on this line'],
    [68, '6.60', 'stated reason: 6.35 plus 0.25'], [72, '7.00', 'stated reason: 6.35 plus 0.65 (hole for a bent leg pair)']]);
  const q = T.fasteners_un.rows.find((r) => r.key === '1/4-20');
  assert.deepEqual([q.clearance_close_in, q.clearance_normal_in, q.clearance_loose_in].map((v) => (v * 25.4).toFixed(3)), ['6.747', '7.144', '7.541']);
  assert.deepEqual(by(b, (f) => f.key === '#8-32').map((f) => `${f.line} ${f.what} ${f.literal} ${f.verdict}`), [
    '10 tap drill 3.45 AGREES', '10 tap drill name #29 AGREES', '32 tap drill 3.45 AGREES', '77 tap drill 3.45 AGREES', '77 tap drill name #29 AGREES', '77 tap drill 0.1360 AGREES']);
  assert.deepEqual(by(b, (f) => f.what === 'tensile stress area').map((f) => [f.literal, f.verdict]), [['20.5', 'AGREES']]);
});

test('nosecone: H7 named, ±0.05 declared (3 places)', () => {
  const n = src('template:nosecone');
  assert.deepEqual(n.findings.map((f) => [f.line, f.verdict]), [[3, 'DISAGREES'], [7, 'DISAGREES'], [43, 'DISAGREES']]);
  assert.ok(n.findings.every((f) => f.table.value[0] === 20 && Math.abs(f.table.value[1] - 20.021) < 1e-12));
});

test('metric templates agree; coupler/av-sled non-class; heat-set unbacked; recall printed', () => {
  const v = (id) => src('template:' + id).findings.map((f) => `${f.key} ${f.literal} ${f.verdict}`);
  assert.deepEqual(v('centering-ring'), ['M4 4.50 AGREES', 'M4 4.50 AGREES', 'M4 4.50 AGREES']);
  assert.deepEqual(v('motor-retainer'), ['M6 6.40 AGREES', 'M6 6.40 AGREES', 'M6 6.40 AGREES']);
  assert.deepEqual(v('fin'), ['M4 4.50 AGREES', 'M4 4.50 AGREES']);
  assert.deepEqual(v('coupler').sort(), ['#2-56 2.18 AGREES', '#2-56 2.20 NON-CLASS', '#2-56 2.20 NON-CLASS', '#8-32 #29 AGREES', '#8-32 #29 AGREES', '#8-32 3.45 AGREES', '#8-32 3.45 AGREES', '#8-32 3.45 AGREES']);
  assert.match(src('template:coupler').findings.find((f) => f.literal === '2.18').table.confidence, /^recall row/);
  assert.deepEqual(v('av-sled').sort(), ['1/4 6.60 NON-CLASS', '1/4 6.60 NON-CLASS', '1/4 6.60 NON-CLASS', 'M3 4.00 UNBACKED', 'M3 4.00 UNBACKED', 'M3 4.00 UNBACKED']);
});

test('copies: bulkhead.scad:11 differs from index.html:2062; six identical', () => {
  const c = src('copies');
  assert.equal(c.findings.length, 1);
  const f = c.findings[0];
  assert.deepEqual([f.file, f.line, f.verdict, f.table.column], ['tests/templates/bulkhead.scad', 11, 'COPY-DRIFT', 'line 2062']);
  assert.match(f.literal, /and tension in the 4 all-thread rods/);
  assert.match(f.table.display, /A bent U-bolt's real rating is the vendor's working load/);
});

// --- planted drift and clean text
test('planted M6 6.6 → 7.0: one disagreement, named as the coarse hole', () => {
  const line = SC.tableBullets(DOC).text.split('\n')[0];
  assert.equal(line.split('M6 6.6,').length, 2);
  const text = line.replace('M6 6.6,', 'M6 7.0,');
  const r = SC.run(T, { doctrine: { text, lineBase: 1 } }).sources[0];
  const dis = by(r, (f) => f.verdict === 'DISAGREES');
  assert.deepEqual(dis.map((f) => [f.key, f.literal, f.table.value]), [['M6', '7.0', 6.6]]);
  assert.deepEqual(dis[0].looksLike, ['M6 clearance_coarse 7']);
  assert.equal(by(r, (f) => f.verdict === 'AGREES').length, 24);
});

test('clean text all AGREES; a 1 µm typo caught', () => {
  const m = (k) => T.fasteners_metric.rows.find((r) => r.key === k);
  const u = (k) => T.fasteners_un.rows.find((r) => r.key === k);
  const it7 = T.fits.rows.find((r) => r.key === 'iso286_30-50').it_um['7'];
  const clean = `- Use standard sizes. Clearance holes (ISO 273 medium): M5 ${m('M5').clearance_medium_mm}, M6 ${m('M6').clearance_medium_mm}. Tap drills (metric coarse): M8 ${m('M8').tap_drill_mm}. UN tap drills: #10-32 ${(u('#10-32').tap_drill_75_in * 25.4).toFixed(2)} (${u('#10-32').tap_drill_75}).\n- Fits (ISO 286, μm, hole basis): at Ø30–50 H7 = +${it7}/0.`;
  const r = SC.run(T, { doctrine: { text: clean, lineBase: 1 } }).sources[0];
  assert.deepEqual([r.findings.length, r.counts.AGREES], [6, 6]);
  const typo = SC.run(T, { doctrine: { text: clean.replace(`+${it7}/0`, `+${it7 + 1}/0`), lineBase: 1 } }).sources[0];
  assert.deepEqual(by(typo, (f) => f.verdict === 'DISAGREES').map((f) => f.key), ['H7 at Ø30–50']);
});

test('hand-worked: a named class is held; a UN value agrees via the nominal', () => {
  // motor-retainer's own NOTE is judged against the fine column it names, not "any class"
  const mr = src('template:motor-retainer').findings[0];
  assert.deepEqual([mr.what, mr.table.column], ['clearance, ISO 273 fine', 'clearance_fine_mm']);
  // the same sentence with the medium value but still saying "fine" is a disagreement
  const planted = '// NOTE: 8 × M6 class 8.8 bolts, clearance 6.60 (ISO 273 fine), on a 132.00 bolt circle\n';
  const p = SC.run(T, { templates: [{ name: 'planted', file: 'planted.scad', text: planted }] }).sources[0];
  assert.deepEqual(p.findings.map((f) => [f.literal, f.verdict, f.table.value]), [['6.60', 'DISAGREES', 6.4]]);
  // #6: the normal drill is #18 = 0.1695 in = 4.305 mm, the B18.2.8 nominal 0.170 in = 4.318 mm
  const r6 = T.fasteners_un.rows.find((r) => r.key === '#6-32');
  assert.deepEqual([r6.clearance_normal, r6.clearance_normal_in, r6.clearance_normal_nom_in], ['#18', 0.1695, 0.17]);
  const d = SC.run(T, { doctrine: { text: 'UN clearance (ASME B18.2.8 normal / close): #6 4.32 / 3.91.', lineBase: 1 } }).sources[0];
  assert.deepEqual(d.findings.map((f) => [f.literal, f.verdict, f.table.column]), [['4.32', 'AGREES', 'clearance_normal_nom_in'], ['3.91', 'AGREES', 'clearance_close_in']]);
});

test('hand-worked: a fit zone needs both limits', () => {
  const tpl = (d, tol) => `// NOTE: pocket Ø20.00 H7, reamed\n// FLIGHT-BEGIN\n// {"material":"6061-T6","bores":[{"name":"pocket","d_mm":${d},"tol_mm":${tol},"at_mm":[0,0],"axis":"z","from_mm":0,"to_mm":10}]}\n// FLIGHT-END\n`;
  const v = (d, tol) => SC.run(T, { templates: [{ name: 'x', file: 'x.scad', text: tpl(d, tol) }] }).sources[0].findings.map((f) => f.verdict);
  assert.deepEqual(v('20.0105', '0.0105'), ['AGREES']);        // 20.000–20.021 = H7 at Ø20 (IT7 21 µm in the 18–30 step)
  assert.deepEqual(v('20.005', '0.005'), ['DISAGREES']);       // lower limit right, upper 20.010 short
  assert.deepEqual(v('20.00', '0.05'), ['DISAGREES']);         // the nosecone's declaration
});

// --- the CLI
const cli = (args) => spawnSync('node', [path.join(here, 'second-copy.mjs'), ...args], { encoding: 'utf8' });
test('CLI: exit codes and the JSON envelope', () => {
  assert.equal(cli(['--help']).status, 0);
  assert.equal(cli(['--snapshots']).status, 1);
  assert.equal(cli(['--snapshots', '--only', 'templates', '--json']).status, 1);
  assert.equal(cli(['--snapshots', '--only', 'grades']).status, 0);
  const ref = cli(['--repo', '/nonexistent-partforge', '--json']);
  assert.equal(ref.status, 2);
  assert.deepEqual(JSON.parse(ref.stdout).refusal.code, 'not_found');
  assert.equal(cli(['--bogus']).status, 3);
  assert.equal(cli(['--only', 'nonsense']).status, 3);
  assert.equal(cli(['--snapshots', '--doctrine', '/nonexistent/file']).status, 2);
  const env = JSON.parse(cli(['--snapshots', '--json']).stdout);
  assert.equal(env.ok, true);
  assert.deepEqual(env.value.totals, head.totals);
  assert.equal(env.value.failing, 9);
  assert.ok(env.provenance.some((p) => p.path === 'data/tables/fasteners_un.json' && p.commit.startsWith('0974a62')));
  const tmp = path.join(os.tmpdir(), `second-copy-grade-sy-${process.pid}.txt`);
  fs.writeFileSync(tmp, GSY.text.replace("'8.8':640", "'8.8':660"));
  try { assert.equal(cli(['--snapshots', '--grade-sy', tmp]).status, 1); } finally { fs.unlinkSync(tmp); }
});

test('example.txt is the output of its three commands', () => {
  const ex = fs.readFileSync(path.join(here, 'example.txt'), 'utf8');
  const runs = [...ex.matchAll(/^\$ node ideas\/18-second-copy\/second-copy\.mjs(.*)$/gm)];
  assert.equal(runs.length, 3);
  const bank = path.resolve(here, '..', '..');
  let rebuilt = '';
  for (const r of runs) {
    const args = r[1].trim().split(/\s+/).filter(Boolean);
    const out = spawnSync('node', ['ideas/18-second-copy/second-copy.mjs', ...args], { cwd: bank, encoding: 'utf8' });
    rebuilt += `$ node ideas/18-second-copy/second-copy.mjs ${args.join(' ')}\n${out.stdout}(exit ${out.status})\n\n`;
  }
  assert.equal(ex, rebuilt);
});

test('the README states the numbers of this run', () => {
  const md = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
  const t = head.totals;
  assert.ok(md.includes(`${t.DISAGREES} DISAGREES, ${t['COPY-DRIFT']} COPY-DRIFT, ${t['NON-CLASS']} NON-CLASS, ${t.UNBACKED} UNBACKED, ${t.MAPPED} MAPPED, ${t.QUOTED} QUOTED, ${t.AGREES} AGREES`), 'README totals line');
  assert.ok(md.includes('78 AGREES'));
  assert.ok(md.includes('15 of 16'));
});
