// coldread.test.mjs — node --test ideas/24-cold-read/coldread.test.mjs
// What these pin, and to what outside this folder's own code:
//   * PartForge's own parser: for every corpus text and 600+ corrupted variants, the entries Cold
//     Read names as dropped / demoted / kept equal the counters parseFlight() itself returns
//     (run verbatim from index.html), so the linter cannot become a second, different truth.
//   * PartForge's recorded gate results: tests/dryrun/cases.json (the endcap's two
//     critical-dimension failures, in the gate's own words; the retainer's geometric failure that
//     text cannot see), tests/flight-templates-cases.json (seven templates, no failures) and the
//     docs/runs logs (eight model-written files the gate passed).
//   * V8's JSON.parse: on 300+ malformed FLIGHT blocks, the error offset Cold Read's
//     position-keeping reader reports equals the "at position N" V8 reports.
//   * index.html itself, when the checkout is at the snapshotted commit: every verbatim block is
//     byte-identical and every cited line still says what the code claims it says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CR = require('./coldread.js');
const APP = require('./snapshots/app-rules.js');
const CORPUS = require('./corpus.js');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const PARTFORGE = process.env.PARTFORGE_DIR || '/home/user/Partforge';

const wrappers = [];
for (const d of ['snapshots', 'snapshots/fixtures'])
  for (const f of fs.readdirSync(path.join(here, d)).filter((x) => x.endsWith('.js') && x !== 'app-rules.js').sort())
    wrappers.push({ file: path.join(d, f), entry: require(path.join(here, d, f)) });
const corpus = CORPUS.build(wrappers.map((w) => w.entry));
const text = (id) => { const c = corpus.find((x) => x.id === id); assert.ok(c, `corpus has ${id}`); return c.text; };
const cases = require('./snapshots/dryrun-cases.js').cases;
const codes = (r, code, sev) => r.diagnostics.filter((d) => d.code === code && (!sev || d.severity === sev));
const parityErrors = (r) => codes(r, 'PARITY', 'error');
// 1-based line and column of the first occurrence of `needle` (after `after`, if given)
function where(src, needle, after) {
  const from = after ? src.indexOf(after) : 0;
  const i = src.indexOf(needle, from < 0 ? 0 : from);
  assert.ok(i >= 0, `fixture contains ${JSON.stringify(needle)}`);
  const before = src.slice(0, i).split('\n');
  return { line: before.length, col: before[before.length - 1].length + 1 };
}
function mutate(src, from, to) {
  assert.equal(src.split(from).length, 2, `mutation anchor ${JSON.stringify(from)} occurs exactly once`);
  return src.replace(from, to);
}

// ------------------------------------------------------------------ provenance
test('every bundled text is the PartForge file its sidecar names, at the snapshotted commit', () => {
  assert.equal(corpus.length, 35);
  for (const w of wrappers) {
    const side = JSON.parse(fs.readFileSync(path.join(here, w.file + '.provenance.json'), 'utf8'));
    assert.equal(side.path, w.entry.path, w.file);
    assert.equal(side.commit, APP.SOURCE.commit, `${w.file}: same PartForge commit as the rules`);
    if (w.entry.kind === 'templates') { assert.equal(side.sourceSha256, APP.SOURCE.sha256); continue; }
    assert.equal(sha256(w.entry.text), w.entry.sha256, `${w.file}: text matches its recorded sha256`);
    assert.equal(w.entry.sha256, side.sourceSha256, `${w.file}: and the sidecar's source sha256`);
  }
  const side = JSON.parse(fs.readFileSync(path.join(here, 'snapshots/app-rules.js.provenance.json'), 'utf8'));
  assert.equal(side.sourceSha256, APP.SOURCE.sha256);
  assert.equal(side.writtenSha256, sha256(fs.readFileSync(path.join(here, 'snapshots/app-rules.js'))));
});

const indexHtml = (() => { try { return fs.readFileSync(path.join(PARTFORGE, 'index.html'), 'utf8'); } catch { return null; } })();
const atCommit = indexHtml && sha256(indexHtml) === APP.SOURCE.sha256;

test('the app rules are byte-identical to index.html and every cited line still says what Cold Read claims', { skip: atCommit ? false : `needs ${PARTFORGE}/index.html at ${APP.SOURCE.commit.slice(0, 7)}` }, () => {
  const L = indexHtml.split('\n');
  const src = fs.readFileSync(path.join(here, 'snapshots/app-rules.js'), 'utf8');
  const banners = [...src.matchAll(/^\/\/ ---- index\.html:(\d+)-(\d+) \(verbatim\) ----\n/gm)];
  assert.equal(banners.length, 7);
  for (const b of banners) {
    const start = b.index + b[0].length, end = src.indexOf('\n// ---- ', start);
    assert.equal(src.slice(start, end), L.slice(+b[1] - 1, +b[2]).join('\n'), `index.html:${b[1]}-${b[2]}`);
  }
  for (const [k, v] of Object.entries(APP.VOCAB)) {
    if (!(v instanceof RegExp)) continue;
    assert.ok(L[APP.SOURCE.pieces[k][0] - 1].includes(v.source.slice(0, 12)) || L[APP.SOURCE.pieces[k][0] - 1].includes(String(v).slice(0, 12)), `${k} is on index.html:${APP.SOURCE.pieces[k][0]}`);
  }
  for (const [n, s] of Object.entries(CR.CITES)) assert.ok(L[n - 1].includes(s), `index.html:${n} should contain ${JSON.stringify(s)}`);
});

test('every index.html line the linter and the page cite is in the checked citation table', () => {
  const src = ['coldread.js', 'app.js'].map((f) => fs.readFileSync(path.join(here, f), 'utf8')).join('\n');
  const cited = new Set();
  for (const m of src.matchAll(/index\.html:([\d ,\-\/]+)/g))
    for (const part of m[1].split(/[ ,\/]+/)) for (const x of part.split('-').filter(Boolean)) cited.add(+x);
  const missing = [...cited].filter((n) => n && !(n in CR.CITES));
  assert.deepEqual(missing, []);
  assert.ok(cited.size >= 60);
});

