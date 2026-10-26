#!/usr/bin/env node
// Builds this idea's data from the Aster checkout, with provenance for every byte.
//
//   node ideas/05-round-trip-ledger/build-data.mjs [/path/to/asteroid-mining-planner]
//
// 1. Runs tools/snapshot.mjs once per NHATS fixture file (tests/fixtures/v2/nhats-validation-targets/,
//    tests/fixtures/v2/oq7-nhats-coorbital/) into a scratch directory: records are excerpted with
//    --pick des,fullname,computed,signature,min_dv_traj; the API error files ("not found") are copied
//    whole. The tool writes a provenance sidecar per file (repo, commit, blob, sha256).
// 2. Folds each directory's excerpts and their sidecars into ONE bundle, snapshots/nhats/<dir>.json:
//    the constant sidecar fields are hoisted (repo, commit, commitDate, mode, picked, note) and each
//    file keeps its own data verbatim plus its varying fields (committedBlob, readBlob, sourceSha256,
//    sourceBytes, writtenSha256, writtenBytes, pathLastChanged). writtenSha256 still equals
//    sha256(JSON.stringify(data, null, 1) + '\n'), so a test can prove the bundle holds the bytes the
//    tool wrote. The bundle's own sidecar names the directory and its committed git tree id (this
//    script writes it, in snapshot.mjs's schema, because the tool has no multi-file mode; see README).
//    270 separate files would have been honest too, but cost ~1.1 MB of filesystem block overhead.
// 3. Copies src/v2/porkchop/delta-v.ts, src/v2/porkchop/launch-vehicles.ts and
//    src/v2/core/lambert/feasibility.ts (the constants this study reads), each with a tool sidecar.
// 4. Derives snapshots/lambert-screen-cache.excerpt.json (the cache rows for the same bodies, stored
//    as one field list plus one array per row) from the 34 MB tests/fixtures/v2/lambert-screen-cache.json
//    and records a --sidecar-only provenance.
// 5. Derives snapshots/porkchop-grid.excerpt.json: the GRID_PARAMS block of src/v2/app/porkchop/main.ts
//    (its text verbatim, with its line numbers), so the porkchop grid's departure span is read, not typed.
// 6. Aggregates everything into nhats-data.js, a classic script (window.LEDGER_DATA / module.exports)
//    so index.html can read the data from file://. Trajectories and cache rows are stored as arrays
//    against one field list (ledger.js turns them back into objects). Nothing is retyped: numbers are
//    parsed out of the snapshot files and the TypeScript sources by regex, and ledger.test.mjs rebuilds
//    the aggregate from the snapshots and checks it is deep-equal to the committed file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bankRoot = path.resolve(here, '..', '..');
const SNAPSHOT_TOOL = path.join(bankRoot, 'tools', 'snapshot.mjs');
const SNAP = path.join(here, 'snapshots');

export const FIXTURE_DIRS = [
  { key: 'validation-targets', repoDir: 'tests/fixtures/v2/nhats-validation-targets' },
  { key: 'oq7-coorbital', repoDir: 'tests/fixtures/v2/oq7-nhats-coorbital' },
];
export const SOURCE_FILES = [
  { name: 'delta-v.ts', repoPath: 'src/v2/porkchop/delta-v.ts' },
  { name: 'launch-vehicles.ts', repoPath: 'src/v2/porkchop/launch-vehicles.ts' },
  { name: 'feasibility.ts', repoPath: 'src/v2/core/lambert/feasibility.ts' },
];
const CACHE_REPO_PATH = 'tests/fixtures/v2/lambert-screen-cache.json';
export const CACHE_EXCERPT = 'lambert-screen-cache.excerpt.json';
export const CACHE_FIELDS = ['designation', 'status', 'minC3', 'minC3Date', 'minC3TofDays', 'minC3VInfArr', 'isCoOrbital'];
const GRID_REPO_PATH = 'src/v2/app/porkchop/main.ts';
export const GRID_EXCERPT = 'porkchop-grid.excerpt.json';
export const PICK = ['des', 'fullname', 'computed', 'signature', 'min_dv_traj'];
// Fields the tool writes per file that are hoisted to the bundle because they are the same for all.
const HOISTED = ['repo', 'commit', 'commitDate', 'mode', 'picked', 'note'];
const PER_FILE = ['pathLastChanged', 'committedBlob', 'readBlob', 'readMatchesCommitted', 'sourceSha256', 'sourceBytes', 'writtenSha256', 'writtenBytes'];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}
function snapshot(repo, repoPath, dest, extra) {
  execFileSync('node', [SNAPSHOT_TOOL, repo, repoPath, dest, ...extra], { stdio: ['ignore', 'ignore', 'inherit'] });
}
// The exact bytes snapshot.mjs writes for an excerpt (JSON, 1-space indent, trailing newline).
export const excerptBytes = (data) => Buffer.from(`${JSON.stringify(data, null, 1)}\n`);

