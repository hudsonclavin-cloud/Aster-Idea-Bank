// whose-earth.test.mjs — node --test ideas/14-whose-earth/whose-earth.test.mjs (from the bank root)
// Pins the arithmetic to numbers published outside this folder: Skyhook's params/rev_a.json and
// finance/decision_grid.json, Aster's own injection values in its founding record and audit, Abramowitz &
// Stegun's erf table and closed forms. Tests that need the two checkouts skip themselves (and say so) without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as C from './collect.mjs';

const M = C.Model;
const R = C.Reg;
const HERE = C.HERE;
const canon = JSON.parse(fs.readFileSync(path.join(HERE, 'snapshots/rev_a.json'), 'utf8'));
const byId = Object.fromEntries(R.rows.map((r) => [r.id, r]));
const earth = (id) => M.earthFromSet(R.EARTH_SETS.find((s) => s.id === id), byId, canon);
const S = earth('skyhook');
const A = earth('aster');
const LIVE = C.isCheckout(R.REPOS.aster.dir) && C.isCheckout(R.REPOS.skyhook.dir);
const liveSkip = LIVE ? false : 'needs the Aster and Skyhook checkouts';
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const offline = () => C.collect({ offline: true });

test('literals parse in every spelling the two repositories use', () => {
  assert.equal(M.parseLiteral('398_600.4418'), 398600.4418);
  assert.equal(M.parseLiteral('6,378,137'), 6378137);
  assert.equal(M.parseLiteral('6371e3'), 6371000);
  assert.equal(M.parseLiteral('3.986 × 10¹⁴'), 3.986e14);
  assert.equal(M.toCanonical(M.parseLiteral('3.986004418e14'), 'm3s2'), 398600.4418);
  assert.equal(M.toCanonical(M.parseLiteral('398600000000000.0'), 'm3s2'), 398600);
  assert.equal(M.toCanonical(M.parseLiteral('6_378_136.6'), 'm'), 6378.1366);
  assert.ok(Number.isNaN(M.parseLiteral('about 6371')));
  assert.ok(Number.isNaN(M.parseLiteral('')));
});

test('the registry is internally consistent', () => {
  const ids = new Set();
  for (const r of R.rows) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert.ok(M.UNITS[r.unit], `${r.id}: unit ${r.unit}`);
    assert.ok(R.ROLES[r.role], `${r.id}: role ${r.role}`);
    assert.ok(['literal', 'comment', 'prose', 'implied-com', 'implied-tip', 'implied-parking', 'parking-altitude', 'equivalent', 'formula', 'claim'].includes(r.kind), `${r.id}: kind ${r.kind}`);
    if (r.literal != null) {
      assert.ok(r.token.includes(r.literal), `${r.id}: literal inside token`);
      assert.ok(Number.isFinite(M.rowValue(r, byId, canon)), `${r.id}: value`);
      if (r.kind !== 'parking-altitude') assert.equal(M.UNITS[r.unit].family, r.family, `${r.id}: unit family`);
    }
    if (r.pair) assert.ok(byId[r.pair] && byId[r.pair].kind === 'parking-altitude', `${r.id}: pair`);
  }
  for (const s of R.EARTH_SETS) for (const k of ['mu', 'R', 'g0', 'vRot']) if (s[k]) assert.ok(byId[s[k]], `${s.id}.${k}`);
});

test('the three Earths come out of the rows: Skyhook 398600 / 6371, Aster 398600.4418 / 6378.137, rev_a.json orbital block 6378', () => {
  assert.equal(S.mu, 398600);
  assert.equal(S.R, 6371);
  assert.equal(S.g0, 9.80665);
  assert.equal(S.vRot, 0.465);
  assert.equal(A.mu, 398600.4418);
  close(A.R, 6378.137, 1e-9, 'Aster R = 6578.137 − 200');
  assert.equal(A.g0, 9.80665);
  assert.equal(A.vRot, null);
  assert.equal(earth('canon-com').R, 6378);
  // the canon's three r_tip notes all imply the module's radius
  for (const id of ['sk-canon-rtip-upper', 'sk-canon-rtip-c3', 'sk-canon-rtip-mkt', 'sk-dl-rtip']) assert.equal(M.rowValue(byId[id], byId, canon), 6371, id);
});

