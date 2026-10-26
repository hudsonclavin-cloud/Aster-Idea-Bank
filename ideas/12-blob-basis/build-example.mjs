#!/usr/bin/env node
// Runs blob-basis against the Aster and Skyhook checkouts and saves the output: example.txt (what
// the terminal shows, the gallery's preview of the tool) and example-data.js (the same runs as
// data, for index.html). Every recorded hash it asks about is read from the snapshots, never typed;
// the paths come from the source files cited beside them. Read-only: git is only queried.
//
//   node ideas/12-blob-basis/build-example.mjs [--aster DIR] [--skyhook DIR] [--check]
//
// --check regenerates in memory and exits 1 if either saved file differs (a stale example).
// The revisions are the snapshot commits, so the output does not drift when a checkout moves on.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, renderText } from './blob-basis.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bankRoot = path.resolve(here, '..', '..');
const rel = (p) => path.relative(bankRoot, p).split(path.sep).join('/');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const ASTER = path.resolve(arg('--aster', '/home/user/asteroid-mining-planner'));
const SKYHOOK = path.resolve(arg('--skyhook', '/home/user/skyhook'));
const CHECK = process.argv.includes('--check');

const snap = (f) => JSON.parse(fs.readFileSync(path.join(here, 'snapshots', f), 'utf8'));
const cache = snap('lambert-screen-cache.metadata.json');
const cacheSide = snap('lambert-screen-cache.metadata.json.provenance.json');
const vz = snap('earth-vz-span-max.fixture.json');
const vzSide = snap('earth-vz-span-max.fixture.json.provenance.json');
const gridSide = snap('decision_grid.keys.json.provenance.json');
const gridParent = snap('decision_grid.parent.json');
if (cacheSide.commit !== vzSide.commit) throw new Error('the two Aster snapshots were taken at different commits');
const ASTER_REV = cacheSide.commit;
const SKYHOOK_REV = gridSide.commit;

// Which file each of the cache's provenance hashes is about: tools/build/precompute-lambert-screen.mjs
// builds HORIZONS_FIXTURE (:159-165), NEA_FIXTURE (:166) and reads its own file (:167), then hashes
// them in that order (:180-182). The cache records only the hashes, not the paths.
const CACHE_MAP = [
  'catalogFixtureSha256=tests/fixtures/v2/nea-catalog-slice9.json',
  'horizonsFixtureSha256=src/v2/data/horizons-inner-solar-system-2026-2040.json',
  'precomputeScriptSha256=tools/build/precompute-lambert-screen.mjs',
];
// Skyhook's finance/export_grid.py:264-266 hashes params/rev_a.json and the workbook with
// provenance_md5 (:97), newline-normalised since 34935cb.
const GRID_MAP = ['rev_a_md5=params/rev_a.json', 'workbook_md5=tools/financial/skyhook_financial_model.xlsx'];

