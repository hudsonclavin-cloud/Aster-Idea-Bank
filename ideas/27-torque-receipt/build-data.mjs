#!/usr/bin/env node
// Derives everything Torque Receipt reads from a PartForge checkout, then records provenance for
// each derived file with the bank's tools/snapshot.mjs (--sidecar-only). Run from anywhere:
//
//   node ideas/27-torque-receipt/build-data.mjs [/path/to/Partforge]          write the snapshots
//   node ideas/27-torque-receipt/build-data.mjs [/path/to/Partforge] --check  exit 1 if any is stale
//
// Writes, under snapshots/ (every file is a classic script, so the page works from file://, and
// a CommonJS module, so the Node tests require() the same bytes):
//   fasteners_metric.js     data/tables/fasteners_metric.json, its EXACT text in a wrapper. A test
//                           re-hashes the text and compares it with the sidecar's sourceSha256.
//   design_factors_nasa.js  data/tables/design_factors_nasa.json, the same way.
//   endcap.js               tests/dryrun/endcap.scad, the same way (the worked fixture).
//   fasteners_un_excerpt.js the 16 rows of data/tables/fasteners_un.json cut to the fields this tool
//                           reads (size, pitch, stress area, their field_confidence, and the
//                           related_hardware nut and washer entries with their own labels), plus
//                           the table's usage notes (4), (6) and (7) as exact substrings.
//   partforge-code.js       code cut VERBATIM out of index.html between anchors found by regex
//                           (never by hard-coded line number): the thread tables, parseThreadSize,
//                           tensileStressArea_mm2, ENGAGEMENT_RULE, threadCheck and boltShear; the
//                           whole FLIGHT_MATERIALS table; the evaluator's one-line matClass and its
//                           GRADE_SY line. Each cut's 1-based line range is recorded.
//   evaluation-excerpt.js   docs/roadmap-evaluation.md: the ranking row for idea 4 and the appendix
//                           entry "#4 Bolt preload & flange separation", exact lines with numbers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node build-data.mjs [/path/to/Partforge] [--check]\nRe-derives snapshots/*.js from a PartForge checkout and writes their provenance sidecars; --check only reports staleness (exit 1 if stale).');
  process.exit(0);
}
const check = args.includes('--check');
const repo = path.resolve(args.find((a) => !a.startsWith('--')) || '/home/user/Partforge');
const snapshotTool = path.resolve(here, '..', '..', 'tools', 'snapshot.mjs');
const snaps = path.join(here, 'snapshots');
if (!fs.existsSync(path.join(repo, 'index.html'))) {
  console.error(`no PartForge checkout at ${repo}`);
  process.exit(2);
}
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const commit = (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
})();

// One wrapper for every snapshot: exposes TorqueData[key] in a page, module.exports in Node.
function wrap(key, header, payloadJs) {
  return `/* ${header}\n   See the .provenance.json sidecar beside this file. Do not edit: re-run build-data.mjs. */\n` +
    `(function (root, factory) {\n  var d = factory();\n  if (typeof module === 'object' && module.exports) module.exports = d;\n` +
    `  else { root.TorqueData = root.TorqueData || {}; root.TorqueData[${JSON.stringify(key)}] = d; }\n` +
    `})(typeof self !== 'undefined' ? self : this, function () {\n${payloadJs}\n});\n`;
}

const outputs = new Map(); // file -> { text, source, note }

// 1-3. Exact text of two tables and the fixture.
function exactText(key, rel, isJson) {
  const text = read(rel);
  if (isJson) JSON.parse(text);
  const sha = sha256(text);
  const payload = `  var text = ${JSON.stringify(text)};\n  return { path: ${JSON.stringify(rel)}, commit: ${JSON.stringify(commit)}, sha256: ${JSON.stringify(sha)}, text: text${isJson ? ', json: JSON.parse(text)' : ''} };`;
  return {
    text: wrap(key, `derived by build-data.mjs: the exact text of PartForge ${rel} at ${commit.slice(0, 7)} (sha256 ${sha}).`, payload),
    source: rel,
    note: `derived by build-data.mjs: the exact text of ${rel} (sha256 ${sha}) inside a classic-script wrapper; nothing else changed`,
  };
}
outputs.set('fasteners_metric.js', exactText('fasteners_metric', 'data/tables/fasteners_metric.json', true));
outputs.set('design_factors_nasa.js', exactText('design_factors_nasa', 'data/tables/design_factors_nasa.json', true));
outputs.set('endcap.js', exactText('endcap', 'tests/dryrun/endcap.scad', false));