// --- constants out of TypeScript
// `export const NAME = 398_600.4418;` -> 398600.4418 (numeric separators stripped). Throws when a
// constant is missing rather than falling back to a remembered value.
export function tsNumber(source, name) {
  const m = new RegExp(`export const ${name}\\s*=\\s*([0-9_.]+)\\s*;`).exec(source);
  if (!m) throw new Error(`constant ${name} not found in TypeScript source`);
  return Number(m[1].replace(/_/g, ''));
}
// `export const CAPE_CANAVERAL: LaunchSite = { name: '…', latitudeDeg: 28.5, … };`
export function tsSite(source, name) {
  const m = new RegExp(`export const ${name}: LaunchSite = \\{([^}]*)\\};`).exec(source);
  if (!m) throw new Error(`launch site ${name} not found in feasibility.ts`);
  const body = m[1];
  const num = (k) => {
    const mm = new RegExp(`${k}:\\s*([0-9.]+)`).exec(body);
    if (!mm) throw new Error(`${name}.${k} not found`);
    return Number(mm[1]);
  };
  const nm = /name:\s*'([^']+)'/.exec(body);
  return { name: nm ? nm[1] : name, latitudeDeg: num('latitudeDeg'), iMinDeg: num('iMinDeg'), iMaxDeg: num('iMaxDeg'), dlaCeilingDeg: num('dlaCeilingDeg') };
}

// `depStartJD: utcMidnightToJdTdb('2026-01-01'),` -> '2026-01-01'; tofMinDays: 182.5 -> 182.5.
export function gridParams(text) {
  const date = (k) => {
    const m = new RegExp(`${k}:\\s*utcMidnightToJdTdb\\('(\\d{4}-\\d{2}-\\d{2})'\\)`).exec(text);
    if (!m) throw new Error(`GRID_PARAMS.${k} not found`);
    return m[1];
  };
  const n = (k) => {
    const m = new RegExp(`${k}:\\s*([0-9.]+)`).exec(text);
    if (!m) throw new Error(`GRID_PARAMS.${k} not found`);
    return Number(m[1]);
  };
  return { depStartUtc: date('depStartJD'), depEndUtc: date('depEndJD'), tofMinDays: n('tofMinDays'), tofMaxDays: n('tofMaxDays') };
}
const sortedKeys = (o) => Object.keys(o).sort();

