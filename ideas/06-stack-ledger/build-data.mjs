#!/usr/bin/env node
// Derives the two files under snapshots/ that this idea makes itself, from a PartForge checkout:
//
//   snapshots/stock_excerpt.json   ten rows of data/tables/stock.json, verbatim, with the table's own
//                                  license_note, columns and notes (the 383 KB file is too big to copy)
//   snapshots/partforge.js         a classic-script / require() module carrying, VERBATIM, PartForge's
//                                  dbFit(), dbMaterialThermal() and dbFitThermal() from index.html (found by
//                                  text marker, not line number), the folder's copies of fits.json and
//                                  materials_thermal.json, the stock excerpt, the two template fixtures'
//                                  header comments, parameters and FLIGHT blocks, and provenance for all of it
//
//   node ideas/06-stack-ledger/build-data.mjs [repo-dir]          (default /home/user/Partforge)
//   node ideas/06-stack-ledger/build-data.mjs [repo-dir] --check  (exit 1 if either derived file is stale)
//
// Then record provenance with the bank's tool (the stock excerpt points at stock.json; the module points
// at index.html, the source of the code it carries; the four whole-file copies have their own sidecars):
//   node tools/snapshot.mjs <repo> data/tables/stock.json ideas/06-stack-ledger/snapshots/stock_excerpt.json --sidecar-only --note "..."
//   node tools/snapshot.mjs <repo> index.html ideas/06-stack-ledger/snapshots/partforge.js --sidecar-only --note "..."
//
// Everything the module embeds from fits.json, materials_thermal.json and the two .scad files is read from
// THIS folder's copies (checked against their sidecars' sha256), never from the repo, so the module can only
// disagree with the snapshots if someone edits one by hand. Node built-ins only; no timestamps are written,
// so a rebuild from the same checkout is byte-identical and --check can compare.
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
const destExcerpt = path.join(SNAP, 'stock_excerpt.json');
const destModule = path.join(SNAP, 'partforge.js');

