#!/usr/bin/env node
// Idea 48 (Catch): regenerates the derived snapshots. Nothing here is needed to open the page or run the tests.
//
//   node ideas/48-catch/build-data.mjs <dir>   <dir> holds what oracle/fetch-sources.sh downloaded. Each file's sha256 is
//                                              checked, every quoted passage is found verbatim in pdftotext's output (raw
//                                              or -layout, whitespace collapsed; poppler-utils needed for this step only),
//                                              every number taken is found inside its quote, and snapshots/entry-sources.js
//                                              is written with a hand-written provenance sidecar.
//   node ideas/48-catch/build-data.mjs --chain wraps idea 47's committed handoff.json as snapshots/way-home-handoff.js
//                                              (content unmodified, JSON-equal, with its sha256 for the pruned digest).
//   node ideas/48-catch/build-data.mjs --earth   derives snapshots/earth-radii.js (pck00010 BODY399_RADII) from idea 35's
//                                              excerpt of Aster's vendor/naif/pck00010.tpc.
//   node ideas/48-catch/build-data.mjs --sample  writes handoff.json from the kernel's default run on the chain.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.resolve(HERE, '../..');
const SNAP = path.join(HERE, 'snapshots');
const require = createRequire(import.meta.url);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const RETRIEVED = '2026-11-01';

