#!/usr/bin/env node
// Both Ends, command line. From the bank root:
//   node ideas/51-both-ends/cli.mjs                       census of all three tiers
//   node ideas/51-both-ends/cli.mjs --des 101955 --tier phase3 [--sample 50] [--reading reentry-200]
//   node ideas/51-both-ends/cli.mjs --list
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DATA = require('./snapshots/data.js');
const B = require('./both-ends.js').create(DATA);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Both Ends: an Aster round trip flown with a Skyhook tether at both ends.

  node cli.mjs                 census over the ${DATA.nhats.records.length} NHATS round trips, all three tiers
  node cli.mjs --des <des> --tier reference|cislunar|phase3 [--sample <kg>] [--reading entry-125|reentry-200]
  node cli.mjs --list          the designations

Exit status 1 on a refusal, 2 on bad usage.`);
  process.exit(0);
}
const n = (x, d = 3) => x.toFixed(d);
const kg = (x) => Math.round(x).toLocaleString('en-US');

if (args.includes('--list')) {
  for (const r of DATA.nhats.records) console.log(`${r.des.padEnd(12)} ${r.fullname}`);
  process.exit(0);
}

const des = opt('--des');
if (des) {
  const sample = opt('--sample');
  const m = B.mission(des, opt('--tier') || 'phase3', { sampleKg: sample === undefined ? 0 : Number(sample), reading: opt('--reading') || 'entry-125' });
  if (!m.ok) {
    console.error(`REFUSED (${m.code}): ${m.missing}\n  would help: ${m.wouldHelp}`);
    process.exit(1);
  }
  const o = m.outbound, i = m.inbound, t = m.tier;
  console.log(`${m.record.fullname}   NHATS min-dv round trip, launch ${m.record.launch}, ${m.record.dur_total} days`);
  console.log(`Tether: ${t.label} km/s (${t.detail}); release C3 at the top ${n(t.c3Max, 2)} km2/s2; mass ratio ${t.stated.massRatio}x`);
  console.log(`\nOUT   needs C3 ${n(o.c3Req)}   Aster injection from 200 km LEO ${n(o.asterInjectionKmps)} km/s (launch vehicle pays)`);
  console.log(o.mode === 'swing'
    ? `      tether: released ${n(o.thetaDeg, 1)} deg before the top of the swing, no burn`
    : `      tether: released at the top, then a ${n(o.trimKmps)} km/s burn (spacecraft pays)`);
  console.log(`AT    rendezvous ${n(m.asteroid.rendezvousKmps)}  departure ${n(m.asteroid.departureKmps)}  stationkeeping ${n(m.asteroid.stationkeepingKmps)} km/s, ${m.asteroid.marginFraction * 100} % margin, Isp ${m.asteroid.ispS} s`);
  console.log(`HOME  entry ${n(i.vEntry)} km/s at ${m.reading.altKm} km  ->  v-infinity ${n(i.vInf)} km/s`);
  console.log(i.mode === 'swing'
    ? `      tether: caught ${n(i.thetaDeg, 1)} deg from the top of the swing, no burn`
    : `      tether: a ${n(i.trimKmps)} km/s braking burn, then caught at the top`);
  console.log(`      handed down at the lower tip: ${n(i.handDownKmps, 2)} km/s at ${n(i.handDownAltKm, 0)} km, against a direct entry at ${n(i.vEntry)} km/s`);
  console.log(`\nMASS  tether path: ${kg(m.tether.releasedKg)} kg released -> ${kg(m.tether.atAsteroidKg)} at the asteroid -> ${kg(m.tether.caughtKg)} kg caught${m.tether.sampleKg ? ` (incl. ${kg(m.tether.sampleKg)} kg sample picked up)` : ''}`);
  for (const v of m.rocket) {
    console.log(v.refused
      ? `      ${`${v.name} ${v.config}`.padEnd(24)} REFUSED: C3 beyond its published curve (ends at ${v.curveMaxC3})`
      : `      ${`${v.name} ${v.config}`.padEnd(24)} ${kg(v.injectedKg).padStart(6)} kg injected -> ${kg(v.homeKg).padStart(6)} kg home, direct entry`);
  }
  console.log(`\nENERGY the tether lends ${n(m.energy.throwGJ, 1)} GJ (${n(m.energy.throwMJkg, 2)} MJ/kg) and gets back ${n(m.energy.catchGJ, 1)} GJ: ${n(m.energy.returnedFraction * 100, 1)} % returned, ${n(m.energy.netGJ, 1)} GJ left to reboost`);
  console.log('\nNOT ANSWERED');
  for (const r of m.refused) console.log(`  ${r.topic}: ${r.missing}\n    would help: ${r.wouldHelp}`);
  process.exit(0);
}

console.log(`Both Ends: ${DATA.nhats.records.length} JPL NHATS min-dv round trips (Aster fixtures @ ${DATA.aster.commit.slice(0, 7)}) on the three tether tiers of Skyhook rev_a.json @ ${String(DATA.skyhook.provenance.commit).slice(0, 7)}`);
console.log('Two-body, impulsive, energy only; entry speed read at 125 km. Plane, phase, launcher, catch and price are refused (see --des).\n');
console.log('tier        top C3   ratio   throws  catches  both   throw burn km/s      catch burn km/s      caught of 5,000 kg   energy returned');
console.log('            km2/s2      x     free    free    free   min   median  max    min   median  max    min   median  max    median');
for (const k of ['reference', 'cislunar', 'phase3']) {
  const c = B.census(k);
  const t = B.tier(k);
  console.log(
    `${k.padEnd(10)} ${n(t.c3Max, 2).padStart(7)} ${String(t.stated.massRatio).padStart(8)} ${String(c.throwFree).padStart(6)} ${String(c.catchFree).padStart(7)} ${String(c.bothFree).padStart(6)}   ` +
      `${n(c.throwTrim.min)} ${n(c.throwTrim.median)} ${n(c.throwTrim.max)}   ${n(c.catchTrim.min)} ${n(c.catchTrim.median)} ${n(c.catchTrim.max)}   ` +
      `${kg(c.caughtKg.min).padStart(5)} ${kg(c.caughtKg.median).padStart(6)} ${kg(c.caughtKg.max).padStart(6)}   ${n(c.returnedFraction.median * 100, 1)} %`
  );
}
const c = B.census('reference');
console.log(`\nFor scale, Aster's injection burn from 200 km LEO on the same trips: ${n(c.asterInjection.min)} to ${n(c.asterInjection.max)} km/s, median ${n(c.asterInjection.median)} (paid by the launch vehicle).`);
console.log(`"free" = the tip itself has the needed orbital energy somewhere on its swing, so no burn is owed at that end.`);