// ------------------------------------------------------------------ the app's own counters
test('on all 35 texts, the entries Cold Read names equal parseFlight\'s own counters, and no PARITY error fires', () => {
  let flights = 0;
  for (const c of corpus) {
    const r = CR.lint(c.text);
    assert.deepEqual(parityErrors(r), [], c.label);
    const app = APP.parseFlight(c.text);
    if (!app || app.malformed) continue;
    flights++;
    assert.equal(r.summary.named.dropped, app.dropped, c.label + ' dropped');
    assert.equal(r.summary.named.demoted, app.demoted, c.label + ' demoted');
    assert.equal(codes(r, 'FLIGHT_DROP').length, app.dropped);
    assert.equal(codes(r, 'FLIGHT_DEMOTE').length, app.demoted);
    for (const k of ['critical', 'od', 'bores', 'holes', 'revolve', 'gauges', 'loads'])
      assert.equal((r.summary.flightCounts[k] || { kept: 0 }).kept, app[k].length, `${c.label} ${k}`);
  }
  assert.equal(flights, 24);
});

test('a field-by-field corruption sweep: every entry the app drops or demotes is named, with the field, and nothing else is', (t) => {
  const BREAK = {
    critical: [['axis'], ['axis', 'w'], ['nominal_mm', 0], ['nominal_mm', 'abc'], ['tol_mm', -1], ['tol_mm'], ['tol_src', 'source']],
    od: [['axis'], ['d_mm', 0], ['tol_mm', '0'], ['from_mm'], ['to_mm', 'x'], ['to_mm', '@from'], ['tol_src', 'source']],
    bores: [['axis', 'Z'], ['d_mm', -2], ['from_mm', null], ['to_mm', '@from'], ['tol_src', 'source']],
    holes: [['n', 0], ['n', 65], ['n', 64.4], ['n'], ['bc_d_mm', 0], ['pattern', 'ring'], ['pattern'], ['axis'], ['tol_src', 'source'], ['tol_src+n']],
    revolve: [['type', 'ogive'], ['L_mm', 0], ['R_mm'], ['tip_at_mm', 'x'], ['tol_src', 'source']],
    gauges: [['module', '1abc'], ['module'], ['module', 7]],
    loads: [['check', 'torsion'], ['check'], ['inputs_src', 'source']],
  };
  const REVOLVE = { name: 'ogive', type: 'tangent_ogive', L_mm: 300, R_mm: 50, tip_at_mm: 0, axis: 'z', tol_mm: 0.2, tol_src: 'default' };
  let n = 0, drops = 0, demotes = 0, both = 0;
  for (const c of corpus.filter((x) => x.group === 'dryrun' || x.group === 'templates')) {
    const blk = CR.extractBlock(c.text, APP.VOCAB.FLIGHT_BLOCK_RE, APP.VOCAB.LINE_PREFIX_RE);
    const base = JSON.parse(blk.json);
    base.revolve = (base.revolve || []).concat([REVOLVE]);   // no bundled file declares a revolve
    const wrap = (doc) => c.text.slice(0, blk.start) + '// FLIGHT-BEGIN\n// ' + JSON.stringify(doc) + '\n// FLIGHT-END' + c.text.slice(blk.end);
    const app0 = APP.parseFlight(wrap(base));
    for (const [cat, list] of Object.entries(BREAK)) (base[cat] || []).forEach((_, idx) => {
      for (const [field, ...val] of list) {
        const doc = JSON.parse(JSON.stringify(base)), e = doc[cat][idx];
        if (field === 'tol_src+n') Object.assign(e, { tol_src: 'source', n: 0 });
        else if (!val.length) delete e[field];
        else e[field] = val[0] === '@from' ? e.from_mm : val[0];
        delete e.tol_ref; if (/src/.test(field)) delete e.inputs_ref;
        const t = wrap(doc), app = APP.parseFlight(t), r = CR.lint(t);
        n++;
        const label = `${c.label} ${cat}#${idx} ${field}=${JSON.stringify(val[0])}`;
        assert.deepEqual(parityErrors(r).map((d) => d.message), [], label);
        const named = codes(r, 'FLIGHT_DROP'), dem = codes(r, 'FLIGHT_DEMOTE');
        assert.equal(named.length, app.dropped, label + ' dropped');
        assert.equal(dem.length, app.demoted, label + ' demoted');
        const dd = app.dropped - app0.dropped, dm = app.demoted - app0.demoted;
        drops += dd; demotes += dm; if (dd && dm) both++;
        const mine = named.filter((d) => d.category === cat && d.index === idx);
        assert.equal(mine.length, dd, label + ': the dropped entry is the one corrupted');
        for (const d of mine) {
          assert.ok(d.field && d.reasonFound, label + ': names a field');
          if (field !== 'tol_src+n' && cat !== 'holes') assert.equal(d.field, field, label);
          assert.equal(d.line > 0, true);
        }
      }
    });
  }
  assert.ok(n >= 650, `ran ${n} corruptions`);
  assert.ok(drops >= 450 && demotes >= 100, `${drops} drops, ${demotes} demotions`);
  assert.ok(both >= 7, 'a dropped hole still counts its demotion, and Cold Read says so');
  t.diagnostic(`${n} corrupted files: ${drops} drops and ${demotes} demotions by parseFlight, all named; ${both} entries both dropped and demoted`);
});