// ------------------------------------------------------------------ the documents (all fetched by oracle/fetch-sources.sh)
const DOCS = {
  'stardust-edl-ops': { file: 'stardust-edl-ops.pdf', sha256: '4f4ed6b1dbc8f8339ab2329c366e355777a208ad04cec5793c468e2c64ea78a4', ntrs: '20090004445', title: 'Desai, Lyons, Tooley, Kangas: Entry, Descent, and Landing Operations Analysis for the Stardust Entry Capsule (2008)' },
  'stardust-reconstruction': { file: 'stardust-reconstruction.pdf', sha256: 'f4e0741ec7b44ee84a34c8fb82f4de6ffe6b589a7d97e51f81464de2dd8e6c3e', ntrs: '20080008567', title: 'Desai & Qualls: Stardust Entry Reconstruction, AIAA 2008-1198' },
  'stardust-aero': { file: 'stardust-aero.pdf', sha256: 'f58e78ca6c37c7e883829003669cbccb04f37f87d120683050628755d5034eee', ntrs: '20040105538', title: 'Mitcheltree, Wilmoth, Cheatwood, Brauckmann, Greene: Aerodynamics of Stardust Sample Return Capsule (AIAA 97-2304, 1997)' },
  'genesis-edl-ops': { file: 'genesis-edl-ops.pdf', sha256: '4421aabf365ef1a7d6ea7d0d3f676634480726577b231d4de63d319f3ae4161d', ntrs: '20080020376', title: 'Desai & Lyons: Entry, Descent, and Landing Operations Analysis for the Genesis Entry Capsule' },
  'genesis-reconstruction': { file: 'genesis-reconstruction.pdf', sha256: '05ffe3a74600d86eedbd9d3a393dbcabe7cec8ff0a77cd2a99a0e73f79ebcee0', ntrs: '20080019649', title: 'Desai, Qualls & Schoenenberger: Reconstruction of the Genesis Entry' },
  'orex-edl': { file: 'orex-edl.pdf', sha256: '4cdfd7f0e0e5ef991156432800b5a4b983a69a6068f7864684714753b6576f66', ntrs: '20240000629', title: 'Entry, Descent, and Landing Analysis for the OSIRIS-REx Sample Return Capsule (AAS 2024)' },
  'orex-edl-performance': { file: 'orex-edl-performance.pdf', sha256: '0dc8b764aeb91ead1c320e30d638f8582f5bc6987647a0d484e244ae9fe695b2', ntrs: '20240014280', title: 'OSIRIS-REx Entry, Descent, and Landing Performance (AIAA SciTech 2025)' },
  'orex-nav': { file: 'orex-nav.pdf', sha256: 'bbd3d2b631179e158ed6dc0662de3f31b1316ed6c392ead8d0d2f5304a886080', ntrs: '20240000800', title: 'Getzandanner et al.: OSIRIS-REx Earth Return & Entry: Navigation Operations & Lessons Learned (AAS 24-151)' },
  'sutton-graves': { file: 'sutton-graves.pdf', sha256: 'bdc8c4241db8a665623a0c5466a55d7bbf738208f5c634543a8ef851a7718479', ntrs: '19720003329', title: 'Sutton & Graves: A General Stagnation-Point Convective-Heating Equation for Arbitrary Gas Mixtures, NASA TR R-376 (1971)' },
  'transhab-aerocapture': { file: 'transhab-aerocapture.pdf', sha256: 'bcaf5b01951e56d82da7a04599e707cbb7e2bc2104fd10dd48d8a1fc6ffe2576', ntrs: '20000102372', title: 'Earth Return Aerocapture for the TransHab/Ellipsled Vehicle (NASA, 2000)' },
  'apollo-aerothermo': { file: 'apollo-aerothermo.pdf', sha256: 'f9c0f4ed1c4275208ebcbcfbff5b9c2caa9bec5a2318fe5bdc457d1a62586f20', ntrs: '19720018273', title: 'Apollo Experience Report: Aerothermodynamics Evaluation, NASA TN D-6843 (1972)' },
  'arrm-trajectory': { file: 'arrm-trajectory.pdf', sha256: '02ae67bd172fc8fe7441d90925d51768ed1c54442f76484a42ea11ffce2f4174', ntrs: '20150001236', title: 'Interplanetary Trajectory Design for the Asteroid Robotic Redirect Mission Alternate Approach Trade Study (2014)' },
  'nssdca-moon': { file: 'moonfact.html', sha256: 'a468979dfb4179e36a3f6579cd2d1d4a475b5c6da29313fd470fa68ca1aa30c1', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html', title: 'NASA NSSDCA Moon Fact Sheet' },
};

// Every number the kernel takes from a document: [key, value, doc, quote, the literal inside the quote, scale to SI].
// The quote must be in the document; the literal must be in the quote; literal * scale must equal value.
const Q = [
  // Stardust
  ['stardust.mass_kg', 45.8, 'stardust-edl-ops', 'the 45.8 kg capsule was spun-up to 13.5 rpm', '45.8', 1],
  ['stardust.v_inertial_m_s', 12900, 'stardust-reconstruction', 'inertial flight-path angle for the Stardust capsule were 12.9 km/s and –8.2 deg, respectively', '12.9', 1000],
  ['stardust.fpa_final_deg', -8.21, 'stardust-edl-ops', 'The final orbit determination solution produced a nominal inertial entry flight-path angle of -8.21 deg', '-8.21', 1],
  ['stardust.r_ei_m', 6503140, 'stardust-edl-ops', 'interface (radius of 6503.14 km)', '6503.14', 1000],
  ['stardust.heading_deg', 102.9, 'stardust-reconstruction', 'azimuth orientation angle of 102.9 deg', '102.9', 1],
  ['stardust.lat_deg', 40.3167, 'stardust-edl-ops', '246.55 deg East Longitude and 40.3167 deg North Latitude', '40.3167', 1],
  ['stardust.lon_deg', 246.55, 'stardust-edl-ops', '246.55 deg East Longitude and 40.3167 deg North Latitude', '246.55', 1],
  ['stardust.peak_g_bet', 32.89, 'stardust-reconstruction', 'The maximum deceleration calculated from the BET was 32.89 Earth g as compared to 32.86 Earth g obtained from the nominal pre-entry predicted trajectory.', '32.89', 1],
  ['stardust.peak_g_pred', 32.86, 'stardust-reconstruction', 'The maximum deceleration calculated from the BET was 32.89 Earth g as compared to 32.86 Earth g obtained from the nominal pre-entry predicted trajectory.', '32.86', 1],
  ['stardust.drogue_t_s', 137.9, 'stardust-reconstruction', 'Drogue parachute deployment occurred at 09:59:00.2 UTC, which was 137.9 s after entry.', '137.9', 1],
  ['stardust.drogue_alt_m', 31030, 'stardust-reconstruction', 'The corresponding Mach number (M) and altitude (h) at drogue deployment were 1.23 and 31.03 km MSL', '31.03', 1000],
  ['stardust.drogue_mach', 1.23, 'stardust-reconstruction', 'The corresponding Mach number (M) and altitude (h) at drogue deployment were 1.23 and 31.03 km MSL', '1.23', 1],
  ['stardust.req_g', 40, 'stardust-edl-ops', 'Max Deceleration, Earth g < 40', '40', 1],
  ['stardust.req_q_W_cm2', 1200, 'stardust-edl-ops', 'Max Heat Rate, W/cm2 < 1200', '1200', 1],
  ['stardust.req_fpa_err_deg', 0.08, 'stardust-edl-ops', 'Entry Flight-Path Angle Error, deg < ±0.08', '0.08', 1],
  ['stardust.nose_radius_m', 0.2286, 'stardust-aero', 'nose radius equal to 0.2286 m', '0.2286', 1],
  ['stardust.diameter_m', 0.8128, 'stardust-aero', 'overall diameter of 0.8128 m', '0.8128', 1],
  ['stardust.area_m2', 0.51887, 'stardust-aero', 'frontal area of the vehicle (0.51887 m', '0.51887', 1],
  // Genesis
  ['genesis.mass_kg', 205.6, 'genesis-edl-ops', 'the 205.6 kg Genesis SRC was spun-up to 15 rpm', '205.6', 1],
  ['genesis.diameter_m', 1.5, 'genesis-edl-ops', 'The Genesis sample return capsule (SRC) is approximately 1.5 m in diameter.', '1.5', 1],
  ['genesis.v_inertial_m_s', 11040, 'genesis-reconstruction', '11.04 km/sec and –8.0 deg, respectively', '11.04', 1000],
  ['genesis.fpa_final_deg', -8.002, 'genesis-edl-ops', 'entry flight-path angle of -8.002 deg', '-8.002', 1],
  ['genesis.heading_deg', 137.2, 'genesis-edl-ops', 'azimuth orientation angle of 137.2 deg', '137.2', 1],
  ['genesis.lat_deg', 40.2, 'genesis-edl-ops', '246.4667 deg East Longitude and 40.2 deg North Latitude', '40.2', 1],
  ['genesis.lon_deg', 246.4667, 'genesis-edl-ops', '246.4667 deg East Longitude and 40.2 deg North Latitude', '246.4667', 1],
  ['genesis.peak_g_bet', 27.0, 'genesis-reconstruction', 'The maximum deceleration obtained from the BET is 27.0 Earth g as compared to 27.2 Earth g from the nominal', '27.0', 1],
  ['genesis.peak_g_pred', 27.2, 'genesis-reconstruction', 'The maximum deceleration obtained from the BET is 27.0 Earth g as compared to 27.2 Earth g from the nominal', '27.2', 1],
  ['genesis.req_g', 40, 'genesis-edl-ops', 'Max Deceleration, Earth g < 40', '40', 1],
  ['genesis.req_q_W_cm2', 510, 'genesis-edl-ops', 'Max Heat Rate, W/cm2 < 510', '510', 1],
  // OSIRIS-REx
  ['osirisrex.r_ei_m', 6503142, 'orex-edl-performance', 'which is defined at a radius of 6503.142 km from the center of the Earth', '6503.142', 1000],
  ['osirisrex.fpa_deg', -8.2, 'orex-edl-performance', 'Atmospheric entry conditions were designed to occur at a flight path angle of -8.2 degrees with a velocity of 12.38 km/s.', '-8.2', 1],
  ['osirisrex.v_relative_m_s', 12380, 'orex-nav', '(Ventry = 12.38 km/s)', '12.38', 1000],
  ['osirisrex.pred_peak_q_W_cm2', 720, 'orex-edl-performance', 'the vehicle was expected to experience a peak heating of 720 W/cm2 and peak deceleration of 32 g’s [5]', '720', 1],
  ['osirisrex.pred_peak_g', 32, 'orex-edl-performance', 'the vehicle was expected to experience a peak heating of 720 W/cm2 and peak deceleration of 32 g’s [5]', '32', 1],
  ['osirisrex.empty_mass_kg', 49.64, 'orex-edl', 'The as-built empty SRC was weighed at 49.64 kg', '49.64', 1],
  ['osirisrex.sample_mass_kg', 0.1216, 'orex-edl-performance', 'the final measured mass after retrieval from the SRC was 121.6 g', '121.6', 0.001],
  ['osirisrex.peak_heating_obs_s', 53.854, 'orex-edl', 'Peak heating 14:42:47.854 14:42:46.000 1.854', '14:42:47.854', null],
  ['osirisrex.peak_heating_sim_s', 52, 'orex-edl', 'Peak heating 14:42:47.854 14:42:46.000 1.854', '14:42:46.000', null],
  ['osirisrex.ei_utc', '2023-09-24T14:41:54Z', 'orex-edl', 'Entry Interface 14:41:54.000 14:41:54.000 0.000', '14:41:54.000', null],
  ['osirisrex.tcm11_days', 14, 'orex-edl', 'TCM-11 E-14 days Yes OD367 (final design) 23.814 cm/s', '14', 1],
  ['osirisrex.tcm11_dv_m_s', 0.23814, 'orex-edl', 'TCM-11 E-14 days Yes OD367 (final design) 23.814 cm/s', '23.814', 0.01],
  // Sutton & Graves (air: 0.2320 O2 - 0.7680 N2 by mass), Table II least-squares coefficient
  ['sutton_graves.K_air', 0.1113, 'sutton-graves', '0.232002-0.7680 N2 (air) .1113 3.3 9.8', '.1113', 1],
  ['sutton_graves.atm_Pa', 101325, 'sutton-graves', '(1 atmosphere equals 101.325 kN/m2)', '101.325', 1000],
  // TransHab / Apollo-derived capsule (NASA LaRC data, POST 3-DOF, 1976 atmosphere)
  ['apollo_derived.mass_kg', 6500, 'transhab-aerocapture', 'The vehicle has a mass of 6500 kg, a reference length of 4.42 meters, and a surface area of 15.34 square meters.', '6500', 1],
  ['apollo_derived.diameter_m', 4.42, 'transhab-aerocapture', 'The vehicle has a mass of 6500 kg, a reference length of 4.42 meters, and a surface area of 15.34 square meters.', '4.42', 1],
  ['apollo_derived.area_m2', 15.34, 'transhab-aerocapture', 'The vehicle has a mass of 6500 kg, a reference length of 4.42 meters, and a surface area of 15.34 square meters.', '15.34', 1],
  ['apollo_derived.cl', 0.466, 'transhab-aerocapture', 'The lift coefficient was found to be 0.466 while the drag coefficient was 1.269.', '0.466', 1],
  ['apollo_derived.cd', 1.269, 'transhab-aerocapture', 'The lift coefficient was found to be 0.466 while the drag coefficient was 1.269.', '1.269', 1],
  ['transhab.target_alt_m', 407000, 'transhab-aerocapture', 'The nominal target orbit was circular with an altitude of 407 km.', '407', 1000],
  ['transhab.g_limit', 5, 'transhab-aerocapture', 'The maximum deceleration was not allowed to exceed 5 G during a trajectory.', '5', 1],
  ['transhab.entry_alt_m', 121900, 'transhab-aerocapture', 'atmospheric entry was considered to occur at an altitude of 121,900 meters', '121,900', null],
  ['transhab.corridor_min_deg', 0.7, 'transhab-aerocapture', 'width of at least 0.7 degrees for entry speeds up to 14.0 km/s', '0.7', 1],
  ['transhab.raise_budget_m_s', 230, 'transhab-aerocapture', 'budgeted a AV of 230 rn/s for final orbital adjustments into a 407 km orbit', '230', 1],
  // Apollo
  ['apollo.radius_ft', 6.417, 'apollo-aerothermo', 'command module maximum radius measured from center-line axis, 6.417 ft', '6.417', 1],
  // NASA's lunar-gravity-assist capture figure (ARRM)
  ['lga.c3_decrease_m2_s2', 2e6, 'arrm-trajectory', 'Another series of lunar gravity assists on the return to the Earth-Moon system allows for a decrease in C3 of up to 2 km2/s2 to capture energy with small propellant requirements.', '2 km2/s2', null],
];
const PROSE = [  // quoted passages the page and README lean on, found verbatim
  ['apollo-aerothermo', 'For the Apollo superorbital flight regime, radiative heating is approximately one-third of the total heating rate.'],
  ['apollo-aerothermo', 'radius, 6. 417 feet (one-half'],
  ['sutton-graves', 'Radiative heating was neglected in the present study'],
  ['sutton-graves', 'K heat-transfer coefficient defined by equation (33)'],
  ['stardust-aero', 'Table 4 Axisymnietric Results from LAURA.'],
  ['stardust-aero', 'Little variation in the predicted values occurs across the entire hypersoniccontinuum regime'],
  ['orex-edl-performance', 'and is the same 60 degree half-angle forebody as Stardust'],
  ['orex-edl', 'it has the same maximum diameter'],
  ['orex-nav', 'atmosphere-relative re-entry speed no greater'],
  ['transhab-aerocapture', '1976 U.S. Standard Atmosphere'],
  ['genesis-reconstruction', '8.1% drag reduction between the capsule CD and the atmospheric density cannot be determined'],
  ['orex-edl-performance', 'atmospheric density being much lower than was Earth-GRAM was predicting'],
  ['orex-nav', 'or approximately 133 km above Mean Sea Level'],
];
// Stardust's zero-angle-of-attack axial coefficient in the hypersonic continuum (LAURA), Table 4 of the aerodynamics
// paper. The text layer of that table is incomplete, so the rows were transcribed from the page image (PDF page 4); the
// six values the text layer does carry are checked against it. Mach and C_A, in the order of the table.
const STARDUST_CA = { mach: [42.7, 40, 35.4, 24.7, 17.1, 12.2, 10.5, 8.5, 7.15], ca: [1.5636, 1.4959, 1.4828, 1.4816, 1.4939, 1.4992, 1.515, 1.510, 1.506] };
const STARDUST_CA_IN_TEXT = ['1.5636', '1.4959', '1.4828', '1.4939', '1.510', '1.506'];

function setPath(o, key, v) { const p = key.split('.'); let x = o; for (let i = 0; i < p.length - 1; i++) x = x[p[i]] = x[p[i]] || {}; x[p[p.length - 1]] = v; }
function textOf(file) {
  const norm = (s) => s.replace(/-\n(?=[a-z])/g, '').replace(/\s+/g, ' ');
  if (file.endsWith('.html')) return [norm(fs.readFileSync(file, 'latin1').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' '))];
  const raw = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const lay = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return [norm(raw), norm(lay)];
}

