#!/usr/bin/env node
// Round-Trip Ledger, command line. Node built-ins only; see --help. Exit 0 when every reconciliation
// holds, 1 on a failed reconciliation or a refusal (printed as JSON), 2 on a usage error.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Ledger = require(path.join(here, 'ledger.js'));
const DATA = require(path.join(here, 'nhats-data.js'));

const HELP = `Round-Trip Ledger: Aster's ΔV stack measured against JPL NHATS min-ΔV round trips.

Usage: node ideas/05-round-trip-ledger/ledger.mjs [options]
  (no options)            print the study report
  --body <designation>    print one body's two ledgers (Aster-style stack, NHATS record), as text;
                          '2003_YN107' (the fixture file form) and surrounding spaces are accepted
  --mode <m>              one-way | sample-return (default sample-return; with --body)
  --json <file>           write the statistics and seven extreme bodies as JSON (the per-body table is the report)
  --svg <file>            write the departure/arrival ratio histogram as SVG
  --help                  this text
Exit 0 when every reconciliation holds (injection reproduction, NHATS totals); 1 otherwise or on a refusal.`;

function parseArgs(argv) {
  const o = { body: null, mode: 'sample-return', json: null, svg: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--body') {
      o.body = Ledger.normDes(next());
      if (!o.body) throw new Error('--body needs a designation');
    }
    else if (a === '--mode') o.mode = next();
    else if (a === '--json') o.json = next();
    else if (a === '--svg') o.svg = next();
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');
const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : 'n/a');
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');
const ms = (kmps) => `${(kmps * 1000).toFixed(1)} m/s`;
const ms3 = (kmps) => `${(kmps * 1000).toFixed(3)} m/s`;
const pad = (s, n) => String(s).padEnd(n);
const NOTE_SHORT = 'research note perplexity-jpl-trajectory-browser-nhats.md:31,40-42,46';
const rpad = (s, n) => String(s).padStart(n);

export function ratioBins(K, rows) {
  // thirteen geometric bins from 2^-2.5 to 2^4, symmetric about 1 (the symmetric-return assumption)
  return K.histogram(rows.map((r) => r.ratio), K.geometricEdges(Math.pow(2, -2.5), 16, 13));
}

