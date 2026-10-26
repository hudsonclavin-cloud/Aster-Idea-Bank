#!/usr/bin/env node
// Rebuilds this deposit's data from an Aster checkout, in two stages:
//
//   1. snapshot  (needs the checkout)  every source file goes through the bank's tools/snapshot.mjs,
//      which writes a provenance sidecar (repo, path, commit, blob, sha256). Two files are DERIVED
//      here and recorded with --sidecar-only: the weekly Earth excerpt and the drift-truth excerpt.
//   2. aggregate (snapshots only)      data.js, the classic-script bundle the page loads, is built
//      from the snapshots alone; homeward.test.mjs rebuilds it and requires deep equality.
//
//   node ideas/21-homeward-porkchop/build-data.mjs [/path/to/asteroid-mining-planner]
//   node ideas/21-homeward-porkchop/build-data.mjs --aggregate-only
//
// Constants are read out of Aster's TypeScript copies by regex; a missing match throws, so a
// renamed constant stops the build rather than letting a remembered value in.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(HERE, 'snapshots');
const TOOL = path.join(HERE, '..', '..', 'tools', 'snapshot.mjs');
const require = createRequire(import.meta.url);
const H = require('./homeward.js');

export const BODY_KEYS = [
  ['1999 AO10', 'asteroid-1999 AO10', '1999_AO10'],
  ['101955', 'asteroid-101955', '101955'],
  ['2000 SG344', 'asteroid-2000 SG344', '2000_SG344'],
  ['99942', 'asteroid-99942', '99942'],
  ['2001 GP2', 'asteroid-2001 GP2', '2001_GP2'],
  ['433', 'asteroid-433', null],
];
// Bodies whose JPL-integrated truth Aster committed for Slice 18 (nea-drift-truth-2026-2046.json).
const DRIFT_TARGETS = ['99942', '433'];
// The bundle shape: weekly Earth samples (every 7th daily record) and half-yearly drift checkpoints.
export const EARTH_STRIDE = 7;
export const DRIFT_STRIDE = 26;

const TS_FILES = [
  ['src/v2/core/propagators/keplerian.ts', 'keplerian.ts'],
  ['src/v2/core/units.ts', 'units.ts'],
  ['src/v2/core/constants/bodies.ts', 'bodies.ts'],
  ['src/v2/porkchop/delta-v.ts', 'delta-v.ts'],
  ['src/v2/porkchop/colormap.ts', 'colormap.ts'],
  ['src/v2/porkchop/support-boundary.ts', 'support-boundary.ts'],
  ['src/v2/boundary/c3-grid.test.mjs', 'c3-grid.test.mjs'],
  ['mcp/src/tools/envelope-schema.ts', 'envelope-schema.ts'],
  ['tests/v2-lambert/lambert-endtoend.test.mjs', 'lambert-endtoend.test.mjs'],
  ['tests/fixtures/v2/lambert-multi-rev-pinned-cells.json', 'lambert-multi-rev-pinned-cells.json'],
  ['src/v2/research/slice-11-porkchop/perplexity-jpl-trajectory-browser-nhats.md', 'nhats-research-note.md'],
];

function snap(aster, rel, dest, extra = []) {
  execFileSync('node', [TOOL, aster, rel, path.join(SNAP, dest), ...extra], { stdio: 'inherit' });
}