test('FLIGHT_CAP: entries past the 24 parseFlight reads are named, and never counted by the app', () => {
  assert.equal(APP.FLIGHT_CAP, 24);
  const t0 = text('tests/templates/centering-ring.scad');
  const extra = Array.from({ length: 24 }, (_, i) => `{"name":"x${i}","module":"ring","axis":"z","nominal_mm":6.35,"tol_mm":0.25,"tol_src":"default"}`).join(',');
  const t = mutate(t0, '"tol_mm":0.25,"tol_src":"default"}],', `"tol_mm":0.25,"tol_src":"default"},${extra}],`);
  const r = CR.lint(t), app = APP.parseFlight(t);
  assert.equal(app.critical.length, 24);
  assert.equal(app.dropped, 0, 'the app counts nothing for the 3 it never reads');
  const cap = codes(r, 'FLIGHT_CAP');
  assert.equal(cap.length, 1);
  assert.equal(cap[0].index, 24);
  assert.match(cap[0].message, /27 entries; parseFlight reads only the first FLIGHT_CAP = 24/);
  assert.equal(r.summary.named.capped, 3);
  assert.deepEqual(parityErrors(r), []);
});

// ------------------------------------------------------------------ the gate's recorded results
test('endcap: both critical-dimension failures the gate recorded are found before a render, at their FLIGHT lines, in the gate\'s words', () => {
  const t = text('tests/dryrun/endcap.scad'), k = cases.find((x) => x.name === 'endcap');
  const r = CR.lint(t);
  const crit = k.expect.fails.filter((f) => /^Critical dimension/.test(f)).map((f) => /"(.*)"/.exec(f)[1]);
  assert.deepEqual(crit, ['o-ring groove width', 'lightening pocket depth']);
  const con = codes(r, 'CONTRADICTION', 'error');
  assert.deepEqual(con.map((d) => /"(.*?)"/.exec(d.message)[1]), crit);
  const fb = where(t, 'FLIGHT-BEGIN').line, fe = where(t, 'FLIGHT-END').line;
  for (const [i, d] of con.entries()) {
    const at = where(t, '"nominal_mm"', `"name":"${crit[i]}"`);
    assert.deepEqual([d.line, d.col], [at.line, at.col], crit[i]);
    assert.ok(d.line > fb && d.line < fe);
  }
  assert.deepEqual(con.map((d) => d.line), [29, 30]);
  // the gate's own failure text, recorded in cases.json, appears in Cold Read's message
  const said = k.expect.contains.find((s) => s.startsWith('but your SPEC gives'));
  assert.ok(con[0].message.includes(said), said);
  // the two failures that need the mesh are not claimed
  for (const geo of ['shoulder OD', 'o-ring groove bottom diameter'])
    assert.ok(!r.diagnostics.some((d) => d.severity !== 'info' && d.message.includes(geo)), geo);
  assert.equal(r.summary.errors, 2);
});

test('retainer: its recorded failure is geometric, so the text lints clean, and the report refuses to call that a pass', () => {
  const k = cases.find((x) => x.name === 'retainer');
  assert.deepEqual(k.expect.fails, ['Bore "nozzle capture pocket bore"']);
  const r = CR.lint(text('tests/dryrun/retainer.scad'));
  assert.equal(r.summary.errors, 0);
  assert.equal(r.summary.warnings, 0);
  const out = CR.format(r, { file: 'retainer.scad' }).split('\n');
  assert.equal(out[out.length - 1], 'text checks only; geometry not checked');
  assert.ok(out.some((l) => l.includes('That is not a pass')));
  assert.ok(!('pass' in r) && !('pass' in r.summary) && !('ok' in r));
  assert.equal(CR.lint(text('tests/dryrun/retainer-fixed.scad')).summary.errors, 0);
});

test('the 7 flight templates PartForge tests (no recorded failures) and the 17 the app ships lint with no error or warning; flightLint is empty on each flight one', () => {
  const tpl = require('./snapshots/template-cases.js').cases;
  assert.equal(tpl.length, 7);
  for (const k of tpl) {
    assert.deepEqual(k.expect.fails, []);
    const t = text('tests/' + k.file), r = CR.lint(t);
    assert.deepEqual(APP.flightLint(t), [], k.file);
    assert.equal(r.summary.errors + r.summary.warnings, 0, k.file + ': ' + r.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.code).join(','));
  }
  const shipped = corpus.filter((c) => c.group === 'shipped-flight' || c.group === 'shipped-hobby');
  assert.equal(shipped.length, 17);
  for (const c of shipped) {
    const r = CR.lint(c.text);
    assert.equal(r.summary.errors + r.summary.warnings, 0, c.label);
    if (c.group === 'shipped-flight') assert.deepEqual(APP.flightLint(c.text), [], c.label);
  }
});

test('the 8 recorded model runs the gate passed: 0 errors; each flight run\'s one demotion is the loads row\'s missing inputs_ref', () => {
  const runs = corpus.filter((c) => c.group === 'runs');
  assert.equal(runs.length, 8);
  for (const c of runs) {
    assert.ok(c.gate && c.gate.passed, `${c.label}: the run log says PASS (${c.gate && c.gate.source})`);
    const r = CR.lint(c.text);
    assert.equal(r.summary.errors, 0, c.label);
    const app = APP.parseFlight(c.text);
    if (!app) { assert.equal(r.grade, 'hobby'); continue; }
    assert.equal(app.demoted, 1, c.label);
    const [d] = codes(r, 'FLIGHT_DEMOTE');
    assert.equal(d.category, 'loads');
    assert.equal(d.field, 'inputs_src');
    assert.match(d.message, /although the key missing here is inputs_ref/);
    assert.ok(CR.CITES[5587].includes('tol_ref'), 'the app\'s own message, index.html:5587, names tol_ref');
  }
});

// ------------------------------------------------------------------ the proposal's mutations
const RING = 'tests/templates/centering-ring.scad';

