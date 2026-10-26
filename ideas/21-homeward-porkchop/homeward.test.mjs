// Tests for the return-leg kernel. Run from the bank root:
//   node --test ideas/21-homeward-porkchop/homeward.test.mjs
// Numbers are pinned to things outside this code: Aster's own Lambert oracle vectors and grid
// labels (snapshotted test files), Aster's committed catalog anchors, JPL Horizons daily Earth
// records, JPL NHATS trajectories, JPL-integrated drift truth, a closed form and an RK4 integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildAggregate, aggregateText, deriveEarth, deriveDrift, readConstants, EARTH_REL, DRIFT_REL, BODY_KEYS } from './build-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(HERE, 'snapshots');
const require = createRequire(import.meta.url);
const H = require('./homeward.js');
const D = require('./data.js');
const EARTH = require('./snapshots/earth-weekly.js');
const C = D.constants;
const earth = H.makeEphemeris(EARTH.records, C.secondsPerDay);
const bodyOf = (des) => D.bodies.find((b) => b.designation === des);
const readSnap = (f) => fs.readFileSync(path.join(SNAP, f), 'utf8');
const relErr = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.hypot(b[0], b[1], b[2]);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- provenance
test('every snapshot hashes to its sidecar, all from one clean Aster commit; data.js is exactly the snapshots aggregated', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!e.name.endsWith('.provenance.json')) files.push(p);
    }
  };
  walk(SNAP);
  assert.equal(files.length, 20, 'snapshot file count');
  const commits = new Set();
  for (const f of files) {
    const side = JSON.parse(fs.readFileSync(`${f}.provenance.json`, 'utf8'));
    assert.equal(sha256(fs.readFileSync(f)), side.writtenSha256, `${path.basename(f)} hash`);
    assert.equal(side.readMatchesCommitted, true, `${path.basename(f)} read from a clean checkout`);
    commits.add(side.commit);
  }
  assert.equal(commits.size, 1, 'one Aster commit');
  assert.equal([...commits][0], D.aster.commit);
  assert.equal(fs.readFileSync(path.join(HERE, 'data.js'), 'utf8'), aggregateText(buildAggregate(SNAP)), 'data.js is stale');
});

test('derived excerpts re-derive byte for byte from the Aster checkout, when one is present', (t) => {
  const aster = process.env.ASTER_DIR || '/home/user/asteroid-mining-planner';
  let head = null;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: aster, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    head = null;
  }
  if (head !== D.aster.commit) {
    t.skip(`no Aster checkout at ${D.aster.commit.slice(0, 7)} (set ASTER_DIR)`);
    return;
  }
  const long = JSON.parse(fs.readFileSync(path.join(aster, EARTH_REL), 'utf8'));
  const e = deriveEarth(long, C.secondsPerDay);
  assert.equal(e.text, readSnap('earth-weekly.js'));
  assert.equal(e.data.heldOut.count, 4695);
  const drift = JSON.parse(fs.readFileSync(path.join(aster, DRIFT_REL), 'utf8'));
  const trajs = BODY_KEYS.filter((b) => b[2]).map((b) => D.nhats[b[2]].min_dv_traj);
  assert.equal(deriveDrift(drift, e.data.records, trajs).text, readSnap('drift-excerpt.json'));
});

test('constants are read from Aster source, not typed here', () => {
  const again = readConstants(SNAP);
  assert.deepEqual(again, C);
  assert.equal(C.muSunKm3S2, 132712440018, 'GM_SUN_M3_S2 1.32712440018e20 m³/s² (keplerian.ts:9) in km³/s²');
  assert.equal(C.obliquityArcsec, 84381.448, 'units.ts:5');
  assert.equal(C.muEarthKm3S2, 398600.4418, 'delta-v.ts:3');
  assert.equal(C.parkingRadiusKm, 6578.137, 'delta-v.ts:4');
  assert.equal(C.earthRadiusKm, 6378.1366, 'bodies.ts:45');
  assert.equal(C.entryAltitudeKm, 125, 'NHATS research note :42');
  assert.equal(C.entryNoteLine, 42);
  assert.equal(C.symmetricReturnLine, 32, 'delta-v.ts:32 still books departure = arrival v∞');
  // The page and kernel files never type these numbers.
  for (const f of ['homeward.js', 'app.js', 'index.html']) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const lit of ['1.32712440018', '132712440018', '84381.448', '398600.4418', '398_600', '6578.137', '6378.13']) {
      assert.ok(!src.includes(lit), `${f} types ${lit}`);
    }
  }
});

