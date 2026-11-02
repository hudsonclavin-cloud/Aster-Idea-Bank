// census.test.mjs — node --test ideas/29-confidence-census/census.test.mjs (from the bank root).
//
// Three kinds of test:
//  1. every rule fires on a planted fixture and is silent on a clean one (the fixture is built here);
//  2. the census and the reconciliation reproduce numbers PartForge publishes about itself
//     (data/README.md, docs/data/PROVENANCE.md, docs/roadmap-evaluation.md), each pinned with its
//     file:line, and the policy text in the snapshot is checked to contain the pinned number;
//  3. reproducibility: the committed findings.json equals a fresh run on the committed snapshots
//     byte for byte, and — when a PartForge checkout with the same bytes is present — the snapshots
//     equal a fresh build from that checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadCheckout, loadSnapshots, viewModule, sha256, TABLES_DIR } from './checkout.mjs';

const require = createRequire(import.meta.url);
const C = require('./census.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const SNAP = loadSnapshots(here);
const RES = C.run(SNAP.views, SNAP.policy);
const view = (t) => SNAP.views.find((v) => v.table === t);
const census = (t) => RES.census.find((c) => c.table === t);
const findings = (pred) => RES.findings.filter(pred);
const policyText = (k) => SNAP.policy[k].lines.map((l) => l.text).join('\n');

// ------------------------------------------------------------------ 1. planted fixtures
function clean() {
  return {
    table: 'demo',
    license_note: 'Fixture written for this test.',
    columns: { key: 'id', confidence: 'certain / likely / recall', source: 'where it came from', d_in: 'inch, as printed', d_mm: 'mm, d_in x 25.4 to 3 decimals', note: 'free text' },
    rows: [
      { key: 'a', confidence: 'certain', source: 'ASME B18.3 Table 1', d_in: 0.25, d_mm: 6.35, note: 'x' },
      { key: 'b', confidence: 'likely', source: 'vendor catalogue page 3; cross-checked', d_in: 0.5, d_mm: 12.7, note: 'y' },
      { key: 'c', confidence: 'recall', source: 'recall of the vendor chart', d_in: 0.1875, d_mm: 4.763, note: 'z' },
    ],
    notes: 'ASME B94.11M-1993 is an edition year, not a data date.',
    reconciliation: { date: '2026-09-17', method: 'three skeptics' },
  };
}
const lint = (t) => C.lintTable(C.viewOf('demo', t));
const rules = (fs_) => fs_.map((f) => f.rule).sort();

test('a clean table produces no finding at all', () => {
  assert.deepEqual(lint(clean()), []);
});

test('row-shape rules: missing source, missing key, duplicate key, invalid label', () => {
  let t = clean(); t.rows[0].source = '';
  assert.deepEqual(lint(t).map((f) => [f.rule, f.key, f.severity]), [['source-missing', 'a', 'defect']]);
  t = clean(); delete t.rows[1].source;
  assert.deepEqual(rules(lint(t)), ['source-missing']);
  t = clean(); delete t.rows[2].key;
  assert.deepEqual(rules(lint(t)), ['key-missing']);
  t = clean(); t.rows[2].key = 'a';
  assert.deepEqual(lint(t).map((f) => [f.rule, f.key, f.detail]), [['key-duplicate', 'a', '2 rows share this key']]);
  t = clean(); t.rows[1].confidence = 'verified';
  assert.deepEqual(lint(t).map((f) => [f.rule, f.key]), [['confidence-invalid', 'b']]);
  const c = C.censusTable(C.viewOf('demo', t));   // an unknown label is counted as "other", never as one of the three
  assert.deepEqual([c.certain, c.likely, c.recall, c.other], [1, 0, 1, 1]);
});

test('label-vs-text: "recall" or "from memory" under certain/likely is a review item, quoted; under recall it is silent', () => {
  let t = clean(); t.rows[0].source = 'ASME B18.3 Table 1 (recall)';
  let f = lint(t);
  assert.deepEqual(f.map((x) => [x.rule, x.key, x.severity]), [['label-vs-text', 'a', 'review']]);
  assert.match(f[0].detail, /labelled `certain`; source says “ASME B18\.3 Table 1 \(recall\)”/);
  t = clean(); t.rows[1].source = 'compiled from memory by one model';
  assert.deepEqual(rules(lint(t)), ['label-vs-text']);
  t = clean(); t.rows[1].source = 'datasheet (recalled)';
  assert.deepEqual(rules(lint(t)), ['label-vs-text']);
  t = clean(); t.rows[1].source = 'Recallibrated gauge';   // a word that only starts with "recall"
  assert.deepEqual(lint(t), []);
});

test('documentation rules: undocumented field (defect), unused column (info), no license note, dateless', () => {
  let t = clean(); t.rows[1].ultimate_design_factor = 1.4;
  let f = lint(t);
  assert.deepEqual(f.map((x) => [x.rule, x.severity, x.field, x.count]), [['undocumented-field', 'defect', 'ultimate_design_factor', 1]]);
  t = clean(); t.columns.ghost = 'a column nobody fills';
  assert.deepEqual(lint(t).map((x) => [x.rule, x.severity, x.fields]), [['unused-column', 'info', ['ghost']]]);
  t = clean(); delete t.license_note;
  assert.deepEqual(rules(lint(t)), ['no-license-note']);
  t = clean(); delete t.columns;
  assert.ok(rules(lint(t)).includes('no-columns'));
  t = clean(); delete t.reconciliation;   // the edition year left in notes is not a data date
  f = lint(t);
  assert.deepEqual(f.map((x) => [x.rule, x.severity]), [['dateless', 'review']]);
  assert.match(f[0].detail, /no YYYY-MM-DD in table, license_note, columns, notes$/);
});

test('findDates takes calendar dates only', () => {
  assert.deepEqual(C.findDates('ASME B94.11M-1993; fetched 2026-09-17 and 2026-09-17, then 2026-13-01 and 2026-02-30x'), ['2026-09-17']);
  assert.deepEqual(C.findDates({ a: ['2025-01-31', '1999-12-01'] }), ['1999-12-01', '2025-01-31']);
});

test('inch/mm: an edited value is review, a rounding-chain step is info, an exact pair and an undeclared pair are not reviewed', () => {
  let t = clean(); t.rows[0].d_mm = 6.85;                    // one side edited by 0.5 mm
  let f = lint(t);
  assert.deepEqual(f.map((x) => [x.rule, x.severity, x.count]), [['inch-mm', 'review', 1]]);
  assert.match(f[0].detail, /exceeds 0\.0005 mm \(declared: d_mm 3 dp\); worst a at 0\.5 mm$/);
  t = clean(); t.rows[0].d_mm = 6.3509;                      // 0.0009 mm: past half a unit, within one
  f = lint(t);
  assert.deepEqual(f.map((x) => [x.rule, x.severity]), [['inch-mm', 'info']]);
  t = clean(); t.columns.d_in = 'd_mm / 25.4 rounded to 3 decimals'; t.columns.d_mm = 'mm, as ThrustCurve stores it';
  Object.assign(t.rows[0], { d_mm: 117, d_in: 4.606 });     // the motors shape: 4.606 in x 25.4 = 116.9924, inside 0.0127 mm
  assert.deepEqual(lint(t), []);
  t.rows[0].d_in = 4.616;                                    // 0.25 mm out
  assert.deepEqual(lint(t).map((x) => [x.rule, x.severity]), [['inch-mm', 'review']]);
  t = clean(); t.columns.d_mm = 'mm';                        // nothing declared: reported, never judged
  f = lint(t);
  assert.deepEqual(f.map((x) => [x.rule, x.severity]), [['inch-mm-undeclared', 'info']]);
  assert.equal(C.declaredDecimals('len_mm / 25.4 rounded to 3 decimals'), 3);
  assert.equal(C.declaredDecimals('nominal diameter, decimal inches … rounded to 4 places HALF-TO-EVEN'), 4);
  assert.equal(C.declaredDecimals('(exact x25.4 conversion of pcb_l_in, 3 dp, where an inch value exists)'), 3);
  assert.equal(C.declaredDecimals('mm, inside diameter'), null);
});

test('length-vs-records: the 117-vs-177 Loki shape fires (review when undisputed, info when disputed); within 20 % it is silent', () => {
  const t = clean();
  t.columns.len_mm = 'mm'; t.columns.len_variants = 'mm list';
  Object.assign(t.rows[0], { len_mm: 117, len_variants: [117, 177, 177.8, 190] });
  let f = lint(t);
  assert.deepEqual(f.map((x) => [x.rule, x.key, x.severity]), [['length-vs-records', 'a', 'review']]);
  assert.match(f[0].detail, /len_mm 117 vs records \[117, 177, 177\.8, 190\], median 177\.4 \(-34 %\); not disputed/);
  t.rows[0].disputed = [{ field: 'len_mm', value: '~177.8 mm' }];
  t.columns.disputed = 'what a reviewer contested';
  f = lint(t);
  assert.deepEqual(f.filter((x) => x.rule === 'length-vs-records').map((x) => x.severity), ['info']);
  const u = clean(); u.columns.len_mm = 'mm'; u.columns.len_variants = 'mm list';
  Object.assign(u.rows[1], { len_mm: 360, len_variants: [260, 360, 367] });   // median 360: inside 20 %
  assert.deepEqual(lint(u), []);
  assert.equal(C.median([497, 870]), 683.5);
});

test('field-weaker-than-row: a row label stronger than one of its fields (PROVENANCE.md:17) is reported once per field', () => {
  const t = clean(); t.columns.field_confidence = 'per-field';
  t.rows[0].field_confidence = { d_mm: 'certain (arithmetic)', note: 'recall' };
  t.rows[1].field_confidence = { note: 'recall' };
  const f = lint(t);
  assert.deepEqual(f.map((x) => [x.rule, x.detail]), [
    ['field-weaker-than-row', '1 row labelled `certain` carry `note` as `recall` (field_confidence)'],
    ['field-weaker-than-row', '1 row labelled `likely` carry `note` as `recall` (field_confidence)'],
  ]);
  const u = clean(); u.columns.tolerance_confidence = 'x';
  u.rows[2].tolerance_confidence = 'likely';   // stronger than the row: fine
  assert.deepEqual(lint(u), []);
});

test('supplements and the disputed ledger', () => {
  const t = clean();
  t.supplement = [{ confidence: 'recall', source: 's' }, { confidence: 'likely', source: 's' }, { key: 'k', confidence: 'certain' }];
  t.rows[1].disputed = [{ field: 'd_mm', compiled: 12.6, kept: 12.7 }, { field: 'note', value: 'q' }];
  t.columns.disputed = 'ledger';
  const f = lint(t);
  assert.deepEqual(f.map((x) => [x.rule, x.severity, x.detail]), [
    ['disputed', 'info', '1 row carry 2 disputed entries; most contested: d_mm ×1, note ×1'],
    ['supplement-census', 'info', '3 supplement rows: 1 certain, 1 likely, 1 recall; 1 with no source'],
    ['supplement-no-key', 'review', '2 of 3 supplement rows have no `key`'],
  ]);
  const L = C.ledger(C.viewOf('demo', t));
  assert.equal(L.rows.length, 1);
  assert.deepEqual(L.rows[0].entries, t.rows[1].disputed);
});

test('the lint view is lossless for what the rules read (sources with "; ", "|" in keys, empty and missing sources)', () => {
  const t = clean();
  t.rows = [
    { key: 'AeroTech|F44W', confidence: 'likely', source: 'thrustcurve-db 4.0.1, record 5f42; peak derived; not certified' },
    { key: 'AeroTech|F12J', confidence: 'recall', source: 'thrustcurve-db 4.0.1, record 5f43' },
    { key: 'Ünïcode ✓', confidence: 'likely', source: '' },
    { key: 'x', confidence: 'certain' },
    { key: 'y', confidence: 'certain', source: '; ;' },
  ];
  const v = JSON.parse(JSON.stringify(C.viewOf('demo', t)));   // as written to disk and read back
  const R = C.rowsOf(v);
  assert.deepEqual(R.map((r) => [r.key, r.confidence, C.rowSource(v, r)]), t.rows.map((r) => [r.key, r.confidence, r.source === undefined ? null : r.source]));
  assert.deepEqual(R.map((r) => C.rowFields(v, r)), t.rows.map((r) => Object.keys(r)));
});

// ------------------------------------------------------------------ policy parsers
test('the data/README.md policy parser reads the snapshot: 14 tables, the countable claims, no "Table 1" miscount', () => {
  const p = C.parseReadmePolicy(SNAP.policy.readme.lines);
  assert.deepEqual(p.errors, []);
  assert.equal(p.tables.length, 14);
  const pick = (table, kind) => p.claims.filter((c) => c.table === table && c.kind === kind).map((c) => [c.n, c.labels || c.label || c.names]);
  assert.deepEqual(pick('motor_perf', 'count'), [[875, ['likely']], [162, ['recall']]]);   // data/README.md:36
  assert.deepEqual(pick('motor_perf', 'disputed'), [[7, undefined]]);
  assert.deepEqual(pick('drills', 'count'), [[204, ['certain']], [78, ['likely', 'recall']]]);   // data/README.md:41
  assert.deepEqual(pick('fits', 'withheld'), [[5, undefined]]);
  assert.deepEqual(pick('motors', 'current'), [[103, undefined]]);
  assert.deepEqual(pick('airframes', 'subject').map((x) => x[1]), ['recall', 'likely']);
  assert.deepEqual(pick('npt', 'count'), []);   // "Table 1 values `certain`" is not a count of 1
  assert.deepEqual(p.claims.filter((c) => c.table === 'npt' && c.kind === 'subject').map((c) => c.names), [['Table 1 values'], ['tap drills']]);
});

test('the PROVENANCE.md parser reads the "Overall confidence" lines, including "+ `key`" and key lists', () => {
  const p = C.parseProvenanceOverall(SNAP.policy.provenance.lines);
  assert.deepEqual(p.errors, []);
  assert.equal(p.tables.length, 10);   // the doc was written for ten tables (PROVENANCE.md:15)
  const counts = (t) => p.claims.filter((c) => c.table === t && (c.kind === 'count' || c.kind === 'all')).map((c) => [c.labels[0], c.n]);
  assert.deepEqual(counts('drills'), [['certain', 204], ['likely', 74], ['recall', 4]]);          // PROVENANCE.md:105
  assert.deepEqual(counts('rails'), [['certain', 4], ['likely', 6], ['recall', 8]]);              // :141, "5 vendor buttons + `lug_rod_025`"
  assert.deepEqual(counts('fasteners_un'), [['likely', 12], ['recall', 4], ['certain', 0]]);      // :51 incl. "No row certain"
  assert.deepEqual(p.claims.filter((c) => c.table === 'avionics' && c.kind === 'keys').map((c) => c.keys), [['bat_9v_pp3_alkaline', 'bat_9v_lithium_u9vl', 'bat_cr123a']]);
});

test('a policy table the parser cannot find is "could not reconcile" (info), never a defect', () => {
  const r = C.reconcile({ readme: { lines: [{ n: 1, text: '# no table here' }] }, provenance: { lines: [] } }, SNAP.views);
  assert.deepEqual(r.findings.map((f) => [f.rule, f.severity]), [['policy-prose', 'info']]);
  assert.match(r.findings[0].detail, /^could not reconcile: data\/README\.md: the "\| table \| what \| rows \| confidence policy \|" header was not found$/);
});

// ------------------------------------------------------------------ 2. pins to what PartForge says about itself
test('row census reproduces the counts PartForge publishes', () => {
  // [table, label, n, where PartForge states it, the text that must be in the snapshot]
  const pins = [
    ['drills', 'certain', 204, 'PROVENANCE.md:105', 'certain (204 rows)'],
    ['drills', 'likely', 74, 'PROVENANCE.md:105', 'likely (74)'],
    ['drills', 'recall', 4, 'PROVENANCE.md:105', 'recall (4)'],
    ['airframes', 'recall', 161, 'PROVENANCE.md:195', 'recall (161 rows'],
    ['stock', 'recall', 148, 'PROVENANCE.md:123', 'recall (148 rows)'],
    ['motor_perf', 'recall', 162, 'data/README.md:36', '162 derived from the published curve or withheld, all `recall`'],
    ['avionics', 'recall', 19, 'PROVENANCE.md:159', 'recall at row level (19 rows)'],
    ['motors', 'recall', 29, 'PROVENANCE.md:177', 'recall (29 rows)'],
    ['orings_as568', 'likely', 289, 'data/README.md:37', '289 `likely`'],
  ];
  const both = policyText('readme') + '\n' + policyText('provenance');
  for (const [t, L, n, where, text] of pins) {
    assert.ok(both.includes(text), `${where} says "${text}"`);
    assert.equal(census(t)[L], n, `${t} ${L} = ${n} (${where})`);
  }
  assert.equal(RES.census.reduce((a, c) => a + c.rows, 0), 2346);
});

test('reconciliation: exactly two statements are contradicted, both in the data/README.md policy column; every PROVENANCE.md count holds', () => {
  const bad = RES.reconciliation.filter((r) => r.status === 'mismatch');
  assert.deepEqual(bad.map((r) => [r.cite, r.table]), [['data/README.md:32', 'airframes'], ['data/README.md:39', 'fasteners_un']]);
  assert.match(bad[0].counted, /^130 `likely`, 45 not \(45 recall; 40 of them disputed\)$/);
  assert.match(bad[1].counted, /#2-56 recall, #12-24 recall, 1\/2-13 recall, 1\/2-20 recall/);
  const prov = RES.reconciliation.filter((r) => r.cite.startsWith('docs/data/PROVENANCE.md'));
  assert.ok(prov.length >= 25);
  assert.deepEqual(prov.filter((r) => r.status === 'mismatch'), []);
  const cnt = { match: 0, mismatch: 0, 'not-reconciled': 0 };
  RES.reconciliation.forEach((r) => cnt[r.status]++);
  assert.deepEqual(cnt, { match: 56, mismatch: 2, 'not-reconciled': 11 });
});

test('the proposal\'s findings, re-counted: undocumented fields, dateless tables, label-vs-text, disputed, supplements, outliers', () => {
  const und = (t) => findings((f) => f.rule === 'undocumented-field' && f.table === t).map((f) => f.field);
  assert.deepEqual(und('airframes'), ['lengths_all_mm', 'pns_all']);
  assert.deepEqual(und('motor_perf'), ['disputed']);
  assert.equal(und('design_factors_nasa').length, 10);
  assert.ok(und('design_factors_nasa').includes('ultimate_design_factor'));
  assert.deepEqual(findings((f) => f.rule === 'dateless').map((f) => f.table),
    ['airframes', 'avionics', 'drills', 'fasteners_metric', 'fits', 'materials_thermal', 'motor_perf', 'npt', 'stock']);
  const lvt = {};
  findings((f) => f.rule === 'label-vs-text').forEach((f) => { lvt[f.table] = (lvt[f.table] || 0) + 1; });
  assert.deepEqual(lvt, { avionics: 3, drills: 16, fasteners_un: 12, materials_thermal: 7, npt: 7, rails: 5, stock: 44 });
  const disp = Object.fromEntries(RES.census.filter((c) => c.disputed_rows).map((c) => [c.table, c.disputed_rows]));
  assert.deepEqual(disp, { airframes: 169, avionics: 8, drills: 10, fasteners_metric: 2, fasteners_un: 3, motor_perf: 7, motors: 53, npt: 2, orings_as568: 9, rails: 10, stock: 48 });
  assert.deepEqual([census('motors').supplement.recall, census('motors').supplement.rows], [30, 119]);
  assert.deepEqual([census('airframes').supplement.recall, census('airframes').supplement.rows], [25, 48]);
  const out = findings((f) => f.rule === 'length-vs-records');
  assert.deepEqual(out.map((f) => [f.key, f.severity]), [['AMW|AMW 75-3500', 'info'], ['Loki|38/240', 'info']]);
  assert.match(out[1].detail, /^len_mm 117 vs records \[117, 177, 177\.8, 190\]/);
  assert.match(out[0].detail, /870 \(SK-75-3500\) is the AMW 98-11000 length copied by mistake/);
});

test('summary: 15 defects, so the CLI exits 1', () => {
  assert.deepEqual(RES.summary.by_severity, { defect: 15, review: 134, info: 33 });
  assert.equal(RES.summary.exit, 1);
  assert.deepEqual(RES.meta.commits, ['0974a62b309b8cf7acd33771b49e9357d4d191f4']);
});

// ------------------------------------------------------------------ 3. reproducibility
test('findings.json equals a fresh run on the committed snapshots, byte for byte', () => {
  assert.equal(C.serialize(C.run(SNAP.views, SNAP.policy)), fs.readFileSync(path.join(here, 'findings.json'), 'utf8'));
});

test('the snapshots equal a fresh build from a PartForge checkout with the same bytes', (t) => {
  const repo = process.env.PARTFORGE_DIR || '/home/user/Partforge';
  const dir = path.join(repo, TABLES_DIR);
  if (!fs.existsSync(dir)) return t.skip(`no PartForge checkout at ${repo}`);
  const same = SNAP.views.every((v) => { const p = path.join(repo, v.source.path); return fs.existsSync(p) && sha256(fs.readFileSync(p)) === v.source.sha256; });
  if (!same) return t.skip(`${repo} is not at the snapshot's bytes (its tables changed since 0974a62)`);
  const fresh = loadCheckout(repo);
  for (const v of fresh.views) assert.equal(viewModule(v), fs.readFileSync(path.join(here, 'snapshots', 'views', `${v.table}.js`), 'utf8'), v.table);
  assert.deepEqual(fresh.policy, SNAP.policy);
  assert.equal(C.serialize(C.run(fresh.views, fresh.policy)), fs.readFileSync(path.join(here, 'findings.json'), 'utf8'));
});

test('CLI: --snapshot reproduces findings.json and exits 1; a clean checkout exits 0; usage errors exit 2', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'census-'));
  try {
    const cli = path.join(here, 'census.mjs');
    const out = path.join(tmp, 'f.json');
    let r = spawnSync(process.execPath, [cli, '--snapshot', '--quiet', '--json', out], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(fs.readFileSync(out, 'utf8'), fs.readFileSync(path.join(here, 'findings.json'), 'utf8'));
    fs.mkdirSync(path.join(tmp, 'pf', 'data', 'tables'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'pf', 'data', 'tables', 'demo.json'), JSON.stringify(clean()));
    r = spawnSync(process.execPath, [cli, path.join(tmp, 'pf')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /1 tables; 1 findings: 0 defect, 0 review, 1 info\. Exit 0\./);   // the "could not reconcile" note: no data/README.md
    fs.writeFileSync(path.join(tmp, 'pf', 'data', 'tables', 'demo.json'), JSON.stringify(Object.assign(clean(), { rows: [{ key: 'a', confidence: 'sure' }] })));
    r = spawnSync(process.execPath, [cli, path.join(tmp, 'pf'), '--quiet'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(spawnSync(process.execPath, [cli], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [cli, path.join(tmp, 'nowhere')], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }).status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
