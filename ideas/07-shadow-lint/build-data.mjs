#!/usr/bin/env node
// Derives the data this idea needs from the PartForge checkout and from the .scad snapshots already
// in snapshots/, then records provenance for every derived file with the bank's snapshot.mjs
// (--sidecar-only). Run from anywhere:
//
//   node ideas/07-shadow-lint/build-data.mjs [/path/to/Partforge]
//
// Writes:
//   snapshots/flight-decl.js             PartForge's own parseFlight()/flightCounts() code, cut out of
//                                        index.html between its DECL anchors, for the parser-agreement test
//   snapshots/fasteners_metric.excerpt.js  the rows of data/tables/fasteners_metric.json, a field subset
//   snapshots/fasteners_un.excerpt.js      the rows of data/tables/fasteners_un.json, a field subset
//   snapshots/motor_perf.excerpt.js        only the motor_perf.json rows the fixtures' loads name (`motor`)
//   snapshots/motor-retainer.retry.scad    the motor-retainer template with ONE edit inside the FLIGHT
//                                        block (force_N 20000 → 12000) and byte-identical geometry: the
//                                        synthetic "cheapest fix" retry the differ must catch
//   findings.js                          the classifier run over every fixture and three attempt pairs,
//                                        for the browser page (a test recomputes it and compares)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Shadow = require(path.join(here, 'shadow.js'));
const repo = path.resolve(process.argv[2] || '/home/user/Partforge');
const snapshotTool = path.resolve(here, '..', '..', 'tools', 'snapshot.mjs');
const snaps = path.join(here, 'snapshots');

if (!fs.existsSync(path.join(repo, 'index.html'))) { console.error(`no PartForge checkout at ${repo}`); process.exit(2); }

function sidecar(relPath, dest, note) {
  execFileSync('node', [snapshotTool, repo, relPath, dest, '--sidecar-only', '--note', note], { stdio: 'inherit' });
}
function umd(globalName, obj) {
  return `/* derived by build-data.mjs — see the .provenance.json sidecar beside this file */\n(function (root, factory) {\n  var d = factory();\n  if (typeof module === 'object' && module.exports) module.exports = d;\n  else { root.ShadowData = root.ShadowData || {}; root.ShadowData[${JSON.stringify(globalName)}] = d; }\n})(typeof self !== 'undefined' ? self : this, function () {\n  return ${JSON.stringify(obj, null, 1)};\n});\n`;
}

// 1. PartForge's parser, cut out by anchors so a moved line does not break the extraction.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8').split('\n');
  const start = html.findIndex((l) => /^const FLIGHT_AXIS = /.test(l));
  const ps = html.findIndex((l, i) => i > start && /^function provenanceSummary\(/.test(l));
  const pe = html.findIndex((l, i) => i > ps && /^}/.test(l));
  const fc = html.findIndex((l) => /^function flightCounts\(/.test(l));
  const fe = html.findIndex((l, i) => i > fc && /^}/.test(l));
  if ([start, ps, pe, fc, fe].some((i) => i < 0)) throw new Error('DECL anchors not found in index.html');
  const code = [`// Cut from PartForge index.html lines ${start + 1}–${pe + 1} and ${fc + 1}–${fe + 1} by build-data.mjs; not edited.`,
    ...html.slice(start, pe + 1), ...html.slice(fc, fe + 1),
    'if (typeof module === \'object\' && module.exports) module.exports = { parseFlight, provenanceSummary, flightCounts, TOL_SRC, FLIGHT_HAZARD, FLIGHT_AXIS, FLIGHT_CAP };', ''].join('\n');
  fs.writeFileSync(path.join(snaps, 'flight-decl.js'), code);
  sidecar('index.html', path.join(snaps, 'flight-decl.js'), `derived by build-data.mjs: index.html lines ${start + 1}-${pe + 1} (FLIGHT_AXIS … provenanceSummary) and ${fc + 1}-${fe + 1} (flightCounts), unedited, plus one module.exports line`);
}

// 2. Fastener tables: every row, a field subset; rows keep their confidence and field_confidence.
const KEEP_METRIC = ['key', 'd_mm', 'pitch_mm', 'tap_drill_mm', 'tap_drill_stainless_mm', 'clearance_fine_mm', 'clearance_medium_mm', 'clearance_coarse_mm', 'confidence', 'source'];
const KEEP_UN = ['key', 'series', 'major_mm', 'pitch_mm', 'tap_drill_75_mm', 'tap_drill_50_mm', 'clearance_close_mm', 'clearance_normal_mm', 'clearance_loose_mm', 'confidence', 'source'];
function excerptTable(file, keep) {
  const t = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'tables', file), 'utf8'));
  const pick = (o, ks) => Object.fromEntries(ks.filter((k) => k in o).map((k) => [k, o[k]]));
  let rows = t.rows.map((r) => ({ ...pick(r, keep), field_confidence: pick(r.field_confidence || {}, keep) }));
  // Nearly every row of both tables carries the same long `source` string (all 12 metric rows; 15 of
  // 16 UN rows): keep the common one once as rows_source, and only a row that differs keeps its own.
  const tally = new Map();
  for (const r of rows) tally.set(r.source, (tally.get(r.source) || 0) + 1);
  const rows_source = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  rows = rows.map(({ source, ...rest }) => (source === rows_source ? rest : { ...rest, source }));
  return { table: t.table, license_note: t.license_note, columns: pick(t.columns || {}, keep), rows_source, rows,
    excerpt: `fields ${keep.join(', ')} of every row; the common per-row source string is kept once as rows_source and only a row that differs keeps its own; by build-data.mjs` };
}
{
  const m = excerptTable('fasteners_metric.json', KEEP_METRIC);
  fs.writeFileSync(path.join(snaps, 'fasteners_metric.excerpt.js'), umd('fasteners_metric', m));
  sidecar('data/tables/fasteners_metric.json', path.join(snaps, 'fasteners_metric.excerpt.js'), 'derived by build-data.mjs: all 12 rows, fields ' + KEEP_METRIC.join(',') + ' (+ field_confidence for those), table/license_note/columns kept; wrapped as a UMD module');
  const u = excerptTable('fasteners_un.json', KEEP_UN);
  fs.writeFileSync(path.join(snaps, 'fasteners_un.excerpt.js'), umd('fasteners_un', u));
  sidecar('data/tables/fasteners_un.json', path.join(snaps, 'fasteners_un.excerpt.js'), 'derived by build-data.mjs: all 16 rows, fields ' + KEEP_UN.join(',') + ' (+ field_confidence for those), table/license_note/columns kept; wrapped as a UMD module');
}

