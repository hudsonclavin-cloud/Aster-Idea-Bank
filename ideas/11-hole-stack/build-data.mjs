#!/usr/bin/env node
// Derives everything Hole Stack reads from a PartForge checkout and records provenance for each
// derived file with the bank's tools/snapshot.mjs (--sidecar-only). Run from anywhere:
//
//   node ideas/11-hole-stack/build-data.mjs [/path/to/Partforge]          write the snapshots
//   node ideas/11-hole-stack/build-data.mjs [/path/to/Partforge] --check  say whether they are current (exit 1 if stale)
//
// Writes, under snapshots/:
//   fasteners_metric.js     data/tables/fasteners_metric.json as its EXACT text inside a classic-script
//                           wrapper (so the page works from file://); a test re-hashes the text and
//                           compares it with the sidecar's sourceSha256.
//   fits.js                 data/tables/fits.json, the same way.
//   partforge-code.js       code cut VERBATIM out of index.html between anchors found by regex (never by
//                           hard-coded line number): the thread tables + parseThreadSize + tensile area +
//                           ENGAGEMENT_RULE + threadCheck, the 6061-T6 entry of FLIGHT_MATERIALS, the
//                           FLIGHT_PROCESSES capability table, the whole DECL block (parseFlight, flightLint,
//                           ...), the DB helpers dbF/dbConf/dbTag/dbRows/dbRowsBuild and dbFit, the
//                           one-line matClass, and two doctrine passages of the system prompt as strings.
//   provenance-doctrine.js  docs/data/PROVENANCE.md section 1 (fasteners_metric), exact lines, as strings.
//
// The two dry-run files (snapshots/dryrun-*.scad) are plain copies; this script makes them with
// snapshot.mjs in copy mode so their sidecars say "copy".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const repo = path.resolve(args.find((a) => !a.startsWith('--')) || '/home/user/Partforge');
const snapshotTool = path.resolve(here, '..', '..', 'tools', 'snapshot.mjs');
const snaps = path.join(here, 'snapshots');

if (!fs.existsSync(path.join(repo, 'index.html'))) {
  console.error(`no PartForge checkout at ${repo}`);
  process.exit(2);
}
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const commit = (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
})();

const outputs = new Map(); // file name -> { text, source, note }

// 1, 2. The two tables, exact text.
function tableWrapper(globalKey, rel) {
  const text = read(rel);
  JSON.parse(text); // must parse
  const sha = crypto.createHash('sha256').update(text).digest('hex');
  const body = `/* derived by build-data.mjs: the exact text of PartForge ${rel} at ${commit.slice(0, 7)} (sha256 ${sha}),\n   wrapped so a classic script can load it from file://. See the .provenance.json sidecar beside this file. */\n` +
    `(function (root, factory) {\n  var d = factory();\n  if (typeof module === 'object' && module.exports) module.exports = d;\n  else { root.HoleStackData = root.HoleStackData || {}; root.HoleStackData[${JSON.stringify(globalKey)}] = d; }\n})(typeof self !== 'undefined' ? self : this, function () {\n  var text = ${JSON.stringify(text)};\n  return { path: ${JSON.stringify(rel)}, commit: ${JSON.stringify(commit)}, sha256: ${JSON.stringify(sha)}, text: text, json: JSON.parse(text) };\n});\n`;
  return { text: body, source: rel, note: `derived by build-data.mjs: the exact text of ${rel} (sha256 ${sha}) inside a classic-script wrapper; nothing else changed` };
}
outputs.set('fasteners_metric.js', tableWrapper('fasteners_metric', 'data/tables/fasteners_metric.json'));
outputs.set('fits.js', tableWrapper('fits', 'data/tables/fits.json'));

