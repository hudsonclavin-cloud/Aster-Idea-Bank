#!/usr/bin/env node
// Known Unknowns: Aster's catalog orbit quality (condition code U, data arc, observations used)
// crossed with the screening cache's minimum departure C3, read straight from an Aster checkout.
//
//   node ideas/17-known-unknowns/known-unknowns.mjs [--aster DIR]        the study, as text
//   ... --body "1979 XB"        one body: its row as an Aster-shaped evidence envelope, plus the
//                               observing-plan refusal (--json for the envelopes)
//   ... --sort H|c3 --top N     the list of low-C3, poorly determined bodies, re-selected from all of them
//   ... --u N --arc D           the what-if filter: low-C3 bodies with U <= N and a data arc >= D days
//   ... --json                  the whole derived study object as JSON
//   ... --write                 rewrite snapshots/study.data.js from the checkout
//   ... --check                 exit 1 if snapshots/study.data.js differs from a fresh derivation
//
// Exit codes: 0 ok; 1 a reconciliation failed or the snapshot is stale; 2 refused (body not
// found, or a value the study cannot give); 3 usage. Reads only; runs only read-only git commands.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const K = require('./model.js');
const DATA_FILE = path.join(here, 'snapshots', 'study.data.js');
const LIST_TOP = 200;

const P = {
  catalog: 'tests/fixtures/v2/nea-catalog-slice9.json',
  cache: 'tests/fixtures/v2/lambert-screen-cache.json',
  tiers: 'docs/tier-sizing-per-body.json',
  spec: 'tests/fixtures/v2/nea-catalog-slice9.spec.md',
  derived: 'tools/slice9-ingestion/derived-fields.mjs',
  builder: 'tools/slice9-ingestion/build-nea-catalog.mjs',
  nearZero: 'src/v2/core/constants/near-zero-c3.ts',
  tdb: 'src/v2/core/units/utc-to-tdb.ts',
  nearZeroUi: 'src/v2/porkchop/near-zero-c3.ts',
  colormap: 'src/v2/porkchop/colormap.ts',
  porkchopView: 'src/v2/porkchop/porkchop-view.ts',
  compare: 'src/v2/app/compare/main.ts',
  status: 'STATUS.md',
  slice17: 'SLICE_17_FOUNDING.md',
  slice18: 'src/v2/SLICE_18_FOUNDING.md',
  slice19: 'src/v2/SLICE_19_FOUNDING.md',
  cacheBoundary: 'src/v2/boundary/lambert-screen-cache.ts',
  support: 'src/v2/porkchop/support-boundary.ts',
  masterPlan: 'strategy/ASTER_FAMILY_MASTER_PLAN.md',
  envelope: 'mcp/src/tools/envelope-schema.ts',
  searchBodies: 'mcp/src/tools/search-bodies.ts',
  deltaV: 'src/v2/porkchop/delta-v.ts',
};

const HELP = `Known Unknowns: Aster catalog orbit quality crossed with screening C3.

Usage: node ideas/17-known-unknowns/known-unknowns.mjs [options]

  --aster DIR        Aster checkout to read (default /home/user/asteroid-mining-planner)
  --body DES         one body (designation, e.g. "1979 XB" or 433): its row and flags, and the
                     observing-plan refusal; exit 2 with a not_found refusal if it is not in the catalog
  --sort H|c3        rank the list by absolute magnitude (brightest first) or by minimum C3
  --top N            how many list rows to print (default 20)
  --u N --arc D      the what-if filter: U at most N (0-9), data arc at least D days (one of
                     ${K.OURS.arcEdgesDays.join(', ')})
  --json             print JSON instead of text (the whole study, or the --body envelopes)
  --write            rewrite snapshots/study.data.js from the checkout
  --check            exit 1 if snapshots/study.data.js differs from a fresh derivation
  -h, --help         this text

Exit codes: 0 ok, 1 reconciliation failed or snapshot stale, 2 refused, 3 usage.`;

function usage(msg) {
  if (msg) console.error(`known-unknowns: ${msg}`);
  console.error('Run with --help for usage.');
  process.exit(3);
}

function parseArgs(argv) {
  const o = { aster: '/home/user/asteroid-mining-planner', top: 20, sort: 'H' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '--aster') o.aster = next();
    else if (a === '--body') o.body = next();
    else if (a === '--sort') o.sort = next();
    else if (a === '--top') o.top = Number(next());
    else if (a === '--u') o.u = Number(next());
    else if (a === '--arc') o.arc = Number(next());
    else if (a === '--json') o.json = true;
    else if (a === '--write') o.write = true;
    else if (a === '--check') o.check = true;
    else usage(`unknown option ${a}`);
  }
  if (!['H', 'c3'].includes(o.sort)) usage('--sort must be H or c3');
  if (!Number.isInteger(o.top) || o.top < 1) usage('--top must be a positive integer');
  if ((o.u === undefined) !== (o.arc === undefined)) usage('--u and --arc go together');
  if (o.u !== undefined) {
    if (!Number.isInteger(o.u) || o.u < 0 || o.u > 9) usage('--u must be an integer 0..9');
    if (!K.OURS.arcEdgesDays.includes(o.arc)) usage(`--arc must be one of ${K.OURS.arcEdgesDays.join(', ')}`);
  }
  return o;
}