// 4. fasteners_un excerpt.
{
  const rel = 'data/tables/fasteners_un.json';
  const src = JSON.parse(read(rel));
  const FIELDS = ['key', 'series', 'major_in', 'major_mm', 'tpi', 'pitch_mm', 'tensile_stress_area_in2', 'tensile_stress_area_mm2', 'confidence'];
  const CONF = ['major_in', 'major_mm', 'tpi', 'pitch_mm', 'tensile_stress_area_in2', 'tensile_stress_area_mm2'];
  const rows = src.rows.map((r) => {
    const o = {};
    for (const f of FIELDS) o[f] = r[f];
    o.field_confidence = {};
    for (const f of CONF) if (r.field_confidence && r.field_confidence[f]) o.field_confidence[f] = r.field_confidence[f];
    const rh = r.related_hardware || {};
    o.related_hardware = {};
    if (rh.nut) o.related_hardware.nut = { type: rh.nut.type, thickness_in: rh.nut.thickness_in, thickness_mm: rh.nut.thickness_mm, confidence: rh.nut.confidence, source: rh.nut.source };
    if (rh.flat_washer_type_a_narrow) {
      const w = rh.flat_washer_type_a_narrow;
      o.related_hardware.flat_washer_type_a_narrow = { thickness_in: w.thickness_in, thickness_mm: w.thickness_mm, confidence: w.confidence, source: w.source };
    }
    return o;
  });
  // The usage notes are one string with numbered paragraphs "(n) TITLE. ..."; keep (4), (6), (7) exactly.
  const notes = src.notes;
  const para = (n) => {
    const a = notes.indexOf(`(${n}) `);
    const b = notes.indexOf(`(${n + 1}) `, a + 1);
    if (a < 0 || b < 0) throw new Error(`fasteners_un notes paragraph (${n}) not found`);
    return notes.slice(a, b).trim();
  };
  const excerpt = {
    table: src.table,
    excerpt_of: rel,
    columns: Object.fromEntries([...FIELDS.filter((f) => f !== 'confidence'), 'related_hardware', 'field_confidence', 'confidence'].map((f) => [f, src.columns[f]])),
    rows,
    notes_paragraphs: { '4': para(4), '6': para(6), '7': para(7) },
  };
  for (const k of ['4', '6', '7']) if (!notes.includes(excerpt.notes_paragraphs[k])) throw new Error('notes paragraph is not an exact substring');
  const payload = `  return ${JSON.stringify(excerpt, null, 1)};`;
  outputs.set('fasteners_un_excerpt.js', {
    text: wrap('fasteners_un', `derived by build-data.mjs: an excerpt of PartForge ${rel} at ${commit.slice(0, 7)}: all ${rows.length} rows cut to ${FIELDS.join(', ')}, their field_confidence entries, related_hardware.nut and .flat_washer_type_a_narrow (with their own confidence), the matching column descriptions, and usage-notes paragraphs (4), (6) and (7) as exact substrings.`, payload),
    source: rel,
    note: `derived by build-data.mjs: all ${rows.length} rows of ${rel} cut to ${FIELDS.join(', ')} + field_confidence for those fields + related_hardware nut and Type A narrow washer entries (each with its own confidence) + column descriptions + notes paragraphs (4), (6), (7) verbatim`,
  });
}

