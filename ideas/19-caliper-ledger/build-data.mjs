#!/usr/bin/env node
// Derives snapshots/partforge.js, the one file under snapshots/ that this idea makes itself, from a
// PartForge checkout. It carries, so the page runs from file:// with no fetch and no build step:
//
//   1. index.html's DECL block VERBATIM (the text from "/* DECL-BEGIN */" to "/* DECL-END */", found by
//      marker, never by line number): parseFlight(), mdSafe(), provenanceSummary(), partTier(),
//      tierEvidence(), flightCounts(), flightLint(), flightContradictions() and their constants. This is
//      the block tests/run.mjs extracts for tests/flight-decl.test.mjs, so the ledger reads a FLIGHT
//      declaration with the app's own parser, not a mirror of it.
//   2. headless/partforge.mjs's measurementRows() VERBATIM, with the round4() and FEATURES it uses (from
//      the "// Trim float noise" comment to the line before "const geometry"). It turns the app's
//      lastGate.flightRows into the rows `cli.mjs check` prints, so a browser measurement report and a
//      headless one are imported through the same PartForge code.
//   3. The seven template files, as strings, read from THIS folder's snapshots/*.scad (each checked
//      against the sha256 in its own sidecar, so the module cannot silently disagree with them).
//   4. Provenance: commit, the line ranges and sha256 of both verbatim blocks, each template's sha256.
//
//   node ideas/19-caliper-ledger/build-data.mjs [repo-dir]          (default /home/user/Partforge)
//   node ideas/19-caliper-ledger/build-data.mjs [repo-dir] --check  (exit 1 if snapshots/partforge.js is stale)
//
// Then record provenance with the bank's tool (the module points at index.html, the source of the parser):
//   node tools/snapshot.mjs /home/user/Partforge index.html ideas/19-caliper-ledger/snapshots/partforge.js --sidecar-only --note "..."
//
// Node built-ins only. No timestamps are written, so a rebuild from the same checkout is byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const repo = path.resolve(args.find((a) => !a.startsWith('--')) || '/home/user/Partforge');
const SNAP = path.join(here, 'snapshots');
const dest = path.join(SNAP, 'partforge.js');