test('erf matches Abramowitz & Stegun Table 7.1 and its limits', () => {
  // A&S Table 7.1 (10 decimals)
  close(M.erf(0.5), 0.5204998778, 5e-11, 'erf 0.5');
  close(M.erf(1), 0.8427007929, 5e-11, 'erf 1');
  close(M.erf(1.5), 0.9661051465, 5e-11, 'erf 1.5');
  close(M.erf(2), 0.9953222650, 5e-11, 'erf 2');
  close(M.erf(1e-6), (2 / Math.sqrt(Math.PI)) * 1e-6, 1e-18, 'small-x limit');
  assert.equal(M.erf(-1), -M.erf(1));
  assert.equal(M.erf(10), 1);
  // EQ-6 small-x series: 2√π·x·e^(x²)·erf(x) = 4x²(1 + 2x²/3 + …)
  const x = 1e-3;
  close(M.massRatio(x * 2, 2, 1, 0, 2), 4 * x * x * (1 + (2 * x * x) / 3), 1e-17, 'mass ratio small-x');
});

test('params/rev_a.json reproduces on the Skyhook module Earth at its printed rounding, except the three it cannot', () => {
  const t = M.deriveCanon(canon, S);
  const val = (p) => t.find((q) => q.path === p);
  const expectRepro = {
    'kinematics.c3_kms2': -8.06, 'kinematics.cislunar_revenue_gated_option.c3_kms2': -1.94, 'kinematics.phase3_growth_option.c3_kms2': 13.05,
    'kinematics.apogee_altitude_km': 85222, 'kinematics.cislunar_revenue_gated_option.apogee_altitude_km': 397819,
    'kinematics.v_upper_release_kms': 10.06, 'kinematics.cislunar_revenue_gated_option.v_upper_release_kms': 10.36,
    'kinematics.v_lower_tip_groundrel_kms': 4.59, 'kinematics.phase3_growth_option.v_lower_tip_groundrel_kms': 3.59,
    'kinematics.tip_acceleration_g': 1.99, 'kinematics.cislunar_revenue_gated_option.tip_acceleration_g': 2.5, 'kinematics.phase3_growth_option.tip_acceleration_g': 3.9,
    'geometry.rotation_period_min': 13.4, 'materials.V_c_kms': 2.73, 'materials.specific_strength_MJkg': 3.72, 'mass_ratio.tip_speed_to_Vc_ratio': 0.92,
    'mass_ratio.integrated_tether_to_payload_both_arms.optimistic_0pct_derate': 40.32,
    'mass_ratio.integrated_tether_to_payload_both_arms.baseline_15pct_derate': 64.3,
    'mass_ratio.integrated_tether_to_payload_both_arms.conservative_30pct_derate': 121.83,
    'mass_ratio.integrated_tether_to_payload_both_arms.cislunar_2p8kms_30pct_derate': 295.27,
    'mass_ratio.integrated_tether_to_payload_both_arms.phase3_3p5kms_30pct_derate': 3085.95,
    'mass_ratio.integrated_tether_to_payload_both_arms.conservative_30pct_fiber_mass_t': 609.1,
    'market_thresholds.escape_C3_0_tip_speed_kms': 2.9,
  };
  for (const [p, printed] of Object.entries(expectRepro)) {
    const q = val(p);
    assert.ok(q, p);
    assert.equal(q.printed, printed, `${p} printed in the snapshot`);
    assert.equal(q.reproduces, true, `${p}: ${q.value} should round to ${printed}`);
  }
  // the hand values behind them (two-body, km and km/s)
  close(val('orbital.v_orb_kms').value, Math.sqrt(398600 / 6981), 1e-12, 'v_orb');
  close(val('kinematics.c3_kms2').value, (Math.sqrt(398600 / 6981) + 2.5) ** 2 - (2 * 398600) / 7301, 1e-12, 'C3 by hand');
  const failing = t.filter((q) => q.depends.length && q.reproduces === false).map((q) => q.path).sort();
  assert.deepEqual(failing, R.EXPECTED.skyhookNonReproducing.slice().sort());
  assert.equal(val('market_thresholds.GTO_tip_speed_kms').refused.code, 'insufficient_data');
});

