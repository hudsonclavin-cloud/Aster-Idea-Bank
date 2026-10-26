#!/usr/bin/env node
// Builds the packs this idea's tests and page run on, from the three local checkouts.
// Reads only: git ls-files / ls-tree / show / rev-parse, and file reads. Writes only under
// this folder: snapshots/pack-*.js and census.json. Provenance sidecars are written afterwards
// with tools/snapshot.mjs --sidecar-only (see the commands at the end of this file's output).
//
//   node build-data.mjs [--aster DIR] [--partforge DIR] [--skyhook DIR]
//
// A pack = the tracked file list at one commit + the text of every file the census read there
// (with its git blob id) + the runner commands found in that commit's Markdown + the mention
// lookups the census made. Historical packs (Aster a697963, PartForge 60a90cd) are built from
// git objects, not the working tree, and carry only what their reconciliation tests need.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { liveTree, loadConfig } from './reach-census.mjs';

const require = createRequire(import.meta.url);
const C = require('./census.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(HERE, 'snapshots');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIRS = {
  aster: opt('--aster', '/home/user/asteroid-mining-planner'),
  partforge: opt('--partforge', '/home/user/Partforge'),
  skyhook: opt('--skyhook', '/home/user/skyhook'),
};
// The commits this deposit was built and checked at.
const PINNED = { aster: '62ddb1713feab34ac0730ecd66f18db8a076d718', partforge: '0974a62b309b8cf7acd33771b49e9357d4d191f4', skyhook: '34935cb1f67a8422a9fd49481e080faade2c0d92' };
const HISTORICAL = [
  { key: 'aster-a697963', repo: 'aster', commit: 'a697963506c2638bbfa9d7a3c644b5f0aaf8709b', docs: false,
    why: 'S19.5 FIX2 baseline: tools/audit/sanity-69472a3/s19-5-runs/fix2-LOG.md:14 logs `npm run verify` at 96/96 files from this HEAD' },
  { key: 'partforge-60a90cd', repo: 'partforge', commit: '60a90cd0475df8ae0ae28accb28e1a41448a6c8b', docs: true,
    why: 'first parent of b011ddc, the merge whose tests/run.mjs comment says two node:test files "were never run by this file"' },
];

