#!/usr/bin/env node
// Near Field Guide: the derivation. Reads Aster's committed NEA catalog fixture (all 41,906 records,
// 53 MB), the Slice 18 per-body tier artifact and the Jupiter Horizons fixture from a checkout, bins
// every record with guide.js, and writes snapshots/bins.data.js: histograms per "atom" (orbitClass x
// inv014Tier x Slice 18 tier), the null census, the stored-class check, the landmark records, the
// constants with the source line each was read from, and the passages the page quotes.
//
//   node ideas/28-near-field-guide/build-data.mjs [--aster DIR] [--write | --check | --json] [--help]
//
// With no mode it prints a text summary (example.txt is that output). --write rebuilds the data
// file; --check re-derives it and compares byte for byte (exit 1 when stale). Exit codes: 0 ok,
// 1 a reconciliation failed or the snapshot is stale, 2 an input is missing, 3 usage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const G = createRequire(import.meta.url)(path.join(here, 'guide.js'));
const OUT = path.join(here, 'snapshots', 'bins.data.js');

const HELP = `Near Field Guide derivation.

Usage: node ideas/28-near-field-guide/build-data.mjs [--aster DIR] [--write | --check | --json]

  --aster DIR  Aster checkout to read (default /home/user/asteroid-mining-planner)
  --write      rebuild snapshots/bins.data.js
  --check      re-derive and compare with snapshots/bins.data.js byte for byte (exit 1 if stale)
  --json       print the derived data object as JSON
  (no mode)    print a text summary: totals, null census, reconciliations, findings
  --help       this text

Exit codes: 0 ok; 1 a reconciliation failed or the snapshot is stale; 2 an input is missing; 3 usage.`;

function parseArgs(argv) {
  const o = { aster: '/home/user/asteroid-mining-planner', mode: 'print' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.mode = 'help';
    else if (a === '--aster') {
      o.aster = argv[++i];
      if (!o.aster) usage('--aster needs a directory');
    } else if (a === '--write' || a === '--check' || a === '--json') {
      if (o.mode !== 'print') usage('choose one of --write, --check, --json');
      o.mode = a.slice(2);
    } else usage(`unknown option ${a}`);
  }
  return o;
}
function usage(msg) {
  console.error(`${msg}\n\n${HELP}`);
  process.exit(3);
}
function fail(msg) {
  console.error(`RECONCILIATION FAILED: ${msg}`);
  process.exit(1);
}

const INPUTS = {
  catalog: 'tests/fixtures/v2/nea-catalog-slice9.json',
  tiers: 'docs/tier-sizing-per-body.json',
  jupiter: 'tests/fixtures/v2/horizons-jupiter-system-90d.json',
};

function git(repo, args) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function readSource(repo, rel) {
  const file = path.join(repo, rel);
  if (!fs.existsSync(file)) {
    console.error(`missing input: ${file}`);
    process.exit(2);
  }
  return fs.readFileSync(file, 'utf8');
}

// Find the one line of a source file that matches a pattern; record path, 1-based line and text.
function lineOf(repo, rel, re, cache) {
  const text = cache[rel] || (cache[rel] = readSource(repo, rel));
  const lines = text.split('\n');
  const hits = [];
  lines.forEach((l, k) => re.test(l) && hits.push(k));
  if (hits.length !== 1) fail(`${rel}: expected one line matching ${re}, found ${hits.length}`);
  const k = hits[0];
  return { path: rel, line: k + 1, text: lines[k].replace(/\r$/, '').trim() };
}