test('on Aster\'s Earth the kinematics stop reproducing and the orbital block starts: rev_a.json mixes two radii', () => {
  const t = M.deriveCanon(canon, A);
  const val = (p) => t.find((q) => q.path === p);
  assert.equal(val('orbital.com_radius_km').reproduces, true);
  assert.equal(val('orbital.v_orb_kms').reproduces, true);
  assert.equal(val('kinematics.phase3_growth_option.v_upper_release_kms').reproduces, true);
  for (const p of ['kinematics.c3_kms2', 'kinematics.apogee_altitude_km', 'kinematics.cislunar_revenue_gated_option.apogee_altitude_km', 'kinematics.v_upper_release_kms']) {
    assert.equal(val(p).reproduces, false, p);
  }
  // Aster states no rotation: the ground-relative speed refuses instead of inventing a number
  const lower = val('kinematics.v_lower_tip_groundrel_kms');
  assert.equal(lower.value, null);
  assert.equal(lower.refused.code, 'insufficient_data');
  assert.match(lower.refused.what_would_help, /ASTER_ROADMAP/);
  // nothing that needs no Earth moves
  const tS = M.deriveCanon(canon, S);
  t.forEach((q, i) => { if (!q.depends.length || q.depends.join() === 'g0') assert.equal(q.value, tS[i].value, q.path); });
});

test('K2 shifts: μ alone is ~4e-5 km²/s², the radius 0.021–0.029, the mixed reading 0.107; closed forms agree', () => {
  const g = M.geometry(canon, S);
  const gA = M.geometry(canon, A);
  for (const t of M.tiers(canon)) {
    const s = M.c3Shift(canon, S, A, t.vTip);
    // first-order μ sensitivity: dC3/dμ = v_rel·v_orb/μ − 2/r_tip
    const vRel = g.vOrb + t.vTip;
    close(s.muOnly, ((vRel * g.vOrb) / S.mu - 2 / g.rTip) * (A.mu - S.mu), 1e-9, `${t.id} μ-only closed form`);
    // mixed: same speed, other radius -> 2μ(1/r_tip − 1/r_tip')
    close(s.mixed, 2 * S.mu * (1 / g.rTip - 1 / gA.rTip), 1e-12, `${t.id} mixed closed form`);
    assert.ok(Math.abs(s.muOnly) < 5e-5, 'μ-only below 5e-5');
    assert.ok(s.both > 0.020 && s.both < 0.030, `${t.id} consistent shift ${s.both}`);
    assert.ok(s.mixed > 0.10 && s.mixed < 0.12, `${t.id} mixed shift ${s.mixed}`);
    close(s.both, s.muOnly + s.rOnly, 1e-6, 'shifts nearly additive');
  }
  // Tip Match (idea 01) published 0.029 km²/s² (consistent) and 0.106 (mixed; the value is 0.10663, which rounds to 0.107)
  // for the reference tier, and trims 0.393 / 0.093 / −0.607 and v∞* 3.613
  const ref = M.c3Shift(canon, S, A, 2.5);
  assert.equal(ref.both.toFixed(3), '0.029');
  assert.equal(ref.mixed.toFixed(3), '0.107');
  const iface = M.interfaceEffects(canon, S, A, 200);
  assert.deepEqual(iface.map((t) => t.trim0.A.toFixed(3)), ['0.393', '0.093', '-0.607']);
  assert.equal(iface[2].vInfStar.A.toFixed(3), '3.613');
  assert.equal(iface[2].vInfStar.B.toFixed(3), '3.616');
  // the cislunar apogee is the most Earth-sensitive canon number
  const cis = iface[1];
  assert.ok(cis.apogee.B - cis.apogee.A > 5700 && cis.apogee.B - cis.apogee.A < 5760, `cislunar apogee shift ${cis.apogee.B - cis.apogee.A}`);
  assert.ok(cis.apogee.mixed - cis.apogee.A > 23900 && cis.apogee.mixed - cis.apogee.A < 24000);
});

test('Aster\'s own injection values reproduce with its constants, and three of four miss on Skyhook\'s Earth', () => {
  // hand-worked: C3 = 0 is (√2 − 1)·√(μ/r)
  close(M.injectionDvFromC3(0, A.mu, A.R + 200), (Math.SQRT2 - 1) * Math.sqrt(A.mu / 6578.137), 1e-12, 'C3=0 closed form');
  const r = offline();
  const pins = r.analysis.pins;
  assert.deepEqual(pins.map((p) => p.c3).sort((a, b) => a - b), [0, 8.78, 32.16, 1781.29]);
  assert.deepEqual(pins.map((p) => p.printed).sort(), ['3.224', '3.616', '35.83', '4.599']);
  assert.ok(pins.every((p) => p.reproduces), 'Aster Earth reproduces all four');
  assert.equal(pins.filter((p) => !p.reproducesOnSkyhook).length, 3);
});