const git = (dir, a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 256 << 20 });
const blobOf = (text) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(text)}\0`), Buffer.from(text)])).digest('hex');
const cfgAll = loadConfig(path.join(HERE, 'census.config.json'), true);
const cfgFor = (id) => { const k = Object.keys(cfgAll).find((x) => x.toLowerCase() === id.toLowerCase()); return k ? cfgAll[k] : {}; };

function stagedBlobs(dir) {
  const m = new Map();
  for (const line of git(dir, ['ls-files', '-s', '-z']).split('\0')) {
    const mm = /^\d+ ([0-9a-f]{40}) \d\t(.+)$/.exec(line);
    if (mm) m.set(mm[2], mm[1]);
  }
  return m;
}

function recordingTree(tree) {
  const reads = new Set();
  const inner = tree.read;
  tree.read = (p) => { const v = inner(p); if (v != null) reads.add(C.normalize(p)); return v; };
  let mentions = {};
  const im = tree.mentionsFor;
  tree.mentionsFor = (paths) => { const r = im ? im(paths) : {}; mentions = Object.assign({}, mentions, r); return r; };
  return { tree, reads, getMentions: () => mentions };
}

// Files the census read only to decide that they launch no test are stored as blank lines (the
// line count kept), with their blob id: re-reading them gives the same verdict, which the
// live-versus-pack test checks. Runner definitions are kept whole; a Python test file keeps
// only its module-level skip lines.
const KEEP = /(^|\/)package\.json$|(^|\/)tsconfig[^/]*\.json$|\.ya?ml$|(^|\/)(pytest\.ini|\.pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|conftest\.py)$|\.sh$/;
const TEST_PY = /((^|\/)test_[^/]*\.py$)|(_test\.py$)/;
const SKIP_LINE = /^(?:pytest\.importorskip|importorskip)\(|^pytestmark\s*=\s*pytest\.mark\.skipif\(|^pytest\.skip\(.*allow_module_level/;
function reduce(tree, p, text) {
  const blank = () => text.replace(/[^\n]/g, '');
  if (KEEP.test(p)) return { text, kept: 'runner definition' };
  if (/\.py$/.test(p)) {
    if (TEST_PY.test(p)) return { text: text.split('\n').map((l) => (SKIP_LINE.test(l) ? l : '')).join('\n'), kept: 'module-level skip lines only' };
    if (/\b(pytest\.main|unittest\.main|TextTestRunner|TestLoader)\b/.test(text) || (/\bsubprocess\b/.test(text) && /pytest|unittest/.test(text))) return { text, kept: 'may run tests' };
    return { text: blank(), kept: null };
  }
  if (/\.(m|c)?[jt]s$/.test(p)) {
    const an = C.analyzeNodeScript(tree, p, '');
    if (an.kind === 'runner' || an.kind === 'not-understood') return { text, kept: `runner (${an.kind})` };
    if (/--test\b|node:test|\.test\.(m|c)?js|pytest/.test(C.maskJs(text).nc) && /\b(spawn|spawnSync|execFile|execFileSync|fork|import\()/.test(text)) return { text, kept: 'mentions tests and launches processes' };
    return { text: blank(), kept: null };
  }
  return { text, kept: 'other' };
}

function headPack(key) {
  const dir = DIRS[key];
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  if (head !== PINNED[key]) console.warn(`warning: ${dir} is at ${head.slice(0, 7)}, not the pinned ${PINNED[key].slice(0, 7)}; the pack records what is there`);
  const status = git(dir, ['status', '--porcelain']).trim();
  if (status) console.warn(`warning: ${dir} has local changes; packs record committed blob ids and flag mismatches`);
  const id = git(dir, ['remote', 'get-url', 'origin']).trim().replace(/\.git$/, '').split(/[/:]/).pop();
  const cfg = cfgFor(id);
  const t = liveTree(dir, cfg);
  const rec = recordingTree(t);
  C.censusRepo(rec.tree, {});
  const blobs = stagedBlobs(dir);
  const contents = {}, blobIds = {}, blanked = [];
  for (const p of Array.from(rec.reads).sort()) {
    const text = rec.tree.read(p);
    const r = reduce(rec.tree, p, text);
    contents[p] = r.text;
    if (!r.kept) blanked.push(p);
    blobIds[p] = blobs.get(p) || null;
    if (blobs.get(p) && blobOf(fs.readFileSync(path.join(dir, p), 'utf8')) !== blobs.get(p)) console.warn(`warning: ${p} differs from its committed blob`);
  }
  return {
    key, id, label: cfg.label || id, commit: head, built: 'working tree at HEAD',
    files: t.files, contents, blobIds, blanked, docCommands: t.docCommandsList, mentions: rec.getMentions(), config: cfg,
    docs: `runner commands extracted from all ${t.files.filter((f) => /\.md$/i.test(f)).length} tracked Markdown files`,
  };
}

function historicalPack(h) {
  const dir = DIRS[h.repo];
  const id = git(dir, ['remote', 'get-url', 'origin']).trim().replace(/\.git$/, '').split(/[/:]/).pop();
  const files = git(dir, ['ls-tree', '-r', '-z', '--name-only', h.commit]).split('\0').filter(Boolean);
  const blobs = new Map();
  for (const line of git(dir, ['ls-tree', '-r', '-z', h.commit]).split('\0')) {
    const mm = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (mm) blobs.set(mm[2], mm[1]);
  }
  const show = (p) => { try { return git(dir, ['show', `${h.commit}:${p}`]); } catch { return null; } };
  const docCommands = [];
  if (h.docs) for (const f of files.filter((x) => /\.md$/i.test(x))) { const t = show(f); if (t != null) for (const c of C.extractDocCommands(t, f)) docCommands.push(c); }
  // no extra candidates: the historical pins are about test-named files only
  const t = C.makeTree({ id, label: id, commit: h.commit, files, read: show, docCommands, config: {} });
  const rec = recordingTree(t);
  C.censusRepo(rec.tree, {});
  const contents = {}, blobIds = {}, blanked = [];
  for (const p of Array.from(rec.reads).sort()) {
    const r = reduce(rec.tree, p, rec.tree.read(p));
    contents[p] = r.text;
    if (!r.kept) blanked.push(p);
    blobIds[p] = blobs.get(p) || null;
  }
  // the file list as a difference from the head pack of the same repository
  const baseFiles = new Set(heads[h.repo].files);
  const here = new Set(files);
  const added = files.filter((f) => !baseFiles.has(f));
  const removed = heads[h.repo].files.filter((f) => !here.has(f));
  return {
    key: h.key, id, label: id, commit: h.commit, built: 'git objects at this commit', why: h.why,
    base: h.repo, added, removed, fileCount: files.length, contents, blobIds, blanked, docCommands, mentions: {}, config: {},
    docs: h.docs ? `runner commands extracted from all ${files.filter((f) => /\.md$/i.test(f)).length} Markdown files at this commit` : 'Markdown not extracted (the pin is about package scripts and the runner only)',
  };
}

function writePack(pack) {
  const file = path.join(SNAP, `pack-${pack.key}.js`);
  const stored = Object.assign({}, pack);
  if (stored.files) { stored.filesPacked = C.packPaths(stored.files); stored.fileCount = stored.files.length; delete stored.files; }
  stored.docCommands = C.packDocCommands(stored.docCommands || []);
  const body = JSON.stringify(stored);
  const js = `// Derived by build-data.mjs from ${pack.id} @ ${pack.commit} (${pack.built}). Do not edit by hand.\n(function (root) {\n  var pack = ${body};\n  if (typeof module === 'object' && module.exports) module.exports = pack;\n  else { root.REACH_PACKS = root.REACH_PACKS || {}; root.REACH_PACKS[${JSON.stringify(pack.key)}] = pack; }\n})(typeof self !== 'undefined' ? self : this);\n`;
  fs.writeFileSync(file, js);
  return { file, bytes: Buffer.byteLength(js) };
}