// The files mcp/scripts/bake-provenance.mjs copies from the working tree into the MCP package
// (runtimeAssetPaths, :12-20; copyFileSync at :48), read at the snapshot commit.
function bakedAssets() {
  const r = spawnSync('git', ['show', `${ASTER_REV}:mcp/scripts/bake-provenance.mjs`], { cwd: ASTER, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cannot read bake-provenance.mjs at ${ASTER_REV}: ${r.stderr}`);
  const block = /const runtimeAssetPaths = \[([\s\S]*?)\];/.exec(r.stdout);
  if (!block) throw new Error('runtimeAssetPaths not found in bake-provenance.mjs');
  const lineOf = (needle) => r.stdout.split('\n').findIndex((l) => l.includes(needle)) + 1;
  BAKE_SOURCE.listLine = lineOf('const runtimeAssetPaths = [');
  BAKE_SOURCE.copyLine = lineOf('copyFileSync(source');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
const BAKE_SOURCE = { path: 'mcp/scripts/bake-provenance.mjs', commit: ASTER_REV, listLine: 0, copyLine: 0 };

const snapArg = (f) => rel(path.join(here, 'snapshots', f));
const RUNS = [
  {
    id: 'aster-scan',
    title: 'Every recorded hash in the cache\'s provenance block and in earth-vz-span-max.json, placed on the committed tree; --require blob is the gate a CI job could run',
    argv: [ASTER, '--rev', ASTER_REV, '--scan', snapArg('lambert-screen-cache.metadata.json'), '--scan', snapArg('earth-vz-span-max.fixture.json'),
      ...CACHE_MAP.flatMap((m) => ['--map', m]), '--history', '--require', 'blob'],
  },
  {
    id: 'aster-horizons',
    title: 'The Horizons fixture on all six bases, with both recorded hashes placed',
    argv: [ASTER, 'src/v2/data/horizons-inner-solar-system-2026-2040.json', '--rev', ASTER_REV,
      '--expect', cache.metadata.provenance.horizonsFixtureSha256,
      '--expect', vz.fixture.sha256, '--bytes', String(vz.fixture.bytes)],
  },
  {
    id: 'aster-baked',
    title: 'The seven files mcp/scripts/bake-provenance.mjs copies into the MCP package from the working tree',
    argv: [ASTER, ...bakedAssets(), '--rev', ASTER_REV, '--brief', '--require', 'blob'],
    source: BAKE_SOURCE,
  },
  {
    id: 'skyhook-grid',
    title: 'The same reading on Skyhook: decision_grid.json records md5s, newline-normalised by design since 34935cb',
    argv: [SKYHOOK, '--rev', SKYHOOK_REV, '--scan', snapArg('decision_grid.keys.json'), ...GRID_MAP.flatMap((m) => ['--map', m])],
  },
  {
    id: 'skyhook-grid-parent',
    title: `The md5s 34935cb replaced, from decision_grid.json at its parent ${gridParent.derivedFrom.rev.slice(0, 7)}, placed on that commit's tree`,
    argv: [SKYHOOK, '--rev', gridParent.derivedFrom.rev, '--scan', snapArg('decision_grid.parent.json'), ...GRID_MAP.flatMap((m) => ['--map', m])],
  },
];

function quote(a) {
  return /^[\w./=:@,+-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`;
}

// Strip what the page does not need (and what would bloat the data file).
function slimPath(res) {
  return {
    path: res.path,
    repoPath: res.repoPath,
    attributes: res.attributes || null,
    committedBlobId: res.committedBlobId || null,
    verdict: res.verdict,
    rows: res.bases.rows.map((r) => (r.available
      ? { name: r.name, family: r.family, bytes: r.bytes, sha256: r.sha256, md5: r.md5, blobId: r.blobId, crlf: r.stats.crlf, bareLf: r.stats.bareLf, bareCr: r.stats.bareCr, binary: r.binary }
      : { name: r.name, available: false, why: r.why })),
    expect: (res.expect || []).map(slimMatch),
  };
}
function slimMatch(m) {
  const out = { code: m.code, value: m.value, algo: m.algo, prefix: m.prefix, matches: m.matches, discriminating: m.discriminating, blobAvailable: m.blobAvailable };
  if (m.recordedBytes != null) Object.assign(out, { recordedBytes: m.recordedBytes, bytesAgree: m.bytesAgree, basesWithThoseBytes: m.basesWithThoseBytes || null });
  if (m.history) out.history = m.history;
  return out;
}

// Where a scanned snapshot came from, per its provenance sidecar.
function sourceOf(file) {
  const side = JSON.parse(fs.readFileSync(path.join(bankRoot, `${file}.provenance.json`), 'utf8'));
  const derived = side.mode === 'derived' ? JSON.parse(fs.readFileSync(path.join(bankRoot, file), 'utf8')).derivedFrom : null;
  return { repo: side.repo, path: side.path, commit: derived ? derived.rev : side.commit, mode: side.mode };
}

function build() {
  process.chdir(bankRoot);
  let text = '';
  const data = { generatedBy: 'ideas/12-blob-basis/build-example.mjs', asterRev: ASTER_REV, skyhookRev: SKYHOOK_REV, runs: [] };
  for (const r of RUNS) {
    const out = run(r.argv);
    if (out.text) throw new Error(`run ${r.id} failed before producing a report: ${out.text}`);
    const cmd = ['node', 'ideas/12-blob-basis/blob-basis.mjs', ...r.argv].map(quote).join(' ');
    text += `# ${r.title}\n$ ${cmd}\n${renderText(out)}\n\n`;
    data.runs.push({
      id: r.id,
      title: r.title,
      command: cmd,
      source: r.source || null,
      exit: out.result.exit,
      git: out.result.git,
      paths: out.result.paths.map(slimPath),
      scans: out.result.scans.map((s) => ({
        file: s.file,
        source: sourceOf(s.file),
        entries: s.entries.map((e) => ({ pointer: e.pointer, key: e.key, value: e.value, algo: e.algo, path: e.path, pathFrom: e.pathFrom, recordedBytes: e.recordedBytes, match: e.match ? slimMatch(e.match) : null, verdict: e.pathResult ? e.pathResult.verdict : null, rows: e.pathResult ? slimPath(e.pathResult).rows : null })),
        ids: s.ids,
      })),
    });
  }
  const js = `/* Generated by ideas/12-blob-basis/build-example.mjs from blob-basis runs against Aster ${ASTER_REV.slice(0, 7)} and Skyhook ${SKYHOOK_REV.slice(0, 7)}.\n   The same runs as example.txt, as data for index.html. Do not edit by hand. */\n(function (root) {\n  var data = ${JSON.stringify(data)};\n  if (typeof module === 'object' && module.exports) module.exports = data;\n  else root.BlobBasisExample = data;\n})(typeof self !== 'undefined' ? self : this);\n`;
  return { text: text.trimEnd() + '\n', js };
}

const { text, js } = build();
const files = [
  [path.join(here, 'example.txt'), text],
  [path.join(here, 'example-data.js'), js],
];
if (CHECK) {
  const stale = files.filter(([f, c]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== c).map(([f]) => path.basename(f));
  console.log(stale.length ? `stale: ${stale.join(', ')}` : 'example.txt and example-data.js are current');
  process.exit(stale.length ? 1 : 0);
}
for (const [f, c] of files) fs.writeFileSync(f, c);
console.log(`wrote ${files.map(([f]) => path.basename(f)).join(', ')} (${RUNS.length} runs)`);
