// Builds the three data snapshots of idea 42 (Closing In) from the downloads of oracle/fetch-sources.sh:
//   snapshots/horizons-approach.js  JPL Horizons: OSIRIS-REx about Bennu in 2018-19 (as flown), Bennu about the Sun,
//                                   JPL's OSIRIS-APEX predict at Apophis, Apophis at the chain's arrival with its sigmas,
//                                   and Horizons' apparent magnitudes (the oracle for the H-G law)
//   snapshots/bodies.js             JPL SBDB physical parameters of six near-Earth asteroids, with their references
//   snapshots/approach-sources.js   numbers hand-transcribed from AAS 19-035, AAS 24-063, NSSDCA, the OSIRIS-REx press
//                                   kit, the Horizons manual and NIST CODATA, each with page/table and the sha256 of
//                                   the document it was read from
// Usage: node ideas/42-closing-in/build-data.mjs <directory with the downloads>
// Every number below that is not parsed from a download is typed from the document named beside it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.error('usage: node build-data.mjs <downloads directory>'); process.exit(2); }
const HERE = path.dirname(new URL(import.meta.url).pathname), OUT = path.join(HERE, 'snapshots');
const RETRIEVED = '2026-10-31';
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(SRC, f))).digest('hex');
const KM = 1000;
const r6 = (x) => +x.toPrecision(15);   // parsing: Horizons prints 16 digits
// storing: relative states to 0.1 mm and 1e-10 m/s, heliocentric ones to 1 m and 1e-6 m/s (the tide needs far less;
// the tests' tightest use, a maneuver's dv to 1e-4 m/s from states 6 h apart, needs 1e-6 m/s)
const rel = (row) => row.map((x, i) => (i < 3 ? Math.round(x * 1e4) / 1e4 : Math.round(x * 1e10) / 1e10));
const hel = (row) => row.map((x, i) => (i < 3 ? Math.round(x) : Math.round(x * 1e6) / 1e6));

function soe(t) { const a = t.indexOf('$$SOE'), b = t.indexOf('$$EOE'); if (a < 0 || b < 0) throw new Error('no $$SOE block'); return t.slice(a + 5, b).trim().split('\n'); }
// CSV vectors: JDTDB, date, X, Y, Z, VX, VY, VZ (km, km/s) -> [jd, x, y, z, vx, vy, vz] in m, m/s
function csvVectors(f) {
  return soe(read(f)).map((l) => { const c = l.split(',').map((s) => s.trim()); return [+c[0]].concat([2, 3, 4, 5, 6, 7].map((i) => r6(+c[i] * KM))); });
}
// TLIST vectors (CSV_FORMAT NO): "JD = date", " X = .. Y = .. Z = ..", " VX= .. VY= .. VZ= .."
function listVectors(f) {
  const L = soe(read(f)), out = [];
  for (let i = 0; i < L.length; i += 3) {
    const jd = +L[i].split('=')[0], nums = (s) => s.match(/-?\d\.\d+E[+-]\d+/g).map(Number);
    const p = nums(L[i + 1]), v = nums(L[i + 2]);
    out.push([jd].concat(p.map((x) => r6(x * KM)), v.map((x) => r6(x * KM))));
  }
  return out;
}
function header(f, key) { const m = read(f).match(new RegExp(key + '\\s*:\\s*(.+)')); return m ? m[1].trim() : null; }

