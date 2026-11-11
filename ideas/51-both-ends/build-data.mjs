#!/usr/bin/env node
// Builds snapshots/data.js, the one classic-script data module index.html, the CLI and the tests
// read (fetch() of a sibling JSON file is blocked on file://). Nothing is retyped: every number is
// parsed out of a tools/snapshot.mjs copy in snapshots/ or out of the Aster checkout's committed
// NHATS fixtures, and the tests re-derive the published ones.
//
//   node ideas/51-both-ends/build-data.mjs --aster /home/user/asteroid-mining-planner
//
// Sources
//   snapshots/rev_a.json              Skyhook params/rev_a.json (whole file)
//   snapshots/skyhook_physics.py      Skyhook physics module: R_EARTH_KM
//   snapshots/aster_delta-v.ts        Aster: EARTH_MU_KM3_PER_S2, LEO_PARKING_RADIUS_KM
//   snapshots/aster_launch-vehicles.ts Aster: vehicle curves, Isp, margin, stationkeeping, g0
//   <aster>/tests/fixtures/v2/{nhats-validation-targets,oq7-nhats-coorbital}/*.json
//                                     JPL NHATS API records; min_dv_traj kept as returned
//   three altitudes Aster states only in prose: each is found by its quoted text, and the build
//   stops if the quote is gone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const snap = (f) => path.join(here, 'snapshots', f);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const asterArg = process.argv.indexOf('--aster');
if (asterArg === -1) {
  console.error('Usage: node build-data.mjs --aster <asteroid-mining-planner checkout>');
  process.exit(2);
}
const repo = path.resolve(process.argv[asterArg + 1] || '');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const read = (f) => fs.readFileSync(snap(f), 'utf8');
const prov = (f) => JSON.parse(read(`${f}.provenance.json`));
const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

function tsNumber(text, name, file) {
  const m = new RegExp(`export const ${name}\\s*=\\s*([0-9_.eE+-]+)`).exec(text);
  if (!m) throw new Error(`${file}: no "export const ${name} = <number>"`);
  return { value: Number(m[1].replace(/_/g, '')), line: lineOf(text, `export const ${name}`) };
}

// ---------------------------------------------------------------- Skyhook
const revA = JSON.parse(read('rev_a.json'));
const py = read('skyhook_physics.py');
const rE = /^R_EARTH_KM\s*=\s*([0-9.]+)/m.exec(py);
if (!rE) throw new Error('skyhook_physics.py: no R_EARTH_KM');

// ---------------------------------------------------------------- Aster constants
const dvTs = read('aster_delta-v.ts');
const lvTs = read('aster_launch-vehicles.ts');
const mu = tsNumber(dvTs, 'EARTH_MU_KM3_PER_S2', 'aster_delta-v.ts');
const rPark = tsNumber(dvTs, 'LEO_PARKING_RADIUS_KM', 'aster_delta-v.ts');
const isp = tsNumber(lvTs, 'SCREENING_ISP_S', 'aster_launch-vehicles.ts');
const margin = tsNumber(lvTs, 'DETERMINISTIC_MARGIN_FRACTION', 'aster_launch-vehicles.ts');
const sk = tsNumber(lvTs, 'SPACECRAFT_STATIONKEEPING_MPS', 'aster_launch-vehicles.ts');
const g0 = tsNumber(lvTs, 'G0_MPS2', 'aster_launch-vehicles.ts');

