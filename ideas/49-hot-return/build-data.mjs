#!/usr/bin/env node
// Idea 49 (Hot Return): regenerates the derived snapshots. Nothing here is needed to open the page or run the tests.
//
//   node ideas/49-hot-return/build-data.mjs <dir>    <dir> holds what oracle/fetch-sources.sh downloaded. Each file's sha256
//                                                   is checked (the NIST page excepted: it embeds a per-request script),
//                                                   every quoted passage is found verbatim in pdftotext's output (raw or
//                                                   -layout, whitespace collapsed; poppler-utils needed for this step only),
//                                                   every number taken is found inside its quote, and
//                                                   snapshots/reentry-sources.js is written with a hand-written sidecar.
//   node ideas/49-hot-return/build-data.mjs --chain  wraps idea 48's committed handoff.json as snapshots/catch-handoff.js
//                                                   (content unmodified, JSON-equal, with its sha256 for the pruned digest).
//   node ideas/49-hot-return/build-data.mjs --oracle-cases   writes oracle/cases.json (the states the oracle flies).
//   node ideas/49-hot-return/build-data.mjs --sample  writes handoff.json from the kernel's default run on the chain.
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
const N = (ntrs) => `https://ntrs.nasa.gov/citations/${ntrs}`;
const DOCS = {
  'stardust-edl-ops': { file: 'stardust-edl-ops.pdf', sha256: '4f4ed6b1dbc8f8339ab2329c366e355777a208ad04cec5793c468e2c64ea78a4', url: N('20090004445'), title: 'Desai, Lyons, Tooley, Kangas: Entry, Descent, and Landing Operations Analysis for the Stardust Entry Capsule (2008)' },
  'stardust-reconstruction': { file: 'stardust-reconstruction.pdf', sha256: 'f4e0741ec7b44ee84a34c8fb82f4de6ffe6b589a7d97e51f81464de2dd8e6c3e', url: N('20080008567'), title: 'Desai & Qualls: Stardust Entry Reconstruction, AIAA 2008-1198' },
  'genesis-edl-ops': { file: 'genesis-edl-ops.pdf', sha256: '4421aabf365ef1a7d6ea7d0d3f676634480726577b231d4de63d319f3ae4161d', url: N('20080020376'), title: 'Desai & Lyons: Entry, Descent, and Landing Operations Analysis for the Genesis Entry Capsule' },
  'genesis-reconstruction': { file: 'genesis-reconstruction.pdf', sha256: '05ffe3a74600d86eedbd9d3a393dbcabe7cec8ff0a77cd2a99a0e73f79ebcee0', url: N('20080019649'), title: 'Desai, Qualls & Schoenenberger: Reconstruction of the Genesis Entry' },
  'genesis-src-overview': { file: 'genesis-src-overview.pdf', sha256: 'dc26ee1281902c0f9d37921baebf05a8f682851f567efc04c18f5354bcd23cb0', url: N('20070014646'), title: 'Genesis Sample Return Capsule Overview (JPL / Lockheed Martin, 2nd International Planetary Probe Workshop, 2005)' },
  'orex-edl': { file: 'orex-edl.pdf', sha256: '4cdfd7f0e0e5ef991156432800b5a4b983a69a6068f7864684714753b6576f66', url: N('20240000629'), title: 'Entry, Descent, and Landing Analysis for the OSIRIS-REx Sample Return Capsule (AAS 2024)' },
  'orex-edl-performance': { file: 'orex-edl-performance.pdf', sha256: '0dc8b764aeb91ead1c320e30d638f8582f5bc6987647a0d484e244ae9fe695b2', url: N('20240014280'), title: 'OSIRIS-REx Entry, Descent, and Landing Performance (AIAA SciTech 2025)' },
  'apollo-aerothermo': { file: 'apollo-aerothermo.pdf', sha256: 'f9c0f4ed1c4275208ebcbcfbff5b9c2caa9bec5a2318fe5bdc457d1a62586f20', url: N('19720018273'), title: 'Apollo Experience Report: Aerothermodynamics Evaluation, NASA TN D-6843 (1972)' },
  'suttles-radfits': { file: 'suttles-radfits.pdf', sha256: 'ab14971536a6bfcf7990697b50bc9eb8800b1a62cd80d81c1ce11ba44a1a74ce', url: N('19740021216'), title: 'Suttles, Sullivan & Margolis: Curve Fits of Predicted Inviscid Stagnation-Point Radiative Heating Rates, Cooling Factors, and Shock Standoff Distances for Hyperbolic Earth Entry, NASA TN D-7622 (1974)' },
  'sutton-hartung-radtables': { file: 'sutton-hartung-radtables.pdf', sha256: 'ccd49d4befc2fc7312bb60c183293bdd5b9a4d82f42777fc63fbf2a5488ea38c', url: N('19900014359'), title: 'Sutton & Hartung: Equilibrium Radiative Heating Tables for Earth Entry, NASA TM-102652 (1990)' },
  'src-aerothermo-issues': { file: 'src-aerothermo-issues.pdf', sha256: '0060c17e54f8ce473eb5b89a70f2d642450b847f17060761c663a7b695272d6f', url: N('20140004052'), title: 'Johnston et al.: Study of Aerothermodynamic Modeling Issues Relevant to High-Speed Sample Return Vehicles (STO-AVT-218, 2014)' },
  'stardust-slit': { file: 'stardust-slit.pdf', sha256: 'a02e696ccbfaaffb1196d0d6fc0599b6cc05053b472532da8f6bbbc0993d8bfb', url: N('20100021412'), title: 'Winter, Trumble et al.: Spectroscopic Observation of the Stardust Re-Entry in the Near UV with SLIT (2010)' },
  'stardust-pica-perf': { file: 'stardust-pica-perf.pdf', sha256: '9ffa419520144b91d80971406d5b11c2440f27ff2f6402ee8ce1957fd6d9c5da', url: N('20070014634'), title: 'Covington: Performance of a Light-Weight Ablative Thermal Protection Material for the Stardust Mission Sample Return Capsule (IPPW-2, 2005)' },
  'stardust-xray-ct': { file: 'stardust-xray-ct.pdf', sha256: '82e2d3214e2e06f7f9b03bb1b275a1c5f3c2b3ef10a20c5fde50fdc206f1680c', url: N('20100027549'), title: 'X-Ray Computed Tomography Inspection of the Stardust Heat Shield (2010)' },
  'pica-postflight': { file: 'pica-postflight.pdf', sha256: '43f0a80b21942f3ec7b448ddf9bfa3c552404d61c76e1be16a0a29bc8d56c59d', url: N('20140005558'), title: 'Stackpoole, Kao, Qu, Gonzales: Post-Flight Evaluation of PICA and PICA-X, Stardust SRC and SpaceX Dragon 1 (2013 poster)' },
  'pica-envelope': { file: 'pica-envelope.pdf', sha256: '0c4ef1de4a50b0b4124bc7e63841fb0823e9a3553b2aa4734913168722671fa9', url: N('20160000305'), title: 'Investigation of Performance Envelope for Phenolic Impregnated Carbon Ablator (PICA) (2016)' },
  'pica-model-validation': { file: 'pica-model-validation.pdf', sha256: 'd86d2206ac2b39128164a2059ee1075aeabf1dfcbb7818e098fe395d7e8d4340', url: N('20110012891'), title: 'Milos & Chen: Ablation and Thermal Response Property Model Validation for Phenolic Impregnated Carbon Ablator, AIAA 2009-0262' },
  'nist-sigma': { file: 'nist-sigma.html', sha256: null, url: 'https://physics.nist.gov/cgi-bin/cuu/Value?sigma', title: 'NIST CODATA (2022) recommended value: Stefan-Boltzmann constant' },
};