function readConstants(repo) {
  const cache = {};
  const num = (q, re) => {
    const m = re.exec(q.text);
    if (!m) fail(`${q.path}:${q.line}: no number in "${q.text}"`);
    return Number(m[1].replace(/_/g, ''));
  };
  const c = {};
  const au = lineOf(repo, 'tools/slice18-research/tier-sizing.mjs', /^const AU_KM = /, cache);
  c.auKm = { value: num(au, /=\s*([\d_.]+);/), ...au };
  const jx = lineOf(repo, 'tools/slice18-research/tier-sizing.mjs', /^const JUPITER_PERIHELION_AU = /, cache);
  c.jupiterCrossingQ = { value: num(jx, /=\s*([\d.]+);/), ...jx };
  const nea = lineOf(repo, 'tools/slice18-research/tier-sizing.mjs', /^const NEA_CLASSES = /, cache);
  c.neaClasses = { value: JSON.parse(nea.text.replace(/^.*=\s*/, '').replace(/;$/, '').replace(/'/g, '"')), ...nea };
  const gs = lineOf(repo, 'src/v2/core/propagators/keplerian.ts', /^export const GM_SUN_M3_S2 = /, cache);
  c.gmSunKm3s2 = { value: num(gs, /=\s*([\d.e+]+);/) / 1e9, ...gs, note: 'GM_SUN_M3_S2 / 1e9' };
  const gj = lineOf(repo, 'tools/slice18-research/dv-scope.mjs', /^const GM = \{.*Jupiter:/, cache);
  c.gmJupiterKm3s2 = { value: num(gj, /Jupiter:\s*([\d.]+)/), ...gj };
  const ob = lineOf(repo, 'src/v2/core/units.ts', /J2000_ECLIPTIC_OBLIQUITY_RAD = /, cache);
  const as = lineOf(repo, 'src/v2/core/units.ts', /ARCSECONDS_TO_RADIANS = Math\.PI \/ \(180 \* 3600\)/, cache);
  c.obliquityRad = { value: num(ob, /=\s*([\d.]+)\s*\*/) * (Math.PI / (180 * 3600)), arcsec: num(ob, /=\s*([\d.]+)\s*\*/), ...ob, also: `${as.path}:${as.line}` };
  const al = lineOf(repo, 'src/v2/core/constants/asteroids.ts', /^export const ASTEROID_DEFAULT_ALBEDO = /, cache);
  c.albedo = { value: num(al, /=\s*([\d.]+);/), ...al };
  const dk = lineOf(repo, 'src/v2/core/constants/asteroids.ts', /return \(1329 \/ Math\.sqrt\(albedo\)\)/, cache);
  const rk = lineOf(repo, 'src/v2/core/constants/asteroids.ts', /deriveAsteroidDiameterKmFromAbsoluteMagnitude\(absoluteMagnitude, albedo\) \* 500/, cache);
  c.radiusFormula = { diamKm: num(dk, /\((\d+) \//), kmToRadiusM: num(rk, /\* (\d+);/), diameterLine: dk, radiusLine: rk };
  c.bands = {
    value: [0.1, 0.2, 0.3].map((t) => {
      const q = lineOf(repo, 'src/v2/core/constants/asteroids.ts', new RegExp(`if \\(eccentricity < ${t}\\)`), cache);
      return num(q, /< ([\d.]+)\)/);
    }),
    lines: [0.1, 0.2, 0.3].map((t) => lineOf(repo, 'src/v2/core/constants/asteroids.ts', new RegExp(`if \\(eccentricity < ${t}\\)`), cache)),
  };
  const ieo = lineOf(repo, 'src/physics/catalog/normalizers.ts', /if \(Q < [\d.]+\) astClass = 'IEO'/, cache);
  const ate = lineOf(repo, 'src/physics/catalog/normalizers.ts', /else if \(a < [\d.]+\) astClass = 'ATE'/, cache);
  const apo = lineOf(repo, 'src/physics/catalog/normalizers.ts', /else if \(q < [\d.]+\) astClass = 'APO'/, cache);
  c.classRule = { value: { ieoQ: num(ieo, /Q < ([\d.]+)/), ateA: num(ate, /a < ([\d.]+)/), apoQ: num(apo, /q < ([\d.]+)/) }, lines: [ieo, ate, apo] };
  const tail = lineOf(repo, 'tests/fixtures/v2/nea-catalog-slice9.spec.md', /anomaly-tail \/ cometary \(`orbitClass` in/, cache);
  c.tailClasses = { value: /\{([A-Z, ]+)\}/.exec(tail.text)[1].split(/,\s*/), ...tail };
  // The NEO perihelion bound is no constant in Aster's code; its one appearance is a quoted
  // literature note, so it is read from there and labelled as such wherever it is used.
  const neo = lineOf(repo, 'tools/slice17-research/literature/S17_Q2_PRESENTATION_RESULT.md', /NEO perihelion threshold quoted in the 2026 low-energy round-trip paper/, cache);
  c.neoQ = { value: num(neo, /“([\d.]+) au”/), ...neo };
  return c;
}

// Passages the page quotes, each found by a unique pattern and recorded with its line.
function readQuotes(repo) {
  const cache = {};
  const Q = (rel, re) => lineOf(repo, rel, re, cache);
  return {
    gNull: Q('tests/fixtures/v2/nea-catalog-slice9.spec.md', /^- `G` is `null` in Slice 9/),
    radiusNull: Q('tests/fixtures/v2/nea-catalog-slice9.spec.md', /^- `estimatedRadiusM` must be `null` when `H` is `null`/),
    qualityNull: Q('tests/fixtures/v2/nea-catalog-slice9.spec.md', /^- Quality fields may be `null`/),
    planningReserved: Q('tests/fixtures/v2/nea-catalog-slice9.spec.md', /reserved product\/policy label for Slice 10/),
    planningZero: Q('tests/fixtures/v2/nea-catalog-slice9.spec.md', /distribution is expected to remain `0`/),
    k3Rotation: Q('strategy/IDEA_KERNELS_2026-09.md', /committed catalog carries \*\*no rotation-period field at all\*\*/),
    k3Pull: Q('strategy/IDEA_KERNELS_2026-09.md', /Coverage is \*\*zero without a new SBDB pull\*\*/),
    prospect: Q('strategy/ASTER_FAMILY_MASTER_PLAN.md', /^\| L2 \| \*\*Aster Prospect\*\*/),
    dec182: Q('src/v2/SLICE_18_FOUNDING.md', /^Condition code renders as its raw MPC category and is NEVER converted to kilometres/),
    s18Blind: Q('src/v2/SLICE_18_FOUNDING.md', /^- \*\*Structurally blind = 688\*\*/),
    s18L0: Q('src/v2/SLICE_18_FOUNDING.md', /^- \*\*L0 = 11\*\* — unchanged\./),
    s18L1: Q('src/v2/SLICE_18_FOUNDING.md', /^- \*\*L1 = 10,150\*\* — was 10,152\./),
    s18L2: Q('src/v2/SLICE_18_FOUNDING.md', /^- \*\*L2 = 31,745\*\* — was 31,743\./),
    s18L1Cite: Q('src/v2/SLICE_18_FOUNDING.md', /The full statement is "L1 = 10,150 at 10⁶ km against the 2026-09-11 snapshot"/),
    statusComets: Q('STATUS.md', /^- 26 of the 206 structurally-blind comets have Q < 4\.95 AU/),
    jupiterCrossingDef: Q('tools/slice18-research/tier-sizing.mjs', /Jupiter-crossing threshold: Q >= 4\.95 AU/),
    nonExistentRule: Q('tools/slice18-research/tier-sizing.mjs', /const nonExistent = \(b\.anchorSource === 'stale-unanchored'/),
    neoBound: Q('tools/slice17-research/literature/S17_Q2_PRESENTATION_RESULT.md', /NEO perihelion threshold quoted in the 2026 low-energy round-trip paper/),
    prereportCount: Q('tools/slice9-research/SLICE_9_PRERESEARCH_REPORT.md', /^- NEA count: `41,902`/),
    a2bTc3: Q('tools/slice9-diagnostic/SLICE_9_A2B_DERIVED_FIELDS_DIAGNOSTIC.md', /^- `2008 TC3`: stored `D` but re-anchored/),
    reanchorNoRecompute: Q('tools/slice9-diagnostic/SLICE_9_A2B_DERIVED_FIELDS_DIAGNOSTIC.md', /^- `tools\/slice9-ingestion\/reanchor-stale-subset\.mjs:265-283` \(`applyReanchor\(\.\.\.\)`\) replaces:/),
    catalogFilter: Q('src/v2/app/catalog-list/panel.ts', /^const ORBIT_CLASSES: ReadonlyArray/),
    refusalCodes: Q('mcp/src/tools/envelope-schema.ts', /code: z\.enum\(\['insufficient_data', 'out_of_envelope', 'not_found'\]\)/),
  };
}

// The pre-research report's two quality tables (41,902 rows, an earlier SBDB pull).
function readPrereport(repo) {
  const rel = 'tools/slice9-research/SLICE_9_PRERESEARCH_REPORT.md';
  const lines = readSource(repo, rel).split('\n');
  const table = (heading) => {
    const h = lines.findIndex((l) => l.trim() === heading);
    if (h < 0) fail(`${rel}: no "${heading}"`);
    const rows = [];
    for (let k = h + 1; k < lines.length; k++) {
      const m = /^\|\s*`?([^|`]+?)`?\s*\|\s*([\d,]+)\s*\|\s*$/.exec(lines[k]);
      if (m) rows.push({ key: m[1].trim(), count: Number(m[2].replace(/,/g, '')), line: k + 1 });
      else if (rows.length && !/^\|\s*-/.test(lines[k])) break;
    }
    return { heading, headingLine: h + 1, rows };
  };
  return { path: rel, u: table('Condition-code histogram:'), arc: table('Data-arc histogram:') };
}

// The report's data-arc buckets, read as [0,7), [7,30), [30,100), [100,1000), [1000, inf): the
// left-closed reading is the one under which the committed fixture differs from the report by only
// non-negative counts (the right-closed reading gives -828 in 7-30d). Both are recorded.
const ARC_BUCKETS = [['<7d', 0, 7], ['7-30d', 7, 30], ['30-100d', 30, 100], ['100-1000d', 100, 1000], ['>1000d', 1000, Infinity]];

function jdToIso(jd) {
  const ms = (jd - 2440587.5) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function derive(repo) {
  const commit = git(repo, ['rev-parse', 'HEAD']);
  const commitDate = git(repo, ['log', '-1', '--format=%cI']);
  const inputs = [];
  const raw = {};
  for (const [k, rel] of Object.entries(INPUTS)) {
    const file = path.join(repo, rel);
    if (!fs.existsSync(file)) {
      console.error(`missing input: ${file}`);
      process.exit(2);
    }
    const buf = fs.readFileSync(file);
    raw[k] = JSON.parse(buf.toString('utf8'));
    inputs.push({ path: rel, bytes: buf.length, sha256: sha256(buf), committedBlob: git(repo, ['rev-parse', `HEAD:${rel}`]), readBlob: git(repo, ['hash-object', rel]) });
  }
  const C = readConstants(repo);
  const quotes = readQuotes(repo);
  const prereport = readPrereport(repo);

  // Jupiter: a_J by vis-viva from the first record (2026-05-01 TDB), mu = GM_sun + GM_Jupiter for
  // the two-body Sun-Jupiter relative orbit; GM_sun alone recorded beside it. Orbit pole in ecliptic.
  const recs = raw.jupiter.targets.jupiter.records;
  const toState = (rec) => ({ r: rec.slice(1, 4), v: rec.slice(4, 7) });
  const mu = C.gmSunKm3s2.value + C.gmJupiterKm3s2.value;
  const s0 = toState(recs[0]);
  const elJ = G.elementsFromState(s0.r, s0.v, mu, C.obliquityRad.value);
  const aJ = elJ.a / C.auKm.value;
  const aJSunOnly = G.visVivaA(s0.r, s0.v, C.gmSunKm3s2.value) / C.auKm.value;
  const aJAll = recs.map((rec) => G.visVivaA(rec.slice(1, 4), rec.slice(4, 7), mu) / C.auKm.value);
  const jupiter = {
    jdTdb: recs[0][0],
    date: jdToIso(recs[0][0]),
    center: raw.jupiter.targets.jupiter.center,
    frame: raw.jupiter.frame,
    aAu: aJ,
    aAuSunOnly: aJSunOnly,
    aAuRange90d: [Math.min(...aJAll), Math.max(...aJAll)],
    records: recs.length,
    e: elJ.e,
    inclEclDeg: (elJ.i * 180) / Math.PI,
    nodeEclDeg: (elJ.node * 180) / Math.PI,
    pole: elJ.pole,
  };

  const tierRecords = raw.tiers.records;
  const ctx = {
    auKm: C.auKm.value,
    aJAu: aJ,
    jupiterPole: elJ.pole,
    rule: C.classRule.value,
    bands: C.bands.value,
    fidelity: (b) => {
      const t = tierRecords[b.designation];
      if (!t) fail(`no Slice 18 tier record for ${b.designation}`);
      return t.tier;
    },
  };
  const ctxSunOnly = Object.assign({}, ctx, { aJAu: aJSunOnly });
  const ctxEcliptic = Object.assign({}, ctx, { jupiterPole: [0, 0, 1] });

  const atoms = new Map();
  const census = { present: {}, nulls: {} };
  const classDis = [];
  const qOver = [];
  const tjLow = [];
  const bandMismatch = [];
  let radiusMaxRel = 0;
  let radiusChecked = 0;
  let tjSunShift = 0;
  let tjSunCross3 = 0;
  let tjEclShift = 0;
  let tjEclCross3 = 0;
  const epochs = new Map();
  const NEA = new Set(C.neaClasses.value);
  const records = raw.catalog.asteroids;
  const ids = Object.keys(records);
  for (const id of ids) {
    const b = records[id];
    if (id !== `asteroid-${b.designation}`) fail(`record key ${id} does not match designation ${b.designation}`);
    const d = G.derive(b, ctx);
    const key = `${d.cls}|${d.tier}|${d.fid}`;
    if (!atoms.has(key)) atoms.set(key, G.newAtom({ cls: d.cls, tier: d.tier, fid: d.fid }));
    G.addBody(atoms.get(key), d, b);
    for (const [p, isNull] of G.nullPaths(b, '', [])) {
      census.present[p] = (census.present[p] || 0) + 1;
      if (isNull) census.nulls[p] = (census.nulls[p] || 0) + 1;
    }
    epochs.set(b.elements.epochTdbJd, (epochs.get(b.elements.epochTdbJd) || 0) + 1);
    if (d.bandFromE !== d.band) bandMismatch.push(b.designation);
    if (b.H !== null) {
      const r = G.radiusFromH(b.H, C.albedo.value, C.radiusFormula);
      radiusMaxRel = Math.max(radiusMaxRel, Math.abs(r - b.estimatedRadiusM) / b.estimatedRadiusM);
      radiusChecked++;
    } else if (b.estimatedRadiusM !== null) fail(`${b.designation}: H null but estimatedRadiusM ${b.estimatedRadiusM}`);
    const tjS = G.derive(b, ctxSunOnly).TJ;
    const tjE = G.derive(b, ctxEcliptic).TJ;
    tjSunShift = Math.max(tjSunShift, Math.abs(tjS - d.TJ));
    tjEclShift = Math.max(tjEclShift, Math.abs(tjE - d.TJ));
    if (tjS < 3 !== d.TJ < 3) tjSunCross3++;
    if (tjE < 3 !== d.TJ < 3) tjEclCross3++;
    if (NEA.has(d.cls)) {
      const Qv = d.aAu * (1 + d.e);
      if (d.classFromElements !== d.cls) {
        const margin = Math.min(Math.abs(Qv - C.classRule.value.ieoQ), Math.abs(d.aAu - C.classRule.value.ateA), Math.abs(d.q - C.classRule.value.apoQ));
        classDis.push({ des: b.designation, stored: d.cls, fromElements: d.classFromElements, a: d.aAu, q: d.q, Q: Qv, margin, anchor: b.anchorSource, fid: d.fid, epoch: b.elements.epochTdbJd });
      }
      if (d.TJ < 2) tjLow.push({ des: b.designation, cls: d.cls, TJ: d.TJ, a: d.aAu, e: d.e, i: d.i, fid: d.fid, tier: d.tier });
    }
    if (NEA.has(d.cls) && d.q >= C.neoQ.value) qOver.push({ des: b.designation, cls: d.cls, q: d.q, anchor: b.anchorSource });
  }

  // ---- reconciliations against the fixture's own header and the Slice 18 artifact ----
  const hdr = raw.catalog.catalog;
  const all = [...atoms.values()];
  const total = all.reduce((s, a) => s + a.n, 0);
  if (total !== ids.length || total !== hdr.totalBodies) fail(`total ${total} vs records ${ids.length} vs header ${hdr.totalBodies}`);
  for (const [cls, n] of Object.entries(hdr.classDistribution)) {
    const got = all.filter((a) => a.cls === cls).reduce((s, a) => s + a.n, 0);
    if (got !== n) fail(`class ${cls}: ${got} vs header ${n}`);
  }
  for (const [tier, n] of Object.entries(hdr.inv014TierDistribution)) {
    const got = all.filter((a) => a.tier === tier).reduce((s, a) => s + a.n, 0);
    if (got !== n) fail(`tier ${tier}: ${got} vs header ${n}`);
  }
  if ((census.nulls.H || 0) !== hdr.missingAbsoluteMagnitudeCount) fail(`H nulls ${census.nulls.H} vs header ${hdr.missingAbsoluteMagnitudeCount}`);
  const tailN = all.filter((a) => C.tailClasses.value.includes(a.cls)).reduce((s, a) => s + a.n, 0);
  if (tailN !== hdr.anomalyTailCount) fail(`anomaly tail ${tailN} vs header ${hdr.anomalyTailCount}`);
  for (const [t, n] of Object.entries(raw.tiers.populations)) {
    if (!/^L\d$/.test(t)) continue;
    const got = all.filter((a) => a.fid === t).reduce((s, a) => s + a.n, 0);
    if (got !== n) fail(`Slice 18 ${t}: ${got} vs artifact ${n}`);
  }
  if (Object.keys(tierRecords).length !== ids.length) fail(`tier artifact has ${Object.keys(tierRecords).length} records, catalog ${ids.length}`);
  if (bandMismatch.length) fail(`eccentricityBand from e disagrees for ${bandMismatch.length}: ${bandMismatch.slice(0, 5).join(', ')}`);
  for (const a of all) {
    for (const s of G.SPECS) if (G.sum(a.h[s.key]) !== a.n) fail(`${a.cls}|${a.tier}|${a.fid} ${s.key} sums to ${G.sum(a.h[s.key])}, not ${a.n}`);
  }

  // ---- the pre-research comparison, recounted on the committed fixture with the report's buckets ----
  const uOurs = {};
  const arcLeft = ARC_BUCKETS.map(() => 0);
  const arcRight = ARC_BUCKETS.map(() => 0);
  for (const id of ids) {
    const b = records[id];
    const u = b.conditionCode === null ? 'missing' : String(b.conditionCode);
    uOurs[u] = (uOurs[u] || 0) + 1;
    const arc = b.dataArcDays;
    if (arc === null) continue;
    arcLeft[ARC_BUCKETS.findIndex(([, lo, hi]) => arc >= lo && arc < hi)]++;
    arcRight[ARC_BUCKETS.findIndex(([, lo, hi], k) => (k === 0 ? arc <= hi : k === ARC_BUCKETS.length - 1 ? arc > lo : arc > lo && arc <= hi))]++;
  }
  const arcMissing = census.nulls.dataArcDays || 0;

  // ---- landmarks: records copied verbatim, plus their derived values ----
  const LANDMARKS = ['433', '101955', '99942', '163693', '152637', '1P', '3D', '2008 TC3', '2014 AA', '2015 D1', '2017 UR52'];
  const landmarks = LANDMARKS.map((des) => {
    const b = records[`asteroid-${des}`];
    if (!b) fail(`landmark ${des} not in catalog`);
    const d = G.derive(b, ctx);
    return { record: b, derived: { aAu: d.aAu, q: d.q, Q: d.Q, i: d.i, TJ: d.TJ, fid: d.fid, des: d.des, classFromElements: d.classFromElements, tierReason: tierRecords[des].subReason, tierClassification: tierRecords[des].classification } };
  });

  // ---- the screening cache entries of the re-anchored impact bodies (finding; no other cache data used) ----
  const otherEpochs = [...epochs.entries()].filter(([jd]) => jd !== jupiter.jdTdb);
  const epochSummary = {
    common: { jdTdb: jupiter.jdTdb, date: jdToIso(jupiter.jdTdb), n: epochs.get(jupiter.jdTdb) || 0 },
    others: { n: otherEpochs.reduce((s, [, n]) => s + n, 0), distinct: otherEpochs.length, minJd: Math.min(...otherEpochs.map(([jd]) => jd)), maxJd: Math.max(...otherEpochs.map(([jd]) => jd)) },
  };
  epochSummary.others.minDate = jdToIso(epochSummary.others.minJd);
  epochSummary.others.maxDate = jdToIso(epochSummary.others.maxJd);

  const anchorByClassDis = {};
  for (const r of classDis) anchorByClassDis[r.anchor] = (anchorByClassDis[r.anchor] || 0) + 1;

  // The fields Aster's own documents ask for, searched for among the catalog's key paths.
  const keyPaths = Object.keys(census.present).sort();
  const wanted = [
    { field: 'rotation period', re: 'rot|period|spin', askedBy: ['k3Rotation', 'k3Pull'], helps: 'k3Pull' },
    { field: 'taxonomy / spectral class', re: 'tax|spec', askedBy: ['prospect'], helps: 'prospect' },
    { field: 'albedo', re: 'albedo|^pv$|\\.pv$', askedBy: ['prospect'], helps: 'prospect' },
  ].map((w) => Object.assign(w, { found: keyPaths.filter((p) => new RegExp(w.re, 'i').test(p)) }));

  const repoUrl = git(repo, ['remote', 'get-url', 'origin']);
  return {
    schema: 'near-field-guide/1',
    specSignature: G.specSignature(),
    source: { repo: repoUrl, commit, commitDate, inputs },
    constants: C,
    jupiter,
    header: {
      selectionSource: raw.catalog.selectionSource,
      anchorSource: raw.catalog.anchorSource,
      frame: raw.catalog.frame,
      timeScale: raw.catalog.timeScale,
      units: raw.catalog.units,
      catalog: hdr,
    },
    epochs: epochSummary,
    atoms: all.map(G.packAtom),
    census: { keyPaths: keyPaths.map((p) => ({ path: p, present: census.present[p], nulls: census.nulls[p] || 0 })) },
    wanted,
    checks: {
      bandMismatches: bandMismatch.length,
      radiusChecked,
      radiusMaxRelErr: radiusMaxRel,
      tjSunOnlyMaxShift: tjSunShift,
      tjSunOnlyCross3: tjSunCross3,
      tjEclipticMaxShift: tjEclShift,
      tjEclipticCross3: tjEclCross3,
    },
    classCheck: {
      disagreements: classDis.sort((x, y) => y.margin - x.margin || x.des.localeCompare(y.des)),
      byAnchor: anchorByClassDis,
      qAtLeast13: qOver.sort((x, y) => y.q - x.q),
    },
    tjLow: tjLow.sort((x, y) => x.TJ - y.TJ),
    prereport: {
      path: prereport.path,
      u: prereport.u,
      arc: prereport.arc,
      ours: {
        u: uOurs,
        arcLeftClosed: ARC_BUCKETS.map(([k], i) => ({ key: k, count: arcLeft[i] })),
        arcRightClosed: ARC_BUCKETS.map(([k], i) => ({ key: k, count: arcRight[i] })),
        arcMissing,
      },
    },
    landmarks,
    quotes,
  };
}

function serialize(data) {
  const ins = data.source.inputs.map((i) => `${i.path} (sha256 ${i.sha256})`).join(',\n// ');
  return `// Generated by build-data.mjs --write from the Aster checkout. Do not edit.\n// Aster ${data.source.commit}: ${ins}.\n(function (root, factory) {\n  if (typeof module === 'object' && module.exports) module.exports = factory();\n  else root.NearFieldGuideData = factory();\n})(typeof self !== 'undefined' ? self : this, function () {\n  return ${JSON.stringify(data)};\n});\n`;
}

function summary(d) {
  const F = G.fmtInt;
  const lines = [];
  const S = G.summarize(d.atoms, {});
  lines.push(`Near Field Guide — Aster ${d.source.commit.slice(0, 7)} (${d.source.commitDate.slice(0, 10)}), ${d.source.inputs[0].path}`);
  lines.push(`  sha256 ${d.source.inputs[0].sha256}, ${F(d.source.inputs[0].bytes)} bytes, ${F(S.n)} records binned in ${d.atoms.length} atoms (orbitClass x inv014Tier x Slice 18 tier)`);
  lines.push(`  element epochs: ${F(d.epochs.common.n)} at ${d.epochs.common.date} TDB; ${F(d.epochs.others.n)} at ${d.epochs.others.distinct} other epochs, ${d.epochs.others.minDate} to ${d.epochs.others.maxDate}`);
  lines.push('');
  lines.push('Null census (every key path of every record):');
  for (const k of d.census.keyPaths) if (k.nulls) lines.push(`  ${k.path.padEnd(22)} ${F(k.nulls).padStart(6)} null of ${F(k.present)}`);
  lines.push(`  (${d.census.keyPaths.length} key paths, ${d.census.keyPaths.filter((k) => !k.nulls).length} never null; every record carries every path)`);
  for (const w of d.wanted) lines.push(`  asked for, not carried: ${w.field} (keys matching /${w.re}/i: ${w.found.length ? w.found.join(', ') : 'none'})`);
  lines.push('');
  lines.push('Reconciled with the fixture header: total, classDistribution, inv014TierDistribution, missingAbsoluteMagnitudeCount, anomalyTailCount; with the Slice 18 artifact: L0/L1/L2.');
  const sumBy = (dim, v) => G.summarize(d.atoms, { [dim]: v }).n;
  lines.push(`  classes: ${G.CATS[0].cats.map((c) => `${c} ${F(sumBy('cls', c))}`).join(', ')}`);
  lines.push(`  inv014Tier: ${G.CATS[1].cats.map((c) => `${c} ${F(sumBy('tier', c))}`).join(', ')}`);
  lines.push(`  Slice 18 tier: ${G.CATS[2].cats.map((c) => `${c} ${F(sumBy('fid', c))}`).join(', ')} (L1 at 10^6 km against the 2026-09-11 CAD snapshot)`);
  const qSpec = G.SPECS.find((s) => s.key === 'Q');
  const nea = d.constants.neaClasses.value;
  const neaL2 = G.summarize(d.atoms, { cls: nea, fid: 'L2' });
  const neaL1 = G.summarize(d.atoms, { cls: nea, fid: 'L1' });
  const tailL2 = G.summarize(d.atoms, { cls: d.constants.tailClasses.value, fid: 'L2' });
  const xq = d.constants.jupiterCrossingQ.value;
  lines.push(`  Q >= ${xq} AU among NEA-class L2 bodies: ${F(G.countAtOrAbove(qSpec, neaL2.h.Q, xq))} (L1: ${F(G.countAtOrAbove(qSpec, neaL1.h.Q, xq))}); comet-class L2 bodies ${F(tailL2.n)}, of which Q < ${xq} AU: ${F(G.countBelow(qSpec, tailL2.h.Q, xq))}`);
  lines.push('');
  lines.push(`Jupiter for T_J: a_J = ${d.jupiter.aAu.toFixed(4)} AU by vis-viva at ${d.jupiter.date} (mu = GM_sun + GM_Jupiter; GM_sun alone gives ${d.jupiter.aAuSunOnly.toFixed(4)}; over the 90-day file ${d.jupiter.aAuRange90d.map((x) => x.toFixed(4)).join('–')}); orbit inclined ${d.jupiter.inclEclDeg.toFixed(3)} deg to the ecliptic`);
  lines.push(`  T_J with GM_sun-only a_J moves by at most ${d.checks.tjSunOnlyMaxShift.toFixed(4)} (${d.checks.tjSunOnlyCross3} bodies cross 3); with ecliptic instead of Jupiter-plane inclination by ${d.checks.tjEclipticMaxShift.toFixed(4)} (${d.checks.tjEclipticCross3} cross 3)`);
  lines.push(`  NEA-class bodies with T_J < 2: ${d.tjLow.length}: ${d.tjLow.map((t) => `${t.des} ${t.TJ.toFixed(2)}`).join(', ')}`);
  lines.push('');
  lines.push(`Stored orbitClass vs Aster's class rule on the stored elements: ${d.classCheck.disagreements.length} disagree (${Object.entries(d.classCheck.byAnchor).map(([k, v]) => `${k} ${v}`).join(', ')}).`);
  for (const r of d.classCheck.disagreements.filter((x) => x.margin >= 0.1)) lines.push(`  ${r.des}: stored ${r.stored}, elements say ${r.fromElements} (a ${r.a.toFixed(3)}, q ${r.q.toFixed(3)}, Q ${r.Q.toFixed(3)} AU; ${r.margin.toFixed(3)} AU from the nearest class threshold; Slice 18 ${r.fid})`);
  lines.push(`  the other ${d.classCheck.disagreements.filter((x) => x.margin < 0.1).length} sit within 0.1 AU of a class threshold`);
  lines.push(`  NEA-class bodies with q >= 1.3 AU: ${d.classCheck.qAtLeast13.length}: ${d.classCheck.qAtLeast13.map((x) => `${x.des} ${x.q.toFixed(4)}`).join(', ')}`);
  lines.push('');
  lines.push(`Checks: eccentricityBand from e matches all records (${d.checks.bandMismatches} mismatches); estimatedRadiusM from H at albedo ${d.constants.albedo.value} matches ${F(d.checks.radiusChecked)} records to a relative ${d.checks.radiusMaxRelErr.toExponential(2)}.`);
  lines.push('');
  lines.push(`Pre-research report (${d.prereport.path}, 41,902 rows) vs the committed fixture:`);
  lines.push(`  U: ${d.prereport.u.rows.map((r) => `${r.key} ${d.prereport.ours.u[r.key] - r.count >= 0 ? '+' : ''}${d.prereport.ours.u[r.key] - r.count}`).join(', ')}`);
  lines.push(`  arc (left-closed): ${d.prereport.arc.rows.map((r) => { const o = r.key === 'missing' ? d.prereport.ours.arcMissing : d.prereport.ours.arcLeftClosed.find((x) => x.key === r.key).count; return `${r.key} ${o - r.count >= 0 ? '+' : ''}${o - r.count}`; }).join(', ')}`);
  return lines.join('\n');
}

const opts = parseArgs(process.argv.slice(2));
if (opts.mode === 'help') {
  console.log(HELP);
  process.exit(0);
}
if (!fs.existsSync(path.join(opts.aster, INPUTS.catalog))) {
  console.error(`refused: no Aster checkout at ${opts.aster} (need ${INPUTS.catalog}); pass --aster DIR`);
  process.exit(2);
}
const data = derive(opts.aster);
if (opts.mode === 'write') {
  fs.writeFileSync(OUT, serialize(data));
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`);
} else if (opts.mode === 'check') {
  const want = serialize(data);
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (want !== have) {
    console.error(`stale: ${path.relative(process.cwd(), OUT)} differs from a fresh derivation`);
    process.exit(1);
  }
  console.log('bins.data.js matches a fresh derivation byte for byte');
} else if (opts.mode === 'json') {
  console.log(JSON.stringify(data, null, 1));
} else {
  console.log(summary(data));
}