// ------------------------------------------------------------------ reading the checkout
function git(repo, args) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function makeReader(repo) {
  const cache = new Map();
  const head = git(repo, ['rev-parse', 'HEAD']);
  function bytes(rel) {
    if (!cache.has(rel)) {
      const abs = path.join(repo, rel);
      if (!fs.existsSync(abs)) throw new Error(`missing in the Aster checkout: ${rel}`);
      cache.set(rel, fs.readFileSync(abs));
    }
    return cache.get(rel);
  }
  function info(rel) {
    const b = bytes(rel);
    return {
      path: rel,
      commit: head,
      pathLastChanged: git(repo, ['log', '-1', '--format=%h %cs', '--', rel]),
      committedBlob: git(repo, ['rev-parse', `HEAD:${rel}`]),
      readBlob: git(repo, ['hash-object', rel]),
      sha256: crypto.createHash('sha256').update(b).digest('hex'),
      bytes: b.length,
    };
  }
  function lines(rel) {
    return bytes(rel).toString('utf8').split('\n');
  }
  // First line matching re (1-based) and the match; throws if absent so a moved constant fails loudly.
  function find(rel, re, from = 0) {
    const L = lines(rel);
    for (let i = from; i < L.length; i++) {
      const m = re.exec(L[i]);
      if (m) return { line: i + 1, m, text: L[i] };
    }
    throw new Error(`${rel}: no line matches ${re}`);
  }
  return { repo, head, bytes, info, lines, find, commitDate: git(repo, ['log', '-1', '--format=%cI']) };
}

const num = (s) => Number(s);
const loc = (rel, line, extra = {}) => ({ path: rel, line, ...extra });