// Every number the kernel takes from a document: [key, value, doc, quote, the literal inside the quote, scale to SI].
// The quote must be in the document; the literal must be in the quote; literal * scale must equal value (scale null:
// checked by hand below).
const PSI = 0.45359237 * 9.80665 / (0.0254 * 0.0254);   // Pa per psi, from the exact pound, standard gravity and inch
const FT = 0.3048;                                        // m per international foot (exact)
const Q = [
  // ---- Stardust: the parachute sequence and what radar saw
  ['stardust.trigger_g', 3, 'stardust-edl-ops', 'The G-switch would be triggered after sensing a 3 g deceleration.', '3', 1],
  ['stardust.drogue_timer_s', 15.04, 'stardust-edl-ops', 'After 15.04 seconds, the drogue parachute is deployed at approximately Mach 1.37 (mean sea level [MSL] altitude of 32 km), and the main timer is initiated.', '15.04', 1],
  ['stardust.nominal_drogue_mach', 1.37, 'stardust-edl-ops', 'After 15.04 seconds, the drogue parachute is deployed at approximately Mach 1.37 (mean sea level [MSL] altitude of 32 km), and the main timer is initiated.', '1.37', 1],
  ['stardust.nominal_drogue_alt_m', 32000, 'stardust-edl-ops', 'After 15.04 seconds, the drogue parachute is deployed at approximately Mach 1.37 (mean sea level [MSL] altitude of 32 km), and the main timer is initiated.', '32', 1000],
  ['stardust.main_timer_s', 350.6, 'stardust-edl-ops', 'After 350.6 seconds (approximately Mach 0.16 and an MSL altitude of 3.1 km [1.8 km above ground]), the main parachute is deployed', '350.6', 1],
  ['stardust.nominal_main_mach', 0.16, 'stardust-edl-ops', 'After 350.6 seconds (approximately Mach 0.16 and an MSL altitude of 3.1 km [1.8 km above ground]), the main parachute is deployed', '0.16', 1],
  ['stardust.nominal_main_alt_m', 3100, 'stardust-edl-ops', 'After 350.6 seconds (approximately Mach 0.16 and an MSL altitude of 3.1 km [1.8 km above ground]), the main parachute is deployed', '3.1', 1000],
  ['stardust.nominal_main_agl_m', 1800, 'stardust-edl-ops', 'After 350.6 seconds (approximately Mach 0.16 and an MSL altitude of 3.1 km [1.8 km above ground]), the main parachute is deployed', '1.8', 1000],
  ['stardust.baro_Pa', 10.11 * PSI, 'stardust-reconstruction', 'sensed pressure of 10.11 psi, which corresponds to a nominal altitude of 3.1 km MSL (10,000 ft)', '10.11', PSI],
  ['stardust.baro_accuracy_m', 730, 'stardust-reconstruction', 'The accuracy of this transducer triggering process was ±0.73 km', '0.73', 1000],
  ['stardust.drogue_t_s', 137.9, 'stardust-reconstruction', 'Drogue parachute deployment occurred at 09:59:00.2 UTC, which was 137.9 s after entry.', '137.9', 1],
  ['stardust.drogue_alt_m', 31030, 'stardust-reconstruction', 'The corresponding Mach number (M) and altitude (h) at drogue deployment were 1.23 and 31.03 km MSL', '31.03', 1000],
  ['stardust.drogue_mach', 1.23, 'stardust-reconstruction', 'The corresponding Mach number (M) and altitude (h) at drogue deployment were 1.23 and 31.03 km MSL', '1.23', 1],
  ['stardust.drogue_late_s', 4.8, 'stardust-reconstruction', 'drogue parachute deployment was 4.8 s later than the pre-entry prediction', '4.8', 1],
  ['stardust.main_after_drogue_s', 331.3, 'stardust-reconstruction', 'Main parachute deployment occurred at 10:04:31.5 UTC, which was 331.3 s after drogue deployment.', '331.3', 1],
  ['stardust.main_alt_m', 3428, 'stardust-reconstruction', 'The corresponding altitude of 3.428 km MSL was 0.328 km higher than the pre-entry predicted nominal 3.1 km MSL altitude', '3.428', 1000],
  // ---- Genesis: no parachute; the tumbling fall the reconstruction fitted; the nominal timeline; the heat shield
  ['genesis.drogue_timer_s', 5.6, 'genesis-edl-ops', 'After 5.6 seconds, the drogue parachute is', '5.6', 1],
  ['genesis.drogue_pred_t_s', 126.7, 'genesis-reconstruction', '(which was calculated to be 126.7 sec after entry interface)', '126.7', 1],
  ['genesis.alt_at_drogue_pred_m', 33100, 'genesis-reconstruction', 'The UTTR tracking data set indicates an altitude of 33.1 km, while the BET produces an altitude of 32.72 km.', '33.1', 1000],
  ['genesis.tumble_cd', 0.63, 'genesis-reconstruction', 'A tumbling CD value of 0.63 for the capsule results in the observed impact time (which was 238.3 sec after the pre-entry predicted drogue deployment time).', '0.63', 1],
  ['genesis.fall_s', 238.3, 'genesis-reconstruction', 'A tumbling CD value of 0.63 for the capsule results in the observed impact time (which was 238.3 sec after the pre-entry predicted drogue deployment time).', '238.3', 1],
  ['genesis.tumble_mach', 0.85, 'genesis-reconstruction', 'This point (approximately at Mach 0.85) is assumed to be the location in the simulation when the capsule tumbles.', '0.85', 1],
  ['genesis.nominal.trigger_t_s', 121, 'genesis-src-overview', '3-g Trigger Point 02:01 35 Chute Timer Begin', null, null],
  ['genesis.nominal.trigger_alt_m', 35000, 'genesis-src-overview', '3-g Trigger Point 02:01 35 Chute Timer Begin', '35', 1000],
  ['genesis.nominal.drogue_t_s', 126, 'genesis-src-overview', 'Drogue Chute Deploy 02:06 33 Mach 1.8', null, null],
  ['genesis.nominal.drogue_alt_m', 33000, 'genesis-src-overview', 'Drogue Chute Deploy 02:06 33 Mach 1.8', '33', 1000],
  ['genesis.nominal.drogue_mach', 1.8, 'genesis-src-overview', 'Drogue Chute Deploy 02:06 33 Mach 1.8', '1.8', 1],
  ['genesis.nominal.peak_heating_t_s', 59, 'genesis-src-overview', 'Peak Heating 00:59 60 470 W/cm2', null, null],
  ['genesis.nominal.peak_heating_W_cm2', 470, 'genesis-src-overview', 'Peak Heating 00:59 60 470 W/cm2', '470', 1],
  ['genesis.nominal.peak_g', 27.3, 'genesis-src-overview', 'Peak Loads 01:10 52 27.3 g', '27.3', 1],
  ['genesis.nominal.mach1_t_s', 140, 'genesis-src-overview', 'Mach 1.0 02:20 30', null, null],
  ['genesis.nominal.mach1_alt_m', 30000, 'genesis-src-overview', 'Mach 1.0 02:20 30', '30', 1000],
  ['genesis.nominal.main_t_s', 380, 'genesis-src-overview', 'Main Chute Deploy 06:20 7.4 24,400 ft MSL', null, null],
  ['genesis.nominal.main_alt_m', 24400 * FT, 'genesis-src-overview', 'Main Chute Deploy 06:20 7.4 24,400 ft MSL', null, null],
  ['genesis.ground_alt_m', 4200 * FT, 'genesis-src-overview', 'Touchdown (Backup) 26:22 1.3 4.5 mps, 4200 ft MSL', '4200', FT],
  // ---- OSIRIS-REx: the parachutes, the switches, the anomaly, the ground
  ['osirisrex.drogue_d_m', 0.8, 'orex-edl', 'with a 0.8 m diameter Disk-Gap-Band (DGB) for the drogue, and a 7.3 m diameter triconic canopy for the main.', '0.8', 1],
  ['osirisrex.main_d_m', 7.3, 'orex-edl', 'with a 0.8 m diameter Disk-Gap-Band (DGB) for the drogue, and a 7.3 m diameter triconic canopy for the main.', '7.3', 1],
  ['osirisrex.drogue_timer_s', 14, 'orex-edl', 'Approximately 14 seconds after trigger fire, a signal is sent to fire the drogue chute mortar.', '14', 1],
  ['osirisrex.main_timer_s', 363, 'orex-edl', 'Approximately 363 seconds after trigger fire, a signal is sent to release the drogue and deploy the main chute.', '363', 1],
  ['osirisrex.baro_alt_m', 10000 * FT, 'orex-edl', 'It was tuned to a pressure corresponding to 10000 ft Mean Sea Level (MSL).', '10000', FT],
  ['osirisrex.touchdown_v_m_s', 4.5, 'orex-edl-performance', 'touchdown at UTTR with a vertical velocity of 4.5 m/s', '4.5', 1],
  ['osirisrex.ground_alt_m', 1288, 'orex-edl-performance', 'touchdown of the SRC at UTTR at a geodetic altitude of 1288 m', '1288', 1],
  ['osirisrex.recon_main_t_s', 391.69, 'orex-edl-performance', 'Main Parachute Deploy 381.09 391.69 398.89 332.228 -59.466', '391.69', 1],
  ['osirisrex.recon_touchdown_t_s', 788.42, 'orex-edl-performance', 'Touchdown 714.79 788.42 875.94 615.1 -173.32', '788.42', 1],
  ['osirisrex.obs_touchdown_t_s', 615.1, 'orex-edl-performance', 'Touchdown 714.79 788.42 875.94 615.1 -173.32', '615.1', 1],
  // ---- heating: radiation
  ['suttles.A1', -69.099, 'suttles-radfits', 'Aj = -69.099', '-69.099', 1],
  ['suttles.A2', 1.320, 'suttles-radfits', 'A2 = 1.320', '1.320', 1],
  ['suttles.A3', -0.01223, 'suttles-radfits', 'A3 =-0.01223', '-0.01223', 1],
  ['suttles.A4', 1.688, 'suttles-radfits', 'A4 = 1.688', '1.688', 1],
  ['suttles.A5', -0.1796, 'suttles-radfits', 'A5 = -0.1796', '-0.1796', 1],
  ['suttles.A6', 0.005381, 'suttles-radfits', 'A6 = 0.005381', '0.005381', 1],
  ['suttles.A7', 51.89, 'suttles-radfits', 'A? = 51.89', '51.89', 1],
  ['suttles.A8', -1.558, 'suttles-radfits', 'Ag = -1.558', '-1.558', 1],
  ['suttles.A9', 0.02659, 'suttles-radfits', 'A9 = 0.02659', '0.02659', 1],
  ['suttles.range.alt_min_m', 53750, 'suttles-radfits', 'Altitude = 53.75 to 68.4 km', '53.75', 1000],
  ['suttles.range.alt_max_m', 68400, 'suttles-radfits', 'Altitude = 53.75 to 68.4 km', '68.4', 1000],
  ['suttles.range.rho_min_kg_m3', 1.078e-4, 'suttles-radfits', '1.078 X 10-7 to 6.53 x 10-7 g/cm3', '1.078', 1e-4],
  ['suttles.range.rho_max_kg_m3', 6.53e-4, 'suttles-radfits', '1.078 X 10-7 to 6.53 x 10-7 g/cm3', '6.53', 1e-4],
  ['suttles.range.rn_min_m', 0.30, 'suttles-radfits', 'RB = 30 to 4,50 cm', '30', 0.01],
  ['suttles.range.rn_max_m', 4.50, 'suttles-radfits', 'RB = 30 to 4,50 cm', null, null],
  ['suttles.range.v_min_m_s', 11000, 'suttles-radfits', 'V^ = llto 16 km/sec', null, null],
  ['suttles.range.v_max_m_s', 16000, 'suttles-radfits', 'V^ = llto 16 km/sec', '16', 1000],
  ['sutton_hartung.rho60_kg_m3', 3.0592e-4, 'sutton-hartung-radtables', '3.0592E-4', '3.0592E-4', 1],
  // ---- Stardust as flown: the trajectory the aerothermal analyses used, its heating, its surface temperature
  ['stardust.eft.t42_v_m_s', 12060, 'src-aerothermo-issues', 'The 42 s point, which is at 12.06 km/s and 5.6e-5 kg/m3', '12.06', 1000],
  ['stardust.eft.t42_rho', 5.6e-5, 'src-aerothermo-issues', 'The 42 s point, which is at 12.06 km/s and 5.6e-5 kg/m3', '5.6e-5', 1],
  ['stardust.eft.t53_v_m_s', 10420, 'src-aerothermo-issues', 'the 53 s point, which is at 10.42 km/s and 2.7e-4 kg/m3 , represents the peak heating point', '10.42', 1000],
  ['stardust.eft.t53_rho', 2.7e-4, 'src-aerothermo-issues', 'the 53 s point, which is at 10.42 km/s and 2.7e-4 kg/m3 , represents the peak heating point', '2.7e-4', 1],
  ['stardust.postflight.peak_q_total_W_m2', 1000e4, 'pica-postflight', 'Peak Heat Flux (Total) 1000 W/cm2', '1000', 1e4],
  ['stardust.postflight.heat_load_J_m2', 28e7, 'pica-postflight', 'Peak Heat Load 28 kJ/cm2', '28', 1e7],
  ['stardust.rad_fraction_max', 0.10, 'stardust-slit', 'accounted for less than 10% of the heat rate at peak heating', '10', 0.01],
  ['stardust.slit_t_max_K', 3210, 'stardust-slit', 'T local, max: 3210 K', '3210', 1],
  ['pica.emissivity.e_lo', 0.858, 'stardust-slit', 'varies from 0.858 at 250K to 0.93 at 3500K', '0.858', 1],
  ['pica.emissivity.t_lo_K', 250, 'stardust-slit', 'varies from 0.858 at 250K to 0.93 at 3500K', '250', 1],
  ['pica.emissivity.e_hi', 0.93, 'stardust-slit', 'varies from 0.858 at 250K to 0.93 at 3500K', '0.93', 1],
  ['pica.emissivity.t_hi_K', 3500, 'stardust-slit', 'varies from 0.858 at 250K to 0.93 at 3500K', '3500', 1],
  ['sigma_W_m2_K4', 5.670374419e-8, 'nist-sigma', '5.670 374 419', null, null],
  // ---- the heat shield: PICA in the arc jet, on Stardust, and its limits
  ['pica.stardust_density_kg_m3', 266, 'stardust-pica-perf', '0.266 g/cm as determined from small samples taken', '0.266', 1000],
  ['pica.arcjet.h0_J_kg', 29.5e6, 'stardust-pica-perf', '1 15E 10.16 69 580 40.0 0.45 29.5', '29.5', 1e6],
  ['pica.arcjet.q580_W_m2', 580e4, 'stardust-pica-perf', '1 15E 10.16 69 580 40.0 0.45 29.5', '580', 1e4],
  ['pica.arcjet.p580_atm', 0.45, 'stardust-pica-perf', '1 15E 10.16 69 580 40.0 0.45 29.5', '0.45', 1],
  ['pica.arcjet.q400_W_m2', 400e4, 'stardust-pica-perf', '4A 17W 10.16 30 400 12.0 0.20 29.5 2.24 0.880', '400', 1e4],
  ['pica.arcjet.p400_atm', 0.20, 'stardust-pica-perf', '4A 17W 10.16 30 400 12.0 0.20 29.5 2.24 0.880', '0.20', 1],
  ['stardust.design.q_W_m2', 1200e4, 'stardust-pica-perf', 'nominal values for stagnation point heating flux of 1200 W/cm2, peak surface pressures of 0.5 atm, and an integrated heat load of 36.5 kJ/cm2 for the baseline entry', '1200', 1e4],
  ['stardust.design.p_atm', 0.5, 'stardust-pica-perf', 'nominal values for stagnation point heating flux of 1200 W/cm2, peak surface pressures of 0.5 atm, and an integrated heat load of 36.5 kJ/cm2 for the baseline entry', '0.5', 1],
  ['stardust.design.heat_load_J_m2', 36.5e7, 'stardust-pica-perf', 'nominal values for stagnation point heating flux of 1200 W/cm2, peak surface pressures of 0.5 atm, and an integrated heat load of 36.5 kJ/cm2 for the baseline entry', '36.5', 1e7],
  ['stardust.design.thickness_m', 0.0582, 'stardust-pica-perf', 'PICA Thickness = 5.82 cm', '5.82', 0.01],
  ['stardust.design.bondline_max_C', 250, 'stardust-pica-perf', 'Max. Bondline Temperature = 250°C', '250', 1],
  ['stardust.design.bondline_calc_C', 116, 'stardust-pica-perf', 'The recalculated maximum temperature of about 116˚C', '116', 1],
  ['stardust.ct.recession_lo_m', 0.006, 'stardust-xray-ct', 'measurements show a material thickness loss of 6-6.5 mm in the top of the shield apex, and a low as 3 mm loss close to the outside radii of the shield surface', '6', 0.001],
  ['stardust.ct.recession_hi_m', 0.0065, 'stardust-xray-ct', 'measurements show a material thickness loss of 6-6.5 mm in the top of the shield apex, and a low as 3 mm loss close to the outside radii of the shield surface', '6.5', 0.001],
  ['stardust.ct.recession_edge_m', 0.003, 'stardust-xray-ct', 'measurements show a material thickness loss of 6-6.5 mm in the top of the shield apex, and a low as 3 mm loss close to the outside radii of the shield surface', '3', 0.001],
  ['stardust.ct.nominal_thickness_m', 0.058, 'stardust-xray-ct', 'PICA thickness loss from nominal thickness of 58 mm', '58', 0.001],
  ['stardust.ct.char_depth_m', 0.0098, 'stardust-xray-ct', 'Average depth of the char layer is 9.8 mm +/- 1mm', '9.8', 0.001],
  ['pica.oxidation_T_min_K', 1600, 'src-aerothermo-issues', 'Surface temperatures for these comparisons ranged from 1600–3100 K, which indicates that the temperatures were just below the sublimation-dominated regime and therefore dominated by diffusion-limited oxidation.', '1600', 1],
  ['pica.limit.q_W_m2', 1500e4, 'pica-envelope', 'beyond the established limits of 1500 W/cm2 heat flux and 1.0 atm pressure', '1500', 1e4],
  ['pica.limit.p_atm', 1.0, 'pica-envelope', 'beyond the established limits of 1500 W/cm2 heat flux and 1.0 atm pressure', '1.0', 1],
  ['pica.highflux.q_W_m2', 1800e4, 'pica-envelope', 'at the estimated heat-flux of 1800 W/cm2 and pressure of 130 kPa', '1800', 1e4],
  ['pica.highflux.p_Pa', 130e3, 'pica-envelope', 'at the estimated heat-flux of 1800 W/cm2 and pressure of 130 kPa', '130', 1e3],
  ['pica.highflux.h0_J_kg', 31.7e6, 'pica-envelope', 'IHF 15.24 2000 135 31.7', '31.7', 1e6],
  ['pica.highflux.mdot1_kg_m2_s', 0.219, 'pica-envelope', 'PICA-1 19.65 15.5 0.278 0.789 0.0219', '0.0219', 10],
  ['pica.highflux.mdot2_kg_m2_s', 0.218, 'pica-envelope', 'PICA-2 20.2 15.7 0.28 0.777 0.0218', '0.0218', 10],
  ['pica.highflux.mdot3_kg_m2_s', 0.217, 'pica-envelope', 'PICA-3 20.15 15.3 0.286 0.759 0.0217', '0.0217', 10],
  ['pica.msl_density_kg_m3', 274, 'pica-envelope', 'nominal PICA value of 0.274 g/cm3', '0.274', 1000],
];
// Passages quoted for what they say, not for a number.
const PROSE = [
  ['orex-edl', 'entry deceleration decreases below 3-g'],
  ['orex-edl', 'with build-to-print thicknesses'],
  ['orex-edl', 'Whichever method indicates first (timer or pressure transducer) will initiate the main chute deployment.'],
  ['orex-edl', 'there are periods where it looks like the SRC may be completely tumbling'],
  ['orex-edl', 'the main parachute deployed at a higher velocity (and thus dynamic pressure) than intended'],
  ['orex-edl-performance', 'the parachute anomaly was not the only contributor to the much faster timeline'],
  ['genesis-src-overview', 'Heatshield - Carbon-Carbon'],
  ['apollo-aerothermo', 'Entries at orbital velocities result in negligible radiative heating rates.'],
  ['apollo-aerothermo', 'radiative heating is approximately one-third of the total heating rate'],
  ['src-aerothermo-issues', 'The present simulation is seen to under-predict the recession by 15% at the stagnation point'],
  ['stardust-slit', 'the peak temperatures from the experimental data are constantly lower by about 200 K than the corresponding CFD results'],
  ['stardust-pica-perf', 'final bulk densities ranging from 0.22 to 0.27 g/cm3'],
  ['pica-model-validation', 'Material properties of high-performance ablators are subject to export-control restrictions.'],
  ['sutton-hartung-radtables', 'Radiative Heating Prediction at 60 km Altitude.'],
  ['stardust-reconstruction', 'January 15, 2006 at 09:56:42.3 UTC'],
];
// The OSIRIS-REx observed timeline (Table A of the AAS 2024 paper): each row quoted, each time parsed here.
const OREX_TIMES = [
  ['ei', 'Entry Interface 14:41:54.000 14:41:54.000 0.000', '14:41:54.000'],
  ['drogue_mortar', 'Drogue mortar fire 14:47:24.358 14:44:06.500 197.858', '14:47:24.358'],
  ['drogue_inflated', 'Drogue full inflation 14:47:24.738 14:44:06.930 197.808', '14:47:24.738'],
  ['main_bag_strip', 'Main chute bag strip complete 14:47:25.088', '14:47:25.088'],
  ['main_inflated', 'Main chute full inflation 14:47:26.228 14:49:56.200 -149.972', '14:47:26.228'],
  ['touchdown', 'Touchdown 14:52:09.100 14:55:05.870 -176.770', '14:52:09.100'],
];