// ---------------------------------------------------------------- Lambert against Aster's oracles
function parseEndToEnd() {
  const src = readSnap('lambert-endtoend.test.mjs');
  const consts = {};
  for (const name of ['MU_EARTH', 'MU_SUN', 'AU', 'TOL']) {
    consts[name] = Number(new RegExp(`const ${name} = ([\\d.eE+-]+);`).exec(src)[1]);
  }
  const evalNum = (expr) => {
    const e = expr.replace(/MU_EARTH|MU_SUN|AU/g, (m) => `(${consts[m]})`);
    assert.match(e, /^[\d\s.eE+*()/-]+$/, `unsafe expression ${expr}`);
    return Function(`return (${e});`)();
  };
  const vec = (s) => s.split(',').map((x) => evalNum(x.trim()));
  const cases = [];
  const re = /const k = (\w+);\s*const r1 = \[([^\]]+)\];\s*const r2 = \[([^\]]+)\];\s*const tof = ([^;]+);[\s\S]*?const expected_v1 = \[([^\]]+)\];\s*const expected_v2 = \[([^\]]+)\];/g;
  let m;
  while ((m = re.exec(src))) {
    cases.push({ k: consts[m[1]], r1: vec(m[2]), r2: vec(m[3]), tof: evalNum(m[4]), v1: vec(m[5]), v2: vec(m[6]) });
  }
  return { consts, cases };
}

test("reproduces Aster's three end-to-end Lambert vectors (Curtis 5.2, 5.3, heliocentric) inside Aster's own tolerance", () => {
  const { consts, cases } = parseEndToEnd();
  assert.equal(cases.length, 3);
  assert.equal(consts.TOL, 1e-8);
  for (const c of cases) {
    const s = H.lambert(c.r1, c.r2, c.tof, c.k, true);
    assert.equal(s.ok, true);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(Math.abs(s.v1[i] - c.v1[i]) < consts.TOL * Math.max(1, Math.abs(c.v1[i])), `v1[${i}] ${s.v1[i]} vs ${c.v1[i]}`);
      assert.ok(Math.abs(s.v2[i] - c.v2[i]) < consts.TOL * Math.max(1, Math.abs(c.v2[i])), `v2[${i}] ${s.v2[i]} vs ${c.v2[i]}`);
    }
  }
  // Aster's two refusal cases: collinear r1, r2 and a zero radius.
  assert.equal(H.lambert([10000, 0, 0], [20000, 0, 0], 3600, consts.MU_EARTH, true).reason, 'invalid_geometry');
  assert.equal(H.lambert([0, 0, 0], [10000, 0, 0], 3600, consts.MU_EARTH, true).ok, false);
});

test("reproduces Aster's poliastro-checked M=0 pinned cell to the fixture's own 1e-9 tolerance", () => {
  const pinned = JSON.parse(readSnap('lambert-multi-rev-pinned-cells.json'));
  const m0 = pinned.cells.filter((c) => c.M === 0);
  assert.equal(m0.length, 1, 'one M=0 cell in the fixture');
  for (const c of m0) {
    assert.equal(c.lw, true, 'Aster passes lw=true, i.e. prograde');
    const s = H.lambert(c.r1Km, c.r2Km, c.tofSeconds, c.muKm3S2, true);
    assert.ok(relErr(s.v1, c.expected.v1Kmps) < pinned.toleranceRel, `v1 ${relErr(s.v1, c.expected.v1Kmps)}`);
    assert.ok(relErr(s.v2, c.expected.v2Kmps) < pinned.toleranceRel);
    assert.ok(relErr(s.v1, c.poliastroCheck.v1Kmps) < pinned.toleranceRel);
    const vd = Math.hypot(...s.v1.map((x, i) => x - c.earthVelocityKmps[i]));
    const va = Math.hypot(...s.v2.map((x, i) => x - c.bodyVelocityKmps[i]));
    assert.ok(Math.abs(vd * vd - c.expected.c3Km2S2) / c.expected.c3Km2S2 < pinned.toleranceRel);
    assert.ok(Math.abs(va - c.expected.vInfArrKmps) / c.expected.vInfArrKmps < pinned.toleranceRel);
  }
});

function rk4(r0, v0, mu, tof, steps) {
  let r = r0.slice();
  let v = v0.slice();
  const h = tof / steps;
  const acc = (p) => {
    const d = Math.hypot(p[0], p[1], p[2]);
    const k = -mu / (d * d * d);
    return [k * p[0], k * p[1], k * p[2]];
  };
  for (let s = 0; s < steps; s += 1) {
    const a1 = acc(r);
    const r2 = r.map((x, i) => x + 0.5 * h * v[i]);
    const v2 = v.map((x, i) => x + 0.5 * h * a1[i]);
    const a2 = acc(r2);
    const r3 = r.map((x, i) => x + 0.5 * h * v2[i]);
    const v3 = v.map((x, i) => x + 0.5 * h * a2[i]);
    const a3 = acc(r3);
    const r4 = r.map((x, i) => x + h * v3[i]);
    const v4 = v.map((x, i) => x + h * a3[i]);
    const a4 = acc(r4);
    r = r.map((x, i) => x + (h / 6) * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]));
    v = v.map((x, i) => x + (h / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]));
  }
  return { r, v };
}
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function invariants(r, v, mu) {
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const R = Math.hypot(...r);
  const energy = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - mu / R;
  const vxh = [v[1] * h[2] - v[2] * h[1], v[2] * h[0] - v[0] * h[2], v[0] * h[1] - v[1] * h[0]];
  const e = vxh.map((x, i) => x / mu - r[i] / R);
  return { h, energy, e };
}