// Vehicle curves: every `{ name, config, ..., curve: [ {c3, payloadKg, basis} ... ] }` block.
const vehicles = [];
const block = /name:\s*'([^']+)',\s*config:\s*'([^']+)',\s*site:\s*'([^']+)',[\s\S]*?curve:\s*\[([\s\S]*?)\],/g;
for (let m; (m = block.exec(lvTs)); ) {
  const curve = [...m[4].matchAll(/\{\s*c3:\s*([0-9.]+),\s*payloadKg:\s*([0-9.]+),\s*basis:\s*'([^']+)'\s*\}/g)].map((a) => ({
    c3: Number(a[1]),
    payloadKg: Number(a[2]),
    basis: a[3],
  }));
  if (curve.length < 2) throw new Error(`launch-vehicles.ts: ${m[1]} ${m[2]} has ${curve.length} anchors`);
  vehicles.push({ name: m[1], config: m[2], site: m[3], curve });
}
const anchorCount = (lvTs.match(/payloadKg:\s*[0-9]/g) || []).length;
const parsedAnchors = vehicles.reduce((n, v) => n + v.curve.length, 0);
if (parsedAnchors !== anchorCount) throw new Error(`parsed ${parsedAnchors} anchors, file has ${anchorCount}`);
const src = /const ELVPERF_SOURCE = '([^']+)'/.exec(lvTs);
const asOf = /const ELVPERF_AS_OF = '([^']+)'/.exec(lvTs);

// ---------------------------------------------------------------- cited prose
const CITED_SPEC = {
  leo_parking_altitude_km: { value: 200, file: 'src/v2/app/porkchop/main.ts', quote: '200 km circular LEO (r = ${LEO_PARKING_RADIUS_KM.toFixed(3)} km' },
  nhats_parking_altitude_km: { value: 400, file: 'src/v2/research/slice-11-porkchop/perplexity-jpl-trajectory-browser-nhats.md', quote: 'Earth departure from a 400 km parking orbit' },
  nhats_entry_altitude_km: { value: 125, file: 'src/v2/research/slice-11-porkchop/perplexity-jpl-trajectory-browser-nhats.md', quote: 'Earth atmospheric entry speed ≤ 12 km/s at 125 km altitude' },
  browser_reentry_altitude_km: { value: 200, file: 'src/v2/research/slice-11-porkchop/perplexity-jpl-trajectory-browser-nhats.md', quote: '200 km Earth inertial reentry' },
};
const cited = {};
for (const [k, c] of Object.entries(CITED_SPEC)) {
  const line = lineOf(fs.readFileSync(path.join(repo, c.file), 'utf8'), c.quote);
  if (!line) throw new Error(`${k}: ${c.file} no longer says "${c.quote}"`);
  cited[k] = { value: c.value, cite: `${c.file}:${line}`, quote: c.quote };
}

// ---------------------------------------------------------------- NHATS records
const DIRS = ['tests/fixtures/v2/nhats-validation-targets', 'tests/fixtures/v2/oq7-nhats-coorbital'];
const FIELDS = ['launch', 'c3', 'v_dep_earth', 'dv_dep_park', 'dec_dep', 'vrel_arr_neo', 'vrel_dep_neo', 'v_arr_earth', 'dec_arr', 'dur_out', 'dur_at', 'dur_ret', 'dur_total', 'dv_total'];
const records = [];
const byDes = new Map();
const skipped = [];
const dirs = [];
let filesRead = 0;
let allMatch = true;
for (const dir of DIRS) {
  const committed = new Map(
    git('ls-tree', 'HEAD', `${dir}/`).split('\n').filter(Boolean).map((l) => {
      const [meta, p] = l.split('\t');
      return [p, meta.split(' ')[2]];
    })
  );
  const names = fs.readdirSync(path.join(repo, dir)).filter((f) => f.endsWith('.json')).sort();
  const blobs = git('hash-object', ...names.map((f) => `${dir}/${f}`)).split('\n');
  names.forEach((f, i) => {
    filesRead++;
    const rel = `${dir}/${f}`;
    if (committed.get(rel) !== blobs[i]) allMatch = false;
    const j = JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
    const t = j && j.min_dv_traj;
    if (!t) {
      skipped.push({ file: rel, reason: j && j.error ? `API error record: ${String(j.error).slice(0, 80)}` : 'no min_dv_traj' });
      return;
    }
    const prev = byDes.get(j.des);
    if (prev) {
      prev.files.push(rel);
      if (FIELDS.some((k) => prev[k] !== t[k])) prev.conflict = true;
      return;
    }
    const rec = { des: j.des, fullname: String(j.fullname || '').trim(), computed: j.computed };
    for (const k of FIELDS) rec[k] = t[k]; // strings, exactly as the API returned them
    rec.files = [rel];
    byDes.set(j.des, rec);
    records.push(rec);
  });
  dirs.push({ path: dir, committedTree: git('rev-parse', `HEAD:${dir}`), files: names.length });
}
records.sort((a, b) => a.fullname.localeCompare(b.fullname));

