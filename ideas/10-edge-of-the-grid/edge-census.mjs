#!/usr/bin/env node
// Edge of the Grid — command line. Reads Aster's Lambert screening cache (and, when present, the
// NEA catalog, the porkchop page source and the precompute script) from a checkout, runs the census
// in grid-census.js, prints a text report and optionally writes the derived JSON.
//
//   node ideas/10-edge-of-the-grid/edge-census.mjs [options]
//     --aster DIR        Aster checkout (default /home/user/asteroid-mining-planner)
//     --cache FILE       lambert-screen-cache.json (default <aster>/tests/fixtures/v2/lambert-screen-cache.json)
//     --catalog FILE     nea-catalog-slice9.json (default <aster>/tests/fixtures/v2/nea-catalog-slice9.json)
//     --no-catalog       skip the catalog join (class, H, synodic tables become refusals)
//     --view-source FILE porkchop page source whose GRID_PARAMS give the view's last departure
//                        (default <aster>/src/v2/app/porkchop/main.ts)
//     --precompute FILE  precompute script whose AU_KM the synodic periods use
//                        (default <aster>/tools/build/precompute-lambert-screen.mjs)
//     --json FILE        also write the full derived census as JSON
//     --help
//   Exit 0 on success, 1 when an input is missing, malformed or the census refuses, 2 on usage.
//
// Node built-ins only. Nothing is fetched; nothing in the checkout is written.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const G = createRequire(import.meta.url)(path.join(here, 'grid-census.js'));

// Bodies the report and the page's inspector show in full, chosen for what they demonstrate
// (hand-worked arithmetic, each edge, each verdict, one and five basins, the body with no windows).
export const SAMPLE = [
  { id: 'asteroid-433', why: 'Eros: the hand-worked column, row and basin arithmetic in the tests (Slice 18 re-solved its four neighbours)' },
  { id: 'asteroid-99942', why: 'Apophis: the porkchop page\'s compare body' },
  { id: 'asteroid-2020 FK3', why: 'the porkchop page\'s default body' },
  { id: 'asteroid-2015 D1', why: 'the one body with no stored windows (propagator_failed; hyperbolic in the catalog)' },
  { id: 'asteroid-163693', why: 'Atira: all five windows on the flight-time floor (Slice 17\'s F3 body; Slice 18 re-solved its neighbours)' },
  { id: 'asteroid-190166', why: 'first departure date, a stored chain of three: the quadratic vertex lies beyond the edge' },
  { id: 'asteroid-190491', why: 'first departure date, a stored chain of three: the quadratic vertex lies inside the lattice' },
  { id: 'asteroid-21088', why: 'first departure date, inward neighbour not stored: the rise is bounded below' },
  { id: 'asteroid-2368', why: 'last departure date, inward rise recorded' },
  { id: 'asteroid-66063', why: 'last departure date, inward rise bounded below' },
  { id: 'asteroid-2014 QV295', why: 'last departure date, a chain of three with no quadratic minimum on the inward side' },
  { id: 'asteroid-2004 RZ164', why: 'last departure date, the steepest recorded inward rise' },
  { id: 'asteroid-2006 KD40', why: 'touches two edges at once: first date and flight-time floor' },
  { id: 'asteroid-1999 XS35', why: 'flight-time ceiling, inward rise bounded below' },
  { id: 'asteroid-2017 UR52', why: 'flight-time ceiling, inward rise recorded (Slice 18 re-solved its neighbours)' },
  { id: 'asteroid-2021 UO20', why: 'the one floor body whose longer-flight neighbour is stored' },
  { id: 'asteroid-17274', why: 'flight-time floor: another stored window one row up, on the constant-arrival-date line' },
  { id: 'asteroid-1979 XB', why: 'interior minimum (Slice 18 re-solved its neighbours: all dearer than its fifth window)' },
  { id: 'asteroid-2059', why: 'all five windows in one basin' },
  { id: 'asteroid-1566', why: 'Icarus: five windows, five basins' },
];
export const SAMPLE_IDS = SAMPLE.map((s) => s.id);
// Basin rules reported beside the proposal's (2 columns, 1 row): two looser boxes and the same reach
// sheared along constant arrival dates (see grid-census.js sameBasin).
export const BASIN_RULES = [{ maxColGap: 4, maxRowGap: 2 }, { maxColGap: 8, maxRowGap: 2 }, { maxColGap: 2, maxRowGap: 1, arrival: true }];