test('reboost: 2·v_orb·v_tip is the kinetic term exactly; orbital energy adds the two-body potential; n·ΔH agrees within 0.1 %', () => {
  for (const t of M.tiers(canon)) {
    const b = M.reboost(canon, S, t.vTip);
    const g = M.geometry(canon, S);
    close(b.momentum, b.kinetic, 1e-12, 'identity ½((a+b)²−(a−b)²) = 2ab');
    close(b.orbital - b.momentum, (S.mu * 2 * g.L) / (g.rLow * g.rTip), 1e-12, 'potential term closed form');
    close(b.angular, b.momentum + (2 * g.L * g.vOrb * g.vOrb) / g.rCom, 1e-12, 'n·ΔH closed form');
    assert.ok(Math.abs(b.angular - b.orbital) / b.orbital < 1e-3);
  }
  const ref = M.reboost(canon, S, 2.5);
  assert.equal(ref.momentum.toFixed(1), '37.8'); // the finance model's value, as the proposal states
  assert.equal(ref.orbital.toFixed(2), '43.03');
  assert.equal(ref.groundRel.toFixed(2), '45.27');
});

test('MP-001\'s 44.8 MJ/kg: no reading of the canon in the sweep rounds to it', () => {
  const r = offline();
  assert.equal(r.analysis.target, 44.8);
  assert.equal(r.analysis.sweep.length, 144);
  assert.ok(r.analysis.sweep[0].distance > 0.05, `nearest ${r.analysis.sweep[0].value}`);
  assert.equal(r.analysis.sweep[0].value.toFixed(2), '45.19');
  // the sweep contains the finance model's reading and the orbital-energy reading
  assert.ok(r.analysis.sweep.some((x) => x.R === 6371 && x.vOrbName === 'v_orb computed' && x.relName === 'release v_orb+v_tip' && x.catchName === 'catch inertial' && x.peName === 'no potential term' && Math.abs(x.value - 37.7816) < 1e-4));
});

test('Skyhook\'s decision grid: 9 of 9 mass ratios and 9 of 9 reboost lines reproduce at 4 decimals, the reboost only on R = 6371', () => {
  const r = offline();
  const pts = r.analysis.gridCheck.points;
  assert.equal(pts.length, 9);
  for (const p of pts) {
    assert.equal(p.massRatioReproduces, true, `${p.tier} ${p.column} ${p.massRatio} vs ${p.published.mass_ratio_x}`);
    assert.ok(M.reproduces(p.dollars.skyhook.momentum, p.published.reboost_electricity_per_kg), `${p.tier} ${p.column} momentum`);
    assert.ok(!M.reproduces(p.dollars.aster.momentum, p.published.reboost_electricity_per_kg), `${p.tier} ${p.column} fails on Aster's Earth`);
    assert.ok(!M.reproduces(p.dollars.skyhook.orbital, p.published.reboost_electricity_per_kg), 'orbital view is not what the grid prices');
  }
  const cons = pts.find((p) => p.tier === 'reference' && p.column === 'Conservative');
  assert.equal(cons.published.reboost_electricity_per_kg, 5.5973);
  assert.equal((cons.dollars.skyhook.orbital - cons.published.reboost_electricity_per_kg).toFixed(2), '0.78');
  for (const [, p] of Object.entries(r.analysis.gridCheck.proportionality)) assert.ok(p.spread < 1e-4, 'linear in v_tip');
});