test('every solution flies: (r1, v1) integrated by an independent RK4 lands on r2 with v2, prograde, over 150 random heliocentric legs', () => {
  const rnd = lcg(21);
  const AU = 149597870.7; // only sets the scale of random test geometry
  let worstR = 0;
  let worstV = 0;
  let longWay = 0;
  let grazing = 0;
  for (let n = 0; n < 150; n += 1) {
    const pick = () => {
      const r = AU * (0.6 + 1.4 * rnd());
      const lon = 2 * Math.PI * rnd();
      const lat = (rnd() - 0.5) * 0.6;
      return [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)];
    };
    const r1 = pick();
    const r2 = pick();
    const tof = (20 + 700 * rnd()) * 86400;
    const s = H.lambert(r1, r2, tof, C.muSunKm3S2, true);
    assert.equal(s.ok, true, `case ${n}`);
    const hz = r1[0] * s.v1[1] - r1[1] * s.v1[0];
    assert.ok(hz >= 0, 'prograde: angular momentum z >= 0');
    if (r1[0] * r2[1] - r1[1] * r2[0] < 0) longWay += 1;
    // Both ends lie on one conic: same energy, angular momentum and eccentricity vector.
    const a = invariants(r1, s.v1, C.muSunKm3S2);
    const b = invariants(r2, s.v2, C.muSunKm3S2);
    assert.ok(relErr(b.h, a.h) < 1e-10, `h, case ${n}`);
    assert.ok(Math.abs(b.energy - a.energy) / Math.abs(a.energy) < 1e-9, `energy, case ${n}`);
    assert.ok(Math.hypot(...b.e.map((x, i) => x - a.e[i])) < 1e-9, `e vector, case ${n}`);
    // Flight time: a fixed-step RK4 is trustworthy only away from the Sun, so the Sun-grazing
    // long-way solutions (perihelion < 0.2 au) are checked by the invariants alone.
    const p = (a.h[0] ** 2 + a.h[1] ** 2 + a.h[2] ** 2) / C.muSunKm3S2;
    const rp = p / (1 + Math.hypot(...a.e));
    if (rp < 0.2 * AU) {
      grazing += 1;
      continue;
    }
    const f = rk4(r1, s.v1, C.muSunKm3S2, tof, 4000);
    worstR = Math.max(worstR, relErr(f.r, r2));
    worstV = Math.max(worstV, relErr(f.v, s.v2));
  }
  assert.ok(longWay > 30, 'the sample includes long-way transfers');
  assert.ok(150 - grazing >= 100, `only ${150 - grazing} cases flown by RK4`);
  console.log(`RK4-flown ${150 - grazing}, Sun-grazing ${grazing}, worst position ${worstR.toExponential(2)}, velocity ${worstV.toExponential(2)}`);
  assert.ok(worstR < 1e-8, `position ${worstR}`);
  assert.ok(worstV < 1e-8, `velocity ${worstV}`);
});

test('closed form: two points on a circular orbit, flight time = angle / mean motion, give circular velocity, both ways round', () => {
  const R = 1.2e8;
  const n = Math.sqrt(C.muSunKm3S2 / (R * R * R));
  const vc = Math.sqrt(C.muSunKm3S2 / R);
  for (const th of [0.3, 1.9, 3.0, 3.4, 5.5]) {
    const r1 = [R, 0, 0];
    const r2 = [R * Math.cos(th), R * Math.sin(th), 0];
    const s = H.lambert(r1, r2, th / n, C.muSunKm3S2, true);
    assert.ok(Math.abs(Math.hypot(...s.v1) - vc) / vc < 1e-10, `|v1| at ${th}`);
    assert.ok(Math.abs(s.v1[0]) / vc < 1e-9, `v1 tangential at ${th}`);
    assert.ok(Math.abs(s.v1[1] - vc) / vc < 1e-10, 'prograde, +y');
  }
});

// ---------------------------------------------------------------- Kepler and the frame, by measurement
test('catalog elements propagated to their epoch land on the catalog anchor state (all six, < 1 m and < 1e-9 km/s)', () => {
  for (const b of D.bodies) {
    const s = H.keplerState(b.elements, b.elements.epochTdbJd, C);
    assert.equal(b.anchor.epochTdbJd, b.elements.epochTdbJd);
    assert.ok(Math.hypot(...s.r.map((x, i) => x - b.anchor.positionKm[i])) < 1e-3, `${b.designation} position`);
    assert.ok(Math.hypot(...s.v.map((x, i) => x - b.anchor.velocityKmPerS[i])) < 1e-9, `${b.designation} velocity`);
  }
});