// ------------------------------------------------------------------------------------------- Horizons
const orexDaily = csvVectors('orex-daily.txt'), bennuDaily = csvVectors('bennu-daily.txt');
const orexA = csvVectors('orex-orbita.txt'), bennuA = csvVectors('bennu-orbita.txt');
const orexBurns = listVectors('orex-burns.txt'), bennuBurns = listVectors('bennu-burns.txt');
const apex = csvVectors('apex-apophis.txt');
if (orexDaily.length !== bennuDaily.length || orexA.length !== bennuA.length || orexBurns.length !== 28 || bennuBurns.length !== 28) throw new Error('row counts');
// Apophis at the chain's arrival, with sigmas (VEC_TABLE 2xarp)
const arr = (() => {
  const L = soe(read('apophis-arrival.txt')), nums = (s) => s.match(/-?\d\.\d+E[+-]\d+/g).map(Number);
  const row = (k) => nums(L.find((l) => l.trim().startsWith(k)).split(':').slice(1).join(':'));
  return { jdTdb: +L[0].split('=')[0], state_m: row('XYZ').map((x) => r6(x * KM)), sigma_xyz_m: row('sigmas').map((x) => r6(x * KM)),
    sigma_acn_m: row('ACN').map((x) => r6(x * KM)), sigma_rtn_m: row('RTN').map((x) => r6(x * KM)), sigma_pos_m: row('POS').map((x) => r6(x * KM)),
    note: 'xyz then velocity sigmas (m, m/s), 1-sigma, from the orbit solution\'s covariance; ACN along-cross-normal, RTN radial-transverse-normal, POS plane-of-sky' };
})();
// Observer tables: date, APmag, S-brt, r (au), rdot, delta (au), deldot, S-T-O (deg)
function apmag(f) {
  const M = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  return soe(read(f)).map((l) => {
    const c = l.split(',').map((s) => s.trim()), m = c[0].match(/(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);
    const jdUtc = Date.UTC(+m[1], M[m[2]], +m[3], +m[4], +m[5]) / 864e5 + 2440587.5;
    return [+jdUtc.toFixed(6), +c[3], +c[5], +c[7], +c[9]];    // [jd UT, APmag, r au, delta au, phase deg]
  }).filter((r) => isFinite(r[1]));
}
const hg = { bennu: { H: 20.21, G: -0.031, rows: apmag('bennu-from-orex.txt') }, apophis: { H: 19.09, G: 0.24, rows: apmag('apophis-from-earth.txt') } };
for (const [k, f] of [['bennu', 'bennu-from-orex.txt'], ['apophis', 'apophis-from-earth.txt']]) {
  const t = read(f), m = t.match(/H=\s*([-\d.]+)\s+G=\s*([-\d.]+)/);
  if (!m || +m[1] !== hg[k].H || +m[2] !== hg[k].G) throw new Error(k + ': Horizons H/G changed: ' + (m && m[0]));
}

const HZ = {
  source: 'JPL Horizons API (ssd.jpl.nasa.gov/api/horizons.api), retrieved ' + RETRIEVED + ' by oracle/fetch-sources.sh; vectors ICRF, geometric (no light time), TDB; positions m, velocities m/s',
  orex: {
    note: 'OSIRIS-REx (-64, Horizons source ORX_merged: the reconstructed trajectory) relative to Bennu (2101955), and Bennu about the Sun (500@10, solution ' + (header('bennu-daily.txt', 'Target body name') || '') + ')',
    daily: { jd0: orexDaily[0][0], stepDays: 1, rel: orexDaily.map((r) => rel(r.slice(1))), bennuHelio: bennuDaily.map((r) => hel(r.slice(1))) },
    burns: { note: 'at each AAS 19-035 Table 1 maneuver epoch (17:00 UTC, 2018) minus 12 h, minus 3 h, plus 3 h, plus 12 h', events: ['AAM-1', 'AAM-2', 'AAM-3', 'AAM-3a', 'AAM-4', 'M0P', 'M1P'], offsetsH: [-12, -3, 3, 12],
      jd: orexBurns.map((r) => r[0]), rel: orexBurns.map((r) => rel(r.slice(1))), bennuHelio: bennuBurns.map((r) => hel(r.slice(1))) },
    orbitA: { jd0: orexA[0][0], stepHours: 2, rel: orexA.filter((r, i) => i % 2 === 0).map((r) => rel(r.slice(1))), bennuHelio0: hel(bennuA[0].slice(1)), bennuHelioEnd: hel(bennuA[bennuA.length - 1].slice(1)) }
  },
  apex: { note: 'JPL\'s OSIRIS-APEX predict (-64, ORX_merged, "proximity ops at Apophis" added 2025-09-18 per the Horizons record) relative to Apophis (2099942): a plan, not a flight', jd0: apex[0][0], stepDays: 1, rel: apex.map((r) => rel(r.slice(1))) },
  apophisArrival: arr,
  hg: { note: 'Horizons observer tables, quantities 9 (APmag), 19 (r), 20 (delta), 24 (S-T-O phase); APmag by the IAU H-G law with the H and G Horizons prints (checked here)', bennuFromOrex: hg.bennu, apophisFromEarth: hg.apophis }
};

// ------------------------------------------------------------------------------------------- SBDB
const SB = {};
for (const des of ['99942', '101955', '162173', '25143', '433', '65803']) {
  const j = JSON.parse(read('sbdb-' + des + '.json')), p = {};
  for (const q of j.phys_par || []) p[q.name] = { value: q.value, sigma: q.sigma, units: q.units, ref: q.ref };
  const num = (k) => (p[k] && isFinite(+p[k].value) ? +p[k].value : null);
  SB[des] = {
    designation: des, name: j.object.fullname, H: num('H'), G: num('G'),
    diameter_m: num('diameter') !== null ? num('diameter') * 1000 : null, diameter_ref: p.diameter ? p.diameter.ref : null,
    GM_m3_s2: num('GM') !== null ? +(num('GM') * 1e9).toPrecision(10) : null, GM_sigma_m3_s2: p.GM && p.GM.sigma ? +(parseFloat(p.GM.sigma) * 1e9).toPrecision(4) : null, GM_ref: p.GM ? p.GM.ref : null,
    density_kg_m3: num('density') !== null ? num('density') * 1000 : null, density_ref: p.density ? p.density.ref : null,
    rotation_h: num('rot_per'), rotation_ref: p.rot_per ? p.rot_per.ref : null, albedo: num('albedo'), extent_km: p.extent ? p.extent.value : null,
    H_ref: p.H ? p.H.ref : null, G_ref: p.G ? p.G.ref : null, sha256: sha('sbdb-' + des + '.json')
  };
}

// ------------------------------------------------------------------------------------------- transcriptions
const DOCS = {};
for (const f of ['aas19-035.pdf', 'aas24-063.pdf', 'orex-presskit.pdf', 'nssdc-1996-008A.html', 'nssdc-2016-055A.html', 'nssdc-2007-043A.html', 'horizons-manual.html', 'nist-G.html', 'horizons-record-64.txt', 'horizons-record-37.txt']) DOCS[f] = sha(f);
const S = {
  aas19035: {
    cite: 'Antreasian et al., "Early Navigation Performance of the OSIRIS-REx Approach to Bennu", AAS 19-035 (NTRS 20190002612)',
    samFrame: 'p. 4: origin Bennu\'s centre of mass; x along the Bennu-Sun line (toward the Sun); z opposite Bennu\'s heliocentric orbital angular momentum; y completes the right-handed frame; solar longitude theta and latitude phi are the spherical angles of the spacecraft in it (Figure 3)',
    // Table 1 (PDF p. 5): event, 2018 date and time UTC, range km, solar latitude deg, solar longitude deg, pre-burn speed m/s, phase deg
    table1: [
      ['AAM-1', '2018-10-01T17:00:00Z', 175000, 20.5, 55.3, 491.3, 58.0],
      ['AAM-2', '2018-10-15T17:00:00Z', 6500, 0.0, 32.0, 141, 32.0],
      ['AAM-2a', '2018-10-22T17:00:00Z', 3325, 0.0, 36.8, 5.2, 36.8],
      ['AAM-3', '2018-10-29T17:00:00Z', 250, 0.0, 0.0, 5.2, 0.0],
      ['AAM-3a', '2018-11-05T17:00:00Z', 200, 0.0, -5.5, 0.12, 5.5],
      ['AAM-4', '2018-11-12T17:00:00Z', 150, 0.0, -20.0, 0.15, 20.0],
      ['M0P', '2018-11-30T17:00:00Z', 38.3, 8.7, 24.2, 0.12, 25.6],
      ['Arrival', '2018-12-03T17:00:00Z', 18.6, 22.3, 89.6, 0.14, 89.6]
    ],
    table1Note: 'AAM-2a was waived (p. 17: the burn needed was below the cutoff); "Bennu Arrival" is the time of M1P, which began Preliminary Survey; each maneuver targets the location of the next (p. 5)',
    // Table 3 (PDF p. 17): maneuver, engine, nominal dV m/s, estimated dV m/s
    table3: [['DSM-2', 'TCM', 16.6260, 16.6302], ['AAM-1', 'ME', 351.2984, 351.2821], ['AAM-2', 'ME', 137.0493, 137.0702], ['AAM-3', 'TCM', 5.1274, 5.1428], ['AAM-3a', 'ACS', 0.0598, 0.0602], ['AAM-4', 'ACS', 0.1698, 0.1704], ['M0P', 'ACS', 0.0133, 0.0138]],
    table3Note: 'ME burns include a 30-s settling burn (2.1 m/s for AAM-1, 2.5 m/s for AAM-2); AAM-3 and M0P were decomposed into two segments for the Sun keep-out (AAM-3: 5.22 m/s cumulative, 5.13 m/s effective, p. 17)',
    // Table 2 (PDF p. 6): imager, FOV deg, iFOV urad/px, detector px
    imagers: [['PolyCam', 0.8, 13.5, 1024], ['MapCam', 4, 68, 1024], ['NavCam', 44, 280, 2592]],
    firstImage: { utc: '2018-08-17', range_km: 2184000, imager: 'PolyCam', page: 5 },
    centroid: { unresolvedAchieved_px: 0.1, unresolvedRequirement_px: 1, resolvedAchievedFractionOfDiameter: [0.002, 0.006], resolvedWeightMin_px: 1, resolvedWeightFraction: 0.01, page: '7, 9, 13 (eq. 1-2)' },
    resolved: { utc: '2018-10-18', pixels: 7, page: 6 },
    aPrioriEphemeris1Sigma_km: 12, aPrioriOffset_km: 20, ephemerisPage: 13,
    odLeadDays: { preliminaryDesign: 14, finalDesign: [5, 7], lateUpdate_h: 24, m0p_h: 48, page: '11-12' },
    predictTwoWeeks_m: 500, smallForcesModelled_km_s2: 1e-12, predictPage: 15,
    arrivalRange_km: 18.6
  },
  aas24063: {
    cite: 'Brown, Wibben, Antreasian and Getzandanner, "Leveraging Resonant Terminator Orbits for the Trajectory Design of OSIRIS-APEX at (99942) Apophis", AAS 24-063 (NTRS 20240000812)',
    apophisGM_m3_s2: { best: 2.68, min: 1.36, max: 4.37, page: 'Table 2, PDF p. 3 (citing DellaGiustina et al. 2023, PSJ 4)' },
    massToArea_kg_m2: 81.119, massToAreaPage: 'Table 2 (OSIRIS-APEX)',
    G1_kg_km3_s2_m2: 1e8, G1Page: 'eq. (2b), after Scheeres and Marzari (2002)',
    anh3bp: 'eqs. (1a)-(2c): frame A with x along the Sun-to-body line, z along the orbit normal; r\'\' = -2 z x r\' - (z.r) z + g + (1/(1 + e cos f)) (beta~ x + 3 x x), beta~ = G1/(B muS eps), DU = d eps, eps = (mu/muS)^(1/3), derivatives with respect to the true anomaly f',
    rto: { muBest: [['3T3', 0.71, 4.89, 72.40, 99.77], ['4T3', 0.48, 4.41, 78.78, 132.36], ['5T6', 0.61, 3.92, 84.04, 181.80], ['6T3', 0.41, 3.53, 85.34, 674.15], ['7T9', 0.64, 4.43, 132.74, 140.57], ['8T7', 0.26, 2.95, 89.24, 196.32]],
      columns: 'family, Rmin km, Rmax km, total period days, ejection time with no burns days (Table 3, PDF p. 7, mu 2.68); 6T3\'s ejection time is printed as > 674.15 (a lower bound)' }
  },
  spacecraft: {
    near: { name: 'NEAR Shoemaker', source: 'NASA NSSDCA 1996-008A', dry_kg: 487, propellant_kg: 318, fuel_kg: 209, oxidizer_kg: 109, mainThrust_N: 450, smallThrust_N: 21, deltaV_capacity_m_s: 1450,
      text: '"a single bipropellant (hydrazine / nitrogen tetroxide) 450 Newton (N) main thruster, and four 21 N and seven 3.5 N hydrazine thrusters for propulsion, for a total delta-V potential of 1450 m/s"; "209 kilograms of hydrazine and 109 kilograms of NTO"; Facts in Brief "Mass: 487 kg" (read as dry: see README)' },
    orex: { name: 'OSIRIS-REx', source: 'OSIRIS-REx press kit (NASA, 2016) PDF p. 4 and the Horizons record for -64; NSSDCA 2016-055A for the thrusters', dry_kg: 880, wet_kg: 2110, src_kg: 46, solarArray_m2: 8.5, mainThrust_N: 200,
      text: '"Dry Mass (unfueled): 1,940 pounds (880 kilograms)", "Wet Mass (fueled): 4,650 pounds (2,110 kilograms)" (press kit); "Propulsion uses 200 N hydrazine thrusters" and "Launch mass including propellant is 1529 kg" (NSSDCA, which disagrees with the press kit)', isp: null },
    dawn: { name: 'Dawn', source: 'NASA NSSDCA 2007-043A', fueled_kg: 1217.7, xenon_kg: 425, hydrazine_kg: 45.6, ionThrust_N: 0.092, ionIsp_s: [1900, 3200] }
  },
  hgLaw: { source: 'Horizons manual (ssd.jpl.nasa.gov/horizons/manual.html), "Magnitude laws": APmag = H + 5 log10(delta) + 5 log10(r) - 2.5 log10((1-G) phi1 + G phi2)',
    phi: 'phi_i = exp(-A_i tan(alpha/2)^B_i), A1 3.33, B1 0.63, A2 1.87, B2 1.22: Bowell et al. (1989), "Application of photometric models to asteroids", Asteroids II, known here from secondary sources and pinned by reproducing Horizons\' own APmag (tests)', A: [3.33, 1.87], B: [0.63, 1.22] },
  nist: { G_m3_kg_s2: 6.67430e-11, source: 'NIST, 2022 CODATA recommended values, Newtonian constant of gravitation, 6.674 30(15) x 10^-11 m^3 kg^-1 s^-2' },
  documents: DOCS
};

// ------------------------------------------------------------------------------------------- write
function writeJs(file, globalName, data, what) {
  const body = '/* ' + what + '\n * GENERATED by ideas/42-closing-in/build-data.mjs from the downloads of oracle/fetch-sources.sh; do not edit. Classic script (window.' + globalName + ') and require(). */\n' +
    '(function (root) {\n  var D = ' + JSON.stringify(data) + ';\n  if (typeof module === \'object\' && module.exports) module.exports = D;\n  else root.' + globalName + ' = D;\n})(typeof self !== \'undefined\' ? self : this);\n';
  fs.writeFileSync(path.join(OUT, file), body);
  return crypto.createHash('sha256').update(body).digest('hex');
}
function sidecar(file, written, o) {
  fs.writeFileSync(path.join(OUT, file + '.provenance.json'), JSON.stringify(Object.assign({ commit: 'retrieved ' + RETRIEVED, retrieved: RETRIEVED }, o, { writtenSha256: written }), null, 2) + '\n');
}
const hzFiles = ['orex-daily.txt', 'bennu-daily.txt', 'orex-orbita.txt', 'bennu-orbita.txt', 'orex-burns.txt', 'bennu-burns.txt', 'apex-apophis.txt', 'apophis-arrival.txt', 'bennu-from-orex.txt', 'apophis-from-earth.txt'];
let w = writeJs('horizons-approach.js', 'ClosingHorizons', HZ, 'JPL Horizons vectors and magnitudes for idea 42: OSIRIS-REx at Bennu (as flown), OSIRIS-APEX at Apophis (JPL\'s predict), Apophis at the chain\'s arrival.');
sidecar('horizons-approach.js', w, { repo: 'https://ssd.jpl.nasa.gov/api/horizons.api', path: 'Horizons API queries in oracle/fetch-sources.sh (vec/tvec/obs lines)', license: 'US Government work (NASA/JPL), public domain',
  sourceSha256: crypto.createHash('sha256').update(hzFiles.map((f) => sha(f)).join('\n')).digest('hex'), sourceFiles: Object.fromEntries(hzFiles.map((f) => [f, sha(f)])),
  note: 'derived by build-data.mjs: Horizons km and km/s converted to m and m/s, relative states kept to 0.1 mm and 1e-10 m/s, heliocentric ones to 1 m and 1e-6 m/s, Orbital A every second hour; observer tables reduced to [jd UT, APmag, r, delta, phase]; nothing else changed' });
w = writeJs('bodies.js', 'ClosingBodies', { source: 'JPL Small-Body Database API (ssd-api.jpl.nasa.gov/sbdb.api?sstr=<des>&phys-par=1), retrieved ' + RETRIEVED, bodies: SB }, 'JPL SBDB physical parameters (H, G, diameter, GM, density, rotation, albedo) with their references.');
sidecar('bodies.js', w, { repo: 'https://ssd-api.jpl.nasa.gov/sbdb.api', path: 'sbdb.api?sstr={99942,101955,162173,25143,433,65803}&phys-par=1', license: 'US Government work (NASA/JPL), public domain',
  sourceSha256: crypto.createHash('sha256').update(Object.values(SB).map((b) => b.sha256).join('\n')).digest('hex'), note: 'derived by build-data.mjs: phys_par values and refs per body; GM converted from km^3/s^2 to m^3/s^2, diameter km to m, density g/cm^3 to kg/m^3' });
w = writeJs('approach-sources.js', 'ClosingSources', S, 'Approach, propulsion and constant figures hand-transcribed from the documents named, with page or table.');
sidecar('approach-sources.js', w, { repo: 'https://ntrs.nasa.gov (AAS 19-035, AAS 24-063); https://nssdc.gsfc.nasa.gov; https://www.nasa.gov (press kit); https://ssd.jpl.nasa.gov/horizons/manual.html; https://physics.nist.gov',
  path: 'NTRS 20190002612 Tables 1-3 and pp. 4-15; NTRS 20240000812 Tables 2-3 and eqs. (1)-(3); NSSDCA 1996-008A, 2016-055A, 2007-043A; osiris-rex_press_kit_0.pdf p. 3; Horizons manual "Magnitude laws"; NIST CODATA 2022 G',
  license: 'NASA and NIST works are US Government works (public domain); AAS papers on NTRS are NASA-funded works posted by NASA', sourceSha256: crypto.createHash('sha256').update(Object.values(DOCS).join('\n')).digest('hex'), documents: DOCS,
  note: 'hand-transcribed by build-data.mjs (values typed from the documents, page and table cited per key); the H-G phase-function coefficients are from secondary knowledge of Bowell et al. (1989) and are pinned against Horizons\' APmag by the tests' });
console.log('wrote horizons-approach.js, bodies.js, approach-sources.js', Object.keys(SB).length, 'bodies;', orexDaily.length, 'daily rows;', orexA.length, 'Orbital A rows;', apex.length, 'APEX rows');