function buildSources(dir) {
  const texts = {}, docs = [];
  for (const [id, d] of Object.entries(DOCS)) {
    const f = path.join(dir, d.file), buf = fs.readFileSync(f), h = sha(buf);
    if (h !== d.sha256) throw new Error(`${d.file}: sha256 ${h} is not the one recorded (${d.sha256})`);
    texts[id] = textOf(f);
    docs.push({ id, title: d.title, url: d.url || `https://ntrs.nasa.gov/citations/${d.ntrs}`, sha256: h, bytes: buf.length });
  }
  const has = (id, q) => texts[id].some((t) => t.includes(q));
  const out = { retrieved: RETRIEVED, documents: docs, quotes: [] };
  for (const [key, value, id, quote, lit, scale] of Q) {
    if (!has(id, quote)) throw new Error(`quote for ${key} not found in ${id}: ${quote}`);
    if (!quote.includes(lit)) throw new Error(`literal ${lit} not inside the quote for ${key}`);
    if (scale !== null) { const v = parseFloat(lit) * scale; if (Math.abs(v - value) > 1e-9 * Math.max(1, Math.abs(value))) throw new Error(`${key}: ${lit} x ${scale} = ${v}, not ${value}`); }
    setPath(out, key, value);
    out.quotes.push({ key, doc: id, quote });
  }
  // literals that are not plain decimals, checked by hand here
  if (out.transhab.entry_alt_m !== 121900) throw new Error('121,900 m');
  const tObs = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + x; };
  if (Math.abs(tObs('14:42:47.854') - tObs('14:41:54.000') - out.osirisrex.peak_heating_obs_s) > 1e-9) throw new Error('OREx peak heating time');
  if (Math.abs(tObs('14:42:46.000') - tObs('14:41:54.000') - out.osirisrex.peak_heating_sim_s) > 1e-9) throw new Error('OREx sim peak heating time');
  for (const [id, quote] of PROSE) { if (!has(id, quote)) throw new Error(`prose quote not found in ${id}: ${quote}`); out.quotes.push({ key: 'prose', doc: id, quote }); }
  for (const v of STARDUST_CA_IN_TEXT) if (!has('stardust-aero', v)) throw new Error(`C_A ${v} not in the text layer`);
  out.stardust.ca = { mach: STARDUST_CA.mach, ca: STARDUST_CA.ca, note: 'Table 4 (LAURA, zero angle of attack, hypersonic continuum), transcribed from the page image; ' + STARDUST_CA_IN_TEXT.join(', ') + ' are also in the PDF text layer' };
  // NSSDCA Moon fact sheet: the orbit and the radius (table cells; the parse is checked against the page's own words)
  const mt = texts['nssdca-moon'][0];
  const cell = (label) => { const i = mt.indexOf(label); if (i < 0) throw new Error('NSSDCA: ' + label); return parseFloat(mt.slice(i + label.length).trim().split(' ')[0]); };
  out.moon = {
    a_m: cell('Semimajor axis (10 6 km)') * 1e9, perigee_m: cell('Perigee (10 6 km)*') * 1e9, apogee_m: cell('Apogee (10 6 km)*') * 1e9,
    radius_m: cell('Volumetric mean radius (km)') * 1e3, v_mean_m_s: cell('Mean orbital velocity (km/s)') * 1e3,
    source: 'NASA NSSDCA Moon Fact Sheet: Semimajor axis, Perigee, Apogee (10^6 km), Volumetric mean radius (km), Mean orbital velocity (km/s)',
  };
  for (const [k, v] of Object.entries(out.moon)) if (k !== 'source' && !(v > 0)) throw new Error('moon ' + k);
  out.osirisrex.ei_utc = '2023-09-24T14:41:54Z';
  return out;
}