test('INV-021: the anchors and the Earth records are equatorial by measurement, not by label', () => {
  const ce = Math.cos(C.obliquityRad);
  const se = Math.sin(C.obliquityRad);
  for (const b of D.bodies) {
    const [x, y, z] = b.anchor.positionKm;
    const r = Math.hypot(x, y, z);
    const zEcl = -y * se + z * ce; // rotate back by −ε about x
    // In the ecliptic frame a body of inclination i can never be further than r·sin(i) from the plane.
    assert.ok(Math.abs(zEcl) <= r * Math.sin(b.elements.iRad) * (1 + 1e-9), `${b.designation} fits its inclination after the rotation`);
  }
  const ao10 = bodyOf('1999 AO10');
  const [x, y, z] = ao10.anchor.positionKm;
  assert.ok(Math.abs(z) / Math.hypot(x, y, z) > 5 * Math.sin(ao10.elements.iRad), 'unrotated, 1999 AO10 sits far outside its own inclination: the stored frame is not ecliptic');
  const maxVz = Math.max(...EARTH.records.map((r) => Math.abs(r[6])));
  assert.ok(maxVz > 11.5 && maxVz <= EARTH.maxAbsVzKmSAllDaily, `Earth |vz| reaches ${maxVz} km/s, impossible in an ecliptic frame`);
});

// ---------------------------------------------------------------- Earth from weekly samples
test('weekly Hermite Earth: exact at its nodes, null outside the span, and the whole-span held-out maxima reproduce', () => {
  for (const rec of EARTH.records.slice(0, 50)) {
    const s = earth.stateAt(rec[0]);
    assert.ok(Math.hypot(s.r[0] - rec[1], s.r[1] - rec[2], s.r[2] - rec[3]) < 1e-6);
  }
  assert.equal(earth.stateAt(EARTH.records[0][0] - 1), null);
  assert.equal(earth.stateAt(EARTH.records[EARTH.records.length - 1][0] + 0.5), null);
  assert.equal(H.jdToIso(earth.startJd), '2026-01-01');
  assert.equal(H.jdToIso(earth.endJd), '2040-12-31');
  // The build measured the weekly Hermite against all 4,695 daily records it left out and kept the
  // six from the worst interval; the kernel must reproduce those maxima exactly, at those dates.
  const held = EARTH.heldOutWorst;
  assert.equal(held.length, 6);
  assert.equal(EARTH.heldOut.count, EARTH.sourceRecords - EARTH.keptRecords);
  const nodes = new Set(EARTH.records.map((r) => r[0]));
  let maxR = 0;
  let maxV = 0;
  let atR = null;
  let atV = null;
  for (const d of held) {
    assert.equal(nodes.has(d[0]), false, 'held-out records are not interpolation nodes');
    const s = earth.stateAt(d[0]);
    const er = Math.hypot(s.r[0] - d[1], s.r[1] - d[2], s.r[2] - d[3]);
    const ev = Math.hypot(s.v[0] - d[4], s.v[1] - d[5], s.v[2] - d[6]);
    if (er > maxR) { maxR = er; atR = d[0]; }
    if (ev > maxV) { maxV = ev; atV = d[0]; }
  }
  assert.equal(maxR, EARTH.heldOut.maxPositionErrorKm);
  assert.equal(atR, EARTH.heldOut.maxPositionErrorAtJd);
  assert.equal(maxV, EARTH.heldOut.maxVelocityErrorKmS);
  assert.equal(atV, EARTH.heldOut.maxVelocityErrorAtJd);
  assert.ok(maxR > 150 && maxR < 210, `whole-span position bound ${maxR} km`);
  assert.ok(maxV > 0.0008 && maxV < 0.001, `whole-span velocity bound ${maxV} km/s`);
});

// ---------------------------------------------------------------- JPL NHATS return legs
const nh = (file) => D.nhats[file].min_dv_traj;
function nhatsLeg(file) {
  const b = D.bodies.find((x) => x.nhatsFile === file);
  const t = nh(file);
  const d = H.nhatsReturnDates(t);
  return { b, t, d, leg: H.returnLeg(b, earth, d.depJd, d.tofDays, C), boundary: H.supportBoundary(b.tier) };
}