function usage(code) {
  const text = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 18).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
  (code ? console.error : console.log)(text);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { aster: '/home/user/asteroid-mining-planner', cache: null, catalog: null, noCatalog: false, viewSource: null, precompute: null, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(2);
      return argv[++i];
    };
    if (a === '--help' || a === '-h') usage(0);
    else if (a === '--aster') o.aster = next();
    else if (a === '--cache') o.cache = next();
    else if (a === '--catalog') o.catalog = next();
    else if (a === '--no-catalog') o.noCatalog = true;
    else if (a === '--view-source') o.viewSource = next();
    else if (a === '--precompute') o.precompute = next();
    else if (a === '--json') o.json = next();
    else {
      console.error(`unknown argument: ${a}`);
      usage(2);
    }
  }
  o.cache ||= path.join(o.aster, 'tests', 'fixtures', 'v2', 'lambert-screen-cache.json');
  o.catalog ||= path.join(o.aster, 'tests', 'fixtures', 'v2', 'nea-catalog-slice9.json');
  o.viewSource ||= path.join(o.aster, 'src', 'v2', 'app', 'porkchop', 'main.ts');
  o.precompute ||= path.join(o.aster, 'tools', 'build', 'precompute-lambert-screen.mjs');
  return o;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function fail(msg) {
  console.error(`edge-census: ${msg}`);
  process.exit(1);
}
function readJson(file, what) {
  if (!fs.existsSync(file)) fail(`${what} not found: ${file}`);
  const bytes = fs.readFileSync(file);
  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    fail(`${what} is not JSON (${e.message}): ${file}`);
  }
  return { data, sha256: sha256(bytes), bytes: bytes.length };
}
function gitHead(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
const rel = (aster, file) => path.relative(aster, file).split(path.sep).join('/');

// The porkchop view's own grid, read from its source with its line numbers, so the "view ends
// 2040-01-01" figure is a measurement of the checkout, not a remembered date.
export function extractViewGrid(source, label) {
  const lines = source.split('\n');
  const find = (re) => {
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]);
      if (m) return { value: m[1], line: i + 1 };
    }
    return null;
  };
  const start = find(/depStartJD:\s*utcMidnightToJdTdb\('(\d{4}-\d{2}-\d{2})'\)/);
  const end = find(/depEndJD:\s*utcMidnightToJdTdb\('(\d{4}-\d{2}-\d{2})'\)/);
  const tofMin = find(/^\s*tofMinDays:\s*([\d.]+),/);
  const tofMax = find(/^\s*tofMaxDays:\s*([\d.]+),/);
  const nDep = find(/^\s*nDep:\s*(\d+),/);
  const nTof = find(/^\s*nTof:\s*(\d+),/);
  const spanLabel = find(/^const (PORKCHOP_DEPARTURE_SPAN_LABEL) = /);
  if (!start || !end) return G.refuse('not_found', `GRID_PARAMS.depStartJD/depEndJD not found in ${label}`, 'the porkchop page source with GRID_PARAMS as at Aster 62ddb17');
  return {
    source: label,
    depStartUtc: start.value,
    depEndUtc: end.value,
    tofMinDays: tofMin ? Number(tofMin.value) : null,
    tofMaxDays: tofMax ? Number(tofMax.value) : null,
    nDep: nDep ? Number(nDep.value) : null,
    nTof: nTof ? Number(nTof.value) : null,
    lines: { depStartJD: start.line, depEndJD: end.line, tofMinDays: tofMin && tofMin.line, tofMaxDays: tofMax && tofMax.line, nDep: nDep && nDep.line, nTof: nTof && nTof.line },
    spanLabelDerivedAtLine: spanLabel ? spanLabel.line : null,
  };
}

