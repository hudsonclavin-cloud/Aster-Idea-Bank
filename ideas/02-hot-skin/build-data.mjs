#!/usr/bin/env node
// Derives snapshots/partforge.js from a PartForge checkout, so the page and the tests run the
// repository's OWN isa() and ISA constants instead of a retyped copy, and read the material
// table and the fin template's declared condition from the snapshots in this folder.
//
//   node ideas/02-hot-skin/build-data.mjs [repo-dir]          (default /home/user/Partforge)
//   node ideas/02-hot-skin/build-data.mjs [repo-dir] --check  (exit 1 if the derived file is stale)
//
// After writing, record its provenance with the bank's tool (the sidecar points at index.html,
// the source of the code it carries; the two data files it embeds have their own sidecars):
//   node tools/snapshot.mjs <repo-dir> index.html ideas/02-hot-skin/snapshots/partforge.js \
//        --sidecar-only --note "derived by build-data.mjs: ..."
//
// What it extracts, and how (Node built-ins only):
//  1. The ISA block of index.html, verbatim: from the comment header "// isa — 1976 U.S. Standard
//     Atmosphere" to the closing brace of function isa(). Found by text markers, not line numbers,
//     and the line numbers it landed on are recorded. The text is pasted into the module between
//     BEGIN/END markers so a test can compare it byte for byte with the checkout.
//  2. FLIGHT_MATERIALS: only {name, kind} per key, evaluated from the object literal in index.html.
//  3. snapshots/materials_thermal.json (whole table) and the FLIGHT block of snapshots/fin.scad
//     (material and loads entries), both read from THIS folder, never from the repo, so the derived
//     file can only ever disagree with the snapshots if someone edits one by hand.
//  4. Provenance: repo HEAD, the sha256 of index.html, and the sidecars' recorded sha256 values.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const repo = path.resolve(args.find((a) => !a.startsWith('--')) || '/home/user/Partforge');
const dest = path.join(here, 'snapshots', 'partforge.js');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function git(a) {
  try {
    return execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

export function extractIsaBlock(html) {
  const header = '// ---------------------------------------------------------------------------\n// isa — 1976 U.S. Standard Atmosphere';
  const start = html.indexOf(header);
  if (start < 0) throw new Error('ISA block header not found in index.html');
  const fn = html.indexOf('\nfunction isa(alt_m, opts) {', start);
  if (fn < 0) throw new Error('function isa(alt_m, opts) not found after the ISA header');
  const end = html.indexOf('\n}\n', fn);
  if (end < 0) throw new Error('closing brace of isa() not found');
  const text = html.slice(start, end + 3); // include the closing "}" and its newline
  for (const name of ['ISA_G0', 'ISA_R', 'ISA_R0', 'ISA_GAMMA', 'ISA_LAYERS', 'ISA_H_MAX', 'ISA_BASE_P']) {
    if (!text.includes(`const ${name} = `)) throw new Error(`ISA block is missing const ${name}`);
  }
  return { text, firstLine: lineOf(html, start), lastLine: lineOf(html, end + 1) };
}

export function extractMaterialsMeta(html) {
  const start = html.indexOf('const FLIGHT_MATERIALS = {');
  if (start < 0) throw new Error('FLIGHT_MATERIALS not found');
  const end = html.indexOf('\n};', start);
  if (end < 0) throw new Error('end of FLIGHT_MATERIALS not found');
  const literal = html.slice(start, end + 3);
  // The literal is plain data (strings, numbers, booleans, null); evaluate it in an empty scope.
  const FM = new Function(`${literal} return FLIGHT_MATERIALS;`)();
  const meta = {};
  for (const [key, v] of Object.entries(FM)) meta[key] = { name: String(v.name), kind: String(v.kind) };
  return { meta, firstLine: lineOf(html, start), lastLine: lineOf(html, end + 1) };
}

export function parseFlightBlock(scad) {
  const lines = scad.split('\n');
  const a = lines.findIndex((l) => /^\/\/ FLIGHT-BEGIN\s*$/.test(l));
  const b = lines.findIndex((l) => /^\/\/ FLIGHT-END\s*$/.test(l));
  if (a < 0 || b < 0 || b <= a) throw new Error('FLIGHT-BEGIN/END block not found in fin.scad');
  const json = lines.slice(a + 1, b).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
  return JSON.parse(json);
}

function readSidecar(name) {
  const p = path.join(here, 'snapshots', `${name}.provenance.json`);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { path: j.path, commit: j.commit, sourceSha256: j.sourceSha256, sourceBytes: j.sourceBytes };
}

export function build() {
  const htmlPath = path.join(repo, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const isa = extractIsaBlock(html);
  const mats = extractMaterialsMeta(html);

  const thermalPath = path.join(here, 'snapshots', 'materials_thermal.json');
  const thermalBytes = fs.readFileSync(thermalPath);
  const thermal = JSON.parse(thermalBytes.toString('utf8'));
  const thermalSidecar = readSidecar('materials_thermal.json');
  if (sha256(thermalBytes) !== thermalSidecar.sourceSha256) throw new Error('snapshots/materials_thermal.json does not match its sidecar sha256');

  const finPath = path.join(here, 'snapshots', 'fin.scad');
  const finBytes = fs.readFileSync(finPath);
  const fin = parseFlightBlock(finBytes.toString('utf8'));
  const finSidecar = readSidecar('fin.scad');
  if (sha256(finBytes) !== finSidecar.sourceSha256) throw new Error('snapshots/fin.scad does not match its sidecar sha256');

  const missing = thermal.rows.map((r) => r.key).filter((k) => !mats.meta[k]);
  const extra = Object.keys(mats.meta).filter((k) => !thermal.rows.some((r) => r.key === k));
  if (missing.length || extra.length) throw new Error(`material keys differ: thermal-only ${missing.join(',')}; FLIGHT_MATERIALS-only ${extra.join(',')}`);

  const provenance = {
    repo: git(['remote', 'get-url', 'origin']) || 'Partforge',
    commit: git(['rev-parse', 'HEAD']),
    commitDate: git(['log', '-1', '--format=%cI']),
    index_html: { path: 'index.html', sha256: sha256(html), bytes: Buffer.byteLength(html), isaLines: [isa.firstLine, isa.lastLine], flightMaterialsLines: [mats.firstLine, mats.lastLine] },
    materials_thermal: thermalSidecar,
    fin_scad: finSidecar,
    derivedBy: 'ideas/02-hot-skin/build-data.mjs',
  };

  const finTemplate = {
    file: 'tests/templates/fin.scad',
    material: fin.material,
    loads: fin.loads,
  };

  const out = `/* GENERATED by ideas/02-hot-skin/build-data.mjs from the PartForge checkout at
 * ${provenance.commit} (${provenance.commitDate}). Do not edit; rerun the script.
 *
 * Carries: (1) index.html lines ${isa.firstLine}-${isa.lastLine} VERBATIM: the 1976 Standard Atmosphere block,
 * ISA_G0 / ISA_R / ISA_R0 / ISA_GAMMA / ISA_LAYERS / ISA_H_MAX / ISA_BASE_P and function isa();
 * (2) {name, kind} of each FLIGHT_MATERIALS entry (index.html lines ${mats.firstLine}-${mats.lastLine});
 * (3) snapshots/materials_thermal.json, whole; (4) the FLIGHT block's material and loads entries of
 * snapshots/fin.scad; (5) provenance (commit, sha256 of each source). Loads as a classic script
 * (window.PartForgeSnapshot) and with require(). Idea Bank style; no DOM, no network.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartForgeSnapshot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
// ---- BEGIN verbatim index.html ${isa.firstLine}-${isa.lastLine} @ ${(provenance.commit || '').slice(0, 7)} ----
${isa.text}// ---- END verbatim ----
var materialsMeta = ${JSON.stringify(mats.meta, null, 1)};
var materialsThermal = ${JSON.stringify(thermal, null, 1)};
var finTemplate = ${JSON.stringify(finTemplate, null, 1)};
var provenance = ${JSON.stringify(provenance, null, 1)};
return { ISA_G0: ISA_G0, ISA_R: ISA_R, ISA_R0: ISA_R0, ISA_GAMMA: ISA_GAMMA, ISA_LAYERS: ISA_LAYERS, ISA_H_MAX: ISA_H_MAX, ISA_BASE_P: ISA_BASE_P, isa: isa,
  materialsMeta: materialsMeta, materialsThermal: materialsThermal, finTemplate: finTemplate, provenance: provenance };
});
`;
  return { out, isa, mats, provenance };
}

function main() {
  const { out, isa, mats, provenance } = build();
  if (check) {
    const cur = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
    // Provenance carries no timestamps, so a rebuild from the same checkout is byte-identical.
    if (cur !== out) {
      console.error(`stale: ${path.relative(process.cwd(), dest)} differs from a fresh derivation at ${provenance.commit}`);
      process.exit(1);
    }
    console.log(`fresh: ${path.relative(process.cwd(), dest)} matches ${provenance.commit}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  console.log(`wrote ${path.relative(process.cwd(), dest)} (${Buffer.byteLength(out)} bytes): isa block index.html:${isa.firstLine}-${isa.lastLine}, ${Object.keys(mats.meta).length} materials, commit ${(provenance.commit || '').slice(0, 7)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