// ---- read from page images (the text layer does not carry them or carries them garbled); each is checked as far as the
// text layer allows, and the README says which.
// Covington 2005, Fig. 5 (10.16 cm models): "Measured Average for 580 W/cm2 = 0.018 cm/sec", "... 400 W/cm2 = 0.0115 cm/sec".
const ARCJET_RECESSION = { r580_m_s: 0.018e-2, r400_m_s: 0.0115e-2, note: 'Covington 2005 Fig. 5 legend text, read from the page image (the figure has no text layer): "Measured Average for 580 W/cm2 = 0.018 cm/sec", "Measured Average for 400 W/cm2 = 0.0115 cm/sec"' };
// Suttles et al. 1974 Table III(a), spherical bodies: [case, V km/s, alt km, rho g/cm3, R_B cm, q_R,D W/cm2 (their coupled
// calculation), q_R,C W/cm2 (their curve fit)], read from the page image (page 22, printed sideways).
const SUTTLES_T3 = [
  [1, 11, 58, 3.9072e-7, 30, 306.0, 296.5], [2, 11, 58, 3.9072e-7, 150, 544.0, 532.2], [3, 11, 58, 3.9072e-7, 300, 661.0, 684.7], [4, 11, 58, 3.9072e-7, 450, 752.0, 793.5],
  [5, 13, 58, 3.9072e-7, 30, 1607.0, 1531.5], [6, 13, 58, 3.9072e-7, 150, 2263.0, 2336.9], [7, 13, 58, 3.9072e-7, 300, 2699.0, 2803.4], [8, 13, 58, 3.9072e-7, 450, 3080.0, 3118.4],
  [9, 14, 58, 3.9072e-7, 30, 2578.0, 2586.9], [10, 14, 58, 3.9072e-7, 150, 3537.0, 3735.5], [11, 14, 58, 3.9072e-7, 300, 4289.0, 4375.8], [12, 14, 58, 3.9072e-7, 450, 4816.0, 4800.2],
  [13, 15, 58, 3.9072e-7, 30, 3709.0, 3875.3], [14, 15, 58, 3.9072e-7, 150, 5124.0, 5387.7], [15, 15, 58, 3.9072e-7, 300, 6108.0, 6209.1], [16, 15, 58, 3.9072e-7, 450, 6917.0, 6746.6],
  [21, 11, 61, 2.7018e-7, 30, 194.0, 191.5], [22, 11, 61, 2.7018e-7, 150, 365.0, 343.7], [23, 11, 61, 2.7018e-7, 300, 447.0, 442.2], [24, 11, 61, 2.7018e-7, 450, 509.0, 512.4],
  [25, 12, 61, 2.7018e-7, 30, 520.0, 493.6], [26, 12, 61, 2.7018e-7, 150, 843.0, 809.9], [27, 12, 61, 2.7018e-7, 300, 958.0, 1002.4], [28, 12, 61, 2.7018e-7, 450, 1087.0, 1135.6],
  [29, 13, 61, 2.7018e-7, 30, 1027.0, 997.9],
];
// Sutton & Hartung 1990 Table 6 (60 km, rho 3.0592E-4 kg/m3): [V km/s, R_n m, Q_r MW/m2, the text-layer literal of that
// row (OCR, garbled where noted)], each value checked against the page image.
const SH60 = [
  [11, 0.23, 1.974, '0.23 1.974 1.097'], [11, 0.5, 2.860, '0.50 2.860 2.360'], [11, 1.0, 3.822, '1.00 3.822 4.670'], [11, 2.3, 5.196, '2.30 5.196 1.056E+01'],
  [12, 0.23, 4.996, '0.23 4.996 1.053'], [12, 0.5, 6.872, '0.50 6.872 2.250'], [12, 1.0, 8.765, '1.00 8.765 4.430'], [12, 2.3, 11.30, '2.30 1.13013+01 9.913'],
  [14, 0.5, 20.65, '0.50 2.065E+01 2.000'], [14, 1.0, 24.72, '1.00 2.472E+01 3,960'], [14, 2.3, 29.69, '2.30 2,969E+01 8.694'],
  [16, 0.5, 42.58, '0.50 4.258E+01 1.870'], [16, 1.0, 48.54, '1.00 4.854E+01 3.570'], [16, 2.3, 55.10, '2.30 5.510E+01 7.774'],
];

