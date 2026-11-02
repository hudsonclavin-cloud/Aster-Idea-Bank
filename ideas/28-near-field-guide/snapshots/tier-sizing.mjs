#!/usr/bin/env node
/**
 * FRONT C TIER SIZING — catalog-wide, no network.
 *
 * Sizes the three disclosure tiers Hudson named, from committed data plus the delta-v
 * scope already computed. The load-bearing number is the CANNOT-BOUND population:
 * bodies whose dominant perturber lies outside what any available data source will
 * return, so no honest error statement can be made about them at all.
 *
 * Jupiter-crossing threshold: Q >= 4.95 AU (Jupiter perihelion). A body whose aphelion
 * reaches Jupiter's orbit can have Jupiter encounters, and CAD's measured 0.28 AU
 * Jupiter cap means those encounters are invisible to the instrument.
 *
 * Reads ONLY committed inputs (the Slice 9 catalog fixture, dv-scope-results.json,
 * cad-wide/cad-all-0.3.json + its metadata) and writes ONE committed artifact next
 * to itself: tier-sizing-per-body.json — the single source of tier populations
 * (its `populations` field) and of every per-body tier record. The catalog-wide
 * summary is printed to stdout only; the former tier-sizing-results.json aggregate
 * was removed at 1cd5124 so there is one source, and a close-out re-add was
 * reversed (2026-09-21). Regenerating must leave every per-body record
 * byte-identical; only generatedAtUtc moves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'C:/Users/hudso/asteroid-mining-planner';
const RESEARCH_DIR = path.join(REPO, 'tools/slice18-research');
const PER_BODY_OUT = path.join(RESEARCH_DIR, 'tier-sizing-per-body.json');
const CAD_PATH = path.join(RESEARCH_DIR, 'cad-wide/cad-all-0.3.json');
const CAD_METADATA_PATH = path.join(RESEARCH_DIR, 'cad-wide/cad-all-0.3.metadata.json');
const AU_KM = 149597870.7;
const JUPITER_PERIHELION_AU = 4.95;

const raw = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/v2/nea-catalog-slice9.json'), 'utf8'));
const bodies = Object.values(raw.asteroids);
const TOTAL = bodies.length;

// S18 close-out Item 4: read the COMMITTED copy (the audit-directory copy this
// once read is not in the repo; the two fields used here — perturberGM and
// windowEndJd — were verified identical between them before the switch).
const scope = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, 'dv-scope-results.json'), 'utf8'));
const cadMetadata = JSON.parse(fs.readFileSync(CAD_METADATA_PATH, 'utf8'));
// S18 close-out Item 5: per-body disclosure values, from COMMITTED data only.
//  - impactors: the Horizons termination sentence date (Front B truth fixture, 0d927e4)
//  - 3D/Biela: two-body drift on the window's first day (nea-drift-results.json)
//  - L1 bodies: the CAD encounter that makes the tier material (kept from the loop below)
const truth = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/v2/nea-drift-truth-2026-2046.json'), 'utf8'));
const terminationByDes = new Map(truth.findings.S_nonExistentCatalogBodies.bodies.map((b) => [b.designation, b.terminatesAfterTdb]));
const neaDrift = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, 'nea-drift-results.json'), 'utf8'));
const bielaFirstDayDriftKm = neaDrift.bodies['3D'].B_catalogElements.at_first_record_km;
// Two encounters per material body, for two different jobs:
//  - maxDriftByDes: the row with the LARGEST added drift — this is what makes the
//    body material, and it is the row dv-scope-per-body.json records (cross-check).
//    Carried in the record as `maxDriftEncounter` ONLY when it is a different row
//    from the boundary, so the disclosure can name the largest perturbation too
//    (ratified 2026-09-21).
//  - earliestMaterialByDes: the EARLIEST row whose own added drift is >= 1e6 km —
//    this is the support boundary (the first moment the orbit is materially
//    invalidated; DEC-18-3's "first materially perturbing encounter"). For 2,352 of
//    the 10,150 L1 bodies it precedes the max-drift row; shipping the max-drift date
//    would over-claim support for them (S18 close-out self-caught correction,
//    2026-09-21, ratified as earliest-material).
const maxDriftByDes = new Map();
const earliestMaterialByDes = new Map();
// rebuild the material set from the per-body top records we kept, plus recompute from source
const materialSet = new Set();
{
  const cad = JSON.parse(fs.readFileSync(CAD_PATH, 'utf8'));
  const F = cad.fields;
  const ix = { des: F.indexOf('des'), jd: F.indexOf('jd'), cd: F.indexOf('cd'), dist: F.indexOf('dist'), vrel: F.indexOf('v_rel'), body: F.indexOf('body') };
  const GM = scope.perturberGM;
  const END_JD = scope.windowEndJd;
  const SPD = 86400, J2000 = 2451545.0;
  const epochJd = new Map(bodies.map((b) => [b.designation, J2000 + (b.elements.epochTdbJd ? (b.elements.epochTdbJd - J2000) : 0)]));
  for (const b of bodies) epochJd.set(b.designation, b.elements.epochTdbJd);
  const acc = new Map();
  for (const r of cad.data) {
    const des = r[ix.des];
    const ep = epochJd.get(des);
    if (ep === undefined) continue;
    const jd = +r[ix.jd];
    if (jd <= ep) continue;
    const mu = GM[r[ix.body]];
    if (!mu) continue;
    const d = +r[ix.dist] * AU_KM, v = +r[ix.vrel];
    const dv = 2 * v * Math.sin(Math.atan(mu / (d * v * v)));
    const added = dv * Math.max(0, (END_JD - jd) * SPD);
    if (!acc.has(des) || added > acc.get(des)) {
      acc.set(des, added);
      // Same strict-> rule as dv-scope.mjs, so this is the row
      // dv-scope-per-body.json records (the test suite compares them body by body).
      maxDriftByDes.set(des, { jd, cd: r[ix.cd], body: r[ix.body], dvKmS: dv });
    }
    if (added >= 1e6) {
      const prev = earliestMaterialByDes.get(des);
      if (prev === undefined || jd < prev.jd) {
        earliestMaterialByDes.set(des, { jd, cd: r[ix.cd], body: r[ix.body], dvKmS: dv });
      }
    }
  }
  for (const [des, added] of acc) if (added >= 1e6) materialSet.add(des);
}

// ---- classify ----
const NEA_CLASSES = ['APO', 'AMO', 'ATE', 'IEO'];
const rows = { nonExistent: [], hyperbolic: [], comet: [], jupiterCrossing: [], material: [], quiet: [] };
const counts = {};
const qHist = { 'lt_1.5': 0, '1.5-2': 0, '2-3': 0, '3-4.95': 0, '4.95-10': 0, '10-50': 0, 'ge_50': 0 };
let qMissing = 0;

const assign = [];
for (const b of bodies) {
  const des = b.designation;
  const e = b.elements.e;
  const aAU = b.elements.aKm / AU_KM;
  const Q = aAU * (1 + e);
  const isComet = ['JFC', 'HTC', 'ETC', 'CTc', 'COM', 'PAR', 'HYP'].includes(b.orbitClass) || !NEA_CLASSES.includes(b.orbitClass);
  const historicallyDestroyed = des === '3D' && b.name === '3D/Biela';
  const nonExistent = (b.anchorSource === 'stale-unanchored' && NEA_CLASSES.includes(b.orbitClass)) || historicallyDestroyed;
  const hyperbolic = !(e < 1) || !(aAU > 0);

  if (Number.isFinite(Q)) {
    if (Q < 1.5) qHist['lt_1.5'] += 1;
    else if (Q < 2) qHist['1.5-2'] += 1;
    else if (Q < 3) qHist['2-3'] += 1;
    else if (Q < JUPITER_PERIHELION_AU) qHist['3-4.95'] += 1;
    else if (Q < 10) qHist['4.95-10'] += 1;
    else if (Q < 50) qHist['10-50'] += 1;
    else qHist['ge_50'] += 1;
  } else qMissing += 1;

  // precedence: does not exist > cannot propagate > comet > Jupiter-crossing > material > quiet
  let classification;
  let fidelityTier;
  let subReason;
  if (nonExistent) {
    classification = 'nonExistent';
    fidelityTier = 'L0';
    subReason = historicallyDestroyed ? 'historically-destroyed-disintegration' : 'verified-destroyed-ephemeris-termination';
  } else if (hyperbolic) {
    classification = 'hyperbolic';
    fidelityTier = 'L0';
    subReason = 'cannot-propagate-hyperbolic-orbit';
  } else if (isComet) {
    classification = 'comet';
    fidelityTier = 'L2';
    subReason = 'structurally-blind-comet';
  } else if (Q >= JUPITER_PERIHELION_AU) {
    classification = 'jupiterCrossing';
    fidelityTier = 'L2';
    subReason = 'structurally-blind-jupiter-crossing';
  } else if (materialSet.has(des)) {
    classification = 'material';
    fidelityTier = 'L1';
    subReason = 'materially-degraded-delta-v';
  } else {
    classification = 'quiet';
    fidelityTier = 'L2';
    // The committed drift instrument measured 17 NEA bodies.  Preserve that
    // distinction in the shipped tier artifact instead of making the UI infer
    // it from a body-id list.  Structurally blind bodies take precedence above.
    subReason = neaDrift.bodies[des]?.band === 'nea' ? 'measured-but-unbounded' : 'unmeasured';
  }
  counts[classification] = (counts[classification] || 0) + 1;
  const record = { des, tier: fidelityTier, subReason, classification, Q: +Q.toFixed(3), e: +e.toFixed(4), aAU: +aAU.toFixed(3), orbitClass: b.orbitClass, material: materialSet.has(des) };
  // S18 Item 5: disclosure values, only where committed data has them (never invented).
  if (classification === 'nonExistent' && terminationByDes.has(des)) record.terminationTdb = terminationByDes.get(des);
  if (historicallyDestroyed) record.firstDayDriftKm = bielaFirstDayDriftKm;
  if (classification === 'material') {
    // The boundary (earliest material) is the disclosure's date; the largest-drift
    // row is carried only when it is a different row — then the disclosure also
    // names it, and the artifact stays traceable to dv-scope-per-body.json
    // (maxDriftEncounter ?? encounter is always dv-scope's row).
    record.encounter = earliestMaterialByDes.get(des);
    const maxDrift = maxDriftByDes.get(des);
    if (maxDrift.cd !== record.encounter.cd || maxDrift.body !== record.encounter.body) {
      record.maxDriftEncounter = maxDrift;
    }
  }
  assign.push(record);
}
{
  const withTermination = assign.filter((r) => r.terminationTdb !== undefined).length;
  const withFirstDayDrift = assign.filter((r) => r.firstDayDriftKm !== undefined).length;
  const withEncounter = assign.filter((r) => r.encounter !== undefined).length;
  const materialRecords = assign.filter((r) => r.classification === 'material').length;
  const boundaryAfterMaxDrift = assign.filter((r) => r.encounter !== undefined && r.encounter.jd > maxDriftByDes.get(r.des).jd).length;
  if (withTermination !== 9 || withFirstDayDrift !== 1 || withEncounter !== materialRecords || boundaryAfterMaxDrift !== 0) {
    throw new Error(`Front C disclosure coverage mismatch: ${JSON.stringify({ withTermination, withFirstDayDrift, withEncounter, materialRecords, boundaryAfterMaxDrift })}`);
  }
  console.log('L1 bodies whose earliest material encounter precedes the max-drift row: ' + assign.filter((r) => r.maxDriftEncounter !== undefined).length);
}
const fidelityCounts = Object.fromEntries(['L0', 'L1', 'L2'].map((tier) => [tier, assign.filter((row) => row.tier === tier).length]));
const structurallyBlindCount = assign.filter((row) => row.tier === 'L2' && row.subReason.startsWith('structurally-blind-')).length;
if (fidelityCounts.L0 !== 11 || fidelityCounts.L1 !== 10150 || fidelityCounts.L2 !== 31745 || TOTAL !== 41906 || structurallyBlindCount !== 688) throw new Error(`Front C population mismatch: ${JSON.stringify({ total: TOTAL, fidelityCounts, structurallyBlindCount })}`);

// overlaps that matter for the design
// S18 close-out Item 4: this compared r.tier (an L0/L1/L2 label) against a
// classification name, so it was always 0. The classification field is the one
// that carries 'jupiterCrossing'; the true count is 9.
const jupCrossingAlsoMaterial = assign.filter((r) => r.classification === 'jupiterCrossing' && r.material).length;
const quietCount = counts.quiet || 0;
const cannotBound = (counts.jupiterCrossing || 0) + (counts.comet || 0) + (counts.hyperbolic || 0);

const results = {
  generatedAtUtc: new Date().toISOString(),
  catalogTotal: TOTAL,
  jupiterPerihelionAu: JUPITER_PERIHELION_AU,
  aphelionHistogram: qHist,
  qMissing,
  tierCounts: counts,
  tierPercent: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, +(100 * v / TOTAL).toFixed(2)])),
  cannotBoundTotal: cannotBound,
  cannotBoundPercent: +(100 * cannotBound / TOTAL).toFixed(2),
  jupiterCrossingAlsoHasMaterialCadEncounter: jupCrossingAlsoMaterial,
  materialSetSize: materialSet.size,
  note: 'Precedence: nonExistent > hyperbolic > comet > jupiterCrossing > material > quiet. A body is counted once, in its strongest tier.',
};
fs.writeFileSync(PER_BODY_OUT, JSON.stringify({ generatedAtUtc: results.generatedAtUtc, cadFetchedAtUtc: cadMetadata.fetchedAtUtc, source: 'tier-sizing.mjs over nea-catalog-slice9.json + dv-scope-results.json + cad-all-0.3.json', catalogTotal: TOTAL, populations: { L0: fidelityCounts.L0, L1: fidelityCounts.L1, L2: fidelityCounts.L2, total: TOTAL, structurallyBlindL2: structurallyBlindCount }, records: Object.fromEntries(assign.sort((a, b) => a.des.localeCompare(b.des)).map((row) => [row.des, row])) }, null, 1));

const pct = (n) => (100 * n / TOTAL).toFixed(2) + '%';
console.log('catalog total: ' + TOTAL);
console.log('');
console.log('=== APHELION (Q) DISTRIBUTION, catalog-wide ===');
for (const [k, v] of Object.entries(qHist)) console.log('  Q ' + k.padEnd(10) + String(v).padStart(7) + '  ' + pct(v));
if (qMissing) console.log('  (non-finite Q: ' + qMissing + ')');
console.log('');
console.log('=== TIER SIZING (each body counted once, strongest tier) ===');
console.log('  does not exist (stale-unanchored NEA):  ' + String(counts.nonExistent || 0).padStart(7) + '  ' + pct(counts.nonExistent || 0));
console.log('  cannot propagate (e >= 1):             ' + String(counts.hyperbolic || 0).padStart(7) + '  ' + pct(counts.hyperbolic || 0));
console.log('  comet / not-kepler-safe class:         ' + String(counts.comet || 0).padStart(7) + '  ' + pct(counts.comet || 0));
console.log('  Jupiter-crossing (Q >= 4.95 AU):       ' + String(counts.jupiterCrossing || 0).padStart(7) + '  ' + pct(counts.jupiterCrossing || 0));
console.log('  materially degraded (delta-v >= 1e6):  ' + String(counts.material || 0).padStart(7) + '  ' + pct(counts.material || 0));
console.log('  no instrument signal ("quiet"):        ' + String(quietCount).padStart(7) + '  ' + pct(quietCount));
console.log('');
console.log('  CANNOT-BOUND TOTAL (comet + Jupiter-crossing + hyperbolic): ' + cannotBound + '  ' + pct(cannotBound));
console.log('  of the Jupiter-crossing, also have a material CAD encounter: ' + jupCrossingAlsoMaterial);