export const TEMPLATE_FILES = ['bulkhead', 'coupler', 'centering-ring', 'motor-retainer', 'nosecone', 'fin', 'av-sled'];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function git(a) {
  try {
    return execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* index.html's DECL block, markers included. */
export function extractDecl(html) {
  const a = html.indexOf('/* DECL-BEGIN */');
  const endMarker = '/* DECL-END */';
  const b = html.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error('DECL-BEGIN/DECL-END markers not found in index.html');
  const text = html.slice(a, b + endMarker.length) + '\n';
  for (const fn of ['function parseFlight(', 'function mdSafe(', 'function provenanceSummary(', 'function flightCounts(']) {
    if (!text.includes(fn)) throw new Error(`DECL block is missing ${fn}`);
  }
  return { text, firstLine: lineOf(html, a), lastLine: lineOf(html, b) };
}

/* headless/partforge.mjs: round4, FEATURES and measurementRows, from the comment above round4 to the
   line before `const geometry`. */
export function extractMeasurementRows(src) {
  const a = src.indexOf('// Trim float noise');
  const b = src.indexOf('\nconst geometry = ', a);
  if (a < 0 || b < 0) throw new Error('measurementRows() block not found in headless/partforge.mjs');
  const text = src.slice(a, b + 1);
  for (const s of ['const round4 =', 'const FEATURES =', 'function measurementRows(']) {
    if (!text.includes(s)) throw new Error(`measurementRows block is missing ${s}`);
  }
  if (/\b(import|export)\b/.test(text)) throw new Error('measurementRows block is not plain script any more');
  return { text, firstLine: lineOf(src, a), lastLine: lineOf(src, b) };
}

function readChecked(file) {
  const bytes = fs.readFileSync(path.join(SNAP, file));
  const sc = JSON.parse(fs.readFileSync(path.join(SNAP, `${file}.provenance.json`), 'utf8'));
  if (sha256(bytes) !== sc.sourceSha256) throw new Error(`snapshots/${file} does not match its sidecar sha256`);
  return { text: bytes.toString('utf8'), sha256: sc.sourceSha256, path: sc.path, commit: sc.commit };
}

export function build() {
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const hl = fs.readFileSync(path.join(repo, 'headless', 'partforge.mjs'), 'utf8');
  const decl = extractDecl(html);
  const rows = extractMeasurementRows(hl);
  const templates = {};
  for (const t of TEMPLATE_FILES) templates[t] = readChecked(`${t}.scad`);
  const commit = git(['rev-parse', 'HEAD']);
  const provenance = {
    repo: git(['remote', 'get-url', 'origin']) || 'Partforge',
    commit,
    commitDate: git(['log', '-1', '--format=%cI']),
    decl: { path: 'index.html', fileSha256: sha256(html), lines: [decl.firstLine, decl.lastLine], sha256: sha256(decl.text) },
    measurementRows: { path: 'headless/partforge.mjs', fileSha256: sha256(hl), lines: [rows.firstLine, rows.lastLine], sha256: sha256(rows.text) },
    templates: Object.fromEntries(TEMPLATE_FILES.map((t) => [t, { path: templates[t].path, sha256: templates[t].sha256, commit: templates[t].commit }])),
    derivedBy: 'ideas/19-caliper-ledger/build-data.mjs',
  };
  const short = (commit || '').slice(0, 7);
  const out = `/* GENERATED by ideas/19-caliper-ledger/build-data.mjs from the PartForge checkout at
 * ${commit} (${provenance.commitDate}). Do not edit; rerun the script.
 *
 * Carries: (1) index.html lines ${decl.firstLine}-${decl.lastLine} VERBATIM, the DECL block: PartForge's own FLIGHT
 * parser (parseFlight, mdSafe, provenanceSummary, flightCounts, ...), the code tests/flight-decl.test.mjs runs.
 * (2) headless/partforge.mjs lines ${rows.firstLine}-${rows.lastLine} VERBATIM: round4(), FEATURES and measurementRows(), which
 * turn lastGate.flightRows into the rows \`cli.mjs check\` prints. (3) The seven tests/templates/*.scad files as
 * strings, from this folder's snapshots (sha256-checked against their sidecars). (4) Provenance for all of it.
 * Loads as a classic script (window.PartForgeDecl) and with require(). No DOM, no network.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartForgeDecl = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
var templates = ${JSON.stringify(Object.fromEntries(TEMPLATE_FILES.map((t) => [t, { file: templates[t].path, text: templates[t].text }])), null, 1)};
var provenance = ${JSON.stringify(provenance, null, 1)};

// ---- BEGIN verbatim index.html ${decl.firstLine}-${decl.lastLine} @ ${short} ----
${decl.text}// ---- END verbatim index.html ----

// ---- BEGIN verbatim headless/partforge.mjs ${rows.firstLine}-${rows.lastLine} @ ${short} ----
${rows.text}// ---- END verbatim headless/partforge.mjs ----

return { parseFlight: parseFlight, mdSafe: mdSafe, provenanceSummary: provenanceSummary, flightCounts: flightCounts,
  measurementRows: measurementRows, FLIGHT_CAP: FLIGHT_CAP, TOL_SRC: TOL_SRC, FEATURES: FEATURES,
  templates: templates, provenance: provenance };
});
`;
  return { out, provenance, decl, rows };
}

function main() {
  const { out, provenance, decl, rows } = build();
  if (check) {
    const cur = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
    if (cur !== out) {
      console.error(`stale: snapshots/partforge.js differs from a fresh derivation at ${provenance.commit}`);
      process.exit(1);
    }
    console.log(`fresh: snapshots/partforge.js matches ${provenance.commit}`);
    return;
  }
  fs.writeFileSync(dest, out);
  console.log(`wrote snapshots/partforge.js (${Buffer.byteLength(out)} bytes): DECL index.html:${decl.firstLine}-${decl.lastLine}, measurementRows headless/partforge.mjs:${rows.firstLine}-${rows.lastLine}, ${TEMPLATE_FILES.length} templates, commit ${(provenance.commit || '').slice(0, 7)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