function stage1(aster) {
  fs.mkdirSync(path.join(SNAP, 'nhats'), { recursive: true });
  for (const [rel, dest] of TS_FILES) snap(aster, rel, dest);
  snap(aster, 'tests/fixtures/v2/nea-catalog-slice9.json', 'catalog-six.json', [
    '--pick', ['selectionSource', 'anchorSource', 'frame', 'timeScale', 'units', 'propagation', ...BODY_KEYS.map((b) => `asteroids.${b[1]}`)].join(','),
    '--note', 'Six bodies of 41,906: the five NHATS validation targets and 433 Eros. Elements, anchor state and catalog metadata verbatim.',
  ]);
  snap(aster, 'docs/tier-sizing-per-body.json', 'tier-six.json', [
    '--pick', ['generatedAtUtc', 'source', 'populations', ...BODY_KEYS.map((b) => `records.${b[0]}`)].join(','),
    '--note', 'Slice 18 fidelity tiers for the same six bodies (L1 encounter = the support boundary).',
  ]);
  for (const [, , file] of BODY_KEYS) {
    if (file) snap(aster, `tests/fixtures/v2/nhats-validation-targets/${file}.json`, `nhats/${file}.json`);
  }

  // Derived 1: weekly Earth excerpt, as a classic script the page can load from file://.
  const long = JSON.parse(fs.readFileSync(path.join(aster, EARTH_REL), 'utf8'));
  const units = parseUnits(fs.readFileSync(path.join(SNAP, 'units.ts'), 'utf8'));
  const earthDerived = deriveEarth(long, units.secondsPerDay);
  fs.writeFileSync(path.join(SNAP, 'earth-weekly.js'), earthDerived.text);
  snap(aster, EARTH_REL, 'earth-weekly.js', ['--sidecar-only', '--note',
    `derived by build-data.mjs: ${earthDerived.data.rule} (${earthDerived.data.keptRecords} of ${earthDerived.data.sourceRecords}); wrapped as a classic script for file://`]);

  // Derived 2: two-body drift truth for the bodies Slice 18 measured (Apophis, Eros), half-yearly.
  const drift = JSON.parse(fs.readFileSync(path.join(aster, DRIFT_REL), 'utf8'));
  const nhatsTrajs = BODY_KEYS.filter((b) => b[2]).map((b) => JSON.parse(fs.readFileSync(path.join(SNAP, 'nhats', `${b[2]}.json`), 'utf8')).min_dv_traj);
  const driftDerived = deriveDrift(drift, earthDerived.data.records, nhatsTrajs);
  fs.writeFileSync(path.join(SNAP, 'drift-excerpt.json'), driftDerived.text);
  snap(aster, DRIFT_REL, 'drift-excerpt.json', ['--sidecar-only', '--note', `derived by build-data.mjs: ${driftDerived.data.rule}; targets ${DRIFT_TARGETS.join(', ')}`]);
}

export const EARTH_REL = 'src/v2/data/horizons-inner-solar-system-2026-2040.json';
export const DRIFT_REL = 'tests/fixtures/v2/nea-drift-truth-2026-2046.json';

/** Weekly Earth excerpt plus its measured interpolation error against every daily record left out. */
export function deriveEarth(long, secondsPerDay) {
  const earth = long.targets.earth;
  const daily = earth.records;
  const kept = daily.filter((_, i) => i % EARTH_STRIDE === 0);
  if (kept[kept.length - 1][0] !== daily[daily.length - 1][0]) kept.push(daily[daily.length - 1]);
  const keptJd = new Set(kept.map((r) => r[0]));
  const eph = H.makeEphemeris(kept, secondsPerDay);
  let maxPos = 0, maxPosJd = null, maxVel = 0, maxVelJd = null, heldOut = 0, maxAbsVz = 0;
  for (const d of daily) {
    maxAbsVz = Math.max(maxAbsVz, Math.abs(d[6]));
    if (keptJd.has(d[0])) continue;
    heldOut += 1;
    const s = eph.stateAt(d[0]);
    const ep = Math.hypot(s.r[0] - d[1], s.r[1] - d[2], s.r[2] - d[3]);
    const ev = Math.hypot(s.v[0] - d[4], s.v[1] - d[5], s.v[2] - d[6]);
    if (ep > maxPos) { maxPos = ep; maxPosJd = d[0]; }
    if (ev > maxVel) { maxVel = ev; maxVelJd = d[0]; }
  }
  const data = {
    derivedFrom: EARTH_REL,
    rule: `every ${EARTH_STRIDE}th daily record of targets.earth.records starting with the first, plus the last record; values verbatim`,
    source: long.source,
    frame: long.frame,
    timeScale: long.timeScale,
    units: long.units,
    targetId: earth.targetId,
    center: earth.center,
    sourceRecords: daily.length,
    keptRecords: kept.length,
    heldOut: {
      count: heldOut,
      method: 'cubic Hermite on the kept records (homeward.js makeEphemeris), against every daily record not kept',
      maxPositionErrorKm: maxPos,
      maxPositionErrorAtJd: maxPosJd,
      maxVelocityErrorKmS: maxVel,
      maxVelocityErrorAtJd: maxVelJd,
    },
    maxAbsVzKmSAllDaily: maxAbsVz,
    // The held-out daily records inside the interval(s) holding the two worst errors, so the test
    // can reproduce the whole-span maxima without the 7 MB source.
    heldOutWorst: daily.filter((d) => !keptJd.has(d[0]) && [maxPosJd, maxVelJd].some((w) => {
      const lo = kept.filter((k) => k[0] <= w).pop()[0];
      const hi = kept.find((k) => k[0] >= w)[0];
      return d[0] > lo && d[0] < hi;
    })),
    records: kept,
  };
  return { data, text: umdText('HomewardEarth', data, `Derived by build-data.mjs from Aster ${EARTH_REL}: ${data.rule}.`) };
}