test('every gate holds offline, and the concordance groups say what the README says', () => {
  const r = offline();
  assert.equal(r.ok, true, JSON.stringify(r.failedGates));
  const g = r.analysis.groups;
  const muVals = g.mu.map((x) => x.value).sort((a, b) => a - b);
  assert.deepEqual(muVals, [398600, 398600.4418, 398600.435507].sort((a, b) => a - b));
  const asterMuInSkyhook = g.mu.find((x) => x.value === 398600.4418).rows.filter((x) => x.repo === 'skyhook').map((x) => `${x.path}:${x.line}`);
  assert.deepEqual(asterMuInSkyhook, ['tools/sims/skyhook_calculator.jsx:4', 'tools/sims/skyhook_program_site.html:1133']);
  const rVals = g.R.map((x) => Number(x.value.toFixed(4)));
  for (const v of [6371, 6371.01, 6378, 6378.1366, 6378.137, 6378.14]) assert.ok(rVals.includes(v), `R ${v}`);
  assert.equal(g.g0.find((x) => x.value === 9.81).rows.length, 6);
  const energies = g.energy.filter((x) => x.family === 'energy').map((x) => Number(x.value.toFixed(2))).sort((a, b) => a - b);
  assert.deepEqual(energies, [30, 44.64, 44.8]);
  const elec = g.energy.filter((x) => x.family === 'elec').map((x) => x.value).sort((a, b) => a - b);
  assert.deepEqual(elec, [33, 48]);
});

test('row verification notices a moved, a deleted and a duplicated line', () => {
  const row = byId['sk-phys-R'];
  const text = ['a', 'b', row.token].join('\n');
  assert.equal(C.verifyRow(Object.assign({}, row, { line: 3 }), text).status, 'ok');
  assert.deepEqual(C.verifyRow(Object.assign({}, row, { line: 2 }), text), { status: 'moved', foundLine: 3, text: row.token });
  assert.equal(C.verifyRow(row, 'nothing here').status, 'missing');
  assert.equal(C.verifyRow(Object.assign({}, row, { line: 1 }), `x\n${row.token}\n${row.token}`).status, 'ambiguous');
  assert.equal(C.verifyRow(row, null).status, 'no-file');
  assert.equal(C.verifyRow(Object.assign({}, row, { token: 'R_EARTH_KM = 6378.0' }), row.token).status, 'bad-row');
});

test('the scan flags an unregistered constant, honours exclusions and summarises legacy code', () => {
  const files = {
    'src/v2/new-thing.ts': 'export const MU = 398600.4418;\nconst R = 6_378_137; // m\n',
    'src/v2/porkchop/delta-v.ts': `\n\nexport const EARTH_MU_KM3_PER_S2 = 398_600.4418;\n`,
    'docs/assets/bundle.js': 'const MU=398600.4418',
    'src/physics/old.ts': 'const GM_earth = 3.986e14;\nconst r = 6371000;',
    'tests/fixtures/v2/x.json': '{"x": 6371.5}',
    'notes.md': 'the surface rotates at 0.465 km/s at the equator; unrelated 0.465 elsewhere',
  };
  const s = C.scanFiles('aster', Object.keys(files), (f) => files[f], R.rows);
  const un = s.unregistered.map((u) => `${u.path}:${u.line}:${u.family}`).sort();
  assert.deepEqual(un, ['notes.md:1:rot', 'src/v2/new-thing.ts:1:mu', 'src/v2/new-thing.ts:2:R']);
  assert.equal(s.hits.filter((h) => h.path === 'src/v2/porkchop/delta-v.ts').length, 1, 'registered line is a hit but not unregistered');
  assert.deepEqual(s.summaries.legacy.byValue, { 'mu 398600': 1, 'R 6371': 1 });
  // a line with 0.465 but no rotation context is not a hit
  const s2 = C.scanFiles('aster', ['a.md'], () => 'a coefficient of 0.465', R.rows);
  assert.equal(s2.hits.length, 0);
  // Skyhook: generated JSON is skipped, params/*.json is scanned
  const s3 = C.scanFiles('skyhook', ['finance/decision_grid.json', 'params/new.json'], () => '{"mu": 398600}', R.rows);
  assert.deepEqual(s3.unregistered.map((u) => u.path), ['params/new.json']);
});