function writeSources(dir) {
  const S = buildSources(dir);
  const body = `/* Outside sources idea 48 (Catch) takes numbers from: NASA technical reports (NTRS) and the NSSDCA Moon fact sheet.
 * GENERATED by ideas/48-catch/build-data.mjs from the files oracle/fetch-sources.sh downloads; do not edit. Every number
 * sits beside the quote it was read from, and the build found each quote verbatim in its document. SI units unless the
 * key says otherwise. Classic script (window.CatchSources) and require(). */
(function (root) {
  var D = ${JSON.stringify(S, null, 1)};
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.CatchSources = D;
})(typeof self !== 'undefined' ? self : this);
`;
  const p = path.join(SNAP, 'entry-sources.js');
  fs.writeFileSync(p, body);
  const per = S.documents.map((d) => d.sha256);
  const side = {
    repo: 'https://ntrs.nasa.gov (NASA Technical Reports Server, 12 documents) ; https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
    path: S.documents.map((d) => `${d.id}: ${d.url}`).join(' ; '),
    commit: `retrieved ${RETRIEVED}`,
    retrieved: RETRIEVED,
    sourceSha256: sha(per.join('\n')),
    sourceSha256Rule: 'sha256 of the newline-joined per-document sha256 values in documents[] (in that order)',
    license: 'US Government work (NASA technical reports on NTRS and the NSSDCA fact sheet; public domain in the US). The AIAA/AAS papers are NASA-authored and carry no US copyright.',
    note: 'derived by build-data.mjs: every number sits beside its quote, each quote found verbatim in pdftotext output of its document (raw or -layout), each number found inside its quote; Stardust\'s C_A table transcribed from the page image (six of nine values also in the text layer); Moon values parsed from the fact sheet table',
    writtenSha256: sha(fs.readFileSync(p)),
    writtenBytes: fs.statSync(p).size,
    mode: 'derived',
  };
  fs.writeFileSync(p + '.provenance.json', JSON.stringify(side, null, 2) + '\n');
  console.log('wrote', path.relative(BANK, p), side.writtenBytes, 'bytes;', S.quotes.length, 'quotes checked');
}