// --- aggregate from the snapshots
// Reads only files under snapshots/ (never the Aster checkout), so a test can rebuild it anywhere.
export function aggregate(root = here) {
  const snap = path.join(root, 'snapshots');
  const records = [];
  const notFound = [];
  let aster = null;
  let signature = null;
  let trajFields = null;
  for (const d of FIXTURE_DIRS) {
    const bundle = readJson(path.join(snap, 'nhats', `${d.key}.json`));
    const side = readJson(path.join(snap, 'nhats', `${d.key}.json.provenance.json`));
    if (!aster) aster = { repo: side.repo, commit: side.commit, commitDate: side.commitDate };
    if (side.commit !== aster.commit || bundle.commit !== aster.commit) throw new Error(`mixed commits in snapshots: ${d.key}`);
    if (bundle.files.length !== side.files) throw new Error(`${d.key}: bundle holds ${bundle.files.length} files, sidecar says ${side.files}`);
    for (const f of bundle.files) {
      const check = f.kind === 'excerpt' ? sha256(excerptBytes(f.data)) : sha256(Buffer.from(f.text));
      if (check !== f.writtenSha256) throw new Error(`${d.key}/${f.file}: data differs from what snapshot.mjs wrote`);
      if (f.kind === 'copy' && JSON.stringify(JSON.parse(f.text)) !== JSON.stringify(f.data)) throw new Error(`${d.key}/${f.file}: text and data disagree`);
      if (!f.readMatchesCommitted) throw new Error(`${d.key}/${f.file}: read bytes differed from the committed blob`);
      const src = { dir: d.key, file: f.file }; // the blob ids stay in the bundle, beside the data
      if (f.data.min_dv_traj) {
        // The API writes {source, version} in either key order; the content is the same for all 130.
        const sig = Object.fromEntries(Object.entries(f.data.signature || {}).sort());
        if (!signature) signature = sig;
        if (JSON.stringify(sig) !== JSON.stringify(signature)) throw new Error(`${f.file}: NHATS signature differs`);
        // one field list for every trajectory (the API writes the keys in varying order); each record
        // keeps its values as an array against it, which ledger.js turns back into an object
        const keys = sortedKeys(f.data.min_dv_traj);
        if (!trajFields) trajFields = keys;
        if (JSON.stringify(keys) !== JSON.stringify(trajFields)) throw new Error(`${f.file}: min_dv_traj fields differ`);
        // an unnumbered body's fullname is just "(des)": left out of the display aggregate (the bundle keeps it)
        const rec = { des: f.data.des, computed: f.data.computed, traj: trajFields.map((k) => f.data.min_dv_traj[k]), src };
        if (String(f.data.fullname).trim() !== `(${f.data.des})`) rec.fullname = f.data.fullname;
        records.push(rec);
      } else {
        notFound.push({ des: f.file.replace(/\.json$/, '').replace(/_/g, ' '), error: f.data.error === undefined ? null : f.data.error, src });
      }
    }
  }
  const ts = {};
  for (const s of SOURCE_FILES) {
    const full = path.join(snap, s.name);
    const side = readJson(`${full}.provenance.json`);
    if (side.commit !== aster.commit) throw new Error(`${s.name} snapshot is from another commit`);
    ts[s.name] = { text: fs.readFileSync(full, 'utf8'), blob: side.committedBlob };
  }
  const dv = ts['delta-v.ts'].text;
  const lv = ts['launch-vehicles.ts'].text;
  const fz = ts['feasibility.ts'].text;
  const constants = {
    EARTH_MU_KM3_PER_S2: tsNumber(dv, 'EARTH_MU_KM3_PER_S2'),
    LEO_PARKING_RADIUS_KM: tsNumber(dv, 'LEO_PARKING_RADIUS_KM'),
    STATIONKEEPING_DV_KMPS: tsNumber(dv, 'STATIONKEEPING_DV_KMPS'),
    DV_MARGIN_FRACTION: tsNumber(dv, 'DV_MARGIN_FRACTION'),
    SCREENING_ISP_S: tsNumber(lv, 'SCREENING_ISP_S'),
    DETERMINISTIC_MARGIN_FRACTION: tsNumber(lv, 'DETERMINISTIC_MARGIN_FRACTION'),
    SPACECRAFT_STATIONKEEPING_MPS: tsNumber(lv, 'SPACECRAFT_STATIONKEEPING_MPS'),
    G0_MPS2: tsNumber(lv, 'G0_MPS2'),
    sites: { CAPE_CANAVERAL: tsSite(fz, 'CAPE_CANAVERAL'), VANDENBERG_SFB: tsSite(fz, 'VANDENBERG_SFB') },
    sources: Object.fromEntries(SOURCE_FILES.map((s) => [s.name, { path: s.repoPath, blob: ts[s.name].blob }])),
  };
  const cache = readJson(path.join(snap, CACHE_EXCERPT));
  const cacheSide = readJson(path.join(snap, `${CACHE_EXCERPT}.provenance.json`));
  if (cacheSide.commit !== aster.commit) throw new Error('cache excerpt is from another commit');
  if (JSON.stringify(cache.fields) !== JSON.stringify(CACHE_FIELDS)) throw new Error('cache excerpt fields changed');
  const grid = readJson(path.join(snap, GRID_EXCERPT));
  const gridSide = readJson(path.join(snap, `${GRID_EXCERPT}.provenance.json`));
  if (gridSide.commit !== aster.commit) throw new Error('porkchop grid excerpt is from another commit');
  return {
    generatedBy: 'ideas/05-round-trip-ledger/build-data.mjs',
    aster,
    fixtureDirs: FIXTURE_DIRS.map((d) => d.repoDir),
    fixtureKeys: FIXTURE_DIRS.map((d) => d.key),
    signature,
    constants,
    trajFields,
    records,
    notFound,
    cache: { source: { path: cacheSide.path, blob: cacheSide.committedBlob, sourceSha256: cacheSide.sourceSha256 }, metadata: cache.metadata, bodiesInSource: cache.bodiesInSource, fields: cache.fields, rows: cache.rows },
    porkchopGrid: { source: { path: gridSide.path, blob: gridSide.committedBlob, lines: grid.lines }, ...gridParams(grid.text) },
  };
}

