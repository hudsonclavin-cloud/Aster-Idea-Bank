#!/usr/bin/env node
// A study over Aster's whole screening cache, with this module's kernel: for each of the 41,906 bodies, is the window
// Aster's catalog list shows as its best (bestWindows[0], the minimum C3 of a direct transfer on a 7-day x 30-day grid)
// one that two-body propagation can stand behind? It is not when the arrival lies past an Earth encounter closer than
// 0.05 au after the element epoch (Aster's own screening distance), or when the asteroid is inside the Earth's sphere
// of influence at arrival. Reads Aster's checkout (62ddb17); writes snapshots/encounter-study.json (counts and the
// worst cases). Nothing here runs when the page or the tests run.
//   node ideas/39-lamberts-road/study-encounters.mjs [<aster checkout>]     (about two minutes)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ASTER = path.resolve(process.argv[2] || '/home/user/asteroid-mining-planner');
const { LambertsRoad, C, EARTH, REFS } = require(path.join(here, 'load.cjs'));
const cat = JSON.parse(fs.readFileSync(path.join(ASTER, 'tests/fixtures/v2/nea-catalog-slice9.json'), 'utf8'));
const cache = JSON.parse(fs.readFileSync(path.join(ASTER, 'tests/fixtures/v2/lambert-screen-cache.json'), 'utf8'));
const list = [];
for (const x of cache.bodies) {
  const b = cat.asteroids[x.bodyId];
  if (!b || !x.bestWindows || !x.bestWindows.length) continue;
  list.push({ designation: b.designation, name: b.name, elements: b.elements, conditionCode: b.conditionCode, dataArcDays: b.dataArcDays, tier: b.inv014Tier, best: x.bestWindows[0], status: x.status });
}
const K = LambertsRoad.create({ constants: C, earth: EARTH, bodies: { list }, refs: REFS });
const DAY = 86400;
let n = 0, inSoi = 0, pastEnc = 0, either = 0, partial = 0, lowC3 = 0, lowC3Refused = 0, notKepler = 0;
const cases = [];
const t0 = Date.now();
for (const b of list) {
  if (!(b.elements.e < 1 && b.elements.aKm > 0)) continue;
  n++;
  const dep = K.parseUtc(b.best.launchDate), arr = dep + b.best.tofDays * DAY;
  const rf = K.targetRefusals(b, dep, arr);
  const soi = rf.some((r) => r.applies_to === 'arrival_geometry'), enc = rf.filter((r) => r.applies_to === 'target_ephemeris' && r.encounter_tdb_s_past_j2000 != null);
  if (rf.some((r) => r.applies_to === 'encounter_check')) partial++;
  if (b.tier === 'not-kepler-safe') notKepler++;
  if (soi) inSoi++;
  if (enc.length) pastEnc++;
  const refused = soi || enc.length > 0;
  if (refused) either++;
  if (b.best.c3 < 1) { lowC3++; if (refused) lowC3Refused++; }
  if (refused) cases.push({ designation: b.designation, c3: b.best.c3, launchDate: b.best.launchDate, tofDays: b.best.tofDays, inSoi: soi, encounter: enc.length ? { utc: K.utcOf(enc[0].encounter_tdb_s_past_j2000), distance_km: enc[0].encounter_distance_m / 1000 } : null, conditionCode: b.conditionCode });
}
cases.sort((p, q) => p.c3 - q.c3);
const out = {
  study: 'ideas/39-lamberts-road/study-encounters.mjs', aster: 'tests/fixtures/v2/nea-catalog-slice9.json + lambert-screen-cache.json at 62ddb17',
  rule: 'refused when the arrival of bestWindows[0] lies past an Earth encounter closer than ' + C.encounterAu + ' au after the element epoch (two-body, 1-day scan refined by golden section) or the body is inside the Earth\'s sphere of influence (' + Math.round(K.soi_m / 1000) + ' km) at arrival; encounters are looked for only inside the Earth ephemeris 2026-2040',
  bodies: n, refused: either, arrivalInsideSoi: inSoi, arrivalPastEncounter: pastEnc, encounterCheckPartial: partial, notKeplerSafeAmongAll: notKepler,
  bestC3Below1: lowC3, bestC3Below1Refused: lowC3Refused, seconds: Math.round((Date.now() - t0) / 1000),
  lowestRefused: cases.slice(0, 25)
};
fs.writeFileSync(path.join(here, 'snapshots', 'encounter-study.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(Object.assign({}, out, { lowestRefused: out.lowestRefused.slice(0, 5) }), null, 1));