export function report(K) {
  const S = K.stats();
  const C = K.constants;
  const L = [];
  const p = (s = '') => L.push(s);
  p('ROUND-TRIP LEDGER — Aster ΔV stack vs JPL NHATS min-ΔV round trips');
  p(`Aster ${K.aster.repo} @ ${K.aster.commit.slice(0, 7)} (${K.aster.commitDate.slice(0, 10)}); fixtures ${K.fixtureDirs.join(', ')}`);
  p(`NHATS records: ${K.signature.source} v${K.signature.version}; object records computed ${S.computed.earliest} .. ${S.computed.latest}`);
  p(`Files ${S.counts.fixtureFiles} = ${S.counts.records} min_dv_traj records + ${S.counts.notFound} 'not found' (${K.notFound.map((n) => n.des).join(', ')}); ${S.counts.duplicates} designations in both directories (${K.duplicates.map((d) => d.des).join(', ')}; identical records: ${S.counts.duplicatesIdentical}); unique bodies ${S.counts.uniqueBodies}`);
  const Lw = S.launch;
  const W = Lw.screeningWindow;
  const G = Lw.porkchopGrid;
  const Ct = S.constraints;
  p(`NHATS launch dates ${Lw.earliestYear}-${Lw.latestYear}: ${Lw.beforeWindow} before, ${Lw.inWindow} inside and ${Lw.afterWindow} after Aster's screening-cache window ${W.startUtc}..${W.endUtc} (cache metadata); ${G.inGrid} inside the porkchop grid's departures ${G.startUtc}..${G.endUtc} (main.ts:${G.lines.join('-')}; ${G.inWindowNotGrid.join(', ')} fall between)`);
  for (const [k, c] of Object.entries(Lw.byDir)) p(`   ${k}: ${c.n} records, ${c.inWindow} inside the window, ${c.n - c.inWindow} outside`);
  p(`NHATS constraints these trajectories obey (${NOTE_SHORT}): total ≤ ${Ct.maxDurationDays} d (records ${Ct.durTotal.min}..${Ct.durTotal.max} d, ${Ct.atDurationCap} bodies at the cap); stay ≥ ${Ct.minStayDays} d (${Ct.atMinStay} of ${S.counts.uniqueBodies} bodies, ${Ct.atMinStayRecords} of ${S.counts.records} records, at the minimum); ${K.cited.NHATS_PARKING_ALTITUDE_KM.value} km parking orbit; entry ≤ ${K.cited.NHATS_ENTRY_SPEED_CAP_KMPS.value} km/s at ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km; launch ${Ct.launchWindow}`);
  p();
  p('1. INJECTION — Aster injectionDvFromC3 (delta-v.ts:18-26) reproduces NHATS dv_dep_park');
  const I = S.injection;
  const half = S.rounding.halfUnitKmps;
  p(`   at r = ${C.NHATS_PARKING_RADIUS_KM.toFixed(3)} km (R_E ${C.EARTH_RADIUS_KM.toFixed(3)} + ${K.cited.NHATS_PARKING_ALTITUDE_KM.value} km): max |Δ| over ${S.counts.records} records = ${ms3(I.maxAbsDeltaAtNhatsRadiusKmps)}; the records carry ${S.rounding.decimals} decimals, so rounding alone allows ±${ms(half)} on dv_dep_park plus c3's ±${half} km²/s² carried through 1/(2·v_perigee), at most ${ms3(I.roundingBoundKmps)}; every record within its bound: ${I.allWithinRounding}`);
  p(`   best-fit radius on a ${I.fitRangeKm.step} km grid ${I.fitRangeKm.lo.toFixed(0)}-${I.fitRangeKm.hi.toFixed(0)} km: ${I.bestFitRadius.radiusKm.toFixed(3)} km (max |Δ| ${ms3(I.bestFitRadius.maxAbsDeltaKmps)})`);
  p(`   at Aster's own r = ${C.LEO_PARKING_RADIUS_KM.toFixed(3)} km (${K.cited.LEO_ALTITUDE_KM.value} km LEO): Aster − NHATS = ${ms(I.deltaAtAsterRadiusKmps.min)} .. ${ms(I.deltaAtAsterRadiusKmps.max)}, ${I.asterRadiusTimesWorse.toFixed(0)}× the worst |Δ| at ${K.cited.NHATS_PARKING_ALTITUDE_KM.value} km (a convention difference, not an error)`);
  p(`   NHATS's own ledger: dv_total − (dv_dep_park + vrel_arr_neo + vrel_dep_neo + vrel_arr_earth) max |residual| ${ms(S.nhatsLedger.maxAbsResidualKmps)} (five rounded numbers: bound ${ms(S.nhatsLedger.residualBoundKmps)}; all within: ${S.nhatsLedger.allSumsWithinRounding}); vrel_arr_earth = 0 for all: ${S.nhatsLedger.vrelArrEarthAllZero}; |√c3 − v_dep_earth| max ${ms(S.nhatsLedger.maxAbsVDepEarthResidualKmps)} (all within rounding: ${S.nhatsLedger.allVDepEarthWithinRounding})`);
  p(`   NHATS c3 ${f3(S.nhatsLedger.c3.min)}..${f3(S.nhatsLedger.c3.max)} km²/s²; dv_total ${f3(S.nhatsLedger.dvTotal.min)}..${f3(S.nhatsLedger.dvTotal.max)} km/s; stay ${S.nhatsLedger.stayDays.min}..${S.nhatsLedger.stayDays.max} d`);
  p();
  p('2. THE SYMMETRIC-RETURN ASSUMPTION — delta-v.ts:32-34,45: departure Δv = arrival v∞. NHATS: vrel_dep_neo / vrel_arr_neo');
  const R = S.ratio;
  p(`   ${R.unique.n} unique bodies: min ${f3(R.unique.min)} (${R.unique.minBody}), q1 ${f3(R.unique.q1)}, median ${f3(R.unique.median)}, q3 ${f3(R.unique.q3)}, max ${f3(R.unique.max)} (${R.unique.maxBody})`);
  p(`   ${R.allRecords.n} records counting duplicates twice: min ${f3(R.allRecords.min)}, median ${f3(R.allRecords.median)}, max ${f3(R.allRecords.max)}`);
  const A0 = K.analysis;
  p(`   below 1: ${R.below1}; above 1: ${R.above1}; exactly 1: ${R.exactly1} (two-sided sign test p = ${f3(R.signTestP)}); within ±${A0.RATIO_WITHIN[0] * 100}%: ${R.within10pct}; within ±${A0.RATIO_WITHIN[1] * 100}%: ${R.within25pct}; off by ${A0.RATIO_FACTOR}× or more: ${R.offByTwoOrMore}`);
  p(`   departure − arrival: ${f3(S.departureMinusArrivalKmps.min)} .. ${f3(S.departureMinusArrivalKmps.max)} km/s, median ${f3(S.departureMinusArrivalKmps.median)}`);
  p(`   cost-card consequence on NHATS's own trajectories, at Isp ${C.SCREENING_ISP_S} s, g0 ${C.G0_MPS2}, ${(C.DETERMINISTIC_MARGIN_FRACTION * 100).toFixed(0)}% deterministic margin: delivered mass with NHATS's departure ÷ with the symmetric one = ${f3(S.massFactor.min)} (${S.massFactor.minBody}) .. ${f3(S.massFactor.max)} (${S.massFactor.maxBody}), median ${f3(S.massFactor.median)}; ${S.massFactor.below0p9} bodies below ${A0.MASS_BAND[0]}, ${S.massFactor.above1p1} above ${A0.MASS_BAND[1]}`);
  p(`   not measured at an Aster cell: for the same bodies the cache's cheapest-C3 window arrives with v∞ minus NHATS's vrel_arr_neo = ${f3(S.cache.vInfArrMinusNhatsKmps.min)} .. ${f3(S.cache.vInfArrMinusNhatsKmps.max)} km/s, median ${f3(S.cache.vInfArrMinusNhatsKmps.median)} (higher for ${S.cache.vInfArrAboveNhats} of ${S.cache.rows})`);
  p();
  const hist = ratioBins(K, S.rows);
  p('   ratio histogram (geometric bins, | marks 1.0):');
  const maxC = Math.max(...hist.bins.map((b) => b.count));
  for (const b of hist.bins) {
    const bar = '#'.repeat(Math.round((b.count / maxC) * 40));
    const mark = b.lo < 1 && b.hi >= 1 ? '|' : ' ';
    p(`   ${rpad(f3(b.lo), 7)} .. ${pad(f3(b.hi), 7)} ${rpad(b.count, 3)} ${mark}${bar}`);
  }
  if (hist.outside) p(`   (${hist.outside} outside the bins)`);
  p();
  p('3. EARTH ARRIVAL — v∞ implied by v_arr_earth (the K1/K2 interface quantity)');
  const A = S.arrival;
  p(`   v_arr_earth ${f3(A.vArrEarth.min)}..${f3(A.vArrEarth.max)} km/s; all ≤ ${A.entryCapKmps} km/s cap: ${A.allBelowCap}; escape speed at ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km ${f4(A.escapeAt125Kmps)}, at ${K.cited.TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM.value} km ${f4(A.escapeAt200Kmps)}`);
  p(`   v∞ at ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km [Likely]: ${f3(A.vinf125.min)} (${A.vinf125.minBody}; ±${S.rounding.halfUnitKmps} km/s rounding of v_arr_earth moves it to ${f3(A.vinf125.minRoundingLow)}..${f3(A.vinf125.minRoundingHigh)}) .. ${f3(A.vinf125.max)} (${A.vinf125.maxBody}), median ${f3(A.vinf125.median)}; refused (below escape) ${A.refusedAt125}`);
  p(`   v∞ at ${K.cited.TRAJECTORY_BROWSER_ENTRY_ALTITUDE_KM.value} km (Trajectory Browser convention): ${f3(A.vinf200.min)}..${f3(A.vinf200.max)} km/s`);
  p();
  p('4. DECLINATIONS — NHATS dec_dep / dec_arr against Aster\'s bands (feasibility.ts), frame [Likely] equatorial');
  const Dc = S.declination;
  const site = (s) => `GREEN |δ| ≤ ${s.iMinDeg}°, AMBER ≤ ${s.dlaCeilingDeg}°, RED beyond`;
  p(`   dec_dep ${f1(Dc.dep.min)}..${f1(Dc.dep.max)}°; ${C.sites.CAPE_CANAVERAL.name} (${site(C.sites.CAPE_CANAVERAL)}): GREEN ${Dc.depCape.GREEN}, AMBER ${Dc.depCape.AMBER}, RED ${Dc.depCape.RED}`);
  p(`   ${C.sites.VANDENBERG_SFB.name} (${site(C.sites.VANDENBERG_SFB)}): GREEN ${Dc.depVandenberg.GREEN}, AMBER ${Dc.depVandenberg.AMBER}, RED ${Dc.depVandenberg.RED}`);
  p(`   dec_arr (Earth arrival) ${f1(Dc.arr.min)}..${f1(Dc.arr.max)}°; against the Cape bands: GREEN ${Dc.arrCape.GREEN}, AMBER ${Dc.arrCape.AMBER}, RED ${Dc.arrCape.RED} (a return-leg quantity Aster has no band for yet)`);
  p();
  p(`5. ASTER SCREENING CACHE — same bodies, different objective (min outbound C3, one-way, ${W.startUtc}..${W.endUtc})`);
  const Ca = S.cache;
  p(`   ${Ca.rows} of ${Ca.of} bodies are in the cache excerpt; statuses ${JSON.stringify(Ca.statuses)}; co-orbital ${Ca.coOrbital}; cache minC3 < NHATS c3 for ${Ca.minC3BelowNhatsC3} of ${Ca.rows}; cache window ${Ca.screeningWindow ? `${Ca.screeningWindow.startUtc}..${Ca.screeningWindow.endUtc}` : 'n/a'}`);
  p('   Return leg in Aster: none (K1 is a CONCEPT kernel) — the departure line is either the symmetric assumption or NHATS\'s number.');
  p();
  p('6. PER BODY (sample-return; Aster-style stack from NHATS c3 and vrel_arr_neo; totals in km/s)');
  p('   stk.sym / stk.nh: the stack total with the symmetric / NHATS departure; nh.tot: NHATS dv_total; band: dec_dep at the Cape');
  p(`${pad('designation', 11)} ${rpad('c3', 6)} ${rpad('v∞arr', 5)} ${rpad('v∞dep', 5)} ${rpad('ratio', 6)} ${rpad('stk.sym', 7)} ${rpad('stk.nh', 6)} ${rpad('nh.tot', 6)} ${rpad('mass×', 5)} ${rpad('v∞⊕125', 6)} ${rpad('dec_dep', 7)} band  launch`);
  for (const r of [...S.rows].sort((a, b) => a.ratio - b.ratio)) {
    p(`${pad(r.des, 11)} ${rpad(f3(r.c3), 6)} ${rpad(f3(r.vrelArr), 5)} ${rpad(f3(r.vrelDep), 5)} ${rpad(f3(r.ratio), 6)} ${rpad(f3(r.stackSymmetricTotal), 7)} ${rpad(f3(r.stackNhatsTotal), 6)} ${rpad(f3(r.nhatsTotal), 6)} ${rpad(f3(r.massFactor), 5)} ${rpad(f3(r.vinf125), 6)} ${rpad(f1(r.decDep), 7)} ${pad(r.bandDepCape, 5)} ${r.launch}`);
  }
  p();
  p(`Fidelity: idea-bank prototype. NHATS field semantics are the API's; the ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km entry altitude and the equatorial declination frame are [Likely] (not settled here); everything else is arithmetic on snapshotted values [Certain], on NHATS's trajectories, not Aster's cells.`);
  // the reconciliations the exit code depends on (bounds from the records' own rounding)
  const checks = [
    { name: 'injection reproduces every dv_dep_park within its rounding bound', ok: S.injection.allWithinRounding },
    { name: 'NHATS dv_total equals the sum of its lines within rounding', ok: S.nhatsLedger.allSumsWithinRounding },
    { name: 'every unique body has a finite ratio', ok: S.rows.every((r) => Number.isFinite(r.ratio)) },
    { name: 'duplicate designations carry identical records', ok: S.counts.duplicatesIdentical },
  ];
  const failed = checks.filter((c) => !c.ok);
  p(`Checks: ${checks.length - failed.length}/${checks.length} hold${failed.length ? ` — FAILED: ${failed.map((c) => c.name).join('; ')}` : ''}`);
  return { text: `${L.join('\n')}\n`, stats: S, hist, ok: failed.length === 0 };
}