test('renaming module ring() to rng(): the SPEC part, its three critical dimensions and main()\'s call are each named at their line', () => {
  const t0 = text(RING), t = mutate(t0, 'module ring(){', 'module rng(){');
  const r = CR.lint(t);
  const miss = codes(r, 'MODULE_MISSING', 'error');
  assert.deepEqual(miss.map((d) => d.line), [12, 16, 17, 18]);
  assert.match(miss[0].message, /SPEC declares a part "ring" but there is no module ring\(\)/);
  const call = where(t, 'ring();', 'module main()');
  const unk = codes(r, 'UNKNOWN_MODULE', 'error');
  assert.deepEqual(unk.map((d) => [d.line, d.col]), [[call.line, call.col]]);
  assert.deepEqual(codes(r, 'UNUSED_MODULE').map((d) => d.line), [where(t, 'rng').line]);
  assert.deepEqual(CR.lint(t0).diagnostics.filter((d) => d.severity !== 'info'), []);
});

test('main() that leaves out a declared part: named, and the app\'s own shortcut functions both accept the file', () => {
  const t0 = text('tests/templates/av-sled.scad');
  const t = mutate(t0, 'union(){ plate(); bosses(); }', 'union(){ plate(); }');
  assert.equal(APP.mainPlainUnion(t, ['plate', 'bosses']), true, 'index.html mainPlainUnion() accepts it');
  assert.equal(APP.topLevelIsOnlyMain(t), true, 'index.html topLevelIsOnlyMain() accepts it');
  const r = CR.lint(t);
  const u = codes(r, 'MAIN_UNREACHED', 'error');
  assert.equal(u.length, 1);
  assert.equal(u[0].line, where(t, 'module bosses').line);
  assert.equal(u[0].gateMisses, true);
  assert.match(u[0].message, /4 FLIGHT entries measured on the finished object/);
  assert.equal(codes(r, 'SHORTCUT', 'warning').length, 1);
  const r0 = CR.lint(t0);
  assert.equal(codes(r0, 'MAIN_UNREACHED').length, 0);
  assert.equal(codes(r0, 'SHORTCUT', 'info').length, 1);
  // a * modifier also leaves it out of the render
  const star = CR.lint(mutate(t0, 'union(){ plate(); bosses(); }', 'union(){ plate(); *bosses(); }'));
  assert.match(codes(star, 'MAIN_UNREACHED')[0].message, /only through a \* or % modifier/);
  // review: % (background) is not rendered either; # (debug) and ! (root) still render it
  const pct = CR.lint(mutate(t0, 'union(){ plate(); bosses(); }', 'union(){ plate(); %bosses(); }'));
  assert.match(codes(pct, 'MAIN_UNREACHED')[0].message, /only through a \* or % modifier/);
  assert.equal(codes(CR.lint(mutate(t0, 'union(){ plate(); bosses(); }', 'union(){ plate(); #bosses(); }')), 'MAIN_UNREACHED').length, 0);
});