test('1999 AO10: the return leg inside JPL NHATS’s min-ΔV round trip is reproduced to its rounding', () => {
  const { t, d, leg, boundary } = nhatsLeg('1999_AO10');
  assert.equal(H.jdToIso(d.depJd), '2026-05-14');
  assert.equal(d.tofDays, 305);
  assert.equal(H.departsAfterEncounter(d.depJd, boundary), false, 'departs before the 2029-02-14 Venus encounter');
  // Tolerance: NHATS prints three decimals (±0.0005) and the weekly Earth adds at most ~1 m/s.
  assert.ok(Math.abs(leg.vInfDep - Number(t.vrel_dep_neo)) < 0.002, `v∞ at departure ${leg.vInfDep} vs ${t.vrel_dep_neo}`);
  assert.ok(Math.abs(leg.entrySpeed - Number(t.v_arr_earth)) < 0.002, `entry ${leg.entrySpeed} vs ${t.v_arr_earth}`);
  assert.ok(Math.abs(leg.decArrDeg - Number(t.dec_arr)) < 0.01, `declination ${leg.decArrDeg} vs ${t.dec_arr}`);
  // Hand check of the entry speed: v∞ 4.3053 km/s, 2μ/r = 2 × 398600.4418 / 6503.1366 = 122.5871 km²/s².
  assert.ok(Math.abs(leg.vInfArr - 4.3053) < 5e-4);
  assert.ok(Math.abs(Math.sqrt(4.3053 ** 2 + 122.5871) - leg.entrySpeed) < 5e-4);
  // The same pipeline run outbound reproduces NHATS's launch C3 and departure declination.
  const out = H.outboundLeg(bodyOf('1999 AO10'), earth, d.launchJd, Number(t.dur_out), C);
  assert.ok(Math.abs(out.c3 - Number(t.c3)) < 0.002, `C3 ${out.c3}`);
  assert.ok(Math.abs(out.decDepDeg - Number(t.dec_dep)) < 0.01, `dec_dep ${out.decDepDeg}`);
  assert.ok(Math.abs(out.vInfArr - Number(t.vrel_arr_neo)) < 0.002);
});

test('the reproduction settles two conventions: NHATS declinations are equatorial, and v_arr_earth is the speed at 125 km', () => {
  const { t, leg } = nhatsLeg('1999_AO10');
  const [vx, vy, vz] = leg.vInfArrVec;
  const ce = Math.cos(C.obliquityRad);
  const se = Math.sin(C.obliquityRad);
  const decEcl = (Math.asin((-vy * se + vz * ce) / Math.hypot(vx, vy, vz)) * 180) / Math.PI;
  assert.ok(Math.abs(decEcl - Number(t.dec_arr)) > 1.5, `ecliptic reading ${decEcl} misses NHATS by 1.5°; equatorial hits it to 0.01°`);
  // The launch asymptote separates the frames more sharply.
  const d = H.nhatsReturnDates(t);
  const e1 = earth.stateAt(d.launchJd);
  const b2 = H.keplerState(bodyOf('1999 AO10').elements, d.launchJd + Number(t.dur_out), C);
  const s = H.lambert(e1.r, b2.r, Number(t.dur_out) * C.secondsPerDay, C.muSunKm3S2, true);
  const w = s.v1.map((x, i) => x - e1.v[i]);
  const decDepEcl = (Math.asin((-w[1] * se + w[2] * ce) / Math.hypot(...w)) * 180) / Math.PI;
  assert.ok(Math.abs(decDepEcl - Number(t.dec_dep)) > 20, `ecliptic launch declination ${decDepEcl}`);
  const at200 = H.speedAtRadius(leg.vInfArr, C.muEarthKm3S2, C.earthRadiusKm + 200);
  assert.ok(Math.abs(at200 - Number(t.v_arr_earth)) > 0.05, `at 200 km ${at200}`);
  assert.ok(Math.abs(leg.entrySpeed - Number(t.v_arr_earth)) < 0.002);
});

test('Bennu: supported, reproduced to tens of m/s (10.6 years of two-body drift); measured residuals pinned', () => {
  const { t, d, leg, boundary } = nhatsLeg('101955');
  assert.equal(H.jdToIso(d.depJd), '2036-12-03');
  assert.equal(H.departsAfterEncounter(d.depJd, boundary), false, 'departs before 2037-02-11');
  const rDep = leg.vInfDep - Number(t.vrel_dep_neo);
  const rEntry = leg.entrySpeed - Number(t.v_arr_earth);
  const rDec = leg.decArrDeg - Number(t.dec_arr);
  assert.ok(rDep > 0.016 && rDep < 0.021, `v∞ dep residual ${rDep}`);
  assert.ok(rEntry < -0.033 && rEntry > -0.038, `entry residual ${rEntry}`);
  assert.ok(rDec < -0.8 && rDec > -0.9, `declination residual ${rDec}`);
});

test('Apophis and 2000 SG344: the NHATS legs depart after the L1 encounter, and there the two-body reproduction fails', () => {
  for (const [file, label] of [['99942', '2028-09-12'], ['2000_SG344', '2027-05-16']]) {
    const { t, d, leg, boundary } = nhatsLeg(file);
    assert.equal(boundary.label, label);
    assert.equal(H.departsAfterEncounter(d.depJd, boundary), true);
    assert.equal(leg.status, H.STATUS.OK, 'still computed, never suppressed');
    assert.ok(Math.abs(leg.vInfDep - Number(t.vrel_dep_neo)) > 1.5, `${file} residual ${leg.vInfDep - Number(t.vrel_dep_neo)}`);
  }
});