function setPath(o, key, v) { const p = key.split('.'); let x = o; for (let i = 0; i < p.length - 1; i++) x = x[p[i]] = x[p[i]] || {}; x[p[p.length - 1]] = v; }
function textOf(file) {
  const norm = (s) => s.replace(/-\n(?=[a-z])/g, '').replace(/\s+/g, ' ');
  if (file.endsWith('.html')) return [norm(fs.readFileSync(file, 'utf8').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' '))];
  const raw = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const lay = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return [norm(raw), norm(lay)];
}
const hms = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + x; };

function buildSources(dir) {
  const texts = {}, docs = [];
  for (const [id, d] of Object.entries(DOCS)) {
    const f = path.join(dir, d.file), buf = fs.readFileSync(f), h = sha(buf);
    if (d.sha256 && h !== d.sha256) throw new Error(`${d.file}: sha256 ${h} is not the one recorded (${d.sha256})`);
    texts[id] = textOf(f);
    docs.push({ id, title: d.title, url: d.url, sha256: d.sha256 || null, bytes: d.sha256 ? buf.length : null, sha256_note: d.sha256 ? undefined : 'not pinned: the page embeds a per-request script, so its bytes differ on every fetch; the quoted value is checked' });
  }
  const has = (id, q) => texts[id].some((t) => t.includes(q));
  const out = { retrieved: RETRIEVED, documents: docs, quotes: [] };
  for (const [key, value, id, quote, lit, scale] of Q) {
    if (!has(id, quote)) throw new Error(`quote for ${key} not found in ${id}: ${quote}`);
    if (lit !== null && !quote.includes(lit)) throw new Error(`literal ${lit} not inside the quote for ${key}`);
    if (scale !== null) { const v = parseFloat(lit) * scale; if (Math.abs(v - value) > 1e-9 * Math.max(1, Math.abs(value))) throw new Error(`${key}: ${lit} x ${scale} = ${v}, not ${value}`); }
    setPath(out, key, value);
    out.quotes.push({ key, doc: id, quote });
  }
  // literals that are not plain decimals, checked by hand here
  const mmss = (s) => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };
  if (out.genesis.nominal.main_t_s !== mmss('06:20') || Math.abs(out.genesis.nominal.main_alt_m - 24400 * FT) > 1e-9) throw new Error('Genesis main');
  if (out.genesis.nominal.trigger_t_s !== mmss('02:01') || out.genesis.nominal.drogue_t_s !== mmss('02:06') || out.genesis.nominal.peak_heating_t_s !== mmss('00:59') || out.genesis.nominal.mach1_t_s !== mmss('02:20')) throw new Error('Genesis mm:ss');
  if (out.suttles.range.rn_max_m !== 4.50) throw new Error('"4,50 cm" is 450 cm (the comma is the scan\'s)');
  if (out.suttles.range.v_min_m_s !== 11000) throw new Error('"llto 16" is 11 to 16 (the scan\'s l for 1)');
  if (!has('nist-sigma', '5.670 374 419') || !has('nist-sigma', 'x 10 -8 W m -2 K -4')) throw new Error('NIST sigma');
  for (const [id, quote] of PROSE) { if (!has(id, quote)) throw new Error(`prose quote not found in ${id}: ${quote}`); out.quotes.push({ key: 'prose', doc: id, quote }); }
  // OSIRIS-REx observed timeline, seconds after entry interface
  out.osirisrex.observed = {};
  for (const [k, quote, t] of OREX_TIMES) {
    if (!has('orex-edl', quote)) throw new Error('OREx timeline: ' + quote);
    if (!quote.includes(t)) throw new Error('OREx time not in quote');
    out.osirisrex.observed[k + '_s'] = +(hms(t) - hms('14:41:54.000')).toFixed(3);
    out.quotes.push({ key: 'osirisrex.observed.' + k + '_s', doc: 'orex-edl', quote });
  }
  if (Math.abs(out.osirisrex.observed.touchdown_s - out.osirisrex.obs_touchdown_t_s) > 1e-6) throw new Error('OREx touchdown: the two papers disagree');
  // image-read values, checked as far as the text layer allows
  out.pica.arcjet.recession_580_m_s = ARCJET_RECESSION.r580_m_s;
  out.pica.arcjet.recession_400_m_s = ARCJET_RECESSION.r400_m_s;
  out.pica.arcjet.note = ARCJET_RECESSION.note;
  out.suttles.table3 = { rows: SUTTLES_T3.map((r) => ({ case: r[0], v_m_s: r[1] * 1000, alt_m: r[2] * 1000, rho_kg_m3: r[3] * 1000, rn_m: r[4] / 100, q_data_W_m2: r[5] * 1e4, q_fit_W_m2: r[6] * 1e4 })),
    note: 'Table III(a) (spherical bodies), page 22 printed sideways: read from the page image; the text layer is unreadable there. q_data is their radiatively coupled calculation, q_fit their curve fit' };
  for (const [v, rn, q, row] of SH60) if (!has('sutton-hartung-radtables', row)) throw new Error('Sutton-Hartung row not in the text layer: ' + row);
  out.sutton_hartung.t60 = { rows: SH60.map(([v, rn, q]) => ({ v_m_s: v * 1000, rn_m: rn, q_W_m2: q * 1e6 })),
    note: 'Table 6 (60 km), each value read from the page image and its row found in the text layer (OCR: "1.13013+01" is 1.130E+01, "3,960" and "2,969E+01" carry commas for points)' };
  // derived: the UTTR ground under Stardust's nominal main deploy (3.1 km MSL, 1.8 km above ground)
  out.stardust.ground_alt_m = out.stardust.nominal_main_alt_m - out.stardust.nominal_main_agl_m;
  out.units = { psi_Pa: PSI, ft_m: FT, rule: 'psi from the exact avoirdupois pound (0.45359237 kg), standard gravity (9.80665 m/s2) and inch (0.0254 m); the international foot (0.3048 m)' };
  out.osirisrex.ei_utc = '2023-09-24T14:41:54Z';
  out.stardust.ei_utc = '2006-01-15T09:56:42.3Z';
  return out;
}