function writeChain() {
  const src = path.join(BANK, 'ideas/47-way-home/handoff.json');
  const txt = fs.readFileSync(src, 'utf8'), h = JSON.parse(txt);
  const json = JSON.stringify(h);
  const digest = { pruned: true, from: h.from, produced: h.produced, bytes: json.length, sha256: sha(json) };
  const body = `/* Idea 47 (Way Home)'s committed handoff.json, the chain's Earth arrival, unmodified (the build checks JSON equality).
 * GENERATED by ideas/48-catch/build-data.mjs --chain; do not edit. "digest" is the sha256 of JSON.stringify(handoff),
 * which a handoff exported by this page carries in place of the whole when it is this sample. Classic script
 * (window.CatchWayHome) and require(). */
(function (root) {
  var D = { digest: ${JSON.stringify(digest)}, handoff: ${json} };
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.CatchWayHome = D;
})(typeof self !== 'undefined' ? self : this);
`;
  const p = path.join(SNAP, 'way-home-handoff.js');
  fs.writeFileSync(p, body);
  const back = require(p);
  if (JSON.stringify(back.handoff) !== json) throw new Error('wrapped handoff is not JSON-equal');
  execFileSync(process.execPath, [path.join(BANK, 'tools/snapshot.mjs'), BANK, 'ideas/47-way-home/handoff.json', p, '--sidecar-only', '--note',
    "derived by build-data.mjs --chain: idea 47's committed handoff.json, parsed and written back as a classic script (window.CatchWayHome) with the sha256 of its JSON.stringify form, content unmodified (the build checks JSON equality), so the page opens on the chain with no network"], { stdio: 'inherit' });
}