test('2001 GP2: the NHATS return arrives after the Earth ephemeris ends, so it is refused, not computed', () => {
  const { d, leg, boundary } = nhatsLeg('2001_GP2');
  assert.equal(H.jdToIso(d.depJd), '2041-03-20');
  assert.equal(leg.status, H.STATUS.NO_EARTH);
  assert.equal(leg.refusal.code, 'insufficient_data');
  assert.ok(D.refusalCodes.includes(leg.refusal.code));
  assert.equal(leg.vInfArr, undefined);
  assert.equal(H.departsAfterEncounter(d.depJd, boundary), true);
});

test("Apophis's state drifts from JPL's integrated truth by < 1.1e5 km before its encounters and by 1.2e7 km at the NHATS departure", () => {
  const recs = D.drift.targets['99942'].records;
  const apophis = bodyOf('99942');
  const enc = H.supportBoundary(apophis.tier).encounterJd;
  const flyby = apophis.tier.maxDriftEncounter.jd;
  let before = 0;
  let after = Infinity;
  for (const r of recs) {
    const s = H.keplerState(apophis.elements, r[0], C);
    const dr = Math.hypot(s.r[0] - r[1], s.r[1] - r[2], s.r[2] - r[3]);
    if (r[0] < enc) before = Math.max(before, dr);
    if (r[0] > flyby) after = Math.min(after, dr);
  }
  assert.ok(before < 1.1e5, `before ${before}`);
  assert.ok(after > 1e6, `after ${after}`);
  const dep = H.nhatsReturnDates(nh('99942')).depJd;
  const atDep = recs.find((r) => r[0] === dep);
  const s = H.keplerState(apophis.elements, dep, C);
  const dr = Math.hypot(s.r[0] - atDep[1], s.r[1] - atDep[2], s.r[2] - atDep[3]);
  const dv = Math.hypot(s.v[0] - atDep[4], s.v[1] - atDep[5], s.v[2] - atDep[6]);
  assert.ok(dr > 1.19e7 && dr < 1.21e7, `drift ${dr}`);
  assert.ok(dv > 3.3 && dv < 3.4, `velocity drift ${dv}`);
  // Eros (L2, measured but unbounded): two-body stays within 6e5 km over the whole span.
  const eros = bodyOf('433');
  let worst = 0;
  for (const r of D.drift.targets['433'].records) {
    const e = H.keplerState(eros.elements, r[0], C);
    worst = Math.max(worst, Math.hypot(e.r[0] - r[1], e.r[1] - r[2], e.r[2] - r[3]));
  }
  assert.ok(worst > 3e5 && worst < 6e5, `Eros ${worst}`);
});

// ---------------------------------------------------------------- the grid, refusals and support
const lattice = H.defaultLattice(earth, D.lattice);

test('the grid: every cell carries a delivered-mass refusal; cells past the ephemeris refuse; the counts close', () => {
  const b = bodyOf('101955');
  const g = H.computeGrid(b, earth, lattice, C);
  assert.equal(g.counts.cells, D.lattice.nDep * D.lattice.nTof);
  let expectNoEarth = 0;
  for (const dep of g.deps) for (const tof of g.tofs) if (dep + tof > earth.endJd) expectNoEarth += 1;
  assert.equal(g.counts.noEarth, expectNoEarth);
  assert.equal(g.counts.ok + g.counts.noEarth + g.counts.noSolution + g.counts.noBody, g.counts.cells);
  let unsupported = 0;
  for (let i = 0; i < g.deps.length; i += 1) {
    for (let j = 0; j < g.tofs.length; j += 1) {
      const cell = H.cellAt(g, b, earth, i, j, C);
      assert.equal(cell.deliveredMass.refusal.code, 'out_of_envelope');
      assert.ok(D.refusalCodes.includes(cell.deliveredMass.refusal.code));
      assert.ok(cell.deliveredMass.refusal.what_would_help.length > 20);
      assert.equal('kg' in cell.deliveredMass, false);
      const k = i * g.tofs.length + j;
      if (cell.status === H.STATUS.NO_EARTH) assert.equal(cell.refusal.code, 'insufficient_data');
      else assert.equal(cell.vInfArr, g.vInfArr[k], 'readout and grid share one path');
      if (cell.status === H.STATUS.OK && !cell.supported) unsupported += 1;
    }
  }
  assert.equal(unsupported, g.counts.unsupported);
});