// 5. Verbatim code from index.html, located by anchors.
{
  const lines = read('index.html').split('\n');
  const find = (re, from = 0) => {
    const i = lines.findIndex((l, k) => k >= from && re.test(l));
    if (i < 0) throw new Error(`anchor not found in index.html: ${re}`);
    return i;
  };
  const cuts = [];
  const cut = (what, a, b) => { cuts.push({ what, from: a + 1, to: b + 1 }); return lines.slice(a, b + 1).join('\n'); };
  const thA = find(/^\/\/ Thread tables and parsing/) - 1;
  const bsStart = find(/^function boltShear\(/);
  const thB = find(/^}/, bsStart + 1);
  const thread = cut('thread tables, parseThreadSize, tensileStressArea_mm2, ENGAGEMENT_RULE, threadCheck, boltShear', thA, thB);
  const mA = find(/^const FLIGHT_MATERIALS = \{/);
  const mB = find(/^};/, mA + 1);
  const mats = cut('FLIGHT_MATERIALS', mA, mB);
  const mc = find(/^\s+const matClass = m => /);
  const matClass = cut('matClass (a local of the loads evaluator)', mc, mc);
  const gs = find(/^\s+const GRADE_SY = \{/);
  const gradeSy = cut('GRADE_SY (a local of the bolt_shear branch)', gs, gs);
  const exportsLine = 'return { parseThreadSize: parseThreadSize, tensileStressArea_mm2: tensileStressArea_mm2, threadCheck: threadCheck, boltShear: boltShear, METRIC_COARSE_PITCH: METRIC_COARSE_PITCH, UN_MAJOR_IN: UN_MAJOR_IN, ENGAGEMENT_RULE: ENGAGEMENT_RULE, FLIGHT_MATERIALS: FLIGHT_MATERIALS, matClass: matClass, GRADE_SY: GRADE_SY, commit: ' + JSON.stringify(commit) + ', cuts: ' + JSON.stringify(cuts) + ' };';
  const payload = `/* ---- index.html ${cuts[0].from}-${cuts[0].to}, verbatim ---- */\n${thread}\n/* ---- index.html ${cuts[1].from}-${cuts[1].to}, verbatim ---- */\n${mats}\n/* ---- index.html ${cuts[2].from}, verbatim ---- */\n${matClass}\n/* ---- index.html ${cuts[3].from}, verbatim ---- */\n${gradeSy}\n${exportsLine}`;
  outputs.set('partforge-code.js', {
    text: wrap('code', `derived by build-data.mjs: code cut verbatim out of PartForge index.html at ${commit.slice(0, 7)} — ${cuts.map((c) => `${c.from}${c.to !== c.from ? '-' + c.to : ''} (${c.what})`).join('; ')}.`, payload),
    source: 'index.html',
    note: `derived by build-data.mjs: verbatim cuts of index.html — ${cuts.map((c) => `${c.from}${c.to !== c.from ? '-' + c.to : ''} (${c.what})`).join('; ')} — inside a classic-script wrapper`,
    cuts,
  });
}

// 6. The roadmap evaluation's two passages about idea 4.
{
  const rel = 'docs/roadmap-evaluation.md';
  const lines = read(rel).split('\n');
  const pick = [];
  const row = lines.findIndex((l) => /^\| 4 \| Bolt preload & flange separation \|/.test(l));
  if (row < 0) throw new Error('ranking row for idea 4 not found');
  pick.push({ line: row + 1, text: lines[row] });
  const a = lines.findIndex((l) => /^\*\*#4 Bolt preload & flange separation\*\*/.test(l));
  if (a < 0) throw new Error('appendix entry #4 not found');
  let b = a + 1;
  while (b < lines.length && !/^\*\*#\d+ /.test(lines[b])) b++;
  for (let i = a; i < b; i++) if (lines[i].trim()) pick.push({ line: i + 1, text: lines[i] });
  const payload = `  return { path: ${JSON.stringify(rel)}, commit: ${JSON.stringify(commit)}, lines: ${JSON.stringify(pick, null, 1)} };`;
  outputs.set('evaluation-excerpt.js', {
    text: wrap('evaluation', `derived by build-data.mjs: lines ${pick.map((p) => p.line).join(', ')} of PartForge ${rel} at ${commit.slice(0, 7)}, exact text.`, payload),
    source: rel,
    note: `derived by build-data.mjs: exact lines ${pick.map((p) => p.line).join(', ')} of ${rel} (the ranking row and the appendix entry for idea 4, "Bolt preload & flange separation")`,
  });
}

let stale = 0;
fs.mkdirSync(snaps, { recursive: true });
for (const [name, o] of outputs) {
  const dest = path.join(snaps, name);
  const cur = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
  if (check) {
    const same = cur === o.text;
    if (!same) stale++;
    console.log(`${same ? 'current' : 'STALE  '}  snapshots/${name}`);
    continue;
  }
  fs.writeFileSync(dest, o.text);
  execFileSync('node', [snapshotTool, repo, o.source, dest, '--sidecar-only', '--note', o.note], { stdio: 'inherit' });
}
if (check) process.exit(stale ? 1 : 0);