// The cases the independent oracle (oracle/entry-oracle.py) flies: initial states, vehicles and constants from this
// kernel, so the oracle shares the inputs and nothing of the method.
function writeOracleCases() {
  const { K } = require(path.join(HERE, 'load.cjs'));
  const veh = (v) => ({ id: v.id, mass_kg: v.mass_kg, area_m2: v.area_m2, rn_m: v.rn_m, cl: v.cl, cd: v.cd });
  const cases = [];
  for (const id of ['stardust', 'genesis', 'osirisrex']) {
    const A = K.arrivalFromFlight(id), v = K.vehicle(A.flight.vehicle);
    cases.push({ id, kind: 'peak', bank_deg: 0, r: A.x0.r, v: A.x0.v, vehicle: veh(v) });
  }
  const R = K.run(K.defaults(), null), arr = R.arrival, b = K.builderOf(arr), V = R.vehicle;
  const d = R.options.direct, ac = R.options.aerocapture;
  cases.push({ id: 'chain_direct', kind: 'peak', bank_deg: K.defaults().bankDeg, gamma_deg: d.gamma, r: b(d.gamma).r, v: b(d.gamma).v, vehicle: veh(V) });
  for (const [nm, g, bank] of [['chain_aero_down', ac.corridor.shallow_deg, 180], ['chain_aero_up', ac.corridor.steep_deg, 0], ['chain_aero_mid', ac.corridor.mid_deg, 90]])
    cases.push({ id: nm, kind: 'aero', bank_deg: bank, gamma_deg: g, apo_target_m: R.S.targetAlt_m, vinfVec: arr.vinfVec, hHat: arr.hHat, rEI: arr.rEI, vehicle: veh(V) });
  const out = { constants: { mu: K.MU, re: K.RE, rc: K.RC, omega: K.OMEGA, g0: K.G0, atm_top_m: K.ATM_TOP, k_sg: K.K_SG, mu_moon: K.MU_MOON, mu_em: K.MU_EM, moon_a_m: K.MOON.a_m, moon_r_m: K.MOON.radius_m },
    cases, lunar: { vinf_m_s: [1000, 1500, 1855.2435477899066, 3000, arr.vinf], threshold_vinf_m_s: K.lunarThreshold(K.MOON.a_m, K.MOON.radius_m), patched: [1000, 1500, 3000, arr.vinf].map((vi) => K.lunarBest(vi * vi, K.MOON.a_m, K.MOON.radius_m)) } };
  fs.writeFileSync(path.join(HERE, 'oracle/cases.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote oracle/cases.json', cases.length, 'cases');
}

function writeSample() {
  const { K } = require(path.join(HERE, 'load.cjs'));
  const R = K.run(K.defaults(), { chain: true });
  if (R.refusal) throw new Error('the default run refused: ' + R.refusal.reason);
  const H = K.buildHandoff(R, '2026-11-01T18:00:00Z');
  fs.writeFileSync(path.join(HERE, 'handoff.json'), JSON.stringify(H, null, 1) + '\n');
  console.log('wrote handoff.json', JSON.stringify(H).length, 'bytes');
}

function writeEarth() {
  const src = path.join(BANK, 'ideas/35-max-q/snapshots/pck00010-earth.txt');
  const lines = fs.readFileSync(src, 'utf8').split('\n').filter((l) => /BODY399_RADII\s*=\s*\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*\)/.test(l));
  const vals = lines.map((l) => l.match(/\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/).slice(1, 4).map(Number));
  if (!vals.length || !vals.every((v) => v.join() === vals[0].join())) throw new Error('BODY399_RADII lines disagree');
  const [a, b, c] = vals[0];
  if (a !== b) throw new Error('not an oblate spheroid');
  const D = { a_m: a * 1000, c_m: c * 1000, line: lines[lines.length - 1].trim(), source: "Aster vendor/naif/pck00010.tpc BODY399_RADII (km), via idea 35's excerpt snapshots/pck00010-earth.txt" };
  const body = `/* The Earth's equatorial and polar radii, pck00010 BODY399_RADII (Aster's vendor/naif/pck00010.tpc).
 * GENERATED by ideas/48-catch/build-data.mjs --earth; do not edit. Classic script (window.CatchEarthRadii) and require(). */
(function (root) {
  var D = ${JSON.stringify(D)};
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.CatchEarthRadii = D;
})(typeof self !== 'undefined' ? self : this);
`;
  const p = path.join(SNAP, 'earth-radii.js');
  fs.writeFileSync(p, body);
  execFileSync(process.execPath, [path.join(BANK, 'tools/snapshot.mjs'), BANK, 'ideas/35-max-q/snapshots/pck00010-earth.txt', p, '--sidecar-only', '--note',
    "derived by build-data.mjs --earth: the BODY399_RADII line of idea 35's excerpt of Aster's vendor/naif/pck00010.tpc (62ddb17), parsed (equatorial 6378.1366 km, polar 6356.7519 km)"], { stdio: 'inherit' });
}

const arg = process.argv[2];
if (!arg || arg === '--help') { console.log('usage: build-data.mjs <dir from oracle/fetch-sources.sh> | --chain | --earth | --oracle-cases | --sample'); process.exit(arg ? 0 : 2); }
if (arg === '--chain') writeChain();
else if (arg === '--earth') writeEarth();
else if (arg === '--oracle-cases') writeOracleCases();
else if (arg === '--sample') writeSample();
else writeSources(arg);