test('the support boundary keys on departure for a return leg (Aster keys on arrival outbound)', () => {
  assert.equal(D.outboundSupportRule.rule, 'arrivalJd(cell) >= boundary.encounterJd');
  assert.equal(D.outboundSupportRule.line, 49);
  const b = bodyOf('101955');
  const bnd = H.supportBoundary(b.tier);
  assert.equal(bnd.label, '2037-02-11');
  const dep = bnd.encounterJd - 30;
  const tof = 100;
  assert.equal(H.departsAfterEncounter(dep, bnd), false, 'return: departs before the encounter, supported');
  assert.equal(dep + tof >= bnd.encounterJd, true, 'outbound rule would have called it unsupported');
  assert.equal(H.departsAfterEncounter(bnd.encounterJd, bnd), true, 'at the encounter itself: unsupported');
  assert.equal(H.supportBoundary(bodyOf('433').tier), null, 'L2 Eros has no boundary');
  const g = H.computeGrid(b, earth, lattice, C);
  let after = 0;
  for (let i = 0; i < g.deps.length; i += 1) {
    for (let j = 0; j < g.tofs.length; j += 1) {
      if (g.status[i * g.tofs.length + j] === H.STATUS.OK && g.deps[i] >= bnd.encounterJd) after += 1;
    }
  }
  assert.equal(after, g.counts.unsupported);
  assert.ok(g.deps[g.minima.vInfArr.i] < bnd.encounterJd, 'reported minimum is a supported cell');
  // Bennu's NHATS return leg leaves 2036-12-03 and lands 2037-03-18, after the 2037-02-11 encounter:
  // the outbound rule would flag it, yet it reproduces NHATS (test above).
  const nb = H.nhatsReturnDates(D.nhats['101955'].min_dv_traj);
  assert.ok(nb.depJd < bnd.encounterJd && nb.arrJd >= bnd.encounterJd);
  // For 2000 SG344, 893 of the 1,330 cells this rule supports would be flagged by the arrival rule.
  const sg = H.computeGrid(bodyOf('2000 SG344'), earth, lattice, C);
  let supported = 0;
  let overflag = 0;
  for (let i = 0; i < sg.deps.length; i += 1) {
    for (let j = 0; j < sg.tofs.length; j += 1) {
      if (sg.status[i * sg.tofs.length + j] !== H.STATUS.OK || sg.deps[i] >= sg.boundary.encounterJd) continue;
      supported += 1;
      if (sg.deps[i] + sg.tofs[j] >= sg.boundary.encounterJd) overflag += 1;
    }
  }
  assert.deepEqual([supported, overflag], [1330, 893]);
});

test('body-level refusals use only Aster’s envelope codes', () => {
  const codes = D.refusalCodes;
  assert.deepEqual(codes, ['insufficient_data', 'out_of_envelope', 'not_found']);
  const r0 = H.bodyRefusal(null);
  const r1 = H.bodyRefusal({ elements: bodyOf('433').elements, tier: null });
  const r2 = H.bodyRefusal({ elements: bodyOf('433').elements, tier: { tier: 'L0' } });
  const r3 = H.bodyRefusal({ elements: Object.assign({}, bodyOf('433').elements, { e: 1.2 }), tier: { tier: 'L2' } });
  assert.deepEqual([r0.code, r1.code, r2.code, r3.code], ['not_found', 'insufficient_data', 'out_of_envelope', 'out_of_envelope']);
  for (const r of [r0, r1, r2, r3]) assert.ok(r.reason && r.what_would_help);
  for (const b of D.bodies) assert.equal(H.bodyRefusal(b), null, `${b.designation} is plannable`);
});

test("lattice label: Aster's own pinned labels reproduce, and this grid's label is derived from its parameters", () => {
  const src = readSnap('c3-grid.test.mjs');
  const re = /formatJdC3GridLabel\(\{\s*depStartJD: ([\d.]+),\s*depEndJD: ([\d.]+),\s*tofMinDays: ([\d.]+),\s*tofMaxDays: ([\d.]+),\s*nDep: (\d+),\s*nTof: (\d+),\s*\}\);\s*assert\.equal\(\w+, '([^']+)'\);/g;
  let m;
  let n = 0;
  while ((m = re.exec(src))) {
    const p = { depStartJd: +m[1], depEndJd: +m[2], tofMinDays: +m[3], tofMaxDays: +m[4], nDep: +m[5], nTof: +m[6] };
    assert.equal(H.latticeLabel(p), m[7]);
    n += 1;
  }
  assert.equal(n, 2);
  const g = H.computeGrid(bodyOf('433'), earth, lattice, C);
  assert.equal(g.label, '200×70 grid · 27.4 d × 10 d steps');
  assert.equal(lattice.depStartJd, EARTH.records[0][0]);
  assert.equal(lattice.depEndJd, EARTH.records[EARTH.records.length - 1][0] - D.lattice.tofMinDays);
  assert.notEqual(H.latticeLabel(Object.assign({}, lattice, { nDep: 100 })), g.label);
});

test("colours: Aster's log-viridis stops over v∞² reproduce at the ends and the middle", () => {
  const cm = D.colormap;
  assert.deepEqual(H.viridisRgb(1, cm), [68, 1, 84]);
  assert.deepEqual(H.viridisRgb(0.01, cm), [68, 1, 84], 'clamped at the floor');
  assert.deepEqual(H.viridisRgb(Math.sqrt(1000), cm), [33, 145, 140], 't = 0.5');
  assert.deepEqual(H.viridisRgb(1000, cm), [253, 231, 37]);
  assert.deepEqual(H.viridisRgb(5000, cm), [253, 231, 37]);
  assert.deepEqual(H.viridisRgb(NaN, cm), cm.noSolutionRgb);
});