// How many windows the precompute keeps per body (its top-N insertion), with the line it is on: the
// lower bound on an unstored neighbour's rise rests on the list being the N cheapest cells.
export function extractTopN(source, label) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*if \(insertAt >= (\d+)\) \{?/.exec(lines[i]);
    if (m) return { value: Number(m[1]), source: label, line: i + 1 };
  }
  return G.refuse('not_found', `the best-window insertion bound (insertAt >= N) not found in ${label}`, 'the precompute script with maybeInsertBestWindow as at Aster 62ddb17');
}

export function extractAuKm(source, label) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^const AU_KM = ([\d_.]+);/.exec(lines[i]);
    if (m) return { value: Number(m[1].replace(/_/g, '')), source: label, line: i + 1 };
  }
  return G.refuse('not_found', `AU_KM not found in ${label}`, 'the precompute script with `const AU_KM = …`');
}

// ------------------------------------------------------------------ report
const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const f = G.fmtInt;
const num = (x, d) => (x === null || x === undefined ? 'n/a' : Number(x).toFixed(d));

const NR = 'not recorded';
const orNR = (x) => (x === null || x === undefined || x === '' ? NR : x);
const statText = (s, d = 3) => (s ? `median ${s.median.toFixed(d)}, n ${f(s.n)}, ${s.min.toFixed(d)}–${s.max.toFixed(d)}` : 'none');