// 3. The fixtures (the .scad files already snapshotted beside this script).
const fixtureNames = fs.readdirSync(snaps).filter((f) => /\.scad$/.test(f) && !/\.retry\.scad$/.test(f)).sort();
const fixtures = Object.fromEntries(fixtureNames.map((f) => [f, fs.readFileSync(path.join(snaps, f), 'utf8')]));

// 4. The motor rows the fixtures name, matched as index.html dbMotorPerf() matches (4907–4916).
{
  const t = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'tables', 'motor_perf.json'), 'utf8'));
  const names = new Set();
  for (const text of Object.values(fixtures)) { const f = Shadow.parseFlight(text); if (f && !f.malformed) for (const l of f.loads) if (l.motor) names.add(String(l.motor)); }
  const rows = t.rows.filter((r) => [...names].some((q) => Shadow.motorMatches(r, q)));
  const out = { table: t.table, license_note: t.license_note, columns: t.columns, rows, excerpt: `only the rows matched by the fixtures' loads.motor keys (${[...names].join(', ')}); by build-data.mjs` };
  fs.writeFileSync(path.join(snaps, 'motor_perf.excerpt.js'), umd('motor_perf', out));
  sidecar('data/tables/motor_perf.json', path.join(snaps, 'motor_perf.excerpt.js'), `derived by build-data.mjs: the ${rows.length} row(s) matched by the fixtures' loads.motor keys (${[...names].join(', ')}) out of ${t.rows.length}; every field kept; wrapped as a UMD module`);
}

// 5. The synthetic retry: one number moved inside the FLIGHT block, nothing else.
{
  const src = fixtures['motor-retainer.scad'];
  const m = src.match(/\/\/\s*FLIGHT-BEGIN\s*\n([\s\S]*?)\/\/\s*FLIGHT-END/);
  const hits = (m[1].match(/"force_N":20000/g) || []).length;
  if (hits !== 1) throw new Error(`expected exactly one "force_N":20000 in the FLIGHT block, found ${hits}`);
  const block = m[1].replace('"force_N":20000', '"force_N":12000');
  const retry = src.replace(m[1], block);
  if (Shadow.geometryText(retry) !== Shadow.geometryText(src)) throw new Error('the synthetic retry changed geometry text');
  fs.writeFileSync(path.join(snaps, 'motor-retainer.retry.scad'), retry);
  sidecar('tests/templates/motor-retainer.scad', path.join(snaps, 'motor-retainer.retry.scad'), 'derived by build-data.mjs: the template with exactly one edit inside the FLIGHT block, "force_N":20000 -> "force_N":12000; code outside comments byte-identical (a synthetic retry that edits the number instead of the geometry)');
  fixtures['motor-retainer.retry.scad'] = retry;
}

// 6. Findings for the page: every fixture classified, three attempt pairs diffed.
{
  const data = { metric: require(path.join(snaps, 'fasteners_metric.excerpt.js')), un: require(path.join(snaps, 'fasteners_un.excerpt.js')), motors: require(path.join(snaps, 'motor_perf.excerpt.js')) };
  const strip = (L) => (L.refusal ? L : { label: L.label, result: L.result });
  const perFixture = {};
  for (const name of Object.keys(fixtures).sort()) perFixture[name] = strip(Shadow.lint(fixtures[name], data, name));
  const PAIRS = [['motor-retainer.scad', 'motor-retainer.retry.scad'], ['retainer.scad', 'retainer-fixed.scad'], ['ring1.scad', 'ring6-after-doctrine-fix.scad']];
  // the per-file results of a pair are already under fixtures[]; the page's diff view does not need them twice
  const pairs = PAIRS.map(([a, b]) => { const { A, B, ...d } = Shadow.diffAttempts(fixtures[a], fixtures[b], data, [a, b]); return d; });
  const prov = JSON.parse(fs.readFileSync(path.join(snaps, 'bulkhead.scad.provenance.json'), 'utf8'));
  const findings = { generated: { from: 'build-data.mjs over the snapshots in this folder', repo: prov.repo, commit: prov.commit }, fixtures: perFixture, pairs };
  fs.writeFileSync(path.join(here, 'findings.js'), `/* generated by build-data.mjs from snapshots/*.scad through shadow.js; shadow.test.mjs recomputes it and fails on drift */\n(function (root, factory) {\n  var d = factory();\n  if (typeof module === 'object' && module.exports) module.exports = d;\n  else root.ShadowFindings = d;\n})(typeof self !== 'undefined' ? self : this, function () {\n  return ${JSON.stringify(findings)};\n});\n`);
  console.log(`findings.js: ${Object.keys(perFixture).length} fixtures, ${pairs.length} pairs`);
}