fs.mkdirSync(SNAP, { recursive: true });
const written = [];
const heads = {};
for (const key of ['aster', 'partforge', 'skyhook']) { heads[key] = headPack(key); written.push(writePack(heads[key])); }
for (const h of HISTORICAL) written.push(writePack(historicalPack(h)));

// census.json: the census of the three packs, exactly what the page and the tests recompute
const trees = ['aster', 'partforge', 'skyhook'].map((k) => C.treeFromPack(heads[k], heads[k].config));
// the stored form must decode to the same lists
for (const k of ['aster', 'partforge', 'skyhook']) {
  const back = C.unpackPaths(C.packPaths(heads[k].files));
  if (back.join('\n') !== heads[k].files.slice().sort().join('\n')) throw new Error(`front coding does not round-trip for ${k}`);
}
const result = C.census(trees, {});
fs.writeFileSync(path.join(HERE, 'census.json'), JSON.stringify(C.compact(result), null, 1) + '\n');
for (const w of written) console.log(`wrote ${path.relative(HERE, w.file)} (${(w.bytes / 1024).toFixed(1)} KB)`);
console.log(`wrote census.json (exit ${result.exit})`);
console.log('\nsidecars:');
const SIDE = { aster: 'tools/run-tests.mjs', partforge: 'tests/run.mjs', skyhook: '.github/workflows/ci.yml' };
for (const k of ['aster', 'partforge', 'skyhook']) console.log(`  node tools/snapshot.mjs ${DIRS[k]} ${SIDE[k]} ideas/25-reach-census/snapshots/pack-${k}.js --sidecar-only --note "..."`);