test("capture into Aster's 200 km parking orbit is Aster's own injectionDvFromC3, run on the snapshot's code", () => {
  const src = readSnap('delta-v.ts');
  const m = /export function injectionDvFromC3\([\s\S]*?\): number \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(m, 'injectionDvFromC3 body');
  const asterInjection = Function('c3Km2PerS2', 'muKm3PerS2', 'parkingRadiusKm', m[1]);
  for (const vInf of [0, 0.3, 1, 2.5, 4.305, 7, 12]) {
    const ours = H.captureDvKmS(vInf, C.muEarthKm3S2, C.parkingRadiusKm);
    const theirs = asterInjection(vInf * vInf, C.muEarthKm3S2, C.parkingRadiusKm);
    assert.ok(Math.abs(ours - theirs) < 1e-12, `${vInf}`);
  }
  assert.ok(Math.abs(H.speedAtRadius(0, C.muEarthKm3S2, C.entryRadiusKm) - Math.sqrt(122.5871)) < 1e-4, 'escape speed at 125 km');
});

test('calendar and NHATS date arithmetic', () => {
  assert.equal(H.isoToJd('2026-01-01'), 2461041.5);
  assert.equal(H.jdToIso(2461041.5), '2026-01-01');
  assert.equal(H.jdToIso(H.isoToJd('2040-12-31')), '2040-12-31');
  const d = H.nhatsReturnDates({ launch: '2036-03-21', dur_out: 249, dur_at: 8, dur_ret: 105 });
  assert.equal(H.jdToIso(d.depJd), '2036-12-03');
  assert.equal(H.jdToIso(d.arrJd), '2037-03-18');
  assert.equal(H.cadDate('2028-Sep-12 04:11'), '2028-09-12');
});

test('a minimum on an edge of what was searched says so (lattice edge, ephemeris end, L1 boundary)', () => {
  const ao10 = H.computeGrid(bodyOf('1999 AO10'), earth, lattice, C);
  assert.deepEqual(H.edgesOf(ao10, ao10.minima.vInfDep), ['first departure date']);
  assert.deepEqual(H.edgesOf(ao10, ao10.minima.vInfArr), []);
  const sg = H.computeGrid(bodyOf('2000 SG344'), earth, lattice, C);
  assert.deepEqual(H.edgesOf(sg, sg.minima.vInfArr), ['last departure before the L1 encounter']);
  assert.ok(sg.vInfArr[sg.minima.vInfArrAll.k] < sg.vInfArr[sg.minima.vInfArr.k], 'a lower value exists past the boundary');
  const nT = ao10.tofs.length;
  assert.deepEqual(H.edgesOf(ao10, { i: 3, j: 0, k: 3 * nT }), ['shortest flight time']);
  const last = ao10.deps.length - 1;
  assert.ok(H.edgesOf(ao10, { i: last, j: 0, k: last * nT }).includes('last departure date'));
  // The longest flight still inside the Earth span for some late column.
  const col = ao10.deps.findIndex((d) => d + lattice.tofMaxDays > earth.endJd);
  let j = 0;
  while (ao10.status[col * nT + j + 1] !== H.STATUS.NO_EARTH) j += 1;
  assert.ok(H.edgesOf(ao10, { i: col, j, k: col * nT + j }).includes('longest flight inside the Earth ephemeris'));
  assert.deepEqual(H.edgesOf(ao10, null), []);
});

test('Stumpff functions: the near-zero series meets the closed forms and an independent 12-term Taylor sum', () => {
  // C(z) = Σ (−z)^k / (2k+2)!, S(z) = Σ (−z)^k / (2k+3)!
  const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
  const taylor = (z, off) => {
    let s = 0;
    for (let k = 0; k < 12; k += 1) s += (-z) ** k / fact(2 * k + off);
    return s;
  };
  assert.equal(H.stumpffC(0), 0.5);
  assert.equal(H.stumpffS(0), 1 / 6);
  for (const z of [-0.9e-3, -0.5e-3, -1e-5, 1e-5, 0.5e-3, 0.9e-3, -0.05, 0.05, 1.5, -1.5]) {
    assert.ok(Math.abs(H.stumpffC(z) - taylor(z, 2)) < 1e-13, `C(${z})`);
    assert.ok(Math.abs(H.stumpffS(z) - taylor(z, 3)) < 1e-13, `S(${z})`);
  }
  // Continuity across the switch at |z| = 1e-3.
  for (const z of [1e-3, -1e-3]) {
    assert.ok(Math.abs(H.stumpffC(z * (1 - 1e-9)) - H.stumpffC(z * (1 + 1e-9))) < 1e-12);
    assert.ok(Math.abs(H.stumpffS(z * (1 - 1e-9)) - H.stumpffS(z * (1 + 1e-9))) < 1e-12);
  }
});