const asterCommit = git('rev-parse', 'HEAD');
const data = {
  skyhook: {
    rev_a: revA,
    r_earth_km: Number(rE[1]),
    r_earth_source: `snapshots/skyhook_physics.py:${lineOf(py, 'R_EARTH_KM =')} (physics/skyhook_physics.py, the radius apogee_from_release evaluates at)`,
    provenance: prov('rev_a.json'),
  },
  aster: {
    earth_mu_km3s2: mu.value,
    leo_parking_radius_km: rPark.value,
    screening_isp_s: isp.value,
    deterministic_margin_fraction: margin.value,
    stationkeeping_mps: sk.value,
    g0_mps2: g0.value,
    source: `snapshots/aster_delta-v.ts:${mu.line},${rPark.line}; snapshots/aster_launch-vehicles.ts:${isp.line},${margin.line},${sk.line},${g0.line}`,
    vehicles,
    vehicles_source: `${src ? src[1] : 'unknown'}, as-of ${asOf ? asOf[1] : 'unknown'} (snapshots/aster_launch-vehicles.ts)`,
    commit: asterCommit,
    cited,
  },
  nhats: {
    source: 'NASA/JPL NHATS Data API records committed in Aster tests/fixtures/v2 (min_dv_traj of each body)',
    dirs,
    files_read: filesRead,
    skipped,
    records,
  },
};

const out = `// Generated by build-data.mjs. Do not edit.
// Skyhook params/rev_a.json @ ${String(data.skyhook.provenance.commit).slice(0, 7)}; Aster @ ${asterCommit.slice(0, 7)}.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BOTH_ENDS_DATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return ${JSON.stringify(data)};
});
`;
fs.writeFileSync(snap('data.js'), out);
const sidecar = {
  repo: 'https://github.com/hudsonclavin-cloud/asteroid-mining-planner + https://github.com/hudsonclavin-cloud/skyhook',
  path: `${DIRS.join(' + ')} + the four whole-file copies in this snapshots/ folder`,
  commit: `aster ${asterCommit}; skyhook ${data.skyhook.provenance.commit}`,
  commitDate: git('log', '-1', '--format=%cI'),
  committedTree: dirs.map((d) => `${d.path}=${d.committedTree}`).join(' '),
  sourceFiles: filesRead,
  copiedAt: new Date().toISOString(),
  mode: 'derived',
  note: `derived by build-data.mjs --aster: ${records.length} unique NHATS bodies from ${filesRead} fixture files (${skipped.length} API error records listed, not kept; duplicates folded), fields ${FIELDS.join(', ')} kept as the strings the API returned; the whole rev_a.json; R_EARTH_KM from skyhook_physics.py; Aster constants and ${vehicles.length} launch-vehicle curves (${parsedAnchors} anchors) parsed from the TypeScript copies; four cited altitudes whose quoted text the build re-finds. Sidecar written by build-data.mjs in tools/snapshot.mjs's schema (the tool has no multi-file mode).`,
  readMatchesCommitted: allMatch,
  writtenSha256: sha256(Buffer.from(out)),
  writtenBytes: Buffer.byteLength(out),
};
fs.writeFileSync(snap('data.js.provenance.json'), JSON.stringify(sidecar, null, 2) + '\n');
console.log(`wrote snapshots/data.js: ${records.length} bodies, ${vehicles.length} vehicles, ${Buffer.byteLength(out)} bytes; fixtures match committed blobs: ${allMatch}`);
