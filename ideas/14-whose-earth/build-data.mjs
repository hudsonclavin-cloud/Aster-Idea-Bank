#!/usr/bin/env node
// build-data.mjs — writes this folder's snapshots from the two checkouts, and data.js for the page.
//
//   node ideas/14-whose-earth/build-data.mjs [--aster DIR] [--skyhook DIR]   rebuild everything
//   node ideas/14-whose-earth/build-data.mjs --check                        say whether anything is stale (writes nothing)
//
// What it writes, all under ideas/14-whose-earth/:
//   snapshots/rev_a.json, snapshots/delta-v.ts      whole copies (tools/snapshot.mjs)
//   snapshots/excerpts/<repo>/<path>.lines.txt      the files whose numbers the arithmetic or the pins read, with
//                                                   every registry line copied verbatim and every other line left
//                                                   empty, so line numbers hold
//   snapshots/workbook-assumptions.json             rows 2, 3, 6, 7, 15 of the workbook's Assumptions sheet
//   snapshots/decision-grid-excerpt.json            the first point of each (tier, column) series of the grid
//   data.js                                         what the page reads: verified rows, inputs, the scan summary
// Every file under snapshots/ gets a provenance sidecar from the bank's tools/snapshot.mjs (--sidecar-only for
// the derived ones). Reads the checkouts; never writes to them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as C from './collect.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const CHECK = args.includes('--check');
const dirs = { aster: opt('--aster') || C.Reg.REPOS.aster.dir, skyhook: opt('--skyhook') || C.Reg.REPOS.skyhook.dir };
const SNAPSHOT_TOOL = path.resolve(C.HERE, '..', '..', 'tools', 'snapshot.mjs');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

for (const [k, d] of Object.entries(dirs)) {
  if (!C.isCheckout(d)) {
    console.error(`${k}: no git checkout at ${d} (pass --${k} DIR)`);
    process.exit(2);
  }
}

// ---- what each file should contain
function excerptText(source, lines) {
  const src = source.split('\n');
  const keep = new Set(lines);
  return src.map((l, i) => (keep.has(i + 1) ? l : '')).join('\n');
}

const planned = []; // { dest, bytes, repo, rel, mode, note }
const linesByFile = new Map();
for (const r of C.Reg.rows) {
  const k = `${r.repo}:${r.path}`;
  if (!linesByFile.has(k)) linesByFile.set(k, new Set());
  linesByFile.get(k).add(r.line);
}
for (const f of C.snapshotFiles()) {
  if (f.whole) {
    planned.push({ dest: C.snapshotPathFor(f.repo, f.rel), bytes: fs.readFileSync(path.join(dirs[f.repo], f.rel)), repo: f.repo, rel: f.rel, mode: 'copy',
      note: 'whole file: its numbers feed the arithmetic, and its concordance rows are verified here offline' });
    continue;
  }
  const lines = [...linesByFile.get(`${f.repo}:${f.rel}`)].sort((a, b) => a - b);
  const text = excerptText(fs.readFileSync(path.join(dirs[f.repo], f.rel), 'utf8'), lines);
  planned.push({ dest: C.snapshotPathFor(f.repo, f.rel), bytes: Buffer.from(text), repo: f.repo, rel: f.rel, mode: 'derived',
    note: `derived by build-data.mjs: lines ${lines.join(', ')} copied verbatim, every other line left empty so line numbers hold` });
}
const wb = C.readWorkbook(fs.readFileSync(path.join(dirs.skyhook, C.WORKBOOK_PATH)));
const wbOut = Object.assign({}, wb, { rows: Object.assign({}, wb.rows) });
planned.push({ dest: path.join(C.SNAP, 'workbook-assumptions.json'), bytes: Buffer.from(`${JSON.stringify(wbOut, null, 1)}\n`), repo: 'skyhook', rel: C.WORKBOOK_PATH, mode: 'derived',
  note: 'derived by build-data.mjs (zip + XML, Node built-ins): Assumptions sheet, column labels B2:D2 and rows 3 (strength retention), 6 (power chain efficiency), 7 (electricity $/kWh), 15 (design tip speed), columns A-E' });