export function bodyText(K, des, mode) {
  const b = K.bodyLedger(des, { mode, departure: 'nhats' });
  if (b.refusal) return { ok: false, text: `${JSON.stringify({ des, ...b }, null, 2)}\n` };
  const L = [];
  const p = (s = '') => L.push(s);
  const row = (k, v) => p(`   ${pad(k, 38)} ${v}`);
  p(`${b.name}${b.name !== b.des ? ` (${b.des})` : ''} — NHATS min_dv_traj computed ${b.computed}, launch ${b.traj.launch}, out ${b.traj.dur_out} d, stay ${b.traj.dur_at} d, back ${b.traj.dur_ret} d`);
  p(`Aster-style stack, ${mode} (delta-v.ts port; inputs NHATS c3 ${f3(b.traj.c3)} km²/s² and vrel_arr_neo ${f3(b.traj.vrel_arr_neo)} km/s):`);
  const s = b.stackSymmetric;
  const n = b.stackNhats;
  row(`injection at ${K.cited.LEO_ALTITUDE_KM.value} km LEO`, `${f3(s.injectionKmps)} km/s`);
  row('rendezvous = arrival v∞', `${f3(s.rendezvousKmps)} km/s`);
  if (mode === 'sample-return') row('departure: symmetric | NHATS vrel_dep_neo', `${f3(s.departureKmps)} | ${f3(n.departureKmps)} km/s (ratio ${f3(b.ratio)})`);
  else row('departure (one-way)', 'none');
  row('stationkeeping', `${f3(s.stationkeepingKmps)} km/s`);
  row('subtotal: symmetric | NHATS departure', `${f3(s.subtotalKmps)} | ${f3(n.subtotalKmps)} km/s`);
  row(`margin ${(K.constants.DV_MARGIN_FRACTION * 100).toFixed(0)}%`, `${f3(s.marginKmps)} | ${f3(n.marginKmps)} km/s`);
  row('total', `${f3(s.totalKmps)} | ${f3(n.totalKmps)} km/s`);
  const park = K.cited.NHATS_PARKING_ALTITUDE_KM.value;
  p(`NHATS record (${park} km parking orbit, no stationkeeping, no margin, direct entry; total ${b.traj.dur_total} d of at most ${K.cited.NHATS_MAX_DURATION_DAYS.value}):`);
  row(`dv_dep_park | Aster injection at ${park} km`, `${f3(b.nhats.dv_dep_park)} | ${f3(b.injection.atNhatsRadiusKmps)} km/s (Δ ${ms(b.injection.deltaNhatsKmps)})`);
  row('vrel_arr_neo + vrel_dep_neo + vrel_arr_earth', `${f3(b.nhats.vrel_arr_neo)} + ${f3(b.nhats.vrel_dep_neo)} + ${f3(b.nhats.vrel_arr_earth)}`);
  row('dv_total | sum of lines', `${f3(b.nhats.dv_total)} | ${f3(b.nhats.sumKmps)} km/s`);
  if (mode === 'sample-return') row(`cost card, Isp ${K.constants.SCREENING_ISP_S} s: mass with NHATS dep ÷ symmetric`, `${f3(b.massFactor)} (spacecraft Δv ${b.costCardSymmetric.dvSpacecraftMps.toFixed(0)} → ${b.costCardNhats.dvSpacecraftMps.toFixed(0)} m/s)`);
  const a = b.arrival.atNhatsAltitude;
  row(`Earth arrival v∞ from v_arr_earth ${f3(b.arrival.vArrEarthKmps)} at ${K.cited.NHATS_ENTRY_ALTITUDE_KM.value} km`, a.refusal ? `refused: ${a.refusal.code}` : `${f3(a.value)} km/s (${f3(a.roundingLowKmps)}..${f3(a.roundingHighKmps)} from rounding)`);
  row('dec_dep | Cape band ; dec_arr', `${f1(b.declination.depDeg)}° ${b.declination.depBandCape} ; ${f1(b.declination.arrDeg)}°`);
  if (b.cache.refusal) row('Aster screening cache', `refused: ${b.cache.refusal.code}`);
  else row('Aster cache cheapest window (different objective)', `C3 ${f3(b.cache.minC3)} on ${b.cache.minC3Date}, TOF ${b.cache.minC3TofDays} d, v∞arr ${f3(b.cache.minC3VInfArr)} km/s (NHATS ${f3(b.traj.vrel_arr_neo)}), ${b.cache.status}${b.cache.isCoOrbital ? ', co-orbital' : ''}`);
  row('Aster return leg', `refused: ${b.returnLeg.refusal.code} — ${b.returnLeg.refusal.reason}`);
  return { ok: true, text: `${L.join('\n')}\n` };
}