/** Half-yearly drift-truth checkpoints for the measured bodies, plus records on NHATS return-departure dates. */
export function deriveDrift(drift, earthRecords, nhatsTrajs) {
  const nhatsDeps = new Set(nhatsTrajs.map((t) => H.nhatsReturnDates(t).depJd));
  const lo = earthRecords[0][0];
  const hi = earthRecords[earthRecords.length - 1][0];
  const data = {
    derivedFrom: DRIFT_REL,
    rule: `records every ${DRIFT_STRIDE} weeks from the first, inside the Earth span ${lo}..${hi} (JD TDB), plus any record on an NHATS return-departure date`,
    source: drift.source,
    purpose: drift.purpose,
    frame: drift.frame,
    timeScale: drift.timeScale,
    units: drift.units,
    recordShape: drift.recordShape,
    window: drift.window,
    targets: {},
  };
  for (const des of DRIFT_TARGETS) {
    const t = drift.targets[des];
    const recs = t.records.filter((r, i) => (r[0] >= lo && r[0] <= hi && i % DRIFT_STRIDE === 0) || nhatsDeps.has(r[0]));
    data.targets[des] = { band: t.band, selectionReason: t.selectionReason, recordCount: t.records.length, records: recs };
  }
  return { data, text: `${JSON.stringify(data)}\n` };
}

function umdText(globalName, obj, comment) {
  return `// ${comment}\n(function (root, data) {\n  if (typeof module === 'object' && module.exports) module.exports = data;\n  else root.${globalName} = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(obj)});\n`;
}