test('a "source" tolerance with no tol_ref: a named demotion at its line and key', () => {
  const t = mutate(text(RING), '"nominal_mm":6.35,"tol_mm":0.25,"tol_src":"default"', '"nominal_mm":6.35,"tol_mm":0.25,"tol_src":"source"');
  const r = CR.lint(t);
  assert.equal(APP.parseFlight(t).demoted, 1);
  const [d] = codes(r, 'FLIGHT_DEMOTE', 'warning');
  const at = where(t, '"tol_src":"source"');
  assert.deepEqual([d.line, d.col], [18, at.col]);
  assert.match(d.message, /critical #3 "plate thickness" claims a cited tolerance but tol_src is "source" and there is no tol_ref/);
});

test('a hole count of 0: a named drop, with the 1..64 range read from parseFlight itself', () => {
  assert.deepEqual([APP.VOCAB.HOLE_N_MIN, APP.VOCAB.HOLE_N_MAX], [1, 64]);
  const t = mutate(text(RING), '"n":4,"bc_d_mm":126.00,"start_deg":45', '"n":0,"bc_d_mm":126.00,"start_deg":45');
  const r = CR.lint(t);
  assert.equal(APP.parseFlight(t).dropped, 1);
  const [d] = codes(r, 'FLIGHT_DROP', 'error');
  assert.deepEqual([d.line, d.col], [21, where(t, '"n":0').col]);
  assert.equal(d.field, 'n');
  assert.match(d.message, /holes #2 "M4 retention bolts" is dropped by parseFlight: n 0 is outside 1\.\.64/);
});

test('a global $fn = 200: the app\'s flightLint text (an error in flight grade, a warning in hobby) and its hobby lint, located', () => {
  const t = mutate(text(RING), '// --- end parameters ---\n', '// --- end parameters ---\n$fn = 200;\n');
  const at = where(t, '$fn = 200');
  const app = APP.flightLint(t);
  assert.equal(app.length, 1);
  const r = CR.lint(t);
  const fl = codes(r, 'APP_FLIGHT_LINT', 'error');
  assert.equal(fl.length, 1);
  assert.equal(fl[0].app, app[0]);
  assert.deepEqual([fl[0].line, fl[0].col], [at.line, at.col]);
  assert.match(codes(r, 'APP_LINT', 'warning')[0].message, /\$fn=200 is high/);
  assert.equal(codes(CR.lint(t, { grade: 'hobby' }), 'APP_FLIGHT_LINT', 'warning').length, 1);
});

test('text("A") gives the app\'s text() warning at its column; the same words in a comment are marked false', () => {
  const t = mutate(text(RING), 'module main(){ ring(); }', 'module main(){ ring(); text("A"); }');
  const [d] = codes(CR.lint(t), 'APP_LINT');
  assert.equal(d.severity, 'warning');
  assert.deepEqual([d.line, d.col], [where(t, 'text("A")').line, where(t, 'text("A")').col]);
  const c = mutate(text(RING), '// --- end parameters ---', '// --- end parameters --- (no text() or import() here)');
  assert.equal(APP.lint(c).length, 2, 'the app\'s lint() reads comments too');
  const fl = codes(CR.lint(c), 'APP_LINT');
  assert.deepEqual(fl.map((x) => x.severity), ['info', 'info']);
  assert.match(fl[0].message, /inside a comment/);
});

test('review fix: a real text()/import()/minkowski() after a comment, a string or an identifier tail that mentions it is still a warning, at the real call', () => {
  // Found in review: the first raw match decided the verdict, so a comment mentioning text()
  // above a real text("A") turned the app's true warning into a "false here" note.
  const t = mutate(mutate(text(RING), '// --- end parameters ---', '// --- end parameters --- (no text(), import() or minkowski() here)'),
    'module main(){ ring(); }', 'module mytext(){ cube(1); }\nmodule main(){ ring(); mytext(); echo("text(", "import("); text("A"); import("x.stl"); minkowski(){ cube(1); cube(2); } }');
  assert.equal(APP.lint(t).length, 3, 'the app\'s lint() warns about all three');
  const d = codes(CR.lint(t), 'APP_LINT');
  assert.deepEqual(d.map((x) => x.severity), ['warning', 'warning', 'warning']);
  for (const [k, call] of [['minkowski', 'minkowski(){'], ['text', 'text("A")'], ['import', 'import("x.stl")']]) {
    const x = d.find((y) => y.app.startsWith(k));
    assert.deepEqual([x.line, x.col], [where(t, call, 'module main()').line, where(t, call, 'module main()').col], k);
  }
  assert.match(d.find((y) => y.app.startsWith('text')).message, /4 earlier matches in comments, strings or identifier tails do not count/);
  // only a string mentions it: false, and said so
  const s = mutate(text(RING), 'module main(){ ring(); }', 'module main(){ ring(); echo("import(x)"); }');
  assert.equal(APP.lint(s).length, 1);
  const [only] = codes(CR.lint(s), 'APP_LINT');
  assert.equal(only.severity, 'info');
  assert.match(only.message, /inside a string/);
});

// ------------------------------------------------------------------ JSON positions
test('a trailing comma in the FLIGHT JSON is reported at the comma\'s own line and column', () => {
  const t = mutate(text(RING), '"inputs_src":"default"}],', '"inputs_src":"default"},],');
  const r = CR.lint(t);
  const [d] = codes(r, 'FLIGHT_JSON', 'error');
  const at = where(t, '},]');
  assert.deepEqual([d.line, d.col], [22, at.col + 1]);
  assert.match(d.message, /trailing comma before '\]'/);
  assert.equal(APP.parseFlight(t).malformed, true);
});

test('the reader\'s error offset equals V8\'s "at position N" on 300+ malformed FLIGHT blocks', (t) => {
  let compared = 0, unlocated = 0;
  for (const id of ['tests/dryrun/endcap.scad', 'tests/templates/bulkhead.scad', 'tests/templates/fin.scad']) {
    const t = text(id);
    const blk = CR.extractBlock(t, APP.VOCAB.FLIGHT_BLOCK_RE, APP.VOCAB.LINE_PREFIX_RE);
    const j = blk.json;
    const edits = [];
    for (let i = 0; i < j.length; i++) {
      const ch = j[i];
      if (',:{}[]"'.includes(ch)) edits.push(j.slice(0, i) + j.slice(i + 1));
      if (ch === ',') edits.push(j.slice(0, i) + ',,' + j.slice(i + 1));
      if (ch === '}' && i % 3 === 0) edits.push(j.slice(0, i) + ',' + j.slice(i));
      if (ch === '0' && i % 5 === 0) edits.push(j.slice(0, i) + '.' + j.slice(i + 1));
    }
    for (const e of edits) {
      let v8 = null;
      try { JSON.parse(e); continue; } catch (err) { const m = /at position (\d+)/.exec(err.message); v8 = m ? +m[1] : null; }
      let mine = null;
      try { CR.parseJsonLoc(e); } catch (err) { mine = err; }
      assert.ok(mine && mine.jsonError, 'Cold Read also rejects it');
      if (v8 == null) { unlocated++; continue; }
      assert.equal(mine.offset, v8, `${id}: ${JSON.stringify(e.slice(Math.max(0, v8 - 20), v8 + 10))} ${mine.message}`);
      compared++;
    }
  }
  assert.ok(compared >= 300, `${compared} compared (${unlocated} where V8 gives no position)`);
  t.diagnostic(`${compared} malformed blocks compared with V8's position; ${unlocated} more where V8 names no position`);
});

test('the reader agrees with JSON.parse on every bundled block, and catches the duplicate key JSON.parse silently resolves', () => {
  for (const c of corpus) for (const re of [APP.VOCAB.FLIGHT_BLOCK_RE, APP.VOCAB.SPEC_BLOCK_RE]) {
    const blk = CR.extractBlock(c.text, re, APP.VOCAB.LINE_PREFIX_RE);
    if (blk) assert.deepEqual(CR.parseJsonLoc(blk.json).value, JSON.parse(blk.json), c.label);
  }
  // where V8 names no position ("Unexpected token"), hand-counted offsets: the stray character,
  // and for a trailing comma the comma itself (what the diagnostic points at)
  for (const [s, off, point] of [['[1, 2 , ]', 8, 6], ['{"a": }', 6, undefined], ['[1 , {"b":[] , } ]', 15, 13]]) {
    assert.throws(() => JSON.parse(s));
    assert.throws(() => CR.parseJsonLoc(s), (e) => e.offset === off && e.pointAt === point, s);
  }
  const r = CR.parseJsonLoc('{"a":1,"b":{"c":2},"a":3}');
  assert.deepEqual(r.value, JSON.parse('{"a":1,"b":{"c":2},"a":3}'));
  assert.deepEqual(r.dupes.map((d) => [d.key, d.first, d.second]), [['a', 1, 19]]);
  const t = mutate(text(RING), '"hazard":"none",', '"hazard":"none","critical":[],');
  const dup = codes(CR.lint(t), 'DUP_KEY', 'error');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].line, 16);
});

