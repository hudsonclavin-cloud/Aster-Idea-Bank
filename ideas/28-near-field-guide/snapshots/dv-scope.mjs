#!/usr/bin/env node
/**
 * FRONT C DENOMINATOR — scope by computed delta-v, not by a tuned distance threshold.
 *
 * Materiality criterion (derived in the math audit, validated against the Front B
 * measurement): an encounter matters when the velocity kick it imparts, carried for the
 * time remaining in the consumed window, exceeds the drift regime of interest.
 *
 *   tan(theta/2) = mu / (d * v_rel^2);  dv = 2 * v_rel * sin(theta/2)
 *   addedDrift ~ dv * (t_end - t_encounter)
 *
 * Validation of the criterion (Front B measured rates):
 *   2012 UE34  measured/predicted 1.07 ; 99942 2.58 ; distant passes correctly predicted null.
 *
 * Repo READ-ONLY. Perturber GMs are audit-side reference values (JPL), used only here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'C:/Users/hudso/asteroid-mining-planner';
const HERE = 'C:/Users/hudso/Documents/aster-slice18/audit';
const OUT = path.join(HERE, 'dv-scope-results.json');
const RESEARCH_DIR = path.join(REPO, 'tools/slice18-research');
const PER_BODY_OUT = path.join(RESEARCH_DIR, 'dv-scope-per-body.json');
const CAD_PATH = path.join(RESEARCH_DIR, 'cad-wide/cad-all-0.3.json');

const { ingestSlice9Fixture } = await import(pathToFileURL('C:/Users/hudso/Documents/aster-slice18/build-v2x/boundary/slice9-nea-catalog.js').href);

const AU = 149597870.7;
const SPD = 86400;
const END_JD = 2468342.5; // 2046-01-01, last consumed arrival epoch
const GM = { Mercury: 22031.868551, Venus: 324858.592, Earth: 398600.435507, Moon: 4902.800118, Mars: 42828.375816, Jupiter: 126712764.1, Saturn: 37940584.8 };

const catalog = ingestSlice9Fixture(JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/v2/nea-catalog-slice9.json'), 'utf8')));
const catDes = new Set(Object.values(catalog.asteroids).map((b) => b.designation));
const TOTAL = catDes.size;

const cad = JSON.parse(fs.readFileSync(CAD_PATH, 'utf8'));
const F = cad.fields;
const ix = { des: F.indexOf('des'), jd: F.indexOf('jd'), dist: F.indexOf('dist'), vrel: F.indexOf('v_rel'), body: F.indexOf('body'), cd: F.indexOf('cd') };

function dvKmS(mu, dKm, vrel) {
  const tanHalf = mu / (dKm * vrel * vrel);
  return 2 * vrel * Math.sin(Math.atan(tanHalf));
}

// ---- per-body data caps, measured from the response (not assumed) ----
const capByBody = {};
for (const r of cad.data) {
  const b = r[ix.body];
  const d = +r[ix.dist];
  if (!(b in capByBody) || d > capByBody[b]) capByBody[b] = d;
}

// ---- per catalog body: strongest encounter by predicted added drift ----
// CORRECTION (self-caught): only encounters AFTER the body's own element epoch introduce
// future error. The catalog re-anchored 41,539 bodies at 2026-05-01, so an encounter in
// e.g. 2026-03 is already baked into the shipped elements and must not be counted. The
// first pass of this script ignored that and put several early-2026 bodies at the top.
const catByDes = new Map(Object.values(catalog.asteroids).map((b) => [b.designation, b]));
const J2000_JD = 2451545.0;
const epochJdOf = (des) => {
  const b = catByDes.get(des);
  return J2000_JD + b.elements.epochTdbSeconds / SPD;
};
const best = new Map();
let rowsInCatalog = 0;
let rowsBeforeEpochSkipped = 0;
for (const r of cad.data) {
  const des = r[ix.des];
  if (!catDes.has(des)) continue;
  rowsInCatalog += 1;
  const body = r[ix.body];
  const mu = GM[body];
  if (!mu) continue;
  const jd = +r[ix.jd];
  if (jd <= epochJdOf(des)) { rowsBeforeEpochSkipped += 1; continue; }
  const dKm = +r[ix.dist] * AU;
  const vrel = +r[ix.vrel];
  const tRemainS = Math.max(0, (END_JD - jd) * SPD);
  const dv = dvKmS(mu, dKm, vrel);
  const added = dv * tRemainS;
  const prev = best.get(des);
  if (!prev || added > prev.addedKm) {
    best.set(des, { des, body, cd: r[ix.cd], distKm: dKm, vrel, dvKmS: dv, tRemainYears: tRemainS / (365.25 * SPD), addedKm: added, largeDeflection: dv > 1 });
  }
}

const band = (min) => [...best.values()].filter((b) => b.addedKm >= min).length;
const scope = {
  catalogTotal: TOTAL,
  bodiesWithAnyCadRow: best.size,
  byPredictedAddedDrift: {
    'ge_1e8_km': band(1e8),
    'ge_1e7_km': band(1e7),
    'ge_1e6_km_argminMovingRegime': band(1e6),
    'ge_1e5_km_planetFloor': band(1e5),
    'lt_1e5_km': best.size - band(1e5),
  },
  asPercentOfCatalog: {
    anyCadRow: +(100 * best.size / TOTAL).toFixed(2),
    ge_1e6: +(100 * band(1e6) / TOTAL).toFixed(2),
    ge_1e5: +(100 * band(1e5) / TOTAL).toFixed(2),
  },
};

// ---- prior distance-threshold numbers, recomputed on THIS dataset for comparability ----
const within = (auMax, earthOnly) => {
  const s = new Set();
  for (const r of cad.data) {
    if (!catDes.has(r[ix.des])) continue;
    if (earthOnly && r[ix.body] !== 'Earth' && r[ix.body] !== 'Moon') continue;
    if (+r[ix.dist] * AU <= auMax) s.add(r[ix.des]);
  }
  return s.size;
};
const distanceComparison = {
  within_5M_km_any: within(5e6, false),
  within_0p4M_km_any: within(4e5, false),
  note: 'Prior probe (0.1 AU dataset) reported 2,644 and 122. Recomputed here on the 0.3 AU dataset.',
};

// ---- blind spot: what the 0.15 AU non-Earth cap can hide ----
const blind = {};
for (const [b, cap] of Object.entries(capByBody)) {
  if (b === 'Earth' || b === 'Moon') continue;
  const typicalV = b === 'Venus' ? 10 : b === 'Mars' ? 8 : b === 'Mercury' ? 15 : 10;
  const dv = dvKmS(GM[b], cap * AU, typicalV);
  blind[b] = {
    maxDistReturnedAu: +cap.toFixed(4),
    dvAtCapKmS: +dv.toExponential(3),
    addedDriftOver19yKm: +(dv * 19 * 365.25 * SPD).toExponential(3),
    exceeds1e6: dv * 19 * 365.25 * SPD >= 1e6,
  };
}

// ---- VALIDATION against the 17 measured Front B NEAs (different method: measured drift) ----
const drift = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/slice18-research/nea-drift-results.json'), 'utf8'));
const validation = [];
for (const [des, row] of Object.entries(drift.bodies)) {
  if (row.band !== 'nea') continue;
  const measured = row.A_primaryAnchor.max_km;
  const pred = best.get(des);
  validation.push({
    des,
    measuredMaxKm: measured,
    predictedAddedKm: pred ? pred.addedKm : 0,
    predictedFrom: pred ? pred.body + ' ' + pred.cd : 'no post-epoch encounter in CAD',
    measuredGe1e6: measured >= 1e6,
    predictedGe1e6: (pred ? pred.addedKm : 0) >= 1e6,
  });
}
const vAgree = validation.filter((v) => v.measuredGe1e6 === v.predictedGe1e6).length;
const vUnder = validation.filter((v) => v.measuredGe1e6 && !v.predictedGe1e6).length;
const vOver = validation.filter((v) => !v.measuredGe1e6 && v.predictedGe1e6).length;
const validationSummary = {
  n: validation.length, agree: vAgree,
  underPredicts: vUnder, overPredicts: vOver,
  interpretation: 'Under-prediction is EXPECTED and is the point: dv captures encounter-driven drift only. Bodies that drift past 1e6 km with no post-epoch encounter do so by secular/shape-driven accumulation, which this criterion does not model. The scope number is therefore a LOWER BOUND on how many catalog bodies reach the argmin-moving regime.',
  rows: validation.sort((a, b) => b.measuredMaxKm - a.measuredMaxKm),
};

const generatedAtUtc = new Date().toISOString();
const source = 'ssd-api.jpl.nasa.gov/cad.api, date-min 2026-01-01, date-max 2046-01-01, dist-max 0.3, body=ALL';
const results = { generatedAtUtc, rowsBeforeEpochSkipped, validationAgainstMeasured: validationSummary, source, criterion: 'addedDrift = dv * timeRemainingToWindowEnd; dv = 2 v sin(atan(mu/(d v^2)))', windowEndJd: END_JD, perturberGM: GM, capByBody, rowsTotal: cad.data.length, rowsInCatalog, scope, distanceComparison, blindSpotFromDataCap: blind, top20: [...best.values()].sort((a, b) => b.addedKm - a.addedKm).slice(0, 20) };
fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
const perBody = Object.fromEntries([...catDes].sort((a, b) => a.localeCompare(b)).map((des) => [des, best.get(des) ?? null]));
fs.writeFileSync(PER_BODY_OUT, JSON.stringify({ generatedAtUtc, cadFetchedAtUtc: '2026-09-11T04:27:49.000Z', source, criterion: results.criterion, windowEndJd: END_JD, perturberGM: GM, catalogTotal: TOTAL, records: perBody }, null, 1));

console.log('CAD rows: ' + cad.data.length + ' total, ' + rowsInCatalog + ' belong to catalog bodies');
console.log('per-body max distance actually stored (measured): ' + JSON.stringify(capByBody));
console.log('');
console.log('=== FRONT C DENOMINATOR, by computed delta-v ===');
console.log('  catalog total:                      ' + TOTAL);
console.log('  bodies with any CAD row (<=0.3 AU): ' + best.size + '  (' + scope.asPercentOfCatalog.anyCadRow + '%)');
console.log('  predicted added drift >= 1e8 km:    ' + scope.byPredictedAddedDrift.ge_1e8_km);
console.log('  predicted added drift >= 1e7 km:    ' + scope.byPredictedAddedDrift.ge_1e7_km);
console.log('  >= 1e6 km (argmin-moving regime):   ' + scope.byPredictedAddedDrift.ge_1e6_km_argminMovingRegime + '  (' + scope.asPercentOfCatalog.ge_1e6 + '% of catalog)');
console.log('  >= 1e5 km (planet floor):           ' + scope.byPredictedAddedDrift.ge_1e5_km_planetFloor + '  (' + scope.asPercentOfCatalog.ge_1e5 + '% of catalog)');
console.log('  below 1e5 km (immaterial):          ' + scope.byPredictedAddedDrift.lt_1e5_km);
console.log('');
console.log('=== distance-threshold comparison (same dataset) ===');
console.log('  within 5M km of any perturber:   ' + distanceComparison.within_5M_km_any);
console.log('  within 0.4M km of any perturber: ' + distanceComparison.within_0p4M_km_any);
console.log('');
console.log('=== blind spot from the measured non-Earth 0.15 AU data cap ===');
for (const [b, v] of Object.entries(blind)) console.log('  ' + b.padEnd(9) + 'cap ' + v.maxDistReturnedAu + ' AU -> dv ' + v.dvAtCapKmS + ' km/s -> ' + v.addedDriftOver19yKm + ' km over 19 y  exceeds1e6=' + v.exceeds1e6);
console.log('');
console.log('=== top 10 by predicted added drift ===');
for (const b of results.top20.slice(0, 10)) console.log('  ' + b.des.padEnd(12) + b.cd.padEnd(19) + b.body.padEnd(8) + 'd=' + Math.round(b.distKm).toLocaleString().padStart(12) + ' km  dv=' + b.dvKmS.toFixed(4) + ' km/s  t=' + b.tRemainYears.toFixed(1) + ' y  -> ' + (b.addedKm / 1e6).toFixed(1) + 'M km');