function writeSources(dir) {
  const S = buildSources(dir);
  const body = `/* Outside sources idea 49 (Hot Return) takes numbers from: NASA technical reports (NTRS) and NIST's CODATA page.
 * GENERATED by ideas/49-hot-return/build-data.mjs from the files oracle/fetch-sources.sh downloads; do not edit. Every
 * number sits beside the quote it was read from, and the build found each quote verbatim in its document; the few read
 * from page images say so. SI units unless the key says otherwise. Classic script (window.HotReturnSources) and require(). */
(function (root) {
  var D = ${JSON.stringify(S, null, 1)};
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.HotReturnSources = D;
})(typeof self !== 'undefined' ? self : this);
`;
  const p = path.join(SNAP, 'reentry-sources.js');
  fs.writeFileSync(p, body);
  const per = S.documents.filter((d) => d.sha256).map((d) => d.sha256);
  const side = {
    repo: 'https://ntrs.nasa.gov (NASA Technical Reports Server, 17 documents) ; https://physics.nist.gov/cgi-bin/cuu/Value?sigma',
    path: S.documents.map((d) => `${d.id}: ${d.url}`).join(' ; '),
    commit: `retrieved ${RETRIEVED}`,
    retrieved: RETRIEVED,
    sourceSha256: sha(per.join('\n')),
    sourceSha256Rule: 'sha256 of the newline-joined per-document sha256 values in documents[] (in that order), the NIST page excluded (its bytes change per request)',
    license: 'US Government work (NASA technical reports on NTRS; NIST CODATA values; public domain in the US). The AIAA/AAS/NATO-STO papers on NTRS are NASA-authored and carry no US copyright.',
    note: 'derived by build-data.mjs: every number sits beside its quote, each quote found verbatim in pdftotext output of its document (raw or -layout), each number found inside its quote; read from page images (and so marked): Covington\'s two arc-jet recession averages (figure legend), Suttles\'s Table III(a) rows (sideways table), the Sutton-Hartung 60 km values (rows also found in the OCR text layer)',
    writtenSha256: sha(fs.readFileSync(p)),
    writtenBytes: fs.statSync(p).size,
    mode: 'derived',
  };
  fs.writeFileSync(p + '.provenance.json', JSON.stringify(side, null, 2) + '\n');
  console.log('wrote', path.relative(BANK, p), side.writtenBytes, 'bytes;', S.quotes.length, 'quotes checked');
}