// ------------------------------------------------------------------ SPEC and structure
test('SPEC: an unclosed block, a trailing comma and a nameless part are each named where they are', () => {
  const t0 = text(RING);
  const unclosed = CR.lint(mutate(t0, '// SPEC-END\n', ''));
  assert.equal(codes(unclosed, 'SPEC_UNCLOSED', 'error')[0].line, 10);
  const comma = mutate(t0, '"size_mm":[149.5,149.5,6.35]}]}', '"size_mm":[149.5,149.5,6.35],}]}');
  assert.equal(APP.parseSpec(comma), null);
  const [sj] = codes(CR.lint(comma), 'SPEC_JSON', 'error');
  assert.equal(sj.line, 12);
  assert.equal(sj.col, where(comma, '6.35],}').col + 5);
  const nameless = mutate(t0, '"parts":[{"name":"ring",', '"parts":[{"nam":"ring",');
  assert.equal(APP.parseSpec(nameless), null);
  const r = CR.lint(nameless);
  assert.match(codes(r, 'SPEC_DROP', 'error')[0].message, /part #1 is dropped by parseSpec without a word: it has no "name"/);
  assert.deepEqual(parityErrors(r), []);
});

test('flight grade with no FLIGHT block, and a block with no END line, are errors; hobby grade without one is not', () => {
  const t0 = text(RING);
  const noFlight = t0.replace(/\/\/ FLIGHT-BEGIN[\s\S]*?\/\/ FLIGHT-END\n/, '');
  assert.equal(codes(CR.lint(noFlight, { grade: 'flight' }), 'FLIGHT_MISSING', 'error').length, 1);
  assert.equal(CR.lint(noFlight).grade, 'hobby');
  assert.equal(codes(CR.lint(noFlight), 'FLIGHT_MISSING').length, 0);
  const open = CR.lint(mutate(t0, '// FLIGHT-END\n', ''));
  assert.equal(codes(open, 'FLIGHT_UNCLOSED', 'error')[0].line, 14);
});

test('robustness: every prefix of every bundled text lints without throwing and without a PARITY error', (t) => {
  let runs = 0;
  for (const c of corpus) {
    const step = Math.max(1, Math.floor(c.text.length / 40));
    for (let k = 0; k <= c.text.length; k += step) {
      const r = CR.lint(c.text.slice(0, k));
      runs++;
      assert.deepEqual(parityErrors(r).map((d) => d.message), [], `${c.label} cut at ${k}`);
      assert.equal(r.footer, 'text checks only; geometry not checked');
    }
  }
  assert.ok(runs > 1400);
  t.diagnostic(`${runs} prefixes linted`);
  assert.throws(() => CR.lint(42), TypeError);
  assert.equal(CR.lint('').summary.errors, 0);
});

// ------------------------------------------------------------------ every rule, one case each (added in review)
// Found in review: 33 of the 51 rules could be deleted from coldread.js with every test still
// passing. Each case below makes one real PartForge text break one rule, asserts the rule fires
// with the catalogue's severity at the line of the edit, and pins what the APP does with the same
// text (its own function, run verbatim) so the diagnostic's claim about the app is checked too.
const SPEC_PARTS = '"parts":[{"name":"ring","role":"thrust-transfer centering ring, chamfered OD, 8 holes","size_mm":[149.5,149.5,6.35]}]';
const SPEC_TAIL = '"size_mm":[149.5,149.5,6.35]}]}';
const PARAM_END = '// --- end parameters ---\n';
const MAIN = 'module main(){ ring(); }';
const flightDoc = (t0, edit) => {
  const blk = CR.extractBlock(t0, APP.VOCAB.FLIGHT_BLOCK_RE, APP.VOCAB.LINE_PREFIX_RE);
  const doc = JSON.parse(blk.json); edit(doc);
  return t0.slice(0, blk.start) + '// FLIGHT-BEGIN\n// ' + JSON.stringify(doc) + '\n// FLIGHT-END' + t0.slice(blk.end);
};
const RULE_CASES = [
  // [code, severity, build(t0) -> text, anchor for the expected line (or null: whole file), app check, opts, extra check on the result]
  ['SPEC_SHAPE', 'error', (t) => mutate(t, SPEC_PARTS, '"parts":{"name":"ring"}'), '"parts":{', (t) => APP.parseSpec(t) === null],
  ['SPEC_SIZE', 'warning', (t) => mutate(t, SPEC_TAIL, '"size_mm":[149.5,149.5]}]}'), '"size_mm":[149.5,149.5]}', (t) => APP.parseSpec(t).parts[0].size_mm === null],
  ['SPEC_SIZE', 'warning', (t) => mutate(t, SPEC_TAIL, '"size_mm":[149.5,0,6.35]}]}'), '"size_mm":[149.5,0,', (t) => !APP.parseSpec(t).parts[0].size_mm.every((v) => v > 0)],
  ['SPEC_DUP', 'warning', (t) => mutate(t, SPEC_TAIL, '"size_mm":[149.5,149.5,6.35]},{"name":"ring","size_mm":[1,1,1]}]}'), '{"name":"ring","size_mm":[1,1,1]}', (t) => APP.parseSpec(t).parts.filter((p) => p.name === 'ring').length === 2],
  ['JOINT_MODULE', 'error', (t) => mutate(t, SPEC_TAIL, SPEC_TAIL.slice(0, -1) + ',"joints":[{"a":"ring","b":"lid"}]}'), '"joints"', (t) => APP.parseSpec(t).joints.length === 1 && !APP.appDefinedModules(t).has('lid')],
  ['SPEC_REF', 'warning', (t) => mutate(t, SPEC_TAIL, SPEC_TAIL.slice(0, -1) + ',"layout":[{"a":"ring","b":"cap","rel":"above"}]}'), '"layout"', (t) => APP.parseSpec(t).layout[0].b === 'cap'],
  ['SPEC_CAP', 'warning', (t) => mutate(t, SPEC_TAIL, SPEC_TAIL.slice(0, -1) + ',"proportions":[' + Array.from({ length: 9 }, () => '{"a":"ring","b":"ring","min":1,"max":2}').join(',') + ']}'), '"proportions"',
    (t) => APP.parseSpec(t).rules.length === APP.VOCAB.SPEC_CAPS.rules, null, (r) => codes(r, 'SPEC_CAP').length === 9 - APP.VOCAB.SPEC_CAPS.rules],
  ['FLIGHT_SHAPE', 'error', (t) => t.replace(/\/\/ FLIGHT-BEGIN\n[\s\S]*?\/\/ FLIGHT-END/, '// FLIGHT-BEGIN\n// [1]\n// FLIGHT-END'), '// [1]', (t) => APP.parseFlight(t).malformed === true],
  ['FLIGHT_KEY', 'warning', (t) => mutate(t, '"hazard":"none",', '"hazard":"none","critcal":[],'), '"critcal"', (t) => APP.parseFlight(t).critical.length === 3],
  ['FLIGHT_NOT_ARRAY', 'error', (t) => flightDoc(t, (d) => { d.bores = { a: d.bores }; }), '"bores"', (t) => { const f = APP.parseFlight(t); return f.bores.length === 0 && f.dropped === 0; }, null, (r) => r.summary.named.uncounted === 1],
  ['FLIGHT_UNCOUNTED', 'error', (t) => flightDoc(t, (d) => { d.bores.unshift(7); }), '"bores"', (t) => { const f = APP.parseFlight(t); return f.bores.length === 1 && f.dropped === 0; }, null, (r) => r.summary.named.uncounted === 1],
  ['HAZARD', 'error', (t) => mutate(t, '"hazard":"none"', '"hazard":"Pressure"'), '"hazard"', (t) => APP.parseFlight(t).hazard === 'none'],
  ['VOCAB', 'warning', (t) => mutate(t, '"tol_mm":0.25,"tol_src":"default"', '"tol_mm":0.25,"tol_src":"Source","tol_ref":"MIL-STD"'), '"tol_src":"Source"',
    (t) => { const f = APP.parseFlight(t); return f.critical[2].tol_src === 'default' && f.demoted === 0; }],
  ['DUP_NAME', 'warning', (t) => mutate(t, '"name":"ring OD (y)"', '"name":"ring OD"'), '"name":"ring OD","module":"ring","axis":"y"', (t) => APP.parseFlight(t).critical.filter((c) => c.name === 'ring OD').length === 2],
  ['NOTHING_DECLARED', 'error', (t) => flightDoc(t, (d) => { delete d.critical; delete d.bores; delete d.holes; }), 'FLIGHT-BEGIN', (t) => APP.parseFlight(t).declared === 0],
  ['TESS_MISMATCH', 'warning', (t) => mutate(t, '"tess_tol_mm":0.01', '"tess_tol_mm":0.02'), 'tess_tol = 0.01', (t) => APP.parseFlight(t).tess_tol_mm === 0.02 && APP.flightLint(t).length === 0],
  ['TESS_UNDECLARED', 'info', (t) => mutate(t, '"tess_tol_mm":0.01,', ''), '// {"material"', (t) => APP.parseFlight(t).tess_tol_mm === 0],
  ['FN_HIGH', 'warning', (t) => mutate(t, PARAM_END, PARAM_END + 'module q(){ sphere(1, $fn=64); sphere(2, $fn=300); }\n'), '$fn=300', (t) => APP.lint(t).length === 0],
  ['DUP_MODULE', 'warning', (t) => mutate(t, MAIN, 'module ring(){ cube(1); }\n' + MAIN), 'ring(){ cube(1); }', () => true],
  ['COMMENTED_MODULE', 'warning', (t) => mutate(t, MAIN, '/*\nmodule gauge_x(){ cube(1); }\n*/\n' + MAIN), 'module gauge_x', (t) => APP.appDefinedModules(t).has('gauge_x')],
  ['BRACES', 'error', (t) => mutate(t, MAIN, 'module main(){ ring(); '), '{ ring(); ', () => true],
  ['INCLUDE', 'warning', (t) => mutate(mutate(t, PARAM_END, PARAM_END + 'include <lib.scad>\n'), MAIN, 'module main(){ ring(); libpart(); }'), 'include <', (t) => APP.lint(t).length === 0, null,
    (r) => codes(r, 'UNKNOWN_MODULE', 'warning').length === 1 && !codes(r, 'UNKNOWN_MODULE', 'error').length],
  ['MAIN_MISSING', 'warning', (t) => mutate(t, MAIN + '\nmain();', 'ring();'), '// SPEC-END', (t) => !APP.mainPlainUnion(t, ['ring'])],
  ['MAIN_MISSING', 'error', (t) => mutate(t, MAIN + '\nmain();', 'ring();'), '// SPEC-END', (t) => !APP.mainPlainUnion(t, ['ring']), { grade: 'hobby' }],
  ['NOTHING_RENDERS', 'error', (t) => mutate(t, MAIN + '\nmain();', MAIN), null, (t) => !APP.topLevelIsOnlyMain(t)],
  ['GAUGE_RENDERED', 'warning', (t) => mutate(t, MAIN, 'module gauge_pin(){ cube(1); }\nmodule main(){ ring(); gauge_pin(); }'), 'gauge_pin(){', () => true],
  ['ROOT_MODIFIER', 'warning', (t) => mutate(t, MAIN, 'module main(){ !ring(); }'), '!ring', () => true],
  ['TOP_LEVEL', 'warning', (t) => mutate(t, 'main();\n', 'main();\ncube(1);\n'), 'cube(1);', (t) => !APP.topLevelIsOnlyMain(t)],
  ['TOP_LEVEL', 'info', (t) => mutate(t, 'main();\n', 'main();\ncube(1);\n'), 'cube(1);', (t) => !APP.topLevelIsOnlyMain(t), { grade: 'hobby' }],
  ['ASSEMBLY', 'info', () => '// MODULE: a\n// MODULE: b\nmodule a(){ cube(1); }\nmodule b(){ cube(1); }\na();\nb();\n', '// MODULE: a', (t) => APP.parseManifest(t).mods.join() === 'a,b'],
  ['NO_SPEC', 'info', () => 'module main(){ cube(1); }\nmain();\n', null, (t) => APP.parseSpec(t) === null],
  ['PARAM_SENTINEL', 'warning', (t) => mutate(t, PARAM_END, ''), null, () => true],
  ['PARAM_HIDDEN', 'info', (t) => mutate(t, 'cut_ext = 1;', '  cut_ext = 1;'), '  cut_ext = 1;', (t) => !APP.PARAM_RE.test('  cut_ext = 1; // x')],
  ['TESS_NOT_FIRST', 'info', (t) => mutate(mutate(t, 'tess_tol = 0.01; // max chordal deviation of curved surfaces (mm)\n', ''), 'cut_ext = 1;', 'tess_tol = 0.01; // x\ncut_ext = 1;'), 'ring_od = 149.50;',
    (t) => APP.flightLint(t).length === 0],
  ['DUP_ASSIGN', 'warning', (t) => mutate(t, 'cut_ext = 1;', 'cut_ext = 1; cut_ext = 2;'), 'cut_ext = 2', () => true],
];

test('every rule fires on a one-line break of a real PartForge text, at the catalogue\'s severity, and its claim about the app holds', () => {
  const ring = text(RING);
  const seen = new Set();
  for (const [code, sev, build, anchor, appCheck, opts, extra] of RULE_CASES) {
    const t = build(ring), r = CR.lint(t, opts);
    const label = `${code} (${sev}${opts ? ', ' + opts.grade : ''})`;
    const hits = codes(r, code, sev);
    assert.ok(hits.length >= 1, `${label}: fires; got ${r.diagnostics.map((d) => d.code + '/' + d.severity).join(', ')}`);
    assert.equal(hits[0].line, anchor ? where(t, anchor).line : 0, `${label}: at the line of the edit`);
    assert.ok(appCheck(t), `${label}: the app's own function agrees with what the message says it does`);
    if (extra) assert.ok(extra(r), `${label}: ${String(extra)}`);
    assert.deepEqual(parityErrors(r).map((d) => d.message), [], label);
    const cat = CR.RULES.find((x) => x.code === code);
    assert.ok(cat && cat.severity.includes(sev), `${label}: the catalogue lists severity ${sev} (it says "${cat && cat.severity}")`);
    assert.ok(!/undefined|NaN|\[object/.test(hits[0].message), `${label}: ${hits[0].message}`);
    seen.add(code);
  }
  // the rules the tests above pin, so that every catalogued rule has at least one test
  for (const c of ['SPEC_UNCLOSED', 'SPEC_JSON', 'SPEC_DROP', 'MODULE_MISSING', 'FLIGHT_MISSING', 'FLIGHT_UNCLOSED', 'FLIGHT_JSON', 'DUP_KEY', 'FLIGHT_CAP',
    'FLIGHT_DROP', 'FLIGHT_DEMOTE', 'CONTRADICTION', 'APP_FLIGHT_LINT', 'APP_LINT', 'UNKNOWN_MODULE', 'MAIN_UNREACHED', 'SHORTCUT', 'UNUSED_MODULE', 'PARITY']) seen.add(c);
  assert.deepEqual(CR.RULES.map((x) => x.code).filter((c) => !seen.has(c)), [], 'every catalogued rule has a test');
  assert.equal(CR.RULES.length, 51);
});

test('PARITY: when the app\'s counter and Cold Read\'s named entries disagree, Cold Read says so and reports the app\'s number', () => {
  const t = text(RING);
  // a parseFlight that counts one extra drop on the whole file (not on the one-entry probes)
  const lying = Object.assign({}, APP, { parseFlight: (c) => { const f = APP.parseFlight(c); if (f && !f.malformed && c.includes('tess_tol =')) f.dropped += 1; return f; } });
  const r = CR.lint(t, { rules: lying });
  const p = parityErrors(r);
  assert.equal(p.length, 1);
  assert.match(p[0].message, /Cold Read names 0 dropped FLIGHT entries; parseFlight counts 1\. Trust the app's count/);
  assert.equal(r.summary.app.dropped, 1, 'the summary carries the app\'s number');
  assert.deepEqual(parityErrors(CR.lint(t)), []);
});

// ------------------------------------------------------------------ the CLI
test('the CLI: exit 1 with file:line:col on the endcap, 0 on the retainer, 2 on a missing file; --json and --corpus', () => {
  const cli = path.join(here, 'cold-read.mjs');
  const run = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8' });
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'coldread-'));
  try {
    fs.writeFileSync(path.join(tmp, 'endcap.scad'), text('tests/dryrun/endcap.scad'));
    fs.writeFileSync(path.join(tmp, 'retainer.scad'), text('tests/dryrun/retainer.scad'));
    const e = run(path.join(tmp, 'endcap.scad'));
    assert.equal(e.status, 1);
    assert.match(e.stdout, /endcap\.scad:29:68: error CONTRADICTION/);
    assert.match(e.stdout.trim(), /text checks only; geometry not checked$/);
    assert.equal(run(path.join(tmp, 'retainer.scad')).status, 0);
    assert.equal(run(path.join(tmp, 'nope.scad')).status, 2);
    const j = JSON.parse(run('--json', path.join(tmp, 'endcap.scad')).stdout);
    assert.equal(j.summary.errors, 2);
    const c = run('--corpus');
    assert.equal(c.status, 1);
    assert.equal(c.stdout.trim().split('\n').length, 37);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