export function report(c) {
  const L = c.lattice, V = c.verification, E = c.edges.byEdge;
  const md = (c.inputs && c.inputs.cache && c.inputs.cache.metadata) || {};
  const prov = md.provenance && typeof md.provenance === 'object' ? md.provenance : {};
  const out = [];
  const line = (s = '') => out.push(s);
  line('EDGE OF THE GRID — where Aster\'s screening minima land on the departure × flight-time lattice');
  line('='.repeat(96));
  line(`cache   ${c.inputs.cache.path}  sha256 ${c.inputs.cache.sha256.slice(0, 16)}…  generatedAt ${orNR(md.generatedAt)}`);
  line(`        solverCommit ${prov.solverCommit ? String(prov.solverCommit).slice(0, 12) : NR}  checkout HEAD ${c.inputs.commit ? c.inputs.commit.slice(0, 12) : 'n/a'}`);
  if (c.inputs.catalog) line(`catalog ${c.inputs.catalog.path}  sha256 ${c.inputs.catalog.sha256.slice(0, 16)}…  (${!prov.catalogFixtureSha256 ? 'the cache records no catalogFixtureSha256 to compare with' : c.inputs.catalog.sha256 === prov.catalogFixtureSha256 ? 'equals the cache\'s catalogFixtureSha256' : 'DIFFERS FROM the cache\'s catalogFixtureSha256'})`);
  else line('catalog not supplied: class, H, PHA and synodic tables are refusals');
  line();
  line('THE LATTICE (derived from metadata, nothing typed)');
  line(`  ${c.gridSentence}`);
  line(`  every window on the lattice: ${f(V.windowsChecked)} windows checked, ${f(V.violations)} off-lattice; ${f(V.distinctLaunchDates)} distinct launch dates (${V.everyColumnUsed ? 'every column is used' : 'NOT every column is used'}), ${f(V.distinctTofDays)} distinct flight times`);
  line(`  first/last departure seen ${orNR(V.firstDepartureSeen)} / ${orNR(V.lastDepartureSeen)}; flight times seen ${orNR(V.minTofSeen)}–${orNR(V.maxTofSeen)} days`);
  line(Number.isFinite(V.totalSolvesMetadata)
    ? `  totalSolves in metadata ${f(V.totalSolvesMetadata)} ${V.totalSolvesMatch ? '=' : '≠'} ${f(L.cellsPerBody)} cells × ${f(c.bodies.withWindows)} bodies with windows = ${f(V.totalSolvesFromLattice)}`
    : `  totalSolves ${NR} in metadata: cannot reconcile against ${f(L.cellsPerBody)} cells × ${f(c.bodies.withWindows)} bodies with windows`);
  line(`  bodies ${f(c.bodies.total)} (metadata.catalogSize ${Number.isFinite(V.catalogSizeMetadata) ? f(V.catalogSizeMetadata) : NR}): ${Object.entries(c.bodies.byStatus).map(([k, v]) => `${k} ${f(v)}`).join(', ')}; co-orbital flag ${f(c.bodies.coOrbital)}`);
  for (const b of c.bodies.withoutWindows) {
    const el = b.elements;
    line(`  no windows: ${b.bodyId} (${b.status})${el && Number.isFinite(el.e) ? `, catalog e ${el.e.toFixed(4)}${el.e >= 1 ? ' (hyperbolic)' : ''}, a ${Number.isFinite(el.aKm) ? el.aKm.toExponential(4) : NR} km, mean anomaly ${el.maRad === null ? 'null' : el.maRad}` : ''} — excluded from every count below`);
  }
  line(`  cheapest window not first ${V.cheapestIsFirstWindowViolations}; minC3 summary mismatches ${V.minC3SummaryMismatches}; not ascending ${V.windowsNotAscendingViolations}`);
  line(V.windowsKeptPerBody === null
    ? '  windows kept per body: not supplied (the precompute script was not read), so unstored neighbours are not bounded'
    : `  windows kept per body ${V.windowsKeptPerBody} (${c.inputs.windowsKept ? `${c.inputs.windowsKept.source} line ${c.inputs.windowsKept.line}` : 'supplied'}): ${f(V.bodiesWithFullList)} of ${f(c.bodies.withWindows)} bodies store that many`);
  line();
  line('MINIMA BY DEPARTURE YEAR (one per body; "all" counts every stored window)');
  line('  year   cols   minima   per col   all windows');
  for (const y of c.years) line(`  ${y.year}   ${String(y.cols).padStart(3)}   ${f(y.minima).padStart(6)}   ${y.minimaPerCol.toFixed(1).padStart(7)}   ${f(y.allWindows).padStart(8)}`);
  const I = c.interior;
  if (G.isRefusal(I)) line(`  interior baseline refused (${I.refusal.code}): ${I.refusal.reason}`);
  else {
    line(`  interior baseline (columns outside ${I.excludedYears.join(' and ')}): median ${num(I.medianPerCol, 1)} minima per column (mean ${num(I.meanPerCol, 1)}, range ${I.minPerCol}–${I.maxPerCol}); median interior year ${f(I.medianPerYear)}`);
    line(`  first column ${f(c.perColumn.minima[0])} (${num(I.firstColRatio, 1)}× the interior median), last column ${f(c.perColumn.minima[L.nCols - 1])} (${num(I.lastColRatio, 1)}×)`);
    line(`  first year ${num(I.firstYearRatio, 2)}× and last year ${num(I.lastYearRatio, 2)}× a median interior year (per column)`);
  }
  line();
  line('MINIMA ON THE EDGES (the body\'s cheapest stored window sits on the lattice boundary)');
  line('  edge                  cell                      minima   share   edge cells   per cell   edge line, then 1, 2, 3 lines in');
  for (const k of G.EDGE_KEYS) {
    const e = E[k];
    line(`  ${G.EDGE_NAMES[k].padEnd(21)} ${e.cell.padEnd(25)} ${f(e.touched).padStart(6)}  ${pct(e.shareOfBodies).padStart(6)}   ${String(e.cellsOnEdge).padStart(10)}   ${e.minimaPerEdgeCell.toFixed(2).padStart(8)}   ${e.inwardLines.map((x) => (x === null ? '–' : f(x))).join(' · ')}`);
  }
  line(`  any edge ${f(c.edges.any)} of ${f(c.bodies.withWindows)} bodies (${pct(c.edges.anyShare)}); ${c.edges.multiple} touch two edges at once`);
  line('  [Certain] counts. The edges differ in length (a departure edge has one cell per flight time, a flight-time edge one per date), so compare per edge cell and against the next line in:');
  line('  more minima on the edge than one line in is a pile-up; fewer is not. Whether an edge truncates minima is not shown by these counts [Speculative].');
  line();
  line('THE INWARD RISE (one lattice step in from each edge minimum, along its row or column)');
  line('  Every edge minimum is the cheapest solved cell of the whole lattice (the precompute keeps each body\'s cheapest cells), so the surface falls toward it by construction.');
  line('  recorded: the inward neighbour is among the stored windows; bound: it is not, so it cost at least the dearest stored window and the rise is at least the spread of the five');
  line('  (holds wherever that neighbour\'s Lambert solve converged; the cache does not record failed cells) [Likely]. Shallow rises are recorded, steep ones bounded: the split is not a ranking of evidence.');
  for (const k of G.EDGE_KEYS) {
    const e = E[k];
    line(`  ${G.EDGE_NAMES[k].padEnd(21)} recorded: ${statText(e.riseRecorded)}`);
    line(`  ${''.padEnd(21)} bound ≥:  ${statText(e.riseBound)}${e.riseNone ? `; neither for ${f(e.riseNone)}` : ''}`);
  }
  line(`  all edges: recorded ${statText(c.edges.riseRecorded)}; bounds ${statText(c.edges.riseBound)}`);
  line();
  const VX = c.edges.vertex;
  line(`STORED CHAINS OF THREE OR MORE RUNNING INWARD: ${c.edges.chains3plus} (rising at every step: ${G.EDGE_KEYS.map((k) => `${E[k].monotone3plus} of ${E[k].chains3plus} ${k}`).join(', ')})`);
  line('  Quadratic through the first three cells (x in lattice steps inward): vertex beyond the edge (x* < 0), inside the lattice within half a step (0 ≤ x* < 1/2), or none (straight or concave).');
  line(`  [Likely, under that local model] beyond ${VX.beyond}, inside ${VX.inside}, none ${VX.none}; by edge (beyond/inside/none): ${G.EDGE_KEYS.filter((k) => E[k].chains3plus).map((k) => `${k} ${E[k].vertex.beyond}/${E[k].vertex.inside}/${E[k].vertex.none}`).join(', ') || 'no chains'}`);
  line();
  for (const k of ['tofMin', 'tofMax']) {
    const a = E[k].arrivalLine;
    if (!a || !E[k].touched) continue;
    line(`${G.EDGE_NAMES[k].toUpperCase()}: THE CONSTANT-ARRIVAL-DATE LINE (${a.direction}, ${a.offsets[0]}–${a.offsets[1]} dates away; one row is ${a.columnsPerRow.toFixed(2)} dates)`);
    line(`  ${f(a.withWindow)} of ${f(E[k].touched)} store a window there${a.rise ? `, costing a median ${a.rise.median.toFixed(3)} km²/s² more than the edge minimum (${a.rise.min.toFixed(3)}–${a.rise.max.toFixed(3)})` : ''}; ${f(a.anyInwardRow)} store any window one row in`);
  }
  line();
  const A = c.interiorAlternative;
  line(`ANOTHER STORED WINDOW OFF THE EDGE, outside the minimum's basin (${f(A.ofEdgeBodies)} edge bodies)`);
  for (const r of A.byRule) line(`  ${G.describeRule(r.rule, L).padEnd(60)} ${f(r.withAlternative).padStart(6)} with${r.gapC3 ? ` (median +${r.gapC3.median.toFixed(3)} km²/s², ${r.gapC3.min.toFixed(4)}–${r.gapC3.max.toFixed(2)})` : ''}, ${f(r.without)} without`);
  line();
  if (G.isRefusal(c.viewTail)) line(`PORKCHOP VIEW TAIL — refused: ${c.viewTail.refusal.reason}`);
  else {
    const T = c.viewTail;
    line(`PORKCHOP VIEW TAIL (view's last departure ${T.depEndUtc}, from ${T.source.source} line ${T.source.lines.depEndJD}; the cache's is ${L.lastDepartureUtc})`);
    line(`  bodies whose cached minimum departs after ${T.depEndUtc}: ${f(T.minimaAfter)} (${pct(T.shareOfBodies)}); on it: ${T.minimaOn}; with any of five windows after it: ${f(T.anyWindowAfter)}`);
  }
  line();
  line('BASINS the stored windows span');
  for (const b of c.basins) line(`  ${G.describeRule(b.rule, L).padEnd(60)} ${[1, 2, 3, 4, 5].map((k) => `${k}: ${f(b.histogram[k]).padStart(6)}`).join('   ')}`);
  line();
  const table = (title, rows) => {
    line(title);
    if (G.isRefusal(rows)) {
      line(`  refused (${rows.refusal.code}): ${rows.refusal.reason}; what would help: ${rows.refusal.what_would_help}`);
      return;
    }
    line('  key                      n      edge    rate    floor   first   last   ceiling');
    for (const r of rows) line(`  ${r.key.padEnd(20)} ${f(r.n).padStart(7)}  ${f(r.any).padStart(6)}  ${pct(r.share).padStart(6)}  ${f(r.tofMin).padStart(6)}  ${f(r.first).padStart(6)}  ${f(r.last).padStart(5)}  ${f(r.tofMax).padStart(8)}`);
  };
  table('BY ORBIT CLASS (catalog orbitClass)', c.tables.byClass);
  line();
  table(`BY ABSOLUTE MAGNITUDE H (catalog; ${c.inputs.catalog && Number.isFinite(c.inputs.catalog.missingAbsoluteMagnitudeCount) ? `${f(c.inputs.catalog.missingAbsoluteMagnitudeCount)} bodies carry none` : 'missing-H count not recorded'})`, c.tables.byH);
  line();
  table(`BY SYNODIC PERIOD WITH EARTH (from catalog a, AU ${c.inputs.auKm ? `${c.inputs.auKm.value} km from ${c.inputs.auKm.source} line ${c.inputs.auKm.line}` : 'n/a'})`, c.tables.bySynodic);
  line();
  table('BY PHA FLAG', c.tables.byPha);
  line();
  table('BY THE CACHE\'S CO-ORBITAL FLAG', c.tables.byCoOrbital);
  line();
  line('SAMPLE BODIES (every number recomputable by hand from the stored windows)');
  for (const s of c.sample) {
    if (s.refusal) {
      line(`  ${s.bodyId} — ${s.why || ''}`);
      line(`      refused (${s.refusal.code}): ${s.refusal.reason}`);
      continue;
    }
    const ev = s.evidence;
    const verdicts = ev.edges.length ? ev.edges.map((e) => `${G.EDGE_NAMES[e.edge]}: ${G.describeRise(e)}`).join('; ') : 'interior minimum';
    line(`  ${s.bodyId}${s.name ? ` (${s.name})` : ''} — ${s.why || ''}`);
    line(`      ${s.orbitClass || '?'} H ${s.H === null ? 'missing' : s.H}; min C3 ${num(s.minC3, 4)} at col ${ev.cell.col} row ${ev.cell.row}; basins ${s.basins}; ${verdicts}`);
    for (const w of s.windows) line(`      ${w.launchDate}  TOF ${String(w.tofDays).padStart(4)}  C3 ${w.c3.toFixed(4).padStart(9)}  col ${String(w.col).padStart(3)} row ${String(w.row).padStart(2)}  basin ${w.basin}${w.edges.length ? `  edge: ${w.edges.join('+')}` : ''}`);
  }
  return out.join('\n') + '\n';
}