// The stock rows the worked examples and the tests use. The proposal named "bar_6061_i_6.000 and its _ext
// twin": no such twin exists in stock.json at 0974a62 (the 6.000 in bar has one row, form extruded), so the
// list is the row that exists plus the six 6.000 in OD tube rows, the two plates and the 1/4 in bar.
export const STOCK_KEYS = [
  'bar_6061_i_6.000',
  'tube_6061_i_6.000x0.065', 'tube_6061_i_6.000x0.083', 'tube_6061_i_6.000x0.125', 'tube_6061_i_6.000x0.125_ext',
  'tube_6061_i_6.000x0.188', 'tube_6061_i_6.000x0.250',
  'plate_6061_i_0.500', 'plate_6061_m_012',
  'bar_6061_i_0.250',
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function git(a) {
  try {
    return execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* The three DB functions, verbatim, from the comment that introduces dbFit() to the line before the
   "Selectors" banner that follows dbFitThermal(). */
export function extractFitBlock(html) {
  const startMarker = '/* ISO 286 limits for a size and a fit.';
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error('dbFit() header comment not found in index.html');
  const endMarker = '\n/* ─── Selectors';
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error('Selectors banner after dbFitThermal() not found');
  const text = html.slice(start, end + 1); // up to and including the newline that ends dbFitThermal's block
  for (const fn of ['function dbFit(', 'function dbMaterialThermal(', 'function dbFitThermal(']) {
    if (!text.includes(fn)) throw new Error(`verbatim block is missing ${fn}`);
  }
  if (!/\n}\n$/.test(text)) throw new Error('verbatim block does not end at a closing brace');
  return { text, firstLine: lineOf(html, start), lastLine: lineOf(html, end) };
}

/* Header comments (PART / KIND / MAKE / NOTE lines), parameters and the FLIGHT block of a template. */
export function parseTemplate(scad, file) {
  const lines = scad.split('\n');
  const header = [];
  for (const l of lines) {
    if (!l.startsWith('//')) break;
    const m = /^\/\/\s*(PART|KIND|MAKE|NOTE):\s*(.*)$/.exec(l);
    if (m) header.push({ tag: m[1], text: m[2].trim() });
  }
  const a = lines.findIndex((l) => /^\/\/\s*FLIGHT-BEGIN\s*$/.test(l));
  const b = lines.findIndex((l) => /^\/\/\s*FLIGHT-END\s*$/.test(l));
  if (a < 0 || b < 0 || b <= a) throw new Error(`FLIGHT-BEGIN/END block not found in ${file}`);
  const flight = JSON.parse(lines.slice(a + 1, b).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  const params = [];
  for (let i = b + 1; i < lines.length; i++) {
    if (/^\/\/\s*---\s*end parameters\s*---/.test(lines[i])) break;
    const m = /^([A-Za-z_]\w*)\s*=\s*([^;]+);\s*\/\/\s*(.*)$/.exec(lines[i]);
    if (m) params.push({ name: m[1], value: m[2].trim(), desc: m[3].trim(), line: i + 1 });
  }
  return { file, header, flight, flightLines: [a + 2, b], params };
}

function readSidecar(name) {
  const j = JSON.parse(fs.readFileSync(path.join(SNAP, `${name}.provenance.json`), 'utf8'));
  return { path: j.path, commit: j.commit, sourceSha256: j.sourceSha256, sourceBytes: j.sourceBytes };
}
function readChecked(name) {
  const bytes = fs.readFileSync(path.join(SNAP, name));
  const sc = readSidecar(name);
  if (sha256(bytes) !== sc.sourceSha256) throw new Error(`snapshots/${name} does not match its sidecar sha256`);
  return { bytes, text: bytes.toString('utf8'), sidecar: sc };
}

export function build() {
  const htmlPath = path.join(repo, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const block = extractFitBlock(html);

  const fits = readChecked('fits.json');
  const thermal = readChecked('materials_thermal.json');
  const bulkhead = readChecked('bulkhead.scad');
  const coupler = readChecked('coupler.scad');

  // Stock excerpt: rows by key, verbatim, in STOCK_KEYS order; the table's own prose travels with them.
  const stockPath = path.join(repo, 'data', 'tables', 'stock.json');
  const stockBytes = fs.readFileSync(stockPath);
  const stock = JSON.parse(stockBytes.toString('utf8'));
  const rows = STOCK_KEYS.map((k) => {
    const r = stock.rows.find((x) => x.key === k);
    if (!r) throw new Error(`stock.json has no row ${k}`);
    return r;
  });
  const excerpt = { table: stock.table, license_note: stock.license_note, columns: stock.columns, notes: stock.notes, rows };
  const excerptOut = `${JSON.stringify(excerpt, null, 1)}\n`;

  const fitsJson = JSON.parse(fits.text);
  const thermalJson = JSON.parse(thermal.text);
  const templates = {
    bulkhead: parseTemplate(bulkhead.text, 'tests/templates/bulkhead.scad'),
    coupler: parseTemplate(coupler.text, 'tests/templates/coupler.scad'),
  };

  const provenance = {
    repo: git(['remote', 'get-url', 'origin']) || 'Partforge',
    commit: git(['rev-parse', 'HEAD']),
    commitDate: git(['log', '-1', '--format=%cI']),
    index_html: { path: 'index.html', sha256: sha256(html), bytes: Buffer.byteLength(html), verbatimLines: [block.firstLine, block.lastLine], verbatimSha256: sha256(block.text) },
    fits: fits.sidecar,
    materials_thermal: thermal.sidecar,
    bulkhead_scad: bulkhead.sidecar,
    coupler_scad: coupler.sidecar,
    stock: { path: 'data/tables/stock.json', sha256: sha256(stockBytes), bytes: stockBytes.length, rowsTotal: stock.rows.length, rowsKept: STOCK_KEYS, excerptSha256: sha256(excerptOut), omitted: ['reconciliation', `${stock.rows.length - STOCK_KEYS.length} other rows`] },
    derivedBy: 'ideas/06-stack-ledger/build-data.mjs',
  };

  const moduleOut = `/* GENERATED by ideas/06-stack-ledger/build-data.mjs from the PartForge checkout at
 * ${provenance.commit} (${provenance.commitDate}). Do not edit; rerun the script.
 *
 * Carries: (1) index.html lines ${block.firstLine}-${block.lastLine} VERBATIM: dbFit(), dbMaterialThermal() and
 * dbFitThermal(), the functions the evaluation says a stack-up must call rather than re-derive; they read their
 * tables through a dbRows() shim defined here, which serves the folder's snapshots (or, through useTables(), a
 * live checkout's tables). (2) snapshots/fits.json, whole. (3) snapshots/materials_thermal.json, whole.
 * (4) snapshots/stock_excerpt.json: ${STOCK_KEYS.length} rows of the ${stock.rows.length} in data/tables/stock.json, verbatim.
 * (5) The header comments, parameters and FLIGHT blocks of tests/templates/bulkhead.scad and coupler.scad.
 * (6) Provenance: commit and sha256 of every source. Loads as a classic script (window.PartForgeSnapshot)
 * and with require(). Idea Bank style; no DOM, no network.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartForgeSnapshot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
var fits = ${JSON.stringify(fitsJson, null, 1)};
var materialsThermal = ${JSON.stringify(thermalJson, null, 1)};
var stockExcerpt = ${JSON.stringify(excerpt, null, 1)};
var templates = ${JSON.stringify(templates, null, 1)};
var provenance = ${JSON.stringify(provenance, null, 1)};

/* ---- shim: what the verbatim functions below read their tables through -------------------------
   In index.html, dbRows(k) returns a memoised copy of FLIGHT_DB_DATA[k].rows. Here the tables default
   to this folder's snapshots; useTables() swaps in a live checkout's; withMaterials() lets the thermal
   contributor append a user-supplied row (a laminate's hoop CTE with its source) for one call. */
var TABLES = { fits: fits, materials_thermal: materialsThermal, stock: stockExcerpt };
var extraMaterials = null;
function dbRows(k) {
  var t = TABLES[k];
  if (!t || !Array.isArray(t.rows)) return null;
  var rows = t.rows.slice();
  if (k === 'materials_thermal' && extraMaterials) rows = rows.concat(extraMaterials);
  return rows;
}
function useTables(t) {
  if (t == null) TABLES = { fits: fits, materials_thermal: materialsThermal, stock: stockExcerpt };
  else TABLES = { fits: t.fits || fits, materials_thermal: t.materials_thermal || materialsThermal, stock: t.stock || stockExcerpt };
  return TABLES;
}
function tables() { return TABLES; }
function withMaterials(extraRows, fn) {
  extraMaterials = extraRows && extraRows.length ? extraRows : null;
  try { return fn(); } finally { extraMaterials = null; }
}

// ---- BEGIN verbatim index.html ${block.firstLine}-${block.lastLine} @ ${(provenance.commit || '').slice(0, 7)} ----
${block.text}// ---- END verbatim ----

return { dbFit: dbFit, dbMaterialThermal: dbMaterialThermal, dbFitThermal: dbFitThermal, dbRows: dbRows,
  useTables: useTables, tables: tables, withMaterials: withMaterials,
  fits: fits, materialsThermal: materialsThermal, stockExcerpt: stockExcerpt, templates: templates, provenance: provenance,
  verbatim: { firstLine: ${block.firstLine}, lastLine: ${block.lastLine}, sha256: ${JSON.stringify(sha256(block.text))} } };
});
`;
  return { moduleOut, excerptOut, block, provenance, templates };
}

function main() {
  const { moduleOut, excerptOut, block, provenance } = build();
  const outputs = [[destExcerpt, excerptOut], [destModule, moduleOut]];
  if (check) {
    let stale = 0;
    for (const [dest, out] of outputs) {
      const cur = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
      if (cur !== out) {
        stale++;
        console.error(`stale: ${path.relative(process.cwd(), dest)} differs from a fresh derivation at ${provenance.commit}`);
      } else console.log(`fresh: ${path.relative(process.cwd(), dest)} matches ${provenance.commit}`);
    }
    process.exit(stale ? 1 : 0);
  }
  fs.mkdirSync(SNAP, { recursive: true });
  for (const [dest, out] of outputs) {
    fs.writeFileSync(dest, out);
    console.log(`wrote ${path.relative(process.cwd(), dest)} (${Buffer.byteLength(out)} bytes)`);
  }
  console.log(`verbatim block index.html:${block.firstLine}-${block.lastLine}; ${STOCK_KEYS.length} stock rows; commit ${(provenance.commit || '').slice(0, 7)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