// ---------- regex readers over the TypeScript copies ----------
function need(re, text, what) {
  const m = re.exec(text);
  if (!m) throw new Error(`build-data: could not read ${what}`);
  return m;
}
const num = (s) => Number(String(s).replace(/_/g, ''));
export function parseUnits(text) {
  const arcsec = num(need(/J2000_ECLIPTIC_OBLIQUITY_RAD\s*=\s*([\d_.]+)\s*\*\s*ARCSECONDS_TO_RADIANS/, text, 'obliquity')[1]);
  need(/ARCSECONDS_TO_RADIANS\s*=\s*Math\.PI\s*\/\s*\(180\s*\*\s*3600\)/, text, 'arcsecond conversion');
  return {
    j2000Jd: num(need(/J2000_TDB_JULIAN_DATE\s*=\s*([\d_.]+)/, text, 'J2000 JD')[1]),
    secondsPerDay: num(need(/SECONDS_PER_DAY\s*=\s*([\d_]+)/, text, 'seconds per day')[1]),
    obliquityArcsec: arcsec,
    obliquityRad: arcsec * (Math.PI / (180 * 3600)),
  };
}
export function readConstants(snapDir) {
  const read = (f) => fs.readFileSync(path.join(snapDir, f), 'utf8');
  const kep = read('keplerian.ts');
  const units = parseUnits(read('units.ts'));
  const dv = read('delta-v.ts');
  const bodies = read('bodies.ts');
  const note = read('nhats-research-note.md');
  const gmSun = num(need(/export const GM_SUN_M3_S2\s*=\s*([\d_.eE+-]+)/, kep, 'GM_SUN_M3_S2')[1]);
  const muEarth = num(need(/export const EARTH_MU_KM3_PER_S2\s*=\s*([\d_.]+)/, dv, 'EARTH_MU_KM3_PER_S2')[1]);
  const parking = num(need(/export const LEO_PARKING_RADIUS_KM\s*=\s*([\d_.]+)/, dv, 'LEO_PARKING_RADIUS_KM')[1]);
  const earthRadiusM = num(need(/earth:\s*\{\s*naifId:\s*399,\s*radiusM:\s*([\d_.]+)/, bodies, 'Earth radiusM')[1]);
  const entry = need(/Earth atmospheric entry speed ≤ (\d+) km\/s at (\d+) km altitude/, note, 'NHATS entry convention');
  const symmetric = need(/export function departureDvFromVInf\(vInfArrKmps: number\): number \{\s*return vInfArrKmps;\s*\}/, dv, 'symmetric-return departure line');
  const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
  return {
    muSunKm3S2: gmSun / 1e9,
    gmSunM3S2: gmSun,
    obliquityArcsec: units.obliquityArcsec,
    obliquityRad: units.obliquityRad,
    secondsPerDay: units.secondsPerDay,
    j2000Jd: units.j2000Jd,
    muEarthKm3S2: muEarth,
    parkingRadiusKm: parking,
    earthRadiusKm: earthRadiusM / 1000,
    entryAltitudeKm: Number(entry[2]),
    entryCapKmS: Number(entry[1]),
    entryRadiusKm: earthRadiusM / 1000 + Number(entry[2]),
    entryNoteLine: lineOf(note, entry.index),
    symmetricReturnLine: lineOf(dv, symmetric.index),
  };
}
export function readColormap(snapDir) {
  const t = fs.readFileSync(path.join(snapDir, 'colormap.ts'), 'utf8');
  const stops = [];
  const re = /\{\s*t:\s*([\d.]+),\s*rgb:\s*\[(\d+),\s*(\d+),\s*(\d+)\]\s*\}/g;
  let m;
  while ((m = re.exec(t))) stops.push({ t: Number(m[1]), rgb: [Number(m[2]), Number(m[3]), Number(m[4])] });
  if (stops.length < 2) throw new Error('build-data: no viridis stops');
  const nos = need(/NO_SOLUTION_RGB: Rgb = \[(\d+), (\d+), (\d+)\]/, t, 'NO_SOLUTION_RGB');
  return {
    min: num(need(/export const C3_COLOR_MIN = ([\d_.]+)/, t, 'C3_COLOR_MIN')[1]),
    max: num(need(/export const C3_COLOR_MAX = ([\d_.]+)/, t, 'C3_COLOR_MAX')[1]),
    stops,
    noSolutionRgb: [Number(nos[1]), Number(nos[2]), Number(nos[3])],
  };
}
export function readRefusalCodes(snapDir) {
  const t = fs.readFileSync(path.join(snapDir, 'envelope-schema.ts'), 'utf8');
  const m = need(/refusal: z\.object\(\{\s*code: z\.enum\(\[([^\]]+)\]\)/, t, 'refusal code enum');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}
export function readOutboundRule(snapDir) {
  const t = fs.readFileSync(path.join(snapDir, 'support-boundary.ts'), 'utf8');
  const m = need(/export function isArrivalAfterEncounter\(cell: ArrivalCell, boundary: SupportBoundary\): boolean \{\s*return arrivalJd\(cell\) >= boundary\.encounterJd;/, t, 'outbound support rule');
  return { rule: 'arrivalJd(cell) >= boundary.encounterJd', line: t.slice(0, m.index).split('\n').length };
}

/** Stage 2: the page's bundle, from the snapshots only. */
export function buildAggregate(snapDir = SNAP) {
  const readJson = (f) => JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8'));
  const sidecar = (f) => readJson(`${f}.provenance.json`);
  const catalog = readJson('catalog-six.json');
  const tiers = readJson('tier-six.json');
  const bodies = BODY_KEYS.map(([des, key, file]) => {
    const a = catalog.asteroids[key];
    return {
      key,
      designation: a.designation,
      name: a.name,
      orbitClass: a.orbitClass,
      H: a.H,
      estimatedRadiusM: a.estimatedRadiusM,
      conditionCode: a.conditionCode,
      elementsFrame: a.elementsFrame,
      elements: a.elements,
      anchor: a.anchor,
      tier: tiers.records[des] || null,
      nhatsFile: file,
    };
  });
  const nhats = {};
  for (const [, , file] of BODY_KEYS) {
    if (!file) continue;
    const r = readJson(`nhats/${file}.json`);
    nhats[file] = { des: r.des, fullname: r.fullname.trim(), computed: r.computed, signature: r.signature, min_dv_traj: r.min_dv_traj };
  }
  const drift = readJson('drift-excerpt.json');
  const prov = sidecar('catalog-six.json');
  return {
    aster: { repo: prov.repo, commit: prov.commit, commitDate: prov.commitDate },
    catalogMeta: { frame: catalog.frame, timeScale: catalog.timeScale, propagation: catalog.propagation, anchorSource: catalog.anchorSource },
    tierMeta: { generatedAtUtc: tiers.generatedAtUtc, source: tiers.source },
    constants: readConstants(snapDir),
    colormap: readColormap(snapDir),
    refusalCodes: readRefusalCodes(snapDir),
    outboundSupportRule: readOutboundRule(snapDir),
    lattice: { tofMinDays: 30, tofMaxDays: 720, nDep: 200, nTof: 70 },
    bodies,
    nhats,
    drift: { source: drift.source, purpose: drift.purpose, rule: drift.rule, targets: drift.targets },
  };
}

export function aggregateText(agg) {
  return `// Built by build-data.mjs from snapshots/ only (see the .provenance.json sidecars). Do not edit.\n(function (root, data) {\n  if (typeof module === 'object' && module.exports) module.exports = data;\n  else root.HomewardData = data;\n})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(agg)});\n`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log('usage: node build-data.mjs [/path/to/asteroid-mining-planner] | --aggregate-only');
    return;
  }
  if (!args.includes('--aggregate-only')) stage1(path.resolve(args.find((a) => !a.startsWith('--')) || '/home/user/asteroid-mining-planner'));
  const agg = buildAggregate(SNAP);
  fs.writeFileSync(path.join(HERE, 'data.js'), aggregateText(agg));
  console.log(`data.js: ${agg.bodies.length} bodies, ${Object.keys(agg.nhats).length} NHATS records, Aster ${agg.aster.commit.slice(0, 7)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