// 3. Verbatim code from index.html, located by anchors.
{
  const lines = read('index.html').split('\n');
  const find = (re, from = 0) => {
    const i = lines.findIndex((l, k) => k >= from && re.test(l));
    if (i < 0) throw new Error(`anchor not found in index.html: ${re}`);
    return i;
  };
  const closeAt = (start, re = /^}/) => find(re, start + 1);
  const cuts = [];
  const cut = (what, a, b) => { cuts.push({ what, a: a + 1, b: b + 1 }); return lines.slice(a, b + 1).join('\n'); };

  // thread tables → threadCheck
  const thA = find(/^\/\/ Thread tables and parsing/) - 1;
  const thB = closeAt(find(/^function threadCheck\(/));
  const thread = cut('thread tables, parseThreadSize, tensileStressArea_mm2, ENGAGEMENT_RULE, threadCheck', thA, thB);
  // the 6061-T6 entry of FLIGHT_MATERIALS (three lines: data, note, src)
  const m6061 = find(/^ {2}'6061-T6': \{ name: 'Aluminum 6061-T6'/);
  const m6061End = find(/verify: true \},\s*$/, m6061);
  if (m6061End - m6061 > 4) throw new Error('6061-T6 entry is longer than expected');
  const mat = cut('the 6061-T6 entry of FLIGHT_MATERIALS (inside a wrapper object)', m6061, m6061End);
  // FLIGHT_PROCESSES with its comment header
  const prA = find(/^\/\/ Process capability table/) - 1;
  const prB = find(/^};/, find(/^const FLIGHT_PROCESSES = \{/));
  const procs = cut('FLIGHT_PROCESSES (process capability table)', prA, prB);
  // the DECL block
  const deA = find(/^\/\* DECL-BEGIN \*\//);
  const deB = find(/^\/\* DECL-END \*\//);
  const decl = cut('DECL block: parseFlight, provenanceSummary, partTier, tierEvidence, flightCounts, flightLint, flightContradictions', deA, deB);
  // DB helpers and dbFit
  const memoA = find(/^const DB_MEMO = new Map\(\);/);
  const memo = cut('DB_MEMO, dbMemo', memoA, memoA + 1);
  const dbfA = find(/^const dbF = v =>/);
  const dbFitA = find(/^function dbFit\(/);
  const dbFitB = closeAt(dbFitA);
  const dbcode = cut('dbF, DB_CONF, dbConf, dbTag, dbRows, dbRowsBuild, dbFit', dbfA, dbFitB);
  // matClass (a one-line local in the loads evaluator)
  const mcA = find(/^ {2}const matClass = m => m\.kind === 'metal'/);
  const matClass = cut('matClass (a local of the loads evaluator)', mcA, mcA);
  // doctrine passages (inside the system-prompt template literal; checked for ${ and backslashes)
  const stdA = find(/^- Use standard sizes\. Clearance holes \(ISO 273 medium\)/);
  const std = lines[stdA];
  cuts.push({ what: 'doctrine line "Use standard sizes" (string)', a: stdA + 1, b: stdA + 1 });
  const provA = find(/Carry the label into the NOTE, and let it decide tol_src/);
  const provM = /Carry the label into the NOTE[^]*?never write tol_ref as though a document had been read\./.exec(lines[provA]);
  if (!provM) throw new Error('provenance sentence not found');
  cuts.push({ what: 'doctrine sentences "Carry the label into the NOTE … had been read." (string)', a: provA + 1, b: provA + 1 });
  for (const s of [std, provM[0]]) if (/\$\{|\\/.test(s)) throw new Error('doctrine passage contains a template escape; extraction would not be verbatim');

  const header = `/* derived by build-data.mjs from PartForge index.html at ${commit}.\n` +
    ` * Every block between the "---- index.html" markers is cut VERBATIM (unedited) from the lines named.\n` +
    ` * The only code that is not PartForge's: this comment, the factory wrapper, the braces around the\n` +
    ` * 6061-T6 entry, the FLIGHT_DB_DATA binding (PartForge embeds a 1 MB literal; here the caller binds\n` +
    ` * the fits snapshot), the DOCTRINE strings object and the returned API. Apache-2.0, PartForge's licence.\n` +
    cuts.map((c) => ` *   lines ${c.a}${c.b !== c.a ? '-' + c.b : ''}: ${c.what}`).join('\n') + '\n */\n';
  const mark = (c) => `// ---- index.html ${c.a}${c.b !== c.a ? '-' + c.b : ''}: ${c.what}`;
  const body = [header,
    '(function (root, factory) {',
    '  var api = factory();',
    "  if (typeof module === 'object' && module.exports) module.exports = api;",
    '  else root.PartForgeCode = api;',
    "})(typeof self !== 'undefined' ? self : this, function () {",
    mark(cuts[0]), thread,
    mark(cuts[1]), 'const FLIGHT_MATERIALS = {', mat, '};',
    mark(cuts[2]), procs,
    mark(cuts[3]), decl,
    'var FLIGHT_DB_DATA = {};   // wrapper: bound by bindDb() below',
    mark(cuts[4]), memo,
    mark(cuts[5]), dbcode,
    'function partforgeLoadsLocals() {',
    mark(cuts[6]), matClass,
    '  return matClass;',
    '}',
    '// ---- the two doctrine passages, as strings (line numbers in the header)',
    `const DOCTRINE = { standardSizes: ${JSON.stringify(std)}, standardSizesLine: ${stdA + 1}, provenanceRule: ${JSON.stringify(provM[0])}, provenanceRuleLine: ${provA + 1} };`,
    `const CUTS = ${JSON.stringify(cuts)};`,
    `return { commit: ${JSON.stringify(commit)}, CUTS, DOCTRINE, METRIC_COARSE_PITCH, ENGAGEMENT_RULE, parseThreadSize, tensileStressArea_mm2, threadCheck, FLIGHT_MATERIALS, FLIGHT_PROCESSES,`,
    '  parseFlight, provenanceSummary, partTier, flightCounts, flightLint, TOL_SRC, FLIGHT_CAP, dbF, dbConf, dbTag, dbFit, dbRows,',
    '  matClass: partforgeLoadsLocals(),',
    '  bindDb: function (d) { FLIGHT_DB_DATA = d || {}; DB_MEMO.clear(); } };',
    '});', ''].join('\n');
  outputs.set('partforge-code.js', { text: body, source: 'index.html', note: `derived by build-data.mjs: verbatim cuts of index.html — ${cuts.map((c) => `${c.a}${c.b !== c.a ? '-' + c.b : ''} (${c.what})`).join('; ')} — inside a classic-script wrapper` });
}

// 4. PROVENANCE.md section 1, exact lines.
{
  const rel = 'docs/data/PROVENANCE.md';
  const lines = read(rel).split('\n');
  const a = lines.findIndex((l) => /^## 1\. fasteners_metric/.test(l));
  const b = lines.findIndex((l, k) => k > a && /^## 2\./.test(l));
  if (a < 0 || b < 0) throw new Error('PROVENANCE.md section 1 not found');
  const sec = lines.slice(a, b);
  const doctrineIdx = sec.findIndex((l) => /^\*\*Doctrine\.\*\*/.test(l));
  const body = `/* derived by build-data.mjs: PartForge ${rel} lines ${a + 1}-${b} (section 1, fasteners_metric) at ${commit.slice(0, 7)}, exact text, one string per line */\n` +
    `(function (root, factory) {\n  var d = factory();\n  if (typeof module === 'object' && module.exports) module.exports = d;\n  else { root.HoleStackData = root.HoleStackData || {}; root.HoleStackData.provenanceDoctrine = d; }\n})(typeof self !== 'undefined' ? self : this, function () {\n` +
    `  return { path: ${JSON.stringify(rel)}, firstLine: ${a + 1}, doctrineLine: ${a + 1 + doctrineIdx}, lines: ${JSON.stringify(sec, null, 1)} };\n});\n`;
  outputs.set('provenance-doctrine.js', { text: body, source: rel, note: `derived by build-data.mjs: ${rel} lines ${a + 1}-${b} (section 1) verbatim, one string per line, doctrine paragraph at line ${a + 1 + doctrineIdx}` });
}

const copies = [
  ['tests/dryrun/retainer-fixed.scad', 'dryrun-retainer-fixed.scad', 'the first dry run\'s retainer after its fix: its FLIGHT holes row declares the M6 clearance 6.600 ±0.100 citing ISO 273'],
  ['tests/dryrun/endcap.scad', 'dryrun-endcap.scad', 'the first dry run\'s end cap: its FLIGHT holes row declares the M8 clearance 9.000 ±0.100 citing ISO 273'],
];

let stale = 0;
for (const [name, o] of outputs) {
  const dest = path.join(snaps, name);
  const cur = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
  if (check) {
    if (cur !== o.text) { stale++; console.log(`stale: snapshots/${name}`); } else console.log(`current: snapshots/${name}`);
    continue;
  }
  fs.mkdirSync(snaps, { recursive: true });
  fs.writeFileSync(dest, o.text);
  execFileSync('node', [snapshotTool, repo, o.source, dest, '--sidecar-only', '--note', o.note], { stdio: 'inherit' });
}
for (const [rel, name, note] of copies) {
  const dest = path.join(snaps, name);
  if (check) {
    const same = fs.existsSync(dest) && fs.readFileSync(dest).equals(fs.readFileSync(path.join(repo, rel)));
    if (!same) { stale++; console.log(`stale: snapshots/${name}`); } else console.log(`current: snapshots/${name}`);
    continue;
  }
  execFileSync('node', [snapshotTool, repo, rel, dest, '--note', note], { stdio: 'inherit' });
}
if (check) process.exit(stale ? 1 : 0);