// The statistics only (the per-body table is the report's section 6, example.txt); rows would add 50 KB.
// The ratio histogram SVG (--svg) is not saved in the folder: the page draws the same chart.
export function resultsJson(K, S) {
  const { rows, ...summary } = S;
  const keep = ['launch', 'c3', 'vrelArr', 'vrelDep', 'ratio', 'massFactor', 'vArrEarth', 'vinf125', 'decDep', 'bandDepCape'];
  const extremes = Object.fromEntries(['2008 EL68', '2025 WR7', '1999 AO10', '459872', '2011 WE', '2014 KF39', '101955'].map((d) => {
    const r = rows.find((x) => x.des === d);
    return [d, Object.fromEntries(keep.map((k) => [k, r[k]]))];
  }));
  const cited = Object.fromEntries(Object.entries(K.cited).map(([k, c]) => [k, c.value])); // the file:line of each is in ledger.js CITED
  // pretty-printed at the top, then one line per summary block and per extreme body
  const text = JSON.stringify({ tool: 'ideas/05-round-trip-ledger/ledger.mjs', version: Ledger.VERSION, aster: K.aster, nhats: K.signature, cited, citedIn: 'ledger.js CITED (each value with its file:line)', analysis: K.analysis, constants: K.constants, summary: '@SUMMARY@', bodies: rows.length, extremes: '@EXTREMES@', perBodyTable: 'example.txt §6 (node ideas/05-round-trip-ledger/ledger.mjs)' }, null, 1);
  const lines = (o) => `{\n  ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n  ')}\n }`;
  return `${text.replace('"@SUMMARY@"', lines(summary)).replace('"@EXTREMES@"', lines(extremes))}\n`;
}