function readConstants(R, meta) {
  const nz = R.find(P.nearZero, /export const NEAR_ZERO_C3_DEGENERACY_THRESHOLD_KM2_S2 = ([\d.]+);/);
  const cmin = R.find(P.colormap, /export const C3_COLOR_MIN = ([\d.]+);/);
  const levels = R.find(P.porkchopView, /const C3_CONTOUR_LEVELS/);
  const first = R.find(P.porkchopView, /\{ value: ([\d.]+),/, levels.line);
  const uHigh = R.find(P.compare, /if \(conditionCode >= (\d+)\) \{/);
  const uTight = R.find(P.compare, /if \(conditionCode <= (\d+)\) \{/);
  const tdb = R.find(P.tdb, /export const TDB_MINUS_UTC_SECONDS = ([\d.]+);/);
  const constants = {
    nearZeroC3: num(nz.m[1]),
    c3ColorMin: num(cmin.m[1]),
    c3FirstContour: num(first.m[1]),
    feasibleC3Max: meta.feasibleC3MaxKm2S2,
    uHighlyUncertainMin: num(uHigh.m[1]),
    uTightMax: num(uTight.m[1]),
    tdbMinusUtcSeconds: num(tdb.m[1]),
  };
  const sources = {
    nearZeroC3: loc(P.nearZero, nz.line),
    c3ColorMin: loc(P.colormap, cmin.line),
    c3FirstContour: loc(P.porkchopView, first.line),
    feasibleC3Max: loc(P.cache, null, { key: 'metadata.feasibleC3MaxKm2S2' }),
    uHighlyUncertainMin: loc(P.compare, uHigh.line),
    uTightMax: loc(P.compare, uTight.line),
    tdbMinusUtcSeconds: loc(P.tdb, tdb.line),
  };
  return { constants, sources };
}

// Verbatim sentences the page quotes, each with its file and line(s).
function readQuotes(R) {
  const q = {};
  const caveat = R.find(P.status, /STRUCTURAL CAVEAT, recorded verbatim: (.*NOT that U is uninformative\.)/);
  q.slice18Caveat = { text: caveat.m[1], ...loc(P.status, caveat.line) };
  const answered = R.find(P.status, /\*\*(Q ANSWERED — condition code does NOT predict propagation error\.)\*\*/);
  q.slice18Answer = { text: answered.m[1], ...loc(P.status, answered.line) };
  const mpc = R.find(P.compare, /'MPC: "(The U value should not be used as a predictor[^"]*)"'/);
  q.mpcWarning = { text: mpc.m[1], ...loc(P.compare, mpc.line) };
  const k1 = R.find(P.slice17, /^\s*(U is ranking-penalty \+ visibility flag; never a kill switch; never)\s*$/);
  const k2 = R.lines(P.slice17)[k1.line].trim();
  q.dec174 = { text: `${k1.m[1]} ${k2}`, ...loc(P.slice17, k1.line, { lineEnd: k1.line + 1 }) };
  const jpl = R.find(P.compare, /label: '(orbit solution is highly uncertain[^']*)'/);
  q.jplLabel = { text: jpl.m[1], ...loc(P.compare, jpl.line) };
  const km = R.find(P.slice18, /^(Condition code renders as its raw MPC category and is NEVER converted to kilometres[^.]*\.)/);
  q.dec182 = { text: km.m[1], ...loc(P.slice18, km.line) };
  const imp = R.find(P.cacheBoundary, /\* (IMPORTANT: low_departure_c3 is a departure-energy screen ONLY\. It does NOT mean)$/);
  const L = R.lines(P.cacheBoundary);
  const rest = [1, 2, 3].map((d) => L[imp.line - 1 + d].replace(/^\s*\*\s?/, '').trim());
  q.lowC3Meaning = { text: [imp.m[1], ...rest].join(' '), ...loc(P.cacheBoundary, imp.line, { lineEnd: imp.line + 3 }) };
  const s1 = R.find(P.support, /`Arrival is after this object's \$\{boundary\.encounterDateLabel\} encounter\. ` \+$/);
  const s2 = R.find(P.support, /'(This cell is computed from an orbit that encounter invalidates\.)'/, s1.line);
  q.unsupported = { template: "Arrival is after this object's {date} encounter. " + s2.m[1], ...loc(P.support, s1.line, { lineEnd: s2.line }) };
  const badge = R.find(P.nearZeroUi, /export const NEAR_ZERO_C3_BADGE_TEXT = '([^']+)';/);
  q.nearZeroBadge = { text: badge.m[1], ...loc(P.nearZeroUi, badge.line) };
  const hidden = R.find(P.nearZeroUi, /return `(near-zero-C3 window hidden) \(\$\{count\}\)`;/);
  q.nearZeroHidden = { template: `${hidden.m[1]} ({count})`, ...loc(P.nearZeroUi, hidden.line) };
  const keep = R.find(P.slice19, /^3\. (Degenerate windows REMAIN in all data and all displays, with their real)$/);
  q.dec191 = { text: `${keep.m[1]} ${R.lines(P.slice19)[keep.line].trim()}`, ...loc(P.slice19, keep.line, { lineEnd: keep.line + 1 }) };
  const survey = R.find(P.masterPlan, /\| L5 \| \*\*Aster Survey\*\* \| ([^|]+) \|/);
  q.surveyQuestion = { text: survey.m[1].trim(), ...loc(P.masterPlan, survey.line) };
  const loop = R.find(P.masterPlan, /(Survey closes the loop: it turns `what_would_help` into observation campaign plans\.)/);
  q.surveyLoop = { text: loop.m[1], ...loc(P.masterPlan, loop.line) };
  const plan = R.find(P.spec, /^(The fixture does \*\*not\*\* numerically assign the future `planning-tier`\.)$/);
  q.planningTier = { text: plan.m[1].replace(/\*\*/g, ''), ...loc(P.spec, plan.line) };
  const rv = R.find(P.deltaV, /^export function rendezvousDvFromVInf\((\w+): number\): number \{$/);
  const rvBody = R.lines(P.deltaV)[rv.line].trim();
  if (rvBody !== `return ${rv.m[1]};`) throw new Error(`${P.deltaV}:${rv.line + 1}: rendezvous burn is no longer the arrival v-infinity`);
  q.rendezvousIsVInfArr = { text: `${rv.text.trim()} ${rvBody}`, meaning: 'the rendezvous burn is the arrival v-infinity', ...loc(P.deltaV, rv.line, { lineEnd: rv.line + 1 }) };
  const refusal = R.find(P.envelope, /code: z\.enum\(\[([^\]]+)\]\)/);
  q.refusalCodes = { codes: refusal.m[1].split(',').map((s) => s.trim().replace(/'/g, '')), ...loc(P.envelope, refusal.line) };
  const filters = R.find(P.searchBodies, /^const searchBodiesInputSchema = z\.object\(\{$/);
  const fields = [];
  const SL = R.lines(P.searchBodies);
  for (let i = filters.line; i < SL.length && !/^\}\);/.test(SL[i]); i++) {
    const m = /^\s+(\w+):/.exec(SL[i]);
    if (m) fields.push(m[1]);
  }
  q.searchBodiesInputs = { fields, ...loc(P.searchBodies, filters.line + 1, { lineEnd: filters.line + fields.length }) };
  return q;
}

// qualityRank formula, as the spec and the fixture each state it.
function readFormulas(R, catalogHeader) {
  const s = R.find(P.spec, /^conditionScore = /);
  const L = R.lines(P.spec);
  const specLines = [L[s.line - 1], L[s.line], L[s.line + 1]].map((x) => x.replace(/\s+/g, ' ').trim());
  const b = R.find(P.builder, /^\s+'(qualityRank = clamp01\(.*\))';$/);
  const d = R.find(P.derived, /^export function qualityRankForRecord\(record\) \{$/);
  return {
    spec: { lines: specLines, ...loc(P.spec, s.line, { lineEnd: s.line + 2 }) },
    fixtureString: { text: catalogHeader.catalog.qualityRankFormula, path: P.catalog, key: 'catalog.qualityRankFormula' },
    builderString: { text: b.m[1], ...loc(P.builder, b.line) },
    implementation: loc(P.derived, d.line),
  };
}

// 'YYYY-Mon-DD hh:mm' (CAD `cd`) -> 'YYYY-MM-DD', the same reading as Aster's formatDisclosureDate.
const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
function cadDate(cd) {
  const m = /^(\d{4})-([A-Za-z]{3})-(\d{2})\b/.exec(String(cd || '').trim());
  return m && MONTHS[m[2].toUpperCase()] ? `${m[1]}-${MONTHS[m[2].toUpperCase()]}-${m[3]}` : null;
}

// ------------------------------------------------------------------ the derivation
function derive(asterDir) {
  const R = makeReader(asterDir);
  if (!R.head) throw new Error(`not a git checkout: ${asterDir}`);
  const failures = [];
  const t0 = Date.now();
  const catalog = JSON.parse(R.bytes(P.catalog).toString('utf8'));
  const cache = JSON.parse(R.bytes(P.cache).toString('utf8'));
  const tiers = JSON.parse(R.bytes(P.tiers).toString('utf8'));
  const { asteroids, ...catalogHeader } = catalog;
  const meta = cache.metadata;

  const inputs = { catalog: R.info(P.catalog), cache: R.info(P.cache), tiers: R.info(P.tiers) };
  inputs.cacheBuiltFromThisCatalog = meta.provenance.catalogFixtureSha256 === inputs.catalog.sha256;
  if (!inputs.cacheBuiltFromThisCatalog) failures.push('the cache records a different catalog sha256 than the catalog read');
  for (const k of ['catalog', 'cache', 'tiers']) if (inputs[k].committedBlob !== inputs[k].readBlob) failures.push(`${inputs[k].path}: read bytes differ from the committed blob`);
  const asOf = (R.commitDate || '').slice(0, 10);

  const { constants, sources } = readConstants(R, meta);
  const quotes = readQuotes(R);
  const formulas = readFormulas(R, catalogHeader);
  const lat = K.lattice(meta);

  // Join catalog -> cache by bodyId, catalog -> tier artifact by designation.
  const screen = new Map();
  for (const k of Object.keys(cache.bodies)) screen.set(cache.bodies[k].bodyId, cache.bodies[k]);
  const rows = [];
  const status = {};
  const tierCounts = {};
  let coOrbital = 0;
  let missingScreen = 0;
  let missingTier = 0;
  let statusMismatch = 0;
  let minC3Mismatch = 0;
  const audit = { n: 0, maxAbsSpecMinusStored: 0, overTolerance: 0, literalDisagrees: 0, maxAbsLiteralMinusStored: 0, literalExamples: [] };
  for (const bodyId of Object.keys(asteroids)) {
    const a = asteroids[bodyId];
    const s = screen.get(bodyId);
    const t = tiers.records[a.designation];
    if (!s) {
      missingScreen++;
      continue;
    }
    if (!t) missingTier++;
    status[s.status] = (status[s.status] || 0) + 1;
    if (s.isCoOrbital) coOrbital++;
    if (t) tierCounts[t.tier] = (tierCounts[t.tier] || 0) + 1;
    const band = K.c3Band(s.minC3, constants);
    const expect = band <= 3 ? 'low_departure_c3' : band === K.C3_HIGH ? 'high_departure_c3' : null;
    if ((expect && s.status !== expect) || (!expect && ['low_departure_c3', 'high_departure_c3'].includes(s.status))) statusMismatch++;
    const w = s.bestWindows[0] || null;
    if (w && (w.c3 !== s.minC3 || w.launchDate !== s.minC3Date || w.tofDays !== s.minC3TofDays)) minC3Mismatch++;
    // qualityRank audit
    const spec = K.qualityRankSpec(a.conditionCode, a.dataArcDays);
    const lit = K.qualityRankLiteral(a.conditionCode, a.dataArcDays);
    const dS = Math.abs(spec - a.qualityRank);
    const dL = Math.abs(lit - a.qualityRank);
    audit.n++;
    audit.maxAbsSpecMinusStored = Math.max(audit.maxAbsSpecMinusStored, dS);
    if (dS > 1e-6) audit.overTolerance++;
    if (dL > 1e-6) {
      audit.literalDisagrees++;
      if (dL > audit.maxAbsLiteralMinusStored) {
        audit.maxAbsLiteralMinusStored = dL;
        audit.worstLiteral = { designation: a.designation, u: a.conditionCode, arc: a.dataArcDays, stored: a.qualityRank, spec, literal: lit };
      }
    }
    rows.push({
      des: a.designation,
      name: a.name && a.name !== `(${a.designation})` ? a.name : null,
      cls: a.orbitClass,
      H: a.H,
      u: a.conditionCode,
      arc: a.dataArcDays,
      nObs: a.nObsUsed,
      c3: s.minC3,
      launchDate: w ? w.launchDate : null,
      tofDays: w ? w.tofDays : null,
      vInfArr: w ? w.vInfArr : null,
      tier: t ? t.tier : null,
      subReason: t ? t.subReason : null,
      encJd: t && t.tier === 'L1' && t.encounter ? t.encounter.jd : null,
      encDate: t && t.tier === 'L1' && t.encounter ? cadDate(t.encounter.cd) : null,
      coOrbital: !!s.isCoOrbital,
      pha: !!a.pha,
      keplerUnsafe: a.inv014Tier === 'not-kepler-safe',
    });
  }
  if (missingScreen) failures.push(`${missingScreen} catalog bodies have no cache record`);
  if (missingTier) failures.push(`${missingTier} catalog bodies have no tier record`);
  if (statusMismatch) failures.push(`${statusMismatch} bodies: C3 band disagrees with the cache status`);
  if (minC3Mismatch) failures.push(`${minC3Mismatch} bodies: minC3 is not bestWindows[0]`);
  if (audit.overTolerance) failures.push(`${audit.overTolerance} bodies: stored qualityRank differs from the spec formula by more than 1e-6`);
  if (rows.length !== catalogHeader.catalog.totalBodies) failures.push(`joined ${rows.length} bodies, catalog says ${catalogHeader.catalog.totalBodies}`);

  // Histograms and the headline numbers.
  const hists = K.buildHistograms(rows, constants);
  const arcs = rows.filter((r) => r.arc !== null).map((r) => r.arc);
  const uMarg = K.uMarginal(hists.byArc);
  const headline = {
    bodies: rows.length,
    uDistribution: Object.fromEntries(uMarg.map((n, i) => [i === K.U_NULL ? 'null' : String(i), n])),
    uHighlyUncertain: uMarg.slice(constants.uHighlyUncertainMin, 10).reduce((x, y) => x + y, 0),
    arcReported: arcs.length,
    arcMedianDays: K.median(arcs),
    status,
    coOrbital,
    tierCounts,
    tierPopulations: tiers.populations,
  };

  // Edge census of every body's cheapest window (for the cross-check with idea 10).
  const edgeCounts = { floor: 0, ceiling: 0, first: 0, last: 0, any: 0, withWindow: 0 };
  // How close any L1 min-window arrival comes to its encounter, and how many flags the TDB offset decides.
  const encounter = { l1WithWindow: 0, after: 0, minMarginSeconds: Infinity, closest: null, decidedByTdbOffset: [] };
  const noOffset = { ...constants, tdbMinusUtcSeconds: 0 };
  for (const r of rows) {
    if (!r.launchDate) continue;
    edgeCounts.withWindow++;
    const e = K.edgesOf(r.launchDate, r.tofDays, lat);
    for (const k of e) edgeCounts[k]++;
    if (e.length) edgeCounts.any++;
    if (r.encJd !== null) {
      encounter.l1WithWindow++;
      const withOff = K.arrivalAfterEncounter(r.launchDate, r.tofDays, r.encJd, constants);
      if (withOff) encounter.after++;
      const margin = (K.jdFromIsoDate(r.launchDate) + constants.tdbMinusUtcSeconds / 86400 + r.tofDays - r.encJd) * 86400;
      if (Math.abs(margin) < Math.abs(encounter.minMarginSeconds)) {
        encounter.minMarginSeconds = margin;
        encounter.closest = { designation: r.des, launchDate: r.launchDate, tofDays: r.tofDays, encounterDate: r.encDate, encounterJd: r.encJd };
      }
      if (withOff !== K.arrivalAfterEncounter(r.launchDate, r.tofDays, r.encJd, noOffset)) encounter.decidedByTdbOffset.push(r.des);
    }
  }

  // The list: every low-C3 body with U >= the JPL threshold and a short or unreported arc.
  const candidates = rows.filter((r) => K.inList(r, constants));
  const listCount = K.listCountFromHist(hists.byArc, constants);
  if (candidates.length !== listCount) failures.push(`list has ${candidates.length} rows, the histogram says ${listCount}`);
  const flagTotals = { nearZero: 0, past: 0, edge: 0, afterEncounter: 0, coOrbital: 0, pha: 0, keplerUnsafe: 0, hUnknown: 0, arcUnknown: 0 };
  const listTiers = {};
  for (const r of candidates) {
    const f = K.flagsFor(r, constants, lat, asOf);
    if (f.nearZero) flagTotals.nearZero++;
    if (f.past) flagTotals.past++;
    if (f.edges.length) flagTotals.edge++;
    if (f.afterEncounter) flagTotals.afterEncounter++;
    if (f.coOrbital) flagTotals.coOrbital++;
    if (f.pha) flagTotals.pha++;
    if (f.keplerUnsafe) flagTotals.keplerUnsafe++;
    if (r.H === null) flagTotals.hUnknown++;
    if (r.arc === null) flagTotals.arcUnknown++;
    listTiers[r.tier] = (listTiers[r.tier] || 0) + 1;
  }
  const byH = candidates.slice().sort(K.SORTS.H);
  const byC3 = candidates.slice().sort(K.SORTS.c3);
  const firstNotNearZero = byC3.findIndex((r) => !(r.c3 < constants.nearZeroC3));
  const topH = byH.slice(0, LIST_TOP);
  const topC3 = byC3.slice(0, LIST_TOP);
  const shipped = new Map();
  for (const r of [...topH, ...topC3]) shipped.set(r.des, r);
  const shippedRows = [...shipped.values()].sort((x, y) => (x.des < y.des ? -1 : 1));
  const indexOf = new Map(shippedRows.map((r, i) => [r.des, i]));

  const strat = K.stratify(rows, constants);

  const ref = (des) => rows.find((r) => r.des === des) || null;
  const study = {
    schema: 'known-unknowns/1',
    aster: { repo: git(asterDir, ['remote', 'get-url', 'origin']), commit: R.head, commitDate: R.commitDate, asOf },
    inputs,
    metadata: meta,
    catalogHeader,
    lattice: lat,
    constants,
    constantSources: sources,
    ours: K.OURS,
    quotes,
    formulas,
    headline,
    hists,
    stratified: strat,
    qualityAudit: audit,
    edgeCounts,
    encounter,
    list: {
      criterion: { uMin: constants.uHighlyUncertainMin, arcBelowDays: K.OURS.listArcBelowDays, arcUnreportedIncluded: true, c3: 'low departure C3, near-zero included (DEC-19-1)' },
      total: candidates.length,
      tiers: listTiers,
      flagTotals,
      firstNotNearZeroRankByC3: firstNotNearZero + 1,
      columns: K.LIST_COLUMNS,
      rows: shippedRows.map(K.rowToArray),
      rankings: { H: topH.map((r) => indexOf.get(r.des)), c3: topC3.map((r) => indexOf.get(r.des)) },
      top: LIST_TOP,
    },
    reference: { eros: ref('433'), apophis: ref('99942') },
  };
  return { study, rows, candidates, failures, seconds: (Date.now() - t0) / 1000 };
}

// ------------------------------------------------------------------ envelopes
function repoRef(study, key, confidence, note) {
  const i = study.inputs[key];
  return { kind: 'repo', path: i.path, commit: study.aster.commit, confidence, note };
}

function bodyEnvelopes(study, r) {
  const k = study.constants;
  const f = K.flagsFor(r, k, study.lattice, study.aster.asOf);
  const provenance = [
    repoRef(study, 'catalog', 'measured', 'conditionCode, dataArcDays, nObsUsed, H, orbitClass as SBDB reported them'),
    repoRef(study, 'cache', 'derived', `minC3 and its window from the Lambert screen over ${study.metadata.screeningWindow.startUtc} to ${study.metadata.screeningWindow.endUtc}`),
    repoRef(study, 'tiers', 'derived', 'Slice 18 fidelity tier and, for L1, the support-boundary encounter'),
  ];
  const modelSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(here, 'model.js'))).digest('hex');
  const assumptions = [
    `Joined and flagged by Aster-Idea-Bank ideas/17-known-unknowns/model.js (sha256 ${modelSha}), an idea-bank prototype that no Aster commit covers, so it carries no computation SourceRef.`,
    `U is shown raw (MPC 0-9 band). ${study.quotes.dec182.text}`,
    `"Low departure C3" means minC3 <= ${k.feasibleC3Max} km^2/s^2 on the cache grid. ${study.quotes.lowC3Meaning.text}`,
    `The window is the body's minimum-C3 cell. Its departure is the UTC midnight of launchDate; arrival = departure + TDB-UTC (${study.constants.tdbMinusUtcSeconds} s) + TOF, compared with the encounter's TDB Julian date as Aster's support-boundary.ts does.`,
  ];
  const value = {
    designation: r.des,
    name: r.name,
    orbitClass: r.cls,
    H: r.H,
    conditionCode: r.u,
    dataArcDays: r.arc,
    nObsUsed: r.nObs,
    inKnownUnknownsList: K.inList(r, k),
    minC3Km2S2: r.c3,
    minC3Grid: `screening cache, ${study.lattice.columns} x ${study.lattice.rows}: departures every ${study.metadata.departureGridSpacingDays} d from ${study.lattice.firstDeparture} to ${study.lattice.lastDeparture}, TOF ${study.lattice.tofFloor} to ${study.lattice.tofCeiling} d (DEC-19-2)`,
    window: r.launchDate ? { launchDate: r.launchDate, tofDays: r.tofDays, arrivalDate: K.addDays(r.launchDate, r.tofDays), vInfArrKmS: r.vInfArr } : null,
    fidelityTier: r.tier,
    tierSubReason: r.subReason,
    flags: {
      nearZeroC3: f.nearZero,
      windowBeforeAsOf: f.past ? study.aster.asOf : false,
      latticeEdges: f.edges,
      arrivalAfterEncounter: f.afterEncounter ? r.encDate : false,
      coOrbital: f.coOrbital,
      pha: f.pha,
      notKeplerSafe: f.keplerUnsafe,
    },
  };
  const row = {
    envelope_version: '1',
    tool: 'known_unknowns.body',
    as_of: study.aster.asOf,
    value,
    confidence: 'derived',
    provenance,
    assumptions,
    validity_envelope: `Aster catalog and screening cache at ${study.aster.commit.slice(0, 7)}; screening window ${study.metadata.screeningWindow.startUtc} to ${study.metadata.screeningWindow.endUtc}.`,
  };
  const plan = {
    envelope_version: '1',
    tool: 'known_unknowns.observing_plan',
    as_of: study.aster.asOf,
    value: null,
    confidence: 'assumed',
    provenance: [repoRef(study, 'catalog', 'measured', 'orbit-quality fields only; no magnitude, sky position or elongation')],
    assumptions: [],
    validity_envelope: 'No observer model exists in Aster or in this study.',
    refusal: {
      code: 'insufficient_data',
      reason: `An observing plan for ${r.des} needs its apparent magnitude, sky position and solar elongation over time, and a facility's limiting magnitude and sky coverage. Neither the catalog nor the screening cache holds any of them, and this study computes none.`,
      what_would_help: `An observer ephemeris for ${r.des} (for instance JPL Horizons observer tables) between now and ${r.launchDate || 'its window'}, and a facility capability model: the Survey lens's own data needs (${study.quotes.surveyQuestion.path}:${study.quotes.surveyQuestion.line}).`,
    },
  };
  return { row, plan };
}

function notFoundEnvelope(study, des) {
  return {
    envelope_version: '1',
    tool: 'known_unknowns.body',
    as_of: study.aster.asOf,
    value: null,
    confidence: 'measured',
    provenance: [repoRef(study, 'catalog', 'measured', 'searched by exact designation')],
    assumptions: [],
    validity_envelope: `The ${study.headline.bodies}-body Aster catalog at ${study.aster.commit.slice(0, 7)}.`,
    refusal: {
      code: 'not_found',
      reason: `No body with designation "${des}" is in the catalog.`,
      what_would_help: 'Give the designation exactly as the catalog stores it (for example "433" or "1979 XB"); search_bodies matches substrings of designation and name.',
    },
  };
}

// ------------------------------------------------------------------ text report
const fi = K.fmtInt;
const pad = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);

function report(study, opts) {
  const k = study.constants;
  const h = study.headline;
  const out = [];
  const say = (s = '') => out.push(s);
  const lowN = h.status.low_departure_c3;
  say('Known Unknowns: Aster catalog orbit quality crossed with screening C3');
  say(`Aster checkout ${study.aster.commit.slice(0, 7)} (${study.aster.commitDate}); "as of" date for past windows: ${study.aster.asOf}`);
  for (const key of ['catalog', 'cache', 'tiers']) {
    const i = study.inputs[key];
    say(`  ${padR(i.path, 46)} sha256 ${i.sha256.slice(0, 12)}…  ${fi(i.bytes)} bytes  blob ${i.committedBlob.slice(0, 7)}${i.readBlob === i.committedBlob ? '' : ' (READ BYTES DIFFER)'}`);
  }
  say(`  cache built from this catalog (metadata.provenance.catalogFixtureSha256): ${study.inputs.cacheBuiltFromThisCatalog ? 'yes' : 'NO'}`);
  say(`  C3 band edges (km^2/s^2): ${k.nearZeroC3} near-zero flag (${study.constantSources.nearZeroC3.path}:${study.constantSources.nearZeroC3.line}), ${k.c3ColorMin} colour floor (${study.constantSources.c3ColorMin.path}:${study.constantSources.c3ColorMin.line}), ${k.c3FirstContour} first contour (${study.constantSources.c3FirstContour.path}:${study.constantSources.c3FirstContour.line}), ${k.feasibleC3Max} screening threshold (cache metadata)`);
  say(`  U bands: >= ${k.uHighlyUncertainMin} JPL "highly uncertain" (${study.constantSources.uHighlyUncertainMin.path}:${study.constantSources.uHighlyUncertainMin.line}); <= ${k.uTightMax} Aster's own "tightly determined" (:${study.constantSources.uTightMax.line})`);
  say();
  say('1. The catalog');
  say(`  bodies ${fi(h.bodies)}; condition code U: ${Object.entries(h.uDistribution).map(([u, n]) => `${u} ${fi(n)}`).join(', ')}`);
  say(`  U >= ${k.uHighlyUncertainMin}: ${fi(h.uHighlyUncertain)} (${K.fmtPct(h.uHighlyUncertain, h.bodies)})`);
  say(`  data arc reported for ${fi(h.arcReported)}; median ${h.arcMedianDays} d; not reported ${fi(h.bodies - h.arcReported)}`);
  say(`  screening status: ${Object.entries(h.status).map(([s, n]) => `${s} ${fi(n)}`).join(', ')}; low departure C3 = ${K.fmtPct(lowN, h.bodies)}`);
  say(`  Slice 18 fidelity tiers by join: ${Object.entries(h.tierCounts).sort().map(([t, n]) => `${t} ${fi(n)}`).join(', ')} (artifact populations ${JSON.stringify(h.tierPopulations)})`);
  say();
  const grid = `${study.lattice.columns} x ${study.lattice.rows} cache grid`;
  say(`2. Minimum departure C3 (on the ${grid}) band by condition code (count, row share)`);
  const labels = K.c3BandLabels(k);
  say(`  ${padR('', 13)}${labels.map((l) => pad(l.replace(' (near-zero flag)', ' (flag)'), 15)).join('')}${pad('total', 9)}`);
  const ct = K.crossTab(study.hists, 'U');
  for (const r of ct.rows) say(`  ${padR(r.label, 13)}${r.cells.map((c) => pad(`${fi(c)} ${K.fmtPct(c, r.total)}`, 15)).join('')}${pad(fi(r.total), 9)}`);
  say(`  ${padR('total', 13)}${ct.colTotals.map((c) => pad(fi(c), 15)).join('')}${pad(fi(ct.grandTotal), 9)}`);
  say();
  say(`3. Why: size. Median minC3 (km^2/s^2, ${grid}) by U group, and Spearman rho of minC3 against U and data arc`);
  const s = study.stratified;
  const line = (b) => `  ${padR(b.label, 12)} n ${pad(fi(b.n), 6)}  U<=${k.uTightMax} ${pad(fi(b.tight.n), 6)} ${pad(K.fmtSig(b.tight.medianC3), 6)}  U${k.uTightMax + 1}-${k.uHighlyUncertainMin - 1} ${pad(fi(b.moderate.n), 6)} ${pad(K.fmtSig(b.moderate.medianC3), 6)}  U>=${k.uHighlyUncertainMin} ${pad(fi(b.uncertain.n), 6)} ${pad(K.fmtSig(b.uncertain.medianC3), 6)}  rho(U) ${K.fmtRho(b.rhoU)}  rho(arc) ${K.fmtRho(b.rhoArc)}`;
  say(line(s.all));
  say(`  ${padR('', 12)} rho(H, minC3) ${K.fmtRho(s.all.rhoHc3)}; rho(H, U) ${K.fmtRho(s.all.rhoHU)}`);
  for (const b of s.bands) say(line(b));
  say(`  (${s.hUnknownWithC3} bodies with a minC3 but no H are in "all bodies" only)`);
  say();
  const u = opts.u !== undefined ? opts.u : 6;
  const d = opts.arc !== undefined ? opts.arc : 30;
  const sv = K.survivors(study.hists.byArc, u, K.OURS.arcEdgesDays.indexOf(d));
  say(`4. What-if filter (counting only; ${study.quotes.dec174.text})`);
  say(`  among ${fi(sv.population)} low-departure-C3 bodies, U <= ${u} and data arc >= ${d} d keeps ${fi(sv.survive)} (${K.fmtPct(sv.survive, sv.population)})`);
  say(`  dropped: U above ${u} ${fi(sv.dropU)}; arc under ${d} d ${fi(sv.dropArc)}; both ${fi(sv.dropBoth)}; U not reported ${fi(sv.unknownU)}; arc not reported ${fi(sv.unknownArc)}`);
  say(`  survivors by C3 band: ${sv.surviveByBand.map((n, i) => `${labels[i]} ${fi(n)}`).join('; ')}`);
  say();
  const L = study.list;
  say(`5. The list: low departure C3, U >= ${L.criterion.uMin}, data arc under ${L.criterion.arcBelowDays} d or not reported: ${fi(L.total)} bodies (${K.fmtPct(L.total, h.bodies)} of the catalog)`);
  say(`  flags: near-zero C3 ${fi(L.flagTotals.nearZero)}; window before ${study.aster.asOf} ${fi(L.flagTotals.past)}; window on a lattice edge ${fi(L.flagTotals.edge)}; arrival after its L1 encounter ${fi(L.flagTotals.afterEncounter)}; co-orbital ${fi(L.flagTotals.coOrbital)}; PHA ${fi(L.flagTotals.pha)}; not-kepler-safe ${fi(L.flagTotals.keplerUnsafe)}; H not reported ${fi(L.flagTotals.hUnknown)}; arc not reported ${fi(L.flagTotals.arcUnknown)}`);
  say(`  tiers: ${Object.entries(L.tiers).sort().map(([t, n]) => `${t} ${fi(n)}`).join(', ')}; ranked by minC3 the first ${fi(L.firstNotNearZeroRankByC3 - 1)} are near-zero-C3 flags`);
  return out;
}

function listLines(study, rows, sort, top) {
  const k = study.constants;
  const ranked = rows.filter((r) => K.inList(r, k)).sort(K.SORTS[sort]).slice(0, top);
  const out = [`  top ${top} by ${sort === 'H' ? 'absolute magnitude (brightest first)' : 'minimum C3'} (C3 is the minimum on the ${study.lattice.columns} x ${study.lattice.rows} cache grid):`];
  out.push(`  ${pad('#', 4)} ${padR('designation', 14)} ${padR('cls', 4)} ${pad('H', 6)} ${pad('U', 2)} ${pad('arc', 4)} ${pad('obs', 4)} ${padR('launch', 10)} ${pad('TOF', 5)} ${padR('arrive', 10)} ${pad('C3', 8)} ${pad('vInfArr', 7)} flags`);
  ranked.forEach((r, i) => {
    const f = K.flagsFor(r, k, study.lattice, study.aster.asOf);
    const flags = [f.nearZero && study.quotes.nearZeroBadge.text, f.past && 'past', f.edges.length && `edge:${f.edges.join('+')}`, f.afterEncounter && `after ${r.encDate} encounter`, f.coOrbital && 'co-orbital', f.pha && 'PHA', f.keplerUnsafe && 'not-kepler-safe', r.tier].filter(Boolean).join(', ');
    out.push(`  ${pad(i + 1, 4)} ${padR(r.des, 14)} ${padR(r.cls, 4)} ${pad(r.H === null ? '—' : r.H, 6)} ${pad(r.u, 2)} ${pad(r.arc === null ? '—' : r.arc, 4)} ${pad(r.nObs, 4)} ${padR(r.launchDate, 10)} ${pad(r.tofDays, 5)} ${padR(K.addDays(r.launchDate, r.tofDays), 10)} ${pad(K.fmtSig(r.c3), 8)} ${pad(K.fmtSig(r.vInfArr), 7)} ${flags}`);
  });
  return out;
}

function auditLines(study) {
  const a = study.qualityAudit;
  const f = study.formulas;
  const w = a.worstLiteral;
  return [
    '6. qualityRank audit',
    `  spec (${f.spec.path}:${f.spec.line}-${f.spec.lineEnd}): ${f.spec.lines.join(' ; ')}`,
    `  recomputed for ${fi(a.n)} bodies: max |spec - stored| ${a.maxAbsSpecMinusStored.toExponential(2)} (the stored value is rounded to 6 decimals); over 1e-6: ${a.overTolerance}`,
    `  the fixture's own catalog.qualityRankFormula, read literally, has one clamp01 where the spec has three:`,
    `    ${f.fixtureString.text}`,
    `  read that way it disagrees with the stored value for ${fi(a.literalDisagrees)} bodies, by up to ${a.maxAbsLiteralMinusStored.toFixed(4)} (worst: ${w.designation}, U ${w.u}, arc ${fi(w.arc)} d: stored ${w.stored}, spec ${w.spec.toFixed(6)}, literal ${w.literal.toFixed(6)})`,
    `  the string comes from ${f.builderString.path}:${f.builderString.line}; the implementation (${f.implementation.path}:${f.implementation.line}) clamps each score, as the spec does`,
  ];
}

function refusalLines(study) {
  const q = study.quotes;
  return [
    '7. What this study refuses',
    `  observing plan (insufficient_data): no apparent magnitude, sky position, elongation or facility model anywhere in Aster; what would help: observer ephemerides and a facility capability model (${q.surveyQuestion.path}:${q.surveyQuestion.line}). --body DES prints it as an envelope.`,
    `  U in kilometres (out_of_envelope): ${q.dec182.text} (${q.dec182.path}:${q.dec182.line})`,
    `  soonest window ranking (insufficient_data): the cache keeps only each body's five lowest-C3 cells, so the next window after a date is not in it; what would help: a dated porkchop_scan.`,
    `  "U predicts screening error" (not tested here): ${q.slice18Answer.text} Structural caveat: "${q.slice18Caveat.text}" (${q.slice18Caveat.path}:${q.slice18Caveat.line})`,
  ];
}

// ------------------------------------------------------------------ data file
function dataFileText(study) {
  return `// Generated by known-unknowns.mjs --write from the Aster checkout. Do not edit.
// Aster ${study.aster.commit}: ${study.inputs.catalog.path} (sha256 ${study.inputs.catalog.sha256}),
// ${study.inputs.cache.path} (sha256 ${study.inputs.cache.sha256}),
// ${study.inputs.tiers.path} (sha256 ${study.inputs.tiers.sha256}).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KU_STUDY = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return ${JSON.stringify(study)};
});
`;
}

function loadSnapshot() {
  const req = createRequire(import.meta.url);
  delete req.cache[DATA_FILE];
  return req(DATA_FILE);
}

// ------------------------------------------------------------------ main
function main() {
  const opts = parseArgs(process.argv.slice(2));
  let d;
  try {
    d = derive(opts.aster);
  } catch (e) {
    console.error(`known-unknowns: cannot read the Aster checkout at ${opts.aster}: ${e.message}`);
    process.exit(1);
  }
  const { study, rows, failures } = d;

  if (opts.body !== undefined) {
    const r = rows.find((x) => x.des === opts.body);
    if (!r) {
      const env = notFoundEnvelope(study, opts.body);
      if (opts.json) console.log(JSON.stringify(env, null, 2));
      else console.log(`refused (not_found): ${env.refusal.reason}\n  what would help: ${env.refusal.what_would_help}`);
      process.exit(2);
    }
    const env = bodyEnvelopes(study, r);
    if (opts.json) {
      console.log(JSON.stringify(env, null, 2));
    } else {
      const v = env.row.value;
      console.log(`${v.designation}${v.name ? ` ${v.name}` : ''}  ${v.orbitClass}  H ${v.H ?? 'not reported'}`);
      console.log(`  orbit quality: U ${v.conditionCode ?? 'not reported'} (raw MPC band), data arc ${v.dataArcDays ?? 'not reported'} d, ${v.nObsUsed} observations used`);
      console.log(`  screening: minC3 ${K.fmtSig(v.minC3Km2S2)} km^2/s^2 (${v.minC3Grid})${v.window ? `, launch ${v.window.launchDate}, TOF ${v.window.tofDays} d, arrive ${v.window.arrivalDate}, arrival v-inf ${K.fmtSig(v.window.vInfArrKmS)} km/s` : ''}`);
      console.log(`  fidelity tier ${v.fidelityTier} (${v.tierSubReason}); in the known-unknowns list: ${v.inKnownUnknownsList ? 'yes' : 'no'}`);
      console.log(`  flags: ${JSON.stringify(v.flags)}`);
      console.log(`  observing plan refused (${env.plan.refusal.code}): ${env.plan.refusal.reason}`);
      console.log(`    what would help: ${env.plan.refusal.what_would_help}`);
    }
    process.exit(failures.length ? 1 : 0);
  }

  if (opts.write) {
    fs.writeFileSync(DATA_FILE, dataFileText(study));
    console.error(`wrote ${path.relative(process.cwd(), DATA_FILE)} (${fs.statSync(DATA_FILE).size} bytes); now refresh its sidecar with tools/snapshot.mjs --sidecar-only`);
  }
  if (opts.check) {
    let same = false;
    try {
      same = isDeepStrictEqual(JSON.parse(JSON.stringify(loadSnapshot())), JSON.parse(JSON.stringify(study)));
    } catch (e) {
      console.error(`known-unknowns: cannot load ${DATA_FILE}: ${e.message}`);
    }
    console.log(same ? 'snapshot is current' : 'snapshot is STALE: run --write, then refresh the sidecar');
    if (!same) process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(study, null, 1));
  } else if (!opts.check) {
    const out = report(study, opts);
    out.push(...listLines(study, rows, opts.sort, opts.top));
    if (opts.u === undefined && opts.sort === 'H') out.push(...listLines(study, rows, 'c3', Math.min(opts.top, 5)));
    out.push('', ...auditLines(study), '', ...refusalLines(study));
    out.push('', `reconciliation: ${failures.length ? `FAILED\n  ${failures.join('\n  ')}` : 'all joins, status bands, minC3 windows, list count and qualityRank checks pass'}`);
    console.log(out.join('\n'));
  }
  if (failures.length) {
    if (opts.json || opts.check) console.error(`reconciliation FAILED:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}

main();