// JSON with one key per line but arrays of primitives on one line (the heatmap and per-column
// arrays would otherwise be one number per line); parses to exactly what JSON.stringify would give.
export function stringifyCompact(v, ind = '', step = ' ') {
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) return JSON.stringify(v);
    return `[\n${v.map((x) => ind + step + stringifyCompact(x, ind + step, step)).join(',\n')}\n${ind}]`;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!keys.length) return '{}';
    return `{\n${keys.map((k) => `${ind + step}${JSON.stringify(k)}: ${stringifyCompact(v[k], ind + step, step)}`).join(',\n')}\n${ind}}`;
  }
  return JSON.stringify(v);
}

// ------------------------------------------------------------------ main
function main() {
  const o = parseArgs(process.argv.slice(2));
  const cache = readJson(o.cache, 'cache');
  if (!cache.data || typeof cache.data !== 'object' || !cache.data.metadata || typeof cache.data.metadata !== 'object') fail('the cache has no metadata object; what would help: a lambert-screen-cache.json (schemaVersion 1) as written by precompute-lambert-screen.mjs');
  if (cache.data.metadata.schemaVersion !== 1) fail(`cache schemaVersion ${cache.data.metadata.schemaVersion} is not 1`);
  let catalog = null;
  if (!o.noCatalog) {
    if (!fs.existsSync(o.catalog)) fail(`catalog not found: ${o.catalog} (pass --no-catalog to run without it)`);
    catalog = readJson(o.catalog, 'catalog');
  }
  let viewGrid = null;
  if (fs.existsSync(o.viewSource) && fs.statSync(o.viewSource).isFile()) viewGrid = extractViewGrid(fs.readFileSync(o.viewSource, 'utf8'), rel(o.aster, o.viewSource));
  let auKm = null, topN = null;
  if (fs.existsSync(o.precompute) && fs.statSync(o.precompute).isFile()) {
    const pre = fs.readFileSync(o.precompute, 'utf8');
    auKm = extractAuKm(pre, rel(o.aster, o.precompute));
    topN = extractTopN(pre, rel(o.aster, o.precompute));
  }
  const inputs = {
    checkout: o.aster,
    commit: gitHead(o.aster),
    cache: { path: rel(o.aster, o.cache), sha256: cache.sha256, bytes: cache.bytes, metadata: cache.data.metadata },
    catalog: catalog
      ? { path: rel(o.aster, o.catalog), sha256: catalog.sha256, bytes: catalog.bytes, totalBodies: catalog.data.catalog && catalog.data.catalog.totalBodies, classDistribution: catalog.data.catalog && catalog.data.catalog.classDistribution, missingAbsoluteMagnitudeCount: catalog.data.catalog && catalog.data.catalog.missingAbsoluteMagnitudeCount, units: catalog.data.units || null, selectionSource: catalog.data.selectionSource || null }
      : null,
    viewGrid: viewGrid && !G.isRefusal(viewGrid) ? viewGrid : null,
    viewGridRefusal: viewGrid && G.isRefusal(viewGrid) ? viewGrid.refusal : null,
    auKm: auKm && !G.isRefusal(auKm) ? auKm : null,
    auKmRefusal: auKm && G.isRefusal(auKm) ? auKm.refusal : null,
    windowsKept: topN && !G.isRefusal(topN) ? topN : null,
    windowsKeptRefusal: topN && G.isRefusal(topN) ? topN.refusal : null,
  };
  const c = G.census(cache.data, catalog && catalog.data, {
    viewGrid: inputs.viewGrid,
    auKm: inputs.auKm ? inputs.auKm.value : null,
    topN: inputs.windowsKept ? inputs.windowsKept.value : null,
    sampleIds: SAMPLE_IDS,
    sampleWhy: Object.fromEntries(SAMPLE.map((x) => [x.id, x.why])),
    basinRules: BASIN_RULES,
    inputs,
  });
  if (G.isRefusal(c)) fail(`census refused (${c.refusal.code}): ${c.refusal.reason}; what would help: ${c.refusal.what_would_help}`);
  if (o.json) {
    fs.mkdirSync(path.dirname(o.json), { recursive: true });
    fs.writeFileSync(o.json, `${stringifyCompact(c)}\n`);
    console.error(`wrote ${o.json}`);
  }
  process.stdout.write(report(c));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