function writeChain() {
  const src = path.join(BANK, 'ideas/48-catch/handoff.json');
  const txt = fs.readFileSync(src, 'utf8'), h = JSON.parse(txt);
  const json = JSON.stringify(h);
  const digest = { pruned: true, from: h.from, produced: h.produced, bytes: json.length, sha256: sha(json) };
  const body = `/* Idea 48 (Catch)'s committed handoff.json, the chain's entry interface, unmodified (the build checks JSON equality).
 * GENERATED by ideas/49-hot-return/build-data.mjs --chain; do not edit. "digest" is the sha256 of JSON.stringify(handoff),
 * which a handoff exported by this page carries in place of the whole when it is this sample. Classic script
 * (window.HotReturnCatch) and require(). */
(function (root) {
  var D = { digest: ${JSON.stringify(digest)}, handoff: ${json} };
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.HotReturnCatch = D;
})(typeof self !== 'undefined' ? self : this);
`;
  const p = path.join(SNAP, 'catch-handoff.js');
  fs.writeFileSync(p, body);
  delete require.cache[p];
  const back = require(p);
  if (JSON.stringify(back.handoff) !== json) throw new Error('wrapped handoff is not JSON-equal');
  execFileSync(process.execPath, [path.join(BANK, 'tools/snapshot.mjs'), BANK, 'ideas/48-catch/handoff.json', p, '--sidecar-only', '--note',
    "derived by build-data.mjs --chain: idea 48's committed handoff.json, parsed and written back as a classic script (window.HotReturnCatch) with the sha256 of its JSON.stringify form, content unmodified (the build checks JSON equality), so the page opens on the chain with no network"], { stdio: 'inherit' });
}

function writeOracleCases() {
  const { K } = require('./load.cjs');
  const C = K.oracleCases();
  const p = path.join(HERE, 'oracle/cases.json');
  fs.writeFileSync(p, JSON.stringify(C) + '\n');
  console.log('wrote', path.relative(BANK, p));
}
function writeSample() {
  const { K } = require('./load.cjs');
  const R = K.run(K.defaults());
  if (R.refusal) throw new Error('default run refused: ' + R.refusal.reason);
  const h = K.buildHandoff(R, '2026-11-01T22:00:00Z');
  fs.writeFileSync(path.join(HERE, 'handoff.json'), JSON.stringify(h, null, 1) + '\n');
  console.log('wrote handoff.json', JSON.stringify(h).length, 'bytes');
}

const arg = process.argv[2];
if (!arg || arg === '-h' || arg === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n')); process.exit(arg ? 0 : 2); }
if (arg === '--chain') writeChain();
else if (arg === '--oracle-cases') writeOracleCases();
else if (arg === '--sample') writeSample();
else writeSources(arg);