test('snapshots: every file hashes to its sidecar, and the whole copies are the committed blobs', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(C.SNAP).filter((f) => !f.endsWith('.provenance.json'));
  assert.equal(files.length, C.snapshotFiles().length + 2, 'arithmetic files plus the workbook and grid excerpts');
  for (const f of files) {
    const sc = C.sidecar(f);
    assert.ok(sc, `sidecar for ${f}`);
    assert.equal(sc.writtenSha256, sha256(fs.readFileSync(f)), f);
    assert.equal(sc.readMatchesCommitted, true, `${f} read from a clean checkout`);
    const repo = /skyhook/.test(sc.repo) ? 'skyhook' : 'aster';
    assert.ok(sc.commit.startsWith(R.REPOS[repo].expectCommit), `${f} at ${R.REPOS[repo].expectCommit}`);
    if (sc.mode === 'copy') assert.equal(sc.sourceSha256, sc.writtenSha256);
  }
  // excerpts keep line numbers: every registry row in a snapshotted file is on its line offline
  const r = offline();
  assert.equal(r.drift.length, 0);
  assert.equal(r.rows.filter((x) => x.status === 'ok').length + r.rows.filter((x) => x.status === 'saved').length, R.rows.length);
});

test('live: every row is on its stated line, the scan finds nothing unregistered, and the scan catches every scannable row', { skip: liveSkip }, () => {
  const r = C.collect({});
  assert.equal(r.drift.length, 0, JSON.stringify(r.drift.map((d) => [d.id, d.status])));
  assert.equal(r.unregistered.length, 0, JSON.stringify(r.unregistered));
  assert.equal(r.ok, true);
  const hit = new Set([...r.scans.aster.hits, ...r.scans.skyhook.hits].map((h) => `${h.path}:${h.line}:${h.family}`));
  const scannable = R.rows.filter((x) => ['literal', 'comment', 'prose', 'equivalent', 'implied-parking'].includes(x.kind) || x.kind === 'formula');
  for (const x of scannable) {
    const fam = x.family === 'elec' ? 'energy' : x.family;
    assert.ok(hit.has(`${x.path}:${x.line}:${fam}`), `scan sees ${x.id} at ${x.path}:${x.line}`);
  }
  // the live run is the run data.js recorded
  const saved = createRequire(import.meta.url)('./data.js');
  for (const row of r.rows) {
    const s = saved.rows.find((x) => x.id === row.id);
    assert.equal(s.text, row.text, `${row.id} line text`);
  }
});

test('live: snapshots and data.js are current (build-data.mjs --check)', { skip: liveSkip }, () => {
  const p = spawnSync('node', [path.join(HERE, 'build-data.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
});

test('CLI: help, usage, refusal, JSON, offline', () => {
  const run = (...a) => spawnSync('node', [path.join(HERE, 'whose-earth.mjs'), ...a], { encoding: 'utf8' });
  const h = run('--help');
  assert.equal(h.status, 0);
  assert.match(h.stdout, /usage: node ideas\/14-whose-earth\/whose-earth.mjs/);
  assert.equal(run('--frobnicate').status, 3);
  assert.equal(run('--section', 'nope').status, 3);
  const ref = run('--aster', '/nonexistent/aster', '--skyhook', '/nonexistent/skyhook');
  assert.equal(ref.status, 2);
  assert.match(ref.stderr, /refused \(not_found\)/);
  assert.match(ref.stderr, /what would help/);
  const j = run('--offline', '--json');
  assert.equal(j.status, 0);
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.analysis.gates.length, 6);
  const t = run('--offline', '--section', 'gates');
  assert.equal(t.status, 0);
  assert.match(t.stdout, /pass {2}grid-reboost-momentum-view/);
});

test('live: example.txt is the CLI\'s output against the checkouts, byte for byte', { skip: liveSkip }, () => {
  const p = spawnSync('node', [path.join(HERE, 'whose-earth.mjs')], { encoding: 'utf8' });
  assert.equal(p.status, 0);
  assert.equal(fs.readFileSync(path.join(HERE, 'example.txt'), 'utf8'), p.stdout);
});

test('the page carries no constants of its own: everything it shows comes through data.js and model.js', () => {
  const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');
  for (const lit of ['398600', '398,600', '6371', '6,371', '6378', '6,378', '9.80665', '0.465', '37.78', '43.03', '44.8', '5.5973', '121.83', '7301']) {
    assert.ok(!html.includes(lit), `index.html contains ${lit}`);
    assert.ok(!app.includes(lit), `app.js contains ${lit}`);
  }
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  for (const s of ['data.js', 'registry.js', 'model.js', 'app.js']) assert.match(html, new RegExp(`<script src="${s.replace('.', '\\.')}"></script>`));
});