export function renderDataModule(data) {
  return `// Generated by build-data.mjs from the files under snapshots/ (each with its provenance sidecar).
// Do not edit: ledger.test.mjs rebuilds this aggregate from the snapshots and requires deep equality.
// Aster ${data.aster.repo} @ ${data.aster.commit}; ${data.records.length} NHATS min_dv_traj records, ${data.notFound.length} not-found files.
// Each record's traj is an array against trajFields; each cache row an array against cache.fields.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LEDGER_DATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return ${JSON.stringify(data)};
});
`;
}

// --- main
function main() {
  const repo = path.resolve(process.argv[2] || '/home/user/asteroid-mining-planner');
  if (!fs.existsSync(path.join(repo, '.git'))) {
    console.error(`not an Aster checkout: ${repo}`);
    process.exit(2);
  }
  const scratch = fs.mkdtempSync(path.join(process.env.CLAUDE_SCRATCHPAD || os.tmpdir(), '05-snap-'));
  const designations = new Set();
  try {
    // 1 + 2. NHATS fixtures: one snapshot.mjs run per file, folded into one bundle per directory.
    fs.mkdirSync(path.join(SNAP, 'nhats'), { recursive: true });
    for (const d of FIXTURE_DIRS) {
      const srcDir = path.join(repo, d.repoDir);
      const tmpDir = path.join(scratch, d.key);
      fs.mkdirSync(tmpDir, { recursive: true });
      const files = [];
      const hoisted = {};
      for (const f of fs.readdirSync(srcDir).sort()) {
        if (!f.endsWith('.json')) continue;
        const j = readJson(path.join(srcDir, f));
        const dest = path.join(tmpDir, f);
        if (j.min_dv_traj) {
          designations.add(j.des);
          snapshot(repo, `${d.repoDir}/${f}`, dest, ['--pick', PICK.join(','), '--note', 'NHATS object-detail record cached by Aster Slice 10 (OQ-4/OQ-7); excerpt keeps the identity fields and the min_dv_traj trajectory this study measures']);
        } else {
          snapshot(repo, `${d.repoDir}/${f}`, dest, ['--note', 'NHATS API error record: the body is not in NHATS; copied whole so the study can show which fixture files carry no trajectory']);
        }
        const side = readJson(`${dest}.provenance.json`);
        const text = fs.readFileSync(dest, 'utf8');
        const data = JSON.parse(text);
        const kind = j.min_dv_traj ? 'excerpt' : 'copy';
        const check = kind === 'excerpt' ? sha256(excerptBytes(data)) : sha256(Buffer.from(text));
        if (check !== side.writtenSha256) throw new Error(`${f}: bytes do not match the tool's writtenSha256`);
        for (const k of HOISTED) {
          const v = side[k] === undefined ? null : side[k];
          const key = k === 'mode' || k === 'note' || k === 'picked' ? `${kind}.${k}` : k;
          const s = JSON.stringify(v);
          if (hoisted[key] === undefined) hoisted[key] = s;
          else if (hoisted[key] !== s) throw new Error(`${f}: sidecar field ${k} is not constant across the directory`);
        }
        const entry = { file: f, kind };
        for (const k of PER_FILE) entry[k] = side[k];
        // readBlob repeats committedBlob whenever readMatchesCommitted is true (the tool's definition);
        // it is kept only when the two differ, so the bundle says the same thing in fewer bytes
        if (entry.readMatchesCommitted && entry.readBlob === entry.committedBlob) delete entry.readBlob;
        if (kind === 'copy') entry.text = text; // whole copies keep their exact bytes
        entry.data = data;
        files.push(entry);
      }
      const h = Object.fromEntries(Object.entries(hoisted).map(([k, v]) => [k, JSON.parse(v)]));
      // pathLastChanged is the same commit for every file in the directory: hoist it when it is
      const lastChanged = files.every((f) => f.pathLastChanged === files[0].pathLastChanged) ? files[0].pathLastChanged : null;
      if (lastChanged) for (const f of files) delete f.pathLastChanged;
      const bundle = {
        repo: h.repo,
        path: d.repoDir,
        commit: h.commit,
        commitDate: h.commitDate,
        pathLastChanged: lastChanged,
        committedTree: git(repo, ['rev-parse', `HEAD:${d.repoDir}`]),
        tool: 'tools/snapshot.mjs per file; folded by ideas/05-round-trip-ledger/build-data.mjs',
        excerpt: { mode: h['excerpt.mode'], picked: h['excerpt.picked'], note: h['excerpt.note'] },
        copy: h['copy.mode'] ? { mode: h['copy.mode'], note: h['copy.note'] } : null,
        perFileFields: PER_FILE.filter((k) => !(lastChanged && k === 'pathLastChanged')),
        perFileNote: 'readBlob is present only where it differs from committedBlob (readMatchesCommitted false); pathLastChanged is hoisted when every file shares it',
        files: null,
      };
      // header pretty-printed, then one compact line per file (diffable, a third the size of 1-space JSON)
      const head = JSON.stringify(bundle, null, 1);
      if (!/,\n "files": null\n}$/.test(head)) throw new Error('bundle header did not end with the files key');
      const text = `${head.replace(/,\n "files": null\n}$/, '')},\n "files": [\n  ${files.map((f) => JSON.stringify(f)).join(',\n  ')}\n ]\n}\n`;
      const bundlePath = path.join(SNAP, 'nhats', `${d.key}.json`);
      const bytes = Buffer.from(text);
      if (JSON.stringify(JSON.parse(text).files) !== JSON.stringify(files)) throw new Error('bundle text does not round-trip');
      fs.writeFileSync(bundlePath, bytes);
      const sidecar = {
        repo: h.repo,
        path: d.repoDir,
        commit: h.commit,
        commitDate: h.commitDate,
        pathLastChanged: git(repo, ['log', '-1', '--format=%h %cI', '--', d.repoDir]),
        committedTree: bundle.committedTree,
        files: files.length,
        sourceBytes: files.reduce((n, f) => n + f.sourceBytes, 0),
        copiedAt: new Date().toISOString(),
        mode: 'bundle',
        note: `one snapshot.mjs run per file in this directory (${files.filter((f) => f.kind === 'excerpt').length} excerpts picking ${PICK.join(',')}, ${files.filter((f) => f.kind === 'copy').length} whole copies of API error records), folded into one bundle by build-data.mjs; each file keeps its tool-written committedBlob, sha256 and bytes, and writtenSha256 = sha256 of JSON.stringify(data, null, 1) + newline, which ledger.test.mjs re-verifies. The sidecar is written by build-data.mjs in snapshot.mjs's schema because the tool has no multi-file mode; committedTree is git rev-parse HEAD:<path>.`,
        readMatchesCommitted: files.every((f) => f.readMatchesCommitted),
        writtenSha256: sha256(bytes),
        writtenBytes: bytes.length,
      };
      fs.writeFileSync(`${bundlePath}.provenance.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
      console.log(`bundle  snapshots/nhats/${d.key}.json  (${files.length} files, ${bytes.length} bytes, tree ${bundle.committedTree.slice(0, 7)})`);
    }
    // 3. Aster source modules whose constants the study uses
    for (const s of SOURCE_FILES) {
      snapshot(repo, s.repoPath, path.join(SNAP, s.name), ['--note', 'Aster constants read by regex (build-data.mjs tsNumber/tsSite); the module is copied whole so the reader can see the code the constants come from']);
    }
    // 4. Screening-cache excerpt for the same bodies
    const cache = readJson(path.join(repo, CACHE_REPO_PATH));
    const rows = cache.bodies
      .filter((b) => designations.has(b.designation))
      .map((b) => {
        const w = Array.isArray(b.bestWindows) ? b.bestWindows[0] : undefined;
        const o = { designation: b.designation, status: b.status, minC3: b.minC3, minC3Date: b.minC3Date, minC3TofDays: b.minC3TofDays, minC3VInfArr: w ? w.vInfArr : null, isCoOrbital: b.isCoOrbital };
        return CACHE_FIELDS.map((k) => o[k]);
      })
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const excerpt = {
      metadata: cache.metadata,
      derivedBy: 'ideas/05-round-trip-ledger/build-data.mjs: rows whose designation equals a NHATS record des, seven fields each, one array per row in the order of fields (minC3VInfArr is bestWindows[0].vInfArr, the cheapest window)',
      bodiesInSource: cache.bodies.length,
      fields: CACHE_FIELDS,
      rows,
    };
    const excerptPath = path.join(SNAP, CACHE_EXCERPT);
    const excerptHead = JSON.stringify({ ...excerpt, fields: null, rows: null }, null, 1);
    if (!/,\n "fields": null,\n "rows": null\n}$/.test(excerptHead)) throw new Error('excerpt header did not end with the fields and rows keys');
    const excerptText = `${excerptHead.replace(/,\n "fields": null,\n "rows": null\n}$/, '')},\n "fields": ${JSON.stringify(CACHE_FIELDS)},\n "rows": [\n  ${rows.map((r) => JSON.stringify(r)).join(',\n  ')}\n ]\n}\n`;
    if (JSON.stringify(JSON.parse(excerptText)) !== JSON.stringify(excerpt)) throw new Error('excerpt text does not round-trip');
    fs.writeFileSync(excerptPath, excerptText);
    snapshot(repo, CACHE_REPO_PATH, excerptPath, ['--sidecar-only', '--note', `derived by build-data.mjs: the ${rows.length} cache rows whose designation matches a NHATS min_dv_traj record, keeping designation, status, minC3, minC3Date, minC3TofDays, bestWindows[0].vInfArr, isCoOrbital (one array per row in that order), plus the cache metadata`]);
    // 5. The porkchop grid's parameters, verbatim, with their line numbers
    const mainTs = fs.readFileSync(path.join(repo, GRID_REPO_PATH), 'utf8');
    const gm = /^export const GRID_PARAMS = \{[^}]*\} as const;$/m.exec(mainTs);
    if (!gm) throw new Error(`GRID_PARAMS not found in ${GRID_REPO_PATH}`);
    const firstLine = mainTs.slice(0, gm.index).split('\n').length;
    const grid = { derivedBy: `ideas/05-round-trip-ledger/build-data.mjs: the GRID_PARAMS block of ${GRID_REPO_PATH}, verbatim`, path: GRID_REPO_PATH, lines: [firstLine, firstLine + gm[0].split('\n').length - 1], text: gm[0] };
    gridParams(grid.text); // throws now if the block no longer parses
    const gridPath = path.join(SNAP, GRID_EXCERPT);
    fs.writeFileSync(gridPath, `${JSON.stringify(grid, null, 1)}\n`);
    snapshot(repo, GRID_REPO_PATH, gridPath, ['--sidecar-only', '--note', `derived by build-data.mjs: the GRID_PARAMS block (lines ${grid.lines.join('-')}) copied verbatim; the study reads the porkchop grid's departure span from it`]);
    // 6. Aggregate
    const data = aggregate(here);
    const out = renderDataModule(data);
    fs.writeFileSync(path.join(here, 'nhats-data.js'), out);
    console.log(`wrote nhats-data.js (${out.length} bytes): ${data.records.length} records, ${data.notFound.length} not-found, ${data.cache.rows.length} cache rows, porkchop grid ${data.porkchopGrid.depStartUtc}..${data.porkchopGrid.depEndUtc}, Aster @ ${data.aster.commit.slice(0, 7)}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