const gridFull = JSON.parse(fs.readFileSync(path.join(dirs.skyhook, C.GRID_PATH), 'utf8'));
planned.push({ dest: path.join(C.SNAP, 'decision-grid-excerpt.json'), bytes: Buffer.from(`${JSON.stringify(C.gridExcerpt(gridFull), null, 1)}\n`), repo: 'skyhook', rel: C.GRID_PATH, mode: 'derived',
  note: `derived by build-data.mjs: header fields and the first point (construction_launch_per_kg ${gridFull.points[0].construction_launch_per_kg}) of each of the 9 (tier, column) series, fields ${C.GRID_FIELDS.join(', ')}; mass ratio and reboost do not vary along a series` });

// ---- data.js for the page
const result = C.collect({ aster: dirs.aster, skyhook: dirs.skyhook });
if (result.refused) {
  console.error(result.refused.reason);
  process.exit(2);
}
const scanSummary = (s) => ({ filesListed: s.filesListed, filesScanned: s.filesScanned, hits: s.hits.length, unregistered: s.unregistered, excluded: s.excluded, summaries: s.summaries });
const snapInfo = planned.map((p) => ({ file: path.relative(C.HERE, p.dest).split(path.sep).join('/'), repo: p.repo, path: p.rel, mode: p.mode }));
const data = {
  note: 'Generated by build-data.mjs from the checkouts named in sources. Do not edit; rebuild.',
  sources: { aster: { commit: result.sources.aster.commit, commitDate: result.sources.aster.commitDate }, skyhook: { commit: result.sources.skyhook.commit, commitDate: result.sources.skyhook.commitDate } },
  rows: result.rows.map((r) => ({ id: r.id, status: r.status, foundLine: r.foundLine, text: r.text })),
  inputs: result.inputs,
  scans: { aster: scanSummary(result.scans.aster), skyhook: scanSummary(result.scans.skyhook) },
  snapshots: snapInfo,
};
// one row per line, everything else one key per line: small, and still diffable
const body = Object.entries(data).map(([k, v]) => `  ${JSON.stringify(k)}: ${k === 'rows' || k === 'snapshots' ? `[\n${v.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]` : JSON.stringify(v)}`).join(',\n');
const dataJs = Buffer.from(`// Generated by build-data.mjs; do not edit.\n(function (root) {\n  var d = {\n${body}\n  };\n  if (typeof module === 'object' && module.exports) module.exports = d;\n  else root.WHOSE_EARTH_DATA = d;\n})(typeof self !== 'undefined' ? self : this);\n`);

// ---- check or write
if (CHECK) {
  const stale = [];
  for (const p of planned) {
    const cur = fs.existsSync(p.dest) ? fs.readFileSync(p.dest) : null;
    if (!cur || !cur.equals(p.bytes)) stale.push(path.relative(C.HERE, p.dest));
    const sc = C.sidecar(p.dest);
    if (!sc || sc.writtenSha256 !== sha256(p.bytes) || sc.commit !== result.sources[p.repo].commit) stale.push(`${path.relative(C.HERE, p.dest)}.provenance.json`);
  }
  const dataPath = path.join(C.HERE, 'data.js');
  if (!fs.existsSync(dataPath) || !fs.readFileSync(dataPath).equals(dataJs)) stale.push('data.js');
  const extra = [];
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  const want = new Set(planned.flatMap((p) => [p.dest, `${p.dest}.provenance.json`]));
  for (const f of walk(C.SNAP)) if (!want.has(f)) extra.push(path.relative(C.HERE, f));
  if (stale.length || extra.length) {
    for (const s of stale) console.log(`stale: ${s}`);
    for (const s of extra) console.log(`not planned: ${s}`);
    process.exit(1);
  }
  console.log(`current: ${planned.length} snapshots with sidecars and data.js match ${result.sources.aster.commit.slice(0, 7)} / ${result.sources.skyhook.commit.slice(0, 7)}`);
  process.exit(0);
}

fs.rmSync(path.join(C.SNAP, 'excerpts'), { recursive: true, force: true });
for (const p of planned) {
  fs.mkdirSync(path.dirname(p.dest), { recursive: true });
  if (p.mode === 'copy') {
    execFileSync('node', [SNAPSHOT_TOOL, dirs[p.repo], p.rel, p.dest, '--note', p.note], { stdio: 'inherit' });
  } else {
    fs.writeFileSync(p.dest, p.bytes);
    execFileSync('node', [SNAPSHOT_TOOL, dirs[p.repo], p.rel, p.dest, '--sidecar-only', '--note', p.note], { stdio: 'inherit' });
  }
}
fs.writeFileSync(path.join(C.HERE, 'data.js'), dataJs);
console.log(`wrote ${planned.length} snapshots and data.js (${dataJs.length} bytes)`);