export function svgText(K, S) {
  const hist = ratioBins(K, S.rows);
  return `${K.svgHistogram({ bins: hist.bins, scale: 'log', width: 640, height: 240, title: `NHATS departure v∞ ÷ arrival v∞ at the asteroid, ${S.ratio.unique.n} bodies (Aster assumes 1)`, xLabel: 'vrel_dep_neo / vrel_arr_neo (geometric bins)', marker: { x: 1, label: 'symmetric = 1' } })}\n`;
}

function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error(HELP);
    process.exit(2);
  }
  if (o.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!Ledger.MODES.includes(o.mode)) {
    console.error(`--mode must be one of ${Ledger.MODES.join(', ')}`);
    process.exit(2);
  }
  const K = Ledger.create(DATA);
  if (!K.ok) {
    console.error(JSON.stringify(K, null, 2));
    process.exit(1);
  }
  if (o.body) {
    const r = bodyText(K, o.body, o.mode);
    process.stdout.write(r.text);
    process.exit(r.ok ? 0 : 1);
  }
  const r = report(K);
  process.stdout.write(r.text);
  if (o.json) fs.writeFileSync(path.resolve(o.json), resultsJson(K, r.stats));
  if (o.svg) fs.writeFileSync(path.resolve(o.svg), svgText(K, r.stats));
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
